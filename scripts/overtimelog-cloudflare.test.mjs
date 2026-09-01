import test from 'node:test';
import assert from 'node:assert/strict';
import {
  desiredRedirectRule,
  findProjectByDomain,
  parseUsageDays,
  redirectMatches,
  renderUsageMarkdown,
  runSetup,
  summarizeUsage,
  usageQuery,
} from './overtimelog-cloudflare.mjs';

test('Pages project is resolved by the exact custom domain', () => {
  const target = {name: 'not-guessed', domains: ['overtimelog.com', 'www.overtimelog.com']};
  assert.equal(findProjectByDomain([
    {name: 'other', domains: ['example.com']},
    target,
  ]), target);
  assert.throws(() => findProjectByDomain([]), /exactly one Pages project/);
  assert.throws(() => findProjectByDomain([target, {...target, name: 'duplicate'}]), /found 2/);
});

test('canonical redirect is permanent and preserves path and query', () => {
  const rule = desiredRedirectRule();
  assert.equal(rule.ref, 'overtimelog_www_to_apex');
  assert.equal(rule.expression, 'http.host eq "www.overtimelog.com"');
  assert.equal(
    rule.action_parameters.from_value.target_url.expression,
    'concat("https://overtimelog.com", http.request.uri.path)',
  );
  assert.equal(rule.action_parameters.from_value.status_code, 308);
  assert.equal(rule.action_parameters.from_value.preserve_query_string, true);
  assert.equal(redirectMatches(rule), true);
  assert.equal(redirectMatches({...rule, enabled: false}), false);
});

test('setup changes only the exact Pages project and managed redirect', async () => {
  const calls = [];
  let bindingConfigured = false;
  let redirectConfigured = false;
  const project = () => ({
    name: 'resolved-project',
    domains: ['overtimelog.com', 'www.overtimelog.com'],
    deployment_configs: {
      production: {
        analytics_engine_datasets: bindingConfigured
          ? {USAGE_ANALYTICS: {dataset: 'overtimelog_usage'}}
          : {},
      },
    },
  });
  const envelope = (result, status = 200) => new Response(
    JSON.stringify({success: status < 400, result, errors: status < 400 ? [] : [{message: 'not found'}]}),
    {status, headers: {'content-type': 'application/json'}},
  );
  const fetchImpl = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({method, path: `${url.pathname}${url.search}`, body});
    if (url.pathname === '/client/v4/accounts/account/pages/projects' && method === 'GET') {
      return envelope([
        {name: 'unrelated', domains: ['example.com']},
        project(),
      ]);
    }
    if (url.pathname === '/client/v4/accounts/account/pages/projects/resolved-project') {
      if (method === 'PATCH') {
        assert.deepEqual(
          body.deployment_configs.production.analytics_engine_datasets,
          {USAGE_ANALYTICS: {dataset: 'overtimelog_usage'}},
        );
        bindingConfigured = true;
      }
      return envelope(project());
    }
    if (url.pathname === '/client/v4/zones' && method === 'GET') {
      assert.equal(url.searchParams.get('name'), 'overtimelog.com');
      return envelope([{id: 'zone-id', name: 'overtimelog.com'}]);
    }
    if (url.pathname.endsWith('/rulesets/phases/http_request_dynamic_redirect/entrypoint')) {
      if (!redirectConfigured) return envelope(null, 404);
      return envelope({
        id: 'ruleset-id',
        rules: [{...desiredRedirectRule(), id: 'rule-id'}],
      });
    }
    if (url.pathname === '/client/v4/zones/zone-id/rulesets' && method === 'POST') {
      assert.deepEqual(body.rules, [desiredRedirectRule()]);
      redirectConfigured = true;
      return envelope({id: 'ruleset-id', rules: [{...desiredRedirectRule(), id: 'rule-id'}]});
    }
    return envelope(null, 404);
  };

  const result = await runSetup({
    accountId: 'account',
    token: 'secret-never-output',
    fetchImpl,
  });
  assert.equal(result.project, 'resolved-project');
  assert.equal(bindingConfigured, true);
  assert.equal(redirectConfigured, true);
  assert.equal(calls.some((call) => JSON.stringify(call).includes('secret-never-output')), false);
});

test('usage query accepts a bounded integer window only', () => {
  assert.equal(parseUsageDays('30'), 30);
  assert.equal(parseUsageDays('90'), 90);
  for (const invalid of ['0', '91', '1.5', '30 DAY; DROP TABLE x']) {
    assert.throws(() => parseUsageDays(invalid), /1 through 90/);
  }
  const query = usageQuery('30');
  assert.match(query, /FROM overtimelog_usage/);
  assert.match(query, /INTERVAL '30' DAY/);
  assert.match(query, /blob3 = 'v1'/);
  assert.doesNotMatch(query, /IP|user.agent|referrer/i);
});

test('report includes every allowlisted event and ignores unknown rows', () => {
  const report = summarizeUsage({
    days: 30,
    generatedAt: new Date('2026-10-01T00:00:00Z'),
    rows: [
      {tool: 'overtime-calculator', action: 'calculate', events: 12},
      {tool: 'on-call-timesheet', action: 'export', events: '3'},
      {tool: 'unknown', action: 'identify-user', events: 999},
    ],
  });
  assert.equal(report.total_events, 15);
  assert.equal(report.events.length, 9);
  assert.deepEqual(
    report.events.find((event) => event.tool === 'on-call-timesheet' && event.action === 'export'),
    {tool: 'on-call-timesheet', action: 'export', events: 3},
  );
  assert.equal(report.events.some((event) => event.tool === 'unknown'), false);
  const markdown = renderUsageMarkdown(report);
  assert.match(markdown, /trailing 30 days/);
  assert.match(markdown, /not people or sessions/);
  assert.match(markdown, /\*\*15\*\*/);
});

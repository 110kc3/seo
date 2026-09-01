// Cloudflare operations for the OvertimeLog public-tool measurement phase.
//
// Run only through `.github/workflows/cf-admin.yml`: its Cloudflare token stays
// in GitHub Actions. Setup identifies the existing Pages project by its exact
// custom domain, binds an Analytics Engine dataset in Production, and installs
// one idempotent www-to-apex redirect rule. Reporting reads only grouped event
// counts; the dataset contains no field values or visitor identifiers.

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const APEX_HOSTNAME = 'overtimelog.com';
const WWW_HOSTNAME = 'www.overtimelog.com';
const ANALYTICS_BINDING = 'USAGE_ANALYTICS';
const ANALYTICS_DATASET = 'overtimelog_usage';
const REDIRECT_PHASE = 'http_request_dynamic_redirect';
const REDIRECT_REF = 'overtimelog_www_to_apex';

export const EVENT_SHAPE = Object.freeze({
  'after-hours-summary': Object.freeze(['save', 'export', 'print']),
  'on-call-timesheet': Object.freeze(['save', 'export']),
  'overtime-calculator': Object.freeze(['calculate', 'save', 'export']),
  'weekend-rate-calculator': Object.freeze(['calculate']),
});

function errorMessages(payload) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  return errors.map((error) => String(error?.message || error?.code || 'unknown error')).join('; ');
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function requireValue(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

async function apiRequest({
  fetchImpl,
  token,
  path,
  method = 'GET',
  body,
  allowNotFound = false,
}) {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
    },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    throw new Error(`Cloudflare ${method} ${path} returned non-JSON HTTP ${response.status}`);
  }
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok || payload?.success !== true) {
    const detail = errorMessages(payload) || `HTTP ${response.status}`;
    throw new Error(`Cloudflare ${method} ${path} failed: ${detail}`);
  }
  return payload;
}

export function findProjectByDomain(projects, hostname = APEX_HOSTNAME) {
  const matches = (projects || []).filter((project) => (
    Array.isArray(project?.domains) && project.domains.includes(hostname)
  ));
  if (matches.length !== 1) {
    throw new Error(`expected exactly one Pages project for ${hostname}; found ${matches.length}`);
  }
  return matches[0];
}

export function desiredRedirectRule() {
  return {
    ref: REDIRECT_REF,
    description: 'Canonicalize www.overtimelog.com to overtimelog.com',
    expression: `http.host eq "${WWW_HOSTNAME}"`,
    action: 'redirect',
    action_parameters: {
      from_value: {
        target_url: {
          expression: `concat("https://${APEX_HOSTNAME}", http.request.uri.path)`,
        },
        status_code: 308,
        preserve_query_string: true,
      },
    },
    enabled: true,
  };
}

export function redirectMatches(rule) {
  const desired = desiredRedirectRule();
  return (
    rule?.ref === desired.ref
    && rule?.description === desired.description
    && rule?.expression === desired.expression
    && rule?.action === desired.action
    && rule?.enabled !== false
    && rule?.action_parameters?.from_value?.target_url?.expression
      === desired.action_parameters.from_value.target_url.expression
    && rule?.action_parameters?.from_value?.status_code === 308
    && rule?.action_parameters?.from_value?.preserve_query_string === true
  );
}

async function listPagesProjects({ fetchImpl, token, accountId }) {
  // The live Pages endpoint currently rejects its documented page/per_page
  // parameters for this account, while the documented parameter-free request
  // returns the normal first page. Fail safely if the account ever exceeds it:
  // resolving from an incomplete list would violate the exact-domain guard.
  const payload = await apiRequest({
    fetchImpl,
    token,
    path: `/accounts/${encodeURIComponent(accountId)}/pages/projects`,
  });
  const totalPages = Number(payload.result_info?.total_pages || 1);
  if (totalPages > 1) {
    throw new Error(`Pages returned ${totalPages} project pages but rejected pagination; refusing an incomplete lookup`);
  }
  return payload.result || [];
}

async function configureAnalyticsBinding({
  fetchImpl,
  token,
  accountId,
  project,
}) {
  const existing = project?.deployment_configs?.production?.analytics_engine_datasets || {};
  const path = `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(project.name)}`;
  await apiRequest({
    fetchImpl,
    token,
    path,
    method: 'PATCH',
    body: {
      deployment_configs: {
        production: {
          analytics_engine_datasets: {
            ...existing,
            [ANALYTICS_BINDING]: {dataset: ANALYTICS_DATASET},
          },
        },
      },
    },
  });
  const verified = (await apiRequest({fetchImpl, token, path})).result;
  const binding = verified?.deployment_configs?.production
    ?.analytics_engine_datasets?.[ANALYTICS_BINDING];
  if (binding?.dataset !== ANALYTICS_DATASET) {
    throw new Error(`Pages project ${project.name} did not retain ${ANALYTICS_BINDING}`);
  }
  return verified;
}

async function resolveZone({ fetchImpl, token, accountId }) {
  const query = new URLSearchParams({
    'account.id': accountId,
    name: APEX_HOSTNAME,
    status: 'active',
    per_page: '50',
  });
  const payload = await apiRequest({
    fetchImpl,
    token,
    path: `/zones?${query}`,
  });
  const matches = (payload.result || []).filter((zone) => zone.name === APEX_HOSTNAME);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one active zone for ${APEX_HOSTNAME}; found ${matches.length}`);
  }
  return matches[0];
}

async function configureRedirect({ fetchImpl, token, zoneId }) {
  const entrypointPath = `/zones/${encodeURIComponent(zoneId)}/rulesets/phases/${REDIRECT_PHASE}/entrypoint`;
  let entrypoint;
  try {
    entrypoint = (await apiRequest({
      fetchImpl,
      token,
      path: entrypointPath,
      allowNotFound: true,
    }))?.result || null;
  } catch (error) {
    throw new Error(`Single Redirect setup failed; ensure Zone > Single Redirect > Edit is granted: ${safeError(error)}`);
  }
  const desired = desiredRedirectRule();

  if (!entrypoint) {
    entrypoint = (await apiRequest({
      fetchImpl,
      token,
      path: `/zones/${encodeURIComponent(zoneId)}/rulesets`,
      method: 'POST',
      body: {
        name: 'OvertimeLog canonical redirects',
        description: 'Canonical host redirects managed by GitHub Actions',
        kind: 'zone',
        phase: REDIRECT_PHASE,
        rules: [desired],
      },
    })).result;
  } else {
    const rules = entrypoint.rules || [];
    const existing = rules.find((rule) => rule.ref === REDIRECT_REF);
    if (existing && !redirectMatches(existing)) {
      await apiRequest({
        fetchImpl,
        token,
        path: `/zones/${encodeURIComponent(zoneId)}/rulesets/${encodeURIComponent(entrypoint.id)}/rules/${encodeURIComponent(existing.id)}`,
        method: 'PATCH',
        body: desired,
      });
    } else if (!existing) {
      const conflicts = rules.filter((rule) => rule.expression === desired.expression);
      if (conflicts.length) {
        throw new Error(`an unmanaged redirect already matches ${WWW_HOSTNAME}; refusing to overwrite it`);
      }
      await apiRequest({
        fetchImpl,
        token,
        path: `/zones/${encodeURIComponent(zoneId)}/rulesets/${encodeURIComponent(entrypoint.id)}/rules`,
        method: 'POST',
        body: desired,
      });
    }
  }

  const verified = (await apiRequest({fetchImpl, token, path: entrypointPath})).result;
  const rule = (verified.rules || []).find((candidate) => candidate.ref === REDIRECT_REF);
  if (!redirectMatches(rule)) {
    throw new Error(`redirect rule ${REDIRECT_REF} was not verified after setup`);
  }
  return rule;
}

export async function runSetup({
  accountId,
  token,
  fetchImpl = globalThis.fetch,
  stepSummary,
}) {
  const safeAccountId = requireValue(accountId, 'CLOUDFLARE_ACCOUNT_ID');
  const safeToken = requireValue(token, 'CLOUDFLARE_API_TOKEN');
  const projects = await listPagesProjects({
    fetchImpl,
    token: safeToken,
    accountId: safeAccountId,
  });
  const project = findProjectByDomain(projects);
  const configuredProject = await configureAnalyticsBinding({
    fetchImpl,
    token: safeToken,
    accountId: safeAccountId,
    project,
  });
  const zone = await resolveZone({
    fetchImpl,
    token: safeToken,
    accountId: safeAccountId,
  });
  const redirect = await configureRedirect({
    fetchImpl,
    token: safeToken,
    zoneId: zone.id,
  });
  const markdown = [
    '### OvertimeLog Cloudflare setup',
    '',
    `- Pages project: \`${configuredProject.name}\` (resolved by exact domain, not guessed)`,
    `- Production binding: \`${ANALYTICS_BINDING}\` → \`${ANALYTICS_DATASET}\``,
    `- Canonical redirect: \`https://${WWW_HOSTNAME}/*\` → \`https://${APEX_HOSTNAME}/*\``,
    `- Redirect status: \`${redirect.action_parameters.from_value.status_code}\`; path and query preserved`,
    '- Preview binding: intentionally absent, so preview/local activity cannot enter production counts',
    '',
  ].join('\n');
  if (stepSummary) await appendFile(stepSummary, markdown);
  return {project: configuredProject.name, zone: zone.name, markdown};
}

export function parseUsageDays(value) {
  if (!/^(?:[1-9]|[1-8][0-9]|90)$/.test(String(value ?? ''))) {
    throw new Error('days must be a whole number from 1 through 90');
  }
  return Number(value);
}

export function usageQuery(days) {
  const safeDays = parseUsageDays(days);
  return `SELECT blob1 AS tool, blob2 AS action, SUM(_sample_interval) AS events\n`
    + `FROM ${ANALYTICS_DATASET}\n`
    + `WHERE timestamp >= NOW() - INTERVAL '${safeDays}' DAY AND blob3 = 'v1'\n`
    + 'GROUP BY tool, action\n'
    + 'ORDER BY tool, action';
}

export function summarizeUsage({ rows = [], days, generatedAt = new Date() }) {
  const safeDays = parseUsageDays(days);
  const counts = new Map();
  for (const row of rows) {
    const actions = EVENT_SHAPE[row?.tool];
    if (!actions?.includes(row?.action)) continue;
    const events = Number(row.events);
    if (!Number.isFinite(events) || events < 0) continue;
    counts.set(`${row.tool}\u0000${row.action}`, events);
  }
  const events = [];
  for (const [tool, actions] of Object.entries(EVENT_SHAPE)) {
    for (const action of actions) {
      events.push({tool, action, events: counts.get(`${tool}\u0000${action}`) || 0});
    }
  }
  return {
    generated_at: new Date(generatedAt).toISOString(),
    lookback_days: safeDays,
    dataset: ANALYTICS_DATASET,
    total_events: events.reduce((sum, event) => sum + event.events, 0),
    events,
    privacy_boundary: 'Aggregate allowlisted tool/action counts only; no visitor IDs or work-field values.',
  };
}

export function renderUsageMarkdown(report) {
  const lines = [
    `### OvertimeLog tool actions — trailing ${report.lookback_days} days`,
    '',
    `Generated: \`${report.generated_at}\``,
    '',
    '| tool | action | events |',
    '|---|---|---:|',
    ...report.events.map((event) => `| ${event.tool} | ${event.action} | ${event.events} |`),
    `| **all tools** | **all allowlisted actions** | **${report.total_events}** |`,
    '',
    '> These are action totals, not people or sessions. They contain no entered work values, visitor identifier, URL, referrer, IP or user-agent field.',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export async function runUsageReport({
  accountId,
  token,
  days = '30',
  outputDir,
  stepSummary,
  fetchImpl = globalThis.fetch,
  now = new Date(),
}) {
  const safeAccountId = requireValue(accountId, 'CLOUDFLARE_ACCOUNT_ID');
  const safeToken = requireValue(token, 'CF_ANALYTICS_TOKEN');
  const safeOutputDir = requireValue(outputDir, 'USAGE_REPORT_DIR');
  const safeDays = parseUsageDays(days);
  const response = await fetchImpl(
    `${API_BASE}/accounts/${encodeURIComponent(safeAccountId)}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${safeToken}`,
        'Content-Type': 'text/plain',
      },
      body: usageQuery(safeDays),
    },
  );
  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    throw new Error(`Analytics Engine returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok || !Array.isArray(payload?.data)) {
    const detail = errorMessages(payload) || `HTTP ${response.status}`;
    throw new Error(`Analytics Engine query failed: ${detail}`);
  }
  const report = summarizeUsage({rows: payload.data, days: safeDays, generatedAt: now});
  const markdown = renderUsageMarkdown(report);
  await mkdir(safeOutputDir, {recursive: true});
  await Promise.all([
    writeFile(join(safeOutputDir, 'overtimelog-usage-report.json'), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(join(safeOutputDir, 'overtimelog-usage-report.md'), markdown),
    stepSummary ? appendFile(stepSummary, markdown) : Promise.resolve(),
  ]);
  return {report, markdown};
}

const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));
if (isMain) {
  const action = process.env.OVERTIMELOG_CF_ACTION;
  try {
    if (action === 'setup') {
      const {markdown} = await runSetup({
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        token: process.env.CLOUDFLARE_API_TOKEN,
        stepSummary: process.env.GITHUB_STEP_SUMMARY,
      });
      console.log(markdown);
    } else if (action === 'report') {
      const {markdown} = await runUsageReport({
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        token: process.env.CF_ANALYTICS_TOKEN || process.env.CLOUDFLARE_API_TOKEN,
        days: process.env.OVERTIMELOG_USAGE_DAYS || '30',
        outputDir: process.env.USAGE_REPORT_DIR,
        stepSummary: process.env.GITHUB_STEP_SUMMARY,
      });
      console.log(markdown);
    } else {
      throw new Error('OVERTIMELOG_CF_ACTION must be setup or report');
    }
  } catch (error) {
    console.error(`overtimelog-cloudflare: ${safeError(error)}`);
    process.exitCode = 1;
  }
}

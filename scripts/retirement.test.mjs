import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index.js';
import { selfTerms } from '../worker/route.js';

const cfg = JSON.parse(await readFile(new URL('../site.config.json', import.meta.url), 'utf8'));
const base = cfg.base;
const retired = ['/api/check', '/api/liveness', '/api/route', '/api/watch'];
const ctx = { waitUntil() {} };

test('retired purchases refuse all methods and payment headers without touching payment storage or the network', async (t) => {
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    networkCalls++;
    throw new Error('retired routes must not fetch');
  });
  let storageReads = 0;
  const env = {
    get PAYMENTS() {
      storageReads++;
      throw new Error('retired routes must not access payments or watch credits');
    },
  };
  const hosts = [base, 'https://' + cfg.router_host,
    ...cfg.host_aliases.map((host) => 'https://' + host)];
  for (const host of hosts) {
    for (const path of retired) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
        const response = await worker.fetch(new Request(host + path + '?url=https://example.com', {
          method,
          headers: { 'x-payment': 'old-payment', 'payment-signature': 'old-payment' },
          ...(['GET', 'HEAD'].includes(method) ? {} : { body: 'invalid JSON' }),
        }), env, ctx);
        assert.equal(response.status, 410, method + ' ' + host + path);
        const body = await response.json();
        assert.equal(body.code, 'endpoint_retired');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        for (const header of ['location', 'payment-required', 'payment-response', 'x-payment-response']) {
          assert.equal(response.headers.get(header), null, header + ' must not be returned');
        }
        if (path === '/api/watch') assert.match(body.note, /Existing prepaid weekly sweeps continue/);
      }
    }
  }
  assert.equal(networkCalls, 0);
  assert.equal(storageReads, 0);
});

test('the live payment manifest and audit challenge agree on the only paid API and its price', async () => {
  const info = await (await worker.fetch(new Request(base + '/api/x402/info'), {}, ctx)).json();
  assert.deepEqual(info.resources.map((r) => [r.url, r.method, r.amount]),
    [[base + '/api/audit', 'POST', '50000']]);
  const response = await worker.fetch(new Request(base + '/api/audit', {
    method: 'POST', body: JSON.stringify({ url: 'https://example.com' }),
  }), {}, ctx);
  assert.equal(response.status, 402);
  const v2 = JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64'));
  assert.equal(v2.accepts[0].amount, '50000');
  assert.equal(v2.resource.url, base + '/api/audit');
  const v1 = await response.json();
  assert.equal(v1.accepts[0].maxAmountRequired, '50000');
});

test('audit target validation still happens before payment and free discovery still works', async () => {
  const response = await worker.fetch(new Request(base + '/api/audit', {
    method: 'POST', body: JSON.stringify({ url: 'http://127.0.0.1' }),
  }), {}, ctx);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('payment-required'), null);
  const search = await worker.fetch(new Request(base + '/api/search?q=api'), {}, ctx);
  assert.equal(search.status, 200);
  assert.equal((await search.json()).ok, true);
});

test('the legacy sweep remains authenticated and can consume outstanding prepaid credits', async (t) => {
  let watch = { url: 'https://watched.example/api', webhook: 'https://subscriber.example/hook',
    credits: 1, last_state: 'answering', sweeps_run: 0 };
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url === watch.url) return new Response(null, { status: 402 });
    assert.equal(url, watch.webhook);
    sent.push(JSON.parse(init.body));
    return new Response(null, { status: 204 });
  });
  const env = {
    DASHBOARD_TOKEN: 'test-only',
    PAYMENTS: {
      async list({ prefix }) {
        assert.equal(prefix, 'watch:v1:');
        return { keys: [{ name: 'watch:v1:test' }] };
      },
      async get() { return watch; },
      async put(key, value) { watch = JSON.parse(value); },
    },
  };
  const url = 'https://' + cfg.router_host + '/api/watch/sweep';
  const hidden = await worker.fetch(new Request(url, { method: 'POST' }), env, ctx);
  assert.equal(hidden.status, 404);
  const sweep = () => worker.fetch(new Request(url, {
    method: 'POST', headers: { authorization: 'Bearer test-only' },
  }), env, ctx);
  assert.equal((await (await sweep()).json()).swept, 1);
  assert.equal(watch.credits, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].exhausted, true);
  assert.match(sent[0].note, /top-ups are closed/);
  assert.equal((await (await sweep()).json()).swept, 0);
  assert.equal(sent.length, 1);
});

test('self-probes report retired local URLs as gone, not healthy', () => {
  for (const path of retired) {
    const result = selfTerms('https://' + cfg.router_host + path, cfg);
    assert.equal(result.status, 410);
    assert.equal(result.paywalled, false);
    assert.equal(result.terms, null);
  }
});

test('the weekly job reaches the sweep without a redirect and checks its status', async () => {
  const workflow = await readFile(new URL('../.github/workflows/health.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes('https://' + cfg.router_host + '/api/watch/sweep'));
  assert.ok(!workflow.includes('https://index.percall.dev/api/watch/sweep'));
  assert.ok(workflow.includes('test "$code" = 200'));
});

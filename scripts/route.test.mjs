import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import {
  probe, parseTerms, selfTerms, parseLivenessRequest, parseRouteRequest,
  handleLiveness, handleRoute, PAYMENT_HEADERS,
  foldObservation, summarizeHistory, cachedProbe, RECENT_MAX,
} from '../worker/route.js';

/** A KV stand-in with the two methods this code uses, plus a call counter. */
const fakeKv = () => {
  const store = new Map();
  const kv = {
    puts: 0,
    async get(key, type) {
      const v = store.get(key);
      return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v);
    },
    async put(key, value) { kv.puts++; store.set(key, value); },
    _store: store,
  };
  return kv;
};

const cfg = JSON.parse(await readFile(new URL('../site.config.json', import.meta.url), 'utf8'));
const BASE = cfg.base.replace(/\/+$/, '');

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');

// A 402 in each version, shaped the way the real thing is: v2 in the header
// with `amount`, v1 in the body with `maxAmountRequired` and a network name.
const V2_TERMS = { scheme: 'exact', network: 'eip155:8453', amount: '14000', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: '0xabc', maxTimeoutSeconds: 60, extra: { name: 'USD Coin' } };
const V1_TERMS = { scheme: 'exact', network: 'base', maxAmountRequired: '2000', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: '0xdef', maxTimeoutSeconds: 60 };

const paywalled = (body = { x402Version: 1, accepts: [V1_TERMS] }, headers = {}) =>
  new Response(JSON.stringify(body), { status: 402, headers: { 'content-type': 'application/json', ...headers } });

// --- the invariant ----------------------------------------------------------

test('the router probes and never pays: no payment header ever leaves this Worker', async () => {
  // Kamil's constraint — "I will not pay from my own wallet" — held as a
  // property of the code rather than a habit. A broker that CAN pay is one that
  // can be tricked into paying; this one has no key and sends no authorization.
  let sent = null;
  await probe('https://example.com/paid', {
    cfg,
    fetchImpl: async (url, init) => {
      sent = init;
      return paywalled();
    },
  });

  const names = Object.keys(sent.headers).map((h) => h.toLowerCase());
  for (const header of PAYMENT_HEADERS) {
    assert.ok(!names.includes(header), `probe sent ${header}`);
  }
  // An allowlist, asserted as one: the failure this prevents is not a payment
  // header someone remembered to check for, it is the one nobody thought about.
  assert.deepEqual(names.sort(), ['accept', 'user-agent']);
});

test("a caller's own payment authorization is never forwarded to a third party", async () => {
  // The caller pays US, so its X-PAYMENT is an authorization made out to our
  // address. Forwarding request headers to an arbitrary upstream would hand a
  // signed credential to a stranger — so the probe is built from scratch and
  // the caller's headers are not an input to it at all.
  let sent = null;
  const request = new Request(`${BASE}/api/liveness?url=https://example.com/paid`, {
    headers: { 'x-payment': 'eyJzaWduYXR1cmUiOiJzZWNyZXQifQ==', cookie: 'session=abc' },
  });

  await handleLiveness(request, {}, cfg, {
    gate: async () => ({ ok: true, attach: (r) => r }),
    fetchImpl: async (url, init) => {
      sent = init;
      return paywalled();
    },
  });

  const serialized = JSON.stringify(sent.headers).toLowerCase();
  assert.ok(!serialized.includes('eyjzawduyxr1cmuiois'), 'the caller payment header reached the upstream');
  assert.ok(!serialized.includes('cookie'), 'the caller cookie reached the upstream');
});

test('no worker module attaches a payment header to an outbound request', async () => {
  // Structural, not behavioural: the only mentions of the payment headers in
  // the Worker are where we READ one as a receiver. If a future change adds a
  // paying code path, it has to come here and say so.
  const dir = new URL('../worker/', import.meta.url);
  const offenders = [];
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.js'))) {
    const src = await readFile(new URL(f, dir), 'utf8');
    // `headers: { ... 'x-payment': ... }` — setting one, rather than reading it.
    if (/['"]?x-payment['"]?\s*:\s*(?!\s*null)[^,\n}]*[,\n}]/i.test(src.replace(/^\s*(\/\/|\*).*$/gm, ''))) {
      offenders.push(f);
    }
  }
  assert.deepEqual(offenders, [], `these set an outbound payment header: ${offenders.join(', ')}`);
});

// --- reading other people's 402s --------------------------------------------

test('terms are read from either x402 version, and from both at once', () => {
  const v2 = parseTerms(new Headers({ 'payment-required': b64({ accepts: [V2_TERMS] }) }), null, cfg);
  assert.equal(v2[0].amount_atomic, '14000');
  assert.equal(v2[0].price, 0.014);
  assert.equal(v2[0].network, 'eip155:8453');

  const v1 = parseTerms(new Headers(), { accepts: [V1_TERMS] }, cfg);
  assert.equal(v1[0].amount_atomic, '2000');
  assert.equal(v1[0].price, 0.002);

  const both = parseTerms(new Headers({ 'payment-required': b64({ accepts: [V2_TERMS] }) }), { accepts: [V1_TERMS] }, cfg);
  assert.equal(both.length, 2, 'an endpoint offering both versions should report both');
});

test('an unknown asset reports atomic units and no price, rather than a guess', () => {
  // Dividing by an assumed 10^6 is how a caller reads $0.05 as $50. The amount
  // is always what the endpoint said; the human number appears only when the
  // asset is one we can actually name.
  const exotic = parseTerms(new Headers(), { accepts: [{ ...V1_TERMS, asset: '0xdeadbeef', maxAmountRequired: '999' }] }, cfg);
  assert.equal(exotic[0].amount_atomic, '999');
  assert.equal(exotic[0].price, null);
  assert.equal(exotic[0].price_decimals, null);
});

test('a 402 with no readable terms is still an answer', () => {
  assert.equal(parseTerms(new Headers(), { error: 'pay me' }, cfg), null);
  assert.equal(parseTerms(new Headers({ 'payment-required': 'not base64 at all' }), null, cfg), null);
});

// --- what "alive" means ------------------------------------------------------

test('a 402 is the successful outcome of a probe, not a failure', async () => {
  const r = await probe('https://example.com/paid', { cfg, fetchImpl: async () => paywalled() });
  assert.equal(r.alive, true);
  assert.equal(r.paywalled, true);
  assert.equal(r.terms[0].price, 0.002);
  assert.equal(r.error, null);
});

test('a 405 from probing a POST-only endpoint still proves the host answers', async () => {
  const r = await probe('https://example.com/paid', { cfg, fetchImpl: async () => new Response('', { status: 405 }) });
  assert.equal(r.alive, true, 'the host answered; that is what alive means');
  assert.equal(r.paywalled, false);
});

test('a host that does not answer is reported, not thrown', async () => {
  const r = await probe('https://gone.example/paid', {
    cfg,
    fetchImpl: async () => { throw Object.assign(new Error('nope'), { name: 'TypeError' }); },
  });
  assert.equal(r.alive, false);
  assert.equal(r.status, 0);
  assert.equal(r.error, 'TypeError');
});

// --- our own hosts -----------------------------------------------------------

test('our own endpoints are answered from config, never fetched', async () => {
  // A Worker cannot fetch its own hostnames — Cloudflare answers 522, and this
  // codebase has paid for that twice already (score.js canonicalTarget). Our
  // own terms are a thing we know, so probing them is a lookup.
  let called = false;
  const result = await handleLiveness(
    new Request(`${BASE}/api/liveness?url=${encodeURIComponent(`${BASE}/api/audit`)}`),
    {}, cfg,
    { gate: async () => ({ ok: true, attach: (r) => r }), fetchImpl: async () => { called = true; return new Response('', { status: 200 }); } },
  );
  const body = await result.json();
  assert.equal(called, false, 'the Worker tried to fetch its own hostname');
  assert.equal(body.result.source, 'self');
  assert.equal(body.result.paywalled, true);
  assert.equal(body.result.terms[0].price, 0.05, 'should quote the real audit price from config');

  // Every alias, including the apex, for the same reason.
  for (const host of cfg.host_aliases) {
    assert.ok(selfTerms(`https://${host}/api/audit`, cfg), `${host} is not recognised as ours`);
  }
  assert.equal(selfTerms('https://example.com/api/audit', cfg), null);
});

// --- charging ----------------------------------------------------------------

test('an invalid target is refused before anything is charged', async () => {
  let charged = false;
  const gate = async () => { charged = true; return { ok: true, attach: (r) => r }; };

  for (const bad of ['http://localhost/x', 'https://192.168.1.1/x', 'file:///etc/passwd', 'not-a-url']) {
    const r = await handleLiveness(new Request(`${BASE}/api/liveness?url=${encodeURIComponent(bad)}`), {}, cfg, { gate });
    assert.equal(r.status, 400, `${bad} should be refused`);
  }
  assert.equal(charged, false, 'a request we would reject must never be charged for');
});

test('a routing query that matches nothing is free', async () => {
  // Charging for an empty result set is charging for a 404. The gate is only
  // reached once the catalog has actually found candidates to probe.
  let charged = false;
  const r = await handleRoute(
    new Request(`${BASE}/api/route`, { method: 'POST', body: JSON.stringify({ q: 'nothing matches this' }) }),
    {}, cfg,
    {
      gate: async () => { charged = true; return { ok: true, attach: (x) => x }; },
      base: BASE,
      catalogSearch: async () => new Response(JSON.stringify({ ok: true, results: [], catalog: { endpoints: 14661 } })),
    },
  );
  assert.equal(charged, false);
  const body = await r.json();
  assert.equal(body.count, 0);
  assert.match(body.note, /widen the query/i);
});

test('candidates come back probed, alive first, cheapest live quote next', async () => {
  const results = [
    { url: 'https://dead.example/a', price: 0.001, method: 'GET' },
    { url: 'https://pricey.example/b', price: 0.02, method: 'GET' },
    { url: 'https://cheap.example/c', price: 0.02, method: 'GET' },
  ];
  const r = await handleRoute(
    new Request(`${BASE}/api/route`, { method: 'POST', body: JSON.stringify({ q: 'convert units' }) }),
    {}, cfg,
    {
      gate: async () => ({ ok: true, attach: (x) => x }),
      base: BASE,
      catalogSearch: async () => new Response(JSON.stringify({ ok: true, results, catalog: {} })),
      fetchImpl: async (url) => {
        if (url.includes('dead')) throw Object.assign(new Error('down'), { name: 'TypeError' });
        return paywalled({ x402Version: 1, accepts: [{ ...V1_TERMS, maxAmountRequired: url.includes('cheap') ? '3000' : '20000' }] });
      },
    },
  );
  const body = await r.json();
  assert.deepEqual(body.candidates.map((c) => c.url), [
    'https://cheap.example/c',   // alive, live quote $0.003 — cheaper than its catalog price
    'https://pricey.example/b',  // alive, live quote $0.020
    'https://dead.example/a',    // did not answer: reported, not hidden
  ]);
  assert.equal(body.candidates[2].probe.alive, false);
  assert.match(body.settlement, /never holds, forwards or fronts funds/i);
});

// --- per-endpoint history ----------------------------------------------------

test('observations accumulate newest-first and are capped', () => {
  let rec = null;
  for (let i = 0; i < RECENT_MAX + 10; i++) {
    rec = foldObservation(rec, { alive: i !== 0, status: i === 0 ? 0 : 402, at: `2026-08-${String((i % 28) + 1).padStart(2, '0')}` });
  }
  assert.equal(rec.probes, RECENT_MAX + 10);
  assert.equal(rec.answered, RECENT_MAX + 9);
  assert.equal(rec.recent.length, RECENT_MAX, 'the stored window must stay bounded');
  assert.equal(rec.recent[0], '1', 'newest observation goes first');
  assert.ok(!rec.recent.includes('0'), 'the one failure should have aged out of the window');
  assert.equal(rec.first_seen, '2026-08-01', 'first_seen survives every later fold');
});

test('a rate is withheld until it means something, and the thinness is stated', () => {
  // "Answered 1 of 1" is technically true and practically a lie, and a caller
  // comparing two endpoints will compare those numbers whatever the sample size.
  const one = summarizeHistory(foldObservation(null, { alive: true, status: 402, at: '2026-08-02' }));
  assert.equal(one.uptime, null);
  assert.equal(one.probes, 1);
  assert.match(one.note, /too few observations/i);

  let rec = null;
  for (const alive of [true, true, false, true]) rec = foldObservation(rec, { alive, status: alive ? 402 : 0, at: '2026-08-02' });
  const four = summarizeHistory(rec);
  assert.equal(four.uptime, 0.75);
  assert.equal(four.note, undefined);
  assert.deepEqual(four.recent, { answered: 3, of: 4 });
});

test('consecutive failures are counted from the newest end', () => {
  let rec = null;
  for (const alive of [true, true, false, false]) rec = foldObservation(rec, { alive, status: 0, at: '2026-08-02' });
  const s = summarizeHistory(rec);
  assert.equal(s.consecutive_failures, 2, 'the two most recent probes failed');
  assert.equal(s.last_answered, '2026-08-02');

  const recovered = summarizeHistory(foldObservation(rec, { alive: true, status: 402, at: '2026-08-03' }));
  assert.equal(recovered.consecutive_failures, 0);
});

test('a cache hit is not an observation', async () => {
  // Counting cached answers would let one real request inflate a popular
  // endpoint's record all day, which is the opposite of what the number is for.
  const env = { PAYMENTS: fakeKv() };
  let fetches = 0;
  const opts = {
    cfg,
    fetchImpl: async () => { fetches++; return paywalled(); },
  };

  const first = await cachedProbe(env, 'https://example.com/paid', opts);
  assert.equal(first.history.probes, 1);
  assert.equal(fetches, 1);

  const second = await cachedProbe(env, 'https://example.com/paid', opts);
  assert.equal(second.cached, true);
  assert.equal(fetches, 1, 'the cache should have answered');
  assert.equal(second.history.probes, 1, 'a cache hit must not count as an observation');
});

test('history survives across probes and is keyed per method', async () => {
  const env = { PAYMENTS: fakeKv() };
  const opts = { cfg, fetchImpl: async () => paywalled() };

  await cachedProbe(env, 'https://example.com/paid', opts);
  // Past the 60s cache: clear it the way expiry would, leaving history behind.
  for (const k of [...env.PAYMENTS._store.keys()]) if (k.startsWith('probe:v1:')) env.PAYMENTS._store.delete(k);
  const second = await cachedProbe(env, 'https://example.com/paid', opts);
  assert.equal(second.history.probes, 2, 'the record should have been read back and folded into');

  // A GET probe and a POST probe of the same URL are different observations.
  const post = await cachedProbe(env, 'https://example.com/paid', { ...opts, method: 'POST' });
  assert.equal(post.history.probes, 1);
});

test('a KV outage costs the history, never the answer', async () => {
  const broken = { PAYMENTS: { get: async () => { throw new Error('kv down'); }, put: async () => { throw new Error('kv down'); } } };
  const r = await cachedProbe(broken, 'https://example.com/paid', { cfg, fetchImpl: async () => paywalled() });
  assert.equal(r.alive, true, 'the probe still answered');
  assert.equal(r.history.probes, 1, 'the fold still happened in memory');
});

test('history reaches the caller through both paid endpoints', async () => {
  const env = { PAYMENTS: fakeKv() };
  const gate = async () => ({ ok: true, attach: (x) => x });
  const fetchImpl = async () => paywalled();

  const live = await (await handleLiveness(
    new Request(`${BASE}/api/liveness?url=https://example.com/paid`), env, cfg, { gate, fetchImpl },
  )).json();
  assert.equal(live.result.history.probes, 1);

  const routed = await (await handleRoute(
    new Request(`${BASE}/api/route`, { method: 'POST', body: JSON.stringify({ q: 'convert' }) }), env, cfg,
    { gate, base: BASE, fetchImpl, catalogSearch: async () => new Response(JSON.stringify({ ok: true, results: [{ url: 'https://example.com/paid', price: 0.002, method: 'GET' }], catalog: {} })) },
  )).json();
  // Same endpoint, second real observation — the cache key includes the method
  // and this went through the same GET path, so it is a cache hit.
  assert.ok(routed.candidates[0].probe.history, 'a routed candidate carries its history');
});

test('our own endpoints report a null history rather than dropping the field', async () => {
  // Shape stability: a caller should not have to branch on whose endpoint they
  // asked about. There is no history because it was never a probe.
  const self = selfTerms(`${BASE}/api/audit`, cfg);
  assert.ok('history' in self);
  assert.equal(self.history, null);
});

test('the paid routes are advertised everywhere this site advertises routes', async () => {
  // The house rule is that a route nothing announces is a route nothing finds —
  // and these two are the whole second service, so they are announced in the
  // agent-facing surfaces as well as the human ones.
  const read = async (f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8');

  const openapi = await read('openapi.yaml');
  for (const path of ['/api/liveness:', '/api/route:']) {
    assert.ok(openapi.includes(`\n  ${path}`), `${path} missing from openapi.yaml`);
  }
  // Cheap structural check in place of a YAML parse (this repo has no
  // dependencies): a path whose operation block failed to indent would not
  // carry its own operationId.
  for (const id of ['probeEndpoint', 'routeToEndpoint']) {
    assert.ok(openapi.includes(`operationId: ${id}`), `${id} missing from openapi.yaml`);
  }

  const llms = await read('llms.txt');
  assert.ok(llms.includes('/api/liveness?url='), 'llms.txt does not name the probe endpoint');
  assert.ok(llms.includes('/api/route'), 'llms.txt does not name the routing endpoint');
  assert.match(llms, /never pays for anything and never holds your money/i,
    'llms.txt must state the non-custodial promise where an agent will actually read it');

  const manifest = JSON.parse(await read('.well-known/agents.json'));
  const paid = manifest.endpoints.filter((e) => new URL(e.url).pathname.match(/^\/api\/(liveness|route)$/));
  assert.equal(paid.length, 2, 'both routes should be in the agents manifest');
  for (const e of paid) assert.equal(e.auth, 'x402');
});

test('the umbrella names every live product, including this one', async () => {
  // This failed once, silently and for a day: the router shipped on the index's
  // host, the portfolio page is generated from a hand-written block that nobody
  // had to touch, and percall.dev went on saying "One service is live". The
  // domain's entire job is to name what runs under it.
  const apex = await readFile(new URL('../apex.html', import.meta.url), 'utf8');
  for (const claim of ['/api/liveness', '/api/route', 'The Router']) {
    assert.ok(apex.includes(claim), `the umbrella does not mention ${claim}`);
  }
  assert.ok(!/One service is live/.test(apex), 'the umbrella still claims a single service');
  // And it must not promise the non-custodial thing loosely: it is the whole
  // reason a caller would trust a middleman with their routing question.
  assert.match(apex, /you pay the endpoint directly/i);
});

test('the request parsers refuse what they cannot act on', () => {
  assert.match(parseRouteRequest({}).error, /^q:/);
  assert.match(parseRouteRequest({ q: 'x', max_price: 'cheap' }).error, /^max_price:/);
  assert.equal(parseRouteRequest({ q: 'x', limit: 99 }).limit, 5, 'the probe fan-out must stay capped');
  assert.match(parseLivenessRequest(new URL(`${BASE}/api/liveness?url=https://a.example/&method=DELETE`)).error, /^method:/);
});

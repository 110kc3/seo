import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseWatchRequest, handleWatch, handleSweep, watchKey, MAX_SWEEPS } from '../worker/watch.js';
import { urlError } from '../scripts/validate.mjs';

const cfg = JSON.parse(await readFile(new URL('../site.config.json', import.meta.url), 'utf8'));
const BASE = cfg.base.replace(/\/+$/, '');
const PAYER = '0xC8b3424936Af77D8684fa2f78391Fc7c0f3387D4';

const fakeKv = () => {
  const store = new Map();
  return {
    _store: store,
    async get(k, t) { const v = store.get(k); return v === undefined ? null : (t === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { store.set(k, v); },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
};
const okGate = (payer = PAYER) => async () => ({ ok: true, payer, attach: (r) => r });
const req = (body) => new Request(`${BASE}/api/watch`, { method: 'POST', body: JSON.stringify(body) });

test('a webhook is validated as strictly as the target, and https only', () => {
  // We POST to this unattended. An alert aimed at 127.0.0.1 is a request to use
  // this Worker as an internal-network probe, and http would leak the URL being
  // watched across the wire.
  assert.match(parseWatchRequest({ url: 'https://a.example/x', webhook: 'http://you.example/h' }, urlError).error, /^webhook: must be https/);
  assert.match(parseWatchRequest({ url: 'https://a.example/x', webhook: 'https://127.0.0.1/h' }, urlError).error, /^webhook:/);
  assert.match(parseWatchRequest({ url: 'https://a.example/x', webhook: 'https://localhost/h' }, urlError).error, /^webhook:/);
  assert.match(parseWatchRequest({ url: 'http://localhost/x', webhook: 'https://you.example/h' }, urlError).error, /^url:/);
  assert.equal(parseWatchRequest({ url: 'https://a.example/x', webhook: 'https://you.example/h' }, urlError).sweeps, 12);
  assert.match(parseWatchRequest({ url: 'https://a.example/x', webhook: 'https://you.example/h', sweeps: 999 }, urlError).error, /^sweeps:/);
  assert.match(parseWatchRequest({ url: 'https://a.example/x', webhook: 'https://you.example/h', sweeps: 1 }, urlError).error, /^sweeps:/);
});

test('an invalid watch is refused before anything is charged', async () => {
  let charged = false;
  const r = await handleWatch(req({ url: 'https://a.example/x', webhook: 'http://insecure/h' }), { PAYMENTS: fakeKv() }, cfg, {
    base: BASE, urlError, gate: async () => { charged = true; return { ok: true, payer: PAYER, attach: (x) => x }; },
  });
  assert.equal(r.status, 400);
  assert.equal(charged, false);
});

test('the payer from the settlement owns the watch — not a self-declared address', async () => {
  const env = { PAYMENTS: fakeKv() };
  const r = await handleWatch(
    // A body claiming a different owner must be ignored entirely.
    req({ url: 'https://a.example/x', webhook: 'https://you.example/h', sweeps: 6, payer: '0xATTACKER', owner: '0xATTACKER' }),
    env, cfg, { base: BASE, urlError, gate: okGate() },
  );
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.owner, PAYER);
  assert.ok(env.PAYMENTS._store.has(watchKey(PAYER, 'https://a.example/x')));
  assert.ok(!JSON.stringify([...env.PAYMENTS._store.keys()]).includes('ATTACKER'));
});

test('paying again for the same URL tops up rather than resetting', async () => {
  // Same wallet, same URL: the intent is unambiguous, and losing the remainder
  // to a second purchase would be theft by rounding.
  const env = { PAYMENTS: fakeKv() };
  const opts = { base: BASE, urlError, gate: okGate() };
  await handleWatch(req({ url: 'https://a.example/x', webhook: 'https://you.example/h', sweeps: 6 }), env, cfg, opts);
  const second = await (await handleWatch(req({ url: 'https://a.example/x', webhook: 'https://you.example/h', sweeps: 4 }), env, cfg, opts)).json();
  assert.equal(second.credits, 10);
  assert.equal(second.topped_up, true);
  assert.equal(env.PAYMENTS._store.size, 1, 'a top-up must not create a second watch');
});

test('a settled payment whose watch cannot be stored says so, and does not claim to be watching', async () => {
  const broken = { PAYMENTS: { get: async () => null, put: async () => { throw new Error('kv down'); } } };
  const r = await handleWatch(req({ url: 'https://a.example/x', webhook: 'https://you.example/h' }), broken, cfg, {
    base: BASE, urlError, gate: okGate(),
  });
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.code, 'watch_not_stored');
  assert.match(body.error, /payment settled/i, 'the caller must be told their money moved');
  assert.match(body.error, /nothing is being monitored/i);
});

// --- the sweep ---------------------------------------------------------------

const seed = async (env, over = {}) => {
  const w = { url: 'https://a.example/x', webhook: 'https://you.example/h', payer: PAYER, credits: 3, sweeps_run: 0, last_state: null, last_swept: null, ...over };
  await env.PAYMENTS.put(watchKey(PAYER, w.url), JSON.stringify(w));
  return w;
};

test('the sweep is invisible without the bearer', async () => {
  const r = await handleSweep(new Request(`${BASE}/api/watch/sweep`, { method: 'POST' }), { PAYMENTS: fakeKv() }, { authorized: false, probe: async () => ({ alive: true }) });
  assert.equal(r.status, 404, '404 not 401 — an unauthorized caller learns nothing about what exists');
});

test('the first sweep sets a baseline instead of alerting', async () => {
  // A watch created on an endpoint that is already down must not fire "it
  // changed" — nothing changed, that is just how it was found.
  const env = { PAYMENTS: fakeKv() };
  await seed(env);
  let posted = 0;
  const r = await handleSweep(new Request(`${BASE}/api/watch/sweep`, { method: 'POST' }), env, {
    authorized: true, cfg,
    probe: async () => ({ alive: false, status: 0 }),
    fetchImpl: async () => { posted++; return { ok: true }; },
  });
  const body = await r.json();
  assert.equal(body.swept, 1);
  assert.equal(body.alerted, 0);
  assert.equal(posted, 0);
  const stored = await env.PAYMENTS.get(watchKey(PAYER, 'https://a.example/x'), 'json');
  assert.equal(stored.last_state, 'failing');
  assert.equal(stored.credits, 2, 'a sweep spends a credit even when it does not alert');
});

test('the alert fires on the edge, in both directions', async () => {
  const env = { PAYMENTS: fakeKv() };
  await seed(env, { last_state: 'answering' });
  const sent = [];
  await handleSweep(new Request(`${BASE}/api/watch/sweep`, { method: 'POST' }), env, {
    authorized: true, cfg,
    probe: async () => ({ alive: false, status: 0 }),
    fetchImpl: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true }; },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://you.example/h');
  assert.equal(sent[0].body.state, 'failing');
  assert.equal(sent[0].body.changed, true);

  // Recovery is an edge too — the subscriber needs to know it came back.
  await handleSweep(new Request(`${BASE}/api/watch/sweep`, { method: 'POST' }), env, {
    authorized: true, cfg,
    probe: async () => ({ alive: true, status: 402 }),
    fetchImpl: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true }; },
  });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.state, 'answering');
});

test('an exhausted watch stops costing probes, and the last alert says why', async () => {
  const env = { PAYMENTS: fakeKv() };
  await seed(env, { credits: 1, last_state: 'answering' });
  const sent = [];
  const first = await (await handleSweep(new Request(`${BASE}/api/watch/sweep`, { method: 'POST' }), env, {
    authorized: true, cfg,
    probe: async () => ({ alive: true, status: 402 }),
    fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; },
  })).json();
  // Credits hit zero: that fires even without a state change, because "this was
  // your last one" is exactly the moment a subscriber needs to hear from us.
  assert.equal(first.swept, 1);
  assert.equal(sent.at(-1).exhausted, true);
  assert.equal(sent.at(-1).credits_left, 0);

  const second = await (await handleSweep(new Request(`${BASE}/api/watch/sweep`, { method: 'POST' }), env, {
    authorized: true, cfg,
    probe: async () => { throw new Error('must not probe an exhausted watch'); },
    fetchImpl: async () => ({ ok: true }),
  })).json();
  assert.equal(second.swept, 0);
  assert.equal(second.exhausted, 1);
});

test("one subscriber's dead webhook does not stop the sweep for everyone else", async () => {
  const env = { PAYMENTS: fakeKv() };
  await seed(env, { last_state: 'answering' });
  await env.PAYMENTS.put(watchKey('0xother', 'https://b.example/y'), JSON.stringify({
    url: 'https://b.example/y', webhook: 'https://them.example/h', payer: '0xother', credits: 2, last_state: 'answering',
  }));
  const body = await (await handleSweep(new Request(`${BASE}/api/watch/sweep`, { method: 'POST' }), env, {
    authorized: true, cfg,
    probe: async () => ({ alive: false, status: 0 }),
    fetchImpl: async (url) => { if (url.includes('you.example')) throw new Error('connection refused'); return { ok: true }; },
  })).json();
  assert.equal(body.swept, 2, 'both watches were swept');
  assert.equal(body.alerted, 1);
  assert.equal(body.failed_delivery, 1);
});

test('a watch costs sweeps x the published per-sweep price, and the cap is real', async () => {
  const { resolveX402 } = await import('../scripts/x402-config.mjs');
  const rail = resolveX402(cfg);
  assert.ok(Number(rail.watch_sweep_price_atomic) > 0, 'a sweep must have a published price');
  assert.equal(parseWatchRequest({ url: 'https://a.example/x', webhook: 'https://you.example/h', sweeps: MAX_SWEEPS }, urlError).sweeps, MAX_SWEEPS);
  assert.match(parseWatchRequest({ url: 'https://a.example/x', webhook: 'https://you.example/h', sweeps: MAX_SWEEPS + 1 }, urlError).error, /^sweeps:/);
});

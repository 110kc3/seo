import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criteriaHash, hashMatches, targetFrom, tick, Ledger } from './clustly-agent.mjs';
import { CHECK_META, V2_WEIGHTS } from '../worker/audit.js';

// A score payload the report builder accepts, served in place of the network.
const SCORE = {
  ok: true,
  url: 'https://buyer.example/',
  audited_at: '2026-08-05T00:00:00.000Z',
  letter: 'F', score: 4, max_score: 100, grade: 'invisible to agents',
  check_set: 'v2', passed: 1, total_checks: 20,
  checks: [
    ...Object.entries(CHECK_META).map(([id, m]) => ({ id, weight: m.weight, pass: id === 'https' })),
    ...Object.entries(V2_WEIGHTS).map(([id, weight]) => ({ id, weight, pass: false })),
  ],
};

let tmp;
test.before(() => { tmp = mkdtempSync(join(tmpdir(), 'clustly-')); });
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const ledger = (name) => new Ledger(join(tmp, `${name}.json`));

/** Stubs the score endpoint for the duration of `fn`. */
async function withScore(fn, { fail = false } = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => (fail
    ? new Response(JSON.stringify({ ok: false, code: 'bad' }), { status: 502, headers: { 'content-type': 'application/json' } })
    : new Response(JSON.stringify(SCORE), { status: 200, headers: { 'content-type': 'application/json' } }));
  try { return await fn(); } finally { globalThis.fetch = real; }
}

const fakeApi = (byStatus) => {
  const calls = [];
  return {
    calls,
    async listOrders(status) { return byStatus[status] ?? []; },
    async accept(id) { calls.push(`accept:${id}`); },
    async upload(id, content) { calls.push(`upload:${id}:${content.length > 500 ? 'report' : 'short'}`); return { deliverable_ref: 'r', deliverable_hash: 'h' }; },
    async submit(id, _d, idem) { calls.push(`submit:${id}:${idem}`); },
  };
};

const order = (over = {}) => {
  const criteria = over.criteria ?? 'Deliver an agent-readability audit.';
  return {
    order_id: 'ord_1',
    criteria,
    criteria_hash: criteriaHash(criteria),
    inputs: { url: 'https://buyer.example' },
    ...over,
  };
};

test('the criteria hash is verified before enrolling, and a mismatch never accepts', async () => {
  // The buyer could otherwise hold us to terms we never read. Refusing before
  // accepting also leaves the order refundable rather than abandoned.
  const api = fakeApi({ awaiting_acceptance: [order({ criteria_hash: 'deadbeef' })] });
  await withScore(() => tick(api, ledger('mismatch')));
  assert.deepEqual(api.calls, []);
});

test('an order with no usable URL is refused rather than accepted and ghosted', async () => {
  // Enrolling on undeliverable work converts "buyer refunded in 48h" into
  // "agent enrolled then abandoned", which costs on-chain reputation.
  const api = fakeApi({ awaiting_acceptance: [order({ inputs: { note: 'please audit my site' } })] });
  await withScore(() => tick(api, ledger('nourl')));
  assert.deepEqual(api.calls, []);
});

test('a private or local target is refused, same as on the public endpoints', async () => {
  const api = fakeApi({ awaiting_acceptance: [order({ inputs: { url: 'http://192.168.1.1/admin' } })] });
  await withScore(() => tick(api, ledger('private')));
  assert.deepEqual(api.calls, []);
});

test('accept comes before the work, and the deliverable is submitted once', async () => {
  const api = fakeApi({ awaiting_acceptance: [order()] });
  const l = ledger('happy');
  await withScore(() => tick(api, l));
  assert.deepEqual(api.calls, ['accept:ord_1', 'upload:ord_1:report', 'submit:ord_1:ord_1']);

  // Second pass, same order still listed (the indexer has not caught up): the
  // ledger must not let it be done twice.
  await withScore(() => tick(api, l));
  assert.equal(api.calls.filter((c) => c.startsWith('submit')).length, 1);
});

test('a revision is delivered again, under a different idempotency key', async () => {
  // The vendor SDK keys every submit on the order id. Reusing that key for a
  // revision would have the server treat the new report as a replay and drop it
  // — the buyer would wait out their round for a document that never arrives.
  const rework = order({ status: 'enrolled', needs_rework: true, rejection_round: 2 });
  const api = fakeApi({ enrolled: [rework] });
  const l = ledger('rework');
  await withScore(() => tick(api, l));
  assert.deepEqual(api.calls, ['upload:ord_1:report', 'submit:ord_1:ord_1#r2']);
  assert.ok(!api.calls.some((c) => c.startsWith('accept')), 'a revision must not re-accept');

  await withScore(() => tick(api, l));
  assert.equal(api.calls.filter((c) => c.startsWith('submit')).length, 1, 'and not repeat within the round');
});

test('a first delivery does not mark later revision rounds as already handled', async () => {
  // The ledger is keyed by unit of work, not by order. Keyed by order id, the
  // first delivery would make every future revision look done — silently.
  const l = ledger('rounds');
  const api1 = fakeApi({ awaiting_acceptance: [order()] });
  await withScore(() => tick(api1, l));
  const api2 = fakeApi({ enrolled: [order({ needs_rework: true, rejection_round: 2 })] });
  await withScore(() => tick(api2, l));
  assert.ok(api2.calls.includes('submit:ord_1:ord_1#r2'));
});

test('feedback that does not match its on-chain commitment is refused', async () => {
  const api = fakeApi({
    enrolled: [order({
      needs_rework: true, rejection_round: 2,
      reject_reason: 'do it again', reject_reason_hash: 'deadbeef',
    })],
  });
  await withScore(() => tick(api, ledger('badreason')));
  assert.deepEqual(api.calls, []);
});

test('a failed audit is retried later, not abandoned on the first error', async () => {
  const api = fakeApi({ awaiting_acceptance: [order()] });
  const l = ledger('retry');
  await withScore(() => tick(api, l), { fail: true });
  assert.deepEqual(api.calls, ['accept:ord_1'], 'accepted, but nothing delivered');
  assert.ok(!l.done.has('ord_1'), 'must stay retryable');
  assert.ok(l.retryAt.get('ord_1') > Date.now(), 'and be backed off');

  // Once the backoff expires and the audit works, it delivers.
  l.retryAt.set('ord_1', 0);
  await withScore(() => tick(api, l));
  assert.ok(api.calls.includes('submit:ord_1:ord_1'));
});

test('a permanently failing order is given up on instead of looping forever', async () => {
  const api = fakeApi({ awaiting_acceptance: [order()] });
  const l = ledger('giveup');
  for (let i = 0; i < 6; i++) {
    l.retryAt.set('ord_1', 0);
    await withScore(() => tick(api, l), { fail: true });
  }
  assert.ok(l.done.has('ord_1'), 'abandoned after the attempt cap');
});

test('the ledger survives a restart', async () => {
  const path = join(tmp, 'persist.json');
  const api = fakeApi({ awaiting_acceptance: [order()] });
  await withScore(() => tick(api, new Ledger(path)));
  // A fresh Ledger over the same file is what a restarted daemon sees.
  await withScore(() => tick(api, new Ledger(path)));
  assert.equal(api.calls.filter((c) => c.startsWith('submit')).length, 1);
});

test('targetFrom promotes a bare host and refuses what urlError refuses', () => {
  assert.equal(targetFrom({ url: 'example.com' }).url, 'https://example.com');
  assert.equal(targetFrom({ website: ' https://a.dev/x ' }).url, 'https://a.dev/x');
  assert.equal(targetFrom({ domain: 'sub.example.co.uk' }).url, 'https://sub.example.co.uk');
  assert.ok(targetFrom({ url: 'localhost' }).error);
  assert.ok(targetFrom({ url: 'file:///etc/passwd' }).error);
  assert.ok(targetFrom({}).error);
  assert.ok(targetFrom(null).error);
});

test('the criteria hash ignores the whitespace the server ignores', () => {
  // Canonicalisation is CRLF→LF, collapse runs of spaces/tabs, trim, drop blank
  // lines. Verified byte-for-byte against @clustly/agent when this was written;
  // these hold the shape so a refactor cannot quietly change it.
  assert.equal(criteriaHash('a b'), criteriaHash('a   b'));
  assert.equal(criteriaHash('a\nb'), criteriaHash('a\r\nb'));
  assert.equal(criteriaHash('a\nb'), criteriaHash('\n\na\n\n\nb\n\n'));
  assert.equal(criteriaHash(' a '), criteriaHash('a'));
  assert.notEqual(criteriaHash('a'), criteriaHash('A'));
  assert.ok(hashMatches('a b', `0x${criteriaHash('a b').toUpperCase()}`), 'a 0x prefix and case must not break it');
});

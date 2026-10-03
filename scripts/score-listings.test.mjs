import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshScores, scoreSummary } from './score-listings.mjs';
import { handleScore, __testing as score } from '../worker/score.js';

const base = 'https://registry.example';
const token = 'test-operations-token';
const now = () => new Date('2026-10-03T12:00:00Z');
const good = { ok: true, score: 100, max_score: 100, letter: 'A', passed: 20, total_checks: 20, check_set: 'v2' };
const listings = Array.from({ length: 110 }, (_, i) => ({ slug: `site-${String(i).padStart(3, '0')}`, url: `${base}/site/${i}` }));

function fixture() {
  const store = new Map();
  return { store, env: {
    DASHBOARD_TOKEN: token,
    PAYMENTS: { async get(k) { return store.get(k) ?? null; }, async put(k, v) { store.set(k, v); } },
    ASSETS: { async fetch(request) {
      assert.equal(request.headers.get('authorization'), null, 'operations bearer must not reach audited sites');
      assert.equal(request.headers.get('x-registry-score'), null);
      return new URL(request.url).pathname.startsWith('/site/')
        ? new Response('<html><body>Fixture</body></html>', { headers: { 'content-type': 'text/html' } })
        : new Response('Not found', { status: 404 });
    } },
  } };
}
const call = (env, target, headers = {}) => handleScore(new Request(`${base}/api/score?url=${encodeURIComponent(target)}`, {
  headers: { 'cf-connecting-ip': '192.0.2.1', ...headers },
}), env, { base }, null, listings);
const auth = { authorization: `Bearer ${token}`, 'x-registry-score': '1' };

// This fixture intentionally has no metadata. HTML parsing itself is covered
// on the Workers runtime; here the real audit exercises auth, cache and limits.
test('110 uncached scheduled audits complete without spending the anonymous allowance', async (t) => {
  const original = globalThis.HTMLRewriter;
  globalThis.HTMLRewriter = class { on() { return this; } transform(r) { return r; } };
  t.after(() => { if (original === undefined) delete globalThis.HTMLRewriter; else globalThis.HTMLRewriter = original; });
  const { env, store } = fixture();
  const result = await refreshScores({ listings, base, token, now, fetchImpl: async (url, init) => {
    assert.equal(init.redirect, 'error');
    return handleScore(new Request(url, { ...init, headers: { ...init.headers, 'cf-connecting-ip': '192.0.2.1' } }), env, { base }, null, listings);
  } });
  assert.equal(result.complete, true, JSON.stringify(result.failures));
  assert.equal(result.refreshed, 110);
  assert.equal(Object.keys(result.scores).length, 110);
  assert.equal(result.scores['site-109'].checked, '2026-10-03');
  assert.equal([...store.keys()].filter(k => k.startsWith(score.RATE_PREFIX)).length, 0);

  // Use fresh targets so cache hits cannot mask a public rate-limit regression.
  for (let i = 0; i < 60; i++) assert.equal((await call(env, `${base}/site/public-${i}`)).status, 200);
  assert.equal((await call(env, `${base}/site/public-61`)).status, 429);
  assert.equal((await call(env, `${base}/site/public-62`, { authorization: `Bearer ${token}` })).status, 429);
  assert.equal((await call(env, `${base}/site/public-63`, { 'user-agent': 'ai-product-index-scorer' })).status, 429);
  assert.equal((await call(env, listings[0].url)).status, 200, 'public cache hits remain free');
});

test('maintenance auth is bearer-only and applies before cache or alias rewriting', async () => {
  const { env, store } = fixture();
  const target = listings[0].url;
  store.set(`${score.CACHE_PREFIX}v2:${target}`, JSON.stringify(good));
  for (const headers of [
    { 'x-registry-score': '1' },
    { ...auth, authorization: 'Bearer wrong' },
    { 'x-registry-score': '1', cookie: `aipi_dash=${token}` },
  ]) assert.equal((await call(env, target, headers)).status, 401);
  const queryToken = new Request(`${base}/api/score?url=${encodeURIComponent(target)}&token=${token}`, { headers: { 'x-registry-score': '1' } });
  assert.equal((await handleScore(queryToken, env, { base }, null, listings)).status, 401);
  assert.equal((await call({ ...env, DASHBOARD_TOKEN: undefined }, target, auth)).status, 401);
  assert.equal((await call(env, `${base}/unregistered`, auth)).status, 403);
  assert.equal((await call(env, 'https://outside.example/', auth)).status, 403);
  assert.equal((await call(env, 'https://127.0.0.1/', auth)).status, 400);
  assert.equal((await call(env, target, auth)).status, 200);
  const alias = new Request(`https://registry.example/api/score?url=${encodeURIComponent('https://alias.example/site/0')}`, { headers: auth });
  assert.equal((await handleScore(alias, env, { base, host_aliases: ['alias.example'] }, null, listings)).status, 403);
});

test('partial refresh retains old dates, reports missing grades and continues after errors', async () => {
  const previous = { 'site-000': { letter: 'B', score: 80, checked: '2026-09-21' } };
  let count = 0;
  const result = await refreshScores({ listings: listings.slice(0, 4), previous, base, token, now, fetchImpl: async () => {
    count++;
    if (count === 1) return new Response('rate limited', { status: 429 });
    if (count === 2) return Response.json({ ...good, letter: 'wrong' });
    if (count === 3) throw new Error(`network failure ${token}`);
    return Response.json(good);
  } });
  assert.equal(result.complete, false);
  assert.equal(result.refreshed, 1);
  assert.equal(result.retained, 1);
  assert.equal(result.missing, 2);
  assert.deepEqual(result.scores['site-000'], previous['site-000']);
  assert.equal(result.scores['site-003'].checked, '2026-10-03');
  assert.match(scoreSummary(result), /1\/4 refreshed; 1 previous grades retained; 2 without a grade/);
  assert.match(scoreSummary(result), /INCOMPLETE/);
  assert.doesNotMatch(scoreSummary(result), new RegExp(token));
});

test('missing credentials and unsafe service URLs fail before making requests', async () => {
  const fetchImpl = () => assert.fail('must not send a request');
  for (const options of [{ base, token: '' }, { base: 'http://registry.example', token }, { base: 'https://user:pass@registry.example', token }]) {
    await assert.rejects(refreshScores({ listings, fetchImpl, ...options }));
  }
});

test('CLI publishes partial scores and summary but exits unsuccessfully', async (t) => {
  const { mkdtemp, cp, writeFile, readFile, mkdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const root = await mkdtemp(join(tmpdir(), 'registry-score-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'listings'));
  await cp(new URL('../worker', import.meta.url), join(root, 'worker'), { recursive: true });
  await cp(new URL('../site.config.json', import.meta.url), join(root, 'site.config.json'));
  await cp(new URL('../package.json', import.meta.url), join(root, 'package.json'));
  await cp(new URL('./validate.mjs', import.meta.url), join(root, 'scripts/validate.mjs'));
  await cp(new URL('./score-listings.mjs', import.meta.url), join(root, 'scripts/score-listings.mjs'));
  await writeFile(join(root, 'listings/old.json'), JSON.stringify(listings[0]));
  await writeFile(join(root, 'listings/new.json'), JSON.stringify(listings[1]));
  const old = { letter: 'B', score: 80, checked: '2026-09-21' };
  await writeFile(join(root, 'scores.json'), JSON.stringify({ 'site-000': old }));
  await writeFile(join(root, 'fetch.mjs'), `globalThis.fetch = async (url) => new URL(url).searchParams.get('url').endsWith('/0') ? new Response('', {status: 502}) : Response.json(${JSON.stringify(good)});`);
  const env = { ...process.env, DASHBOARD_TOKEN: token, GITHUB_OUTPUT: join(root, 'outputs'), GITHUB_STEP_SUMMARY: join(root, 'summary') };
  const result = spawnSync(process.execPath, ['--import', join(root, 'fetch.mjs'), join(root, 'scripts/score-listings.mjs')], { env, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const scores = JSON.parse(await readFile(join(root, 'scores.json'), 'utf8'));
  assert.deepEqual(scores['site-000'], old);
  assert.equal(scores['site-001']?.score, 100, result.stdout + result.stderr);
  assert.match(await readFile(env.GITHUB_OUTPUT, 'utf8'), /complete=false/);
  assert.match(await readFile(env.GITHUB_STEP_SUMMARY, 'utf8'), /1\/2 refreshed; 1 previous grades retained/);
  const before = await readFile(join(root, 'scores.json'), 'utf8');
  const missing = spawnSync(process.execPath, [join(root, 'scripts/score-listings.mjs')], { env: { ...env, DASHBOARD_TOKEN: '' }, encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.equal(await readFile(join(root, 'scores.json'), 'utf8'), before);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLiveness } from './check-liveness.mjs';

const listing = { slug: 'fixture', url: 'https://fixture.example/' };
const base = 'https://registry.example';
const at = (date) => () => new Date(date);
const down = async () => new Response('', { status: 404 });
const check = (date, state = {}, extra = {}) => checkLiveness({
  listings: [listing], base, fetchImpl: down, now: at(date),
  previous: state.health, previousWeeks: state.weeks, ...extra,
});

test('repeated checks in one UTC week cannot advance a listing toward delisting', async () => {
  let state = await check('2026-10-19T04:17:00Z');
  for (const date of ['2026-10-19T05:00:00Z', '2026-10-21T12:00:00Z', '2026-10-25T23:59:59Z']) {
    state = await check(date, state);
    assert.equal(state.health.fixture, 1);
    assert.equal(state.weeks.fixture.week, '2026-10-19');
    assert.equal(state.delisted.length, 0);
  }
  state = await check('2026-10-26T00:00:00Z', state);
  assert.equal(state.health.fixture, 2);
  state = await check('2026-10-27T12:00:00Z', state);
  assert.equal(state.health.fixture, 2);
  state = await check('2026-11-02T00:00:00Z', state);
  assert.deepEqual(state.delisted.map((v) => v.slug), ['fixture']);
  assert.deepEqual(state.health, {});
  assert.deepEqual(state.weeks, {});
});

test('consecutive weeks work across year boundaries', async () => {
  let state = await check('2026-12-27T23:59:59Z');
  assert.equal(state.weeks.fixture.week, '2026-12-21');
  state = await check('2026-12-28T00:00:00Z', state);
  state = await check('2027-01-01T12:00:00Z', state);
  assert.equal(state.health.fixture, 2);
  state = await check('2027-01-04T00:00:00Z', state);
  assert.equal(state.delisted.length, 1);
});

test('a missed week, replacement URL or undated legacy state cannot establish a three-week outage', async () => {
  let state = await check('2026-10-12T04:17:00Z');
  state = await check('2026-10-19T04:17:00Z', state);
  assert.equal(state.health.fixture, 2);
  for (const result of [
    await check('2026-11-02T04:17:00Z', state),
    await check('2026-10-26T04:17:00Z', state, { listings: [{ ...listing, url: 'https://replacement.example/' }] }),
    await check('2026-10-26T04:17:00Z', { health: { fixture: 2 } }),
  ]) {
    assert.equal(result.health.fixture, 1);
    assert.equal(result.delisted.length, 0);
  }
});

test('recovery clears the streak and entries no longer registered are discarded', async () => {
  const state = await check('2026-10-19T04:17:00Z');
  const recovered = await check('2026-10-20T04:17:00Z', state, { fetchImpl: async () => new Response('up') });
  assert.deepEqual(recovered.health, {});
  assert.deepEqual(recovered.weeks, {});
  assert.equal((await check('2026-10-21T04:17:00Z', recovered)).health.fixture, 1);
  const empty = await check('2026-10-26T04:17:00Z', state, { listings: [] });
  assert.deepEqual(empty.health, {});
  assert.deepEqual(empty.weeks, {});
});

test('network errors clear their timers, successful checks release bodies, and hung requests abort', async () => {
  let failedSignal;
  const failed = await check('2026-10-19T04:17:00Z', {}, { timeoutMs: 5, fetchImpl: async (url, { signal }) => {
    failedSignal = signal;
    throw new Error('DNS failure', { cause: { code: 'ENOTFOUND' } });
  } });
  assert.equal(failed.failing[0].err, 'ENOTFOUND');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(failedSignal.aborted, false, 'a failed request left its timeout active');

  let cancelled = false;
  const healthy = await check('2026-10-19T04:17:00Z', {}, { fetchImpl: async () => new Response(
    new ReadableStream({ cancel() { cancelled = true; } }),
  ) });
  assert.equal(cancelled, true);
  assert.deepEqual(healthy.health, {});

  const hung = await check('2026-10-19T04:17:00Z', {}, { timeoutMs: 5, fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  assert.equal(hung.failing[0].err, 'AbortError');
});

test('CLI preserves listings on rerun, delists only in the third week and removes obsolete reports', async (t) => {
  const { mkdtemp, cp, writeFile, readFile, mkdir, rm, access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const root = await mkdtemp(join(tmpdir(), 'registry-liveness-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'listings'));
  await cp(new URL('./check-liveness.mjs', import.meta.url), join(root, 'scripts/check-liveness.mjs'));
  await writeFile(join(root, 'site.config.json'), JSON.stringify({ base }));
  const source = join(root, 'listings/fixture.json');
  await writeFile(source, JSON.stringify(listing));
  await writeFile(join(root, 'fetch.mjs'), `
    const OriginalDate = Date;
    globalThis.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [process.env.TEST_DATE])); }
    };
    globalThis.fetch = async () => new Response('fixture', { status: Number(process.env.TEST_STATUS || 404) });
  `);
  const run = (date, status = 404) => {
    const result = spawnSync(process.execPath, ['--import', join(root, 'fetch.mjs'), join(root, 'scripts/check-liveness.mjs')], {
      env: { ...process.env, TEST_DATE: date, TEST_STATUS: String(status), GITHUB_OUTPUT: join(root, 'output') }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  run('2026-10-19T04:17:00Z');
  run('2026-10-21T12:00:00Z');
  assert.equal(JSON.parse(await readFile(join(root, 'health.json'), 'utf8')).fixture, 1);
  run('2026-10-26T04:17:00Z');
  run('2026-10-26T05:00:00Z');
  await access(source);
  assert.equal(JSON.parse(await readFile(join(root, 'health.json'), 'utf8')).fixture, 2);
  assert.match(await readFile(join(root, 'health-report.md'), 'utf8'), /strike 2\/3/);
  run('2026-11-02T04:17:00Z');
  await assert.rejects(access(source), { code: 'ENOENT' });
  assert.match(await readFile(join(root, 'health-report.md'), 'utf8'), /Delisted/);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'health-weeks.json'), 'utf8')), {});
  run('2026-11-02T05:00:00Z');
  await assert.rejects(access(join(root, 'health-report.md')), { code: 'ENOENT' });
  assert.match(await readFile(join(root, 'output'), 'utf8'), /report=false/);
});

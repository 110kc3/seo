import { test } from 'node:test';
import assert from 'node:assert/strict';
import { untestable, verdictFor, strideSlice, mergeMisses } from './probe-catalogs.mjs';

test('a URL nobody could fairly test is classed, not blamed', () => {
  assert.equal(untestable('https://{tenant_host}/mcp'), 'placeholder');
  assert.equal(untestable('https://{api_host}/api/dlp/mcp/{tenant_id}'), 'placeholder');
  assert.equal(untestable(''), 'empty');
  assert.equal(untestable(null), 'empty');
  assert.equal(untestable('not a url'), 'unparseable');
  assert.equal(untestable('ftp://example.com/x'), 'non_http');

  assert.equal(untestable('https://example.com/mcp'), null);
  assert.equal(untestable('http://example.com/x?a=1&b=2'), null);
});

test('answering counts, succeeding does not', () => {
  assert.equal(verdictFor(402).ok, true);
  assert.equal(verdictFor(401).ok, true);
  assert.equal(verdictFor(403).ok, true);
  assert.equal(verdictFor(404).ok, true);
  assert.equal(verdictFor(200).ok, true);
  assert.equal(verdictFor(301).ok, true);

  assert.equal(verdictFor(500).ok, false);
  assert.equal(verdictFor(502).ok, false);
  assert.equal(verdictFor(503).ok, false);
  assert.match(verdictFor(503).reason, /503/);
});

test('a sample is spread across the catalog, not taken from one neighbourhood', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => i);
  const { picked, stride } = strideSlice(rows, 0, 100);

  assert.equal(picked.length, 100);
  assert.equal(stride, 10);
  assert.ok(Math.max(...picked.map((p) => p.index)) > 900, 'sample never reaches the tail');
  assert.ok(Math.min(...picked.map((p) => p.index)) < 100, 'sample never reaches the head');
});

test('a run never probes the same row twice', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => i);
  const { picked } = strideSlice(rows, 0, 100);
  assert.equal(new Set(picked.map((p) => p.index)).size, picked.length);
});

test('consecutive runs cover every row exactly once', () => {
  const rows = Array.from({ length: 200 }, (_, i) => i);
  const seen = [];
  let cursor = 0;
  const first = strideSlice(rows, cursor, 20);
  for (let run = 0; run < first.stride; run += 1) {
    const { picked, nextCursor } = strideSlice(rows, cursor, 20);
    seen.push(...picked.map((p) => p.index));
    cursor = nextCursor;
  }
  assert.equal(new Set(seen).size, rows.length, 'a full pass missed rows');
  assert.equal(seen.length, rows.length, 'a full pass probed something twice');
  assert.equal(cursor, 0, 'the cursor did not return to the start of the cycle');
});

test('sampling degenerates safely on tiny or empty catalogs', () => {
  assert.deepEqual(strideSlice([], 0, 50), { picked: [], nextCursor: 0, stride: 1 });

  const rows = [1, 2, 3];
  const { picked, stride } = strideSlice(rows, 0, 50);
  assert.equal(stride, 1);
  assert.deepEqual(picked.map((p) => p.index), [0, 1, 2], 'a small catalog should be probed whole');
});


const live = (...urls) => new Set(urls);

test('a first miss is recorded but not yet a death', () => {
  const merged = mergeMisses([], [{ url: 'https://a.example', result: { class: 'unreachable', reason: 'timeout' } }],
    '2026-08-01', live('https://a.example'));

  assert.equal(merged.length, 1);
  assert.equal(merged[0].misses, 1);
  assert.equal(merged[0].since, '2026-08-01');
});

test('misses accumulate across runs and keep the date of the first one', () => {
  const prev = [{ url: 'https://a.example', reason: 'timeout', misses: 1, since: '2026-07-25', last_checked: '2026-07-25' }];
  const merged = mergeMisses(prev, [{ url: 'https://a.example', result: { class: 'unreachable', reason: 'HTTP 502' } }],
    '2026-08-01', live('https://a.example'));

  assert.equal(merged[0].misses, 2);
  assert.equal(merged[0].since, '2026-07-25', 'the first failure date was overwritten');
  assert.equal(merged[0].last_checked, '2026-08-01');
  assert.equal(merged[0].reason, 'HTTP 502', 'the latest reason should win');
});

test('an endpoint that comes back is forgiven outright', () => {
  const prev = [{ url: 'https://a.example', reason: 'timeout', misses: 3, since: '2026-07-01', last_checked: '2026-07-25' }];
  const merged = mergeMisses(prev, [{ url: 'https://a.example', result: { class: 'ok', status: 402 } }],
    '2026-08-01', live('https://a.example'));

  assert.deepEqual(merged, []);
});

test('an entry that became untestable is dropped rather than counted against', () => {
  const prev = [{ url: 'https://{h}/mcp', reason: 'timeout', misses: 1, since: '2026-07-25', last_checked: '2026-07-25' }];
  const merged = mergeMisses(prev, [{ url: 'https://{h}/mcp', result: { class: 'untestable', reason: 'placeholder' } }],
    '2026-08-01', live('https://{h}/mcp'));

  assert.deepEqual(merged, []);
});

test('entries the catalog no longer carries are forgotten', () => {
  const prev = [
    { url: 'https://gone.example', reason: 'timeout', misses: 2, since: '2026-07-01', last_checked: '2026-07-25' },
    { url: 'https://still.example', reason: 'timeout', misses: 1, since: '2026-07-25', last_checked: '2026-07-25' },
  ];
  const merged = mergeMisses(prev, [], '2026-08-01', live('https://still.example'));

  assert.deepEqual(merged.map((e) => e.url), ['https://still.example']);
});

test('an unprobed entry keeps its record rather than being reset', () => {
  const prev = [{ url: 'https://a.example', reason: 'timeout', misses: 2, since: '2026-07-01', last_checked: '2026-07-25' }];
  const merged = mergeMisses(prev, [], '2026-08-01', live('https://a.example'));

  assert.equal(merged[0].misses, 2);
  assert.equal(merged[0].last_checked, '2026-07-25', 'an unprobed entry was marked as checked');
});

test('the most-missed entries sort first, so truncation keeps the real deaths', () => {
  const prev = [
    { url: 'https://one.example', reason: 'x', misses: 1, since: '2026-07-25', last_checked: '2026-07-25' },
    { url: 'https://five.example', reason: 'x', misses: 5, since: '2026-06-01', last_checked: '2026-07-25' },
    { url: 'https://three.example', reason: 'x', misses: 3, since: '2026-07-01', last_checked: '2026-07-25' },
  ];
  const merged = mergeMisses(prev, [], '2026-08-01',
    live('https://one.example', 'https://five.example', 'https://three.example'));

  assert.deepEqual(merged.map((e) => e.misses), [5, 3, 1]);
});

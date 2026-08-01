// The probe's judgement calls, tested without touching the network.
//
// Everything worth getting wrong here is pure: what counts as an answer, what
// counts as untestable, which rows a run samples, and how a miss ages into a
// confirmed death. The fetching itself is a loop around those decisions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { untestable, verdictFor, strideSlice, mergeMisses } from './probe-catalogs.mjs';

test('a URL nobody could fairly test is classed, not blamed', () => {
  // The MCP registry is full of templates a publisher never filled in. Calling
  // these dead would blame an endpoint for a registry data-quality problem.
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
  // A 402 is the correct reply from a paid endpoint and a 401 is correct from a
  // server wanting credentials. Both prove something is listening, which is the
  // only question being asked. Treating them as failures would mark the entire
  // point of an x402 catalog as dead.
  assert.equal(verdictFor(402).ok, true);
  assert.equal(verdictFor(401).ok, true);
  assert.equal(verdictFor(403).ok, true);
  assert.equal(verdictFor(404).ok, true);
  assert.equal(verdictFor(200).ok, true);
  assert.equal(verdictFor(301).ok, true);

  // Only the server admitting it is broken counts against it.
  assert.equal(verdictFor(500).ok, false);
  assert.equal(verdictFor(502).ok, false);
  assert.equal(verdictFor(503).ok, false);
  assert.match(verdictFor(503).reason, /503/);
});

test('a sample is spread across the catalog, not taken from one neighbourhood', () => {
  // This is the bug the first real run caught: placeholder URLs are 1.6% of the
  // MCP catalog but were 54% of its first 120 rows, because the file is sorted
  // and anything correlated with that order clusters. A contiguous window
  // measures the cluster.
  const rows = Array.from({ length: 1000 }, (_, i) => i);
  const { picked, stride } = strideSlice(rows, 0, 100);

  assert.equal(picked.length, 100);
  assert.equal(stride, 10);
  // Spread means the sample reaches both ends, not just the front.
  assert.ok(Math.max(...picked.map((p) => p.index)) > 900, 'sample never reaches the tail');
  assert.ok(Math.min(...picked.map((p) => p.index)) < 100, 'sample never reaches the head');
});

test('a run never probes the same row twice', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => i);
  const { picked } = strideSlice(rows, 0, 100);
  assert.equal(new Set(picked.map((p) => p.index)).size, picked.length);
});

test('consecutive runs cover every row exactly once', () => {
  // The whole justification for sampling rather than probing everything: it is
  // cheap *and* complete, just spread over time. If that were not true, the
  // aggregate would be a permanent guess about an unvisited majority.
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

// --- how a miss becomes a death ---------------------------------------------

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
  // A recovery is as real as a failure. Keeping a grudge would slowly fill the
  // list with endpoints that work.
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
  // The catalogs are refetched weekly. Without this the miss list would
  // outlive its own subject and grow forever.
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

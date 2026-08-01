// Does anything actually answer at these URLs?
//
// The two catalogs are mirrors of upstream registries, and neither upstream
// checks. The x402 Bazaar keeps an entry for 30 days after its last settlement;
// the MCP registry lists whatever a publisher declared. So an unknown share of
// the ~24,700 catalogued endpoints are dead, and "which ones actually answer"
// is a question nobody can answer today — which is exactly why it is worth
// answering here.
//
// --- the four choices, made deliberately ------------------------------------
//
// 1. A ROTATING SLICE, not the whole catalog. 24,700 probes weekly is rude to
//    other people's servers and slow here. SLICE per catalog per run, advancing
//    a cursor that wraps, so coverage accumulates and every entry is eventually
//    reached without any single run being expensive.
//
// 2. RESULTS ARE COMMITTED, in api/<catalog>/health.json — the same rule the
//    rest of this repo follows: state that must survive a workflow run lives in
//    the repo. It also means the answer is published rather than internal: the
//    file is a static asset, so anyone can read our liveness data the same way
//    they read the catalog.
//
// 3. DEAD ENTRIES ARE FLAGGED, NEVER HIDDEN. A single failed probe is not proof
//    of death — it is proof of one bad moment on one network path. Hiding on
//    that evidence would delete working endpoints from search. An entry is only
//    called dead after MIN_MISSES consecutive failures, and even then it still
//    appears in results, carrying `unreachable`. The caller decides.
//
// 4. "ANSWERS" MEANS ANSWERS, NOT SUCCEEDS. A 402 is the *correct* reply from a
//    paid x402 endpoint and a 401 is correct from an MCP server that wants
//    credentials. Both prove something is listening, which is the question. Only
//    a transport failure or a 5xx counts against an endpoint.
//
// Placeholder URLs get their own class. The MCP registry is full of entries
// like `https://{tenant_host}/mcp`, which are templates a publisher never
// filled in. Counting those as dead would blame the endpoint for a registry
// data-quality problem, and counting them as alive would be a lie.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const BASE = cfg.base.replace(/\/+$/, '');

const SLICE = Number(process.env.PROBE_SLICE ?? 600);
const CONCURRENCY = Number(process.env.PROBE_CONCURRENCY ?? 16);
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 8000);
// Two strikes. One is noise; requiring three would take three weeks to notice a
// dead host, by which time the catalog has been refreshed twice anyway.
const MIN_MISSES = 2;
// The stored miss list is bounded so a bad week cannot commit a megabyte. When
// it truncates it says so in the file — a silent cap would read as "only this
// many are dead", which is the opposite of true.
const MAX_TRACKED = 5000;

const CATALOGS = {
  x402: { dir: 'api/x402', source: 'Coinbase CDP x402 Bazaar' },
  mcp: { dir: 'api/mcp', source: 'Official MCP Registry' },
};

const UA = `ai-product-index-liveness (+${BASE}; weekly rotating sample, one request per endpoint)`;

/** A URL we cannot fairly test: unfilled template, or not an absolute http(s) URL. */
export function untestable(url) {
  if (typeof url !== 'string' || !url) return 'empty';
  if (/[{}]/.test(url)) return 'placeholder';
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'unparseable';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'non_http';
  return null;
}

/**
 * Alive means something answered. Anything that speaks HTTP is listening, even
 * to refuse us — 402 and 401 are the *expected* replies here.
 */
export function verdictFor(status) {
  if (status >= 500) return { ok: false, reason: `HTTP ${status}` };
  return { ok: true };
}

async function probe(url) {
  const bad = untestable(url);
  if (bad) return { class: 'untestable', reason: bad };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    // HEAD first — it is the cheapest thing we can ask of someone else's
    // server. Plenty of hosts refuse it, so a refusal falls through to GET
    // rather than being recorded as a fault of the endpoint.
    let resp = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA } });
    if (resp.status === 405 || resp.status === 501 || resp.status === 403) {
      resp = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA } });
    }
    const v = verdictFor(resp.status);
    return v.ok
      ? { class: 'ok', status: resp.status }
      : { class: 'unreachable', reason: v.reason };
  } catch (e) {
    const reason = e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : (e.cause?.code ?? e.name ?? 'fetch failed');
    return { class: 'unreachable', reason };
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, worker, size) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  }));
  return out;
}

/**
 * A sample spread across the whole catalog, not a contiguous window.
 *
 * The first draft took rows[cursor..cursor+size] and it was wrong, which the
 * first real run showed: placeholder URLs are 1.6% of the MCP catalog overall
 * but were 54% of the first 120 rows. These files are sorted, so anything that
 * correlates with the sort order clusters, and a contiguous window's statistics
 * describe the cluster rather than the catalog. Coverage was fine; the weekly
 * number would have swung wildly for no real reason.
 *
 * So: take every `stride`-th row, and advance the cursor by one each run.
 * Every window is spread evenly across the whole catalog, and after `stride`
 * runs every single row has been probed exactly once.
 */
export function strideSlice(rows, cursor, size) {
  if (!rows.length) return { picked: [], nextCursor: 0, stride: 1 };
  const n = Math.min(size, rows.length);
  const stride = Math.max(1, Math.floor(rows.length / n));
  const start = ((cursor % stride) + stride) % stride;
  const picked = [];
  for (let i = 0; i < n; i += 1) {
    const index = (start + i * stride) % rows.length;
    picked.push({ row: rows[index], index });
  }
  return { picked, nextCursor: (start + 1) % stride, stride };
}

/**
 * Fold this run's results into the previous file. Entries that were not probed
 * this run keep their record; entries that answered are forgiven outright,
 * because a recovery is as real as a failure and a stale grudge would slowly
 * fill the list with endpoints that came back.
 */
export function mergeMisses(previous, probed, today, liveUrls) {
  const byUrl = new Map();
  for (const e of previous) if (liveUrls.has(e.url)) byUrl.set(e.url, { ...e });

  for (const { url, result } of probed) {
    if (result.class === 'ok' || result.class === 'untestable') {
      byUrl.delete(url);
      continue;
    }
    const prior = byUrl.get(url);
    byUrl.set(url, {
      url,
      reason: result.reason,
      misses: (prior?.misses ?? 0) + 1,
      since: prior?.since ?? today,
      last_checked: today,
    });
  }

  // Most-missed first, then oldest failure — the entries most likely to be
  // genuinely dead survive truncation.
  return [...byUrl.values()].sort((a, b) => b.misses - a.misses || a.since.localeCompare(b.since) || a.url.localeCompare(b.url));
}

async function probeCatalog(key) {
  const spec = CATALOGS[key];
  const indexPath = join(ROOT, spec.dir, 'index.json');
  if (!existsSync(indexPath)) {
    console.log(`${key}: no index.json — skipping`);
    return null;
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const urlAt = index.fields.indexOf('url');
  if (urlAt < 0) throw new Error(`${key}: index.json has no url field`);

  const healthPath = join(ROOT, spec.dir, 'health.json');
  const prev = existsSync(healthPath) ? JSON.parse(readFileSync(healthPath, 'utf8')) : {};
  const { picked, nextCursor, stride } = strideSlice(index.rows, prev.cursor ?? 0, SLICE);

  const today = new Date().toISOString().slice(0, 10);
  const results = await pool(picked, async ({ row }) => ({ url: row[urlAt], result: await probe(row[urlAt]) }), CONCURRENCY);

  const window = { probed: results.length, ok: 0, unreachable: 0, untestable: 0 };
  for (const { result } of results) window[result.class] += 1;

  const liveUrls = new Set(index.rows.map((r) => r[urlAt]));
  const tracked = mergeMisses(prev.unreachable ?? [], results, today, liveUrls);
  const confirmed = tracked.filter((e) => e.misses >= MIN_MISSES);
  const truncated = Math.max(0, tracked.length - MAX_TRACKED);

  // Of what we could fairly test, what share answered.
  const testable = window.probed - window.untestable;
  const answered = testable > 0 ? Number((window.ok / testable).toFixed(4)) : null;

  const out = {
    $comment: `Liveness of a rotating sample of the ${key} catalog. Alive means the host answered at all — 402 and 401 are correct answers here, so only transport failures and 5xx count against an endpoint. Entries are flagged after ${MIN_MISSES} consecutive misses and never hidden from search.`,
    source: spec.source,
    probed_at: today,
    catalog_size: index.rows.length,
    cursor: nextCursor,
    slice: SLICE,
    // Every stride-th row, so one window is a spread sample rather than a
    // neighbourhood; full coverage takes this many runs.
    stride,
    runs_per_full_pass: stride,
    window,
    answered_share: answered,
    confirmed_unreachable: confirmed.length,
    tracked_unreachable: tracked.length,
    ...(truncated ? { truncated } : {}),
    unreachable: tracked.slice(0, MAX_TRACKED),
  };
  writeFileSync(healthPath, JSON.stringify(out, null, 2) + '\n');

  console.log(
    `${key}: probed ${window.probed} of ${index.rows.length} (cursor -> ${nextCursor}) — `
    + `${window.ok} answered, ${window.unreachable} did not, ${window.untestable} untestable`
    + (answered === null ? '' : ` (${(answered * 100).toFixed(1)}% of testable)`)
    + ` · ${confirmed.length} confirmed unreachable`
    + (truncated ? ` · ${truncated} beyond the ${MAX_TRACKED} cap not stored` : ''),
  );
  return out;
}

// Only when run as a program. The classification and bookkeeping above are
// pure and worth testing on their own; importing this file to test them must
// not fire 1,200 requests at other people's servers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv[2];
  const keys = only ? [only] : Object.keys(CATALOGS);
  for (const key of keys) {
    if (!CATALOGS[key]) throw new Error(`unknown catalog: ${key}`);
    await probeCatalog(key);
  }
  // Exit rather than fall off the end. Probing 1,200 hosts leaves that many idle
  // keep-alive sockets in undici's pool, and Node waits on them: the first full
  // run wrote both files and then sat there holding the process open. Every
  // result is already on disk by here, so there is nothing to flush and nothing
  // to lose — but in a weekly cron this is the difference between a job that
  // finishes and one that burns runner minutes until a timeout kills it.
  process.exit(0);
}

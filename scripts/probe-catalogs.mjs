import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const BASE = cfg.base.replace(/\/+$/, '');

const SLICE = Number(process.env.PROBE_SLICE ?? 600);
const CONCURRENCY = Number(process.env.PROBE_CONCURRENCY ?? 16);
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 8000);
const MIN_MISSES = 2;
const MAX_TRACKED = 5000;

const CATALOGS = {
  x402: { dir: 'api/x402', source: 'Coinbase CDP x402 Bazaar' },
  mcp: { dir: 'api/mcp', source: 'Official MCP Registry' },
};

const UA = `ai-product-index-liveness (+${BASE}; weekly rotating sample, one request per endpoint)`;

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

  const testable = window.probed - window.untestable;
  const answered = testable > 0 ? Number((window.ok / testable).toFixed(4)) : null;

  const out = {
    $comment: `Liveness of a rotating sample of the ${key} catalog. Alive means the host answered at all — 402 and 401 are correct answers here, so only transport failures and 5xx count against an endpoint. Entries are flagged after ${MIN_MISSES} consecutive misses and never hidden from search.`,
    source: spec.source,
    probed_at: today,
    catalog_size: index.rows.length,
    cursor: nextCursor,
    slice: SLICE,
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv[2];
  const keys = only ? [only] : Object.keys(CATALOGS);
  for (const key of keys) {
    if (!CATALOGS[key]) throw new Error(`unknown catalog: ${key}`);
    await probeCatalog(key);
  }
  process.exit(0);
}

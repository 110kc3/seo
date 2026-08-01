// Builds the x402 endpoint catalog from the Coinbase CDP Bazaar.
//
//   node scripts/fetch-x402-catalog.mjs
//
// Why mirror a catalog someone else already publishes: because the published
// one cannot be searched. The discovery API offers offset paging and nothing
// else — no query, no filter, no aggregate — so answering "is there an x402
// endpoint that does X, and what does it cost" means pulling all ~15k records
// and doing the work yourself. Every agent that wants to spend money on this
// rail hits that wall. This does the pull once, normalizes it, and serves the
// result through the same search / NLWeb / MCP surfaces as the registry.
//
// It is explicitly a mirror, and says so in the artifact it writes: source,
// fetch date and the upstream URL travel with the data. The value added is
// normalization, search and aggregates — not ownership of the underlying facts.
//
// Output is sorted by URL so a weekly refresh produces a small diff rather than
// rewriting 15k lines; that keeps this committable without bloating history.

import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DISCOVERY = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
const PAGE = 1000;
const MAX_PAGES = 60;

// CAIP-2 ids are unreadable and the v1 records use bare names for the same
// chains, so both are folded onto one label. Anything unrecognised keeps its
// raw id rather than being guessed at.
const CHAINS = {
  'eip155:8453': 'base',
  'eip155:84532': 'base-sepolia',
  'eip155:137': 'polygon',
  'eip155:42161': 'arbitrum',
  'eip155:10': 'optimism',
  'eip155:1': 'ethereum',
  'eip155:196': 'x-layer',
  'eip155:480': 'worldchain',
  'eip155:4801': 'worldchain-sepolia',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'solana',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': 'solana-devnet',
  'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=': 'algorand',
  base: 'base',
  'base-sepolia': 'base-sepolia',
  solana: 'solana',
  'solana-devnet': 'solana-devnet',
};

// Only assets whose decimals are known can be priced. Guessing 6 for an
// unknown token would print a number that is wrong by orders of magnitude,
// which is worse than printing nothing.
const ASSETS = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
  '0x036cbd53842c5426634e7929541ec2318f3dcf7e': { symbol: 'USDC', decimals: 6 },
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': { symbol: 'USDC', decimals: 6 },
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { symbol: 'USDC', decimals: 6 },
  epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v: { symbol: 'USDC', decimals: 6 },
};

async function page(offset) {
  const resp = await fetch(`${DISCOVERY}?limit=${PAGE}&offset=${offset}`, {
    headers: { accept: 'application/json', 'user-agent': 'ai-product-index-catalog' },
  });
  if (!resp.ok) throw new Error(`discovery HTTP ${resp.status} at offset ${offset}`);
  return resp.json();
}

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function normalize(record) {
  const accept = record.accepts?.[0] ?? {};
  let host = '';
  try {
    host = new URL(record.resource).host;
  } catch {
    return null; // a resource that is not a URL cannot be called, so it is not an endpoint
  }

  const atomic = accept.maxAmountRequired ?? accept.amount ?? null;
  const asset = String(accept.asset ?? '').toLowerCase();
  const known = ASSETS[asset];
  const price = known && atomic && /^\d+$/.test(String(atomic))
    ? Number(atomic) / 10 ** known.decimals
    : null;

  const info = record.extensions?.bazaar?.info ?? {};
  const method = clean(info.input?.method ?? accept.outputSchema?.input?.method ?? '', 8).toUpperCase();

  return {
    url: record.resource,
    host,
    description: clean(record.description ?? accept.description ?? '', 400),
    method: method || null,
    chain: CHAINS[accept.network] ?? accept.network ?? null,
    price,
    price_atomic: atomic ?? null,
    asset: known?.symbol ?? (accept.asset ?? null),
    pay_to: accept.payTo ?? null,
    x402_version: record.x402Version ?? null,
    updated: record.lastUpdated ?? null,
  };
}

// --- fetch ------------------------------------------------------------------

const raw = [];
let reported = null;
for (let i = 0; i < MAX_PAGES; i += 1) {
  const body = await page(i * PAGE);
  const batch = body.items ?? [];
  reported = body.pagination?.total ?? reported;
  raw.push(...batch);
  process.stderr.write(`\rfetched ${raw.length}${reported ? `/${reported}` : ''}`);
  if (batch.length < PAGE) break;
}
process.stderr.write('\n');

// The upstream can serve the same resource twice across pages if it is written
// to while we page. Last write wins, keyed on the URL.
const byUrl = new Map();
let skipped = 0;
for (const record of raw) {
  const entry = normalize(record);
  if (!entry) { skipped += 1; continue; }
  byUrl.set(entry.url, entry);
}

const endpoints = [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));

// --- aggregates -------------------------------------------------------------
// These are the numbers nobody publishes about this ecosystem, and they are the
// reason to keep the mirror rather than proxy the upstream per query.

const tally = (values) => {
  const counts = new Map();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

const priced = endpoints.map((e) => e.price).filter((p) => typeof p === 'number' && p > 0).sort((a, b) => a - b);
const at = (q) => (priced.length ? priced[Math.min(priced.length - 1, Math.floor(priced.length * q))] : null);
const hosts = tally(endpoints.map((e) => e.host));

const stats = {
  source: 'Coinbase CDP x402 Bazaar',
  source_url: DISCOVERY,
  fetched: new Date().toISOString().slice(0, 10),
  endpoints: endpoints.length,
  hosts: hosts.length,
  // The single most useful fact about this ecosystem, and the one the raw
  // catalog hides: it is far more concentrated than its endpoint count implies.
  concentration: {
    top_10_hosts_share: hosts.length
      ? Number((hosts.slice(0, 10).reduce((n, [, c]) => n + c, 0) / endpoints.length).toFixed(3))
      : 0,
    note: 'A handful of operators publish thousands of endpoints each, so the endpoint count overstates the number of distinct services.',
  },
  by_chain: Object.fromEntries(tally(endpoints.map((e) => e.chain))),
  by_version: Object.fromEntries(tally(endpoints.map((e) => e.x402_version))),
  by_method: Object.fromEntries(tally(endpoints.map((e) => e.method))),
  price_usd: {
    priced: priced.length,
    unpriced: endpoints.length - priced.length,
    min: priced[0] ?? null,
    p50: at(0.5),
    p90: at(0.9),
    max: priced.at(-1) ?? null,
  },
  top_hosts: hosts.slice(0, 25).map(([host, count]) => ({ host, endpoints: count })),
};

mkdirSync(join(ROOT, 'api', 'x402'), { recursive: true });
writeFileSync(join(ROOT, 'api', 'x402', 'catalog.json'), `${JSON.stringify({
  $comment: 'A normalized mirror of the Coinbase CDP x402 Bazaar, republished so it can be searched. The facts belong to the endpoint operators; the normalization, search and aggregates are the contribution. Refreshed weekly; report a wrong or unwanted entry at https://github.com/110kc3/seo/issues and it will be removed.',
  source: stats.source,
  source_url: DISCOVERY,
  fetched: stats.fetched,
  count: endpoints.length,
  endpoints,
}, null, 1)}\n`);

writeFileSync(join(ROOT, 'api', 'x402', 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);

// The search index the Worker actually loads. Positional rows rather than
// objects: repeating eleven key names 14,661 times more than doubles the file,
// and this one is parsed on a request path. Descriptions are capped shorter
// here than in the catalog — this file has to answer a query, not archive the
// record — and the fields kept are exactly what a result needs to be useful,
// so a hit never requires a second fetch into the 8 MB catalog.
const INDEX_FIELDS = ['url', 'host', 'description', 'price', 'chain', 'method', 'x402_version'];
writeFileSync(join(ROOT, 'api', 'x402', 'index.json'), `${JSON.stringify({
  $comment: 'Compact search index over api/x402/catalog.json. rows are positional, keyed by `fields`.',
  fetched: stats.fetched,
  count: endpoints.length,
  fields: INDEX_FIELDS,
  rows: endpoints.map((e) => [e.url, e.host, clean(e.description, 200), e.price, e.chain, e.method, e.x402_version]),
})}\n`);

const mb = (p) => (statSync(join(ROOT, p)).size / 1048576).toFixed(1);
console.log(`x402 catalog: ${endpoints.length} endpoints across ${hosts.length} hosts`
  + `${skipped ? `, ${skipped} skipped (unusable resource URL)` : ''}`);
console.log(`  chains: ${Object.entries(stats.by_chain).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`  price:  min $${stats.price_usd.min} · p50 $${stats.price_usd.p50} · p90 $${stats.price_usd.p90} · max $${stats.price_usd.max}`);
console.log(`  top 10 hosts hold ${(stats.concentration.top_10_hosts_share * 100).toFixed(1)}% of all endpoints`);
console.log(`  wrote api/x402/catalog.json (${mb('api/x402/catalog.json')} MB) and index.json (${mb('api/x402/index.json')} MB)`);

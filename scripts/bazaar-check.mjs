// Are we in the x402 Bazaar yet?
//
//   node scripts/bazaar-check.mjs           # is this site listed?
//   node scripts/bazaar-check.mjs --sample  # what listed v1 entries look like
//
// The CDP facilitator catalogs an endpoint from the discovery metadata attached
// to a *settlement* — `outputSchema` on the v1 payment requirements, or
// `extensions.bazaar` on v2 — so a rail can settle real money for months and
// never be listed. Nothing in the 402 response says which is happening. This
// asks the catalog directly.
//
// Matching is on payTo, not on the URL: the receiving address is shared by
// every service on this rail, so one run answers for all of them, and it keeps
// working across a domain move.
//
// Zero dependencies; the discovery API needs no authentication to read.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveX402 } from './x402-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 1000;
const MAX_PAGES = 40; // ~40k resources; the catalog was 14.7k in Aug 2026

const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const rail = resolveX402(cfg);
if (!rail) {
  console.error('no x402 rail is configured — nothing could be listed');
  process.exit(2);
}

const discovery = `${rail.facilitator_url.replace(/\/+$/, '')}/discovery/resources`;
const payTo = rail.payTo.toLowerCase();
const host = new URL(cfg.base).host;

async function page(offset) {
  const resp = await fetch(`${discovery}?limit=${PAGE}&offset=${offset}`, {
    headers: { accept: 'application/json', 'user-agent': 'ai-product-index-bazaar-check' },
  });
  if (!resp.ok) throw new Error(`discovery HTTP ${resp.status}`);
  return resp.json();
}

const items = [];
let total = null;
for (let i = 0; i < MAX_PAGES; i += 1) {
  const body = await page(i * PAGE);
  const batch = body.items ?? [];
  total = body.pagination?.total ?? total;
  items.push(...batch);
  if (batch.length < PAGE) break;
}

console.log(`catalog:   ${items.length} resources read${total ? ` of ${total} reported` : ''} at ${discovery}`);

if (process.argv.includes('--sample')) {
  // What a listed v1 entry carries, which is the spec that matters — the docs
  // describe the SDK's helper, not the wire.
  const v1 = items.filter((r) => r.x402Version === 1);
  const flagged = v1.filter((r) => r.accepts?.[0]?.outputSchema?.input?.discoverable === true);
  console.log(`v1 entries: ${v1.length}, of which ${flagged.length} declare outputSchema.input.discoverable = true`);
  console.log(`\nexample listing:\n${JSON.stringify(flagged[0] ?? v1[0], null, 2).slice(0, 1600)}`);
  process.exit(0);
}

const ours = items.filter(
  (r) => r.accepts?.some((a) => String(a.payTo ?? '').toLowerCase() === payTo)
    || String(r.resource ?? '').includes(host),
);

if (!ours.length) {
  console.log(`\nNOT LISTED — nothing in the catalog pays ${rail.payTo} or lives on ${host}.`);
  console.log('\nThings to check, in the order they go wrong:');
  console.log('  1. Is the rail actually CDP? Only the CDP facilitator catalogs.');
  console.log(`     site.config.json → payments.x402.active is "${cfg.payments?.x402?.active}".`);
  console.log('  2. Does a 402 carry the metadata? It must survive to /settle:');
  console.log(`     curl -sX POST ${cfg.base.replace(/\/+$/, '')}/api/audit -d '{"url":"https://example.com"}' | jq .accepts[0].outputSchema`);
  console.log('  3. Has anything actually settled since the metadata was added?');
  console.log('     Verification alone is not enough — indexing happens on settle.');
  console.log('  4. If all three hold, it is CDP-side lag or a CDP-side bug');
  console.log('     (x402-foundation/x402#2112 reports the same with 8 settlements).');
  process.exit(1);
}

console.log(`\nLISTED — ${ours.length} resource(s):`);
for (const r of ours) {
  const a = r.accepts?.[0] ?? {};
  console.log(`  ${r.resource}`);
  console.log(`     x402 v${r.x402Version} · ${a.maxAmountRequired ?? a.amount} atomic · updated ${r.lastUpdated}`);
}

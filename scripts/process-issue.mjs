// The autonomous transaction behind [register], [update] and [upgrade] issues:
// parse, validate, authorize, dedup, liveness-check, write the listing file.
// All untrusted input arrives via env vars (never shell-interpolated).
// Writes result.md (gitignored) for the bot's issue comment and emits
// slug=/verb= to $GITHUB_OUTPUT. Exit 1 = rejected (result.md has the reasons).
import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, reconstruct, normalizeUrl, MAX_LISTINGS_PER_USER, SLUG_RE, PAID_TIERS } from './validate.mjs';
import { verifyReceipt, tierPriceAtomic, TX_RE } from './x402-receipt.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const BASE = cfg.base.replace(/\/+$/, '');
const OWNER = cfg.repo.split('/')[0];

const body = process.env.ISSUE_BODY ?? '';
const user = (process.env.ISSUE_USER ?? '').trim();
const title = process.env.ISSUE_TITLE ?? '[register]';
const MODE = title.startsWith('[update]') ? 'update' : title.startsWith('[upgrade]') ? 'upgrade' : 'register';

function reject(errors, code = 'invalid') {
  const payload = JSON.stringify({ ok: false, code, errors }, null, 2).replaceAll('```', "'''");
  writeFileSync(join(ROOT, 'result.md'), [
    `## ${MODE[0].toUpperCase() + MODE.slice(1)} rejected`,
    '',
    '````json',
    payload,
    '````',
    '',
    `Fix the errors and open a new \`[${MODE}]\` issue. Schema: ${BASE}/api/schema.json · protocol: ${BASE}/llms.txt`,
  ].join('\n') + '\n');
  console.error(`rejected (${code}): ${errors.join(' | ')}`);
  process.exit(1);
}

function output(kv) {
  if (process.env.GITHUB_OUTPUT) {
    for (const [k, v] of Object.entries(kv)) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  }
}

async function checkLiveness(url) {
  if (process.env.SKIP_LIVENESS === '1') return;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    const resp = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'user-agent': `ai-product-index-registry (+${BASE})` },
    });
    clearTimeout(timer);
    if (resp.status >= 400) reject([`url liveness check failed: HTTP ${resp.status} from ${url}`], 'url_dead');
  } catch (e) {
    reject([`url liveness check failed: ${e.cause?.code ?? e.name} fetching ${url}`], 'url_dead');
  }
}

if (!user) reject(['internal: missing ISSUE_USER'], 'internal');
if (Buffer.byteLength(body, 'utf8') > 20 * 1024) reject(['issue body larger than 20 KB'], 'too_large');

// Prefer a ```json fence (what the issue forms produce), fall back to any
// fence, then to the whole body (raw REST API submissions may skip the fence).
const fence = body.match(/```json\s*\n([\s\S]*?)```/i) ?? body.match(/```\s*\n([\s\S]*?)```/);
const raw = (fence ? fence[1] : body).trim();
if (!raw) reject(['no JSON found in issue body'], 'no_json');

let obj;
try {
  obj = JSON.parse(raw);
} catch (e) {
  reject([`invalid JSON: ${e.message.slice(0, 200)}`], 'bad_json');
}

const listingDir = join(ROOT, 'listings');
const today = new Date().toISOString().slice(0, 10);

function loadListing(slug) {
  return JSON.parse(readFileSync(join(listingDir, `${slug}.json`), 'utf8'));
}
function assertOwnership(existing) {
  if (user !== existing.github_user && user !== OWNER) {
    reject([`only @${existing.github_user} (the original submitter) can modify listing "${existing.slug}"`], 'not_owner');
  }
}
function safeTarget(slug) {
  const target = resolve(listingDir, `${slug}.json`);
  // Unreachable given SLUG_RE — defense in depth against path escape.
  if (!target.startsWith(resolve(listingDir) + sep)) reject(['internal: path escape blocked'], 'internal');
  return target;
}

// ---------------------------------------------------------------- upgrade --
// Body: {"slug": "...", "tier": "verified"|"featured", "rail": "x402"|"card", "receipt": {...}}
// x402 receipts are verified on chain (see scripts/x402-receipt.mjs for why the
// facilitator cannot serve this transport). Card payments have no automated
// rail — they are reconciled by hand with scripts/set-tier.mjs.
//
// Spent transaction hashes are recorded in the committed ledger so one payment
// cannot buy two upgrades. Same pattern as health.json: state that must survive
// a workflow run lives in the repo.
const LEDGER = join(ROOT, 'payments.json');

function loadLedger() {
  if (!existsSync(LEDGER)) return {};
  try {
    return JSON.parse(readFileSync(LEDGER, 'utf8'));
  } catch {
    return {};
  }
}

async function verifyPayment(rail, receipt, tier) {
  const p = cfg.payments ?? {};
  const x = p.x402 ?? {};

  if (!p.x402_address && !p.stripe_payment_link) {
    return { ok: false, code: 'payments_not_enabled', error: `tier upgrades are not purchasable yet — payment rails (x402, card) are planned; watch ${BASE}/llms.txt` };
  }
  if (rail === 'card') {
    return { ok: false, code: 'manual_reconciliation', error: `card payments are reconciled by hand — pay at ${p.stripe_payment_link || 'the published payment link'} and the tier is applied once the payment clears` };
  }
  if (rail !== 'x402') {
    return { ok: false, code: 'invalid', error: 'rail must be "x402" or "card"' };
  }
  if (!p.x402_address || !x.rpc_url || !x.asset) {
    return { ok: false, code: 'payments_not_enabled', error: `the x402 rail is not fully configured yet (needs a receiving address and a chain RPC); watch ${BASE}/llms.txt` };
  }

  const price = tierPriceAtomic(x, tier);
  if (!price) {
    return { ok: false, code: 'payments_not_enabled', error: `no published price for tier "${tier}"` };
  }
  if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) {
    return { ok: false, code: 'invalid', error: 'receipt must be an object like {"transaction": "0x..."}' };
  }

  const tx = String(receipt.transaction ?? '').toLowerCase();
  if (!TX_RE.test(tx)) {
    return { ok: false, code: 'invalid', error: 'receipt.transaction must be a 32-byte hex transaction hash' };
  }
  const spent = loadLedger()[tx];
  if (spent) {
    return { ok: false, code: 'receipt_already_used', error: `transaction ${tx} was already redeemed for listing "${spent.slug}" on ${spent.date}` };
  }

  const res = await verifyReceipt(x.rpc_url, {
    transaction: tx,
    asset: x.asset,
    payTo: p.x402_address,
    minAmount: price,
    minConfirmations: x.min_confirmations ?? 2,
  });
  if (!res.ok) return res;
  return { ok: true, tx, payer: res.payer, value: res.value };
}

if (MODE === 'upgrade') {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) reject(['payload must be a JSON object'], 'invalid');
  if (typeof obj.slug !== 'string' || !SLUG_RE.test(obj.slug)) reject(['slug: required, must match an existing listing'], 'invalid');
  if (!PAID_TIERS.includes(obj.tier)) reject([`tier: must be one of ${PAID_TIERS.join(', ')}`], 'invalid');
  const target = safeTarget(obj.slug);
  if (!existsSync(target)) reject([`no such listing: ${obj.slug}`], 'not_found');
  const existing = loadListing(obj.slug);
  assertOwnership(existing);
  const pay = await verifyPayment(obj.rail, obj.receipt, obj.tier);
  if (!pay.ok) reject([pay.error], pay.code);
  existing.tier = obj.tier;
  existing.updated = today;
  writeFileSync(target, JSON.stringify(existing, null, 2) + '\n');
  // Burn the receipt before the listing change is announced, so a retry of the
  // same transaction cannot buy a second upgrade.
  const ledger = loadLedger();
  ledger[pay.tx] = { slug: existing.slug, tier: existing.tier, date: today, payer: pay.payer, value: pay.value };
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
  writeFileSync(join(ROOT, 'result.md'), [
    '## Upgraded',
    '',
    `**${existing.name.replaceAll('`', "'")}** is now tier \`${existing.tier}\`.`,
    '',
    `- Listing page: ${BASE}/l/${existing.slug}.html`,
    `- Payment: \`${pay.tx}\` (${pay.value} atomic units)`,
  ].join('\n') + '\n');
  output({ slug: existing.slug, verb: 'Upgrade' });
  console.log(`upgraded: ${existing.slug} -> ${existing.tier}`);
  process.exit(0);
}

// ----------------------------------------------------- register / update --
const res = validate(obj);
if (!res.ok) reject(res.errors);

const target = safeTarget(obj.slug);
let server;

if (MODE === 'update') {
  if (!existsSync(target)) reject([`no such listing: ${obj.slug} — use [register] for new listings`], 'not_found');
  const existing = loadListing(obj.slug);
  assertOwnership(existing);
  // created/github_user/tier survive updates; only content fields change.
  server = { created: existing.created, github_user: existing.github_user, tier: existing.tier, updated: today };
} else {
  if (existsSync(target)) reject([`slug already registered: ${obj.slug}`], 'duplicate');
  server = { created: today, github_user: user };
}

// URL uniqueness (excluding the listing being updated) + per-account cap.
const wanted = normalizeUrl(obj.url);
let mine = 0;
for (const f of readdirSync(listingDir).filter((n) => n.endsWith('.json'))) {
  const existing = JSON.parse(readFileSync(join(listingDir, f), 'utf8'));
  if (existing.slug === obj.slug && MODE === 'update') continue;
  if (normalizeUrl(existing.url) === wanted) reject([`url already registered under slug: ${existing.slug}`], 'duplicate');
  if (existing.github_user === user) mine += 1;
}
if (MODE === 'register' && mine >= MAX_LISTINGS_PER_USER) {
  reject([`account ${user} already has ${mine} listings (max ${MAX_LISTINGS_PER_USER})`], 'account_cap');
}

await checkLiveness(obj.url);

const listing = reconstruct(obj, server);
writeFileSync(target, JSON.stringify(listing, null, 2) + '\n');

const html = `${BASE}/l/${listing.slug}.html`;
const json = `${BASE}/listings/${listing.slug}.json`;
writeFileSync(join(ROOT, 'result.md'), [
  MODE === 'update' ? '## Updated' : '## Registered',
  '',
  `**${listing.name.replaceAll('`', "'")}** is ${MODE === 'update' ? 'updated in' : 'now in'} the AI Product Index.`,
  '',
  `- Listing page: ${html}`,
  `- Listing JSON: ${json}`,
  `- Registry: ${BASE}/api/index.json`,
  '',
  'The site redeploys within about a minute of this comment.',
  '',
  '````json',
  JSON.stringify({ ok: true, slug: listing.slug, html, json }, null, 2),
  '````',
].join('\n') + '\n');
output({ slug: listing.slug, verb: MODE === 'update' ? 'Update' : 'Add' });
console.log(`${MODE === 'update' ? 'updated' : 'accepted'}: ${listing.slug}`);

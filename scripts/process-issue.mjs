// The autonomous "purchase" transaction: parses a [register] issue, validates,
// dedups, liveness-checks the product URL and writes the listing file.
// All untrusted input arrives via env vars (never shell-interpolated).
// Writes result.md (gitignored) for the bot's issue comment and emits
// slug=<slug> to $GITHUB_OUTPUT. Exit 1 = rejected (result.md has the reasons).
import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, reconstruct, normalizeUrl, MAX_LISTINGS_PER_USER } from './validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const BASE = cfg.base.replace(/\/+$/, '');

const body = process.env.ISSUE_BODY ?? '';
const user = (process.env.ISSUE_USER ?? '').trim();

function reject(errors) {
  const payload = JSON.stringify({ ok: false, errors }, null, 2).replaceAll('```', "'''");
  writeFileSync(join(ROOT, 'result.md'), [
    '## Registration rejected',
    '',
    '````json',
    payload,
    '````',
    '',
    `Fix the errors and open a new \`[register]\` issue. Schema: ${BASE}/api/schema.json · protocol: ${BASE}/llms.txt`,
  ].join('\n') + '\n');
  console.error(`rejected: ${errors.join(' | ')}`);
  process.exit(1);
}

if (!user) reject(['internal: missing ISSUE_USER']);
if (Buffer.byteLength(body, 'utf8') > 20 * 1024) reject(['issue body larger than 20 KB']);

// Prefer a ```json fence (what the issue form produces), fall back to any
// fence, then to the whole body (raw REST API submissions may skip the fence).
const fence = body.match(/```json\s*\n([\s\S]*?)```/i) ?? body.match(/```\s*\n([\s\S]*?)```/);
const raw = (fence ? fence[1] : body).trim();
if (!raw) reject(['no JSON found in issue body']);

let obj;
try {
  obj = JSON.parse(raw);
} catch (e) {
  reject([`invalid JSON: ${e.message.slice(0, 200)}`]);
}

const res = validate(obj);
if (!res.ok) reject(res.errors);

// Uniqueness + per-account cap against the current registry.
const listingDir = join(ROOT, 'listings');
const target = resolve(listingDir, `${obj.slug}.json`);
// Unreachable given SLUG_RE — defense in depth against path escape.
if (!target.startsWith(resolve(listingDir) + sep)) reject(['internal: path escape blocked']);
if (existsSync(target)) reject([`slug already registered: ${obj.slug}`]);
const wanted = normalizeUrl(obj.url);
let mine = 0;
for (const f of readdirSync(listingDir).filter((n) => n.endsWith('.json'))) {
  const existing = JSON.parse(readFileSync(join(listingDir, f), 'utf8'));
  if (normalizeUrl(existing.url) === wanted) reject([`url already registered under slug: ${existing.slug}`]);
  if (existing.github_user === user) mine += 1;
}
if (mine >= MAX_LISTINGS_PER_USER) reject([`account ${user} already has ${mine} listings (max ${MAX_LISTINGS_PER_USER})`]);

// Liveness: the product URL must respond < 400 within 10 s.
if (process.env.SKIP_LIVENESS !== '1') {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    const resp = await fetch(obj.url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'user-agent': `ai-product-index-registry (+${BASE})` },
    });
    clearTimeout(timer);
    if (resp.status >= 400) reject([`url liveness check failed: HTTP ${resp.status} from ${obj.url}`]);
  } catch (e) {
    reject([`url liveness check failed: ${e.cause?.code ?? e.name} fetching ${obj.url}`]);
  }
}

const created = new Date().toISOString().slice(0, 10);
const listing = reconstruct(obj, { created, github_user: user });
writeFileSync(target, JSON.stringify(listing, null, 2) + '\n');

const html = `${BASE}/l/${listing.slug}.html`;
const json = `${BASE}/listings/${listing.slug}.json`;
writeFileSync(join(ROOT, 'result.md'), [
  '## Registered',
  '',
  `**${listing.name.replaceAll('`', "'")}** is now in the AI Product Index.`,
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
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `slug=${listing.slug}\n`);
console.log(`accepted: ${listing.slug}`);

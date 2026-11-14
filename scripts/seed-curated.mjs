
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validate } from './validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = Number(process.argv[process.argv.indexOf('--limit') + 1]) || 30;
const DRY = process.argv.includes('--dry-run');

const PAYWORDS = /\b(x402|pay-per-call|paid|payment|usdc|subscription|pricing|per call|credits?)\b/i;
const REVERSE_DNS = /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i;
const TODAY = new Date().toISOString().slice(0, 10);

const slugify = (s) => s.toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48)
  .replace(/-+$/, '');

async function alive(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const resp = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': 'ai-product-index-curator' } });
    return resp.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const catalogPath = join(ROOT, 'api', 'mcp', 'catalog.json');
if (!existsSync(catalogPath)) {
  console.error('api/mcp/catalog.json is missing — run scripts/fetch-mcp-catalog.mjs first');
  process.exit(2);
}
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

const existing = new Set(readdirSync(join(ROOT, 'listings')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
const existingUrls = new Set(
  readdirSync(join(ROOT, 'listings')).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(ROOT, 'listings', f), 'utf8')).url.replace(/\/+$/, '')),
);

const seenHost = new Set();
const seenPublisher = new Set();
const candidates = [];
for (const s of catalog.servers) {
  if (s.auth !== 'none' || s.transport !== 'streamable-http') continue;
  if (!s.description || s.description.length < 90) continue;
  if (PAYWORDS.test(s.description)) continue;
  if (!s.title || REVERSE_DNS.test(s.title)) continue;
  const product = s.website ?? s.repository;
  if (!product) continue;
  if (seenHost.has(s.host)) continue;
  const publisher = String(s.name ?? '').split('/')[0].toLowerCase();
  if (publisher && seenPublisher.has(publisher)) continue;
  seenHost.add(s.host);
  if (publisher) seenPublisher.add(publisher);
  candidates.push({ ...s, product });
}
candidates.sort((a, b) => b.description.length - a.description.length);

console.log(`${catalog.servers.length} catalogued → ${candidates.length} meet the curation rules`);

const written = [];
const skipped = { slug: 0, duplicate: 0, dead: 0, invalid: 0 };
for (const c of candidates) {
  if (written.length >= LIMIT) break;

  const slug = slugify(c.title);
  if (slug.length < 3) { skipped.slug += 1; continue; }
  if (existing.has(slug)) { skipped.duplicate += 1; continue; }
  if (existingUrls.has(c.product.replace(/\/+$/, ''))) { skipped.duplicate += 1; continue; }

  if (!(await alive(c.product))) { skipped.dead += 1; continue; }

  const listing = {
    slug,
    name: c.title.slice(0, 80),
    url: c.product,
    description: c.description,
    category: 'mcp',
    pricing: 'free',
    machine_endpoints: { mcp: c.url },
    tags: ['mcp', 'remote'],
    submitted_by: 'registry (curated)',
    created: TODAY,
    github_user: '110kc3',
    tier: 'free',
    origin: 'curated',
  };

  const result = validate(listing);
  if (result.errors?.length) {
    skipped.invalid += 1;
    console.log(`  invalid ${slug}: ${result.errors.join('; ')}`);
    continue;
  }

  existing.add(slug);
  existingUrls.add(listing.url.replace(/\/+$/, ''));
  written.push(listing);
  if (!DRY) writeFileSync(join(ROOT, 'listings', `${slug}.json`), `${JSON.stringify(listing, null, 2)}\n`);
  console.log(`  ${DRY ? 'would add' : 'added'} ${slug} — ${listing.name}`);
}

console.log(`\n${DRY ? 'would write' : 'wrote'} ${written.length} listing(s)`);
console.log(`skipped: ${skipped.duplicate} already listed · ${skipped.dead} URL not answering · ${skipped.slug} unusable slug · ${skipped.invalid} failed validation`);
if (!DRY) console.log('run `node scripts/build.mjs` to publish them');

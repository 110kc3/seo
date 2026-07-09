// Manual tier flip for the repo owner (e.g. after an out-of-band card payment):
//   node scripts/set-tier.mjs <slug> <free|verified|featured>
// Edits the listing, stamps `updated`, and rebuilds. Commit + push afterwards.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { TIERS, SLUG_RE } from './validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [slug, tier] = process.argv.slice(2);
if (!slug || !SLUG_RE.test(slug) || !TIERS.includes(tier)) {
  console.error(`usage: node scripts/set-tier.mjs <slug> <${TIERS.join('|')}>`);
  process.exit(2);
}
const file = join(ROOT, 'listings', `${slug}.json`);
if (!existsSync(file)) {
  console.error(`no such listing: ${slug}`);
  process.exit(1);
}
const listing = JSON.parse(readFileSync(file, 'utf8'));
listing.tier = tier;
listing.updated = new Date().toISOString().slice(0, 10);
writeFileSync(file, JSON.stringify(listing, null, 2) + '\n');
execFileSync('node', [join(ROOT, 'scripts', 'build.mjs')], { stdio: 'inherit' });
console.log(`${slug} -> tier: ${tier} (rebuilt; now commit + push)`);

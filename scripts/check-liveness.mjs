// Weekly registry hygiene: re-check every listing's URL. A listing is
// delisted after 3 consecutive failed weekly checks (state in health.json,
// committed for transparency; healthy listings are absent from it).
// Writes health-report.md (gitignored) when anything failed or was delisted,
// and emits changed=/report= to $GITHUB_OUTPUT for the workflow.
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const BASE = cfg.base.replace(/\/+$/, '');
const MAX_STRIKES = 3;

const listingDir = join(ROOT, 'listings');
const healthFile = join(ROOT, 'health.json');
const oldHealth = existsSync(healthFile) ? JSON.parse(readFileSync(healthFile, 'utf8')) : {};

async function alive(url) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    const resp = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'user-agent': `ai-product-index-health-check (+${BASE})` },
    });
    clearTimeout(timer);
    return resp.status < 400 ? null : `HTTP ${resp.status}`;
  } catch (e) {
    return e.cause?.code ?? e.name;
  }
}

const newHealth = {};
const failing = [];
const delisted = [];
for (const f of readdirSync(listingDir).filter((n) => n.endsWith('.json')).sort()) {
  const listing = JSON.parse(readFileSync(join(listingDir, f), 'utf8'));
  const err = await alive(listing.url);
  if (err === null) continue; // healthy -> strikes reset by omission
  const strikes = (oldHealth[listing.slug] ?? 0) + 1;
  if (strikes >= MAX_STRIKES) {
    rmSync(join(listingDir, f));
    delisted.push({ slug: listing.slug, url: listing.url, err });
  } else {
    newHealth[listing.slug] = strikes;
    failing.push({ slug: listing.slug, url: listing.url, err, strikes });
  }
}

writeFileSync(healthFile, JSON.stringify(newHealth, null, 2) + '\n');

const changed = delisted.length > 0
  || JSON.stringify(newHealth) !== JSON.stringify(oldHealth);

if (failing.length || delisted.length) {
  const lines = ['## Liveness report', ''];
  if (delisted.length) {
    lines.push(`### Delisted (${MAX_STRIKES} consecutive weekly failures)`, '');
    for (const d of delisted) lines.push(`- \`${d.slug}\` — ${d.url} (${d.err}). Re-register via \`[register]\` once the URL is live again.`);
    lines.push('');
  }
  if (failing.length) {
    lines.push('### Failing (will be delisted after 3 consecutive weekly failures)', '');
    for (const f of failing) lines.push(`- \`${f.slug}\` — ${f.url} (${f.err}), strike ${f.strikes}/${MAX_STRIKES}`);
    lines.push('');
  }
  writeFileSync(join(ROOT, 'health-report.md'), lines.join('\n') + '\n');
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `report=${failing.length || delisted.length ? 'true' : 'false'}\n`);
}
console.log(`liveness: ${delisted.length} delisted, ${failing.length} failing, changed=${changed}`);

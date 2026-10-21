// Weekly registry hygiene: re-check every listing's URL. A listing is
// delisted after 3 consecutive failed weekly checks (state in health.json,
// committed for transparency; healthy listings are absent from it). Dated URL
// observations in health-weeks.json prevent retries from adding weekly strikes.
// Writes health-report.md (gitignored) when anything failed or was delisted,
// and emits changed=/report= to $GITHUB_OUTPUT for the workflow.
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_STRIKES = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function weekStart(date) {
  const monday = new Date(date);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return monday.toISOString().slice(0, 10);
}

async function alive(url, base, fetchImpl, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'user-agent': `ai-product-index-health-check (+${base})` },
    });
    // Only the status is needed; release streaming bodies and their connection.
    await resp.body?.cancel().catch(() => {});
    return resp.status < 400 ? null : `HTTP ${resp.status}`;
  } catch (e) {
    return e.cause?.code ?? e.name;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkLiveness({ listings, previous = {}, previousWeeks = {}, base,
  fetchImpl = fetch, now = () => new Date(), timeoutMs = 10_000 }) {
  const week = weekStart(now());
  const priorWeek = new Date(`${week}T00:00:00Z`).getTime() - WEEK_MS;
  const health = {};
  const weeks = {};
  const failing = [];
  const delisted = [];
  for (const listing of [...listings].sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)) {
    const err = await alive(listing.url, base, fetchImpl, timeoutMs);
    if (err === null) continue; // healthy -> strikes and dates reset by omission
    const last = previousWeeks[listing.slug];
    const count = previous[listing.slug];
    const known = last?.url === listing.url && Number.isInteger(count)
      && count > 0 && count < MAX_STRIKES;
    // No dated observation (legacy state), a changed URL or a missed week
    // cannot establish consecutive failures. Start a new streak conservatively.
    const strikes = known && last.week === week ? count
      : known && new Date(`${last.week}T00:00:00Z`).getTime() === priorWeek ? count + 1 : 1;
    if (strikes >= MAX_STRIKES) {
      delisted.push({ slug: listing.slug, url: listing.url, err });
    } else {
      health[listing.slug] = strikes;
      weeks[listing.slug] = { url: listing.url, week };
      failing.push({ slug: listing.slug, url: listing.url, err, strikes });
    }
  }
  return { health, weeks, failing, delisted };
}

async function main() {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
  const listingDir = join(ROOT, 'listings');
  const healthFile = join(ROOT, 'health.json');
  const weeksFile = join(ROOT, 'health-weeks.json');
  const oldHealth = existsSync(healthFile) ? JSON.parse(readFileSync(healthFile, 'utf8')) : {};
  const oldWeeks = existsSync(weeksFile) ? JSON.parse(readFileSync(weeksFile, 'utf8')) : {};
  const files = readdirSync(listingDir).filter((n) => n.endsWith('.json')).sort();
  const listings = files.map((f) => JSON.parse(readFileSync(join(listingDir, f), 'utf8')));
  const { health, weeks, failing, delisted } = await checkLiveness({
    listings, previous: oldHealth, previousWeeks: oldWeeks, base: cfg.base.replace(/\/+$/, ''),
  });
  const removed = new Set(delisted.map((listing) => listing.slug));
  for (let i = 0; i < files.length; i++) {
    if (removed.has(listings[i].slug)) rmSync(join(listingDir, files[i]));
  }
  writeFileSync(healthFile, JSON.stringify(health, null, 2) + '\n');
  writeFileSync(weeksFile, JSON.stringify(weeks, null, 2) + '\n');

  const changed = delisted.length > 0
    || JSON.stringify(health) !== JSON.stringify(oldHealth)
    || JSON.stringify(weeks) !== JSON.stringify(oldWeeks);

  const reportFile = join(ROOT, 'health-report.md');
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
    writeFileSync(reportFile, lines.join('\n') + '\n');
  } else {
    rmSync(reportFile, { force: true });
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `report=${failing.length || delisted.length ? 'true' : 'false'}\n`);
  }
  console.log(`liveness: ${delisted.length} delisted, ${failing.length} failing, changed=${changed}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}

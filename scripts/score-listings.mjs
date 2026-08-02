// Weekly: ask our own free endpoint how agent-readable each listed product is,
// and commit the answer to scores.json.
//
// Why store rather than compute on demand: the score badge renders inside other
// people's READMEs, so it is hit by every page view of every listee. Auditing a
// site per badge render would mean seven outbound fetches for an image, and a
// slow one at that. Once a week is the right cadence for a grade that changes
// when someone edits their <head>.
//
// It calls the public GET /api/score deliberately rather than importing the
// audit: that endpoint needs HTMLRewriter, which only exists in the Workers
// runtime, and dogfooding the same URL an agent would call means this breaks
// loudly if the endpoint ever does.

import { readFileSync, writeFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const BASE = cfg.base.replace(/\/+$/, '');
const scoresFile = join(ROOT, 'scores.json');
const previous = existsSync(scoresFile) ? JSON.parse(readFileSync(scoresFile, 'utf8')) : {};

async function score(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90_000);
  try {
    const resp = await fetch(`${BASE}/api/score?url=${encodeURIComponent(url)}`, {
      signal: ctl.signal,
      headers: { accept: 'application/json', 'user-agent': `ai-product-index-scorer (+${BASE})` },
    });
    const body = await resp.json();
    if (!body.ok) return { error: body.error ?? body.code ?? `HTTP ${resp.status}` };
    // `check_set` is stored with every grade. A badge outlives the run that made
    // it, and 86 under v2 is a different statement from 86 under v1 — without
    // this, a re-score under a new checklist is indistinguishable from a site
    // that got worse.
    return {
      letter: body.letter,
      score: body.score,
      passed: body.passed,
      total: body.total_checks,
      check_set: body.check_set ?? 'v1',
    };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timeout' : (e.cause?.code ?? e.name) };
  } finally {
    clearTimeout(timer);
  }
}

const scores = {};
for (const f of readdirSync(join(ROOT, 'listings')).filter((n) => n.endsWith('.json')).sort()) {
  const listing = JSON.parse(readFileSync(join(ROOT, 'listings', f), 'utf8'));
  const result = await score(listing.url);
  if (result.error) {
    // Keep the last good grade rather than replacing it with an error: a
    // transient timeout should not blank a listee's badge for a week.
    const kept = previous[listing.slug];
    if (kept) scores[listing.slug] = kept;
    console.log(`${listing.slug}: ${result.error}${kept ? ' (kept previous)' : ''}`);
    continue;
  }
  scores[listing.slug] = { ...result, checked: new Date().toISOString().slice(0, 10) };
  console.log(`${listing.slug}: ${result.letter} ${result.score}/100`);
}

// Sorted keys so the committed file has a stable diff. (Note for future edits:
// JSON.stringify's second argument is a *replacer*, not a key order — passing
// the slug list there silently strips every nested field.)
const sorted = Object.fromEntries(Object.entries(scores).sort(([a], [b]) => (a < b ? -1 : 1)));
const before = JSON.stringify(previous);
const after = JSON.stringify(sorted, null, 2) + '\n';
writeFileSync(scoresFile, after);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${before !== JSON.stringify(sorted)}\n`);
}
console.log(`scored ${Object.keys(scores).length} listing(s)`);

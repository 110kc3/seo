// Refresh stored grades through the real Worker scorer. Operations authentication
// bypasses the anonymous rate limit only for URLs in the deployed registry.
import { readFileSync, writeFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { letterGrade, CHECK_SETS } from '../worker/audit.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function refreshScores({ listings, previous = {}, base, token, fetchImpl = fetch, now = () => new Date() }) {
  if (!token) throw new Error('DASHBOARD_TOKEN is required for registry scoring');
  const endpoint = new URL('/api/score', base);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('registry scoring requires an HTTPS service URL without credentials');
  }
  const scores = {};
  const failures = [];
  let refreshed = 0;
  let retained = 0;
  let missing = 0;
  for (const listing of [...listings].sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)) {
    const url = new URL(endpoint);
    url.searchParams.set('url', listing.url);
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 90_000);
    try {
      const resp = await fetchImpl(url.href, {
        signal: ctl.signal,
        // Never follow a redirect with the operations credential. The configured
        // canonical host owns this path; a moved service must be configured first.
        redirect: 'error',
        headers: {
          accept: 'application/json', authorization: `Bearer ${token}`,
          'x-registry-score': '1', 'user-agent': `ai-product-index-scorer (+${base})`,
        },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.json();
      if (!body.ok) throw new Error('audit did not succeed');
      if (!Number.isInteger(body.score) || body.score < 0 || body.score > 100
          || body.max_score !== 100 || body.letter !== letterGrade(body.score)
          || !Number.isInteger(body.passed) || !Number.isInteger(body.total_checks)
          || body.total_checks <= 0 || body.passed < 0 || body.passed > body.total_checks
          || !CHECK_SETS.includes(body.check_set)) {
        throw new Error('invalid score response');
      }
      scores[listing.slug] = {
        letter: body.letter, score: body.score, passed: body.passed,
        total: body.total_checks, check_set: body.check_set,
        checked: now().toISOString().slice(0, 10),
      };
      refreshed++;
    } catch (e) {
      const kept = previous[listing.slug];
      if (kept) { scores[listing.slug] = kept; retained++; }
      else missing++;
      // No remote error bodies or bearer values belong in public job logs.
      const reason = e.name === 'AbortError' ? 'timeout' : String(e.message ?? e.name).replaceAll(token, '[redacted]').slice(0, 160);
      failures.push({ slug: listing.slug, reason, retained: Boolean(kept) });
    } finally { clearTimeout(timeout); }
  }
  return {
    scores, failures, attempted: listings.length, refreshed, retained, missing,
    complete: failures.length === 0,
  };
}

export function scoreSummary(result) {
  return `## Registry score refresh\n\n`
    + `${result.refreshed}/${result.attempted} refreshed; ${result.retained} previous grades retained; ${result.missing} without a grade.\n\n`
    + (result.complete ? 'Complete.\n' : 'INCOMPLETE — successful updates are kept, but the run must fail.\n\n'
      + result.failures.map((f) => `- ${f.slug}: ${f.reason}${f.retained ? ' (kept previous date and grade)' : ' (no previous grade)'}`).join('\n') + '\n');
}

async function main() {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
  const path = join(ROOT, 'scores.json');
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const listings = readdirSync(join(ROOT, 'listings')).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(ROOT, 'listings', f), 'utf8')));
  const result = await refreshScores({ listings, previous, base: cfg.base, token: process.env.DASHBOARD_TOKEN });
  writeFileSync(path, JSON.stringify(result.scores, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    `changed=${JSON.stringify(previous) !== JSON.stringify(result.scores)}\ncomplete=${result.complete}\n`);
  const summary = scoreSummary(result);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  if (!result.complete) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    const message = `Registry scoring could not start: ${e.message}\n`;
    console.error(message);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message);
    process.exitCode = 1;
  });
}

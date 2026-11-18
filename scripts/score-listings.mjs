import { readFileSync, writeFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { letterGrade, CHECK_SETS } from '../worker/audit.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_RETRY_DELAY_MS = 30_000;
const MAX_EXPLAINED_FAILURE_SHARE = 0.25;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertSafeService(base, token) {
  if (!token) throw new Error('DASHBOARD_TOKEN is required for registry scoring');
  const endpoint = new URL('/api/score', base);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('registry scoring requires an HTTPS service URL without credentials');
  }
  return endpoint;
}

function isValidScore(body) {
  return Number.isInteger(body.score) && body.score >= 0 && body.score <= 100
    && body.max_score === 100 && body.letter === letterGrade(body.score)
    && Number.isInteger(body.passed) && Number.isInteger(body.total_checks)
    && body.total_checks > 0 && body.passed >= 0 && body.passed <= body.total_checks
    && CHECK_SETS.includes(body.check_set);
}

async function failureCode(resp) {
  try {
    const body = await resp.json();
    return typeof body?.code === 'string' ? ` ${body.code.slice(0, 40)}` : '';
  } catch {
    return '';
  }
}

async function scoreListing({ listing, endpoint, base, token, fetchImpl, now }) {
  const url = new URL(endpoint);
  url.searchParams.set('url', listing.url);
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 90_000);
  try {
    const resp = await fetchImpl(url.href, {
      signal: ctl.signal,
      redirect: 'error',
      headers: {
        accept: 'application/json', authorization: `Bearer ${token}`,
        'x-registry-score': '1', 'user-agent': `ai-product-index-scorer (+${base})`,
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}${await failureCode(resp)}`);
    const body = await resp.json();
    if (!body.ok) throw new Error('audit did not succeed');
    if (!isValidScore(body)) throw new Error('invalid score response');
    return { score: {
      letter: body.letter, score: body.score, passed: body.passed,
      total: body.total_checks, check_set: body.check_set,
      checked: now().toISOString().slice(0, 10),
    } };
  } catch (e) {
    const reason = e.name === 'AbortError' ? 'timeout' : String(e.message ?? e.name).replaceAll(token, '[redacted]').slice(0, 160);
    return { reason };
  } finally { clearTimeout(timeout); }
}

function sortedBySlug(listings) {
  return [...listings].sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
}

export async function refreshScores({ listings, previous = {}, health = {}, base, token, fetchImpl = fetch,
  now = () => new Date(), retryDelayMs = DEFAULT_RETRY_DELAY_MS, sleep = wait }) {
  const endpoint = assertSafeService(base, token);
  const attempt = (listing) => scoreListing({ listing, endpoint, base, token, fetchImpl, now });
  const scores = {};
  const firstPassFailures = [];
  for (const listing of sortedBySlug(listings)) {
    const outcome = await attempt(listing);
    if (outcome.score) scores[listing.slug] = outcome.score;
    else firstPassFailures.push(listing);
  }
  if (firstPassFailures.length) await sleep(retryDelayMs);
  const failures = [];
  let recovered = 0;
  for (const listing of firstPassFailures) {
    const outcome = await attempt(listing);
    if (outcome.score) {
      scores[listing.slug] = outcome.score;
      recovered++;
      continue;
    }
    const kept = previous[listing.slug];
    if (kept) scores[listing.slug] = kept;
    failures.push({
      slug: listing.slug, reason: outcome.reason, retained: Boolean(kept),
      livenessFailing: (health[listing.slug] ?? 0) > 0,
    });
  }
  const retained = failures.filter((f) => f.retained).length;
  const explained = failures.filter((f) => f.livenessFailing).length;
  const unexplained = failures.length - explained;
  const tooManyExplained = explained > listings.length * MAX_EXPLAINED_FAILURE_SHARE;
  return {
    scores, failures, attempted: listings.length,
    refreshed: listings.length - failures.length, recovered, retained,
    missing: failures.length - retained, explained, unexplained,
    complete: failures.length === 0,
    acceptable: unexplained === 0 && !tooManyExplained,
  };
}

function failureLine(failure) {
  const grade = failure.retained ? 'kept previous date and grade' : 'no previous grade';
  const cause = failure.livenessFailing ? '; also failing liveness' : '';
  return `- ${failure.slug}: ${failure.reason} (${grade}${cause})`;
}

function verdict(result) {
  if (result.complete) return 'Complete.\n';
  const heading = result.acceptable
    ? 'INCOMPLETE — every remaining failure is a listing that is also failing liveness; the run passes.'
    : result.unexplained
      ? `INCOMPLETE — ${result.unexplained} failure(s) not explained by liveness; successful updates are kept, but the run must fail.`
      : `INCOMPLETE — more than ${MAX_EXPLAINED_FAILURE_SHARE * 100}% of listings failed; successful updates are kept, but the run must fail.`;
  return `${heading}\n\n${result.failures.map(failureLine).join('\n')}\n`;
}

export function scoreSummary(result) {
  return `## Registry score refresh\n\n`
    + `${result.refreshed}/${result.attempted} refreshed (${result.recovered} on retry); `
    + `${result.retained} previous grades retained; ${result.missing} without a grade.\n\n`
    + verdict(result);
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

function retryDelayFromEnv() {
  const configured = Number(process.env.SCORE_RETRY_DELAY_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_RETRY_DELAY_MS;
}

async function main() {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
  const path = join(ROOT, 'scores.json');
  const previous = readJson(path, {});
  const health = readJson(join(ROOT, 'health.json'), {});
  const listings = readdirSync(join(ROOT, 'listings')).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(ROOT, 'listings', f), 'utf8')));
  const result = await refreshScores({
    listings, previous, health, base: cfg.base, token: process.env.DASHBOARD_TOKEN, retryDelayMs: retryDelayFromEnv(),
  });
  writeFileSync(path, JSON.stringify(result.scores, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    `changed=${JSON.stringify(previous) !== JSON.stringify(result.scores)}\ncomplete=${result.complete}\nacceptable=${result.acceptable}\n`);
  const summary = scoreSummary(result);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  if (!result.acceptable) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    const message = `Registry scoring could not start: ${e.message}\n`;
    console.error(message);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message);
    process.exitCode = 1;
  });
}

// Freezes the live traffic feed into a committed file, so the report page can
// quote it without the build depending on the network.
//
// `/api/stats.json` is computed at request time from Analytics Engine. That is
// right for an API and wrong for a page that wants to be cited: a citable number
// has to be the same number tomorrow, and `build.mjs` must stay a pure function
// of its inputs or every rebuild diffs. So the weekly cron takes a snapshot and
// commits it, exactly as it already does for scores.json and health.json.
//
// Written as a series rather than a single reading. The interesting thing about
// agent share is not its value, it is its slope — 3.2% at day 4, 7.19% at day 7,
// 10.6% at day 8 is a finding; "10.6%" on its own is a statistic. Each run
// appends one dated point and rewrites nothing, so the history is append-only
// and a bad run can be dropped by hand without recomputing anything.
//
// Usage: node scripts/snapshot-traffic.mjs [--date YYYY-MM-DD]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const BASE = cfg.base.replace(/\/+$/, '');
const OUT = join(ROOT, 'api', 'traffic.json');

const argDate = process.argv.includes('--date')
  ? process.argv[process.argv.indexOf('--date') + 1]
  : null;

const resp = await fetch(`${BASE}/api/stats.json`, {
  headers: { accept: 'application/json', 'user-agent': `ai-product-index-snapshot (+${BASE})` },
});
if (!resp.ok) {
  console.error(`stats endpoint answered HTTP ${resp.status}; leaving the snapshot untouched`);
  process.exit(1);
}
const live = await resp.json();
if (!live.ok) {
  // `stats_not_enabled` is the documented answer when the analytics credential
  // is missing. Overwriting a good history with that would silently blank the
  // report, so refuse instead.
  console.error(`stats endpoint reports ${live.code ?? 'not ok'}; leaving the snapshot untouched`);
  process.exit(1);
}

// The date comes from the reading itself, not from the clock, so re-running
// against a cached response cannot invent a new day.
const date = argDate ?? String(live.generated_at ?? '').slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`could not determine a date for this reading (generated_at: ${live.generated_at})`);
  process.exit(1);
}

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { series: [] };
const series = (previous.series ?? []).filter((p) => p.date !== date);

const paths = live.by_path ?? {};
const clients = live.by_client_type ?? {};
series.push({
  date,
  window: live.window ?? '30d',
  total_requests: live.total_requests ?? 0,
  agent_share: live.agent_share ?? 0,
  ai_crawler: clients.ai_crawler ?? 0,
  browser: clients.browser ?? 0,
  script: clients.script ?? 0,
  free_scores: paths.score_free ?? 0,
  llms_txt: paths.llms_txt ?? 0,
  audit_hits: paths.audit ?? 0,
  x402_info: paths.x402_info ?? 0,
});
series.sort((a, b) => a.date.localeCompare(b.date));

writeFileSync(OUT, JSON.stringify({
  $comment: 'Dated snapshots of /api/stats.json, appended weekly. The live endpoint is'
    + ' authoritative for "right now"; this file exists so a published figure stays'
    + ' the same figure when someone checks it later, and so the trend is readable at all.',
  source: `${BASE}/api/stats.json`,
  series,
}, null, 2) + '\n');

const latest = series.at(-1);
console.log(`snapshot ${latest.date}: ${latest.total_requests} requests, agent share ${(latest.agent_share * 100).toFixed(2)}% (${series.length} point(s) in the series)`);


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
  console.error(`stats endpoint reports ${live.code ?? 'not ok'}; leaving the snapshot untouched`);
  process.exit(1);
}

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

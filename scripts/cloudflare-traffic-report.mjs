// Aggregate-only traffic report for a hostname on this Cloudflare account.
//
// The report intentionally combines two different datasets:
// - Web Analytics / RUM says which HTML pages real browsers loaded. Its `bot`
//   dimension lets the report keep likely-human activity separate.
// - Zone HTTP analytics says what reached Cloudflare's edge, including assets,
//   crawlers and failed requests.
//
// No raw events, IP addresses, full user agents or query strings are requested.
// Cloudflare limits the HTTP adaptive dataset to short windows on lower plans,
// so a 2-7 day report is queried as consecutive 24-hour slices and combined
// locally. Run this through `.github/workflows/cf-admin.yml`; the credentials
// deliberately exist only in GitHub Actions.

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const GRAPHQL_URL = `${API_BASE}/graphql`;
const DAY_MS = 24 * 60 * 60 * 1000;

const RUM_QUERY = `
  query TrafficRUM($accountTag: string, $start: Time, $end: Time, $host: string) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        all: rumPageloadEventsAdaptiveGroups(
          limit: 1
          filter: { datetime_geq: $start, datetime_lt: $end, requestHost: $host }
        ) { count sum { visits } avg { sampleInterval } }
        humans: rumPageloadEventsAdaptiveGroups(
          limit: 1
          filter: { datetime_geq: $start, datetime_lt: $end, requestHost: $host, bot: 0 }
        ) { count sum { visits } avg { sampleInterval } }
        bots: rumPageloadEventsAdaptiveGroups(
          limit: 1
          filter: { datetime_geq: $start, datetime_lt: $end, requestHost: $host, bot: 1 }
        ) { count sum { visits } avg { sampleInterval } }
        paths: rumPageloadEventsAdaptiveGroups(
          limit: 50
          orderBy: [count_DESC]
          filter: { datetime_geq: $start, datetime_lt: $end, requestHost: $host, bot: 0 }
        ) { count sum { visits } dimensions { requestPath } }
        referrers: rumPageloadEventsAdaptiveGroups(
          limit: 25
          orderBy: [count_DESC]
          filter: { datetime_geq: $start, datetime_lt: $end, requestHost: $host, bot: 0 }
        ) { count dimensions { refererHost } }
        countries: rumPageloadEventsAdaptiveGroups(
          limit: 25
          orderBy: [count_DESC]
          filter: { datetime_geq: $start, datetime_lt: $end, requestHost: $host, bot: 0 }
        ) { count dimensions { countryName } }
        devices: rumPageloadEventsAdaptiveGroups(
          limit: 10
          orderBy: [count_DESC]
          filter: { datetime_geq: $start, datetime_lt: $end, requestHost: $host, bot: 0 }
        ) { count dimensions { deviceType } }
        browsers: rumPageloadEventsAdaptiveGroups(
          limit: 15
          orderBy: [count_DESC]
          filter: { datetime_geq: $start, datetime_lt: $end, requestHost: $host, bot: 0 }
        ) { count dimensions { userAgentBrowser } }
        navigations: rumPageloadEventsAdaptiveGroups(
          limit: 10
          orderBy: [count_DESC]
          filter: { datetime_geq: $start, datetime_lt: $end, requestHost: $host, bot: 0 }
        ) { count dimensions { navigationType } }
      }
    }
  }
`;

const EDGE_QUERY = `
  query TrafficEdge($zoneTag: string, $start: Time, $end: Time, $host: string) {
    viewer {
      zones(filter: { zoneTag: $zoneTag }) {
        total: httpRequestsAdaptiveGroups(
          limit: 1
          filter: {
            datetime_geq: $start
            datetime_lt: $end
            clientRequestHTTPHost: $host
            requestSource: "eyeball"
          }
        ) { count sum { edgeResponseBytes visits } avg { sampleInterval } }
        paths: httpRequestsAdaptiveGroups(
          limit: 50
          orderBy: [count_DESC]
          filter: {
            datetime_geq: $start
            datetime_lt: $end
            clientRequestHTTPHost: $host
            requestSource: "eyeball"
          }
        ) { count sum { edgeResponseBytes visits } dimensions { clientRequestPath } }
        statuses: httpRequestsAdaptiveGroups(
          limit: 20
          orderBy: [count_DESC]
          filter: {
            datetime_geq: $start
            datetime_lt: $end
            clientRequestHTTPHost: $host
            requestSource: "eyeball"
          }
        ) { count dimensions { edgeResponseStatus } }
        cache: httpRequestsAdaptiveGroups(
          limit: 20
          orderBy: [count_DESC]
          filter: {
            datetime_geq: $start
            datetime_lt: $end
            clientRequestHTTPHost: $host
            requestSource: "eyeball"
          }
        ) { count sum { edgeResponseBytes } dimensions { cacheStatus } }
      }
    }
  }
`;

export function normalizeHostname(value) {
  const hostname = String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (hostname.length > 253
    || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) {
    throw new Error('hostname must be a valid DNS hostname, for example index.kc-it.pl');
  }
  return hostname;
}

export function parseDays(value) {
  if (!/^[1-7]$/.test(String(value ?? ''))) {
    throw new Error('days must be a whole number from 1 through 7');
  }
  return Number(value);
}

export function dailyWindows({ days, end = new Date() }) {
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(endMs)) throw new Error('report end time is invalid');
  const startMs = endMs - days * DAY_MS;
  const windows = [];
  for (let cursor = startMs; cursor < endMs; cursor += DAY_MS) {
    windows.push({
      start: new Date(cursor).toISOString(),
      end: new Date(Math.min(cursor + DAY_MS, endMs)).toISOString(),
    });
  }
  return windows;
}

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricFrom(row = {}) {
  return {
    count: number(row.count),
    visits: number(row.sum?.visits),
    bytes: number(row.sum?.edgeResponseBytes),
    sampleInterval: number(row.avg?.sampleInterval),
  };
}

function addMetric(target, row) {
  const value = metricFrom(row);
  target.count += value.count;
  target.visits += value.visits;
  target.bytes += value.bytes;
  target.max_sample_interval = Math.max(target.max_sample_interval, value.sampleInterval);
}

function aggregateGroups(payloads, scope, alias, dimension, limit) {
  const totals = new Map();
  for (const payload of payloads) {
    const rows = payload?.viewer?.[scope]?.[0]?.[alias] ?? [];
    for (const row of rows) {
      const rawKey = row?.dimensions?.[dimension];
      const key = rawKey === null || rawKey === undefined ? '' : String(rawKey);
      const current = totals.get(key) ?? {
        value: key,
        count: 0,
        visits: 0,
        bytes: 0,
        max_sample_interval: 0,
      };
      addMetric(current, row);
      totals.set(key, current);
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

function aggregateTotal(payloads, scope, alias) {
  const total = { count: 0, visits: 0, bytes: 0, max_sample_interval: 0 };
  for (const payload of payloads) {
    const row = payload?.viewer?.[scope]?.[0]?.[alias]?.[0];
    if (row) addMetric(total, row);
  }
  return total;
}

export function summarizeTraffic({ hostname, start, end, rumPayloads = [], edgePayloads = [], warnings = [] }) {
  const report = {
    hostname,
    window: { start, end },
    generated_at: new Date().toISOString(),
    privacy: 'Aggregates only: no IP addresses, raw user agents, query strings, or individual events.',
    warnings: [...warnings],
  };

  if (rumPayloads.length) {
    const all = aggregateTotal(rumPayloads, 'accounts', 'all');
    const humans = aggregateTotal(rumPayloads, 'accounts', 'humans');
    const bots = aggregateTotal(rumPayloads, 'accounts', 'bots');
    report.web_analytics = {
      page_views: all.count,
      likely_human_page_views: humans.count,
      likely_bot_page_views: bots.count,
      unclassified_page_views: Math.max(0, all.count - humans.count - bots.count),
      likely_human_visits: humans.visits,
      max_sample_interval: Math.max(all.max_sample_interval, humans.max_sample_interval, bots.max_sample_interval),
      top_pages: aggregateGroups(rumPayloads, 'accounts', 'paths', 'requestPath', 20),
      top_referrer_hosts: aggregateGroups(rumPayloads, 'accounts', 'referrers', 'refererHost', 15),
      top_countries: aggregateGroups(rumPayloads, 'accounts', 'countries', 'countryName', 15),
      devices: aggregateGroups(rumPayloads, 'accounts', 'devices', 'deviceType', 10),
      browsers: aggregateGroups(rumPayloads, 'accounts', 'browsers', 'userAgentBrowser', 10),
      navigation_types: aggregateGroups(rumPayloads, 'accounts', 'navigations', 'navigationType', 10),
    };
  }

  if (edgePayloads.length) {
    const total = aggregateTotal(edgePayloads, 'zones', 'total');
    report.edge_analytics = {
      requests: total.count,
      visits: total.visits,
      response_bytes: total.bytes,
      max_sample_interval: total.max_sample_interval,
      top_paths: aggregateGroups(edgePayloads, 'zones', 'paths', 'clientRequestPath', 20),
      statuses: aggregateGroups(edgePayloads, 'zones', 'statuses', 'edgeResponseStatus', 20),
      cache_statuses: aggregateGroups(edgePayloads, 'zones', 'cache', 'cacheStatus', 20),
    };
  }

  return report;
}

function escapeCell(value, empty = '(direct / none)') {
  const text = String(value || empty).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

function integer(value) {
  return Math.round(number(value)).toLocaleString('en-US');
}

function percent(numerator, denominator) {
  return denominator > 0 ? `${(100 * numerator / denominator).toFixed(1)}%` : 'n/a';
}

function bytes(value) {
  const amount = number(value);
  if (amount < 1024) return `${integer(amount)} B`;
  if (amount < 1024 ** 2) return `${(amount / 1024).toFixed(1)} KiB`;
  return `${(amount / 1024 ** 2).toFixed(1)} MiB`;
}

function table(title, label, rows, { empty = '(direct / none)', extra } = {}) {
  const lines = [`### ${title}`, '', `| ${label} | Count |${extra ? ` ${extra.label} |` : ''}`, `|---|---:|${extra ? '---:|' : ''}`];
  if (!rows?.length) lines.push(`| (no data) | 0 |${extra ? ' 0 |' : ''}`);
  for (const row of rows ?? []) {
    lines.push(`| ${escapeCell(row.value, empty)} | ${integer(row.count)} |${extra ? ` ${extra.format(row)} |` : ''}`);
  }
  return lines.join('\n');
}

export function renderMarkdown(report) {
  const lines = [
    `# Traffic report: ${report.hostname}`,
    '',
    `UTC window: ${report.window.start} to ${report.window.end}`,
    '',
    report.privacy,
  ];

  const rum = report.web_analytics;
  if (rum) {
    lines.push(
      '',
      '## Browser-side Web Analytics',
      '',
      '| Metric | Value |',
      '|---|---:|',
      `| Page views | ${integer(rum.page_views)} |`,
      `| Likely-human page views | ${integer(rum.likely_human_page_views)} |`,
      `| Likely-bot page views | ${integer(rum.likely_bot_page_views)} |`,
      `| Human share | ${percent(rum.likely_human_page_views, rum.page_views)} |`,
      `| Likely-human visits | ${integer(rum.likely_human_visits)} |`,
      `| Highest sample interval | ${integer(rum.max_sample_interval || 1)} |`,
      '',
      table('Likely-human page views by path', 'Path', rum.top_pages, {
        empty: '/',
        extra: { label: 'Visits', format: (row) => integer(row.visits) },
      }),
      '',
      table('Likely-human page views by referrer', 'Referrer host', rum.top_referrer_hosts),
      '',
      table('Likely-human page views by country', 'Country', rum.top_countries, { empty: '(unknown)' }),
      '',
      table('Likely-human page views by device', 'Device', rum.devices, { empty: '(unknown)' }),
      '',
      table('Likely-human page views by browser family', 'Browser', rum.browsers, { empty: '(unknown)' }),
      '',
      table('Likely-human page views by navigation type', 'Navigation', rum.navigation_types, { empty: '(unknown)' }),
    );
  }

  const edge = report.edge_analytics;
  if (edge) {
    lines.push(
      '',
      '## Cloudflare edge analytics',
      '',
      '| Metric | Value |',
      '|---|---:|',
      `| Requests | ${integer(edge.requests)} |`,
      `| Visits | ${integer(edge.visits)} |`,
      `| Response bytes | ${bytes(edge.response_bytes)} |`,
      `| Highest sample interval | ${integer(edge.max_sample_interval || 1)} |`,
      '',
      table('Edge requests by path', 'Path', edge.top_paths, {
        empty: '/',
        extra: { label: 'Response bytes', format: (row) => bytes(row.bytes) },
      }),
      '',
      table('Edge requests by status', 'HTTP status', edge.statuses, { empty: '(unknown)' }),
      '',
      table('Edge requests by cache status', 'Cache status', edge.cache_statuses, {
        empty: '(unknown)',
        extra: { label: 'Response bytes', format: (row) => bytes(row.bytes) },
      }),
    );
  }

  if (report.warnings.length) {
    lines.push('', '## Warnings', '', ...report.warnings.map((warning) => `- ${escapeCell(warning, '(unknown warning)')}`));
  }
  lines.push('');
  return lines.join('\n');
}

function safeError(error) {
  return String(error?.message ?? error ?? 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 500);
}

async function responseJson(response, label) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${label} returned HTTP ${response.status} with a non-JSON body`);
  }
  if (!response.ok) {
    const message = body?.errors?.map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(`${label} returned HTTP ${response.status}${message ? `: ${message}` : ''}`);
  }
  return body;
}

async function graphql(fetchImpl, token, query, variables, label) {
  const response = await fetchImpl(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await responseJson(response, label);
  if (body.errors?.length) {
    throw new Error(`${label}: ${body.errors.map((error) => error.message).filter(Boolean).join('; ')}`);
  }
  return body.data;
}

function tokenCandidates(entries) {
  const seen = new Set();
  return entries.filter(({ token }) => {
    if (!token || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

async function collectDataset({ fetchImpl, candidates, query, windows, variables, label }) {
  let preferred;
  const payloads = [];
  for (const window of windows) {
    const ordered = preferred
      ? [preferred, ...candidates.filter((candidate) => candidate !== preferred)]
      : candidates;
    let data;
    let lastError;
    for (const candidate of ordered) {
      try {
        data = await graphql(fetchImpl, candidate.token, query, { ...variables, ...window }, label);
        preferred = candidate;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!data) throw lastError ?? new Error(`${label} has no usable credential`);
    payloads.push(data);
  }
  return { payloads, credential: preferred.label };
}

async function resolveZone({ fetchImpl, candidates, accountId, hostname }) {
  let lastError;
  for (const candidate of candidates) {
    try {
      const response = await fetchImpl(`${API_BASE}/zones?account.id=${encodeURIComponent(accountId)}&per_page=50`, {
        headers: { authorization: `Bearer ${candidate.token}`, accept: 'application/json' },
      });
      const body = await responseJson(response, 'zone lookup');
      if (!body.success) {
        throw new Error(`zone lookup failed: ${(body.errors ?? []).map((error) => error.message).join('; ')}`);
      }
      const zone = (body.result ?? [])
        .filter((item) => hostname === item.name || hostname.endsWith(`.${item.name}`))
        .sort((a, b) => b.name.length - a.name.length)[0];
      if (!zone) throw new Error(`no zone in this account owns ${hostname}`);
      return { id: zone.id, name: zone.name, credential: candidate.label };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('zone lookup has no usable credential');
}

export async function runTrafficReport({
  hostname,
  days,
  accountId,
  deployToken,
  analyticsToken,
  outputDir,
  stepSummary,
  end = new Date(),
  fetchImpl = fetch,
}) {
  const normalizedHost = normalizeHostname(hostname);
  const normalizedDays = parseDays(days);
  if (!/^[a-f0-9]{32}$/i.test(String(accountId ?? ''))) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is missing or invalid');
  }
  if (!deployToken && !analyticsToken) throw new Error('no Cloudflare API token is available');

  const windows = dailyWindows({ days: normalizedDays, end });
  const analyticsCandidates = tokenCandidates([
    { label: 'analytics token', token: analyticsToken },
    { label: 'deploy token fallback', token: deployToken },
  ]);
  const zoneCandidates = tokenCandidates([
    { label: 'deploy token', token: deployToken },
    { label: 'analytics token fallback', token: analyticsToken },
  ]);
  const warnings = [];
  let rumPayloads = [];
  let edgePayloads = [];

  try {
    const rum = await collectDataset({
      fetchImpl,
      candidates: analyticsCandidates,
      query: RUM_QUERY,
      windows,
      variables: { accountTag: accountId, host: normalizedHost },
      label: 'Web Analytics query',
    });
    rumPayloads = rum.payloads;
  } catch (error) {
    warnings.push(`Web Analytics unavailable: ${safeError(error)}`);
  }

  try {
    const zone = await resolveZone({
      fetchImpl,
      candidates: zoneCandidates,
      accountId,
      hostname: normalizedHost,
    });
    const edge = await collectDataset({
      fetchImpl,
      candidates: zoneCandidates,
      query: EDGE_QUERY,
      windows,
      variables: { zoneTag: zone.id, host: normalizedHost },
      label: 'edge analytics query',
    });
    edgePayloads = edge.payloads;
  } catch (error) {
    warnings.push(`Edge analytics unavailable: ${safeError(error)}`);
  }

  if (!rumPayloads.length && !edgePayloads.length) {
    throw new Error(`neither analytics source was readable: ${warnings.join(' | ')}`);
  }

  const report = summarizeTraffic({
    hostname: normalizedHost,
    start: windows[0].start,
    end: windows.at(-1).end,
    rumPayloads,
    edgePayloads,
    warnings,
  });
  const markdown = renderMarkdown(report);
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(join(outputDir, 'traffic-report.json'), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(join(outputDir, 'traffic-report.md'), markdown),
    stepSummary ? appendFile(stepSummary, markdown) : Promise.resolve(),
  ]);
  return { report, markdown };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));
if (isMain) {
  try {
    const { markdown } = await runTrafficReport({
      hostname: process.env.TRAFFIC_HOSTNAME,
      days: process.env.TRAFFIC_DAYS,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      deployToken: process.env.CLOUDFLARE_API_TOKEN,
      analyticsToken: process.env.CF_ANALYTICS_TOKEN,
      outputDir: process.env.TRAFFIC_REPORT_DIR,
      stepSummary: process.env.GITHUB_STEP_SUMMARY,
    });
    console.log(markdown);
  } catch (error) {
    console.error(`traffic-report: ${safeError(error)}`);
    process.exitCode = 1;
  }
}

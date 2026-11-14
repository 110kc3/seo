
import { RETIRED_API_PATHS } from './retired.js';
import { resolveX402 } from '../scripts/x402-config.mjs';
import { urlError } from '../scripts/validate.mjs';

const UA = 'AIProductIndexRouter/1.0 (+https://index.percall.dev/llms.txt; liveness probe — never pays)';
const PROBE_TIMEOUT_MS = 6000;
const MAX_PROBE_BODY = 32 * 1024;
export const PROBE_CACHE_TTL_S = 60;
const MAX_CANDIDATES = 5;
const MAX_BODY = 4 * 1024;

const HISTORY_PREFIX = 'probe:hist:v1:';
const HISTORY_TTL_S = 180 * 24 * 3600;
export const RECENT_MAX = 30;

const probeHeaders = (accept = 'application/json, */*') => ({ 'user-agent': UA, accept });

export const PAYMENT_HEADERS = ['x-payment', 'payment-signature'];

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });


const b64json = (value) => {
  try {
    return JSON.parse(atob(String(value)));
  } catch {
    return null;
  }
};

function decimalsFor(assetAddress, cfg) {
  const known = new Map();
  for (const profile of Object.values(cfg?.payments?.x402?.profiles ?? {})) {
    if (profile.asset) known.set(profile.asset.toLowerCase(), profile.asset_decimals ?? 6);
  }
  return known.get(String(assetAddress ?? '').toLowerCase()) ?? null;
}

export function parseTerms(headers, body, cfg) {
  const fromHeader = b64json(headers?.get?.('payment-required'));
  const accepts = [
    ...(Array.isArray(fromHeader?.accepts) ? fromHeader.accepts : []),
    ...(Array.isArray(body?.accepts) ? body.accepts : []),
  ];
  if (!accepts.length) return null;

  const terms = [];
  for (const a of accepts) {
    if (!a || typeof a !== 'object') continue;
    const atomic = a.amount ?? a.maxAmountRequired;
    if (atomic === undefined || atomic === null) continue;
    const decimals = decimalsFor(a.asset, cfg);
    const amountAtomic = String(atomic);
    terms.push({
      scheme: a.scheme ?? null,
      network: a.network ?? null,
      asset: a.asset ?? null,
      asset_name: a.extra?.name ?? null,
      pay_to: a.payTo ?? null,
      amount_atomic: amountAtomic,
      price: decimals === null || !/^\d+$/.test(amountAtomic)
        ? null
        : Number(amountAtomic) / 10 ** decimals,
      price_decimals: decimals,
      max_timeout_seconds: a.maxTimeoutSeconds ?? null,
    });
  }
  return terms.length ? terms : null;
}


export function mcpVerdict(status, parsed) {
  if (parsed?.result) return { session: 'ok', protocol: parsed.result.protocolVersion ?? null, server: parsed.result.serverInfo?.name ?? null };
  if (status === 401 || status === 403) return { session: 'auth', reason: `HTTP ${status} — credentials required` };
  if (parsed?.error) return { session: 'no', reason: `JSON-RPC error ${parsed.error.code ?? ''}: ${String(parsed.error.message ?? '').slice(0, 80)}`.trim() };
  return { session: 'no', reason: `HTTP ${status}, no JSON-RPC result` };
}

export const MCP_INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'AIProductIndexRouter', version: '1.0' },
  },
});

export async function probe(target, { fetchImpl = fetch, cfg = {}, method = 'GET', body = null } = {}) {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(target, {
      method,
      redirect: 'follow',
      signal: ctl.signal,
      headers: body
        ? { ...probeHeaders('application/json, text/event-stream'), 'content-type': 'application/json' }
        : probeHeaders(),
      ...(body ? { body } : {}),
    });
    const latency = Date.now() - started;
    const buf = await resp.arrayBuffer?.() ?? new ArrayBuffer(0);
    let parsed = null;
    try {
      parsed = JSON.parse(new TextDecoder().decode(buf.slice(0, MAX_PROBE_BODY)));
    } catch { /* a non-JSON body is normal and is not an error */ }

    return {
      url: resp.url || target,
      alive: true,
      status: resp.status,
      latency_ms: latency,
      paywalled: resp.status === 402,
      terms: resp.status === 402 ? parseTerms(resp.headers, parsed, cfg) : null,
      ...(body ? { mcp: mcpVerdict(resp.status, parsed) } : {}),
      error: null,
    };
  } catch (e) {
    return {
      url: target,
      alive: false,
      status: 0,
      latency_ms: Date.now() - started,
      paywalled: false,
      terms: null,
      error: e.name === 'AbortError' ? 'timeout' : (e.cause?.code ?? e.name ?? 'fetch_failed'),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function selfTerms(target, cfg) {
  const aliases = [new URL(cfg.base).host, ...(cfg.host_aliases ?? []), cfg.router_host].filter(Boolean);
  let url;
  try { url = new URL(target); } catch { return null; }
  if (!aliases.includes(url.host)) return null;

  const rail = resolveX402(cfg);
  const price = rail?.audit_price_atomic;
  const paid = url.pathname === '/api/audit' && rail && price;
  return {
    url: target,
    alive: true,
    status: RETIRED_API_PATHS.has(url.pathname) ? 410 : paid ? 402 : 200,
    latency_ms: 0,
    paywalled: Boolean(paid),
    terms: paid
      ? [{
        scheme: 'exact',
        network: rail.network,
        asset: rail.asset,
        asset_name: rail.asset_name,
        pay_to: rail.payTo,
        amount_atomic: String(price),
        price: Number(price) / 10 ** rail.asset_decimals,
        price_decimals: rail.asset_decimals,
        max_timeout_seconds: rail.max_timeout_seconds,
      }]
      : null,
    error: null,
    source: 'self',
    history: null,
  };
}


export const ROUTE_RESOURCES = {
  liveness: {
    description: 'Probe one machine-payable endpoint right now: whether it answers, how fast, and the payment terms it currently quotes. Never pays and never proxies — the caller pays the endpoint directly.',
    mimeType: 'application/json',
  },
  route: {
    description: 'Rank candidate machine-payable endpoints for a task, each probed live, each with the terms it currently quotes and the URL to call. Never pays and never proxies — the caller pays the endpoint directly.',
    mimeType: 'application/json',
  },
};

const SETTLEMENT_NOTE = 'This service never holds, forwards or fronts funds. Pay the endpoint directly, with the terms above, from your own wallet.';

export function parseLivenessRequest(url) {
  const target = url.searchParams.get('url');
  const err = urlError(target, 'url');
  if (err) return { error: err };
  const method = (url.searchParams.get('method') ?? 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) return { error: 'method: must be GET or POST' };
  return { url: target, method };
}

export function parseRouteRequest(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'body must be a JSON object like {"q": "unit conversion", "max_price": 0.01}' };
  }
  const q = typeof body.q === 'string' ? body.q.trim().slice(0, 200) : '';
  if (!q) return { error: 'q: describe what the endpoint should do, e.g. {"q": "currency conversion"}' };
  const limit = Math.min(Math.max(Number(body.limit) || 3, 1), MAX_CANDIDATES);
  const maxPrice = body.max_price === undefined ? null : Number(body.max_price);
  if (maxPrice !== null && !Number.isFinite(maxPrice)) return { error: 'max_price: must be a number of USDC, e.g. 0.01' };
  const chain = typeof body.chain === 'string' ? body.chain.trim().slice(0, 40) : '';
  const catalog = body.catalog === 'mcp' ? 'mcp' : 'x402';
  if (catalog === 'mcp' && maxPrice !== null) {
    return { error: 'max_price: MCP servers are not priced per call; drop it or set catalog to "x402"' };
  }
  return { q, limit, maxPrice, chain, catalog };
}

export async function handleLiveness(request, env, cfg, { gate, fetchImpl = fetch } = {}) {
  const url = new URL(request.url);
  if (request.method !== 'GET') {
    return json({ ok: false, code: 'method_not_allowed', error: 'GET /api/liveness?url=https://example.com/paid' }, 405, { allow: 'GET' });
  }
  const parsed = parseLivenessRequest(url);
  if (parsed.error) return json({ ok: false, code: 'invalid', errors: [parsed.error] }, 400);

  const paid = await gate(ROUTE_RESOURCES.liveness);
  if (!paid.ok) return paid.response;

  const result = selfTerms(parsed.url, cfg)
    ?? await cachedProbe(env, parsed.url, { fetchImpl, cfg, method: parsed.method });
  return paid.attach(json({
    ok: true,
    result,
    settlement: SETTLEMENT_NOTE,
  }));
}

export async function handleRoute(request, env, cfg, { gate, catalogSearch, base, fetchImpl = fetch } = {}) {
  if (request.method !== 'POST') {
    return json({ ok: false, code: 'method_not_allowed', error: 'POST a JSON body like {"q": "unit conversion", "max_price": 0.01}' }, 405, { allow: 'POST' });
  }
  const raw = await request.clone().text();
  if (raw.length > MAX_BODY) return json({ ok: false, code: 'too_large', error: `body larger than ${MAX_BODY} bytes` }, 413);
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch (e) {
    return json({ ok: false, code: 'bad_json', error: `invalid JSON: ${e.message.slice(0, 200)}` }, 400);
  }
  const parsed = parseRouteRequest(body);
  if (parsed.error) return json({ ok: false, code: 'invalid', errors: [parsed.error] }, 400);

  const searchUrl = new URL(`${base}/api/${parsed.catalog}/search`);
  searchUrl.searchParams.set('q', parsed.q);
  searchUrl.searchParams.set('limit', String(parsed.limit));
  if (parsed.maxPrice !== null) searchUrl.searchParams.set('max_price', String(parsed.maxPrice));
  if (parsed.chain) searchUrl.searchParams.set('chain', parsed.chain);

  let found;
  try {
    found = await (await catalogSearch(parsed.catalog, searchUrl)).json();
  } catch (e) {
    return json({ ok: false, code: 'catalog_unavailable', error: e.message?.slice(0, 200) ?? 'catalog unavailable' }, 503);
  }
  if (!found.ok) return json(found, 503);
  if (!found.results?.length) {
    return json({
      ok: true, query: parsed.q, count: 0, candidates: [],
      note: `Nothing in ${found.catalog?.endpoints ?? 'the'} catalogued endpoints matched. Widen the query, raise max_price, or drop the chain filter.`,
      catalog: found.catalog,
    });
  }

  const paid = await gate(ROUTE_RESOURCES.route);
  if (!paid.ok) return paid.response;

  const probes = await Promise.all(found.results.map(async ({ price, ...candidate }) => {
    const mine = selfTerms(candidate.url, cfg);
    return {
      ...candidate,
      catalog_price: price ?? null,
      probe: mine ?? await cachedProbe(env, candidate.url, parsed.catalog === 'mcp'
        ? { fetchImpl, cfg, method: 'POST', body: MCP_INITIALIZE }
        : { fetchImpl, cfg, method: candidate.method || 'GET' }),
    };
  }));

  const rank = (c) => {
    if (!c.probe.alive) return 2;
    if (c.probe.mcp && c.probe.mcp.session === 'no') return 1;
    return 0;
  };
  const quote = (c) => c.probe.terms?.[0]?.price ?? c.catalog_price ?? Infinity;
  probes.sort((a, b) => rank(a) - rank(b) || quote(a) - quote(b));

  return paid.attach(json({
    ok: true,
    query: parsed.q,
    count: probes.length,
    candidates: probes,
    settlement: SETTLEMENT_NOTE,
    catalog: found.catalog,
  }));
}

export function foldObservation(previous, { alive, status, at }) {
  const prior = previous ?? { first_seen: at, probes: 0, answered: 0, recent: '', last_answered: null };
  const recent = ((alive ? '1' : '0') + (prior.recent ?? '')).slice(0, RECENT_MAX);
  return {
    first_seen: prior.first_seen ?? at,
    probes: (prior.probes ?? 0) + 1,
    answered: (prior.answered ?? 0) + (alive ? 1 : 0),
    last_probed: at,
    last_answered: alive ? at : (prior.last_answered ?? null),
    last_status: status,
    recent,
  };
}

export function summarizeHistory(record) {
  if (!record) return null;
  const recent = record.recent ?? '';
  const answeredRecent = recent.split('').filter((c) => c === '1').length;
  const failing = /^0*/.exec(recent)[0].length;
  return {
    first_seen: record.first_seen,
    probes: record.probes,
    answered: record.answered,
    uptime: record.probes >= 3 ? Number((record.answered / record.probes).toFixed(3)) : null,
    recent: { answered: answeredRecent, of: recent.length },
    consecutive_failures: failing,
    last_answered: record.last_answered,
    last_probed: record.last_probed,
    ...(record.probes < 3 ? { note: 'Too few observations for a rate. This history is built from live probes, so it deepens as the endpoint is asked about.' } : {}),
  };
}

export async function recordObservation(env, target, result, method = 'GET') {
  const key = `${HISTORY_PREFIX}${method}:${target}`;
  const at = new Date().toISOString();
  let previous = null;
  try {
    previous = await env?.PAYMENTS?.get(key, 'json');
  } catch { /* a missing history is a thin history, not an error */ }

  const record = foldObservation(previous, { alive: result.alive, status: result.status, at });
  try {
    await env?.PAYMENTS?.put(key, JSON.stringify(record), { expirationTtl: HISTORY_TTL_S });
  } catch { /* the observation is still returned; only its persistence failed */ }
  return summarizeHistory(record);
}

export async function cachedProbe(env, target, opts = {}) {
  const method = opts.method ?? 'GET';
  const key = `probe:v1:${method}:${target}`;
  try {
    const hit = await env?.PAYMENTS?.get(key, 'json');
    if (hit) return { ...hit, cached: true };
  } catch { /* fall through to a live probe */ }

  const result = await probe(target, opts);
  const history = await recordObservation(env, target, result, method);
  const answer = { ...result, history };
  try {
    await env?.PAYMENTS?.put(key, JSON.stringify(answer), { expirationTtl: PROBE_CACHE_TTL_S });
  } catch { /* the probe already succeeded; failing to cache it is not an error */ }
  return answer;
}

export const __testing = { probeHeaders, decimalsFor, SETTLEMENT_NOTE, MAX_CANDIDATES, HISTORY_PREFIX };

// The router: which machine-payable endpoint should a caller call, is it alive
// right now, and what will it charge — answered by probing, never by paying.
//
// THE INVARIANT, and it is a design constraint rather than a policy:
//
//     This service never pays for anything, and never holds anyone's money.
//
// Kamil's words when choosing this shape over a custodial broker: "I will not
// pay from my own wallet." A broker that *can* pay is a broker that can be
// tricked into paying — by a malicious endpoint, a redirect, or a bug — and the
// deployment therefore holds no key that could sign an EVM transaction at all.
// `worker/signing.js` has an Ed25519 key for RFC 9421 response signatures,
// which cannot spend. There is nothing here to steal and nothing to drain.
//
// Two consequences worth stating, because they are what make the product work:
//
//   1. An unpaid request to a paid endpoint returns its 402, and a 402 carries
//      the endpoint's current terms. Liveness and price come back in the same
//      free request. The expensive-sounding half of this service costs nothing.
//   2. The caller pays the endpoint directly, with its own wallet, against terms
//      it read here. No traffic passes through us, so no operator's per-caller
//      pricing or rate limiting is broken by our being in the middle — because
//      we are not in the middle.
//
// Why the outbound request is built from scratch rather than forwarded: the
// caller's own request may carry an X-PAYMENT authorization made out to *us*.
// Forwarding request headers to an arbitrary third-party host would hand that
// credential to a stranger. The probe sends exactly the headers written below.

import { RETIRED_API_PATHS } from './retired.js';
import { resolveX402 } from '../scripts/x402-config.mjs';
import { urlError } from '../scripts/validate.mjs';

const UA = 'AIProductIndexRouter/1.0 (+https://index.percall.dev/llms.txt; liveness probe — never pays)';
const PROBE_TIMEOUT_MS = 6000;
const MAX_PROBE_BODY = 32 * 1024;
// Probing sends traffic to people who did not ask for it. A short shared cache
// means a popular endpoint is probed once per minute however many callers ask,
// rather than once per caller — the same courtesy the removal route exists for.
export const PROBE_CACHE_TTL_S = 60;
const MAX_CANDIDATES = 5;
const MAX_BODY = 4 * 1024;

// --- per-endpoint history ----------------------------------------------------
//
// "Does it answer right now" is one probe. "Has it answered the last 30 times"
// is the question an operator actually buys, and neither the Bazaar nor the MCP
// registry can answer it about anybody.
//
// The weekly cron cannot answer it either, and it is worth saying why rather
// than discovering it later: `scripts/probe-catalogs.mjs` walks a rotating slice
// of 600 per catalog, so a full pass over 14,661 x402 endpoints takes ~24 weeks
// and any single endpoint is seen about twice a year. It also only stores the
// failures. That is the right design for "what share of the catalog is dead" and
// the wrong one for "is this endpoint reliable".
//
// So history is fed by the live probes instead: every real probe this Worker
// makes is an observation, they are free (the 402 IS the answer), and they land
// on exactly the endpoints somebody cared enough to ask about. The paid answer
// gets better the more the service is used, which is the right way round.
//
// KV, not the committed data files, because the Worker cannot commit — and a
// 24,741-entry history file rewritten weekly would be a megabyte of churn in
// git for data that changes by the minute.
const HISTORY_PREFIX = 'probe:hist:v1:';
// Long enough that a quarterly-checked endpoint keeps its record, short enough
// that endpoints nobody ever asks about again do not accumulate forever.
const HISTORY_TTL_S = 180 * 24 * 3600;
// Newest first. 30 because "29 of the last 30" is the sentence this exists to
// support, and because a bounded string cannot grow a KV value without limit.
export const RECENT_MAX = 30;

// Headers a probe is allowed to send. An allowlist, not a denylist: the failure
// this prevents is forwarding something we never thought about.
const probeHeaders = (accept = 'application/json, */*') => ({ 'user-agent': UA, accept });

/** Payment-bearing headers, in both x402 versions. Never sent outbound. */
export const PAYMENT_HEADERS = ['x-payment', 'payment-signature'];

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

// --- reading someone else's 402 ---------------------------------------------

const b64json = (value) => {
  try {
    return JSON.parse(atob(String(value)));
  } catch {
    return null;
  }
};

/**
 * Assets whose decimals we can state rather than assume. An amount is always
 * reported in atomic units because that is what the endpoint said; a human
 * price appears only when the asset is one we can name, because dividing by a
 * guessed 10^6 is how a caller ends up reading $0.05 as $50.
 */
function decimalsFor(assetAddress, cfg) {
  const known = new Map();
  for (const profile of Object.values(cfg?.payments?.x402?.profiles ?? {})) {
    if (profile.asset) known.set(profile.asset.toLowerCase(), profile.asset_decimals ?? 6);
  }
  return known.get(String(assetAddress ?? '').toLowerCase()) ?? null;
}

/**
 * Normalise a payment challenge into one shape, whichever version wrote it.
 *
 * v2 puts the challenge in the PAYMENT-REQUIRED header as base64 JSON with
 * `amount`; v1 puts it in the body with `maxAmountRequired` and a network
 * *name* instead of a CAIP-2 id. Plenty of endpoints answer with one, some with
 * both, and some with a 402 carrying neither — a bare 402 is still a useful
 * answer ("paid, terms unreadable"), so it is reported rather than discarded.
 */
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
      // Null, not a guess. See decimalsFor.
      price: decimals === null || !/^\d+$/.test(amountAtomic)
        ? null
        : Number(amountAtomic) / 10 ** decimals,
      price_decimals: decimals,
      max_timeout_seconds: a.maxTimeoutSeconds ?? null,
    });
  }
  return terms.length ? terms : null;
}

// --- probing ----------------------------------------------------------------

/**
 * One unpaid request. Returns what happened, never throws.
 *
 * `alive` means the host answered with an HTTP response of any kind — a 402 is
 * the *successful* outcome here, and so is a 405 from probing a POST-only
 * endpoint with GET. It is deliberately not "returned 200": for a paid endpoint
 * a 200 to an unpaid request would mean the paywall is broken.
 */
/**
 * The MCP handshake, sent as the probe body for MCP candidates.
 *
 * A GET to an MCP endpoint proves only that a host answered — usually 405. The
 * question worth selling is "does an MCP client get a session", and the honest
 * way to ask it is to perform the first half of one. `initialize` is the
 * protocol's opening call, it is free, and a server that answers it with a
 * result is genuinely usable rather than merely reachable.
 */
/**
 * Did the server complete the opening half of an MCP session?
 *
 * Three outcomes, kept apart because they mean different things to a caller:
 * `ok` — a JSON-RPC result came back, so a client would get a session;
 * `auth` — it wants credentials (401/403), which proves a real server is there
 * and is a *pass* for liveness even though this caller cannot use it; and
 * `no` with the reason, for everything else. A registry entry that 404s and one
 * that demands a token are both "not usable by me" and only one is abandoned.
 */
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
      // Built here, never derived from the caller's request. See the file header.
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
      // Present only for an MCP probe. `alive` says a host answered; this says
      // the server completed the opening half of a session, which is the thing
      // an MCP client actually needs and the registry never checks.
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

/**
 * Our own hosts are answered from configuration instead of fetched.
 *
 * Not an optimisation — a Worker cannot fetch its own hostnames and Cloudflare
 * answers 522, which this codebase has now paid for twice (see score.js
 * canonicalTarget). Our terms are a thing we know rather than a thing we
 * discover, so a probe of them is a lookup.
 */
export function selfTerms(target, cfg) {
  // Same derived list as score.js canonicalTarget, and for the same reason: a
  // probe of our own hostname is a 522, and the Router's own host is the one
  // most likely to be probed by someone testing what the Router does.
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
    // Present and null rather than absent, so the shape does not change under
    // the caller depending on whose endpoint they asked about. There is no
    // history because this was not a probe — it is our own configuration.
    history: null,
  };
}

// --- the paid endpoints ------------------------------------------------------

/** Terms shown in the 402 for both routes, so a caller can read the price first. */
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

// Repeated on every answer because it is the product's whole shape, and a
// caller reading one JSON body should not have to have read the docs to know
// that the URL it is being handed is one it pays itself.
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
  // Which corpus to route into. The MCP registry is worse than the Bazaar at
  // pruning dead entries, so "which of these 10,080 servers still answers" is
  // the more valuable question of the two and was going unasked.
  const catalog = body.catalog === 'mcp' ? 'mcp' : 'x402';
  if (catalog === 'mcp' && maxPrice !== null) {
    return { error: 'max_price: MCP servers are not priced per call; drop it or set catalog to "x402"' };
  }
  return { q, limit, maxPrice, chain, catalog };
}

/**
 * GET /api/liveness?url=… — is this endpoint alive, and what does it charge?
 *
 * The paid half of the product is *freshness*. The catalogs and their weekly
 * aggregates stay free and always will; what cannot be got for free anywhere is
 * whether the thing answers right now, at the price it quotes right now. The
 * Bazaar keeps an entry for 30 days after its last settlement, so "listed" and
 * "answers" are different facts and only one of them was ever published.
 */
export async function handleLiveness(request, env, cfg, { gate, fetchImpl = fetch } = {}) {
  const url = new URL(request.url);
  if (request.method !== 'GET') {
    return json({ ok: false, code: 'method_not_allowed', error: 'GET /api/liveness?url=https://example.com/paid' }, 405, { allow: 'GET' });
  }
  // Validated BEFORE charging — nobody pays for a request we would reject.
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

/**
 * POST /api/route — which endpoint should I call for this, and what will it cost?
 *
 * Ranking is the catalog's own (relevance, then price), re-sorted so that
 * endpoints proven alive by this request outrank ones that did not answer. A
 * dead endpoint is reported rather than dropped: the caller asked what exists,
 * and silently returning three results when five matched hides the state of the
 * network the caller is trying to use.
 */
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

  // Candidates come from the real catalog search handler rather than a second
  // ranking implementation, for the same reason score_url proxies /api/score:
  // two rankings that can disagree is a bug waiting for a support ticket.
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
    // A dead end that teaches something, the same way /api/search's does.
    return json({
      ok: true, query: parsed.q, count: 0, candidates: [],
      note: `Nothing in ${found.catalog?.endpoints ?? 'the'} catalogued endpoints matched. Widen the query, raise max_price, or drop the chain filter.`,
      catalog: found.catalog,
    });
  }

  // Charged after the catalog answered, so a query that matches nothing is free.
  const paid = await gate(ROUTE_RESOURCES.route);
  if (!paid.ok) return paid.response;

  const probes = await Promise.all(found.results.map(async ({ price, ...candidate }) => {
    const mine = selfTerms(candidate.url, cfg);
    return {
      ...candidate,
      // Renamed on the way out: `price` alongside a live quote reads as the
      // current one, and it is the catalog's last recorded value. The two
      // disagreeing is the most useful thing this endpoint can show a caller.
      catalog_price: price ?? null,
      probe: mine ?? await cachedProbe(env, candidate.url, parsed.catalog === 'mcp'
        // An MCP server is probed by starting a session, not by knocking: a GET
        // returns 405 from a perfectly healthy one, which would grade the whole
        // registry "alive" and tell a caller nothing it did not already know.
        ? { fetchImpl, cfg, method: 'POST', body: MCP_INITIALIZE }
        : { fetchImpl, cfg, method: candidate.method || 'GET' }),
    };
  }));

  // Alive first, then the live quote if there is one, then catalog order.
  const rank = (c) => {
    if (!c.probe.alive) return 2;
    // An MCP server that answered but refused the handshake is reachable and
    // unusable; it ranks below one that gave a session and above a dead host.
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

/**
 * Fold one observation into an endpoint's record.
 *
 * Pure, so the accounting is testable without a KV binding. `recent` is a
 * newest-first string of 1s and 0s — compact enough to keep 30 of them in a
 * value that also has to hold everything else, and it answers "the last N" for
 * any N ≤ 30 without storing timestamps for each.
 */
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

/**
 * The record as a caller should read it.
 *
 * `uptime` is deliberately absent below 3 observations. One probe makes a 0% or
 * 100% uptime that is technically true and practically a lie, and a caller
 * choosing between endpoints will compare those numbers whatever the sample
 * size — so the honest move is to publish the counts and withhold the ratio
 * until it means something.
 */
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
    // Said out loud, because "answered 1 of 1" invites a conclusion it cannot
    // support. Observations accumulate from real calls, so a rarely-asked-about
    // endpoint has a thin record and should say so.
    ...(record.probes < 3 ? { note: 'Too few observations for a rate. This history is built from live probes, so it deepens as the endpoint is asked about.' } : {}),
  };
}

/** Read, fold and write one observation. Best-effort: never fails a probe. */
export async function recordObservation(env, target, result, method = 'GET') {
  const key = `${HISTORY_PREFIX}${method}:${target}`;
  const at = new Date().toISOString();
  let previous = null;
  try {
    previous = await env?.PAYMENTS?.get(key, 'json');
  } catch { /* a missing history is a thin history, not an error */ }

  const record = foldObservation(previous, { alive: result.alive, status: result.status, at });
  try {
    // KV writes are the metered resource here, and a history write is one per
    // *real* probe rather than per request — the 60-second cache already
    // collapses a burst of callers into a single observation, which is both the
    // courtesy to the endpoint and the reason this stays cheap.
    await env?.PAYMENTS?.put(key, JSON.stringify(record), { expirationTtl: HISTORY_TTL_S });
  } catch { /* the observation is still returned; only its persistence failed */ }
  return summarizeHistory(record);
}

/**
 * A probe, shared for a minute across every caller asking about the same URL.
 *
 * KV rather than the cache API because the point is to be kind to the endpoint
 * being probed, not to be fast for us — and KV is shared across colos where the
 * cache is not. A KV failure falls through to a live probe: a courtesy cache
 * that can take the feature down with it is worse than no cache.
 *
 * A cache hit is explicitly NOT an observation. Counting one would let a single
 * popular endpoint accumulate a flattering history from one real request, which
 * is the opposite of what the number is for.
 */
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

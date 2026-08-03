// AI Product Index — Cloudflare Worker.
//
// Everything here is something GitHub Pages structurally could not do:
//   * per-request telemetry (Pages gave zero logs, so "do agents use this?"
//     was unanswerable)
//   * custom response headers and Accept-based content negotiation (the two
//     agent-readiness checks that capped the audit at 81/100)
//   * HTTP 402 payment gating for the paid audit endpoint
// Static assets are served by the ASSETS binding; this Worker only owns the
// dynamic routes and the header layer on top.

import cfg from '../site.config.json' with { type: 'json' };
// The committed registry, so /badge.svg answers from the bundle rather than
// fetching its own API. Deploys follow accepted registrations, so it is current.
import registry from '../api/index.json' with { type: 'json' };
// Grades refreshed weekly by scripts/score-listings.mjs, committed so the badge
// stays an O(1) lookup rather than an audit per README view.
import scores from '../scores.json' with { type: 'json' };
import { classifyUserAgent, classifyPath } from './classify.js';
import { auditUrl, parseAuditRequest, CHECK_META, V2_WEIGHTS } from './audit.js';
import { handleStats } from './stats.js';
import { handleScore, fetcherFor, auditSigner, canonicalTarget } from './score.js';
import { requirePayment, attachSettlement, paymentRequirements } from './x402.js';
import { alternatesFor, negotiate, alternateContentType } from './negotiate.js';
import { fetchAsset, decorate, serveStatic } from './assets.js';
import { resolveX402 } from '../scripts/x402-config.mjs';
import { handleRevenue, authorizeDashboard, sessionCookie } from './revenue.js';
import { signResponse, keyDirectory, DIRECTORY_PATH, DIRECTORY_CONTENT_TYPE } from './signing.js';
import { handleBadge } from './badge.js';
import { handleSearch, handleAsk, handleMcp, handleCatalogSearch, CATALOGS } from './discovery.js';
import { handleLiveness, handleRoute, ROUTE_RESOURCES, probe } from './route.js';
import { handleWatch, handleSweep, MAX_SWEEPS } from './watch.js';
import { urlError } from '../scripts/validate.mjs';

const BASE = cfg.base.replace(/\/+$/, '');
const CANONICAL_HOST = new URL(BASE).host;
// The umbrella domain. Unlike the other host aliases it is not a retired name:
// its root serves the portfolio page that says what runs under it. Everything
// else on that host still redirects, so exactly one copy of the content exists.
const APEX_HOST = cfg.apex_host ?? null;
// The Router's own hostname. Empty until the custom domain is attached, and
// empty means precisely today's behaviour — see the note in site.config.json.
const ROUTER_HOST = cfg.router_host || null;
// The three paths the Router host owns. Everything else on it redirects to the
// canonical host, for the same reason the apex only serves its root: content
// with two addresses is content a directory can record at the wrong one, and
// that discipline has already cost a round of upstream corrections.
const ROUTER_PATHS = new Set(['/api/liveness', '/api/route']);
const isRoot = (url) => url.pathname === '/' || url.pathname === '/index.html';
const isApexRoot = (url) => Boolean(APEX_HOST) && url.host === APEX_HOST && isRoot(url);
// Where the Router's endpoints live, for anything that has to print the URL
// rather than answer at it. Falls back to the canonical host while unattached.
const ROUTER_BASE = ROUTER_HOST ? `https://${ROUTER_HOST}` : BASE;
const isRouterHost = (url) => Boolean(ROUTER_HOST) && url.host === ROUTER_HOST;
const isRouterRoot = (url) => isRouterHost(url) && isRoot(url);
/** True for a request the Router host answers itself rather than redirecting. */
const isRouterOwned = (url) => isRouterHost(url) && (isRoot(url) || ROUTER_PATHS.has(url.pathname));
const MAX_AUDIT_BODY = 4 * 1024;

// Derived from the catalog declarations rather than written out, so adding a
// catalog cannot leave its search route unrouted.
const CATALOG_SEARCH = Object.fromEntries(
  Object.entries(CATALOGS).map(([key, spec]) => [`/api/${spec.path}/search`, key]),
);

// One canonical hostname; every other host attached to this Worker (the
// pre-migration index.kc-it.pl, the percall.dev apex) answers 308 to it. 308
// rather than 301 because it preserves the method and body, so an in-flight
// x402 POST survives the hop instead of being degraded to a GET.
function canonicalRedirect(url) {
  if (url.host === CANONICAL_HOST) {
    // The Router's endpoints have exactly one home too, and once it exists it
    // is not this host. 308 preserves method and body, so a caller that POSTs
    // /api/route here — or retries one with a payment header — arrives intact
    // rather than being degraded to a GET and charged for nothing.
    if (ROUTER_HOST && ROUTER_PATHS.has(url.pathname)) {
      return new Response(null, {
        status: 308,
        headers: {
          location: `https://${ROUTER_HOST}${url.pathname}${url.search}`,
          'cache-control': 'public, max-age=3600',
        },
      });
    }
    return null;
  }
  // The Router host answers for its root and its two endpoints; every other
  // path on it belongs to the canonical host and says so.
  if (isRouterOwned(url)) return null;
  // The apex root is a page, not a redirect. Only the root: a request for any
  // other path on the apex is asking for content that has one canonical home.
  if (isApexRoot(url)) return null;
  // www belongs to the apex, not to the service. Sending www.percall.dev to the
  // index would hand someone who typed the umbrella domain a different page than
  // the umbrella domain serves. Its root goes to the apex; every other path goes
  // straight to the canonical host, so neither case costs two hops.
  if (APEX_HOST && url.host === `www.${APEX_HOST}` && isRoot(url)) {
    return new Response(null, {
      status: 308,
      headers: { location: `https://${APEX_HOST}/`, 'cache-control': 'public, max-age=3600' },
    });
  }
  return new Response(null, {
    status: 308,
    headers: {
      location: new URL(url.pathname + url.search, BASE).href,
      'cache-control': 'public, max-age=3600',
    },
  });
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

// --- measurement -----------------------------------------------------------

function record(env, request, url, clientType, status) {
  if (!env.ANALYTICS) return;
  const ua = request.headers.get('user-agent') ?? '';
  try {
    env.ANALYTICS.writeDataPoint({
      // No IP address and no full request URL — only a bucketed path.
      blobs: [
        classifyPath(url.pathname, { apex: isApexRoot(url) }),
        clientType,
        request.method,
        `${Math.floor(status / 100)}xx`,
        ua.slice(0, 200),
        request.cf?.asOrganization ?? 'unknown',
        // Which of this Worker's hostnames was asked. A bounded set of five, and
        // the only way to answer "is the umbrella getting traffic, and is anyone
        // still arriving on the retired host" — a path bucket cannot, because
        // every host serves the same paths. Rows written before 2026-08-02 have
        // no value here and report as `unrecorded` rather than as a real host.
        //
        // `hostname`, not `host`: host carries the port, and Cloudflare answers
        // on 8443/8080 as well as 443. Port scanners duly produced
        // `router.percall.dev:8443` and `www.percall.dev:8080` as separate rows,
        // which splits a host's real traffic across entries and invents hosts
        // that do not exist. The port is not a dimension anyone asks about here.
        url.hostname,
      ],
      doubles: [1, status, request.cf?.asn ?? 0],
      indexes: [clientType],
    });
  } catch {
    // Telemetry must never break a response.
  }
}

// --- asset layer -----------------------------------------------------------


// --- paid route ------------------------------------------------------------

// What this endpoint takes and returns, in the shape the CDP facilitator reads
// off a settlement to build a Bazaar listing. `discoverable: true` is the opt
// in — without it the endpoint settles payments perfectly well and is never
// catalogued, which is exactly what happened here for four settlements.
//
// It doubles as machine-readable API documentation in every 402 challenge, so
// an agent learns the request shape from the refusal rather than from prose.
const AUDIT_SCHEMA = {
  input: {
    type: 'http',
    method: 'POST',
    discoverable: true,
    bodyType: 'json',
    body: {
      url: {
        type: 'string',
        required: true,
        description: 'Absolute http(s) URL of the page to audit. Redirects are followed; the response is not stored.',
      },
    },
  },
  output: {
    type: 'object',
    properties: {
      ok: { type: 'boolean', description: 'False when the target could not be fetched; the response is then HTTP 502.' },
      url: { type: 'string', description: 'The URL that was audited, after redirects.' },
      audited_at: { type: 'string', description: 'ISO 8601 timestamp of the audit.' },
      score: { type: 'number', description: 'Agent-readability score, 0–100.' },
      max_score: { type: 'number', description: 'Always 100.' },
      letter: { type: 'string', description: 'Letter grade A–F derived from the score.' },
      grade: { type: 'string', description: 'Plain-language grade, e.g. "agent-ready".' },
      passed: { type: 'number', description: 'How many checks passed.' },
      total_checks: { type: 'number', description: 'How many checks were run.' },
      checks: { type: 'array', description: 'Every check: id, label, pass, weight, a human-readable detail, and a paste-ready snippet.' },
      next_steps: { type: 'array', description: 'Failing checks ranked by weight, each with its fix and snippet.' },
    },
  },
};

async function handleAudit(request, env, cfgObj) {
  if (request.method !== 'POST') {
    return json({ ok: false, code: 'method_not_allowed', error: 'POST a JSON body like {"url": "https://example.com"}' }, 405, { allow: 'POST' });
  }

  const raw = await request.clone().text();
  if (raw.length > MAX_AUDIT_BODY) {
    return json({ ok: false, code: 'too_large', error: `body larger than ${MAX_AUDIT_BODY} bytes` }, 413);
  }
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch (e) {
    return json({ ok: false, code: 'bad_json', error: `invalid JSON: ${e.message.slice(0, 200)}` }, 400);
  }
  // Validate BEFORE charging — nobody should pay for a request we would reject.
  const parsed = parseAuditRequest(body);
  if (parsed.error) return json({ ok: false, code: 'invalid', errors: [parsed.error] }, 400);

  const price = resolveX402(cfgObj)?.audit_price_atomic;
  const gate = await requirePayment(request, env, cfgObj, {
    amountAtomic: price,
    resource: {
      url: `${BASE}/api/audit`,
      description: 'Agent-readability audit of one URL: llms.txt, schema.org JSON-LD, robots.txt AI-crawler posture, agent card, machine-readable alternates.',
      mimeType: 'application/json',
      outputSchema: AUDIT_SCHEMA,
    },
  });
  if (!gate.paid) return gate.response;

  const target = canonicalTarget(parsed.url, cfgObj);
  const result = await auditUrl(target, fetcherFor(request, env, target), auditSigner(env, cfgObj), parsed.checkSet);
  const status = result.ok ? 200 : 502;
  return attachSettlement(json(result, status), gate.settlement, gate.version);
}

/**
 * The payment gate the router endpoints use, as a closure over one request.
 *
 * They need the gate at a different moment than the audit does — /api/route
 * charges only after the catalog has found something, so a query that matches
 * nothing is free — so the gate is passed in rather than called inline. The
 * money path is still `requirePayment` + `attachSettlement`, unchanged: there is
 * one implementation of taking a payment here and this is not a second.
 */
const routeGate = (request, env, cfgObj, resourceUrl, method) => async (resource) => {
  const gate = await requirePayment(request, env, cfgObj, {
    amountAtomic: resolveX402(cfgObj)?.route_price_atomic,
    resource: { url: resourceUrl, method, ...resource },
  });
  return gate.paid
    ? { ok: true, attach: (response) => attachSettlement(response, gate.settlement, gate.version) }
    : { ok: false, response: gate.response };
};

/**
 * GET /api/check?url=…&check=<id> — one check, bought on its own.
 *
 * The unbundling the market was already doing and we were not. Competitors sell
 * a single signal — robots.txt posture, llms.txt validity — for half a cent,
 * while this site sold twenty checks for five cents or nothing. That is the
 * wrong shape against a caller who has *already been told by the free grade
 * which check failed*: at that moment the only thing left to sell is the fix
 * for that one check, and $0.05 for nineteen they did not ask about is a bad
 * trade they decline.
 *
 * The audit runs whole regardless — the checks share fetches, so running one in
 * isolation would cost the same and tell us less. What is sold is the answer,
 * not the work.
 */
async function handleCheck(request, env, cfgObj, url) {
  if (request.method !== 'GET') {
    return json({ ok: false, code: 'method_not_allowed', error: 'GET /api/check?url=https://example.com&check=llms_txt' }, 405, { allow: 'GET' });
  }
  const target = url.searchParams.get('url');
  const id = (url.searchParams.get('check') ?? '').trim();

  // Both validated before charging. A typo in `check` is the likeliest caller
  // error here and it must not cost money — so the valid ids ship in the 400.
  const parsed = parseAuditRequest({ url: target, checks: url.searchParams.get('set') ?? url.searchParams.get('checks') });
  if (parsed.error) return json({ ok: false, code: 'invalid', errors: [parsed.error] }, 400);

  const known = new Set([...Object.keys(CHECK_META), ...Object.keys(V2_WEIGHTS)]);
  if (!known.has(id)) {
    return json({
      ok: false,
      code: 'unknown_check',
      error: id ? `no check "${id.slice(0, 40)}"` : 'the `check` parameter is required',
      valid: [...known].sort(),
      free_alternative: `${BASE}/api/score?url=…  — names every failing check, at no cost, so you know which one to buy`,
    }, 400);
  }

  const gate = await requirePayment(request, env, cfgObj, {
    amountAtomic: resolveX402(cfgObj)?.check_price_atomic,
    resource: {
      url: `${BASE}/api/check`,
      method: 'GET',
      description: 'One agent-readability check for one URL: whether it passes, why it fails, and a paste-ready fix written for that origin. The full 20-check audit is POST /api/audit.',
      mimeType: 'application/json',
    },
  });
  if (!gate.paid) return gate.response;

  const target2 = canonicalTarget(parsed.url, cfgObj);
  const result = await auditUrl(target2, fetcherFor(request, env, target2), auditSigner(env, cfgObj), parsed.checkSet);
  if (!result.ok) return attachSettlement(json(result, 502), gate.settlement, gate.version);

  const check = result.checks.find((c) => c.id === id);
  if (!check) {
    // The id is known but this check set does not score it — v1 does not score
    // the 2026 signals. Say which set was used rather than reporting "missing".
    return attachSettlement(json({
      ok: false,
      code: 'not_in_check_set',
      error: `"${id}" is not scored by check set ${result.check_set}`,
      check_set: result.check_set,
    }, 409), gate.settlement, gate.version);
  }

  return attachSettlement(json({
    ok: true,
    url: result.url,
    audited_at: result.audited_at,
    check_set: result.check_set,
    check,
    // The context that makes one check purchasable rather than a fragment: what
    // it is worth, and what the whole grade was, so a caller can decide whether
    // to buy another.
    grade: { letter: result.letter, score: result.score, max_score: result.max_score },
    full_audit: `${BASE}/api/audit`,
  }), gate.settlement, gate.version);
}

// --- public payment terms --------------------------------------------------

// Lets an agent read the price without provoking a 402. Everything here is
// already published in the payment challenge, so nothing new is disclosed —
// it just saves a wasted request, and gives a Bazaar crawler something to read.
function handleX402Info(cfgObj) {
  const rail = resolveX402(cfgObj);
  if (!rail) {
    return json({
      ok: false,
      code: 'payments_not_enabled',
      error: 'the x402 rail is not fully configured yet',
      protocol: 'https://docs.x402.org',
    }, 503);
  }
  return json({
    ok: true,
    protocol: 'x402',
    // Both versions are accepted. A v2 client sends PAYMENT-SIGNATURE and reads
    // the PAYMENT-REQUIRED header; a v1 client sends X-PAYMENT and reads the
    // 402 body, where the terms appear under v1's own field names.
    x402Versions: rail.network_v1 ? [2, 1] : [2],
    x402Version: 2,
    network: rail.network,
    network_v1: rail.network_v1 || undefined,
    asset: rail.asset,
    asset_name: rail.asset_name,
    payTo: rail.payTo,
    resources: [{
      url: `${BASE}/api/audit`,
      method: 'POST',
      amount: rail.audit_price_atomic,
      description: 'Agent-readability audit of one URL.',
    }, {
      url: `${BASE}/api/check`,
      method: 'GET',
      amount: rail.check_price_atomic,
      description: 'One agent-readability check for one URL: pass/fail, why, and a paste-ready fix for that origin. The free grade at /api/score names which checks failed, so you know which one to buy.',
    }, {
      url: `${BASE}/api/watch`,
      method: 'POST',
      amount_per_sweep: rail.watch_sweep_price_atomic,
      max_sweeps: MAX_SWEEPS,
      description: 'Watch one endpoint; a webhook fires when it stops or starts answering. Prepaid sweeps rather than a subscription — x402 has no recurring billing and a stored mandate would be custody. Total = sweeps x amount_per_sweep.',
    }, {
      url: `${ROUTER_BASE}/api/liveness`,
      method: 'GET',
      amount: rail.route_price_atomic,
      description: ROUTE_RESOURCES.liveness.description,
    }, {
      url: `${ROUTER_BASE}/api/route`,
      method: 'POST',
      amount: rail.route_price_atomic,
      description: ROUTE_RESOURCES.route.description,
    }],
    explorer: rail.explorer,
    docs: `${BASE}/llms.txt`,
  }, 200, { 'cache-control': 'public, max-age=300' });
}

// --- private dashboard -----------------------------------------------------

// The page shell is private too, not just the data behind it. An unauthorized
// request gets the ordinary 404 rather than a 401, so the dashboard's existence
// is not disclosed to anyone probing the site — robots.txt and a noindex meta
// are advisory, this is not.
async function handleDashboardPage(request, env, url) {
  const auth = authorizeDashboard(request, env);
  if (auth.state !== 'ok') {
    const notFound = await fetchAsset(env, new URL('/404.html', url.origin), new Headers(request.headers));
    return new Response(notFound.body, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
    });
  }

  const page = await fetchAsset(env, new URL('/dashboard.html', url.origin), new Headers(request.headers));
  const headers = new Headers(page.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-robots-tag', 'noindex, nofollow');
  // Trade the one-time ?token= for a session cookie, so reloads work and the
  // token stops travelling in URLs (and therefore in history and referrers).
  if (auth.viaQuery) headers.append('set-cookie', sessionCookie(env.DASHBOARD_TOKEN));
  return new Response(page.body, { status: page.status, headers });
}

// --- router ----------------------------------------------------------------

export const __testing = { fetchAsset, decorate, canonicalRedirect, AUDIT_SCHEMA };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const clientType = classifyUserAgent(request.headers.get('user-agent'));

    const redirect = canonicalRedirect(url);
    if (redirect) {
      record(env, request, url, clientType, 308);
      return redirect;
    }

    let response;
    try {
      if (url.pathname === '/api/audit') {
        response = await handleAudit(request, env, cfg);
      } else if (url.pathname === DIRECTORY_PATH) {
        // Discovery for RFC 9421 verifiers. 404 rather than an empty key set when
        // unkeyed: advertising a directory with no keys in it is worse than not
        // advertising one.
        const directory = await keyDirectory(env);
        response = directory
          ? new Response(JSON.stringify(directory, null, 2) + '\n', {
            headers: {
              'content-type': DIRECTORY_CONTENT_TYPE,
              'cache-control': 'public, max-age=3600',
              'x-content-type-options': 'nosniff',
            },
          })
          : json({ ok: false, code: 'signing_not_enabled', error: 'no response-signing key is configured' }, 404);
      } else if (url.pathname === '/badge.svg') {
        response = handleBadge(url, registry.listings ?? [], scores);
      } else if (url.pathname === '/api/watch') {
        response = await handleWatch(request, env, cfg, {
          base: BASE,
          urlError,
          // The amount depends on how many sweeps were bought, so the gate is
          // handed the count rather than a fixed price — and it hands back the
          // payer address, which is what makes the watch have an owner without
          // anyone signing up for anything.
          gate: async (sweeps) => {
            const rail = resolveX402(cfg);
            const unit = Number(rail?.watch_sweep_price_atomic ?? 0);
            const g = await requirePayment(request, env, cfg, {
              amountAtomic: unit ? String(unit * sweeps) : undefined,
              resource: {
                url: `${BASE}/api/watch`,
                method: 'POST',
                description: `Watch one endpoint and POST a webhook when it stops (or starts) answering. Prepaid: one payment buys N weekly sweeps, ${sweeps} here. No subscription and no stored mandate — nothing is charged again without you signing for it.`,
                mimeType: 'application/json',
              },
            });
            return g.paid
              ? { ok: true, payer: g.settlement?.payer ?? null, attach: (r) => attachSettlement(r, g.settlement, g.version) }
              : { ok: false, response: g.response };
          },
        });
      } else if (url.pathname === '/api/watch/sweep') {
        response = await handleSweep(request, env, {
          probe,
          cfg,
          // Same bearer as the revenue dashboard, and the same 404-not-401
          // posture: an unauthorized caller learns nothing about what exists.
          authorized: authorizeDashboard(request, env).state === 'ok',
        });
      } else if (url.pathname === '/api/check') {
        response = await handleCheck(request, env, cfg, url);
      } else if (url.pathname === '/api/liveness') {
        // The challenge names the URL the caller actually asked for, not a
        // hardcoded host: once the Router has its own hostname the resource in
        // the 402 must be that one, or the terms describe a different endpoint
        // than the one being bought.
        response = await handleLiveness(request, env, cfg, {
          gate: routeGate(request, env, cfg, `${url.origin}${url.pathname}`, 'GET'),
        });
      } else if (url.pathname === '/api/route') {
        response = await handleRoute(request, env, cfg, {
          gate: routeGate(request, env, cfg, `${url.origin}${url.pathname}`, 'POST'),
          catalogSearch: (key, searchUrl) => handleCatalogSearch(key, searchUrl, env, BASE),
          base: BASE,
        });
      } else if (url.pathname === '/api/score') {
        response = await handleScore(request, env, cfg, resolveX402(cfg));
      } else if (url.pathname === '/api/search') {
        response = handleSearch(url, registry.listings ?? [], BASE);
      } else if (url.pathname === '/ask') {
        response = await handleAsk(request, registry.listings ?? [], BASE);
      } else if (CATALOG_SEARCH[url.pathname]) {
        response = await handleCatalogSearch(CATALOG_SEARCH[url.pathname], url, env, BASE);
      } else if (url.pathname === '/mcp') {
        // score_url goes back through the real /api/score handler rather than
        // calling the auditor directly, so an MCP caller gets the same cache,
        // the same validation and the same grade a browser would.
        const scoreUrl = async (target) => {
          const proxied = new Request(`${BASE}/api/score?url=${encodeURIComponent(target)}`, { headers: request.headers });
          return (await handleScore(proxied, env, cfg, resolveX402(cfg))).json();
        };
        response = await handleMcp(request, {
          listings: registry.listings ?? [],
          base: BASE,
          scoreUrl,
          catalogSearch: (key, searchUrl) => handleCatalogSearch(key, searchUrl, env, BASE),
        });
      } else if (url.pathname === '/api/stats.json') {
        response = await handleStats(env);
      } else if (url.pathname === '/api/x402/info') {
        response = handleX402Info(cfg);
      } else if (url.pathname === '/api/revenue.json') {
        response = await handleRevenue(request, env, resolveX402(cfg));
      } else if (url.pathname === '/dashboard.html' || url.pathname === '/dashboard') {
        response = await handleDashboardPage(request, env, url);
      } else if (isRouterRoot(url)) {
        // Same shared-asset trick as the apex: the Router needs no deploy of its
        // own, and the page's canonical names the Router host, so the same asset
        // being reachable at /router.html here is not a second copy.
        response = await serveStatic(env, new URL('/router.html', url.origin), request.headers);
      } else if (isApexRoot(url)) {
        // Served from the shared asset store, so the apex needs no deploy of its
        // own. The page declares its canonical as the apex, which is why the
        // same asset being reachable at /apex.html on the canonical host is not
        // a duplicate.
        response = await serveStatic(env, new URL('/apex.html', url.origin), request.headers);
      } else {
        response = await serveStatic(env, url, request.headers);
      }
    } catch (e) {
      response = json({ ok: false, code: 'internal', error: e.message?.slice(0, 200) ?? 'internal error' }, 500);
    }

    ctx.waitUntil(Promise.resolve(record(env, request, url, clientType, response.status)));

    // Last thing before the wire, so the digest covers exactly what ships.
    // Never allowed to fail the response: an unsigned answer beats no answer.
    try {
      response = await signResponse(request, response, env);
    } catch (e) {
      console.error(`response signing failed: ${e.message}`);
    }
    return response;
  },
};

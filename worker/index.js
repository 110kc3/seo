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
import { auditUrl, parseAuditRequest } from './audit.js';
import { handleStats } from './stats.js';
import { handleScore, fetcherFor, auditSigner, canonicalTarget } from './score.js';
import { requirePayment, attachSettlement, paymentRequirements } from './x402.js';
import { alternatesFor, negotiate, alternateContentType } from './negotiate.js';
import { resolveX402 } from '../scripts/x402-config.mjs';
import { handleRevenue, authorizeDashboard, sessionCookie } from './revenue.js';
import { signResponse, keyDirectory, DIRECTORY_PATH, DIRECTORY_CONTENT_TYPE } from './signing.js';
import { handleBadge } from './badge.js';
import { handleSearch, handleAsk, handleMcp, handleX402Search } from './discovery.js';

const BASE = cfg.base.replace(/\/+$/, '');
const CANONICAL_HOST = new URL(BASE).host;
const MAX_AUDIT_BODY = 4 * 1024;

// One canonical hostname; every other host attached to this Worker (the
// pre-migration index.kc-it.pl, the percall.dev apex) answers 308 to it. 308
// rather than 301 because it preserves the method and body, so an in-flight
// x402 POST survives the hop instead of being degraded to a GET.
function canonicalRedirect(url) {
  if (url.host === CANONICAL_HOST) return null;
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
        classifyPath(url.pathname),
        clientType,
        request.method,
        `${Math.floor(status / 100)}xx`,
        ua.slice(0, 200),
        request.cf?.asOrganization ?? 'unknown',
      ],
      doubles: [1, status, request.cf?.asn ?? 0],
      indexes: [clientType],
    });
  } catch {
    // Telemetry must never break a response.
  }
}

// --- asset layer -----------------------------------------------------------

// Workers Assets rewrites `/foo.html` to `/foo` with a 307 (`html_handling`
// defaults to "auto-trailing-slash"). Left to leak, that breaks two things:
//
//   * every published listing URL. The sitemap, canonical tags, JSON-LD @id and
//     llms.txt all say `/l/<slug>.html`, so each one answered 307 rather than
//     200 — a canonical that points at a redirect, on a site whose whole product
//     is being readable to machines and which audits others for exactly this.
//   * the dashboard, fatally. Its handler fetched `/dashboard.html`, got the
//     redirect to `/dashboard`, and returned it verbatim — so `/dashboard`
//     redirected to itself. It was unreachable on every path.
//
// Fixing it here rather than with `html_handling = "none"` keeps `/` serving
// index.html, keeps the published `.html` URLs canonical, and keeps the build
// host-agnostic — the same output still works on plain static hosting, where
// extensionless paths would 404.
async function fetchAsset(env, request, target) {
  const response = await env.ASSETS.fetch(new Request(target, request));
  if (response.status !== 307 && response.status !== 308) return response;
  const location = response.headers.get('location');
  if (!location) return response;
  // Exactly one hop, so a redirect cycle cannot become a loop here.
  return env.ASSETS.fetch(new Request(new URL(location, target), request));
}

// --- header layer ----------------------------------------------------------

// `alternate` is the path content negotiation swapped in, when it did. It is
// needed here because the swap changes what the body *is*, and therefore how it
// must be labelled — see alternateContentType().
function decorate(response, url, alternate = null) {
  const headers = new Headers(response.headers);
  headers.set('link', alternatesFor(BASE, url.pathname));
  headers.set('x-agent-protocol', `${BASE}/llms.txt`);
  // Same pointer under the name agent-readiness auditors actually look for.
  // Both are sent: x-agent-protocol is what existing clients were told to read.
  headers.set('x-agent-welcome', `${BASE}/llms.txt`);
  headers.set('vary', headers.has('vary') ? `${headers.get('vary')}, Accept` : 'Accept');
  if (alternate && response.status === 200) {
    const type = alternateContentType(alternate);
    if (type) headers.set('content-type', type);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

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
  const result = await auditUrl(target, fetcherFor(request, env, target), auditSigner(env, cfgObj));
  const status = result.ok ? 200 : 502;
  return attachSettlement(json(result, status), gate.settlement, gate.version);
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
    const notFound = await fetchAsset(env, new Request(url, { headers: request.headers }), new URL('/404.html', url.origin));
    return new Response(notFound.body, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
    });
  }

  const page = await fetchAsset(env, request, new URL('/dashboard.html', url.origin));
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
      } else if (url.pathname === '/api/score') {
        response = await handleScore(request, env, cfg, resolveX402(cfg));
      } else if (url.pathname === '/api/search') {
        response = handleSearch(url, registry.listings ?? [], BASE);
      } else if (url.pathname === '/ask') {
        response = await handleAsk(request, registry.listings ?? [], BASE);
      } else if (url.pathname === '/api/x402/search') {
        response = await handleX402Search(url, env, BASE);
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
          x402Search: (searchUrl) => handleX402Search(searchUrl, env, BASE),
        });
      } else if (url.pathname === '/api/stats.json') {
        response = await handleStats(env);
      } else if (url.pathname === '/api/x402/info') {
        response = handleX402Info(cfg);
      } else if (url.pathname === '/api/revenue.json') {
        response = await handleRevenue(request, env, resolveX402(cfg));
      } else if (url.pathname === '/dashboard.html' || url.pathname === '/dashboard') {
        response = await handleDashboardPage(request, env, url);
      } else {
        const alternate = negotiate(url.pathname, request.headers.get('accept'));
        const target = alternate ? new URL(alternate, url.origin) : url;
        response = decorate(await fetchAsset(env, request, target), url, alternate);
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

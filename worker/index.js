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
import { classifyUserAgent, classifyPath } from './classify.js';
import { auditUrl, parseAuditRequest } from './audit.js';
import { handleStats } from './stats.js';
import { requirePayment, attachSettlement, paymentRequirements } from './x402.js';
import { alternatesFor, negotiate } from './negotiate.js';
import { resolveX402 } from '../scripts/x402-config.mjs';
import { handleRevenue, authorizeDashboard, sessionCookie } from './revenue.js';

const BASE = cfg.base.replace(/\/+$/, '');
const MAX_AUDIT_BODY = 4 * 1024;

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

// --- header layer ----------------------------------------------------------

function decorate(response, url) {
  const headers = new Headers(response.headers);
  headers.set('link', alternatesFor(BASE, url.pathname));
  headers.set('x-agent-protocol', `${BASE}/llms.txt`);
  headers.set('vary', headers.has('vary') ? `${headers.get('vary')}, Accept` : 'Accept');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// --- paid route ------------------------------------------------------------

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
    },
  });
  if (!gate.paid) return gate.response;

  const result = await auditUrl(parsed.url);
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
    const notFound = await env.ASSETS.fetch(new Request(new URL('/404.html', url.origin), { headers: request.headers }));
    return new Response(notFound.body, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
    });
  }

  const page = await env.ASSETS.fetch(new Request(new URL('/dashboard.html', url.origin), request));
  const headers = new Headers(page.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-robots-tag', 'noindex, nofollow');
  // Trade the one-time ?token= for a session cookie, so reloads work and the
  // token stops travelling in URLs (and therefore in history and referrers).
  if (auth.viaQuery) headers.append('set-cookie', sessionCookie(env.DASHBOARD_TOKEN));
  return new Response(page.body, { status: page.status, headers });
}

// --- router ----------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const clientType = classifyUserAgent(request.headers.get('user-agent'));

    let response;
    try {
      if (url.pathname === '/api/audit') {
        response = await handleAudit(request, env, cfg);
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
        const assetRequest = alternate
          ? new Request(new URL(alternate, url.origin), request)
          : request;
        response = decorate(await env.ASSETS.fetch(assetRequest), url);
      }
    } catch (e) {
      response = json({ ok: false, code: 'internal', error: e.message?.slice(0, 200) ?? 'internal error' }, 500);
    }

    ctx.waitUntil(Promise.resolve(record(env, request, url, clientType, response.status)));
    return response;
  },
};

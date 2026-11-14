
import cfg from '../site.config.json' with { type: 'json' };
import registry from '../api/index.json' with { type: 'json' };
import scores from '../scores.json' with { type: 'json' };
import { classifyUserAgent, classifyPath } from './classify.js';
import { auditUrl, parseAuditRequest } from './audit.js';
import { handleStats } from './stats.js';
import { handleScore, fetcherFor, auditSigner, canonicalTarget } from './score.js';
import { requirePayment, attachSettlement } from './x402.js';
import { alternatesFor, negotiate, alternateContentType } from './negotiate.js';
import { fetchAsset, decorate, serveStatic } from './assets.js';
import { resolveX402 } from '../scripts/x402-config.mjs';
import { handleRevenue, authorizeDashboard, sessionCookie } from './revenue.js';
import { signResponse, keyDirectory, DIRECTORY_PATH, DIRECTORY_CONTENT_TYPE } from './signing.js';
import { handleBadge } from './badge.js';
import { handleSearch, handleAsk, handleMcp, handleCatalogSearch, CATALOGS } from './discovery.js';
import { probe } from './route.js';
import { RETIRED_API_PATHS } from './retired.js';
import { handleSweep } from './watch.js';

const BASE = cfg.base.replace(/\/+$/, '');
const CANONICAL_HOST = new URL(BASE).host;
const APEX_HOST = cfg.apex_host ?? null;
const ROUTER_HOST = cfg.router_host || null;
const ROUTER_PATHS = new Set(['/api/watch/sweep']);
const isRoot = (url) => url.pathname === '/' || url.pathname === '/index.html';
const isApexRoot = (url) => Boolean(APEX_HOST) && url.host === APEX_HOST && isRoot(url);
const isRouterHost = (url) => Boolean(ROUTER_HOST) && url.host === ROUTER_HOST;
const isRouterRoot = (url) => isRouterHost(url) && isRoot(url);
const isRouterOwned = (url) => isRouterHost(url) && (isRoot(url) || ROUTER_PATHS.has(url.pathname));
const MAX_AUDIT_BODY = 4 * 1024;

const CATALOG_SEARCH = Object.fromEntries(
  Object.entries(CATALOGS).map(([key, spec]) => [`/api/${spec.path}/search`, key]),
);

// rather than 301 because it preserves the method and body, so an in-flight
function canonicalRedirect(url) {
  if (RETIRED_API_PATHS.has(url.pathname)) return null;
  if (url.host === CANONICAL_HOST) {
    // Preserve the old private sweep URL; the scheduled job calls the Router directly.
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
  if (isRouterOwned(url)) return null;
  if (isApexRoot(url)) return null;
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


function record(env, request, url, clientType, status) {
  if (!env.ANALYTICS) return;
  const ua = request.headers.get('user-agent') ?? '';
  try {
    env.ANALYTICS.writeDataPoint({
      blobs: [
        classifyPath(url.pathname, { apex: isApexRoot(url) }),
        clientType,
        request.method,
        `${Math.floor(status / 100)}xx`,
        ua.slice(0, 200),
        request.cf?.asOrganization ?? 'unknown',
        url.hostname,
      ],
      doubles: [1, status, request.cf?.asn ?? 0],
      indexes: [clientType],
    });
  } catch {
    // Telemetry must never break a response.
  }
}




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
  if (auth.viaQuery) headers.append('set-cookie', sessionCookie(env.DASHBOARD_TOKEN));
  return new Response(page.body, { status: page.status, headers });
}


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
      if (RETIRED_API_PATHS.has(url.pathname)) {
        response = json({
          ok: false,
          code: 'endpoint_retired',
          error: 'This endpoint has been retired. No payment is accepted.',
          retired_at: '2026-09-05',
          docs: `${BASE}/openapi.yaml`,
          free_score: `${BASE}/api/score`,
          ...(url.pathname === '/api/watch'
            ? { note: 'New watches and top-ups are closed. Existing prepaid weekly sweeps continue until their credits are exhausted.' }
            : {}),
        }, 410);
      } else if (url.pathname === '/api/audit') {
        response = await handleAudit(request, env, cfg);
      } else if (url.pathname === DIRECTORY_PATH) {
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
      } else if (url.pathname === '/api/watch/sweep') {
        response = await handleSweep(request, env, {
          probe,
          cfg,
          authorized: authorizeDashboard(request, env).state === 'ok',
        });
      } else if (url.pathname === '/api/score') {
        response = await handleScore(request, env, cfg, resolveX402(cfg), registry.listings ?? []);
      } else if (url.pathname === '/api/search') {
        response = handleSearch(url, registry.listings ?? [], BASE);
      } else if (url.pathname === '/ask') {
        response = await handleAsk(request, registry.listings ?? [], BASE);
      } else if (CATALOG_SEARCH[url.pathname]) {
        response = await handleCatalogSearch(CATALOG_SEARCH[url.pathname], url, env, BASE);
      } else if (url.pathname === '/mcp') {
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
        response = await serveStatic(env, new URL('/router.html', url.origin), request.headers);
      } else if (isApexRoot(url)) {
        response = await serveStatic(env, new URL('/apex.html', url.origin), request.headers);
      } else {
        response = await serveStatic(env, url, request.headers);
      }
    } catch (e) {
      response = json({ ok: false, code: 'internal', error: e.message?.slice(0, 200) ?? 'internal error' }, 500);
    }

    ctx.waitUntil(Promise.resolve(record(env, request, url, clientType, response.status)));

    try {
      response = await signResponse(request, response, env);
    } catch (e) {
      console.error(`response signing failed: ${e.message}`);
    }
    return response;
  },
};

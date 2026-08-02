// The asset layer and the header layer that sits on it.
//
// Extracted from index.js so that a *same-host self-audit* can go through the
// identical code a stranger's request goes through. That is the whole point of
// the module existing: the alternative was reimplementing content negotiation
// inside score.js, which would be a second copy of the negotiation rules free to
// drift from the real one — the exact failure the MCP tool-list fix removed.
//
// Nothing here is new behaviour. It is the same `fetchAsset` + `decorate` pair
// index.js has always used, in a place score.js can import without a cycle.

import cfg from '../site.config.json' with { type: 'json' };
import { alternatesFor, negotiate, alternateContentType } from './negotiate.js';

const BASE = cfg.base.replace(/\/+$/, '');

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
export async function fetchAsset(env, request, target) {
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
export function decorate(response, url, alternate = null) {
  const headers = new Headers(response.headers);
  headers.set('link', alternatesFor(BASE, url.pathname));
  headers.set('x-agent-protocol', `${BASE}/llms.txt`);
  // Same pointer under the name agent-readiness auditors actually look for.
  // Both are sent: x-agent-protocol is what existing clients were told to read.
  headers.set('x-agent-welcome', `${BASE}/llms.txt`);
  headers.set('vary', headers.has('vary') ? `${headers.get('vary')}, Accept` : 'Accept');
  // RFC 9727 fixes the catalog's URI as extensionless, so the asset store has no
  // extension to infer a type from and labels it as a download. The profile
  // parameter is part of the contract, not decoration: it is how a client knows
  // the linkset it just fetched is an API catalog rather than any other linkset.
  if (url.pathname === '/.well-known/api-catalog' && response.status === 200) {
    headers.set('content-type', 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"');
  }
  if (alternate && response.status === 200) {
    const type = alternateContentType(alternate);
    if (type) headers.set('content-type', type);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Content negotiation, the asset fetch and the header layer as one unit — the
 * fall-through branch of the router, and the only thing a self-audit is allowed
 * to reach.
 *
 * Both callers matter. The public route uses it because that is what it always
 * did; `fetcherFor()` uses it so a self-audit measures the request-time
 * behaviour rather than the committed bytes, which is the difference between
 * reporting markdown negotiation as present and reporting it as absent on a site
 * that serves it correctly to everyone else.
 */
export async function serveStatic(request, env, url) {
  const alternate = negotiate(url.pathname, request.headers.get('accept'));
  const target = alternate ? new URL(alternate, url.origin) : url;
  return decorate(await fetchAsset(env, request, target), url, alternate);
}

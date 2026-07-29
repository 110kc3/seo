// The header and content-negotiation layer — the two agent-readiness checks
// that static hosting cannot satisfy at any price.
//
// Kept free of config imports so it is directly unit-testable under `node --test`.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

/**
 * Builds the `Link:` header advertising the machine-readable twin of a path,
 * so an agent never has to guess a URL.
 */
export function alternatesFor(base, pathname) {
  const links = [`<${base}/llms.txt>; rel="alternate"; type="text/markdown"; title="llms.txt"`];
  if (pathname === '/' || pathname === '/index.html') {
    links.push(`<${base}/api/index.json>; rel="alternate"; type="application/json"; title="Full registry"`);
    links.push(`<${base}/openapi.yaml>; rel="service-desc"; type="application/yaml"`);
  }
  const listing = pathname.match(/^\/l\/([a-z0-9-]+)\.html$/);
  if (listing && SLUG_RE.test(listing[1])) {
    links.push(`<${base}/listings/${listing[1]}.json>; rel="alternate"; type="application/json"; title="This listing"`);
  }
  return links.join(', ');
}

/**
 * Maps an Accept header onto the asset that should be served instead.
 * @returns {string|null} replacement path, or null to serve the request as-is.
 */
export function negotiate(pathname, accept) {
  const a = (accept ?? '').toLowerCase();
  const wantsJson = a.includes('application/json');
  const wantsMarkdown = a.includes('text/markdown') || a.includes('text/plain');
  if (!wantsJson && !wantsMarkdown) return null;
  // An Accept header that also welcomes HTML is a browser being polite, not an
  // agent asking for data.
  if (a.includes('text/html')) return null;

  if (pathname === '/' || pathname === '/index.html') {
    return wantsJson ? '/api/index.json' : '/llms-full.txt';
  }
  const listing = pathname.match(/^\/l\/([a-z0-9-]+)\.html$/);
  if (listing && wantsJson && SLUG_RE.test(listing[1])) return `/listings/${listing[1]}.json`;
  return null;
}

/**
 * The content type a *negotiated* alternate must be labelled with.
 *
 * The asset binding types by file extension, so the markdown twin goes out as
 * `text/plain` — honest about the file, wrong about the representation. A client
 * that asked for `text/markdown` and is answered `text/plain` cannot tell it got
 * the twin it asked for, and every agent-readiness audit scores that as a failed
 * negotiation. Only the negotiated response is relabelled: a direct GET of
 * /llms.txt is left exactly as the binding serves it.
 *
 * @returns {string|null} content type to set, or null to keep the binding's own.
 */
export function alternateContentType(path) {
  return path.endsWith('.txt') ? 'text/markdown; charset=utf-8' : null;
}

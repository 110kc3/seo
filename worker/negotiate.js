
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

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

export function negotiate(pathname, accept) {
  const a = (accept ?? '').toLowerCase();
  const wantsJson = a.includes('application/json');
  const wantsMarkdown = a.includes('text/markdown') || a.includes('text/plain');
  if (!wantsJson && !wantsMarkdown) return null;
  if (a.includes('text/html')) return null;

  if (pathname === '/' || pathname === '/index.html') {
    return wantsJson ? '/api/index.json' : '/llms-full.txt';
  }
  const listing = pathname.match(/^\/l\/([a-z0-9-]+)\.html$/);
  if (listing && wantsJson && SLUG_RE.test(listing[1])) return `/listings/${listing[1]}.json`;
  return null;
}

export function alternateContentType(path) {
  return path.endsWith('.txt') ? 'text/markdown; charset=utf-8' : null;
}

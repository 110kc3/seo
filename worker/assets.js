
import cfg from '../site.config.json' with { type: 'json' };
import { alternatesFor, negotiate, alternateContentType } from './negotiate.js';

const BASE = cfg.base.replace(/\/+$/, '');

export async function fetchAsset(env, target, headers) {
  const at = (u) => new Request(typeof u === 'string' ? u : u.href, { method: 'GET', headers });
  const response = await env.ASSETS.fetch(at(target));
  if (response.status !== 307 && response.status !== 308) return response;
  const location = response.headers.get('location');
  if (!location) return response;
  return env.ASSETS.fetch(at(new URL(location, typeof target === 'string' ? target : target.href)));
}


export function decorate(response, url, alternate = null) {
  const headers = new Headers(response.headers);
  headers.set('link', alternatesFor(BASE, url.pathname));
  headers.set('x-agent-protocol', `${BASE}/llms.txt`);
  headers.set('x-agent-welcome', `${BASE}/llms.txt`);
  headers.set('vary', headers.has('vary') ? `${headers.get('vary')}, Accept` : 'Accept');
  if (url.pathname === '/.well-known/api-catalog' && response.status === 200) {
    headers.set('content-type', 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"');
  }
  if (alternate && response.status === 200) {
    const type = alternateContentType(alternate);
    if (type) headers.set('content-type', type);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function serveStatic(env, url, headers) {
  const alternate = negotiate(url.pathname, headers.get('accept'));
  const target = alternate ? new URL(alternate, url.origin) : url;
  return decorate(await fetchAsset(env, target, headers), url, alternate);
}

// Builds the remote-MCP-server catalog from the official MCP registry.
//
//   node scripts/fetch-mcp-catalog.mjs
//
// Same reasoning as the x402 catalog: the upstream is public and complete, and
// offers cursor paging and nothing else. There is no way to ask it "is there an
// MCP server that does X", which is the only question anyone actually has.
//
// The curation rule is deliberate and narrow: **active, latest, and remotely
// callable**. A server distributed only as an npm package is a thing you
// install; a server with a `remotes` URL is a thing an agent can use right now,
// with no filesystem and no consent dialog. That subset is a third of the
// registry and the whole of what matters to a running agent, so it is the
// subset indexed here. Packages-only servers are counted in the stats and
// excluded from the catalog, which the artifact states rather than implies.

import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
const PAGE = 100;
const MAX_PAGES = 1000; // a runaway guard, not a budget — see the exhaustion check below
const OFFICIAL = 'io.modelcontextprotocol.registry/official';

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

async function page(cursor) {
  const url = new URL(REGISTRY);
  url.searchParams.set('limit', String(PAGE));
  if (cursor) url.searchParams.set('cursor', cursor);
  const resp = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'ai-product-index-catalog' } });
  if (!resp.ok) throw new Error(`registry HTTP ${resp.status}`);
  return resp.json();
}

// --- fetch ------------------------------------------------------------------

const raw = [];
let cursor = '';
for (let i = 0; i < MAX_PAGES; i += 1) {
  const body = await page(cursor);
  raw.push(...(body.servers ?? []));
  process.stderr.write(`\rfetched ${raw.length}`);
  cursor = body.metadata?.nextCursor ?? '';
  if (!cursor) break;
}
process.stderr.write('\n');

// Silently stopping at a page cap would publish a partial catalog that looks
// complete, which is the one failure mode a mirror must not have.
if (cursor) {
  console.error(`\nERROR: stopped at the ${MAX_PAGES}-page cap with more records available.`);
  console.error('The catalog would be incomplete. Raise MAX_PAGES and re-run.');
  process.exit(1);
}

// --- normalize --------------------------------------------------------------

let notLatest = 0;
let inactive = 0;
let packagesOnly = 0;
const byUrl = new Map();

for (const item of raw) {
  const meta = item._meta?.[OFFICIAL] ?? {};
  const server = item.server ?? {};
  if (meta.isLatest !== true) { notLatest += 1; continue; }
  if (meta.status !== 'active') { inactive += 1; continue; }

  const remotes = Array.isArray(server.remotes) ? server.remotes : [];
  if (!remotes.length) { packagesOnly += 1; continue; }

  for (const remote of remotes) {
    let host;
    try {
      host = new URL(remote.url).host;
    } catch {
      continue; // a remote without a usable URL is not remotely callable
    }
    // A server may publish several endpoints for the same service. Each is
    // callable on its own, so each is a row, keyed by URL so re-publishes
    // collapse rather than duplicate.
    byUrl.set(remote.url, {
      url: remote.url,
      host,
      name: server.name ?? null,
      title: clean(server.title ?? server.name ?? '', 120),
      description: clean(server.description ?? '', 400),
      transport: remote.type ?? null,
      // Headers on a remote entry are how the registry expresses "you will need
      // a credential". Recorded as a boolean, never the header names' values.
      auth: Array.isArray(remote.headers) && remote.headers.length ? 'required' : 'none',
      version: server.version ?? null,
      repository: server.repository?.url ?? null,
      website: server.websiteUrl ?? null,
      updated: meta.updatedAt ?? meta.publishedAt ?? null,
    });
  }
}

const servers = [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));

// --- aggregates -------------------------------------------------------------

const tally = (values) => {
  const counts = new Map();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};
const hosts = tally(servers.map((s) => s.host));

const stats = {
  source: 'Official MCP Registry',
  source_url: REGISTRY,
  fetched: new Date().toISOString().slice(0, 10),
  remote_endpoints: servers.length,
  hosts: hosts.length,
  scope: {
    rule: 'active + latest + remotely callable',
    registry_records_seen: raw.length,
    excluded_superseded: notLatest,
    excluded_inactive: inactive,
    excluded_packages_only: packagesOnly,
    note: 'Servers distributed only as installable packages are excluded: this catalog answers "what can an agent call right now", not "what exists".',
  },
  by_transport: Object.fromEntries(tally(servers.map((s) => s.transport))),
  by_auth: Object.fromEntries(tally(servers.map((s) => s.auth))),
  top_hosts: hosts.slice(0, 25).map(([host, count]) => ({ host, endpoints: count })),
};

mkdirSync(join(ROOT, 'api', 'mcp'), { recursive: true });
writeFileSync(join(ROOT, 'api', 'mcp', 'catalog.json'), `${JSON.stringify({
  $comment: 'Remotely-callable MCP servers, normalized from the official MCP registry so they can be searched. Scope is active + latest + has a remote URL; package-only servers are excluded and counted in stats.json. The facts belong to the server authors. Refreshed weekly; to have an entry corrected or removed, open an issue at https://github.com/110kc3/seo/issues.',
  source: stats.source,
  source_url: REGISTRY,
  fetched: stats.fetched,
  count: servers.length,
  servers,
}, null, 1)}\n`);

writeFileSync(join(ROOT, 'api', 'mcp', 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);

const INDEX_FIELDS = ['url', 'host', 'name', 'title', 'description', 'transport', 'auth'];
writeFileSync(join(ROOT, 'api', 'mcp', 'index.json'), `${JSON.stringify({
  $comment: 'Compact search index over api/mcp/catalog.json. rows are positional, keyed by `fields`.',
  fetched: stats.fetched,
  count: servers.length,
  fields: INDEX_FIELDS,
  rows: servers.map((s) => [s.url, s.host, s.name, s.title, clean(s.description, 200), s.transport, s.auth]),
})}\n`);

const mb = (p) => (statSync(join(ROOT, p)).size / 1048576).toFixed(2);
console.log(`mcp catalog: ${servers.length} remote endpoints across ${hosts.length} hosts`);
console.log(`  scope: ${raw.length} records seen · ${notLatest} superseded · ${inactive} inactive · ${packagesOnly} package-only (excluded)`);
console.log(`  auth:  ${Object.entries(stats.by_auth).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`  wrote api/mcp/catalog.json (${mb('api/mcp/catalog.json')} MB) and index.json (${mb('api/mcp/index.json')} MB)`);

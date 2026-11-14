import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { reportPage, x402Page, mcpPage, leaderboardPage, checkPages, comparePage, apexPage, routerPage } from './pages.mjs';
import { CHECK_META, SIGNAL_META, V2_WEIGHTS, CHECK_LABELS, SNIPPETS } from '../worker/audit.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validate, esc, jsonLd, normalizeUrl, schemaJson, assertPublishedAssetSizes } from './validate.mjs';
import { resolveX402 } from './x402-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const BASE = cfg.base.replace(/\/+$/, '');
const REPO = cfg.repo;
const APEX = cfg.apex_host;
if (!APEX) throw new Error('site.config.json: apex_host is required — the site templates link up to the umbrella');

const ROUTER_HOST = cfg.router_host || '';
const ROUTER_BASE = ROUTER_HOST ? `https://${ROUTER_HOST}` : BASE;
const ROUTER_PAGE = ROUTER_HOST
  ? { base: ROUTER_BASE, path: '/' }
  : { base: BASE, path: '/router.html' };

const CHECKS = String(Object.keys(CHECK_META).length + Object.keys(V2_WEIGHTS).length);

const listingDir = join(ROOT, 'listings');
mkdirSync(listingDir, { recursive: true });
const files = readdirSync(listingDir).filter((f) => f.endsWith('.json')).sort();
const listings = [];
const urls = new Map();
for (const f of files) {
  const obj = JSON.parse(readFileSync(join(listingDir, f), 'utf8'));
  const res = validate(obj);
  if (!res.ok) throw new Error(`${f}: ${res.errors.join('; ')}`);
  if (`${obj.slug}.json` !== f) throw new Error(`${f}: filename does not match slug "${obj.slug}"`);
  for (const k of ['created', 'github_user', 'tier']) {
    if (!obj[k]) throw new Error(`${f}: missing server-set field "${k}"`);
  }
  const n = normalizeUrl(obj.url);
  if (urls.has(n)) throw new Error(`${f}: duplicate url with ${urls.get(n)}`);
  urls.set(n, f);
  listings.push(obj);
}
const TIER_RANK = { featured: 0, verified: 1, free: 2 };
listings.sort((a, b) => {
  const r = (TIER_RANK[a.tier] ?? 2) - (TIER_RANK[b.tier] ?? 2);
  if (r) return r;
  if (a.created !== b.created) return a.created > b.created ? -1 : 1;
  return a.slug < b.slug ? -1 : 1;
});

const tpl = (name) => readFileSync(join(ROOT, 'templates', name), 'utf8');
const readJson = (rel) => {
  try { return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')); } catch { return null; }
};
const x402Stats = readJson('api/x402/stats.json');
const mcpStats = readJson('api/mcp/stats.json');
const catalogCount = (value, fallback) => Number.isInteger(value)
  ? value.toLocaleString('en-US')
  : fallback;
const X402_COUNT = catalogCount(x402Stats?.endpoints, 'thousands of');
const MCP_COUNT = catalogCount(mcpStats?.remote_endpoints, 'thousands of');
const fill = (s, extra = {}) =>
  Object.entries({
    BASE, REPO, APEX, ROUTER: ROUTER_BASE, CHECKS,
    COUNT: String(listings.length), X402_COUNT, MCP_COUNT, ...extra,
  })
    .reduce((acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v), s);

const PAGE_CSS = `
  :root { --bg:#fff; --fg:#1a1a1a; --muted:#666; --accent:#0b6e4f; --card:#f5f5f4; --border:#e2e2e0; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111; --fg:#e8e8e6; --muted:#999; --accent:#4dc79a; --card:#1c1c1b; --border:#2c2c2a; } }
  body { margin:0 auto; max-width:44rem; padding:2.5rem 1.25rem 4rem; background:var(--bg); color:var(--fg); font:16px/1.6 system-ui, sans-serif; }
  h1 { font-size:1.7rem; line-height:1.2; margin:.2rem 0 .6rem; }
  a { color:var(--accent); }
  .crumb, .meta { color:var(--muted); font-size:.9rem; }
  dl { display:grid; grid-template-columns:max-content 1fr; gap:.35rem 1.2rem; background:var(--card); border:1px solid var(--border); border-radius:8px; padding:1rem 1.2rem; }
  dt { color:var(--muted); }
  dd { margin:0; overflow-wrap:anywhere; }
  dd ul { margin:0; padding-left:1.1rem; }
  .tag { background:var(--card); border:1px solid var(--border); border-radius:99px; padding:.05rem .6rem; font-size:.85rem; }
  footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--border); font-size:.85rem; color:var(--muted); }
`;

function listingPage(l) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: l.name,
    description: l.description,
    url: l.url,
    applicationCategory: l.category,
  };
  if (l.pricing === 'free') ld.offers = { '@type': 'Offer', price: '0', priceCurrency: 'USD' };
  const endpoints = l.machine_endpoints
    ? Object.entries(l.machine_endpoints)
      .map(([k, v]) => `<li>${esc(k)}: <a href="${esc(v)}">${esc(v)}</a></li>`).join('')
    : '';
  const tags = l.tags ? l.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ') : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(l.name)} — AI Product Index</title>
<meta name="description" content="${esc(l.description.slice(0, 160))}">
<link rel="canonical" href="${BASE}/l/${l.slug}.html">
<link rel="alternate" type="application/json" href="../listings/${l.slug}.json" title="This listing (JSON)">
<link rel="alternate" type="text/markdown" href="../llms.txt" title="llms.txt (agent-readable index)">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(l.name)} — AI Product Index">
<meta property="og:description" content="${esc(l.description.slice(0, 160))}">
<meta property="og:url" content="${BASE}/l/${l.slug}.html">
<meta property="og:image" content="${BASE}/assets/og.png">
<script type="application/ld+json">
${jsonLd(ld)}
</script>
<style>${PAGE_CSS}</style>
</head>
<body>
<p class="crumb"><a href="../index.html">AI Product Index</a> / ${esc(l.slug)}</p>
<h1>${esc(l.name)}</h1>
<p>${esc(l.description)}</p>
<dl>
  <dt>URL</dt><dd><a href="${esc(l.url)}">${esc(l.url)}</a></dd>
  <dt>Category</dt><dd>${esc(l.category)}</dd>
  <dt>Pricing</dt><dd>${esc(l.pricing)}</dd>${tags ? `
  <dt>Tags</dt><dd>${tags}</dd>` : ''}${endpoints ? `
  <dt>Machine endpoints</dt><dd><ul>${endpoints}</ul></dd>` : ''}${l.submitted_by ? `
  <dt>Submitted by</dt><dd>${esc(l.submitted_by)}</dd>` : ''}
  <dt>Listed</dt><dd>${esc(l.created)}${l.updated ? ` · updated ${esc(l.updated)}` : ''} · tier: ${l.tier === 'free' ? esc(l.tier) : `<strong>${esc(l.tier)} ★</strong>`}</dd>
</dl>
<p class="meta">Machine-readable: <a href="../listings/${l.slug}.json">listing JSON</a> · <a href="../api/index.json">full registry</a> · <a href="../llms.txt">llms.txt</a></p>

<h2>Badges</h2>
<p class="meta">Paste either into your README. Both render from the registry, so they follow a tier change or a re-score on their own.</p>
<p><img src="${BASE}/badge.svg?slug=${encodeURIComponent(l.slug)}" alt="Indexed by AI Product Index" height="20">
 <img src="${BASE}/badge.svg?slug=${encodeURIComponent(l.slug)}&amp;show=score" alt="Agent readability grade" height="20"></p>
<pre><code>[![AI Agent Ready](${BASE}/badge.svg?slug=${esc(l.slug)})](${BASE}/l/${esc(l.slug)}.html)
[![Agent Readability](${BASE}/badge.svg?slug=${esc(l.slug)}&amp;show=score)](${BASE}/l/${esc(l.slug)}.html)</code></pre>
<p class="meta">The grade is re-checked weekly by the same cron that verifies your URL is still up.</p>
<footer>Get your product listed — free and autonomous: <a href="../llms.txt">protocol</a>. Website checks: <a href="../checks/">checklist and remedies</a>.</footer>
</body>
</html>
`;
}

mkdirSync(join(ROOT, 'api'), { recursive: true });
const updated = listings.length ? listings.map((l) => l.updated ?? l.created).sort().at(-1) : null;
writeFileSync(join(ROOT, 'api', 'index.json'), JSON.stringify({ count: listings.length, updated, listings }, null, 2) + '\n');
writeFileSync(join(ROOT, 'api', 'schema.json'), JSON.stringify(schemaJson(BASE), null, 2) + '\n');

rmSync(join(ROOT, 'l'), { recursive: true, force: true });
mkdirSync(join(ROOT, 'l'));
for (const l of listings) writeFileSync(join(ROOT, 'l', `${l.slug}.html`), listingPage(l));

const listItems = listings.map((l) => {
  const badge = l.tier === 'free' ? '' : `<span class="badge">${esc(l.tier)}</span> `;
  return `<li>${badge}<a href="l/${l.slug}.html">${esc(l.name)}</a> <span class="meta">${esc(l.category)} · ${esc(l.pricing)}</span><br>${esc(l.description)}</li>`;
}).join('\n        ') || '<li>No listings yet.</li>';
writeFileSync(join(ROOT, 'index.html'), fill(tpl('index.html'), { LISTINGS_HTML: listItems }));

writeFileSync(join(ROOT, '404.html'), fill(tpl('404.html')));
writeFileSync(join(ROOT, 'dashboard.html'), fill(tpl('dashboard.html')));
writeFileSync(join(ROOT, 'llms.txt'), fill(tpl('llms.txt')));
writeFileSync(join(ROOT, 'robots.txt'), fill(tpl('robots.txt')));
writeFileSync(join(ROOT, 'openapi.yaml'), fill(tpl('openapi.yaml')));

mkdirSync(join(ROOT, '.well-known'), { recursive: true });
const agentCard = fill(tpl('agent-card.json'));
writeFileSync(join(ROOT, '.well-known', 'agent-card.json'), agentCard);
writeFileSync(join(ROOT, '.well-known', 'agent.json'), agentCard);
writeFileSync(join(ROOT, '.well-known', 'agents.json'), fill(tpl('agents-manifest.json')));
writeFileSync(join(ROOT, '.well-known', 'security.txt'), fill(tpl('security.txt')));
const mcpCard = fill(tpl('mcp-card.json'));
writeFileSync(join(ROOT, '.well-known', 'mcp.json'), mcpCard);
mkdirSync(join(ROOT, '.well-known', 'mcp'), { recursive: true });
writeFileSync(join(ROOT, '.well-known', 'mcp', 'server-card.json'), mcpCard);
const skillsDir = join(ROOT, 'templates', 'skills');
const skillNames = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name).sort();
mkdirSync(join(ROOT, '.well-known', 'agent-skills'), { recursive: true });
const skills = skillNames.map((name) => {
  const body = fill(readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8'));
  mkdirSync(join(ROOT, '.well-known', 'agent-skills', name), { recursive: true });
  writeFileSync(join(ROOT, '.well-known', 'agent-skills', name, 'SKILL.md'), body);
  const described = body.match(/^description:\s*(.+)$/m);
  if (!described) throw new Error(`skill ${name} has no description in its frontmatter`);
  return {
    name,
    type: 'skill-md',
    description: described[1].trim(),
    url: `/.well-known/agent-skills/${name}/SKILL.md`,
    digest: `sha256:${createHash('sha256').update(body).digest('hex')}`,
  };
});
writeFileSync(join(ROOT, '.well-known', 'agent-skills', 'index.json'),
  JSON.stringify({ $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json', skills }, null, 2) + '\n');

writeFileSync(join(ROOT, '.well-known', 'api-catalog'), fill(tpl('api-catalog.json')));
writeFileSync(join(ROOT, '.well-known', 'ai-plugin.json'), fill(tpl('ai-plugin.json')));
writeFileSync(join(ROOT, 'opensearch.xml'), fill(tpl('opensearch.xml')));

const feedItems = [...listings]
  .sort((a, b) => String(b.updated ?? b.created).localeCompare(String(a.updated ?? a.created)))
  .slice(0, 50);
const rfc822 = (d) => new Date(`${d}T00:00:00Z`).toUTCString();

writeFileSync(join(ROOT, 'feed.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n`
  + `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n`
  + `<channel>\n`
  + `  <title>AI Product Index</title>\n`
  + `  <link>${BASE}/</link>\n`
  + `  <description>AI products, APIs, agents and MCP servers as they register themselves.</description>\n`
  + `  <language>en</language>\n`
  + `  <atom:link href="${BASE}/feed.xml" rel="self" type="application/rss+xml"/>\n`
  + feedItems.map((l) => `  <item>\n`
    + `    <title>${esc(l.name)}</title>\n`
    + `    <link>${BASE}/l/${l.slug}.html</link>\n`
    + `    <guid isPermaLink="true">${BASE}/l/${l.slug}.html</guid>\n`
    + `    <pubDate>${rfc822(l.updated ?? l.created)}</pubDate>\n`
    + `    <category>${esc(l.category)}</category>\n`
    + `    <description>${esc(l.description)}</description>\n`
    + `  </item>`).join('\n')
  + `\n</channel>\n</rss>\n`);

writeFileSync(join(ROOT, 'feed.json'), JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'AI Product Index',
  home_page_url: `${BASE}/`,
  feed_url: `${BASE}/feed.json`,
  description: 'AI products, APIs, agents and MCP servers as they register themselves.',
  items: feedItems.map((l) => ({
    id: `${BASE}/l/${l.slug}.html`,
    url: `${BASE}/l/${l.slug}.html`,
    title: l.name,
    content_text: l.description,
    date_published: `${l.updated ?? l.created}T00:00:00Z`,
    tags: [l.category, ...(l.tags ?? [])],
    external_url: l.url,
  })),
}, null, 2) + '\n');

const fullBlocks = listings.map((l) => {
  const lines = [
    `### ${l.name} (${l.slug})`,
    `- url: ${l.url}`,
    `- category: ${l.category} · pricing: ${l.pricing}${l.tags ? ` · tags: ${l.tags.join(', ')}` : ''}`,
    `- ${l.description.replace(/\s*\n\s*/g, ' ')}`,
  ];
  if (l.machine_endpoints) {
    for (const [k, v] of Object.entries(l.machine_endpoints)) lines.push(`- ${k}: ${v}`);
  }
  lines.push(`- listing JSON: ${BASE}/listings/${l.slug}.json`);
  lines.push(`- listing page: ${BASE}/l/${l.slug}.html`);
  return lines.join('\n');
});
writeFileSync(join(ROOT, 'llms-full.txt'),
  `${fill(tpl('llms.txt'))}\n## All listings (${listings.length})\n\n${fullBlocks.join('\n\n')}\n`);

const pagePaths = [];
const x402Health = readJson('api/x402/health.json');
const mcpHealth = readJson('api/mcp/health.json');
const traffic = readJson('api/traffic.json');
const scores = readJson('scores.json') ?? {};

if (x402Stats && mcpStats) {
  writeFileSync(join(ROOT, 'report.html'),
    reportPage({ base: BASE, x402: x402Stats, mcp: mcpStats, x402Health, mcpHealth, traffic, scores }));
  pagePaths.push(['/report.html', traffic?.series?.at(-1)?.date]);
}
if (x402Stats) {
  writeFileSync(join(ROOT, 'x402.html'), x402Page({ base: BASE, stats: x402Stats, health: x402Health }));
  pagePaths.push(['/x402.html', x402Stats.fetched]);
}
if (mcpStats) {
  writeFileSync(join(ROOT, 'mcp-servers.html'), mcpPage({ base: BASE, stats: mcpStats, health: mcpHealth }));
  pagePaths.push(['/mcp-servers.html', mcpStats.fetched]);
}
if (Object.keys(scores).length) {
  writeFileSync(join(ROOT, 'leaderboard.html'), leaderboardPage({ base: BASE, scores, listings }));
  pagePaths.push(['/leaderboard.html', Object.values(scores).map((s) => s.checked).filter(Boolean).sort().at(-1)]);
}

rmSync(join(ROOT, 'checks'), { recursive: true, force: true });
mkdirSync(join(ROOT, 'checks'), { recursive: true });
const checkHtml = checkPages({
  base: BASE, checkMeta: CHECK_META, signalMeta: SIGNAL_META,
  v2Weights: V2_WEIGHTS, labels: CHECK_LABELS, snippets: SNIPPETS,
});
for (const [name, html] of checkHtml) {
  writeFileSync(join(ROOT, 'checks', name), html);
  pagePaths.push([name === 'index.html' ? '/checks/' : `/checks/${name}`, null]);
}

if (x402Stats && mcpStats) {
  writeFileSync(join(ROOT, 'router.html'), routerPage({
    canonicalBase: ROUTER_PAGE.base,
    canonicalPath: ROUTER_PAGE.path,
    serviceBase: BASE,
    apexBase: `https://${APEX}`,
  }));
}

if (cfg.apex_host && x402Stats && mcpStats) {
  writeFileSync(join(ROOT, 'apex.html'), apexPage({
    apexBase: `https://${cfg.apex_host}`,
    serviceBase: BASE,
    x402: x402Stats,
    mcp: mcpStats,
    listingCount: listings.length,
  }));
}

writeFileSync(join(ROOT, 'compare.html'),
  comparePage({ base: BASE, checkCount: Object.keys(CHECK_META).length + Object.keys(V2_WEIGHTS).length }));
pagePaths.push(['/compare.html', null]);

const smUrls = [
  `  <url><loc>${BASE}/</loc></url>`,
  `  <url><loc>https://${APEX}/</loc></url>`,
  `  <url><loc>${BASE}/ask</loc></url>`,
  `  <url><loc>${BASE}/api/search</loc></url>`,
  ...pagePaths.map(([p, lastmod]) => `  <url><loc>${BASE}${p}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`),
  ...listings.map((l) => `  <url><loc>${BASE}/l/${l.slug}.html</loc><lastmod>${l.updated ?? l.created}</lastmod></url>`),
];
for (const [key, dir] of [['x402', 'api/x402'], ['mcp', 'api/mcp']]) {
  const health = readJson(`${dir}/health.json`);
  if (!health) continue;
  const tracked = health.unreachable ?? [];
  const confirmed = tracked.filter((e) => (e.misses ?? 0) >= 2);
  const suspected = tracked.filter((e) => (e.misses ?? 0) === 1);
  const view = (e) => ({ url: e.url, reason: e.reason, misses: e.misses, since: e.since, last_checked: e.last_checked });

  writeFileSync(join(ROOT, dir, 'avoid.json'), `${JSON.stringify({
    $comment: 'Endpoints that failed a liveness probe. Evidence, not proof: the probe is a rotating weekly sample taken from one network path, so an entry may be firewalling us specifically or may have been down for an hour. Nothing is removed from the catalog on the strength of it — search still returns these, flagged. Operators: to be corrected or removed, open an issue on the repo; no justification needed.',
    source: health.source,
    probed_at: health.probed_at,
    catalog_size: health.catalog_size,
    confidence: {
      confirmed: 'failed at least two consecutive probes',
      suspected: 'failed its most recent probe, once',
      caveat: 'the sweep is a rotating sample; an endpoint is re-probed about twice a year, so `confirmed` accumulates slowly by design',
      fresh_answer: null,
    },
    free: true,
    counts: { confirmed: confirmed.length, suspected: suspected.length, tracked: tracked.length },
    endpoints: confirmed.map(view),
    suspected: suspected.map(view),
  }, null, 2)}\n`);
  console.log(`avoid-list ${key}: ${confirmed.length} confirmed, ${suspected.length} suspected`);
}

if (cfg.indexnow_key) {
  writeFileSync(join(ROOT, `${cfg.indexnow_key}.txt`), `${cfg.indexnow_key}\n`);
}

writeFileSync(join(ROOT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${smUrls.join('\n')}\n</urlset>\n`);

assertPublishedAssetSizes(ROOT);

console.log(`built ${listings.length} listing(s) and ${pagePaths.length} page(s): api/, l/, .well-known/, index.html, 404.html, llms.txt, llms-full.txt, robots.txt, openapi.yaml, sitemap.xml, opensearch.xml, feed.xml, feed.json`);

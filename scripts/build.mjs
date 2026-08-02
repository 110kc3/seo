// Generates every derived artifact of the AI Product Index from
// listings/*.json + templates/ + site.config.json. Output is a pure function
// of those inputs (no timestamps): running the build twice yields zero diff.
// Fails hard on any invalid listing so a bad manual edit can't reach the site.
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { reportPage, x402Page, mcpPage, leaderboardPage, checkPages, comparePage } from './pages.mjs';
import { CHECK_META, SIGNAL_META, V2_WEIGHTS, CHECK_LABELS, SNIPPETS } from '../worker/audit.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validate, esc, jsonLd, normalizeUrl, schemaJson } from './validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const BASE = cfg.base.replace(/\/+$/, '');
const REPO = cfg.repo;

// --- load + validate the source of truth ---
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
// Paid tiers rank above free (that IS the paid product), then newest first.
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
const fill = (s, extra = {}) =>
  Object.entries({ BASE, REPO, COUNT: String(listings.length), ...extra })
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
<footer>Get your product listed — free and autonomous: <a href="../llms.txt">protocol</a>. Humans: <a href="../index.html#for-humans">done-for-you agent-readability service</a>.</footer>
</body>
</html>
`;
}

// --- generate ---
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
// Owner tool, not content: noindex on the page, Disallow in robots, absent
// from the sitemap. The data behind it is bearer-gated at the Worker.
writeFileSync(join(ROOT, 'dashboard.html'), fill(tpl('dashboard.html')));
writeFileSync(join(ROOT, 'llms.txt'), fill(tpl('llms.txt')));
writeFileSync(join(ROOT, 'robots.txt'), fill(tpl('robots.txt')));
writeFileSync(join(ROOT, 'openapi.yaml'), fill(tpl('openapi.yaml')));

// Well-known surfaces. Only reachable now that the index sits at a domain root —
// on the old /seo/ project path there was no /.well-known to serve.
mkdirSync(join(ROOT, '.well-known'), { recursive: true });
// A2A agent card (singular). Describes this service as an A2A agent.
//
// Written to BOTH paths from one template, because the spec moved and the
// installed base did not. A2A is 1.0 under the Linux Foundation and the card
// belongs at /.well-known/agent-card.json; /.well-known/agent.json is the
// pre-0.3 path, where a spec-compliant 1.0 client will never look. Older
// clients only know the old path. One template, two files, no drift — the
// alternative is being invisible to one generation of client or the other.
const agentCard = fill(tpl('agent-card.json'));
writeFileSync(join(ROOT, '.well-known', 'agent-card.json'), agentCard);
writeFileSync(join(ROOT, '.well-known', 'agent.json'), agentCard);
// agents.json (PLURAL) — a different spec from the card above, and the one
// agent-readiness auditors read: it enumerates the machine-readable interfaces,
// endpoints and policies of the *site*. Everything it advertises is served.
writeFileSync(join(ROOT, '.well-known', 'agents.json'), fill(tpl('agents-manifest.json')));
// RFC 9116 security contact. The Expires date is fixed in the template, not
// computed, so the build stays a pure function of its inputs.
writeFileSync(join(ROOT, '.well-known', 'security.txt'), fill(tpl('security.txt')));
// MCP server card — how a client finds the remote MCP endpoint at /mcp without
// being handed a URL. Two paths for one card again, and this time the specs
// disagree with each other rather than with their own past: SEP-2127 says
// /.well-known/mcp.json, Cloudflare's agent-readiness check reads
// /.well-known/mcp/server-card.json. Serving both costs a file and lets the
// client be right either way.
const mcpCard = fill(tpl('mcp-card.json'));
writeFileSync(join(ROOT, '.well-known', 'mcp.json'), mcpCard);
mkdirSync(join(ROOT, '.well-known', 'mcp'), { recursive: true });
writeFileSync(join(ROOT, '.well-known', 'mcp', 'server-card.json'), mcpCard);
// Agent Skills (schemas.agentskills.io 0.2.0). Each skill says what an agent can
// accomplish here, so it does not have to read the docs to find out.
//
// The digests are the reason this is generated rather than hand-maintained: the
// index publishes a sha256 of every skill body, and a hand-written one goes
// wrong the first time anyone edits a SKILL.md and forgets. Computing it from
// the bytes actually written means the index cannot disagree with the file.
//
// Every skill here wraps capability that already ships — grade a URL, search
// either catalog, register a product — rather than promising anything new. A
// skills index describing things the site cannot do is worse than none.
const skillsDir = join(ROOT, 'templates', 'skills');
const skillNames = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name).sort();
mkdirSync(join(ROOT, '.well-known', 'agent-skills'), { recursive: true });
const skills = skillNames.map((name) => {
  const body = fill(readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8'));
  mkdirSync(join(ROOT, '.well-known', 'agent-skills', name), { recursive: true });
  writeFileSync(join(ROOT, '.well-known', 'agent-skills', name, 'SKILL.md'), body);
  // Description comes from the skill's own frontmatter, so the index and the
  // file can never describe the skill differently.
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

// RFC 9727 API Catalog. Extensionless on purpose — the RFC fixes the URI as
// /.well-known/api-catalog — so worker/index.js labels it application/linkset+json;
// the asset store would otherwise serve it as something a strict client rejects.
// It adds no new facts, it just states the ones in openapi.yaml where a machine
// looking for APIs is specified to look.
writeFileSync(join(ROOT, '.well-known', 'api-catalog'), fill(tpl('api-catalog.json')));
// The OpenAI plugin manifest. Superseded, and still probed by enough crawlers
// that answering costs less than the 404s do.
writeFileSync(join(ROOT, '.well-known', 'ai-plugin.json'), fill(tpl('ai-plugin.json')));
// OpenSearch: the only discovery format that turns a domain into a callable
// search box for a client that knows nothing else about it.
writeFileSync(join(ROOT, 'opensearch.xml'), fill(tpl('opensearch.xml')));

// --- feeds ------------------------------------------------------------------
// A directory that gains entries is a feed, and feeds are how aggregators and
// several crawlers notice change without polling every listing. Two formats
// because the consumers differ: RSS for readers and crawlers, JSON Feed for
// anything that would rather not parse XML.
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

// --- generated human-facing pages -------------------------------------------
// Everything below renders from committed data files. Each returns null-safe:
// a page whose data file is missing is skipped rather than built empty, because
// the catalogs are refreshed by a weekly cron and a fresh clone may not have
// them yet. `pagePaths` feeds the sitemap, so a skipped page is also absent
// from the sitemap rather than advertised as a 404.
const pagePaths = [];
const x402Stats = readJson('api/x402/stats.json');
const mcpStats = readJson('api/mcp/stats.json');
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

// The checklist is wiped and rebuilt like l/, so a check removed from the
// scorer cannot leave a page behind claiming it is still graded.
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

writeFileSync(join(ROOT, 'compare.html'),
  comparePage({ base: BASE, checkCount: Object.keys(CHECK_META).length + Object.keys(V2_WEIGHTS).length }));
pagePaths.push(['/compare.html', null]);

const smUrls = [
  `  <url><loc>${BASE}/</loc></url>`,
  // The query endpoints belong in the sitemap even though they take
  // parameters: a crawler that reads sitemaps and nothing else would otherwise
  // never learn this site can be asked questions.
  `  <url><loc>${BASE}/ask</loc></url>`,
  `  <url><loc>${BASE}/api/search</loc></url>`,
  ...pagePaths.map(([p, lastmod]) => `  <url><loc>${BASE}${p}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`),
  ...listings.map((l) => `  <url><loc>${BASE}/l/${l.slug}.html</loc><lastmod>${l.updated ?? l.created}</lastmod></url>`),
];
writeFileSync(join(ROOT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${smUrls.join('\n')}\n</urlset>\n`);

console.log(`built ${listings.length} listing(s) and ${pagePaths.length} page(s): api/, l/, .well-known/, index.html, 404.html, llms.txt, llms-full.txt, robots.txt, openapi.yaml, sitemap.xml, opensearch.xml, feed.xml, feed.json`);

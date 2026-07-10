// Generates every derived artifact of the AI Product Index from
// listings/*.json + templates/ + site.config.json. Output is a pure function
// of those inputs (no timestamps): running the build twice yields zero diff.
// Fails hard on any invalid listing so a bad manual edit can't reach the site.
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
writeFileSync(join(ROOT, 'llms.txt'), fill(tpl('llms.txt')));
writeFileSync(join(ROOT, 'robots.txt'), fill(tpl('robots.txt')));
writeFileSync(join(ROOT, 'openapi.yaml'), fill(tpl('openapi.yaml')));

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

const smUrls = [
  `  <url><loc>${BASE}/</loc></url>`,
  ...listings.map((l) => `  <url><loc>${BASE}/l/${l.slug}.html</loc><lastmod>${l.updated ?? l.created}</lastmod></url>`),
];
writeFileSync(join(ROOT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${smUrls.join('\n')}\n</urlset>\n`);

console.log(`built ${listings.length} listing(s): api/, l/, index.html, 404.html, llms.txt, llms-full.txt, robots.txt, openapi.yaml, sitemap.xml`);

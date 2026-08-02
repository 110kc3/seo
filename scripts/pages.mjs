// Human-facing pages generated from data this site already collects.
//
// Why these exist: 46% of requests here are browsers and 10-12% are AI
// crawlers, but until now the only thing a human could *do* was type a URL into
// the score box — and only 3 of the first 123 free scores came from a browser.
// Meanwhile the two catalogs, 24,741 endpoints with weekly liveness probing and
// the most genuinely unique thing this site holds, existed only as JSON.
//
// Every page here is generated from committed data, never hand-written, for the
// same reason the Agent Skills digests are: a page quoting 14,661 when the file
// says 14,815 does not read as staleness, it reads as carelessness on a site
// whose product is being accurate about other people's sites.
//
// Determinism: nothing here reads the clock. Every date shown comes from the
// data file that supplied the number (`fetched`, `probed_at`, `checked`), so a
// rebuild with unchanged inputs produces an unchanged byte stream.

import { esc, jsonLd } from './validate.mjs';

// --- shared shell -----------------------------------------------------------

export const PAGE_CSS = `
  :root { --bg:#fff; --fg:#1a1a1a; --muted:#666; --accent:#0b6e4f; --card:#f5f5f4; --border:#e2e2e0; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111; --fg:#e8e8e6; --muted:#999; --accent:#4dc79a; --card:#1c1c1b; --border:#2c2c2a; } }
  body { margin:0 auto; max-width:52rem; padding:2.5rem 1.25rem 4rem; background:var(--bg); color:var(--fg); font:16px/1.6 system-ui, sans-serif; }
  h1 { font-size:1.7rem; line-height:1.2; margin:.2rem 0 .6rem; }
  h2 { font-size:1.25rem; margin:2.2rem 0 .5rem; }
  h3 { font-size:1.05rem; margin:1.6rem 0 .4rem; }
  a { color:var(--accent); }
  .crumb, .meta { color:var(--muted); font-size:.9rem; }
  .lede { font-size:1.05rem; }
  table { border-collapse:collapse; width:100%; margin:.8rem 0; font-size:.94rem; display:block; overflow-x:auto; }
  th, td { text-align:left; padding:.4rem .7rem; border-bottom:1px solid var(--border); white-space:nowrap; }
  th { color:var(--muted); font-weight:600; }
  td.wrap, th.wrap { white-space:normal; min-width:18rem; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(11rem,1fr)); gap:.8rem; margin:1rem 0; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:.9rem 1rem; }
  .card .n { font-size:1.5rem; font-weight:600; line-height:1.1; font-variant-numeric:tabular-nums; }
  .card .k { color:var(--muted); font-size:.85rem; }
  .bar { background:var(--card); border:1px solid var(--border); border-radius:4px; height:.55rem; overflow:hidden; min-width:6rem; }
  .bar > i { display:block; height:100%; background:var(--accent); }
  .grade { font-weight:600; font-variant-numeric:tabular-nums; }
  code, pre { background:var(--card); border:1px solid var(--border); border-radius:6px; }
  code { padding:.05rem .35rem; font-size:.9em; }
  pre { padding:.8rem 1rem; overflow-x:auto; }
  pre code { background:none; border:none; padding:0; }
  footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--border); font-size:.85rem; color:var(--muted); }
`;

const num = (n) => Number(n).toLocaleString('en-US');
const pct = (x, digits = 1) => `${(Number(x) * 100).toFixed(digits)}%`;
const usd = (n) => (Number(n) < 0.01 ? `$${Number(n).toFixed(4)}` : `$${Number(n).toFixed(2)}`);

/**
 * The standard page shell. `depth` is how many directories deep the page sits,
 * so relative links resolve from `/checks/foo.html` as well as from `/x402.html`.
 */
export function page({ base, path, title, description, body, ld = null, depth = 0 }) {
  const up = '../'.repeat(depth) || './';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description.slice(0, 160))}">
<link rel="canonical" href="${base}${path}">
<link rel="alternate" type="text/markdown" href="${up}llms.txt" title="llms.txt (agent-readable index)">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description.slice(0, 160))}">
<meta property="og:url" content="${base}${path}">
<meta property="og:image" content="${base}/assets/og.png">
${ld ? `<script type="application/ld+json">\n${jsonLd(ld)}\n</script>` : ''}
<style>${PAGE_CSS}</style>
</head>
<body>
<p class="crumb"><a href="${up}index.html">AI Product Index</a>${path === '/' ? '' : ` / ${esc(title.split(' — ')[0])}`}</p>
${body}
<footer>Generated from the data files this site publishes — nothing here is hand-maintained.
Machine-readable: <a href="${up}llms.txt">llms.txt</a> · <a href="${up}api/index.json">registry JSON</a> · <a href="${up}openapi.yaml">OpenAPI</a>.
Humans: <a href="${up}index.html#for-humans">done-for-you agent readability</a>.</footer>
</body>
</html>
`;
}

const statCards = (cards) =>
  `<div class="cards">${cards.map((c) => `<div class="card"><div class="n">${esc(String(c.n))}</div><div class="k">${esc(c.k)}</div></div>`).join('')}</div>`;

// --- (3) the report ---------------------------------------------------------

/**
 * A dated, citable reading of the agent web from the three vantage points this
 * site happens to own: its own traffic, the machine-payable catalog, and the
 * remotely-callable MCP catalog.
 *
 * The editorial rule is that every number here is one we measured, with the
 * measurement's own date attached, and that the uncomfortable one leads. Zero
 * organic payments against a rising agent share is the only finding on this
 * page that anyone could not have guessed, so burying it would waste the page.
 */
export function reportPage({ base, x402, mcp, x402Health, mcpHealth, traffic, scores }) {
  const series = traffic?.series ?? [];
  const latest = series.at(-1);
  const first = series[0];

  const graded = Object.values(scores ?? {}).filter((s) => s.letter);
  const byLetter = {};
  for (const s of graded) byLetter[s.letter] = (byLetter[s.letter] ?? 0) + 1;

  const trendRows = series.map((p) => `<tr>
    <td>${esc(p.date)}${p.backfilled ? ' <span class="meta">(from the record)</span>' : ''}</td>
    <td class="num">${num(p.total_requests)}</td>
    <td class="num">${pct(p.agent_share, 2)}</td>
    <td class="num">${p.ai_crawler == null ? '—' : num(p.ai_crawler)}</td>
    <td class="num">${p.free_scores == null ? '—' : num(p.free_scores)}</td>
    <td class="num">${p.audit_hits == null ? '—' : num(p.audit_hits)}</td>
  </tr>`).join('\n');

  const chainRows = Object.entries(x402.by_chain ?? {})
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([c, n]) => `<tr><td>${esc(c)}</td><td class="num">${num(n)}</td><td class="num">${pct(n / x402.endpoints)}</td></tr>`).join('\n');

  const body = `
<h1>The state of the agent web</h1>
<p class="lede">Three things this site measures directly: whether AI agents visit,
whether the machine-payable web actually answers, and whether any of it converts
into a payment. Every figure below is dated and links to the file it came from.</p>
<p class="meta">Regenerated whenever the underlying data files change. Traffic
readings are snapshots of <a href="${base}/api/stats.json">/api/stats.json</a>;
catalog readings are the weekly probe.</p>

<h2>1. Agents are arriving, and the share is rising</h2>
${latest ? statCards([
    { n: pct(latest.agent_share, 2), k: `agent share (${esc(latest.date)})` },
    { n: num(latest.total_requests), k: `requests, ${esc(latest.window)}` },
    { n: num(latest.ai_crawler), k: 'declared AI crawlers' },
    { n: num(latest.browser ?? 0), k: 'browser requests' },
  ]) : '<p>No traffic snapshot has been taken yet.</p>'}
${series.length > 1 ? `<table>
<thead><tr><th>reading</th><th class="num">requests/30d</th><th class="num">agent share</th><th class="num">AI crawlers</th><th class="num">free scores</th><th class="num">paid-endpoint hits</th></tr></thead>
<tbody>
${trendRows}
</tbody></table>
<p>Agent share went from <strong>${pct(first.agent_share, 2)}</strong> on ${esc(first.date)} to
<strong>${pct(latest.agent_share, 2)}</strong> on ${esc(latest.date)}. The site had no inbound
links for most of that period, so this is agents finding a domain nobody pointed
them at.</p>` : ''}

<h2>2. Nobody pays</h2>
${latest ? `<p class="lede">${num(latest.audit_hits)} requests have hit the paid endpoint and met its
HTTP 402 challenge. <strong>Zero of them came back with a payment.</strong> Every
settlement this rail has ever taken was our own test.</p>` : ''}
<p>This is the finding worth more than the rest of the page, because it is the one
nobody could have guessed from the outside. The audience is real and growing; the
conversion is not a small number, it is zero. A five-cent price, published in
machine-readable form at
<a href="${base}/api/x402/info">/api/x402/info</a>, advertised in the 402 itself,
payable by the reference client — and no agent in the wild has ever chosen to pay it.</p>
<p>Two readings are consistent with that, and this page cannot tell them apart:
almost nothing in the wild carries a funded wallet with authority to spend it, or
the free tier already answers the question the paid tier charges for. Both are
more interesting than "the price is wrong".</p>

<h2>3. The machine-payable web is smaller than it counts</h2>
${statCards([
    { n: num(x402.endpoints), k: 'x402 endpoints' },
    { n: num(x402.hosts), k: 'distinct hosts' },
    { n: usd(x402.price_usd?.p50 ?? 0), k: 'median price/call' },
    { n: pct(x402.concentration?.top_10_hosts_share ?? 0, 1), k: 'held by top 10 hosts' },
  ])}
<p>${num(x402.endpoints)} endpoints sounds like an ecosystem. ${pct(x402.concentration?.top_10_hosts_share ?? 0, 1)} of them
belong to ten operators, and the ${num(x402.hosts)} distinct hosts are the honest
denominator. Prices cluster low — median ${usd(x402.price_usd?.p50 ?? 0)}, 90th percentile
${usd(x402.price_usd?.p90 ?? 0)} — which is what a market of machine-to-machine calls
should look like, and it means a five-cent audit sits above the median rather than below it.</p>
<table>
<thead><tr><th>chain</th><th class="num">endpoints</th><th class="num">share</th></tr></thead>
<tbody>
${chainRows}
</tbody></table>
<p class="meta">Source: <a href="${esc(x402.source_url)}">${esc(x402.source)}</a>, read ${esc(x402.fetched)}.
Full figures: <a href="${base}/api/x402/stats.json">stats.json</a> · browse: <a href="${base}/x402.html">the catalog</a>.</p>

<h2>4. Most of it answers, which was not obvious</h2>
${statCards([
    { n: pct(x402Health?.answered_share ?? 0, 1), k: 'x402 endpoints answering' },
    { n: pct(mcpHealth?.answered_share ?? 0, 1), k: 'MCP servers answering' },
    { n: num(mcp.remote_endpoints), k: 'remotely-callable MCP servers' },
    { n: num(mcp.hosts), k: 'distinct MCP hosts' },
  ])}
<p>Neither upstream registry checks whether its own entries still answer. The
Bazaar keeps a resource for 30 days after its last settlement; the MCP registry
lists whatever a publisher declared. So "how much of this is alive" was a
question nobody could answer, and the expectation going in was that a lot of it
would be dead.</p>
<p>It mostly is not: <strong>${pct(x402Health?.answered_share ?? 0, 1)}</strong> of a rotating sample of
the x402 catalog answers, and <strong>${pct(mcpHealth?.answered_share ?? 0, 1)}</strong> of the MCP
catalog. A 402 or a 401 counts as answering here, deliberately — a 402 is the
<em>correct</em> reply from a paid endpoint, and scoring it as a failure would mark
the entire point of an x402 catalog as dead.</p>
<p class="meta">Probed ${esc(x402Health?.probed_at ?? 'n/a')}, a rotating slice per run so a full pass
covers every entry. Raw: <a href="${base}/api/x402/health.json">x402 health</a> ·
<a href="${base}/api/mcp/health.json">MCP health</a>.</p>

<h2>5. Sites are not ready for any of it</h2>
${graded.length ? `<p>${num(graded.length)} sites in this registry are re-graded weekly against the
20-check agent-readability set. The distribution:</p>
<table>
<thead><tr><th>grade</th><th class="num">sites</th><th class="wrap">reading</th></tr></thead>
<tbody>
${['A', 'B', 'C', 'D', 'E', 'F'].filter((g) => byLetter[g]).map((g) => `<tr><td class="grade">${g}</td><td class="num">${num(byLetter[g])}</td><td class="wrap">${esc({
    A: 'agent-ready', B: 'minor gaps', C: 'partially legible', D: 'weak', E: 'barely legible', F: 'effectively invisible to agents',
  }[g])}</td></tr>`).join('\n')}
</tbody></table>
<p>Full ranking, with what each site is missing: <a href="${base}/leaderboard.html">the leaderboard</a>.
What each check means and how to pass it: <a href="${base}/checks/">the checklist</a>.</p>` : ''}

<h2>Method, and what this page will not do</h2>
<p>Client type is inferred from the self-reported user-agent. That is a
traffic-shape signal, not an identity claim: a crawler that lies is counted as
whatever it claims, and the "script" bucket is honestly named because a generic
HTTP client could be an agent or a shell loop. No IP addresses are collected.</p>
<p>Catalog liveness is one probe from one network path, on a rotating sample. It
is evidence, not proof — an endpoint is only called unreachable after two
consecutive misses, and a recovery forgives the record outright.</p>
<p>Everything here describes one site's vantage point on a young ecosystem.
It is a reading, not a census.</p>
`;

  return page({
    base,
    path: '/report.html',
    title: 'The state of the agent web — AI Product Index',
    description: latest
      ? `Measured: ${pct(latest.agent_share, 2)} of traffic is AI agents and rising, `
        + `${num(x402.endpoints)} machine-payable endpoints of which ${pct(x402Health?.answered_share ?? 0, 0)} answer, `
        + 'and zero organic payments.'
      : 'A dated reading of agent traffic, the machine-payable web, and whether any of it converts.',
    ld: {
      '@context': 'https://schema.org',
      '@type': 'Report',
      name: 'The state of the agent web',
      url: `${base}/report.html`,
      ...(latest ? { dateModified: latest.date } : {}),
      publisher: { '@type': 'Organization', name: 'AI Product Index', url: `${base}/` },
    },
    body,
  });
}

// --- (1) and (2) the catalogs ----------------------------------------------

/**
 * One page per catalog. Deliberately *one* page and not fourteen thousand.
 *
 * Generating a thin page per endpoint would read as doorway spam to every
 * search engine, on a site whose entire pitch is being well-made — and it would
 * republish other people's endpoints at a scale that makes the removal request
 * inevitable. So: aggregates, which are the part nobody else publishes anyway,
 * plus a search box wired to the JSON API that already exists. The browsing
 * happens client-side against a live endpoint rather than in generated files.
 *
 * The search degrades to a plain link to the API when JavaScript is off, which
 * is the honest fallback for a page whose data is 8 MB.
 */
export function catalogPage({ base, kind, stats, health, title, lede, columns, searchPath, extraSections = '' }) {
  const total = stats.endpoints ?? stats.remote_endpoints;
  const topHosts = (stats.top_hosts ?? []).slice(0, 25);
  const hostRows = topHosts.map((h, i) => `<tr>
    <td class="num">${i + 1}</td>
    <td class="wrap">${esc(h.host)}</td>
    <td class="num">${num(h.endpoints ?? h.servers ?? h.count ?? 0)}</td>
    <td><div class="bar"><i style="width:${Math.round(((h.endpoints ?? h.servers ?? h.count ?? 0) / (topHosts[0].endpoints ?? topHosts[0].servers ?? topHosts[0].count ?? 1)) * 100)}%"></i></div></td>
  </tr>`).join('\n');

  const body = `
<h1>${esc(title)}</h1>
<p class="lede">${lede}</p>
<p class="meta">Mirrored from <a href="${esc(stats.source_url)}">${esc(stats.source)}</a> on ${esc(stats.fetched)}${health ? `, liveness probed ${esc(health.probed_at)}` : ''}.
Raw: <a href="${base}/api/${kind}/stats.json">stats.json</a> ·
<a href="${base}/api/${kind}/catalog.json">catalog.json</a>${health ? ` · <a href="${base}/api/${kind}/health.json">health.json</a>` : ''}.</p>

${extraSections}

<h2>Search it</h2>
<p>Queries run against <a href="${base}${searchPath}"><code>${esc(searchPath)}</code></a>, the same
endpoint an agent would call. Nothing is stored.</p>
<form id="q-form" onsubmit="return false">
  <p><input id="q" type="search" placeholder="e.g. weather, github, translate" style="padding:.5rem .7rem;font:inherit;width:min(22rem,100%);border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg)">
  <button style="padding:.5rem 1rem;font:inherit;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--fg);cursor:pointer">Search</button></p>
</form>
<div id="q-out"><p class="meta">Results appear here. With JavaScript off, call
<a href="${base}${searchPath}?q=weather">${esc(searchPath)}?q=…</a> directly — it returns JSON.</p></div>
<script>
(function () {
  var f = document.getElementById('q-form'), q = document.getElementById('q'), out = document.getElementById('q-out');
  var cols = ${JSON.stringify(columns)};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function run() {
    var term = q.value.trim();
    if (!term) return;
    out.innerHTML = '<p class="meta">Searching…</p>';
    fetch(${JSON.stringify(searchPath)} + '?q=' + encodeURIComponent(term) + '&limit=25', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var rows = j.results || j.endpoints || j.servers || [];
        if (!rows.length) { out.innerHTML = '<p class="meta">Nothing matched “' + esc(term) + '”.</p>'; return; }
        var h = '<table><thead><tr>' + cols.map(function (c) {
          return '<th class="' + (c.num ? 'num' : (c.wrap ? 'wrap' : '')) + '">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
        rows.forEach(function (r) {
          h += '<tr>' + cols.map(function (c) {
            var v = r[c.key];
            if (c.key === 'url') return '<td class="wrap"><a href="' + esc(v) + '" rel="nofollow noopener">' + esc(v) + '</a></td>';
            if (c.money && v != null) return '<td class="num">$' + Number(v).toFixed(4) + '</td>';
            if (v == null || v === '') return '<td class="' + (c.num ? 'num' : '') + '">—</td>';
            return '<td class="' + (c.num ? 'num' : (c.wrap ? 'wrap' : '')) + '">' + esc(v) + '</td>';
          }).join('') + (r.unreachable ? '' : '') + '</tr>';
        });
        out.innerHTML = h + '</tbody></table><p class="meta">' + esc(rows.length) + ' shown. Entries confirmed unreachable by the weekly probe are flagged in the JSON and never hidden.</p>';
      })
      .catch(function () { out.innerHTML = '<p class="meta">Search failed. The JSON endpoint is at <code>' + ${JSON.stringify(searchPath)} + '</code>.</p>'; });
  }
  f.addEventListener('submit', run);
  document.querySelector('#q-form button').addEventListener('click', run);
})();
</script>

<h2>The ${num(topHosts.length)} largest operators</h2>
<p>Concentration is the thing the headline count hides: ${total ? num(total) : ''} endpoints across
${num(stats.hosts)} hosts means the typical operator publishes a handful, and a few publish thousands.</p>
<table>
<thead><tr><th class="num">#</th><th class="wrap">host</th><th class="num">endpoints</th><th></th></tr></thead>
<tbody>
${hostRows}
</tbody></table>

<h2>Provenance and removal</h2>
<p>This is a mirror of a public registry, republished so it can be queried and
so its liveness is knowable. It states no facts of its own about these
endpoints beyond whether they answered a request. If you operate one of them and
want it gone, open an issue on <a href="https://github.com/${esc(base.includes('percall') ? '110kc3/seo' : '110kc3/seo')}">the repo</a> —
no justification needed, and it is removed on the next build.</p>
`;

  return page({
    base,
    path: `/${kind === 'x402' ? 'x402' : 'mcp-servers'}.html`,
    title: `${title} — AI Product Index`,
    description: lede.replace(/<[^>]+>/g, '').slice(0, 160),
    ld: {
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      name: title,
      description: lede.replace(/<[^>]+>/g, '').slice(0, 300),
      url: `${base}/${kind === 'x402' ? 'x402' : 'mcp-servers'}.html`,
      creator: { '@type': 'Organization', name: 'AI Product Index', url: `${base}/` },
      isBasedOn: stats.source_url,
      dateModified: stats.fetched,
      distribution: [
        { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${base}/api/${kind}/catalog.json` },
      ],
    },
    body,
  });
}

export function x402Page({ base, stats, health }) {
  const p = stats.price_usd ?? {};
  const extra = `
${statCards([
    { n: num(stats.endpoints), k: 'endpoints' },
    { n: num(stats.hosts), k: 'distinct hosts' },
    { n: usd(p.p50 ?? 0), k: 'median price/call' },
    { n: health ? pct(health.answered_share, 1) : '—', k: 'answering, last probe' },
  ])}
<h2>What a call costs</h2>
<table>
<thead><tr><th>percentile</th><th class="num">price per call</th></tr></thead>
<tbody>
<tr><td>cheapest</td><td class="num">${usd(p.min ?? 0)}</td></tr>
<tr><td>median (p50)</td><td class="num">${usd(p.p50 ?? 0)}</td></tr>
<tr><td>p90</td><td class="num">${usd(p.p90 ?? 0)}</td></tr>
<tr><td>most expensive</td><td class="num">${usd(p.max ?? 0)}</td></tr>
</tbody></table>
<p class="meta">${num(p.priced ?? 0)} endpoints publish a price in an asset whose decimals are known.
The other ${num(p.unpriced ?? 0)} are listed without one — guessing six decimals would print a
number wrong by orders of magnitude, so they are excluded from price filters rather than
sorted as free.</p>`;

  return catalogPage({
    base,
    kind: 'x402',
    stats,
    health,
    title: 'The machine-payable web',
    lede: `Every endpoint in the x402 Bazaar that an agent can pay for and call: ${num(stats.endpoints)} of them across ${num(stats.hosts)} hosts, with prices, and — the part nobody else publishes — whether they still answer.`,
    searchPath: '/api/x402/search',
    columns: [
      { key: 'url', label: 'endpoint', wrap: true },
      { key: 'price', label: 'price', num: true, money: true },
      { key: 'method', label: 'method' },
      { key: 'chain', label: 'chain' },
      { key: 'description', label: 'what it does', wrap: true },
    ],
    extraSections: extra,
  });
}

export function mcpPage({ base, stats, health }) {
  const auth = stats.by_auth ?? {};
  const transport = stats.by_transport ?? {};
  const extra = `
${statCards([
    { n: num(stats.remote_endpoints), k: 'callable servers' },
    { n: num(stats.hosts), k: 'distinct hosts' },
    { n: num(auth.none ?? 0), k: 'need no credentials' },
    { n: health ? pct(health.answered_share, 1) : '—', k: 'answering, last probe' },
  ])}
<h2>What is in scope</h2>
<p>The rule is <strong>${esc(stats.scope?.rule ?? 'active + latest + remotely callable')}</strong>, and the
exclusions are the opinion. A server distributed only as an installable package is
a thing you set up; one with a URL is a thing an agent can use right now, and this
catalog answers the second question.</p>
<table>
<thead><tr><th class="wrap">from ${num(stats.scope?.registry_records_seen ?? 0)} registry records</th><th class="num">excluded</th></tr></thead>
<tbody>
<tr><td class="wrap">superseded by a newer version</td><td class="num">${num(stats.scope?.excluded_superseded ?? 0)}</td></tr>
<tr><td class="wrap">marked inactive</td><td class="num">${num(stats.scope?.excluded_inactive ?? 0)}</td></tr>
<tr><td class="wrap">package-only, no remote URL</td><td class="num">${num(stats.scope?.excluded_packages_only ?? 0)}</td></tr>
</tbody></table>
${Object.keys(auth).length ? `<h2>Credentials and transport</h2>
<table>
<thead><tr><th>auth</th><th class="num">servers</th><th>transport</th><th class="num">servers</th></tr></thead>
<tbody>
${Object.entries(auth).sort((a, b) => b[1] - a[1]).map(([k, v], i) => {
    const t = Object.entries(transport).sort((a, b) => b[1] - a[1])[i];
    return `<tr><td>${esc(k)}</td><td class="num">${num(v)}</td><td>${t ? esc(t[0]) : ''}</td><td class="num">${t ? num(t[1]) : ''}</td></tr>`;
  }).join('\n')}
</tbody></table>` : ''}`;

  return catalogPage({
    base,
    kind: 'mcp',
    stats,
    health,
    title: 'MCP servers you can actually call',
    lede: `${num(stats.remote_endpoints)} remotely-callable MCP servers across ${num(stats.hosts)} hosts — the ones with a URL, not the ones you would have to install — checked weekly for whether they answer.`,
    searchPath: '/api/mcp/search',
    columns: [
      { key: 'url', label: 'endpoint', wrap: true },
      { key: 'title', label: 'name', wrap: true },
      { key: 'auth', label: 'auth' },
      { key: 'transport', label: 'transport' },
      { key: 'description', label: 'what it does', wrap: true },
    ],
    extraSections: extra,
  });
}

// --- (5) the leaderboard ----------------------------------------------------

/**
 * Every graded listing, ranked. Three jobs at once: it gives the browser
 * traffic something to read, it is the reciprocal-link surface (each row links
 * to a listing page that carries the site's own badge), and every row below a B
 * is a Track A prospect with the evidence already attached.
 */
export function leaderboardPage({ base, scores, listings }) {
  const bySlug = new Map(listings.map((l) => [l.slug, l]));
  const rows = Object.entries(scores)
    .filter(([, s]) => s.letter)
    .map(([slug, s]) => ({ slug, ...s, listing: bySlug.get(slug) }))
    .filter((r) => r.listing)
    .sort((a, b) => (b.score - a.score) || a.slug.localeCompare(b.slug));

  const checked = [...new Set(rows.map((r) => r.checked).filter(Boolean))].sort().at(-1);
  const setUsed = [...new Set(rows.map((r) => r.check_set ?? 'v1'))].sort().join(', ');
  const avg = rows.length ? rows.reduce((a, r) => a + r.score, 0) / rows.length : 0;
  const perfect = rows.filter((r) => r.score === 100).length;

  const body = `
<h1>Agent-readability leaderboard</h1>
<p class="lede">Every product in this registry, graded by the same public endpoint
anyone can call on any URL. Re-scored weekly, unedited.</p>
${statCards([
    { n: num(rows.length), k: 'sites graded' },
    { n: avg.toFixed(1), k: 'average score' },
    { n: num(perfect), k: 'at 100/100' },
    { n: esc(checked ?? '—'), k: 'last re-scored' },
  ])}
<p class="meta">Check set <code>${esc(setUsed)}</code>. Grades come from
<a href="${base}/api/score?url=https://example.com">GET /api/score</a>, which is free
and which you can run against your own site right now. Raw:
<a href="${base}/scores.json">scores.json</a>.</p>

<table>
<thead><tr><th class="num">#</th><th class="wrap">site</th><th>grade</th><th class="num">score</th><th class="num">passed</th><th></th></tr></thead>
<tbody>
${rows.map((r, i) => `<tr>
  <td class="num">${i + 1}</td>
  <td class="wrap"><a href="${base}/l/${esc(r.slug)}.html">${esc(r.listing.name)}</a></td>
  <td class="grade">${esc(r.letter)}</td>
  <td class="num">${r.score}</td>
  <td class="num">${r.passed}/${r.total}</td>
  <td><div class="bar"><i style="width:${Math.max(0, Math.min(100, r.score))}%"></i></div></td>
</tr>`).join('\n')}
</tbody></table>

<h2>How to move up this table</h2>
<p>Every grade here is reproducible: call
<code>${base}/api/score?url=YOUR_SITE</code> and you get the same letter, the same
score, and the name of every check that failed — free, no signup. What the
$0.05 paid call adds is why each one failed and a paste-ready snippet for your
own domain.</p>
<p>The checks themselves are documented one page each, with the fix:
<a href="${base}/checks/">the checklist</a>.</p>
<p class="meta">A grade that says "not scored yet" means the weekly cron has not reached
that listing, not that it failed. A transient failure keeps the previous week's
grade rather than blanking it.</p>
`;

  return page({
    base,
    path: '/leaderboard.html',
    title: 'Agent-readability leaderboard — AI Product Index',
    description: `${rows.length} sites graded for how readable they are to AI agents, re-scored weekly. Average ${avg.toFixed(1)}/100, ${perfect} at 100.`,
    ld: {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Agent-readability leaderboard',
      url: `${base}/leaderboard.html`,
      numberOfItems: rows.length,
      itemListElement: rows.slice(0, 25).map((r, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${base}/l/${r.slug}.html`,
        name: r.listing.name,
      })),
    },
    body,
  });
}

// --- (6) the checklist ------------------------------------------------------

// Why each check is worth what it is worth. The audit ships the *remedy*
// (CHECK_META.fix); this is the argument for caring, which is the half a
// customer asks about before paying anyone to fix it. Kept here rather than in
// audit.js because it is documentation, not product behaviour — nothing in the
// scorer reads it.
const WHY = {
  llms_txt: 'It is the first file an arriving agent fetches after robots.txt, and the only one whose entire purpose is to tell a model what you are. Absent, the agent has to infer your site from HTML written for humans.',
  llms_txt_summary: 'The blockquote is what gets quoted. When a model describes you in an answer, this paragraph is the raw material — leaving it out means the description is assembled from whatever the crawler happened to keep.',
  llms_full_txt: 'One fetch instead of twenty. An agent working with a token budget will read a single file that contains everything long before it will crawl your sitemap.',
  robots_txt: 'Its absence is ambiguous rather than permissive, and several crawlers resolve ambiguity as "stay out". This is the cheapest check on the list to pass.',
  ai_crawlers_allowed: 'A Disallow that names GPTBot or ClaudeBot is a decision to be absent from the answers those models give. Sometimes that is the right call — but it should be a decision, and it is very often inherited from a default nobody chose.',
  sitemap: 'It is the only machine-readable statement of what pages exist. Without it a crawler discovers your site by following links, which means anything not linked from the home page is effectively unpublished.',
  json_ld: 'Structured data is the difference between a model guessing what your page is about and being told. It is also the single heaviest check here, because it is the one that most reliably changes how you are described.',
  title_and_description: 'The cheapest signal any extractor has, and the one most often left to a CMS default. A page titled "Home" tells a model nothing at all.',
  open_graph: 'Agents reuse OG tags when they surface you in a card, the same way social platforms do. It is a second, independent description that costs three tags.',
  canonical: 'Duplicate URLs split whatever reputation a page earns. A canonical collapses them into one citable address, which matters more when the citer is a model that will only ever quote one.',
  machine_alternates: 'It tells an agent that a JSON or Markdown version of this page exists. Without it, a client that would rather parse data than HTML has no way to discover that it can.',
  agent_card: 'It is what turns a page into a tool: a machine-readable statement of what you can be asked to do. The path moved in A2A 1.0, and a card only at the old location is invisible to a compliant client.',
  https: 'Several crawlers will not follow a plain-http origin at all, so this is less a ranking factor than a precondition.',
  content_signals: 'It states how your content may be used — search, AI answers, training — in the one place a crawler already looks. Under 5% of sites declare it, so it is a differentiator rather than a baseline, and the common default was written for publishers protecting an archive rather than for anyone who wants to be read.',
  agent_card_current_path: 'A2A reached 1.0 and the card moved to /.well-known/agent-card.json. A spec-compliant client never looks at the old path, so a site serving only the old one is invisible to exactly the clients that implemented the spec properly.',
  mcp_server_card: 'The discovery route for tool-using agents. If you run an MCP server, this is how a client finds it without being handed a URL by a human.',
  api_catalog: 'RFC 9727. If you already publish OpenAPI it states nothing new — it states it where a machine looking for APIs is specified to look.',
  agent_skills: 'It declares what an agent can accomplish on your site without reading your docs. Adoption is tiny, which is exactly why it distinguishes you.',
  markdown_negotiation: 'An agent parsing your HTML is guessing which parts are content. Answering Accept: text/markdown with a markdown twin removes the guess, and it costs one content-negotiation branch.',
  web_bot_auth: 'It lets you tell a real signed agent from anything that copied its user-agent string, and it lets callers verify your responses. The infrastructure side of agent traffic rather than the content side.',
};

/**
 * One page per check, generated from CHECK_META / SIGNAL_META / SNIPPETS.
 *
 * Twenty pages is the one place on this site where per-item pages are the right
 * call rather than doorway spam: each is a distinct question a buyer actually
 * asks ("what is llms.txt and do I need one"), each carries a different remedy
 * and a different code snippet, and the content is argument rather than a
 * database row reformatted.
 */
export function checkPages({ base, checkMeta, signalMeta, v2Weights, labels, snippets }) {
  const items = [
    ...Object.entries(checkMeta).map(([id, m]) => ({
      id, weight: m.weight, fix: m.fix, label: labels[id] ?? id, set: 'v1', scored: true,
    })),
    ...Object.entries(signalMeta).map(([id, m]) => ({
      id, weight: v2Weights[id] ?? 0, fix: m.fix, label: m.label, set: 'v2', scored: true,
    })),
  ];
  const total = items.reduce((a, i) => a + i.weight, 0);

  const pages = new Map();

  for (const item of items) {
    const snippet = snippets[item.id];
    const others = items.filter((i) => i.id !== item.id);
    const body = `
<h1>${esc(item.label)}</h1>
<p class="lede">${esc(WHY[item.id] ?? '')}</p>
<div class="cards">
  <div class="card"><div class="n">${item.weight}</div><div class="k">of ${total} points</div></div>
  <div class="card"><div class="n">${pct(item.weight / total, 1)}</div><div class="k">of the total grade</div></div>
  <div class="card"><div class="n">${item.set === 'v1' ? '2025' : '2026'}</div><div class="k">checklist generation</div></div>
</div>

<h2>How to pass it</h2>
<p>${esc(item.fix)}</p>
${snippet ? `<h2>Paste-ready</h2>
<p class="meta">Replace <code>{{ORIGIN}}</code> with your own origin — or call the paid endpoint, which
substitutes it for you and tells you which checks you actually failed.</p>
<pre><code>${esc(snippet)}</code></pre>` : ''}

<h2>Check your own site</h2>
<p>Free, no signup, same endpoint that produced every grade on
<a href="../leaderboard.html">the leaderboard</a>:</p>
<pre><code>curl "${base}/api/score?url=https://your-site.example"</code></pre>
<p>It returns the letter grade and every check by name with pass/fail. The
$0.05 call at <code>POST /api/audit</code> adds why each one failed and a
snippet with your origin already in it.</p>

<h2>The rest of the checklist</h2>
<p class="meta">${others.filter((i) => i.set === item.set).length} more ${item.set === 'v1' ? '2025' : '2026'} checks, and ${others.filter((i) => i.set !== item.set).length} from the other generation.</p>
<ul>${others.map((i) => `<li><a href="${esc(i.id)}.html">${esc(i.label)}</a> <span class="meta">${i.weight} pts</span></li>`).join('')}</ul>
`;
    pages.set(`${item.id}.html`, page({
      base,
      path: `/checks/${item.id}.html`,
      title: `${item.label} — agent-readability checklist`,
      description: `${WHY[item.id] ?? item.fix}`.slice(0, 160),
      depth: 1,
      ld: {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: item.label,
        description: WHY[item.id] ?? item.fix,
        url: `${base}/checks/${item.id}.html`,
        step: [{ '@type': 'HowToStep', text: item.fix }],
      },
      body,
    }));
  }

  const row = (i) => `<tr>
    <td class="wrap"><a href="${esc(i.id)}.html">${esc(i.label)}</a></td>
    <td class="num">${i.weight}</td>
    <td><div class="bar"><i style="width:${Math.round((i.weight / 15) * 100)}%"></i></div></td>
    <td class="wrap">${esc((WHY[i.id] ?? '').split('.')[0])}.</td>
  </tr>`;

  const indexBody = `
<h1>The agent-readability checklist</h1>
<p class="lede">Twenty checks, ${total} points, and the reasoning behind each weight.
This is the whole checklist the audit scores against — published in full, because
what is worth paying for is the diagnosis of your site, not secrecy about what
good looks like.</p>
<p class="meta">Generated from the same constants the scorer reads, so this page and the
product cannot disagree. Run it against your own site free:
<code>${base}/api/score?url=…</code></p>

<h2>The 2025 checks (${items.filter((i) => i.set === 'v1').length}, ${items.filter((i) => i.set === 'v1').reduce((a, i) => a + i.weight, 0)} points)</h2>
<p>Established signals. Every grade this site has ever published was produced by these alone.</p>
<table>
<thead><tr><th class="wrap">check</th><th class="num">weight</th><th></th><th class="wrap">why it matters</th></tr></thead>
<tbody>
${items.filter((i) => i.set === 'v1').sort((a, b) => b.weight - a.weight).map(row).join('\n')}
</tbody></table>

<h2>The 2026 checks (${items.filter((i) => i.set === 'v2').length}, ${items.filter((i) => i.set === 'v2').reduce((a, i) => a + i.weight, 0)} points)</h2>
<p>Newer surfaces — Content Signals, the A2A 1.0 card path, MCP server cards, API
catalogs, Agent Skills, markdown negotiation, Web Bot Auth. <strong>Every one is
weighted below the cheapest 2025 check on purpose</strong>: under 15% of the web
publishes them, so missing one is normal rather than negligent, and it must never
cost what missing llms.txt costs.</p>
<table>
<thead><tr><th class="wrap">check</th><th class="num">weight</th><th></th><th class="wrap">why it matters</th></tr></thead>
<tbody>
${items.filter((i) => i.set === 'v2').sort((a, b) => b.weight - a.weight).map(row).join('\n')}
</tbody></table>

<h2>Why the weights are public</h2>
<p>An audit whose scoring is secret cannot be argued with, and one that cannot be
argued with is not worth much. These weights are judgements — that structured data
matters more than Open Graph, that an absent llms.txt costs more than an absent
Agent Skills index — and publishing them is what makes them reviewable. If one
looks wrong, it probably is; the repository is <a href="https://github.com/110kc3/seo">open</a>.</p>
<p>See how ${''}sites in this registry actually score: <a href="../leaderboard.html">the leaderboard</a>.</p>
`;

  pages.set('index.html', page({
    base,
    path: '/checks/',
    title: 'The agent-readability checklist — AI Product Index',
    description: `All 20 agent-readability checks, their weights and the reasoning behind each — the complete checklist the free score and the $0.05 audit grade against.`,
    depth: 1,
    ld: {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Agent-readability checklist',
      url: `${base}/checks/`,
      numberOfItems: items.length,
      itemListElement: items.map((i, n) => ({
        '@type': 'ListItem', position: n + 1, url: `${base}/checks/${i.id}.html`, name: i.label,
      })),
    },
    body: indexBody,
  }));

  return pages;
}

// --- (7) how the checkers differ -------------------------------------------

/**
 * A comparison written from documented behaviour only.
 *
 * The rule for this page: every claim about somebody else is something their
 * own published checklist says, or something observed by actually being audited
 * by them — both of which happened. No inferred weaknesses, no invented
 * weightings, and their strengths are stated where they are real. A comparison
 * page that shades its rivals is worth less than none on a site selling
 * accuracy about other people's sites.
 */
export function comparePage({ base, checkCount }) {
  const body = `
<h1>How agent-readiness checkers differ</h1>
<p class="lede">There are several ways to be told whether AI agents can read your
site, and they disagree — not about the facts, but about what counts. This page
is the honest map, including where this one is the weaker choice.</p>

<h2>The three worth knowing</h2>
<table>
<thead><tr><th class="wrap">checker</th><th class="wrap">what it is</th><th class="wrap">how you use it</th></tr></thead>
<tbody>
<tr>
  <td class="wrap"><strong>Cloudflare Agent Readiness</strong></td>
  <td class="wrap">The most complete published checklist: discoverability, content, bot access control, capabilities, and commerce as a checked-but-unscored dimension.</td>
  <td class="wrap">Tied to Cloudflare's own tooling and audience. The checklist itself is public and worth reading whoever hosts you.</td>
</tr>
<tr>
  <td class="wrap"><strong>agentswelcome.dev</strong></td>
  <td class="wrap">18 checks and a certification gate at 70/100, plus a public directory of sites that pass.</td>
  <td class="wrap">Pure API, no account: POST a URL and it audits you live. The directory listing is the point — it is a place to be found.</td>
</tr>
<tr>
  <td class="wrap"><strong>This site</strong></td>
  <td class="wrap">${checkCount} weighted checks across two published generations, with every weight and remedy documented at <a href="checks/">/checks/</a>.</td>
  <td class="wrap">Free grade over GET, paid per-check fixes over HTTP 402. Callable by an agent without a human present, which is the part the others do not do.</td>
</tr>
</tbody></table>

<h2>Where this one is genuinely different</h2>
<ul>
<li><strong>It is callable and payable by a machine.</strong> An agent can grade a URL and buy the detailed fixes in the same session, with no signup, no dashboard and no human. That is the whole design, and it is why the price is five cents rather than a monthly plan.</li>
<li><strong>The scoring is versioned and published.</strong> Grades record which checklist produced them, so a re-score under a newer set is distinguishable from a site that got worse. Weights are in the open at <a href="checks/">/checks/</a>.</li>
<li><strong>The remedy is code, not advice.</strong> Every failing check comes back with a paste-ready snippet carrying your own origin.</li>
</ul>

<h2>Where it is not the right tool</h2>
<ul>
<li><strong>One page, not a crawl.</strong> The audit reads your origin and its well-known paths. If you need every page on a large site checked, this is the wrong shape and no amount of five-cent calls fixes that.</li>
<li><strong>No certification badge anyone else recognises.</strong> agentswelcome.dev's directory is a real distribution surface; a grade from here is a grade from here. Being listed there is worth doing regardless of this site — <a href="${base}/report.html">we did it</a>.</li>
<li><strong>It cannot see inside your infrastructure.</strong> If Cloudflare hosts you, their audit sees configuration this one has to infer from the outside, and theirs will be right where they disagree.</li>
</ul>

<h2>The honest advice</h2>
<p>Run all three. They are free, they take a minute each, and they overlap enough
that anything all three flag is real. Where they differ is mostly recency: checklists
have been moving fast, several specs changed paths in the last year, and a checker
that has not been updated recently will pass you on a path a current client no longer
reads. That is the failure mode worth checking for in any of them, including this one —
which is why the check set here is versioned in public.</p>
<p><a href="${base}/api/score?url=https://example.com">Try the free grade</a> ·
<a href="checks/">read the checklist</a> ·
<a href="${base}/leaderboard.html">see how others score</a>.</p>
`;

  return page({
    base,
    path: '/compare.html',
    title: 'How agent-readiness checkers differ — AI Product Index',
    description: 'An honest comparison of Cloudflare Agent Readiness, agentswelcome.dev and this site, including where this one is the weaker choice.',
    ld: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'How agent-readiness checkers differ',
      url: `${base}/compare.html`,
      publisher: { '@type': 'Organization', name: 'AI Product Index', url: `${base}/` },
    },
    body,
  });
}

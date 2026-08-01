// Query surfaces: the endpoints an agent reaches for when it wants an *answer*
// rather than a file.
//
// Everything else this site serves is a document you have to know the URL of.
// These three take a question:
//
//   GET  /api/search?q=…   plain HTTP search over the registry
//   POST /ask             NLWeb — natural language in, schema.org out
//   POST /mcp             Model Context Protocol over streamable HTTP
//
// All three answer from the committed registry bundled into the Worker, so they
// cost one CPU slice and no network — the same data `/api/index.json` serves,
// never a second copy that can drift.

const MAX_QUERY = 512;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How well one term matches one field, as a multiplier on that field's weight.
 *
 *   1.0  the whole word is there          "camera" in "old cameras"? no — see below
 *   0.6  it appears inside another word   "api" in "rapid"
 *   0.5  a word shares its stem           "agents"/"agent", "readable"/"readability"
 *
 * The stem tier exists because English plurals and nominalisations broke real
 * queries: "how do I make my site readable to AI agents" missed the listing
 * called *Agent Readability Service* — `agents` is not `agent` and `readable`
 * is not `readability`, so an exact matcher scored it zero. Rather than ship a
 * stemmer, two words count as the same stem when they share a prefix at least
 * 60% as long as the shorter of them (minimum four characters). It is crude and
 * it will occasionally pair unrelated words, which is why it scores half: an
 * exact hit always outranks it, and the relevance floor drops it when nothing
 * better exists to compare against.
 */
function strength(haystack, term) {
  if (!haystack || !term) return 0;
  if (new RegExp(`\\b${escapeRe(term)}\\b`).test(haystack)) return 1;
  if (haystack.includes(term)) return 0.6;

  const floor = Math.max(4, Math.ceil(term.length * 0.6));
  for (const word of haystack.split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < floor) continue;
    let i = 0;
    while (i < word.length && i < term.length && word[i] === term[i]) i += 1;
    if (i >= floor && i >= Math.ceil(Math.min(word.length, term.length) * 0.6)) return 0.5;
  }
  return 0;
}

/**
 * Ranked substring search. Deliberately not a fuzzy matcher: with a registry
 * this small, a scorer that can rank an unrelated listing above an exact name
 * match is worse than one that returns nothing — an agent can widen its own
 * query, but it cannot tell that a confident wrong answer is wrong.
 *
 * Weights: name beats tag beats description, and a whole-word hit beats a
 * substring, so "api" does not rank "rapidfire" over "API Gateway".
 */
export function searchListings(listings, { q = '', category = '', tag = '', limit = DEFAULT_LIMIT, minScoreRatio = 0 } = {}) {
  const needle = String(q).trim().toLowerCase().slice(0, MAX_QUERY);
  const terms = needle ? needle.split(/\s+/).filter(Boolean) : [];

  const scored = [];
  for (const l of listings) {
    if (category && l.category !== category) continue;
    if (tag && !(l.tags ?? []).includes(tag)) continue;

    let score = 0;
    if (terms.length) {
      const name = String(l.name ?? '').toLowerCase();
      const desc = String(l.description ?? '').toLowerCase();
      const tags = (l.tags ?? []).map((t) => String(t).toLowerCase()).join(' ');
      const slug = String(l.slug ?? '').toLowerCase().replace(/-/g, ' ');
      for (const term of terms) {
        score += 10 * strength(name, term);
        score += 5 * strength(tags, term);
        score += 4 * strength(slug, term);
        score += 3 * strength(desc, term);
      }
      if (score === 0) continue;
    }
    scored.push({ listing: l, score });
  }

  // Stable within a score band: slug order, so the same query answers the same
  // way twice. An agent comparing two runs must not see phantom churn.
  scored.sort((a, b) => b.score - a.score || String(a.listing.slug).localeCompare(String(b.listing.slug)));

  // A relevance floor, relative to the best hit rather than absolute — scores
  // scale with how many words the query had, so any fixed threshold is wrong
  // for some query length. /api/search does not use one (an explicit query
  // wants every match, and the caller sets the limit), but a natural-language
  // answer does: "polish property auctions" matching seven of eight listings
  // because they all say "polish" is a worse answer than two right ones.
  const relevant = minScoreRatio > 0 && scored.length
    ? scored.filter((s) => s.score >= scored[0].score * minScoreRatio)
    : scored;

  const capped = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { total: relevant.length, hits: relevant.slice(0, capped) };
}

const publicFields = (l, base) => ({
  slug: l.slug,
  name: l.name,
  url: l.url,
  description: l.description,
  category: l.category,
  pricing: l.pricing,
  tier: l.tier,
  tags: l.tags ?? [],
  machine_endpoints: l.machine_endpoints ?? undefined,
  page: `${base}/l/${l.slug}.html`,
  json: `${base}/listings/${l.slug}.json`,
});

/** GET /api/search?q=…&category=…&tag=…&limit=… */
export function handleSearch(url, listings, base) {
  const params = url.searchParams;
  const q = params.get('q') ?? params.get('query') ?? '';
  const { total, hits } = searchListings(listings, {
    q,
    category: params.get('category') ?? '',
    tag: params.get('tag') ?? '',
    limit: params.get('limit') ?? DEFAULT_LIMIT,
  });

  return json({
    ok: true,
    query: q,
    total,
    count: hits.length,
    results: hits.map(({ listing }) => publicFields(listing, base)),
    // A zero-result answer that just says "0" teaches an agent nothing. Say
    // what the corpus contains so the next query can be better, and how to
    // add the thing it was looking for.
    ...(hits.length === 0 && {
      corpus: { listings: listings.length, categories: [...new Set(listings.map((l) => l.category))].sort() },
      register: `${base}/llms.txt`,
    }),
  }, 200, { 'cache-control': 'public, max-age=300' });
}

// --- mirrored catalogs ------------------------------------------------------
//
// Two ecosystems are indexed exhaustively here because nobody indexes them in a
// way you can query:
//
//   x402  ~14.7k paid HTTP endpoints, from the Coinbase CDP Bazaar
//   mcp   ~2.2k remotely-callable MCP servers, from the official MCP registry
//
// Both upstreams publish cursor or offset paging and nothing else — no query,
// no filter, no aggregate — so "is there one that does X" means pulling every
// record yourself. Each is normalized into a compact positional index at build
// time and answered here in one call.
//
// An index is loaded from our own static assets on first use and kept in module
// scope for the life of the isolate: a few MB parsed once, then free. Loading is
// lazy so the requests that never touch a catalog pay nothing for it.

export const CATALOGS = {
  x402: {
    path: 'x402',
    source: 'Coinbase CDP x402 Bazaar',
    unit: 'endpoints',
    // Filters are declared, not hand-coded per catalog: `eq` compares exactly,
    // `includes` is a substring, `lte` is an upper bound that also rejects rows
    // with no value — an unknown price is not a low one.
    filters: { chain: ['chain', 'eq'], method: ['method', 'eq'], host: ['host', 'includes'], max_price: ['price', 'lte'] },
    weights: { description: 6, url: 4, host: 2 },
    // On a pay-per-call rail, price is the tiebreak an agent actually cares
    // about, so equally relevant hits come back cheapest first.
    tiebreak: 'price',
  },
  mcp: {
    path: 'mcp',
    source: 'Official MCP Registry (registry.modelcontextprotocol.io)',
    unit: 'servers',
    filters: { transport: ['transport', 'eq'], host: ['host', 'includes'], auth: ['auth', 'eq'] },
    weights: { description: 6, title: 5, name: 4, url: 2 },
    tiebreak: null,
  },
};

const catalogPromises = new Map();

function loadCatalog(env, base, key) {
  if (!catalogPromises.has(key)) {
    const promise = (async () => {
      const url = `${base}/api/${CATALOGS[key].path}/index.json`;
      const resp = env?.ASSETS ? await env.ASSETS.fetch(new Request(url)) : await fetch(url);
      if (!resp.ok) throw new Error(`catalog unavailable (HTTP ${resp.status})`);
      const body = await resp.json();
      return { ...body, at: Object.fromEntries(body.fields.map((f, i) => [f, i])) };
    })().catch((e) => {
      // A failed load must not poison every later request: drop the cached
      // promise so the next caller retries rather than replaying the error.
      catalogPromises.delete(key);
      throw e;
    });
    catalogPromises.set(key, promise);
  }
  return catalogPromises.get(key);
}

/**
 * GET /api/{x402,mcp}/search?q=…&limit=… plus that catalog's declared filters.
 */
export async function handleCatalogSearch(key, url, env, base) {
  const spec = CATALOGS[key];
  if (!spec) return json({ ok: false, code: 'unknown_catalog', error: `no catalog "${key}"` }, 404);

  let catalog;
  try {
    catalog = await loadCatalog(env, base, key);
  } catch (e) {
    return json({ ok: false, code: 'catalog_unavailable', error: e.message }, 503);
  }

  const p = url.searchParams;
  const q = (p.get('q') ?? p.get('query') ?? '').trim().toLowerCase().slice(0, MAX_QUERY);
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  const limit = Math.min(Math.max(Number(p.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const { at } = catalog;

  const active = [];
  for (const [param, [field, op]] of Object.entries(spec.filters)) {
    const raw = p.get(param);
    if (raw === null || raw === '' || at[field] === undefined) continue;
    active.push([at[field], op, op === 'lte' ? Number(raw) : raw.toLowerCase()]);
  }

  const scored = [];
  rows: for (const row of catalog.rows) {
    for (const [i, op, want] of active) {
      const value = row[i];
      if (op === 'lte') {
        if (typeof value !== 'number' || !Number.isFinite(want) || value > want) continue rows;
      } else if (op === 'includes') {
        if (!String(value ?? '').toLowerCase().includes(want)) continue rows;
      } else if (String(value ?? '').toLowerCase() !== want) continue rows;
    }

    let score = 0;
    if (terms.length) {
      for (const term of terms) {
        for (const [field, weight] of Object.entries(spec.weights)) {
          if (at[field] === undefined) continue;
          score += weight * strength(String(row[at[field]] ?? '').toLowerCase(), term);
        }
      }
      if (score === 0) continue;
    }
    scored.push([score, row]);
  }

  const tie = spec.tiebreak && at[spec.tiebreak] !== undefined ? at[spec.tiebreak] : null;
  scored.sort((a, b) => b[0] - a[0]
    || (tie === null ? 0 : (a[1][tie] ?? Infinity) - (b[1][tie] ?? Infinity))
    || String(a[1][at.url]).localeCompare(String(b[1][at.url])));

  const view = ([, row]) => Object.fromEntries(catalog.fields.map((f, i) => [f, row[i]]));
  return json({
    ok: true,
    query: q,
    total: scored.length,
    count: Math.min(scored.length, limit),
    results: scored.slice(0, limit).map(view),
    source: spec.source,
    fetched: catalog.fetched,
    catalog: {
      [spec.unit]: catalog.count,
      full: `${base}/api/${spec.path}/catalog.json`,
      stats: `${base}/api/${spec.path}/stats.json`,
    },
  }, 200, { 'cache-control': 'public, max-age=600' });
}

// --- NLWeb ------------------------------------------------------------------
// nlweb.ai: POST /ask with {query: {text}}, answered with schema.org objects
// under `results`. The protocol's whole premise is that a site already
// publishes schema.org — this one does, on every listing page — so answering
// is a projection of the registry, not a second content model.

const NLWEB_VERSION = '0.55';

const asSchemaOrg = (l, base) => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: l.name,
  description: l.description,
  url: l.url,
  applicationCategory: l.category,
  offers: { '@type': 'Offer', category: l.pricing },
  ...(l.tags?.length ? { keywords: l.tags.join(', ') } : {}),
  subjectOf: { '@type': 'WebPage', url: `${base}/l/${l.slug}.html` },
});

/** POST /ask — and GET /ask?query=… , because half of what calls this is curl. */
export async function handleAsk(request, listings, base) {
  let text = '';
  let site = '';
  let mode = 'list';

  if (request.method === 'POST') {
    let body;
    try {
      body = JSON.parse((await request.text()) || '{}');
    } catch (e) {
      return json({ _meta: { response_type: 'failure', version: NLWEB_VERSION }, error: `invalid JSON: ${e.message.slice(0, 120)}` }, 400);
    }
    // The spec nests the question under query.text; accept a bare string too,
    // because every hand-written client gets this wrong on the first try and a
    // 400 teaches it nothing it could not be told by answering.
    text = typeof body.query === 'string' ? body.query : (body.query?.text ?? body.text ?? '');
    site = body.query?.site ?? body.site ?? '';
    mode = body.prefer?.mode ?? 'list';
  } else {
    const p = new URL(request.url).searchParams;
    text = p.get('query') ?? p.get('q') ?? '';
    site = p.get('site') ?? '';
    mode = p.get('mode') ?? 'list';
  }

  if (typeof text !== 'string' || !text.trim()) {
    return json({
      _meta: { response_type: 'elicitation', version: NLWEB_VERSION },
      results: [],
      // An elicitation is the protocol's way of asking a question back.
      elicitation: 'What are you looking for? This corpus is a directory of AI products — try "MCP server", "free API", or a category.',
      corpus: { listings: listings.length, categories: [...new Set(listings.map((l) => l.category))].sort() },
    }, 200);
  }

  // `site` scopes the query to a corpus. We are one corpus; an unknown one is
  // answered honestly rather than silently treated as ours.
  const host = new URL(base).host;
  if (site && site !== host && site !== base && site !== 'all') {
    return json({
      _meta: { response_type: 'failure', version: NLWEB_VERSION },
      results: [],
      error: `this endpoint serves one site (${host}); it cannot answer for "${site}"`,
    }, 400);
  }

  // Natural language in, so strip the words that carry no signal in a corpus
  // this small — otherwise "do you have any MCP servers?" scores on "any".
  const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'do', 'does', 'you', 'have', 'any', 'for', 'me', 'i', 'want', 'need', 'looking', 'find', 'show', 'what', 'which', 'to', 'of', 'in', 'on', 'with', 'that', 'can', 'please', 'best', 'good', 'some', 'and', 'or']);
  const keywords = text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

  // 0.5: a hit has to be at least half as good as the best one to be offered
  // as part of an answer. Tuned against the real corpus, where a one-word
  // incidental match ("polish") scores 1–3 against a name-and-tag match's 15+.
  const { total, hits } = searchListings(listings, { q: keywords.join(' '), limit: 10, minScoreRatio: 0.5 });

  return json({
    _meta: {
      response_type: hits.length ? 'answer' : 'answer',
      response_format: 'conversational_search',
      version: NLWEB_VERSION,
      mode,
    },
    query: { text, site: host },
    results: hits.map(({ listing }) => asSchemaOrg(listing, base)),
    ...(mode.includes('summarize') && {
      summary: hits.length
        ? `${total} of ${listings.length} indexed products match "${text}". Top result: ${hits[0].listing.name} — ${hits[0].listing.description}`
        : `Nothing in this directory matches "${text}". It indexes ${listings.length} AI products; anything can be added autonomously via ${base}/llms.txt.`,
    }),
    ...(hits.length === 0 && { register: `${base}/llms.txt` }),
  }, 200, { 'cache-control': 'public, max-age=300' });
}

// --- MCP over streamable HTTP -----------------------------------------------
// The same tools as mcp/server.mjs, reachable without installing anything: any
// MCP client that takes a URL can add this site as a tool source. That is the
// difference between being a directory an agent could find and one it can call.
//
// Only the JSON-RPC half of the streamable-HTTP transport is implemented —
// POST in, one JSON response out. No SSE stream and no session resumption,
// which the transport permits: a server with no server-initiated messages has
// nothing to stream. `initialize` says so by declaring only `tools`.

const MCP_PROTOCOL_VERSION = '2025-06-18';

export function mcpTools(base) {
  return [
    {
      name: 'search_products',
      title: 'Search the AI Product Index',
      description: `Search ${base} — a directory of AI products, APIs, agents and MCP servers that register themselves. Returns matching listings with their URLs and machine-readable endpoints.`,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words matched against name, tags and description. Omit to list everything.' },
          category: { type: 'string', enum: ['api', 'app', 'agent', 'mcp', 'other'], description: 'Restrict to one category.' },
          tag: { type: 'string', description: 'Restrict to listings carrying this tag.' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Max results (default ${DEFAULT_LIMIT}).` },
        },
      },
    },
    {
      name: 'get_product',
      title: 'Get one listing',
      description: 'Fetch one listing from the AI Product Index by slug, with every published field.',
      inputSchema: {
        type: 'object',
        properties: { slug: { type: 'string', description: 'The listing slug, as returned by search_products.' } },
        required: ['slug'],
      },
    },
    {
      name: 'score_url',
      title: 'Score a site for agent-readability',
      description: 'Grade any public URL A–F across 13 agent-readability checks (llms.txt, schema.org JSON-LD, robots.txt AI-crawler posture, sitemap, agent card, machine-readable alternates, canonical, HTTPS). Free; returns which checks failed. The paid endpoint at /api/audit adds the reason and a paste-ready fix for each.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Absolute http(s) URL to grade.' } },
        required: ['url'],
      },
    },
    {
      name: 'search_x402_endpoints',
      title: 'Find a paid API you can call with x402',
      description: 'Search ~14,700 x402-payable HTTP endpoints — the machine-payable web, normalized from the Coinbase CDP Bazaar. Use this to find an API an agent can pay for per call (USDC on Base and other chains) and to see what it costs before calling it. Filter by chain, HTTP method, host or maximum price; results are ranked by relevance then cheapest first.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What the endpoint should do, e.g. "weather forecast" or "token price".' },
          chain: { type: 'string', description: 'Restrict to one chain, e.g. base, solana, polygon.' },
          method: { type: 'string', description: 'Restrict to an HTTP method, e.g. GET or POST.' },
          host: { type: 'string', description: 'Restrict to endpoints on a hostname (substring match).' },
          max_price: { type: 'number', description: 'Maximum price per call in USD. Endpoints priced in an unrecognised asset are excluded when this is set, because their price is unknown rather than zero.' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
        },
      },
    },
    {
      name: 'search_mcp_servers',
      title: 'Find an MCP server you can connect to right now',
      description: 'Search ~10,000 remotely-callable MCP servers from the official MCP registry — every one has a URL, so it can be added without installing anything. Filter by transport, host, or whether it needs credentials. Servers distributed only as installable packages are deliberately excluded: this answers "what can I call now", not "what exists".',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What the server should do, e.g. "github issues" or "browser automation".' },
          auth: { type: 'string', enum: ['none', 'required'], description: 'Restrict to servers that need no credentials, or that do.' },
          transport: { type: 'string', description: 'Restrict to a transport, e.g. streamable-http or sse.' },
          host: { type: 'string', description: 'Restrict to servers on a hostname (substring match).' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
        },
      },
    },
    {
      name: 'how_to_register',
      title: 'How to get listed',
      description: 'Returns the exact steps and schema for registering a product in the index — autonomous, free, no human approval.',
      inputSchema: { type: 'object', properties: {} },
    },
  ];
}

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const textContent = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

async function callMcpTool(name, args, { listings, base, scoreUrl, catalogSearch }) {
  if (name === 'search_products') {
    const { total, hits } = searchListings(listings, {
      q: args.query ?? '',
      category: args.category ?? '',
      tag: args.tag ?? '',
      limit: args.limit ?? DEFAULT_LIMIT,
    });
    return textContent({
      total,
      count: hits.length,
      results: hits.map(({ listing }) => publicFields(listing, base)),
    });
  }

  if (name === 'get_product') {
    const listing = listings.find((l) => l.slug === args.slug);
    if (!listing) {
      return { ...textContent({ ok: false, error: `no listing with slug "${args.slug}"`, hint: 'call search_products first' }), isError: true };
    }
    return textContent(listing);
  }

  if (name === 'score_url') {
    if (typeof args.url !== 'string') {
      return { ...textContent({ ok: false, error: 'url is required' }), isError: true };
    }
    // Reuses the live scorer rather than reimplementing it, so an MCP caller
    // and a browser caller can never disagree about a grade.
    const scored = await scoreUrl(args.url);
    return scored.ok === false ? { ...textContent(scored), isError: true } : textContent(scored);
  }

  const CATALOG_TOOLS = { search_x402_endpoints: 'x402', search_mcp_servers: 'mcp' };
  if (CATALOG_TOOLS[name]) {
    // Reuses the HTTP handler so the MCP tool and the URL cannot drift apart —
    // the same failure mode `score_url` avoids by proxying /api/score.
    const key = CATALOG_TOOLS[name];
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== null) params.set(k, String(v));
    const res = await catalogSearch(key, new URL(`${base}/api/${CATALOGS[key].path}/search?${params}`));
    return textContent(await res.json());
  }

  if (name === 'how_to_register') {
    return textContent({
      cost: 'free',
      human_approval: false,
      schema: `${base}/api/schema.json`,
      steps: [
        `Build a listing object conforming to ${base}/api/schema.json (required: slug, name, url, description, category, pricing).`,
        'Open a GitHub issue on 110kc3/seo titled "[register] <product name>" with the JSON as the body.',
        'A workflow validates it and comments within ~2 minutes: accepted returns your live URLs, rejected returns machine-readable errors.',
      ],
      issue_api: 'POST https://api.github.com/repos/110kc3/seo/issues',
      full_protocol: `${base}/llms.txt`,
    });
  }

  return null;
}

/** POST /mcp — JSON-RPC 2.0 over HTTP. */
export async function handleMcp(request, { listings, base, scoreUrl, catalogSearch }) {
  if (request.method === 'GET') {
    // The transport allows a GET that opens an SSE stream for server-initiated
    // messages. We have none, so say that plainly instead of holding a socket
    // open forever; 405 is the transport's prescribed answer.
    return json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'this server sends no unsolicited messages; POST JSON-RPC requests instead' },
    }, 405, { allow: 'POST' });
  }
  if (request.method !== 'POST') {
    return json(rpcError(null, -32600, 'POST a JSON-RPC 2.0 request'), 405, { allow: 'POST' });
  }

  let msg;
  try {
    msg = JSON.parse((await request.text()) || '');
  } catch (e) {
    return json(rpcError(null, -32700, `parse error: ${e.message.slice(0, 120)}`), 400);
  }

  // A batch is a JSON array. Answer each in order; a notification inside one
  // contributes no reply, exactly as for a lone notification.
  if (Array.isArray(msg)) {
    const replies = [];
    for (const one of msg) {
      const r = await dispatch(one, { listings, base, scoreUrl, catalogSearch });
      if (r) replies.push(r);
    }
    return replies.length ? json(replies) : new Response(null, { status: 202 });
  }

  const reply = await dispatch(msg, { listings, base, scoreUrl, catalogSearch });
  // A notification (no id) gets no body — the transport says 202.
  return reply ? json(reply) : new Response(null, { status: 202 });
}

async function dispatch(msg, ctx) {
  if (typeof msg !== 'object' || msg === null) return rpcError(null, -32600, 'invalid request');
  const { id = null, method, params = {} } = msg;
  const isNotification = msg.id === undefined;

  if (method === 'initialize') {
    return rpcResult(id, {
      // Echo the client's version when we can speak it, which is the transport's
      // negotiation rule; otherwise name ours and let the client decide.
      protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'ai-product-index', title: 'AI Product Index', version: '1.1.0' },
      instructions: `A directory of AI products that register themselves. Use search_products to find one, score_url to grade any site's agent-readability, how_to_register to add your own. Full protocol: ${ctx.base}/llms.txt`,
    });
  }

  if (method === 'notifications/initialized' || isNotification) return null;
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list') return rpcResult(id, { tools: mcpTools(ctx.base) });

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;
    try {
      const result = await callMcpTool(name, args ?? {}, ctx);
      if (result === null) return rpcError(id, -32602, `unknown tool: ${name}`);
      return rpcResult(id, result);
    } catch (e) {
      // A tool that throws is a tool result with isError, not a protocol error:
      // the model is supposed to see the failure and be able to react to it.
      return rpcResult(id, { ...textContent({ ok: false, error: e.message?.slice(0, 300) ?? 'tool failed' }), isError: true });
    }
  }

  // resources/prompts are not implemented, and saying so beats an empty list:
  // an empty list reads as "this server has no resources", which invites a
  // client to stop asking.
  return rpcError(id, -32601, `method not found: ${method}`);
}

// The catalog cache lives for the life of the isolate on purpose, which makes
// it shared state a test cannot escape by constructing a new request. Tests get
// an explicit reset rather than a re-import hack.
const resetCatalog = () => catalogPromises.clear();

export const __testing = { asSchemaOrg, publicFields, dispatch, resetCatalog, strength, MCP_PROTOCOL_VERSION, NLWEB_VERSION };


import x402Stats from '../api/x402/stats.json' with { type: 'json' };
import mcpStats from '../api/mcp/stats.json' with { type: 'json' };

const MAX_QUERY = 512;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const count = (value) => Number(value).toLocaleString('en-US');
const X402_ENDPOINTS = count(x402Stats.endpoints);
const MCP_ENDPOINTS = count(mcpStats.remote_endpoints);

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

  scored.sort((a, b) => b.score - a.score || String(a.listing.slug).localeCompare(String(b.listing.slug)));

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
    ...(hits.length === 0 && {
      corpus: { listings: listings.length, categories: [...new Set(listings.map((l) => l.category))].sort() },
      register: `${base}/llms.txt`,
    }),
  }, 200, { 'cache-control': 'public, max-age=300' });
}


export const CATALOGS = {
  x402: {
    path: 'x402',
    source: 'Coinbase CDP x402 Bazaar',
    unit: 'endpoints',
    filters: { chain: ['chain', 'eq'], method: ['method', 'eq'], host: ['host', 'includes'], max_price: ['price', 'lte'] },
    weights: { description: 6, url: 4, host: 2 },
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
      const path = CATALOGS[key].path;
      const get = (u) => (env?.ASSETS ? env.ASSETS.fetch(new Request(u)) : fetch(u));
      const resp = await get(`${base}/api/${path}/index.json`);
      if (!resp.ok) throw new Error(`catalog unavailable (HTTP ${resp.status})`);
      const body = await resp.json();

      let unreachable = new Set();
      let observations = new Map();
      let probed = null;
      try {
        const h = await get(`${base}/api/${path}/health.json`);
        if (h.ok) {
          const health = await h.json();
          probed = health.probed_at ?? null;
          observations = new Map((health.unreachable ?? []).map((e) => [e.url, e]));
          unreachable = new Set((health.unreachable ?? []).filter((e) => (e.misses ?? 0) >= 2).map((e) => e.url));
        }
      } catch { /* liveness is an enrichment, never a dependency */ }

      return { ...body, at: Object.fromEntries(body.fields.map((f, i) => [f, i])), unreachable, observations, probed };
    })().catch((e) => {
      catalogPromises.delete(key);
      throw e;
    });
    catalogPromises.set(key, promise);
  }
  return catalogPromises.get(key);
}

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

  const view = ([, row]) => {
    const out = Object.fromEntries(catalog.fields.map((f, i) => [f, row[i]]));
    if (catalog.unreachable?.has(out.url)) out.unreachable = true;
    const observation = catalog.observations?.get(out.url);
    out.health = observation ? {
      state: 'failed',
      last_checked: observation.last_checked ?? null,
      reason: observation.reason ?? null,
      misses: observation.misses ?? 1,
    } : { state: 'unknown' };
    return out;
  };
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
      ...(catalog.probed ? { liveness: `${base}/api/${spec.path}/health.json`, liveness_sampled: catalog.probed } : {}),
    },
  }, 200, { 'cache-control': 'public, max-age=600' });
}


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

export async function handleAsk(request, listings, base) {
  let text = '';
  let site = '';
  let mode = 'summarize';

  if (request.method === 'POST') {
    let body;
    try {
      body = JSON.parse((await request.text()) || '{}');
    } catch (e) {
      return json({ _meta: { response_type: 'failure', version: NLWEB_VERSION }, error: `invalid JSON: ${e.message.slice(0, 120)}` }, 400);
    }
    text = typeof body.query === 'string' ? body.query : (body.query?.text ?? body.text ?? '');
    site = body.query?.site ?? body.site ?? '';
    mode = body.prefer?.mode ?? mode;
  } else {
    const p = new URL(request.url).searchParams;
    text = p.get('query') ?? p.get('q') ?? '';
    site = p.get('site') ?? '';
    mode = p.get('mode') ?? mode;
  }

  if (typeof text !== 'string' || !text.trim()) {
    return json({
      _meta: { response_type: 'elicitation', version: NLWEB_VERSION },
      results: [],
      elicitation: 'What are you looking for? This corpus is a directory of AI products — try "MCP server", "free API", or a category.',
      corpus: { listings: listings.length, categories: [...new Set(listings.map((l) => l.category))].sort() },
    }, 200);
  }

  const host = new URL(base).host;
  if (site && site !== host && site !== base && site !== 'all') {
    return json({
      _meta: { response_type: 'failure', version: NLWEB_VERSION },
      results: [],
      error: `this endpoint serves one site (${host}); it cannot answer for "${site}"`,
    }, 400);
  }

  const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'do', 'does', 'you', 'have', 'any', 'for', 'me', 'i', 'want', 'need', 'looking', 'find', 'show', 'what', 'which', 'to', 'of', 'in', 'on', 'with', 'that', 'can', 'please', 'best', 'good', 'some', 'and', 'or']);
  const keywords = text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

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
        : `Nothing in the registry matches "${text}". The registry holds ${listings.length} self-registered AI products, and two larger catalogs are searchable separately: ${base}/api/x402/search for paid APIs an agent can call per request, and ${base}/api/mcp/search for remotely-callable MCP servers. Anything can be added to the registry autonomously via ${base}/llms.txt.`,
    }),
    ...(hits.length === 0 && { register: `${base}/llms.txt` }),
  }, 200, { 'cache-control': 'public, max-age=300' });
}


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
      description: 'Grade any public URL A–F across 20 weighted agent-readability checks, including llms.txt, schema.org JSON-LD, crawler policy, agent/MCP/API cards, Agent Skills, markdown negotiation, canonical and HTTPS. Free; returns which checks failed. The paid endpoint at /api/audit adds the reason and a paste-ready fix for each.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Absolute http(s) URL to grade.' } },
        required: ['url'],
      },
    },
    {
      name: 'search_x402_endpoints',
      title: 'Find a paid API you can call with x402',
      description: `Search ${X402_ENDPOINTS} x402-payable HTTP endpoints — the machine-payable web, normalized from the Coinbase CDP Bazaar. Use this to find an API an agent can pay for per call (USDC on Base and other chains) and to see what it costs before calling it. Filter by chain, HTTP method, host or maximum price; results are ranked by relevance then cheapest first.`,
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
      description: `Search ${MCP_ENDPOINTS} remotely-callable MCP servers from the official MCP registry — every one has a URL, so it can be added without installing anything. Filter by transport, host, or whether it needs credentials. Servers distributed only as installable packages are deliberately excluded: this answers "what can I call now", not "what exists".`,
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
    const scored = await scoreUrl(args.url);
    return scored.ok === false ? { ...textContent(scored), isError: true } : textContent(scored);
  }

  const CATALOG_TOOLS = { search_x402_endpoints: 'x402', search_mcp_servers: 'mcp' };
  if (CATALOG_TOOLS[name]) {
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

export async function handleMcp(request, { listings, base, scoreUrl, catalogSearch }) {
  if (request.method === 'GET') {
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

  if (Array.isArray(msg)) {
    const replies = [];
    for (const one of msg) {
      const r = await dispatch(one, { listings, base, scoreUrl, catalogSearch });
      if (r) replies.push(r);
    }
    return replies.length ? json(replies) : new Response(null, { status: 202 });
  }

  const reply = await dispatch(msg, { listings, base, scoreUrl, catalogSearch });
  return reply ? json(reply) : new Response(null, { status: 202 });
}

async function dispatch(msg, ctx) {
  if (typeof msg !== 'object' || msg === null) return rpcError(null, -32600, 'invalid request');
  const { id = null, method, params = {} } = msg;
  const isNotification = msg.id === undefined;

  if (method === 'initialize') {
    return rpcResult(id, {
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
      return rpcResult(id, { ...textContent({ ok: false, error: e.message?.slice(0, 300) ?? 'tool failed' }), isError: true });
    }
  }

  return rpcError(id, -32601, `method not found: ${method}`);
}

const resetCatalog = () => catalogPromises.clear();

export const __testing = { asSchemaOrg, publicFields, dispatch, resetCatalog, strength, MCP_PROTOCOL_VERSION, NLWEB_VERSION };

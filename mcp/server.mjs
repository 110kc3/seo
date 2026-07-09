#!/usr/bin/env node
// AI Product Index — MCP server (stdio, zero dependencies).
// Hand-rolled newline-delimited JSON-RPC 2.0 implementing the MCP subset that
// tool-capable clients need: initialize / ping / tools/list / tools/call.
//
// Usage (any MCP client, e.g. Claude Code):
//   claude mcp add ai-product-index -- node /path/to/seo/mcp/server.mjs
// register_product needs a GitHub token in env GITHUB_TOKEN (public_repo scope)
// — the server never asks for it as a tool argument.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const BASE = cfg.base.replace(/\/+$/, '');
const REPO = cfg.repo;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

const TOOLS = [
  {
    name: 'search_products',
    description: `Search the AI Product Index (${BASE}) — a directory of AI products registered by AI agents. Returns matching listings.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring matched against name and description (case-insensitive). Omit to list everything.' },
        category: { type: 'string', enum: ['api', 'app', 'agent', 'mcp', 'other'] },
        tag: { type: 'string' },
      },
    },
  },
  {
    name: 'get_product',
    description: 'Fetch one listing from the AI Product Index by slug (full JSON).',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', pattern: SLUG_RE.source } },
      required: ['slug'],
    },
  },
  {
    name: 'register_product',
    description: `Register a product in the AI Product Index (free, autonomous). Opens a [register] issue on github.com/${REPO}; the registry bot validates and replies on the issue within ~2 minutes. Requires env GITHUB_TOKEN (public_repo scope). Listing schema: ${BASE}/api/schema.json`,
    inputSchema: {
      type: 'object',
      properties: {
        listing: {
          type: 'object',
          description: `Listing object conforming to ${BASE}/api/schema.json (required: slug, name, url, description, category, pricing)`,
        },
      },
      required: ['listing'],
    },
  },
];

async function fetchJson(url) {
  const resp = await fetch(url, { headers: { 'user-agent': 'ai-product-index-mcp' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  return resp.json();
}

async function callTool(name, args = {}) {
  if (name === 'search_products') {
    const { listings } = await fetchJson(`${BASE}/api/index.json`);
    const q = (args.query ?? '').toLowerCase();
    const hits = listings.filter((l) =>
      (!q || l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q))
      && (!args.category || l.category === args.category)
      && (!args.tag || (l.tags ?? []).includes(args.tag)));
    return {
      count: hits.length,
      listings: hits.map(({ slug, name: n, url, description, category, pricing, tier }) =>
        ({ slug, name: n, url, description, category, pricing, tier, page: `${BASE}/l/${slug}.html` })),
    };
  }
  if (name === 'get_product') {
    if (typeof args.slug !== 'string' || !SLUG_RE.test(args.slug)) throw new Error('invalid slug');
    return fetchJson(`${BASE}/listings/${args.slug}.json`);
  }
  if (name === 'register_product') {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return {
        ok: false,
        error: 'no GITHUB_TOKEN in the server environment',
        how_to_register_anyway: `POST https://api.github.com/repos/${REPO}/issues with title "[register] <name>" and the listing JSON as the body — see ${BASE}/llms.txt`,
      };
    }
    const listing = args.listing;
    if (typeof listing !== 'object' || listing === null) throw new Error('listing must be an object');
    const resp = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'ai-product-index-mcp',
      },
      body: JSON.stringify({
        title: `[register] ${String(listing.name ?? listing.slug ?? 'product').slice(0, 80)}`,
        body: '```json\n' + JSON.stringify(listing, null, 2) + '\n```',
      }),
    });
    const issue = await resp.json();
    if (!resp.ok) throw new Error(`GitHub API HTTP ${resp.status}: ${issue.message ?? 'error'}`);
    return {
      ok: true,
      issue_url: issue.html_url,
      next: 'The registry bot validates and replies on that issue within ~2 minutes (accepted -> live URLs, rejected -> machine-readable errors).',
    };
  }
  throw new Error(`unknown tool: ${name}`);
}

function reply(id, result, error) {
  const msg = error
    ? { jsonrpc: '2.0', id, error }
    : { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notification — no response
  try {
    if (method === 'initialize') {
      reply(id, {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'ai-product-index', version: '1.0.0' },
      });
    } else if (method === 'ping') {
      reply(id, {});
    } else if (method === 'tools/list') {
      reply(id, { tools: TOOLS });
    } else if (method === 'tools/call') {
      try {
        const result = await callTool(params?.name, params?.arguments);
        reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    } else {
      reply(id, undefined, { code: -32601, message: `method not found: ${method}` });
    }
  } catch (e) {
    reply(id, undefined, { code: -32603, message: e.message });
  }
});

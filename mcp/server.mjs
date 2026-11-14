#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mcpTools } from '../worker/discovery.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const BASE = cfg.base.replace(/\/+$/, '');
const REPO = cfg.repo;
const UA = 'ai-product-index-mcp';

const REGISTER_TOOL = {
  name: 'register_product',
  title: 'Register a product in the index',
  description: `Register a product in the AI Product Index (free, autonomous, no human approval). Opens a [register] issue on github.com/${REPO}; the registry bot validates and replies on the issue within ~2 minutes. Requires env GITHUB_TOKEN (public_repo scope) on this server — never passed as a tool argument. Listing schema: ${BASE}/api/schema.json. Call how_to_register first if you want the steps without a token.`,
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
};

export const HOSTED_TOOLS = mcpTools(BASE);
export const TOOLS = [...HOSTED_TOOLS, REGISTER_TOOL];
const HOSTED_NAMES = new Set(HOSTED_TOOLS.map((t) => t.name));

const textResult = (value, isError = false) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

async function callHosted(name, args) {
  const resp = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${BASE}/mcp`);
  const body = await resp.json();
  if (body.error) throw new Error(body.error.message ?? 'upstream MCP error');
  if (!body.result) throw new Error('upstream MCP returned no result');
  return body.result;
}

async function registerProduct(args) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return textResult({
      ok: false,
      error: 'no GITHUB_TOKEN in the server environment',
      how_to_register_anyway: `POST https://api.github.com/repos/${REPO}/issues with title "[register] <name>" and the listing JSON as the body — see ${BASE}/llms.txt`,
    }, true);
  }
  const listing = args?.listing;
  if (typeof listing !== 'object' || listing === null || Array.isArray(listing)) {
    return textResult({ ok: false, error: 'listing must be an object' }, true);
  }
  const resp = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': UA,
    },
    body: JSON.stringify({
      title: `[register] ${String(listing.name ?? listing.slug ?? 'product').slice(0, 80)}`,
      body: '```json\n' + JSON.stringify(listing, null, 2) + '\n```',
    }),
  });
  const issue = await resp.json();
  if (!resp.ok) throw new Error(`GitHub API HTTP ${resp.status}: ${issue.message ?? 'error'}`);
  return textResult({
    ok: true,
    issue_url: issue.html_url,
    next: 'The registry bot validates and replies on that issue within ~2 minutes (accepted -> live URLs, rejected -> machine-readable errors).',
  });
}

export async function callTool(name, args = {}) {
  if (name === REGISTER_TOOL.name) return registerProduct(args);
  if (HOSTED_NAMES.has(name)) return callHosted(name, args);
  throw new Error(`unknown tool: ${name}`);
}

function reply(id, result, error) {
  const msg = error
    ? { jsonrpc: '2.0', id, error }
    : { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(msg) + '\n');
}

export async function handleMessage(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return;
  try {
    if (method === 'initialize') {
      reply(id, {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'ai-product-index', version: '2.0.0' },
      });
    } else if (method === 'ping') {
      reply(id, {});
    } else if (method === 'tools/list') {
      reply(id, { tools: TOOLS });
    } else if (method === 'tools/call') {
      try {
        reply(id, await callTool(params?.name, params?.arguments));
      } catch (e) {
        reply(id, textResult(`Error: ${e.message}`, true));
      }
    } else {
      reply(id, undefined, { code: -32601, message: `method not found: ${method}` });
    }
  } catch (e) {
    reply(id, undefined, { code: -32603, message: e.message });
  }
}

export function startStdio() {
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', async (line) => {
    line = line.trim();
    if (!line) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    await handleMessage(msg);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startStdio();

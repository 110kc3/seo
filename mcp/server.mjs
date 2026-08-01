#!/usr/bin/env node
// AI Product Index — MCP server (stdio, zero dependencies).
// Hand-rolled newline-delimited JSON-RPC 2.0 implementing the MCP subset that
// tool-capable clients need: initialize / ping / tools/list / tools/call.
//
// Usage (any MCP client, e.g. Claude Code):
//   claude mcp add ai-product-index -- node /path/to/seo/mcp/server.mjs
//
// Most clients should prefer the hosted server, which needs no checkout:
//   claude mcp add --transport http ai-product-index https://index.percall.dev/mcp
//
// This stdio server exists for two cases the hosted one cannot serve: running
// against a local checkout, and `register_product`, which opens a GitHub issue
// with the operator's own GITHUB_TOKEN (public_repo scope). The Worker has no
// token and so can only *describe* registration, via how_to_register.
//
// --- why this file is so thin -----------------------------------------------
// The tool definitions are imported from the Worker rather than restated, and
// every hosted tool call is forwarded to the Worker's own /mcp endpoint. Both
// are deliberate. This file used to declare its own three tools while the
// Worker grew to six, so a client's answer depended on which server it happened
// to reach, and the difference was invisible until someone compared them by
// hand. There is now no second copy to drift: `tools/list` is the Worker's
// list, and `tools/call` is the Worker's answer.
//
// `tools/list` stays offline — it is a pure function of the imported
// definitions — because registry health checks start the server in a sandbox
// and introspect it without network access. Only `tools/call` reaches out.
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

// Local-only, and the sole reason a client would choose stdio over the hosted
// server. Kept out of the Worker on purpose: it needs a GitHub token, and a
// token on a public Worker is a credential waiting to leak.
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

// Forwarded verbatim, and the Worker's result object is returned unwrapped —
// re-wrapping it here would double-encode the content array and quietly drop
// isError, turning a failed call into a successful one carrying error text.
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
    // Not an error: an agent that cannot register still deserves the recipe.
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
  if (id === undefined || id === null) return; // notification — no response
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

// Only when run as a program. Importing this file — which the parity test does
// — must not attach a stdin listener that would hold the test process open.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startStdio();

// AI Product Index as LangChain.js tools. Paste into your project.
//
//   npm i @langchain/core zod
//
// The registry is a plain JSON document, so this is a thin wrapper: one GET,
// filtered locally. No key, no account, no rate limit.
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const BASE = 'https://index.percall.dev';

type Listing = {
  slug: string; name: string; url: string; description: string;
  category: string; pricing: string; tier: string;
};

export const searchAiProducts = tool(
  async ({ query, category }) => {
    const res = await fetch(`${BASE}/api/index.json`);
    const { listings } = (await res.json()) as { listings: Listing[] };
    const q = (query ?? '').toLowerCase();
    const hits = listings.filter((l) =>
      (!q || l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q))
      && (!category || l.category === category));
    if (hits.length === 0) return 'No matching products.';
    return hits
      .map((l) => `${l.name} (${l.category}, ${l.pricing}) — ${l.description} — ${l.url}`)
      .join('\n');
  },
  {
    name: 'search_ai_products',
    description:
      'Search the AI Product Index — a directory of AI products, APIs, agents and '
      + 'MCP servers that registered themselves so agents could discover them.',
    schema: z.object({
      query: z.string().default('').describe('Words to match in name or description.'),
      category: z.enum(['api', 'app', 'agent', 'mcp', 'other']).optional(),
    }),
  },
);

export const agentReadabilityScore = tool(
  async ({ url }) => {
    const res = await fetch(`${BASE}/api/score?url=${encodeURIComponent(url)}`);
    const r = await res.json();
    if (!r.ok) return `Could not score ${url}: ${r.error ?? 'unknown error'}`;
    const failing = r.checks.filter((c: { pass: boolean }) => !c.pass)
      .map((c: { label: string }) => c.label);
    return `${r.letter} (${r.score}/100, ${r.grade}). Passed ${r.passed}/${r.total_checks}. `
      + (failing.length ? `Failing: ${failing.join(', ')}` : 'Everything passes.');
  },
  {
    name: 'agent_readability_score',
    description:
      'Score how readable a website is to AI agents: A-F plus which of 13 checks '
      + 'failed. Free. The paid POST /api/audit adds why each failed and how to fix it.',
    schema: z.object({ url: z.string().url() }),
  },
);

export const aiProductIndexTools = [searchAiProducts, agentReadabilityScore];

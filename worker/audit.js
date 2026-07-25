// Agent-readability audit — the paid endpoint.
//
// This is the Track A deliverable (llms.txt + schema.org JSON-LD + audit,
// previously done by hand) turned into something an agent can buy per call.
// Its value does not depend on how many listings the registry holds, which is
// why it — not the tier upgrade — is what sits behind the x402 gate.

import { urlError } from '../scripts/validate.mjs';

const MAX_HTML_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const UA = 'ai-product-index-auditor (+https://index.kc-it.pl/llms.txt)';

// Crawlers whose exclusion is the difference between "AI can read this" and
// "AI is locked out". Mirrors the allowlist this site publishes for itself.
const AI_CRAWLER_AGENTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User',
  'Claude-SearchBot', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'CCBot',
];

async function get(url, { as = 'text', maxBytes = MAX_HTML_BYTES } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'user-agent': UA, accept: '*/*' },
    });
    if (as === 'status') return { status: resp.status, ok: resp.ok, url: resp.url };
    const buf = await resp.arrayBuffer();
    const body = new TextDecoder().decode(buf.slice(0, maxBytes));
    return { status: resp.status, ok: resp.ok, url: resp.url, body, truncated: buf.byteLength > maxBytes };
  } catch (e) {
    return { status: 0, ok: false, url, error: e.name === 'AbortError' ? 'timeout' : (e.cause?.code ?? e.name) };
  } finally {
    clearTimeout(timer);
  }
}

// Streaming extraction of the head elements agents actually key off.
async function readHead(html, baseUrl) {
  const out = {
    title: '', description: '', canonical: '', jsonLd: [], alternates: [],
    og: { title: '', description: '', image: '' },
  };
  let inTitle = false;
  let inLd = false;
  let ldBuf = '';
  const rewriter = new HTMLRewriter()
    .on('title', {
      element() { inTitle = true; },
      text(t) { if (inTitle) out.title += t.text; },
    })
    .on('meta', {
      element(el) {
        const name = (el.getAttribute('name') ?? '').toLowerCase();
        const prop = (el.getAttribute('property') ?? '').toLowerCase();
        const content = el.getAttribute('content') ?? '';
        if (name === 'description') out.description = content;
        if (prop === 'og:title') out.og.title = content;
        if (prop === 'og:description') out.og.description = content;
        if (prop === 'og:image') out.og.image = content;
      },
    })
    .on('link', {
      element(el) {
        const rel = (el.getAttribute('rel') ?? '').toLowerCase();
        const href = el.getAttribute('href') ?? '';
        if (rel === 'canonical') out.canonical = href;
        if (rel.split(/\s+/).includes('alternate')) {
          out.alternates.push({ type: (el.getAttribute('type') ?? '').toLowerCase(), href });
        }
      },
    })
    .on('script', {
      element(el) {
        inLd = (el.getAttribute('type') ?? '').toLowerCase() === 'application/ld+json';
        if (inLd) ldBuf = '';
      },
      text(t) {
        if (!inLd) return;
        ldBuf += t.text;
        if (t.lastInTextNode) { out.jsonLd.push(ldBuf); inLd = false; }
      },
    });
  await rewriter.transform(new Response(html)).arrayBuffer();
  out.title = out.title.trim();
  if (out.canonical) {
    try { out.canonical = new URL(out.canonical, baseUrl).toString(); } catch { /* leave raw */ }
  }
  return out;
}

// robots.txt is line-oriented and group-scoped: a directive only applies to the
// user-agents named in the block directly above it.
function robotsBlocksAgent(robotsText, agent) {
  const lines = robotsText.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  let groupAgents = [];
  let collecting = false;
  let applies = false;
  let blocked = false;
  const target = agent.toLowerCase();
  for (const line of lines) {
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!collecting) { groupAgents = []; collecting = true; }
      groupAgents.push(value.toLowerCase());
      continue;
    }
    if (collecting) {
      collecting = false;
      applies = groupAgents.includes(target) || groupAgents.includes('*');
    }
    if (!applies) continue;
    // A specific block for this agent overrides the wildcard block.
    const specific = groupAgents.includes(target);
    if (key === 'disallow' && value === '/') blocked = true;
    else if (key === 'allow' && (value === '/' || value === '') && specific) blocked = false;
  }
  return blocked;
}

// llms.txt spec shape: an H1 title, then an optional blockquote summary.
function llmsTxtShape(text) {
  const lines = text.split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^#\s+\S/.test(l));
  const quote = lines.findIndex((l) => /^>\s*\S/.test(l));
  return { hasH1: h1 !== -1, hasSummary: quote !== -1 && (h1 === -1 || quote > h1) };
}

function parseJsonLd(blocks) {
  const parsed = [];
  const errors = [];
  for (const b of blocks) {
    try {
      const v = JSON.parse(b);
      for (const node of Array.isArray(v) ? v : [v]) {
        if (node && typeof node === 'object') parsed.push(node);
      }
    } catch (e) {
      errors.push(e.message.slice(0, 120));
    }
  }
  const schemaOrg = parsed.filter((n) => {
    const ctx = n['@context'];
    const ctxStr = typeof ctx === 'string' ? ctx : JSON.stringify(ctx ?? '');
    return ctxStr.includes('schema.org') && typeof n['@type'] === 'string';
  });
  return { parsed, schemaOrg, errors };
}

const check = (id, weight, pass, detail, fix) => ({ id, weight, pass: Boolean(pass), detail, ...(pass ? {} : { fix }) });

/**
 * Runs the audit. Assumes `target` already passed urlError().
 * Total weight is 100 so `score` reads directly as a percentage.
 */
export async function auditUrl(target) {
  const origin = new URL(target).origin;
  const at = (p) => new URL(p, origin).toString();

  const [home, llms, llmsFull, robots, sitemap, wellKnown, agentsJson] = await Promise.all([
    get(target),
    get(at('/llms.txt')),
    get(at('/llms-full.txt'), { maxBytes: 4096 }),
    get(at('/robots.txt'), { maxBytes: 64 * 1024 }),
    get(at('/sitemap.xml'), { maxBytes: 4096 }),
    get(at('/.well-known/agent.json'), { maxBytes: 32 * 1024 }),
    get(at('/agents.json'), { maxBytes: 32 * 1024 }),
  ]);

  if (!home.ok) {
    return {
      ok: false,
      code: 'target_unreachable',
      error: `could not fetch ${target}: ${home.error ?? `HTTP ${home.status}`}`,
    };
  }

  const head = await readHead(home.body, home.url ?? target);
  const ld = parseJsonLd(head.jsonLd);
  const llmsShape = llms.ok ? llmsTxtShape(llms.body) : { hasH1: false, hasSummary: false };
  const blockedAgents = robots.ok
    ? AI_CRAWLER_AGENTS.filter((a) => robotsBlocksAgent(robots.body, a))
    : [];
  const machineAlternates = head.alternates.filter((a) =>
    a.type.includes('json') || a.type.includes('markdown') || a.type.includes('plain'));
  const sitemapInRobots = robots.ok && /^\s*sitemap\s*:/im.test(robots.body);

  const checks = [
    check('llms_txt', 15, llms.ok && llmsShape.hasH1,
      llms.ok ? `/llms.txt returned HTTP ${llms.status}${llmsShape.hasH1 ? '' : ' but has no H1 title line'}` : `/llms.txt not found (HTTP ${llms.status || home.error})`,
      'Publish /llms.txt: an H1 with the site name, a > blockquote summary, then linked sections of the pages agents should read.'),
    check('llms_txt_summary', 5, llms.ok && llmsShape.hasSummary,
      llmsShape.hasSummary ? '/llms.txt has a blockquote summary' : '/llms.txt has no "> summary" line',
      'Add a one-paragraph "> " blockquote directly under the H1 — it is what agents quote when describing you.'),
    check('llms_full_txt', 5, llmsFull.ok,
      llmsFull.ok ? '/llms-full.txt is available' : '/llms-full.txt not found',
      'Publish /llms-full.txt with your full content inlined, so an agent can load everything in one fetch.'),
    check('robots_txt', 5, robots.ok,
      robots.ok ? `/robots.txt returned HTTP ${robots.status}` : '/robots.txt not found',
      'Publish /robots.txt — its absence is ambiguous, and some crawlers treat ambiguity as disallow.'),
    check('ai_crawlers_allowed', 10, robots.ok && blockedAgents.length === 0,
      blockedAgents.length ? `robots.txt blocks: ${blockedAgents.join(', ')}` : 'no AI crawler is blocked by robots.txt',
      'Remove the Disallow: / rules for the AI user-agents you want to be cited by, or name them with Allow: /.'),
    check('sitemap', 8, sitemap.ok || sitemapInRobots,
      sitemap.ok ? '/sitemap.xml is available' : (sitemapInRobots ? 'sitemap declared in robots.txt' : 'no sitemap found'),
      'Publish /sitemap.xml and reference it from robots.txt with a Sitemap: line.'),
    check('json_ld', 15, ld.schemaOrg.length > 0,
      ld.schemaOrg.length
        ? `${ld.schemaOrg.length} schema.org JSON-LD node(s): ${ld.schemaOrg.map((n) => n['@type']).join(', ')}`
        : (ld.errors.length ? `JSON-LD present but failed to parse: ${ld.errors[0]}` : 'no schema.org JSON-LD found'),
      'Add a <script type="application/ld+json"> block with @context https://schema.org and a concrete @type (Organization, SoftwareApplication, Product...).'),
    check('title_and_description', 7, head.title.length > 0 && head.description.length > 0,
      `title: ${head.title ? `"${head.title.slice(0, 60)}"` : 'missing'} · meta description: ${head.description ? 'present' : 'missing'}`,
      'Give every page a <title> and a <meta name="description"> — they are the cheapest signal an extractor has.'),
    check('open_graph', 7, Boolean(head.og.title && head.og.description && head.og.image),
      `og:title ${head.og.title ? 'yes' : 'no'} · og:description ${head.og.description ? 'yes' : 'no'} · og:image ${head.og.image ? 'yes' : 'no'}`,
      'Add og:title, og:description and og:image — agents reuse them when they surface you in a card.'),
    check('canonical', 5, Boolean(head.canonical),
      head.canonical ? `canonical: ${head.canonical}` : 'no rel=canonical link',
      'Add <link rel="canonical"> so duplicate URLs collapse to one citable address.'),
    check('machine_alternates', 8, machineAlternates.length > 0,
      machineAlternates.length
        ? `${machineAlternates.length} machine-readable alternate(s): ${machineAlternates.map((a) => a.type || 'untyped').join(', ')}`
        : 'no rel=alternate link to a JSON or Markdown representation',
      'Add <link rel="alternate" type="application/json"> (and text/markdown) pointing at machine-readable versions of the page.'),
    check('agent_card', 10, wellKnown.ok || agentsJson.ok,
      wellKnown.ok ? '/.well-known/agent.json is available'
        : (agentsJson.ok ? '/agents.json is available' : 'no agent card at /.well-known/agent.json or /agents.json'),
      'Publish an agent card at /.well-known/agent.json describing your callable interfaces (A2A) — this is what turns a page into a tool.'),
    check('https', 5, new URL(home.url ?? target).protocol === 'https:',
      `served over ${new URL(home.url ?? target).protocol.replace(':', '')}`,
      'Serve over HTTPS; several crawlers will not follow an http:// origin at all.'),
  ];

  const score = checks.reduce((sum, c) => sum + (c.pass ? c.weight : 0), 0);
  const grade = score >= 80 ? 'agent-ready' : score >= 55 ? 'partially readable' : score >= 30 ? 'weak' : 'invisible to agents';

  return {
    ok: true,
    url: home.url ?? target,
    audited_at: new Date().toISOString(),
    score,
    max_score: 100,
    grade,
    passed: checks.filter((c) => c.pass).length,
    total_checks: checks.length,
    checks,
    next_steps: checks.filter((c) => !c.pass).sort((a, b) => b.weight - a.weight).map((c) => c.fix),
  };
}

/** Validates the request body and returns { url } or { error }. */
export function parseAuditRequest(obj) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { error: 'body must be a JSON object like {"url": "https://example.com"}' };
  }
  // Same boundary the registry uses for submitted listing URLs: http/https
  // only, public hostnames only, no private or loopback literals.
  const err = urlError(obj.url, 'url');
  if (err) return { error: err };
  return { url: obj.url };
}

export const __testing = { robotsBlocksAgent, llmsTxtShape, parseJsonLd, AI_CRAWLER_AGENTS };

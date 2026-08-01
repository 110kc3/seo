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

async function get(url, { as = 'text', maxBytes = MAX_HTML_BYTES, fetchImpl = fetch, signHeaders = null, accept = '*/*' } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    // web-bot-auth: a site we audit can verify this fetch cryptographically
    // instead of trusting a user-agent string anyone can copy.
    const signed = signHeaders ? await signHeaders('GET', url) : {};
    const resp = await fetchImpl(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'user-agent': UA, accept, ...signed },
    });
    // `type` is needed to tell content negotiation from a site that ignores
    // Accept and hands back the same HTML whatever you ask for.
    const type = resp.headers?.get?.('content-type') ?? null;
    if (as === 'status') return { status: resp.status, ok: resp.ok, url: resp.url, type };
    const buf = await resp.arrayBuffer();
    const body = new TextDecoder().decode(buf.slice(0, maxBytes));
    return { status: resp.status, ok: resp.ok, url: resp.url, type, body, truncated: buf.byteLength > maxBytes };
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

const isSchemaOrgContext = (ctx) =>
  (typeof ctx === 'string' ? ctx : JSON.stringify(ctx ?? '')).includes('schema.org');

// `@type` is a string for one type and an array for a node that is several at
// once (`["Organization","LocalBusiness"]` is ordinary in local-business markup).
const hasType = (n) =>
  typeof n['@type'] === 'string' ||
  (Array.isArray(n['@type']) && n['@type'].some((t) => typeof t === 'string' && t));

/**
 * Flattens one parsed block into the typed nodes it actually asserts.
 *
 * The `@graph` container is the shape a page uses to declare several entities in
 * one block — it carries the `@context` itself and leaves `@type` to its members,
 * so matching on a top-level `@type` scores a correctly-marked-up page as having
 * no structured data at all. Yoast emits this for every page it touches and
 * schema.org's own multi-entity examples use it, so it is not an edge case.
 *
 * Members inherit the container's `@context`, which is where it is defined for
 * them; a member carrying its own `@context` keeps it.
 */
function expandGraph(node) {
  if (!Array.isArray(node['@graph'])) return [node];
  const members = node['@graph']
    .filter((m) => m && typeof m === 'object')
    .map((m) => (m['@context'] === undefined && node['@context'] !== undefined
      ? { ...m, '@context': node['@context'] }
      : m));
  // Keep the container too when it is itself a typed node, so a
  // `{"@type":"WebPage","@graph":[…]}` is not silently dropped.
  return hasType(node) ? [node, ...members] : members;
}

export function parseJsonLd(blocks) {
  const parsed = [];
  const errors = [];
  for (const b of blocks) {
    try {
      const v = JSON.parse(b);
      for (const node of Array.isArray(v) ? v : [v]) {
        if (node && typeof node === 'object') parsed.push(...expandGraph(node));
      }
    } catch (e) {
      errors.push(e.message.slice(0, 120));
    }
  }
  const schemaOrg = parsed.filter((n) => isSchemaOrgContext(n['@context']) && hasType(n));
  return { parsed, schemaOrg, errors };
}

const check = (id, weight, pass, detail, fix) => ({ id, weight, pass: Boolean(pass), detail, ...(pass ? {} : { fix }) });

/**
 * The 2026 signals, reported and deliberately NOT scored.
 *
 * The scored checklist is thirteen items and the standard has grown past it —
 * Cloudflare's agent-readiness score now reads Content Signals, an API catalog,
 * an Agent Skills index, an MCP server card and Web Bot Auth. Detecting those is
 * straightforward. *Scoring* them is not, and the reason is other people:
 * grades are stamped into `scores.json`, rendered as badges inside other
 * people's READMEs, and quoted in our own fleet numbers. Adding weighted checks
 * would move every one of those overnight — a site that changed nothing would
 * wake up a letter lower and be told it had got worse.
 *
 * So these arrive as `signals` beside `checks`: the audit reports what it found,
 * `scoreChecks` never sees them, and no existing grade moves by a point.
 * Promoting them into the score is a separate, deliberate decision that needs a
 * versioned check set and a fleet re-score first — see docs/agent-readiness-2026.md.
 *
 * Adoption of most of these is tiny today, so a site missing them is normal
 * rather than negligent. `detail` says so; none of this is phrased as a failure.
 */
const signal = (id, label, present, detail, fix) => ({ id, label, present: Boolean(present), detail, ...(present ? {} : { fix }) });

/** Does robots.txt carry a Content-Signal declaration (contentsignals.org)? */
export function contentSignalsIn(robotsBody) {
  if (typeof robotsBody !== 'string') return null;
  const line = robotsBody.split(/\r?\n/).find((l) => /^\s*content-signal\s*:/i.test(l));
  if (!line) return null;
  return line.split(':').slice(1).join(':').trim();
}

// Human labels, so the free score can name what failed without shipping the
// paid `detail`/`fix`/`snippet` fields. Keyed by check id; a missing id falls
// back to the id itself rather than throwing.
export const CHECK_LABELS = {
  llms_txt: 'llms.txt published',
  llms_txt_summary: 'llms.txt has a title and summary',
  llms_full_txt: 'llms-full.txt published',
  robots_txt: 'robots.txt published',
  ai_crawlers_allowed: 'AI crawlers not blocked',
  sitemap: 'sitemap.xml published',
  json_ld: 'schema.org JSON-LD on the page',
  title_and_description: 'title and meta description',
  open_graph: 'Open Graph tags',
  canonical: 'canonical URL declared',
  machine_alternates: 'machine-readable alternates advertised',
  agent_card: 'agent card at /.well-known/agent-card.json',
  https: 'served over HTTPS',
};

/**
 * A–F band for the score. The descriptive `grade` stays as it was; this is the
 * one-glance version the free teaser leads with.
 */
export function letterGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  if (score >= 45) return 'E';
  return 'F';
}

// The paid deliverable: paste-ready code for each failure, not just advice.
// `{{ORIGIN}}` is replaced with the audited site's origin so the output is
// specific to the caller's domain rather than a generic example.
const SNIPPETS = {
  llms_txt: `# /llms.txt  — publish at {{ORIGIN}}/llms.txt

# Your Product Name

> One sentence on what this is and who it is for.

## Docs
- [Getting started]({{ORIGIN}}/docs/start): what it says on the tin.
- [API reference]({{ORIGIN}}/docs/api): endpoints, auth, limits.

## Contact
- [Email](mailto:you@example.com)`,

  llms_txt_summary: `# /llms.txt must open with an H1 and a blockquote summary:

# Your Product Name

> One sentence on what this is and who it is for.

# ...then your linked sections. Agents read the blockquote first.`,

  llms_full_txt: `# /llms-full.txt — the same content as llms.txt but expanded:
# full prose for each section instead of links, so an agent can answer
# questions without fetching every page. Concatenate your key docs.`,

  robots_txt: `# /robots.txt
User-agent: *
Allow: /

Sitemap: {{ORIGIN}}/sitemap.xml`,

  ai_crawlers_allowed: `# /robots.txt — allow the AI crawlers explicitly. A bare
# "User-agent: * / Disallow: /" hides you from every assistant.
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /`,

  sitemap: `<?xml version="1.0" encoding="UTF-8"?>
<!-- /sitemap.xml -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{{ORIGIN}}/</loc></url>
  <!-- one <url><loc> per page you want read -->
</urlset>`,

  json_ld: `<!-- in <head> -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Your Product Name",
  "url": "{{ORIGIN}}/",
  "description": "One sentence on what it does.",
  "applicationCategory": "BusinessApplication",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
}
</script>`,

  title_and_description: `<!-- in <head> -->
<title>Your Product — what it does in five words</title>
<meta name="description" content="One sentence, under 160 characters, that answers what this is and who it is for.">`,

  open_graph: `<!-- in <head> -->
<meta property="og:type" content="website">
<meta property="og:title" content="Your Product — what it does">
<meta property="og:description" content="One sentence on what this is.">
<meta property="og:url" content="{{ORIGIN}}/">
<meta property="og:image" content="{{ORIGIN}}/og.png">`,

  canonical: `<!-- in <head>. Must be the URL that actually serves 200, not a redirect. -->
<link rel="canonical" href="{{ORIGIN}}/">`,

  machine_alternates: `<!-- in <head>: point agents at the machine-readable twin of each page -->
<link rel="alternate" type="text/markdown" href="{{ORIGIN}}/llms.txt" title="llms.txt">
<link rel="alternate" type="application/json" href="{{ORIGIN}}/api/index.json" title="JSON API">

<!-- ...and/or as a response header, which agents see without parsing HTML: -->
Link: <{{ORIGIN}}/llms.txt>; rel="alternate"; type="text/markdown"`,

  agent_card: `{
  "_comment": "publish at {{ORIGIN}}/.well-known/agent-card.json (A2A 1.0), and at {{ORIGIN}}/.well-known/agent.json for pre-0.3 clients",
  "name": "Your Product",
  "description": "One sentence on what it does.",
  "url": "{{ORIGIN}}/",
  "provider": { "organization": "Your Company", "url": "{{ORIGIN}}/" },
  "version": "1.0.0",
  "capabilities": { "streaming": false },
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["application/json"],
  "skills": [{
    "id": "example",
    "name": "Example skill",
    "description": "What an agent can ask this service to do.",
    "tags": ["example"]
  }]
}`,
};

/** Paste-ready fix for a failing check, specific to the audited origin. */
export function snippetFor(id, origin) {
  const template = SNIPPETS[id];
  return template ? template.replaceAll('{{ORIGIN}}', origin.replace(/\/+$/, '')) : null;
}

/**
 * Percentage of the achievable weight, plus the band it falls in. Pure and
 * exported so the "a perfect site scores exactly 100" invariant is testable —
 * `auditUrl` itself needs HTMLRewriter and so cannot run under `node --test`.
 */
export function scoreChecks(checks) {
  // A weightless entry contributes nothing instead of poisoning the total.
  // Without this, one item with no `weight` makes the sum NaN, NaN is falsy, and
  // the function returns 0 — so a flawless site would be graded "invisible to
  // agents" because something weightless got into the array. The 2026 signals
  // are deliberately weightless and live in their own list, but the arithmetic
  // should not depend on nobody ever mixing the two.
  const weightOf = (c) => (Number.isFinite(c.weight) ? c.weight : 0);
  const totalWeight = checks.reduce((sum, c) => sum + weightOf(c), 0);
  const earned = checks.reduce((sum, c) => sum + (c.pass ? weightOf(c) : 0), 0);
  const score = totalWeight ? Math.round((earned / totalWeight) * 100) : 0;
  const grade = score >= 80 ? 'agent-ready'
    : score >= 55 ? 'partially readable'
      : score >= 30 ? 'weak' : 'invisible to agents';
  return { score, grade };
}

/**
 * Runs the audit. Assumes `target` already passed urlError().
 *
 * `score` is normalised to a percentage of the total weight rather than assuming
 * the weights happen to add up to 100 — they summed to 105, so a fully agent-ready
 * site was reported as `score: 105` against `max_score: 100`. Deriving the
 * denominator keeps every weight as the relative importance it was chosen to be,
 * and makes adding or reweighting a check impossible to get wrong.
 */
/**
 * @param {string} target        already through urlError()
 * @param {Function} [fetchImpl] fetcher for the target's own origin. Defaults to
 *   the global fetch; callers pass the ASSETS binding when the target *is* this
 *   deployment, because a Worker cannot fetch its own hostname — Cloudflare
 *   answers 522 on both the custom domain and the workers.dev one, so auditing
 *   our own site (the showcase, and the first thing anyone types) failed
 *   outright. No check reads a response header, so serving those sub-requests
 *   from the asset binding scores identically.
 */
export async function auditUrl(target, fetchImpl = fetch, signHeaders = null) {
  const origin = new URL(target).origin;
  const at = (p) => new URL(p, origin).toString();
  const one = (url, opts = {}) => get(url, { ...opts, fetchImpl, signHeaders });

  const [home, llms, llmsFull, robots, sitemap, agentCard, wellKnown, agentsJson,
    apiCatalog, mcpCard, mcpServerCard, agentSkills, botAuthDir, markdownAlt] = await Promise.all([
    one(target),
    one(at('/llms.txt')),
    one(at('/llms-full.txt'), { maxBytes: 4096 }),
    one(at('/robots.txt'), { maxBytes: 64 * 1024 }),
    one(at('/sitemap.xml'), { maxBytes: 4096 }),
    // Both A2A card paths. agent-card.json is where the 1.0 spec puts it;
    // agent.json is the pre-0.3 path most published cards still use. A site
    // passing on either is reachable by some real client, so both are fetched
    // and the advice below names the current one.
    one(at('/.well-known/agent-card.json'), { maxBytes: 32 * 1024 }),
    one(at('/.well-known/agent.json'), { maxBytes: 32 * 1024 }),
    one(at('/agents.json'), { maxBytes: 32 * 1024 }),
    // The 2026 surfaces. Reported as signals, never scored — see signal() above.
    // Small ceilings: these are all manifests, and a site that answers a
    // multi-megabyte body at one of these paths has not implemented the spec.
    one(at('/.well-known/api-catalog'), { maxBytes: 32 * 1024 }),
    one(at('/.well-known/mcp.json'), { maxBytes: 32 * 1024 }),
    one(at('/.well-known/mcp/server-card.json'), { maxBytes: 32 * 1024 }),
    one(at('/.well-known/agent-skills/index.json'), { maxBytes: 32 * 1024 }),
    one(at('/.well-known/http-message-signatures-directory'), { maxBytes: 32 * 1024 }),
    // The same page asked for as markdown. Cheap for us, and the only way to
    // tell a site that negotiates from one that ignores Accept — a status code
    // proves nothing here, since ignoring the header also returns 200.
    one(target, { accept: 'text/markdown', maxBytes: 1024 }),
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
        ? `${ld.schemaOrg.length} schema.org JSON-LD node(s): ${ld.schemaOrg.flatMap((n) => n['@type']).join(', ')}`
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
    // Passing on the old path still counts — a card at agent.json is reachable
    // by every client written before A2A 0.3, which is most of them. But the
    // evidence says which path answered, and a site on the old one is told so,
    // because "you pass" while a spec-compliant 1.0 client cannot find you is
    // exactly the kind of advice that is worse than none.
    check('agent_card', 10, agentCard.ok || wellKnown.ok || agentsJson.ok,
      agentCard.ok ? '/.well-known/agent-card.json is available'
        : (wellKnown.ok ? '/.well-known/agent.json is available — the pre-0.3 path; A2A 1.0 clients look at /.well-known/agent-card.json'
          : (agentsJson.ok ? '/agents.json is available' : 'no agent card at /.well-known/agent-card.json, /.well-known/agent.json or /agents.json')),
      'Publish an agent card at /.well-known/agent-card.json describing your callable interfaces (A2A 1.0) — this is what turns a page into a tool. Serve the same document at /.well-known/agent.json too, for clients written before the path moved.'),
    check('https', 5, new URL(home.url ?? target).protocol === 'https:',
      `served over ${new URL(home.url ?? target).protocol.replace(':', '')}`,
      'Serve over HTTPS; several crawlers will not follow an http:// origin at all.'),
  ];

  const declaredSignals = contentSignalsIn(robots.ok ? robots.body : null);
  const signals = [
    signal('content_signals', 'Content Signals declared in robots.txt', declaredSignals !== null,
      declaredSignals !== null ? `robots.txt declares Content-Signal: ${declaredSignals}` : 'robots.txt carries no Content-Signal line',
      'Add a Content-Signal line to robots.txt (contentsignals.org) stating how your content may be used: search, ai-input, ai-train. Roughly 4% of sites declare it, so it is a differentiator rather than a baseline — and pick the values deliberately, because the common default (ai-train=no) suits a publisher protecting an archive and not everyone is one.'),
    signal('agent_card_current_path', 'A2A card at the 1.0 path', agentCard.ok,
      agentCard.ok ? '/.well-known/agent-card.json is available'
        : (wellKnown.ok ? 'a card exists at the pre-0.3 /.well-known/agent.json, but not at the 1.0 path' : 'no card at /.well-known/agent-card.json'),
      'A2A 1.0 reads /.well-known/agent-card.json; /.well-known/agent.json is the pre-0.3 path a 1.0 client never looks at. Serve the same document at both while the installed base catches up.'),
    signal('mcp_server_card', 'MCP server card published', mcpCard.ok || mcpServerCard.ok,
      mcpCard.ok || mcpServerCard.ok
        ? `MCP server card at ${mcpCard.ok ? '/.well-known/mcp.json' : ''}${mcpCard.ok && mcpServerCard.ok ? ' and ' : ''}${mcpServerCard.ok ? '/.well-known/mcp/server-card.json' : ''}`
        : 'no MCP server card at /.well-known/mcp.json or /.well-known/mcp/server-card.json',
      'If you run an MCP server, publish a server card so clients can find it without being handed a URL. The specs disagree on the path — SEP-2127 says /.well-known/mcp.json, Cloudflare reads /.well-known/mcp/server-card.json — so serve both.'),
    signal('api_catalog', 'API catalog (RFC 9727)', apiCatalog.ok,
      apiCatalog.ok ? '/.well-known/api-catalog is available' : 'no /.well-known/api-catalog',
      'Publish an RFC 9727 API catalog at /.well-known/api-catalog: a linkset pointing at your OpenAPI description and endpoints, served as application/linkset+json. It states nothing new if you already publish OpenAPI — it states it where a machine is specified to look.'),
    signal('agent_skills', 'Agent Skills index', agentSkills.ok,
      agentSkills.ok ? '/.well-known/agent-skills/index.json is available' : 'no /.well-known/agent-skills/index.json',
      'Publish an Agent Skills index at /.well-known/agent-skills/index.json describing what an agent can accomplish here, so it need not read your docs to find out.'),
    signal('markdown_negotiation', 'Serves markdown to callers that ask for it',
      markdownAlt.ok && /markdown/i.test(markdownAlt.type ?? ''),
      markdownAlt.ok && /markdown/i.test(markdownAlt.type ?? '')
        ? `Accept: text/markdown returns ${markdownAlt.type}`
        : `Accept: text/markdown returns ${markdownAlt.type ?? 'no content-type'} — the Accept header is ignored`,
      'Answer Accept: text/markdown with a markdown twin of the page. An agent parsing your HTML is guessing at which parts are content; markdown removes the guess, and it costs one content-negotiation branch.'),
    signal('web_bot_auth', 'Web Bot Auth key directory', botAuthDir.ok,
      botAuthDir.ok ? '/.well-known/http-message-signatures-directory is available' : 'no /.well-known/http-message-signatures-directory',
      'Publish Ed25519 keys at /.well-known/http-message-signatures-directory (RFC 9421 web-bot-auth) so callers can verify your responses, and so you can tell a signed agent from an anonymous scraper.'),
  ];

  const { score, grade } = scoreChecks(checks);
  const failing = checks.filter((c) => !c.pass).sort((a, b) => b.weight - a.weight);

  return {
    ok: true,
    url: home.url ?? target,
    audited_at: new Date().toISOString(),
    score,
    max_score: 100,
    letter: letterGrade(score),
    grade,
    passed: checks.filter((c) => c.pass).length,
    total_checks: checks.length,
    checks: checks.map((c) => ({
      ...c,
      label: CHECK_LABELS[c.id] ?? c.id,
      // The paid half: paste-ready code for this specific origin, not advice.
      ...(c.pass ? {} : { snippet: snippetFor(c.id, origin) }),
    })),
    next_steps: failing.map((c) => ({
      check: c.id,
      label: CHECK_LABELS[c.id] ?? c.id,
      weight: c.weight,
      fix: c.fix,
      snippet: snippetFor(c.id, origin),
    })),
    // Reported, never scored. `score` above is a function of `checks` alone, so
    // adding to this list can never move anyone's grade or badge.
    signals: {
      $comment: 'Emerging 2026 agent-readiness surfaces. Detected and reported, deliberately not scored: grades here are stamped into badges on other people\'s sites, and a site that changed nothing should never wake up graded lower. Adoption of most of these is still tiny, so absence is normal rather than negligent.',
      detected: signals.filter((s) => s.present).length,
      total: signals.length,
      items: signals,
    },
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

export const __testing = { robotsBlocksAgent, llmsTxtShape, parseJsonLd, AI_CRAWLER_AGENTS, scoreChecks, signal };

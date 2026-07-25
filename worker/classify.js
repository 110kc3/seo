// Classifies the caller of a request so the index can answer the question
// GitHub Pages made unanswerable: has any agent ever actually used this?
//
// Deliberately coarse. A user-agent string is self-reported and trivially
// spoofed, so these buckets are a traffic-shape signal, not an identity claim.

// Crawlers that fetch pages to build training corpora or answer engines.
const AI_CRAWLERS = [
  'gptbot', 'oai-searchbot', 'chatgpt-user',
  'claudebot', 'claude-user', 'claude-searchbot', 'anthropic-ai',
  'perplexitybot', 'perplexity-user',
  'google-extended', 'googleother', 'gemini-deep-research',
  'ccbot', 'meta-externalagent', 'meta-externalfetcher',
  'bytespider', 'applebot-extended', 'amazonbot', 'cohere-ai',
  'diffbot', 'imagesiftbot', 'omgili', 'youbot', 'timpibot',
  'duckassistbot', 'mistralai-user', 'ai2bot', 'firecrawl',
];

// Callers that act rather than crawl — the traffic class the article says
// grew 7,851% YoY, and the one this index is actually built for.
const AI_AGENTS = [
  'langchain', 'llamaindex', 'llama-index', 'openai-python', 'openai-node',
  'anthropic-sdk', 'anthropic-python', 'anthropic-ai-sdk', 'claude-code',
  'mcp-client', 'modelcontextprotocol', 'autogpt', 'crewai', 'browser-use',
  'agentkit', 'x402', 'operator', 'computer-use', 'smithery', 'glama',
];

// Our own tooling — separated so dogfooding never inflates the agent numbers.
const OWN = ['ai-product-index-mcp', 'ai-product-index-registry'];

// Conventional search/social crawlers. Not AI traffic, but not humans either.
const CLASSIC_BOTS = [
  'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider', 'yandexbot',
  'facebookexternalhit', 'twitterbot', 'linkedinbot', 'slackbot',
  'discordbot', 'telegrambot', 'whatsapp', 'pingdom', 'uptimerobot',
];

// Generic HTTP clients. Could be an agent, could be a shell script — the
// honest label is "script", not "agent".
const SCRIPTS = [
  'curl/', 'wget/', 'python-requests', 'httpx/', 'aiohttp', 'node-fetch',
  'undici', 'axios/', 'go-http-client', 'okhttp', 'java/', 'ruby', 'php/',
  'postmanruntime', 'insomnia',
];

const hit = (ua, list) => list.some((needle) => ua.includes(needle));

/**
 * @returns {'own'|'ai_agent'|'ai_crawler'|'classic_bot'|'browser'|'script'|'unknown'|'other'}
 */
export function classifyUserAgent(userAgent) {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua) return 'unknown';
  if (hit(ua, OWN)) return 'own';
  // Agents before crawlers: several agent stacks embed a vendor token that
  // also appears in the crawler list (e.g. anthropic-ai inside an SDK UA).
  if (hit(ua, AI_AGENTS)) return 'ai_agent';
  if (hit(ua, AI_CRAWLERS)) return 'ai_crawler';
  if (hit(ua, CLASSIC_BOTS)) return 'classic_bot';
  if (hit(ua, SCRIPTS)) return 'script';
  // Real browsers always carry a rendering-engine token alongside Mozilla/5.0.
  if (ua.startsWith('mozilla/') && /(chrome|safari|firefox|gecko|edg)\//.test(ua)) return 'browser';
  return 'other';
}

/** Buckets a path into a small stable set so stats stay readable as listings grow. */
export function classifyPath(pathname) {
  if (pathname === '/' || pathname === '/index.html') return 'home';
  if (pathname === '/llms.txt' || pathname === '/llms-full.txt') return 'llms_txt';
  if (pathname === '/robots.txt') return 'robots';
  if (pathname === '/sitemap.xml') return 'sitemap';
  if (pathname === '/openapi.yaml') return 'openapi';
  if (pathname === '/api/audit') return 'audit';
  // Separate bucket from 'audit' on purpose: free-score vs paid-audit counts are
  // the conversion rate of the funnel.
  if (pathname === '/api/score') return 'score_free';
  if (pathname === '/api/stats.json') return 'stats';
  if (pathname === '/api/x402/info') return 'x402_info';
  if (pathname === '/api/revenue.json') return 'revenue';
  if (pathname === '/dashboard.html' || pathname === '/dashboard') return 'dashboard';
  if (pathname.startsWith('/api/')) return 'api';
  if (pathname.startsWith('/listings/')) return 'listing_json';
  if (pathname.startsWith('/l/')) return 'listing_page';
  if (pathname.startsWith('/assets/')) return 'asset';
  return 'other';
}

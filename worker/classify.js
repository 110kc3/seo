
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

const AI_AGENTS = [
  'langchain', 'llamaindex', 'llama-index', 'openai-python', 'openai-node',
  'anthropic-sdk', 'anthropic-python', 'anthropic-ai-sdk', 'claude-code',
  'mcp-client', 'modelcontextprotocol', 'autogpt', 'crewai', 'browser-use',
  'agentkit', 'x402', 'operator', 'computer-use', 'smithery', 'glama',
];

const OWN = ['ai-product-index-mcp', 'ai-product-index-registry'];

const CLASSIC_BOTS = [
  'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider', 'yandexbot',
  'facebookexternalhit', 'twitterbot', 'linkedinbot', 'slackbot',
  'discordbot', 'telegrambot', 'whatsapp', 'pingdom', 'uptimerobot',
];

const SCRIPTS = [
  'curl/', 'wget/', 'python-requests', 'httpx/', 'aiohttp', 'node-fetch',
  'undici', 'axios/', 'go-http-client', 'okhttp', 'java/', 'ruby', 'php/',
  'postmanruntime', 'insomnia',
];

const hit = (ua, list) => list.some((needle) => ua.includes(needle));

export function classifyUserAgent(userAgent) {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua) return 'unknown';
  if (hit(ua, OWN)) return 'own';
  if (hit(ua, AI_AGENTS)) return 'ai_agent';
  if (hit(ua, AI_CRAWLERS)) return 'ai_crawler';
  if (hit(ua, CLASSIC_BOTS)) return 'classic_bot';
  if (hit(ua, SCRIPTS)) return 'script';
  if (ua.startsWith('mozilla/') && /(chrome|safari|firefox|gecko|edg)\//.test(ua)) return 'browser';
  return 'other';
}

export function classifyPath(pathname, { apex = false } = {}) {
  if (pathname === '/' || pathname === '/index.html') return apex ? 'apex_home' : 'home';
  if (pathname === '/llms.txt' || pathname === '/llms-full.txt') return 'llms_txt';
  if (pathname === '/robots.txt') return 'robots';
  if (pathname === '/sitemap.xml') return 'sitemap';
  if (pathname === '/openapi.yaml') return 'openapi';
  if (pathname === '/api/audit') return 'audit';
  if (pathname === '/api/score') return 'score_free';
  if (pathname === '/api/check') return 'check_single';
  if (pathname === '/api/watch') return 'watch';
  if (pathname === '/api/watch/sweep') return 'watch_sweep';
  if (pathname === '/api/liveness') return 'liveness';
  if (pathname === '/api/route') return 'route';
  if (pathname === '/api/stats.json') return 'stats';
  if (pathname === '/api/x402/info') return 'x402_info';
  if (pathname === '/api/revenue.json') return 'revenue';
  if (pathname === '/dashboard.html' || pathname === '/dashboard') return 'dashboard';
  if (pathname === '/.well-known/agent.json' || pathname === '/agents.json') return 'agent_card';
  if (pathname === '/.well-known/http-message-signatures-directory') return 'sig_directory';
  if (pathname === '/badge.svg') return 'badge';
  if (pathname.startsWith('/api/')) return 'api';
  if (pathname.startsWith('/listings/')) return 'listing_json';
  if (pathname.startsWith('/l/')) return 'listing_page';
  if (pathname.startsWith('/assets/')) return 'asset';
  return 'other';
}

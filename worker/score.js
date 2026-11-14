
import { auditUrl, parseAuditRequest, CHECK_LABELS, resolveCheckSet, scoreDescription, SCORE_INTERPRETATION, CHECK_CONTEXT } from './audit.js';
import { botAuthHeaders, keyDirectory, DIRECTORY_PATH, DIRECTORY_CONTENT_TYPE } from './signing.js';
import { serveStatic } from './assets.js';
import { authorizeOperationsBearer } from './revenue.js';

export function auditSigner(env, cfg) {
  if (!env?.SIGNING_KEY) return null;
  const agent = `${cfg.base.replace(/\/+$/, '')}${DIRECTORY_PATH}`;
  return async (method, target) => ({
    ...(await botAuthHeaders(env, method, target)),
    'signature-agent': `"${agent}"`,
  });
}

export function fetcherFor(request, env, target) {
  const sameHost = new URL(target).host === new URL(request.url).host;
  if (!sameHost || !env.ASSETS) return undefined;

  return async (input, init) => {
    const href = typeof input === 'string' ? input : input.url;
    const url = new URL(href);
    const headers = new Headers(init?.headers ?? (typeof input === 'string' ? undefined : input.headers));
    if (url.pathname === DIRECTORY_PATH) {
      const directory = await keyDirectory(env);
      if (directory) {
        return new Response(JSON.stringify(directory, null, 2), {
          headers: { 'content-type': DIRECTORY_CONTENT_TYPE },
        });
      }
    }
    return serveStatic(env, url, headers);
  };
}

export function canonicalTarget(target, cfg) {
  const aliases = [...(cfg.host_aliases ?? []), cfg.router_host].filter(Boolean);
  try {
    const url = new URL(target);
    if (!aliases.includes(url.host)) return target;
    const isHostRoot = (host) => host && url.host === host
      && (url.pathname === '/' || url.pathname === '/index.html');
    const isApexRoot = isHostRoot(cfg.apex_host);
    const isRouterRoot = isHostRoot(cfg.router_host);
    url.host = new URL(cfg.base).host;
    if (isRouterRoot) url.pathname = '/router.html';
    if (isApexRoot) url.pathname = '/apex.html';
    return url.href;
  } catch {
    // target is validated upstream; an unparsable one is returned unchanged.
  }
  return target;
}

const CACHE_PREFIX = 'score:v2:';
const CACHE_TTL_SECONDS = 3600;
const RATE_PREFIX = 'score:rl:';
const RATE_LIMIT_PER_HOUR = 60;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

export function freeView(result, upsell) {
  return {
    ok: true,
    url: result.url,
    audited_at: result.audited_at,
    letter: result.letter,
    score: result.score,
    max_score: result.max_score,
    check_set: result.check_set,
    grade: scoreDescription(result.score),
    interpretation: SCORE_INTERPRETATION,
    passed: result.passed,
    total_checks: result.total_checks,
    checks: (result.checks ?? []).map((c) => ({
      id: c.id,
      label: c.label ?? CHECK_LABELS[c.id] ?? c.id,
      pass: c.pass,
      weight: c.weight,
      scope: CHECK_CONTEXT[c.id] ? 'optional_service' : 'site_information',
      applicability: CHECK_CONTEXT[c.id] ?? 'Site information and access: assess this finding against your intended audience and publishing policy.',
    })),
    signals: result.signals
      ? {
        scored: result.signals.scored,
        detected: result.signals.detected,
        total: result.signals.total,
        items: result.signals.items.map((s) => ({ id: s.id, label: s.label, present: s.present, weight: s.weight })),
      }
      : undefined,
    tier: 'free',
    unlock: upsell,
  };
}

function upsellFor(base, rail) {
  const price = rail?.audit_price_atomic;
  const decimals = rail?.asset_decimals ?? 6;
  const human = price && /^\d+$/.test(price)
    ? `${(Number(price) / 10 ** decimals).toFixed(2)} ${rail.asset_name ?? 'USDC'}`
    : null;
  return {
    what: 'per-check detail, fixes ranked by weight, and a paste-ready code snippet for every failing check',
    endpoint: `${base}/api/audit`,
    method: 'POST',
    price: human,
    protocol: 'x402 — v1 (X-PAYMENT) and v2 (PAYMENT-SIGNATURE) both accepted',
    terms: `${base}/api/x402/info`,
  };
}

const hourBucket = () => new Date().toISOString().slice(0, 13);

async function overRateLimit(env, ip) {
  if (!env.PAYMENTS || !ip) return false;
  const key = `${RATE_PREFIX}${ip}:${hourBucket()}`;
  const current = Number(await env.PAYMENTS.get(key)) || 0;
  if (current >= RATE_LIMIT_PER_HOUR) return true;
  await env.PAYMENTS.put(key, String(current + 1), { expirationTtl: 3600 });
  return false;
}

export async function handleScore(request, env, cfg, rail, listings = []) {
  const base = cfg.base.replace(/\/+$/, '');
  const upsell = upsellFor(base, rail);
  const url = new URL(request.url);
  const target = url.searchParams.get('url') ?? '';

  if (!target) {
    return json({
      ok: false,
      code: 'missing_url',
      error: 'pass ?url=https://example.com',
      example: `${base}/api/score?url=https://example.com`,
    }, 400);
  }

  const parsed = parseAuditRequest({ url: target });
  if (parsed.error) return json({ ok: false, code: 'invalid', errors: [parsed.error] }, 400);

  const registryRun = request.headers.get('x-registry-score') === '1';
  if (registryRun) {
    if (!authorizeOperationsBearer(request, env)) {
      return json({ ok: false, code: 'unauthorized', error: 'registry scoring requires an operations bearer' }, 401);
    }
    const registered = listings.some((listing) => parseAuditRequest({ url: listing.url }).url === parsed.url);
    if (!registered) {
      return json({ ok: false, code: 'not_registered', error: 'registry scoring is limited to registered URLs' }, 403);
    }
  }

  const targetUrl = canonicalTarget(parsed.url, cfg);
  const checkSet = resolveCheckSet(url.searchParams.get('checks') ?? undefined);
  const cacheKey = `${CACHE_PREFIX}${checkSet}:${targetUrl}`;
  if (env.PAYMENTS) {
    const hit = await env.PAYMENTS.get(cacheKey);
    if (hit) {
      try {
        return json({ ...JSON.parse(hit), cached: true, unlock: upsell }, 200, {
          'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`,
        });
      } catch {
        // A corrupt entry should re-audit, not 500.
      }
    }
  }

  const ip = request.headers.get('cf-connecting-ip') ?? '';
  if (!registryRun && await overRateLimit(env, ip)) {
    return json({
      ok: false,
      code: 'rate_limited',
      error: `the free score is limited to ${RATE_LIMIT_PER_HOUR} new audits per hour; cached URLs do not count. The paid endpoint is not rate limited.`,
      unlock: upsell,
    }, 429, { 'retry-after': '3600' });
  }

  const result = await auditUrl(targetUrl, fetcherFor(request, env, targetUrl), auditSigner(env, cfg), checkSet);
  if (!result.ok) return json({ ok: false, code: 'audit_failed', error: result.error ?? 'could not read that site' }, 502);

  const view = freeView(result, upsell);
  if (env.PAYMENTS) {
    await env.PAYMENTS.put(cacheKey, JSON.stringify(view), { expirationTtl: CACHE_TTL_SECONDS });
  }
  return json(view, 200, { 'cache-control': `public, max-age=${CACHE_TTL_SECONDS}` });
}

export const __testing = { freeView, upsellFor, fetcherFor, canonicalTarget, RATE_LIMIT_PER_HOUR, CACHE_PREFIX, RATE_PREFIX };

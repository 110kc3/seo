// GET /api/score?url=… — the free teaser.
//
// The funnel: this answers "is my site readable to agents?" for nothing, in one
// request, with a letter grade and the name of every check that failed. What it
// deliberately withholds is the half that takes work to act on — the per-check
// `detail`, the ranked `fix` prose, and the paste-ready `snippet` for each
// failure. Those are what `POST /api/audit` sells for $0.05.
//
// So the free tier tells you *that* you have a problem and roughly where; the
// paid tier hands you the code that fixes it.
//
// Two things make a free endpoint that fetches arbitrary URLs safe to run:
//
//   * the target goes through the same `urlError()` boundary as the paid path,
//     so private and local hosts are refused — this is not an SSRF hop;
//   * results are cached per URL and callers are rate limited per IP, so it
//     cannot be used as a free fetch proxy or to burn our subrequest budget.

import { auditUrl, parseAuditRequest, CHECK_LABELS } from './audit.js';

/**
 * A Worker cannot fetch its own hostname — Cloudflare answers 522, on the custom
 * domain and the workers.dev one alike. Comparing against the *request's* host
 * rather than a configured base covers every hostname this deployment answers on,
 * now and later, with nothing to keep in sync.
 */
export function fetcherFor(request, env, target) {
  const sameHost = new URL(target).host === new URL(request.url).host;
  return sameHost && env.ASSETS ? env.ASSETS.fetch.bind(env.ASSETS) : undefined;
}

const CACHE_PREFIX = 'score:v1:';
const CACHE_TTL_SECONDS = 3600;
const RATE_PREFIX = 'score:rl:';
const RATE_LIMIT_PER_HOUR = 20;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

/**
 * The free projection of a full audit result: grade, and which checks failed by
 * name. Pure, so the paywall boundary is testable without a network call.
 *
 * Whitelists fields rather than deleting the paid ones — a field added to the
 * audit later cannot leak into the free tier by omission.
 */
export function freeView(result, upsell) {
  return {
    ok: true,
    url: result.url,
    audited_at: result.audited_at,
    letter: result.letter,
    score: result.score,
    max_score: result.max_score,
    grade: result.grade,
    passed: result.passed,
    total_checks: result.total_checks,
    checks: (result.checks ?? []).map((c) => ({
      id: c.id,
      label: c.label ?? CHECK_LABELS[c.id] ?? c.id,
      pass: c.pass,
      weight: c.weight,
    })),
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

/**
 * Rate limit by client IP, hour by hour.
 *
 * Deliberately not a security boundary: KV is eventually consistent, so two
 * simultaneous requests can both read the same count. It is abuse throttling for
 * an endpoint that costs us ~7 outbound fetches per miss, and approximate is
 * enough for that.
 */
async function overRateLimit(env, ip) {
  if (!env.PAYMENTS || !ip) return false;
  const key = `${RATE_PREFIX}${ip}:${hourBucket()}`;
  const current = Number(await env.PAYMENTS.get(key)) || 0;
  if (current >= RATE_LIMIT_PER_HOUR) return true;
  await env.PAYMENTS.put(key, String(current + 1), { expirationTtl: 3600 });
  return false;
}

export async function handleScore(request, env, cfg, rail) {
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

  // Same validation as the paid endpoint, so the free tier is not a softer door.
  const parsed = parseAuditRequest({ url: target });
  if (parsed.error) return json({ ok: false, code: 'invalid', errors: [parsed.error] }, 400);

  const cacheKey = `${CACHE_PREFIX}${parsed.url}`;
  if (env.PAYMENTS) {
    const hit = await env.PAYMENTS.get(cacheKey);
    if (hit) {
      try {
        // A cache hit costs us nothing, so it is not rate limited.
        return json({ ...JSON.parse(hit), cached: true, unlock: upsell }, 200, {
          'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`,
        });
      } catch {
        // A corrupt entry should re-audit, not 500.
      }
    }
  }

  const ip = request.headers.get('cf-connecting-ip') ?? '';
  if (await overRateLimit(env, ip)) {
    return json({
      ok: false,
      code: 'rate_limited',
      error: `the free score is limited to ${RATE_LIMIT_PER_HOUR} new audits per hour; cached URLs do not count. The paid endpoint is not rate limited.`,
      unlock: upsell,
    }, 429, { 'retry-after': '3600' });
  }

  const result = await auditUrl(parsed.url, fetcherFor(request, env, parsed.url));
  if (!result.ok) return json({ ok: false, code: 'audit_failed', error: result.error ?? 'could not read that site' }, 502);

  const view = freeView(result, upsell);
  if (env.PAYMENTS) {
    await env.PAYMENTS.put(cacheKey, JSON.stringify(view), { expirationTtl: CACHE_TTL_SECONDS });
  }
  return json(view, 200, { 'cache-control': `public, max-age=${CACHE_TTL_SECONDS}` });
}

export const __testing = { freeView, upsellFor, fetcherFor, RATE_LIMIT_PER_HOUR, CACHE_PREFIX, RATE_PREFIX };

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

import { auditUrl, parseAuditRequest, CHECK_LABELS, resolveCheckSet } from './audit.js';
import { botAuthHeaders, keyDirectory, DIRECTORY_PATH, DIRECTORY_CONTENT_TYPE } from './signing.js';
import { serveStatic } from './assets.js';

/**
 * Signs the auditor's outbound requests under the web-bot-auth profile, and
 * points at our key directory so the audited site can resolve the keyid. Returns
 * null when unkeyed, which leaves the fetches unsigned rather than half-signed.
 */
export function auditSigner(env, cfg) {
  if (!env?.SIGNING_KEY) return null;
  const agent = `${cfg.base.replace(/\/+$/, '')}${DIRECTORY_PATH}`;
  return async (method, target) => ({
    ...(await botAuthHeaders(env, method, target)),
    'signature-agent': `"${agent}"`,
  });
}

/**
 * A Worker cannot fetch its own hostname — Cloudflare answers 522, on the custom
 * domain and the workers.dev one alike. Comparing against the *request's* host
 * rather than a configured base covers every hostname this deployment answers on,
 * now and later, with nothing to keep in sync.
 */
export function fetcherFor(request, env, target) {
  const sameHost = new URL(target).host === new URL(request.url).host;
  if (!sameHost || !env.ASSETS) return undefined;

  // A Worker cannot fetch its own hostname, so a same-host audit has to be
  // served from inside. The naive version — hand it the raw ASSETS binding —
  // serves committed files and nothing else, which makes the audit blind to
  // every behaviour this Worker adds at request time. Two checks read exactly
  // that: `web_bot_auth` (the key directory is generated, not a file) and
  // `markdown_negotiation` (the Accept branch and the content-type relabel both
  // live in the header layer). Both read as absent while answering correctly to
  // everyone else — a self-audit understating the site it runs on, which is the
  // one direction of error nobody thinks to check. Once the 2026 signals became
  // scored, it also cost us three real points.
  //
  // So this routes through `serveStatic()`, the same function the public
  // fall-through branch uses, rather than reimplementing negotiation here. A
  // second copy of the negotiation rules is the exact anti-pattern the MCP
  // tool-list fix removed, and it would drift the same way.
  //
  // Recursion is impossible by construction rather than by a guard: the only
  // dynamic route reachable from here is the key directory, and nothing in this
  // path can re-enter `/api/score` or `/api/audit`. Auditing our own
  // `/api/score` URL therefore reads it as a static miss, exactly as before.
  return async (input, init) => {
    // Reduced to a URL and headers rather than forwarded as a Request. The
    // auditor calls its fetcher with `redirect` and an AbortSignal, neither of
    // which the asset layer can use — it does not follow redirects (fetchAsset
    // absorbs exactly one hop deliberately) and its work is not cancellable.
    // Passing them on is also what broke this on the real runtime; see the note
    // on fetchAsset. Only Accept changes the answer, because that is what
    // content negotiation reads.
    const href = typeof input === 'string' ? input : input.url;
    const url = new URL(href);
    const headers = new Headers(init?.headers ?? (typeof input === 'string' ? undefined : input.headers));
    if (url.pathname === DIRECTORY_PATH) {
      const directory = await keyDirectory(env);
      // An unkeyed deployment has no directory. Falling through to the asset
      // layer yields its 404, which is the truth; serving the literal "null"
      // with a 200 would report web-bot-auth as present on a site that cannot
      // sign.
      if (directory) {
        return new Response(JSON.stringify(directory, null, 2), {
          headers: { 'content-type': DIRECTORY_CONTENT_TYPE },
        });
      }
    }
    return serveStatic(env, url, headers);
  };
}

// Hosts attached to this Worker that are not the canonical one — the percall.dev
// apex and the pre-migration index.kc-it.pl, which both answer 308. A Worker
// cannot fetch its own hostnames, so an audit target on any of them must be
// rewritten to the canonical host, which the same-host ASSETS path can serve.
// Found the expensive way: without this, a *paid* audit of the old domain
// settles the payment and then answers 502.
export function canonicalTarget(target, cfg) {
  // Derived, not duplicated. Every host this Worker answers on has to be in
  // here or a paid audit of it settles and then 502s, and the way that keeps
  // happening is a new hostname being added in one place and not the other.
  // `router_host` is therefore read straight from config rather than copied
  // into host_aliases by hand.
  const aliases = [...(cfg.host_aliases ?? []), cfg.router_host].filter(Boolean);
  try {
    const url = new URL(target);
    if (!aliases.includes(url.host)) return target;
    const isHostRoot = (host) => host && url.host === host
      && (url.pathname === '/' || url.pathname === '/index.html');
    const isApexRoot = isHostRoot(cfg.apex_host);
    // Same defect, same fix, one host later: the Router's root is a page of its
    // own, so mapping it to `/` would grade the index and publish the score
    // under the Router's name. The apex taught this once; a second host is
    // exactly when a one-off special case has to become the general rule.
    const isRouterRoot = isHostRoot(cfg.router_host);
    url.host = new URL(cfg.base).host;
    if (isRouterRoot) url.pathname = '/router.html';
    // The apex root stopped being an alias the moment it became a page of its
    // own. Mapping it to `/` would audit the index and report the score under
    // the apex's name — quietly grading one page and labelling it another, which
    // is precisely the defect this endpoint is sold to find. Point it at the
    // bytes that host actually serves instead.
    if (isApexRoot) url.pathname = '/apex.html';
    return url.href;
  } catch {
    // target is validated upstream; an unparsable one is returned unchanged.
  }
  return target;
}

const CACHE_PREFIX = 'score:v1:';
const CACHE_TTL_SECONDS = 3600;
const RATE_PREFIX = 'score:rl:';
// 20 was set when the registry held eight listings. It now holds forty, and the
// weekly scorer audits every one of them from a single runner IP — so the limit
// had become tight enough to throttle our own cron, which fails *quietly*:
// score-listings keeps the previous grade on error, and thirty-two of those
// listings have no previous grade to keep. The badges would have read "not
// scored yet" indefinitely while every run looked green.
//
// 60 covers the fleet with room to grow. What the limit is actually defending
// is unchanged: an uncached score costs ~14 outbound fetches, cache hits are
// free and unmetered, and the paid endpoint is not rate limited at all.
const RATE_LIMIT_PER_HOUR = 60;

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
    check_set: result.check_set,
    grade: result.grade,
    passed: result.passed,
    total_checks: result.total_checks,
    checks: (result.checks ?? []).map((c) => ({
      id: c.id,
      label: c.label ?? CHECK_LABELS[c.id] ?? c.id,
      pass: c.pass,
      weight: c.weight,
    })),
    // Free too. These are unscored observations, so withholding them would be
    // withholding the part that is only useful as information — and a free
    // score that already names the 2026 surfaces is the clearest argument that
    // the paid audit is current. The per-signal `fix` text stays paid, same as
    // for the scored checks.
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

  const targetUrl = canonicalTarget(parsed.url, cfg);
  // The check set is part of the cache identity. Without it, whichever set was
  // asked for first would be served to callers asking for the other one — the
  // same URL genuinely has two different correct grades.
  const checkSet = resolveCheckSet(url.searchParams.get('checks') ?? undefined);
  const cacheKey = `${CACHE_PREFIX}${checkSet}:${targetUrl}`;
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

  const result = await auditUrl(targetUrl, fetcherFor(request, env, targetUrl), auditSigner(env, cfg), checkSet);
  if (!result.ok) return json({ ok: false, code: 'audit_failed', error: result.error ?? 'could not read that site' }, 502);

  const view = freeView(result, upsell);
  if (env.PAYMENTS) {
    await env.PAYMENTS.put(cacheKey, JSON.stringify(view), { expirationTtl: CACHE_TTL_SECONDS });
  }
  return json(view, 200, { 'cache-control': `public, max-age=${CACHE_TTL_SECONDS}` });
}

export const __testing = { freeView, upsellFor, fetcherFor, canonicalTarget, RATE_LIMIT_PER_HOUR, CACHE_PREFIX, RATE_PREFIX };

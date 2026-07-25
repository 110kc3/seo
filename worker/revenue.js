// Revenue ledger — every settled payment, and the aggregates behind /dashboard.html.
//
// Storage is KV *metadata*, not KV values: a settlement record is written as the
// metadata of an empty key, so a single `list()` returns every record in one
// call. Reading N settlements therefore costs one operation rather than N gets,
// and there is no read-modify-write on a shared array to lose writes to a race.
//
// Keys are `revenue:<ISO timestamp>:<short tx>`. KV lists lexicographically and
// ISO-8601 sorts chronologically, so listing is already time-ordered.
//
// This is a business feed, so both it and the dashboard page are gated and
// fail closed when no token is configured. The payTo address is public and its
// inflows are visible on-chain regardless — the gate is about not exposing a
// convenient aggregate, not about pretending the payments are secret.

const PREFIX = 'revenue:';
const RETENTION_SECONDS = 60 * 60 * 24 * 400;
const MAX_RECORDS = 1000;
const RECENT_LIMIT = 50;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

/**
 * Records one settled payment. Never throws into the request path — a failed
 * ledger write must not turn a payment the buyer already made into an error.
 */
export async function recordSettlement(env, record) {
  if (!env?.PAYMENTS) return;
  try {
    const ts = record.ts ?? new Date().toISOString();
    const key = `${PREFIX}${ts}:${String(record.transaction ?? '').slice(2, 12)}`;
    // KV caps metadata at 1024 bytes; these fields are far inside that.
    await env.PAYMENTS.put(key, '', {
      metadata: {
        ts,
        amount: String(record.amount ?? '0'),
        decimals: record.decimals ?? 6,
        asset_name: record.asset_name ?? 'USDC',
        network: record.network ?? '',
        rail: record.rail ?? '',
        resource: record.resource ?? '',
        transaction: record.transaction ?? '',
        payer: record.payer ?? '',
      },
      expirationTtl: RETENTION_SECONDS,
    });
  } catch {
    // Telemetry must never break a paid response.
  }
}

/** Atomic units -> a decimal string, without floating point. */
export function formatAmount(atomic, decimals) {
  const digits = String(atomic ?? '0').replace(/\D/g, '') || '0';
  if (!decimals) return digits;
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const frac = padded.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/** Aggregates raw ledger records into the shape the dashboard renders. */
export function summarise(records) {
  const sorted = [...records].sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const decimals = sorted[0]?.decimals ?? 6;

  let totalAtomic = 0n;
  const byDay = new Map();
  const byResource = new Map();
  const payers = new Set();

  for (const r of sorted) {
    let amount;
    try {
      amount = BigInt(String(r.amount ?? '0'));
    } catch {
      continue;
    }
    totalAtomic += amount;
    if (r.payer) payers.add(r.payer.toLowerCase());

    const day = String(r.ts ?? '').slice(0, 10);
    const dayRow = byDay.get(day) ?? { date: day, atomic: 0n, count: 0 };
    dayRow.atomic += amount;
    dayRow.count += 1;
    byDay.set(day, dayRow);

    const res = r.resource || 'unknown';
    const resRow = byResource.get(res) ?? { resource: res, atomic: 0n, count: 0 };
    resRow.atomic += amount;
    resRow.count += 1;
    byResource.set(res, resRow);
  }

  const settlements = sorted.length;
  const expand = (rows, key) => rows.map((r) => ({
    [key]: r[key],
    amount_atomic: r.atomic.toString(),
    amount: formatAmount(r.atomic.toString(), decimals),
    count: r.count,
  }));

  return {
    currency: sorted[0]?.asset_name ?? 'USDC',
    decimals,
    total_atomic: totalAtomic.toString(),
    total: formatAmount(totalAtomic.toString(), decimals),
    settlements,
    unique_payers: payers.size,
    average: settlements ? formatAmount((totalAtomic / BigInt(settlements)).toString(), decimals) : formatAmount('0', decimals),
    last_payment_at: sorted[0]?.ts ?? null,
    by_day: expand([...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)), 'date'),
    by_resource: expand([...byResource.values()].sort((a, b) => (b.atomic > a.atomic ? 1 : -1)), 'resource'),
    recent: sorted.slice(0, RECENT_LIMIT).map((r) => ({
      ts: r.ts,
      amount: formatAmount(r.amount, r.decimals ?? decimals),
      resource: r.resource,
      transaction: r.transaction,
      payer: r.payer,
      network: r.network,
    })),
  };
}

export const COOKIE = 'aipi_dash';

/** Length-independent comparison, so a wrong token leaks nothing by timing. */
function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieValue(request, name) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * Authorizes any dashboard surface — the page and the feed alike.
 *
 * Three ways to present the token: an HttpOnly cookie (set on first use, so
 * reloads work and the token never reaches page JavaScript), `?token=` for that
 * first navigation, or a bearer header for programmatic callers.
 *
 * @returns {{state: 'disabled'} | {state: 'denied'} | {state: 'ok', viaQuery: boolean}}
 */
export function authorizeDashboard(request, env) {
  const expected = env?.DASHBOARD_TOKEN;
  if (!expected) return { state: 'disabled' };

  if (tokensMatch(cookieValue(request, COOKIE) ?? '', expected)) return { state: 'ok', viaQuery: false };

  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (bearer && tokensMatch(bearer, expected)) return { state: 'ok', viaQuery: false };

  const query = new URL(request.url).searchParams.get('token') ?? '';
  if (query && tokensMatch(query, expected)) return { state: 'ok', viaQuery: true };

  return { state: 'denied' };
}

/**
 * Cookie for the authenticated session. HttpOnly so page scripts cannot read
 * the token, SameSite=Strict so it never rides a cross-site request.
 */
export function sessionCookie(token) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`;
}

/**
 * GET /api/revenue.json — gated.
 * No token configured => 503, so an unconfigured deployment never leaks the feed.
 */
export async function handleRevenue(request, env, rail) {
  const auth = authorizeDashboard(request, env);
  if (auth.state === 'disabled') {
    return json({
      ok: false,
      code: 'dashboard_not_enabled',
      error: 'revenue reporting is not configured — set the DASHBOARD_TOKEN secret to enable it',
    }, 503);
  }
  if (auth.state === 'denied') {
    return json({ ok: false, code: 'unauthorized', error: 'valid bearer token required' }, 401, {
      'www-authenticate': 'Bearer realm="revenue"',
    });
  }

  let listed;
  try {
    listed = await env.PAYMENTS.list({ prefix: PREFIX, limit: MAX_RECORDS });
  } catch (e) {
    return json({ ok: false, code: 'ledger_unavailable', error: e.message }, 502);
  }

  const records = (listed.keys ?? []).map((k) => k.metadata).filter(Boolean);
  return json({
    ok: true,
    generated_at: new Date().toISOString(),
    rail: rail ? { name: rail.rail, network: rail.network, live: rail.network === 'eip155:8453', explorer: rail.explorer } : null,
    truncated: Boolean(listed.list_complete === false),
    ...summarise(records),
  });
}

export const __testing = { PREFIX, summarise, formatAmount, tokensMatch, cookieValue };

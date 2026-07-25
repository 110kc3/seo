// x402 payment gate (HTTP transport), speaking BOTH protocol versions.
//
// Spec: coinbase/x402 specs/x402-specification-v2.md + specs/transports-v2/http.md
// Headers (v2 dropped the non-standard X- prefix):
//   PAYMENT-REQUIRED   server -> client   base64(PaymentRequired)
//   PAYMENT-SIGNATURE  client -> server   base64(PaymentPayload)
//   PAYMENT-RESPONSE   server -> client   base64(SettlementResponse)
//
// Why v1 is still served
// ----------------------
// v2 is the current spec, but the installed client base is not there yet. The
// reference client (x402-fetch 1.2.0, npm latest as of 2026-07) validates the
// 402 with a v1 Zod schema and *throws* rather than degrading: it requires
// `network: "base-sepolia"` (a name, not a CAIP-2 id) and `maxAmountRequired`
// (not `amount`), and it sends its payload in `X-PAYMENT`. A v2-only endpoint
// is therefore unpayable by the very clients most likely to call it — verified
// by driving that client against this Worker.
//
// So each version is answered where its own spec says to look:
//   * the PAYMENT-REQUIRED *header* carries the v2 challenge (v2 clients read
//     the header)
//   * the response *body* carries the v1 challenge (v1 clients read the body)
// They are not merged into one `accepts` array on purpose: a v1 client parses
// the whole array with its own schema, so a single v2 entry in there makes it
// throw on the entire response.
//
// A payment then arrives in whichever header the client speaks, and is verified
// and settled against the matching requirements. The facilitator settles both —
// x402.org/facilitator advertises v1 base-sepolia and v2 eip155:84532 alike.
//
// Trust model: the facilitator verifies signatures, balances and simulates the
// transfer. It does NOT know what we charge, so this module — not the
// facilitator — is what stops a client from paying 1 atomic unit to an address
// of their choosing. Every field of the client's `accepted` block is compared
// against our own requirements before anything is sent onward.

import { resolveX402 } from '../scripts/x402-config.mjs';
import { facilitatorHeaders } from './cdp-auth.js';
import { recordSettlement } from './revenue.js';

const HDR_REQUIRED = 'PAYMENT-REQUIRED';
const HDR_SIGNATURE = 'PAYMENT-SIGNATURE';
const HDR_RESPONSE = 'PAYMENT-RESPONSE';
// v1 used non-standard X- prefixes; kept for the installed client base.
const HDR_V1_SIGNATURE = 'X-PAYMENT';
const HDR_V1_RESPONSE = 'X-PAYMENT-RESPONSE';

export const X402_VERSION = 2;
export const X402_VERSION_V1 = 1;

function b64encode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(value) {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

const sameAddress = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// Atomic-unit amounts are decimal strings; compare numerically so "010000"
// or " 10000" can never pass as a match for "10000".
function sameAmount(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!/^\d{1,78}$/.test(a) || !/^\d{1,78}$/.test(b)) return false;
  return BigInt(a) === BigInt(b);
}

/**
 * Builds the PaymentRequirements we are willing to accept. Returns null when
 * payment rails are unconfigured — callers must fail closed, never serve free.
 */
export function paymentRequirements(cfg, amountAtomic) {
  const rail = resolveX402(cfg);
  if (!rail || !amountAtomic) return null;
  return {
    scheme: 'exact',
    network: rail.network,
    amount: String(amountAtomic),
    asset: rail.asset,
    payTo: rail.payTo,
    maxTimeoutSeconds: rail.max_timeout_seconds,
    extra: { name: rail.asset_name, version: rail.asset_version },
  };
}

/**
 * The same terms in the v1 shape: a network *name* instead of a CAIP-2 id,
 * `maxAmountRequired` instead of `amount`, and a flat `resource` URL string.
 *
 * Returns null when the profile declares no v1 network name, which switches v1
 * off for that rail rather than guessing a name the facilitator may not know.
 */
export function paymentRequirementsV1(cfg, amountAtomic, resource) {
  const rail = resolveX402(cfg);
  if (!rail || !amountAtomic || !rail.network_v1) return null;
  return {
    scheme: 'exact',
    network: rail.network_v1,
    maxAmountRequired: String(amountAtomic),
    resource: resource?.url ?? '',
    description: resource?.description ?? '',
    mimeType: resource?.mimeType ?? 'application/json',
    payTo: rail.payTo,
    maxTimeoutSeconds: rail.max_timeout_seconds,
    asset: rail.asset,
    extra: { name: rail.asset_name, version: rail.asset_version },
  };
}

function paymentRequiredResponse(requirements, requirementsV1, resource, error, settlement, version = X402_VERSION) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    [HDR_REQUIRED]: b64encode({ x402Version: X402_VERSION, error, resource, accepts: [requirements] }),
  };
  if (settlement) {
    headers[version === X402_VERSION_V1 ? HDR_V1_RESPONSE : HDR_RESPONSE] = b64encode(settlement);
  }
  // The body is the v1 challenge when v1 is available, because that is where a
  // v1 client looks and it validates the body strictly. v2 clients read the
  // header above, so nothing is lost by shaping the body for the older spec.
  const body = requirementsV1
    ? { ok: false, code: 'payment_required', error, x402Version: X402_VERSION_V1, accepts: [requirementsV1] }
    : { ok: false, code: 'payment_required', error, x402Version: X402_VERSION, accepts: [requirements] };
  return new Response(JSON.stringify({ ...body, docs: 'https://docs.x402.org' }, null, 2) + '\n', { status: 402, headers });
}

function fail(code, error, status = 400) {
  return new Response(JSON.stringify({ ok: false, code, error }, null, 2) + '\n', {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function facilitator(url, path, body, authHeaders = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const resp = await fetch(`${url.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'ai-product-index/1.0', ...authHeaders },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: resp.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gates a request behind an x402 payment, in either protocol version.
 *
 * @returns {Promise<{paid: true, settlement: object, version: number} | {paid: false, response: Response}>}
 *   On `paid`, the caller must echo `settlement` back in the settlement header
 *   for that `version` (see attachSettlement).
 */
export async function requirePayment(request, env, cfg, { amountAtomic, resource }) {
  const requirements = paymentRequirements(cfg, amountAtomic);
  const requirementsV1 = paymentRequirementsV1(cfg, amountAtomic, resource);
  if (!requirements) {
    // Same fail-closed contract the [upgrade] issue flow uses, so agents get
    // one recognisable code across both write paths.
    return {
      paid: false,
      response: fail(
        'payments_not_enabled',
        `paid access is not purchasable yet — the x402 rail is not fully configured; watch ${cfg.base.replace(/\/+$/, '')}/llms.txt`,
        503,
      ),
    };
  }
  const challenge = (error, settlement, version) =>
    paymentRequiredResponse(requirements, requirementsV1, resource, error, settlement, version);

  // Whichever header the client speaks decides the version for the rest of the
  // exchange. v2 wins if somehow both are present.
  const rawV2 = request.headers.get(HDR_SIGNATURE);
  const rawV1 = requirementsV1 ? request.headers.get(HDR_V1_SIGNATURE) : null;
  const version = rawV2 ? X402_VERSION : X402_VERSION_V1;
  const raw = rawV2 ?? rawV1;
  const header = rawV2 ? HDR_SIGNATURE : HDR_V1_SIGNATURE;
  const terms = version === X402_VERSION ? requirements : requirementsV1;

  if (!raw) {
    const wanted = requirementsV1 ? `${HDR_SIGNATURE} (x402 v2) or ${HDR_V1_SIGNATURE} (v1)` : HDR_SIGNATURE;
    return { paid: false, response: challenge(`${wanted} header is required`) };
  }

  let payload;
  try {
    payload = b64decode(raw);
  } catch {
    return { paid: false, response: fail('bad_payment_payload', `${header} must be base64-encoded JSON`) };
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { paid: false, response: fail('bad_payment_payload', 'payment payload must be a JSON object') };
  }
  if (payload.x402Version !== version) {
    return {
      paid: false,
      response: fail('unsupported_version', `${header} carries x402Version ${payload.x402Version}, which does not match that header's protocol version (${version})`),
    };
  }

  // --- the checks the facilitator cannot make for us ---
  // The two versions assert different amounts of the deal in the payload, so
  // each is checked for exactly what it actually claims — no more:
  //
  //   v2 restates the chosen terms under `accepted`, so all five fields are
  //   compared against ours.
  //   v1 carries only `scheme` and `network`; it names no asset, recipient or
  //   amount. Those are pinned instead by the paymentRequirements *we* send to
  //   the facilitator, by the token's own EIP-712 domain, and by the
  //   authorization checks immediately below — never by the client's word.
  let mismatch;
  if (version === X402_VERSION) {
    const accepted = payload.accepted;
    if (typeof accepted !== 'object' || accepted === null) {
      return { paid: false, response: fail('bad_payment_payload', 'payment payload is missing "accepted"') };
    }
    mismatch =
      (accepted.scheme !== terms.scheme && 'scheme')
      || (accepted.network !== terms.network && 'network')
      || (!sameAddress(accepted.asset, terms.asset) && 'asset')
      || (!sameAddress(accepted.payTo, terms.payTo) && 'payTo')
      || (!sameAmount(accepted.amount, terms.amount) && 'amount');
  } else {
    mismatch =
      (payload.scheme !== terms.scheme && 'scheme')
      || (payload.network !== terms.network && 'network');
  }
  if (mismatch) {
    return {
      paid: false,
      response: challenge(`payment "${mismatch}" does not match the required payment terms`, null, version),
    };
  }

  // The authorization is what actually moves funds — check it independently of
  // the `accepted` block the client also controls.
  const auth = payload.payload?.authorization;
  if (typeof auth !== 'object' || auth === null) {
    return { paid: false, response: fail('bad_payment_payload', 'payment payload is missing payload.authorization') };
  }
  // requirements (v2) is used for both versions here on purpose: payTo and the
  // atomic amount are identical across the two shapes, and this is the one
  // check that stands between a client and paying one atomic unit to itself.
  if (!sameAddress(auth.to, requirements.payTo) || !sameAmount(auth.value, requirements.amount)) {
    return {
      paid: false,
      response: challenge('authorization recipient or value does not match the required payment terms', null, version),
    };
  }
  if (typeof auth.nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) {
    return { paid: false, response: fail('bad_payment_payload', 'authorization.nonce must be a 32-byte hex string') };
  }

  // --- replay protection ---
  // An EIP-3009 authorization is reusable until it lands on chain, so reserve
  // the nonce BEFORE settling. A concurrent replay hits the reservation and is
  // rejected rather than racing us to a second settlement.
  //
  // Keyed on the CAIP-2 network, never on the version-specific label: v1 calls
  // this chain "base-sepolia" and v2 calls it "eip155:84532", so keying on the
  // label would let the same authorization be replayed once per version.
  const nonceKey = `x402:nonce:${requirements.network}:${auth.nonce.toLowerCase()}`;
  const seen = await env.PAYMENTS.get(nonceKey);
  if (seen) {
    return {
      paid: false,
      response: challenge('payment authorization has already been used', null, version),
    };
  }
  await env.PAYMENTS.put(nonceKey, 'reserved', { expirationTtl: 300 });

  const body = { x402Version: version, paymentPayload: payload, paymentRequirements: terms };
  const rail = resolveX402(cfg);
  const url = rail.facilitator_url;

  // Each JWT is bound to one method+host+path by its `uris` claim, so /verify
  // and /settle are signed separately — a token for one is not valid for the
  // other. Rails with auth: "none" get an empty header set from the same call.
  const verifyAuth = await facilitatorHeaders(rail, env, 'POST', `${url.replace(/\/+$/, '')}/verify`);
  if (!verifyAuth.ok) {
    await env.PAYMENTS.delete(nonceKey);
    return { paid: false, response: fail(verifyAuth.code, verifyAuth.error, 503) };
  }

  let verify;
  try {
    verify = await facilitator(url, '/verify', body, verifyAuth.headers);
  } catch (e) {
    await env.PAYMENTS.delete(nonceKey);
    return { paid: false, response: fail('facilitator_unreachable', `payment facilitator did not respond: ${e.name}`, 502) };
  }
  if (!verify.json?.isValid) {
    await env.PAYMENTS.delete(nonceKey);
    return {
      paid: false,
      response: challenge(
        `payment verification failed: ${verify.json?.invalidReason ?? `facilitator HTTP ${verify.status}`}`,
        null, version,
      ),
    };
  }

  const settleAuth = await facilitatorHeaders(rail, env, 'POST', `${url.replace(/\/+$/, '')}/settle`);
  if (!settleAuth.ok) {
    await env.PAYMENTS.delete(nonceKey);
    return { paid: false, response: fail(settleAuth.code, settleAuth.error, 503) };
  }

  let settle;
  try {
    settle = await facilitator(url, '/settle', body, settleAuth.headers);
  } catch (e) {
    await env.PAYMENTS.delete(nonceKey);
    return { paid: false, response: fail('facilitator_unreachable', `payment settlement did not respond: ${e.name}`, 502) };
  }
  const settlement = settle.json ?? { success: false, errorReason: `facilitator HTTP ${settle.status}`, transaction: '', network: requirements.network };
  if (!settlement.success) {
    await env.PAYMENTS.delete(nonceKey);
    return {
      paid: false,
      response: challenge(
        `payment settlement failed: ${settlement.errorReason ?? 'unknown reason'}`,
        settlement, version,
      ),
    };
  }

  // Settled: hold the nonce well past the authorization's validity window.
  const at = new Date().toISOString();
  await env.PAYMENTS.put(nonceKey, JSON.stringify({
    transaction: settlement.transaction ?? '',
    payer: settlement.payer ?? auth.from ?? null,
    at,
  }), { expirationTtl: 60 * 60 * 24 * 30 });

  // Revenue ledger. Deliberately awaited but internally non-throwing: money has
  // already moved, so a bookkeeping failure must not fail the buyer's request.
  await recordSettlement(env, {
    ts: at,
    amount: requirements.amount,
    decimals: rail.asset_decimals,
    asset_name: rail.asset_name,
    network: requirements.network,
    rail: rail.rail,
    resource: resource?.url ?? '',
    transaction: settlement.transaction ?? '',
    payer: settlement.payer ?? auth.from ?? '',
  });

  return { paid: true, settlement, version };
}

/**
 * Attaches the settlement receipt to a paid 200 response, in the header the
 * paying client is listening on: a v1 client reads X-PAYMENT-RESPONSE and would
 * never see a v2 PAYMENT-RESPONSE.
 */
export function attachSettlement(response, settlement, version = X402_VERSION) {
  const headers = new Headers(response.headers);
  headers.set(version === X402_VERSION_V1 ? HDR_V1_RESPONSE : HDR_RESPONSE, b64encode(settlement));
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}

export const __testing = { b64encode, b64decode, sameAddress, sameAmount };

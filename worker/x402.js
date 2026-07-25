// x402 v2 payment gate (HTTP transport).
//
// Spec: coinbase/x402 specs/x402-specification-v2.md + specs/transports-v2/http.md
// Headers (v2 dropped the non-standard X- prefix):
//   PAYMENT-REQUIRED   server -> client   base64(PaymentRequired)
//   PAYMENT-SIGNATURE  client -> server   base64(PaymentPayload)
//   PAYMENT-RESPONSE   server -> client   base64(SettlementResponse)
//
// Trust model: the facilitator verifies signatures, balances and simulates the
// transfer. It does NOT know what we charge, so this module — not the
// facilitator — is what stops a client from paying 1 atomic unit to an address
// of their choosing. Every field of the client's `accepted` block is compared
// against our own requirements before anything is sent onward.

import { resolveX402 } from '../scripts/x402-config.mjs';
import { facilitatorHeaders } from './cdp-auth.js';

const HDR_REQUIRED = 'PAYMENT-REQUIRED';
const HDR_SIGNATURE = 'PAYMENT-SIGNATURE';
const HDR_RESPONSE = 'PAYMENT-RESPONSE';

export const X402_VERSION = 2;

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

function paymentRequiredResponse(requirements, resource, error, settlement) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    [HDR_REQUIRED]: b64encode({ x402Version: X402_VERSION, error, resource, accepts: [requirements] }),
  };
  if (settlement) headers[HDR_RESPONSE] = b64encode(settlement);
  return new Response(JSON.stringify({
    ok: false,
    code: 'payment_required',
    error,
    x402Version: X402_VERSION,
    accepts: [requirements],
    docs: 'https://docs.x402.org',
  }, null, 2) + '\n', { status: 402, headers });
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
 * Gates a request behind an x402 payment.
 *
 * @returns {Promise<{paid: true, settlement: object} | {paid: false, response: Response}>}
 *   On `paid`, the caller must echo `settlement` back in the PAYMENT-RESPONSE
 *   header of its 200 (see attachSettlement).
 */
export async function requirePayment(request, env, cfg, { amountAtomic, resource }) {
  const requirements = paymentRequirements(cfg, amountAtomic);
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

  const raw = request.headers.get(HDR_SIGNATURE);
  if (!raw) {
    return {
      paid: false,
      response: paymentRequiredResponse(requirements, resource, `${HDR_SIGNATURE} header is required`),
    };
  }

  let payload;
  try {
    payload = b64decode(raw);
  } catch {
    return { paid: false, response: fail('bad_payment_payload', `${HDR_SIGNATURE} must be base64-encoded JSON`) };
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { paid: false, response: fail('bad_payment_payload', 'payment payload must be a JSON object') };
  }
  if (payload.x402Version !== X402_VERSION) {
    return { paid: false, response: fail('unsupported_version', `only x402Version ${X402_VERSION} is supported`) };
  }

  // --- the checks the facilitator cannot make for us ---
  const accepted = payload.accepted;
  if (typeof accepted !== 'object' || accepted === null) {
    return { paid: false, response: fail('bad_payment_payload', 'payment payload is missing "accepted"') };
  }
  const mismatch =
    (accepted.scheme !== requirements.scheme && 'scheme')
    || (accepted.network !== requirements.network && 'network')
    || (!sameAddress(accepted.asset, requirements.asset) && 'asset')
    || (!sameAddress(accepted.payTo, requirements.payTo) && 'payTo')
    || (!sameAmount(accepted.amount, requirements.amount) && 'amount');
  if (mismatch) {
    return {
      paid: false,
      response: paymentRequiredResponse(
        requirements, resource,
        `payment "${mismatch}" does not match the required payment terms`,
      ),
    };
  }

  // The authorization is what actually moves funds — check it independently of
  // the `accepted` block the client also controls.
  const auth = payload.payload?.authorization;
  if (typeof auth !== 'object' || auth === null) {
    return { paid: false, response: fail('bad_payment_payload', 'payment payload is missing payload.authorization') };
  }
  if (!sameAddress(auth.to, requirements.payTo) || !sameAmount(auth.value, requirements.amount)) {
    return {
      paid: false,
      response: paymentRequiredResponse(
        requirements, resource,
        'authorization recipient or value does not match the required payment terms',
      ),
    };
  }
  if (typeof auth.nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) {
    return { paid: false, response: fail('bad_payment_payload', 'authorization.nonce must be a 32-byte hex string') };
  }

  // --- replay protection ---
  // An EIP-3009 authorization is reusable until it lands on chain, so reserve
  // the nonce BEFORE settling. A concurrent replay hits the reservation and is
  // rejected rather than racing us to a second settlement.
  const nonceKey = `x402:nonce:${requirements.network}:${auth.nonce.toLowerCase()}`;
  const seen = await env.PAYMENTS.get(nonceKey);
  if (seen) {
    return {
      paid: false,
      response: paymentRequiredResponse(requirements, resource, 'payment authorization has already been used'),
    };
  }
  await env.PAYMENTS.put(nonceKey, 'reserved', { expirationTtl: 300 });

  const body = { x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: requirements };
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
      response: paymentRequiredResponse(
        requirements, resource,
        `payment verification failed: ${verify.json?.invalidReason ?? `facilitator HTTP ${verify.status}`}`,
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
      response: paymentRequiredResponse(
        requirements, resource,
        `payment settlement failed: ${settlement.errorReason ?? 'unknown reason'}`,
        settlement,
      ),
    };
  }

  // Settled: hold the nonce well past the authorization's validity window.
  await env.PAYMENTS.put(nonceKey, JSON.stringify({
    transaction: settlement.transaction ?? '',
    payer: settlement.payer ?? auth.from ?? null,
    at: new Date().toISOString(),
  }), { expirationTtl: 60 * 60 * 24 * 30 });

  return { paid: true, settlement };
}

/** Attaches the settlement receipt to a paid 200 response. */
export function attachSettlement(response, settlement) {
  const headers = new Headers(response.headers);
  headers.set(HDR_RESPONSE, b64encode(settlement));
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}

export const __testing = { b64encode, b64decode, sameAddress, sameAmount };

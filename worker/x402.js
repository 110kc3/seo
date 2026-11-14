
import { resolveX402 } from '../scripts/x402-config.mjs';
import { facilitatorHeaders } from './cdp-auth.js';
import { recordSettlement } from './revenue.js';

const HDR_REQUIRED = 'PAYMENT-REQUIRED';
const HDR_SIGNATURE = 'PAYMENT-SIGNATURE';
const HDR_RESPONSE = 'PAYMENT-RESPONSE';
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

function sameAmount(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!/^\d{1,78}$/.test(a) || !/^\d{1,78}$/.test(b)) return false;
  return BigInt(a) === BigInt(b);
}

export function paymentRequirements(cfg, amountAtomic, resource) {
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
    ...(resource?.outputSchema ? { extensions: { bazaar: { info: resource.outputSchema } } } : {}),
  };
}

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
    ...(resource?.outputSchema ? { outputSchema: resource.outputSchema } : {}),
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

export async function requirePayment(request, env, cfg, { amountAtomic, resource }) {
  const requirements = paymentRequirements(cfg, amountAtomic, resource);
  const requirementsV1 = paymentRequirementsV1(cfg, amountAtomic, resource);
  if (!requirements) {
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

  const auth = payload.payload?.authorization;
  if (typeof auth !== 'object' || auth === null) {
    return { paid: false, response: fail('bad_payment_payload', 'payment payload is missing payload.authorization') };
  }
  if (!sameAddress(auth.to, requirements.payTo) || !sameAmount(auth.value, requirements.amount)) {
    return {
      paid: false,
      response: challenge('authorization recipient or value does not match the required payment terms', null, version),
    };
  }
  if (typeof auth.nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) {
    return { paid: false, response: fail('bad_payment_payload', 'authorization.nonce must be a 32-byte hex string') };
  }

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

  const at = new Date().toISOString();
  await env.PAYMENTS.put(nonceKey, JSON.stringify({
    transaction: settlement.transaction ?? '',
    payer: settlement.payer ?? auth.from ?? null,
    at,
  }), { expirationTtl: 60 * 60 * 24 * 30 });

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

export function attachSettlement(response, settlement, version = X402_VERSION) {
  const headers = new Headers(response.headers);
  headers.set(version === X402_VERSION_V1 ? HDR_V1_RESPONSE : HDR_RESPONSE, b64encode(settlement));
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}

export const __testing = { b64encode, b64decode, sameAddress, sameAmount };

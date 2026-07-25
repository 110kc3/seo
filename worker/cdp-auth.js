// Bearer-JWT authentication for the Coinbase CDP x402 facilitator.
//
// The public x402.org facilitator takes no credentials; CDP's requires a signed
// JWT per request. Rather than pull in @coinbase/x402 (which drags viem, zod
// and the whole CDP SDK into a Worker for one signature), this reproduces the
// contract directly — it is small and fully specified.
//
// Contract, read off the published @coinbase/x402 and @coinbase/cdp-sdk
// sources rather than inferred:
//   header  { alg, kid: <api key id>, typ: "JWT", nonce }
//           alg = "EdDSA" for Ed25519 keys, "ES256" for EC keys
//   claims  { sub: <api key id>, iss: "cdp", nbf, exp, jti,
//             uris: ["<METHOD> <host><path>"] }
// The `uris` claim binds the token to one method+host+path, so a token minted
// for /verify cannot be replayed against /settle.

import { needsCdpAuth } from '../scripts/x402-config.mjs';

const JWT_TTL_SECONDS = 120;

function base64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64(value) {
  const norm = value.replaceAll('-', '+').replaceAll('_', '/');
  const bin = atob(norm.padEnd(Math.ceil(norm.length / 4) * 4, '='));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * CDP hands out two key shapes. Ed25519 (the recommended one) arrives as a
 * base64 64-byte blob: a 32-byte seed followed by its 32-byte public key.
 * EC keys arrive as a PKCS8 PEM.
 */
async function importSigningKey(secret) {
  const trimmed = String(secret).trim();

  if (trimmed.includes('BEGIN')) {
    const der = fromBase64(trimmed.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
    const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    // WebCrypto ECDSA emits raw r||s, which is exactly the JWS ES256 encoding.
    return { key, alg: 'ES256', algorithm: { name: 'ECDSA', hash: 'SHA-256' } };
  }

  const raw = fromBase64(trimmed);
  if (raw.length !== 64) {
    throw new Error(`unrecognised CDP API key secret (${raw.length} bytes; expected a 64-byte Ed25519 secret or a PKCS8 PEM)`);
  }
  const jwk = {
    kty: 'OKP',
    crv: 'Ed25519',
    d: base64url(raw.slice(0, 32)),
    x: base64url(raw.slice(32)),
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
  return { key, alg: 'EdDSA', algorithm: { name: 'Ed25519' } };
}

/** Mints a Bearer JWT scoped to exactly one method + host + path. */
export async function createCdpAuthHeader({ apiKeyId, apiKeySecret, method, host, path, now = Math.floor(Date.now() / 1000) }) {
  const { key, alg, algorithm } = await importSigningKey(apiKeySecret);
  const header = { alg, kid: apiKeyId, typ: 'JWT', nonce: randomHex(16) };
  const claims = {
    sub: apiKeyId,
    iss: 'cdp',
    nbf: now,
    exp: now + JWT_TTL_SECONDS,
    jti: randomHex(16),
    uris: [`${method} ${host}${path}`],
  };

  const encoder = new TextEncoder();
  const signingInput = `${base64url(encoder.encode(JSON.stringify(header)))}.${base64url(encoder.encode(JSON.stringify(claims)))}`;
  const signature = new Uint8Array(await crypto.subtle.sign(algorithm, key, encoder.encode(signingInput)));
  return `Bearer ${signingInput}.${base64url(signature)}`;
}

/**
 * Headers for one facilitator call.
 *
 * A rail that declares `auth: "cdp"` but has no credentials fails closed rather
 * than firing an unauthenticated request and surfacing an opaque 401 as if it
 * were a payment problem.
 *
 * @returns {Promise<{ok: true, headers: object} | {ok: false, code: string, error: string}>}
 */
export async function facilitatorHeaders(rail, env, method, url) {
  if (!needsCdpAuth(rail)) return { ok: true, headers: {} };

  const apiKeyId = env?.CDP_API_KEY_ID;
  const apiKeySecret = env?.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) {
    return {
      ok: false,
      code: 'payments_not_enabled',
      error: 'the configured payment rail needs Coinbase CDP credentials, which are not set on this deployment',
    };
  }

  const { host, pathname } = new URL(url);
  try {
    return {
      ok: true,
      headers: {
        Authorization: await createCdpAuthHeader({ apiKeyId, apiKeySecret, method, host, path: pathname }),
        'Correlation-Context': 'sdk_language=javascript,source=ai-product-index',
      },
    };
  } catch (e) {
    return { ok: false, code: 'payments_misconfigured', error: e.message };
  }
}

export const __testing = { base64url, fromBase64, importSigningKey };

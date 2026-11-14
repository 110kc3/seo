
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

async function importSigningKey(secret) {
  const trimmed = String(secret).trim();

  if (trimmed.includes('BEGIN')) {
    const der = fromBase64(trimmed.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
    const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
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

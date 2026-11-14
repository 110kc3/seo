
export const DIRECTORY_PATH = '/.well-known/http-message-signatures-directory';
export const DIRECTORY_CONTENT_TYPE = 'application/http-message-signatures-directory+json';

const SIGNATURE_LABEL = 'sig1';
const RESPONSE_TAG = 'ai-product-index';
const BOT_TAG = 'web-bot-auth';
const MAX_SIGNED_BYTES = 1024 * 1024;

const b64 = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const b64url = (bytes) => b64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

function fromBase64(value) {
  const norm = String(value).trim().replaceAll('-', '+').replaceAll('_', '/');
  const bin = atob(norm.padEnd(Math.ceil(norm.length / 4) * 4, '='));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function thumbprint(x) {
  const canonical = JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return b64url(new Uint8Array(digest));
}

let cached = null;

export async function signingKey(env) {
  const secret = env?.SIGNING_KEY;
  if (!secret) return null;
  if (cached && cached.secret === secret) return cached.value;

  const raw = fromBase64(secret);
  if (raw.length !== 64) {
    console.error(`SIGNING_KEY is ${raw.length} bytes; expected 64 (seed||publicKey)`);
    return null;
  }
  const d = b64url(raw.slice(0, 32));
  const x = b64url(raw.slice(32));
  const key = await crypto.subtle.importKey(
    'jwk', { kty: 'OKP', crv: 'Ed25519', d, x }, { name: 'Ed25519' }, false, ['sign'],
  );
  const value = { key, kid: await thumbprint(x), x };
  cached = { secret, value };
  return value;
}

export async function keyDirectory(env, { purpose = 'response-integrity' } = {}) {
  const signer = await signingKey(env);
  if (!signer) return null;
  return {
    keys: [{ kid: signer.kid, kty: 'OKP', crv: 'Ed25519', x: signer.x, nbf: 0 }],
    purpose,
  };
}

export async function contentDigest(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha-256=:${b64(new Uint8Array(digest))}:`;
}

export function signatureBase(components, params) {
  const lines = components.map(([id, value]) => `${id}: ${value}`);
  lines.push(`"@signature-params": ${params}`);
  return lines.join('\n');
}

function serialiseParams(componentIds, { created, keyid, tag, expires }) {
  let out = `(${componentIds.join(' ')});created=${created}`;
  if (expires) out += `;expires=${expires}`;
  out += `;keyid="${keyid}";alg="ed25519";tag="${tag}"`;
  return out;
}

export async function signResponse(request, response, env, now = Date.now()) {
  const signer = await signingKey(env);
  if (!signer || !response.body || response.status === 304) return response;

  const buffered = await response.clone().arrayBuffer();
  if (buffered.byteLength > MAX_SIGNED_BYTES) return response;
  const bytes = new Uint8Array(buffered);

  const url = new URL(request.url);
  const digest = await contentDigest(bytes);
  const created = Math.floor(now / 1000);

  const components = [
    ['"@status"', String(response.status)],
    ['"content-digest"', digest],
    ['"@authority";req', url.host],
    ['"@path";req', url.pathname],
  ];
  const params = serialiseParams(components.map(([id]) => id), {
    created, keyid: signer.kid, tag: RESPONSE_TAG,
  });
  const base = signatureBase(components, params);

  const signature = new Uint8Array(
    await crypto.subtle.sign('Ed25519', signer.key, new TextEncoder().encode(base)),
  );

  const headers = new Headers(response.headers);
  headers.set('content-digest', digest);
  headers.set('signature-input', `${SIGNATURE_LABEL}=${params}`);
  headers.set('signature', `${SIGNATURE_LABEL}=:${b64(signature)}:`);
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers });
}

export async function botAuthHeaders(env, method, target, now = Date.now()) {
  const signer = await signingKey(env);
  if (!signer) return {};

  const url = new URL(target);
  const created = Math.floor(now / 1000);
  const components = [
    ['"@method"', method.toUpperCase()],
    ['"@authority"', url.host],
    ['"@path"', url.pathname],
  ];
  const params = serialiseParams(components.map(([id]) => id), {
    created, expires: created + 300, keyid: signer.kid, tag: BOT_TAG,
  });
  const signature = new Uint8Array(
    await crypto.subtle.sign('Ed25519', signer.key, new TextEncoder().encode(signatureBase(components, params))),
  );
  return {
    'signature-input': `${SIGNATURE_LABEL}=${params}`,
    signature: `${SIGNATURE_LABEL}=:${b64(signature)}:`,
  };
}

export const __testing = { thumbprint, serialiseParams, fromBase64, b64url, MAX_SIGNED_BYTES };

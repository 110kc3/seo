// RFC 9421 HTTP Message Signatures — response signing, plus the key directory
// the web-bot-auth profile discovers keys through.
//
// Why: this was the last agent-readiness capability static hosting made
// impossible, and it is the one that lets an agent tell "this JSON came from the
// index" from "this JSON came from whatever was between us". Every response the
// Worker owns carries a Content-Digest and an Ed25519 signature over it.
//
// Two related but distinct uses of the same key, both implemented here:
//
//   signResponse()  — we sign our responses, so a consumer can verify integrity
//                     and origin. Covers @status, content-digest, and the
//                     request's @authority and @path, so a signature cannot be
//                     lifted from one resource onto another.
//   signedFetch()   — we sign our *outbound* audit requests (the web-bot-auth
//                     profile: tag="web-bot-auth" plus a Signature-Agent header),
//                     so a site we audit can verify the fetch really is this
//                     service rather than trust a spoofable user-agent.
//
// Key material: env.SIGNING_KEY is base64 of seed(32) || publicKey(32) — the same
// shape CDP hands out, so one import path serves both. The public half is derived
// from the secret at runtime rather than committed, so the published directory
// and the signing key cannot drift apart. Absent the secret, nothing is signed
// and the directory 404s: no half-configured signing, no misleading headers.
//
// Spec: RFC 9421 (signatures), RFC 9530 (Content-Digest), RFC 7638 (kid is the
// JWK thumbprint), draft-meunier-webbotauth-httpsig-protocol (the directory).

export const DIRECTORY_PATH = '/.well-known/http-message-signatures-directory';
export const DIRECTORY_CONTENT_TYPE = 'application/http-message-signatures-directory+json';

const SIGNATURE_LABEL = 'sig1';
const RESPONSE_TAG = 'ai-product-index';
const BOT_TAG = 'web-bot-auth';
// Signing buffers the body to digest it, so very large responses opt out rather
// than being held in memory.
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

/** RFC 7638 thumbprint: SHA-256 over the canonical JWK, members in lexical order. */
async function thumbprint(x) {
  const canonical = JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return b64url(new Uint8Array(digest));
}

let cached = null;

/**
 * @returns {Promise<{key: CryptoKey, kid: string, x: string}|null>} null when no
 *   signing key is configured, which every caller must treat as "do not sign".
 */
export async function signingKey(env) {
  const secret = env?.SIGNING_KEY;
  if (!secret) return null;
  if (cached && cached.secret === secret) return cached.value;

  const raw = fromBase64(secret);
  if (raw.length !== 64) {
    // A wrong-length key is a configuration error, not a reason to serve
    // unsigned responses silently — but it must not take the site down either.
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

/** The JWKS a verifier fetches to resolve our keyid. */
export async function keyDirectory(env, { purpose = 'response-integrity' } = {}) {
  const signer = await signingKey(env);
  if (!signer) return null;
  return {
    keys: [{ kid: signer.kid, kty: 'OKP', crv: 'Ed25519', x: signer.x, nbf: 0 }],
    purpose,
  };
}

/** RFC 9530 Content-Digest over the exact bytes sent. */
export async function contentDigest(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha-256=:${b64(new Uint8Array(digest))}:`;
}

/**
 * Builds the RFC 9421 signature base.
 *
 * @param {Array<[string, string]>} components  identifier (already including any
 *   parameters, e.g. `"@authority";req`) paired with its value
 * @param {string} params  the serialised signature parameters
 * @returns {string} the exact bytes to sign
 */
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

/**
 * Signs a response in place of the original, adding Content-Digest,
 * Signature-Input and Signature. Returns the response untouched when no key is
 * configured, when the body is absent, or when it is too large to digest.
 *
 * Covering the request's @authority and @path means a signature cannot be lifted
 * off one resource and replayed on another.
 */
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

/**
 * The web-bot-auth profile, for requests *we* make: sign the target's authority
 * and path so the site being audited can verify the fetch is this service.
 *
 * @returns {Promise<Record<string,string>>} headers to add; empty when unkeyed.
 */
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

// Tests for the Cloudflare Worker layer: payment-term enforcement, content
// negotiation, client classification and the audit's input boundary.
//
// These modules are deliberately free of Cloudflare-only globals at import
// time, so they run under plain `node --test`. HTMLRewriter-dependent paths
// (readHead/auditUrl) are exercised with `wrangler dev`, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { classifyUserAgent, classifyPath } from '../worker/classify.js';
import { alternatesFor, negotiate } from '../worker/negotiate.js';
import { paymentRequirements, paymentRequirementsV1, requirePayment, attachSettlement, __testing as x402 } from '../worker/x402.js';
import { parseAuditRequest, __testing as audit } from '../worker/audit.js';
import { __testing as stats } from '../worker/stats.js';
import { resolveX402, needsCdpAuth } from './x402-config.mjs';
import { createCdpAuthHeader, facilitatorHeaders } from '../worker/cdp-auth.js';
import { handleRevenue, authorizeDashboard, sessionCookie, __testing as revenue } from '../worker/revenue.js';
import { __testing as worker } from '../worker/index.js';
import { CHECK_LABELS, letterGrade, snippetFor } from '../worker/audit.js';
import { handleScore, freeView, __testing as score } from '../worker/score.js';
import { signResponse, keyDirectory, botAuthHeaders, signatureBase, contentDigest, signingKey, DIRECTORY_PATH, __testing as sign } from '../worker/signing.js';

const BASE = 'https://index.kc-it.pl';

// --- client classification -------------------------------------------------

test('classifyUserAgent separates AI crawlers from action-taking agents', () => {
  assert.equal(classifyUserAgent('Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)'), 'ai_crawler');
  assert.equal(classifyUserAgent('ClaudeBot/1.0'), 'ai_crawler');
  assert.equal(classifyUserAgent('langchain/0.3.1 python-requests/2.32'), 'ai_agent');
  assert.equal(classifyUserAgent('claude-code/2.0'), 'ai_agent');
  assert.equal(classifyUserAgent('ai-product-index-mcp'), 'own');
  assert.equal(classifyUserAgent('Googlebot/2.1'), 'classic_bot');
  assert.equal(classifyUserAgent('curl/8.5.0'), 'script');
  assert.equal(classifyUserAgent(''), 'unknown');
  assert.equal(classifyUserAgent(undefined), 'unknown');
});

test('classifyUserAgent recognises real browsers but not bare Mozilla claims', () => {
  assert.equal(
    classifyUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
    'browser',
  );
  assert.equal(classifyUserAgent('Mozilla/5.0'), 'other');
});

test('an agent stack embedding a vendor token is counted as an agent, not a crawler', () => {
  // "anthropic-ai" appears in both lists; the agent match must win so SDK
  // traffic is not mistaken for training-corpus crawling.
  assert.equal(classifyUserAgent('anthropic-sdk-python/0.40 anthropic-ai'), 'ai_agent');
});

test('classifyPath buckets paths into a stable set', () => {
  assert.equal(classifyPath('/'), 'home');
  assert.equal(classifyPath('/llms.txt'), 'llms_txt');
  assert.equal(classifyPath('/l/my-product.html'), 'listing_page');
  assert.equal(classifyPath('/listings/my-product.json'), 'listing_json');
  assert.equal(classifyPath('/api/index.json'), 'api');
  assert.equal(classifyPath('/api/audit'), 'audit');
  assert.equal(classifyPath('/api/score'), 'score_free');
  assert.equal(classifyPath('/dashboard'), 'dashboard');
  assert.equal(classifyPath('/dashboard.html'), 'dashboard');
  assert.equal(classifyPath('/nope'), 'other');
});

// --- content negotiation ---------------------------------------------------

test('negotiate serves data representations to agents', () => {
  assert.equal(negotiate('/', 'application/json'), '/api/index.json');
  assert.equal(negotiate('/index.html', 'application/json'), '/api/index.json');
  assert.equal(negotiate('/', 'text/markdown'), '/llms-full.txt');
  assert.equal(negotiate('/l/my-product.html', 'application/json'), '/listings/my-product.json');
});

test('negotiate leaves browsers alone', () => {
  // Chrome sends text/html,application/xhtml+xml,...,*/*;q=0.8 — the presence
  // of text/html must veto the swap or every browser gets raw JSON.
  assert.equal(negotiate('/', 'text/html,application/xhtml+xml,application/json;q=0.9'), null);
  assert.equal(negotiate('/', '*/*'), null);
  assert.equal(negotiate('/', null), null);
  assert.equal(negotiate('/assets/og.png', 'application/json'), null);
});

test('negotiate refuses slugs that are not valid slugs', () => {
  assert.equal(negotiate('/l/-bad-.html', 'application/json'), null);
  assert.equal(negotiate('/l/x.html', 'application/json'), null);
});

test('alternatesFor advertises the machine-readable twin of each path', () => {
  const home = alternatesFor(BASE, '/');
  assert.match(home, /api\/index\.json>; rel="alternate"; type="application\/json"/);
  assert.match(home, /openapi\.yaml>; rel="service-desc"/);

  const listing = alternatesFor(BASE, '/l/my-product.html');
  assert.match(listing, /listings\/my-product\.json/);

  const other = alternatesFor(BASE, '/assets/og.png');
  assert.match(other, /llms\.txt/);
  assert.doesNotMatch(other, /listings\//);
});

// --- x402 payment terms ----------------------------------------------------

const CFG = {
  base: BASE,
  payments: {
    x402_address: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
    x402: {
      active: 'testnet',
      asset_name: 'USDC',
      asset_version: '2',
      max_timeout_seconds: 60,
      audit_price_atomic: '10000',
      verified_tier_price_atomic: '5000000',
      profiles: {
        testnet: {
          facilitator_url: 'https://x402.org/facilitator',
          auth: 'none',
          network: 'eip155:84532',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          rpc_url: 'https://sepolia.base.org',
          min_confirmations: 2,
        },
        // Deliberately blank here — this fixture exists to pin the fail-closed
        // contract for an unverified asset address. The real site.config.json
        // has its own invariants, asserted separately below.
        mainnet: {
          facilitator_url: 'https://x402.org/facilitator',
          auth: 'none',
          network: 'eip155:8453',
          asset: '',
        },
        cdp: {
          facilitator_url: 'https://api.cdp.coinbase.com/platform/v2/x402',
          auth: 'cdp',
          network: 'eip155:8453',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        },
      },
    },
  },
};

const withRail = (name) => ({ ...CFG, payments: { ...CFG.payments, x402: { ...CFG.payments.x402, active: name } } });

test('paymentRequirements fails closed until a receiving address is set', () => {
  assert.equal(paymentRequirements({ payments: {} }, '10000'), null);
  const noAddress = { payments: { ...CFG.payments, x402_address: '' } };
  assert.equal(paymentRequirements(noAddress, '10000'), null);
  assert.equal(paymentRequirements(CFG, undefined), null);
});

test('a rail with an unverified asset address stays disabled', () => {
  // The mainnet profile is intentionally incomplete. Selecting it must disable
  // payments rather than quote a payment against an empty contract address.
  assert.equal(paymentRequirements(withRail('mainnet'), '10000'), null);
  assert.equal(resolveX402(withRail('mainnet')), null);
});

test('resolveX402 selects the active profile and flattens it', () => {
  const testnet = resolveX402(CFG);
  assert.equal(testnet.rail, 'testnet');
  assert.equal(testnet.network, 'eip155:84532');
  assert.equal(testnet.auth, 'none');
  assert.equal(testnet.payTo, CFG.payments.x402_address);
  assert.equal(testnet.audit_price_atomic, '10000');

  const cdp = resolveX402(withRail('cdp'));
  assert.equal(cdp.network, 'eip155:8453');
  assert.ok(needsCdpAuth(cdp));
  assert.ok(!needsCdpAuth(testnet));

  assert.equal(resolveX402({ payments: { x402: { active: 'nope', profiles: {} } } }), null);
});

test('paymentRequirements emits a spec-shaped exact-scheme requirement', () => {
  const req = paymentRequirements(CFG, '10000');
  assert.deepEqual(req, {
    scheme: 'exact',
    network: 'eip155:84532',
    amount: '10000',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    payTo: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
    maxTimeoutSeconds: 60,
    extra: { name: 'USDC', version: '2' },
  });
});

test('a profile overrides the shared EIP-712 asset name', () => {
  // extra.{name,version} is the EIP-712 domain the payer signs
  // transferWithAuthorization against, and it must equal the token contract's
  // own name() on that chain. USDC calls itself "USDC" on Base Sepolia and
  // "USD Coin" on Base mainnet, so this cannot be one shared value.
  const cfg = withRail('cdp');
  cfg.payments.x402.profiles = {
    ...cfg.payments.x402.profiles,
    cdp: { ...cfg.payments.x402.profiles.cdp, asset_name: 'USD Coin' },
  };
  assert.equal(resolveX402(cfg).asset_name, 'USD Coin');
  assert.equal(paymentRequirements(cfg, '10000').extra.name, 'USD Coin');

  // A profile that says nothing still inherits the shared value.
  assert.equal(resolveX402(CFG).asset_name, 'USDC');
});

// Guards the shipped config, not the fixtures: these are the mistakes that
// would only surface as "the facilitator rejects every payment" in production.
test('the real site.config.json rails are internally consistent', async () => {
  const cfg = JSON.parse(await readFile(new URL('../site.config.json', import.meta.url), 'utf8'));
  const x402cfg = cfg.payments.x402;

  for (const [name, profile] of Object.entries(x402cfg.profiles)) {
    if (!profile.asset) continue;   // an incomplete rail is disabled anyway
    assert.match(profile.asset, /^0x[0-9a-fA-F]{40}$/, `${name}.asset is not an address`);

    // Inheriting the EIP-712 name across chains is exactly the bug this guards.
    assert.ok(profile.asset_name, `${name} sets an asset but no explicit asset_name`);

    // The public x402.org facilitator advertises testnet networks only, so a
    // mainnet rail pointed at it fails at settlement — after the payer signed.
    if (profile.network === 'eip155:8453') {
      assert.ok(
        !/^https:\/\/x402\.org\//.test(profile.facilitator_url),
        `${name} is a Base mainnet rail but points at the testnet-only x402.org facilitator`,
      );
    }
  }

  // The rail that is switched on must actually resolve.
  assert.ok(resolveX402(cfg), `the active rail "${x402cfg.active}" does not resolve`);
});

test('amounts compare numerically, not as strings', () => {
  // A client that pads or reformats the amount must still match; a client that
  // shaves it must not.
  assert.ok(x402.sameAmount('10000', '010000'));
  assert.ok(x402.sameAmount('10000', '10000'));
  assert.ok(!x402.sameAmount('9999', '10000'));
  assert.ok(!x402.sameAmount('1e5', '100000'));
  assert.ok(!x402.sameAmount(' 10000', '10000'));
  assert.ok(!x402.sameAmount('-10000', '10000'));
  assert.ok(!x402.sameAmount(10000, '10000'));
});

test('addresses compare case-insensitively (EIP-55 checksums)', () => {
  assert.ok(x402.sameAddress('0xABCdef0000000000000000000000000000000001', '0xabcdef0000000000000000000000000000000001'));
  assert.ok(!x402.sameAddress('0xabcdef0000000000000000000000000000000001', '0xabcdef0000000000000000000000000000000002'));
  assert.ok(!x402.sameAddress(null, '0xabc'));
});

test('payment headers round-trip through base64 JSON', () => {
  const payload = { x402Version: 2, accepted: { scheme: 'exact', amount: '10000' }, note: 'ünïcødé' };
  assert.deepEqual(x402.b64decode(x402.b64encode(payload)), payload);
});

// --- payment gate: every path below rejects before any facilitator call, so
// these run fully offline. A network call escaping the gate would fail loudly.

const NONCE = `0x${'ab'.repeat(32)}`;
const RESOURCE = { url: `${BASE}/api/audit`, mimeType: 'application/json' };

function stubKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(k) { return store.get(k) ?? null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  };
}

function validPayload(overrides = {}) {
  const accepted = { ...paymentRequirements(CFG, '10000'), ...(overrides.accepted ?? {}) };
  return {
    x402Version: 2,
    resource: RESOURCE,
    accepted,
    payload: {
      signature: `0x${'11'.repeat(65)}`,
      authorization: {
        from: '0x857b06519E91e3A54538791bDbb0E22373e36b66',
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: '1740672089',
        validBefore: '1740672154',
        nonce: NONCE,
        ...(overrides.authorization ?? {}),
      },
    },
  };
}

const gate = (payload, { kv = stubKv(), cfg = CFG } = {}) => {
  const headers = payload === undefined ? {} : { 'PAYMENT-SIGNATURE': typeof payload === 'string' ? payload : x402.b64encode(payload) };
  const request = new Request(`${BASE}/api/audit`, { method: 'POST', headers });
  return requirePayment(request, { PAYMENTS: kv }, cfg, { amountAtomic: '10000', resource: RESOURCE });
};

test('an unpaid request answers 402 with machine-readable terms', async () => {
  const res = await gate(undefined);
  assert.equal(res.paid, false);
  assert.equal(res.response.status, 402);

  const required = x402.b64decode(res.response.headers.get('PAYMENT-REQUIRED'));
  assert.equal(required.x402Version, 2);
  assert.equal(required.accepts[0].payTo, CFG.payments.x402_address);
  assert.equal(required.accepts[0].amount, '10000');
  assert.equal(required.resource.url, RESOURCE.url);
});

test('the gate fails closed when no receiving address is configured', async () => {
  const res = await gate(undefined, { cfg: { ...CFG, payments: { ...CFG.payments, x402_address: '' } } });
  assert.equal(res.response.status, 503);
  assert.equal((await res.response.json()).code, 'payments_not_enabled');
});

test('a client cannot choose its own price or recipient', async () => {
  // The facilitator validates signatures, not our pricing — if these got
  // through, one atomic unit to an attacker address would buy an audit.
  for (const overrides of [
    { accepted: { amount: '1' } },
    { accepted: { payTo: '0xdead000000000000000000000000000000000001' } },
    { accepted: { asset: '0xdead000000000000000000000000000000000002' } },
    { accepted: { network: 'eip155:1' } },
    { accepted: { scheme: 'upto' } },
  ]) {
    const res = await gate(validPayload(overrides));
    assert.equal(res.paid, false, `expected rejection for ${JSON.stringify(overrides)}`);
    assert.equal(res.response.status, 402);
  }
});

test('the authorization is checked independently of the accepted block', async () => {
  // A payload whose `accepted` block matches perfectly but whose actual
  // authorization pays someone else, or less.
  const wrongRecipient = await gate(validPayload({ authorization: { to: '0xdead000000000000000000000000000000000001' } }));
  assert.equal(wrongRecipient.paid, false);
  assert.match(await wrongRecipient.response.text(), /authorization recipient or value/);

  const shaved = await gate(validPayload({ authorization: { value: '9999' } }));
  assert.equal(shaved.paid, false);
});

test('a replayed authorization is refused before it reaches the facilitator', async () => {
  const kv = stubKv({ [`x402:nonce:eip155:84532:${NONCE}`]: 'spent' });
  const res = await gate(validPayload(), { kv });
  assert.equal(res.paid, false);
  assert.equal(res.response.status, 402);
  assert.match(await res.response.text(), /already been used/);
});

test('malformed payment payloads are 400, not 402', async () => {
  const notBase64 = await gate('!!!not base64!!!');
  assert.equal(notBase64.response.status, 400);

  const notAnObject = await gate([1, 2, 3]);
  assert.equal(notAnObject.response.status, 400);

  const wrongVersion = await gate({ ...validPayload(), x402Version: 1 });
  assert.equal(wrongVersion.response.status, 400);
  assert.equal((await wrongVersion.response.json()).code, 'unsupported_version');

  const noAuthorization = await gate({ ...validPayload(), payload: {} });
  assert.equal(noAuthorization.response.status, 400);

  const badNonce = await gate(validPayload({ authorization: { nonce: '0x1234' } }));
  assert.equal(badNonce.response.status, 400);
});

// --- x402 v1 compatibility --------------------------------------------------
//
// The reference client (x402-fetch 1.2.0) validates the 402 body against a v1
// schema and throws rather than degrading, so a v2-only endpoint is unpayable by
// it. These tests pin the dual-version behaviour that makes it payable.

// Same fixture, plus the v1 network name that switches v1 on.
const CFG_V1 = {
  ...CFG,
  payments: {
    ...CFG.payments,
    x402: {
      ...CFG.payments.x402,
      profiles: {
        ...CFG.payments.x402.profiles,
        testnet: { ...CFG.payments.x402.profiles.testnet, network_v1: 'base-sepolia' },
      },
    },
  },
};

function validPayloadV1(overrides = {}) {
  const terms = paymentRequirementsV1(CFG_V1, '10000', RESOURCE);
  return {
    x402Version: 1,
    scheme: overrides.scheme ?? terms.scheme,
    network: overrides.network ?? terms.network,
    payload: {
      signature: `0x${'11'.repeat(65)}`,
      authorization: {
        from: '0x857b06519E91e3A54538791bDbb0E22373e36b66',
        to: terms.payTo,
        value: terms.maxAmountRequired,
        validAfter: '1740672089',
        validBefore: '1740672154',
        nonce: NONCE,
        ...(overrides.authorization ?? {}),
      },
    },
  };
}

const gateV1 = (payload, { kv = stubKv(), cfg = CFG_V1 } = {}) => {
  const headers = payload === undefined ? {} : { 'X-PAYMENT': typeof payload === 'string' ? payload : x402.b64encode(payload) };
  const request = new Request(`${BASE}/api/audit`, { method: 'POST', headers });
  return requirePayment(request, { PAYMENTS: kv }, cfg, { amountAtomic: '10000', resource: RESOURCE });
};

test('the v1 challenge uses v1 field names and a network name, not a CAIP-2 id', () => {
  const terms = paymentRequirementsV1(CFG_V1, '10000', RESOURCE);
  assert.equal(terms.network, 'base-sepolia');
  assert.equal(terms.maxAmountRequired, '10000');
  assert.equal(terms.resource, RESOURCE.url);          // a flat URL string in v1
  assert.equal(terms.amount, undefined);               // v2's name must not leak
  assert.deepEqual(terms.extra, { name: 'USDC', version: '2' });

  // No v1 network name configured → v1 is off rather than guessed at.
  assert.equal(paymentRequirementsV1(CFG, '10000', RESOURCE), null);
});

test('one 402 answers both versions: v1 in the body, v2 in the header', async () => {
  const res = await gateV1(undefined);
  assert.equal(res.response.status, 402);

  // A v1 client reads the body, and parses the whole accepts array with its own
  // schema — so it must contain v1 entries only.
  const body = await res.response.json();
  assert.equal(body.x402Version, 1);
  assert.equal(body.accepts.length, 1);
  assert.equal(body.accepts[0].network, 'base-sepolia');
  assert.equal(body.accepts[0].maxAmountRequired, '10000');

  // A v2 client reads the header, which still speaks pure v2.
  const header = x402.b64decode(res.response.headers.get('PAYMENT-REQUIRED'));
  assert.equal(header.x402Version, 2);
  assert.equal(header.accepts[0].network, 'eip155:84532');
  assert.equal(header.accepts[0].amount, '10000');
});

test('a v1 payer cannot redirect or shave the payment', async () => {
  // v1 carries no asset/payTo/amount of its own, so the authorization is the
  // only place a v1 client can lie about money. It is checked directly.
  const wrongRecipient = await gateV1(validPayloadV1({ authorization: { to: '0xdead000000000000000000000000000000000001' } }));
  assert.equal(wrongRecipient.paid, false);
  assert.match(await wrongRecipient.response.text(), /authorization recipient or value/);

  const shaved = await gateV1(validPayloadV1({ authorization: { value: '9999' } }));
  assert.equal(shaved.paid, false);

  for (const overrides of [{ network: 'base' }, { scheme: 'upto' }]) {
    const res = await gateV1(validPayloadV1(overrides));
    assert.equal(res.paid, false, `expected rejection for ${JSON.stringify(overrides)}`);
    assert.equal(res.response.status, 402);
  }
});

test('replay protection spans both versions for the same chain', async () => {
  // v1 calls this chain "base-sepolia" and v2 "eip155:84532". Keying the spent
  // nonce on the version's own label would let one authorization be replayed
  // once per version, so both must collide on the CAIP-2 key.
  const key = `x402:nonce:eip155:84532:${NONCE}`;
  const v1 = await gateV1(validPayloadV1(), { kv: stubKv({ [key]: 'spent' }) });
  assert.match(await v1.response.text(), /already been used/);

  const v2 = await gate(validPayload(), { kv: stubKv({ [key]: 'spent' }) });
  assert.match(await v2.response.text(), /already been used/);
});

test('each version is answered in the header it listens on', () => {
  const settlement = { success: true, transaction: `0x${'cd'.repeat(32)}`, network: 'base-sepolia' };
  const v1 = attachSettlement(new Response('{}'), settlement, 1);
  assert.ok(v1.headers.get('X-PAYMENT-RESPONSE'));
  assert.equal(v1.headers.get('PAYMENT-RESPONSE'), null);

  const v2 = attachSettlement(new Response('{}'), settlement, 2);
  assert.ok(v2.headers.get('PAYMENT-RESPONSE'));
  assert.equal(v2.headers.get('X-PAYMENT-RESPONSE'), null);
});

test('a version-mismatched payload is refused rather than coerced', async () => {
  // v2 content in the v1 header, and vice versa.
  const v2InV1Header = await gateV1({ ...validPayloadV1(), x402Version: 2 });
  assert.equal(v2InV1Header.response.status, 400);
  assert.equal((await v2InV1Header.response.json()).code, 'unsupported_version');

  const v1InV2Header = await gate({ ...validPayload(), x402Version: 1 }, { cfg: CFG_V1 });
  assert.equal(v1InV2Header.response.status, 400);
  assert.equal((await v1InV2Header.response.json()).code, 'unsupported_version');
});

test('X-PAYMENT is ignored on a rail that does not offer v1', async () => {
  // CFG has no network_v1, so a v1 payload must not be honoured by accident —
  // it gets the challenge, not a free audit.
  const res = await gateV1(validPayloadV1(), { cfg: CFG });
  assert.equal(res.paid, false);
  assert.equal(res.response.status, 402);
  const body = await res.response.json();
  assert.equal(body.x402Version, 2);
});

// --- RFC 9421 response signing ----------------------------------------------

// A real keypair, so signatures are verified rather than merely present.
async function signingEnv() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const fromB64url = (v) => Buffer.from(v.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
  const blob = Buffer.concat([fromB64url(priv.d), fromB64url(pub.x)]);
  assert.equal(blob.length, 64, 'seed||publicKey');
  return { env: { SIGNING_KEY: blob.toString('base64') }, verifyKey: pair.publicKey, x: pub.x };
}

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

test('a signed response verifies against the published key', async () => {
  const { env, verifyKey, x } = await signingEnv();
  const request = new Request(`${BASE}/api/index.json`);
  const signed = await signResponse(request, new Response('{"count":2}', { status: 200 }), env, 1_800_000_000_000);

  const digest = signed.headers.get('content-digest');
  const input = signed.headers.get('signature-input');
  const sig = signed.headers.get('signature');
  assert.ok(digest && input && sig, 'all three headers must be present');
  assert.match(digest, /^sha-256=:[A-Za-z0-9+/]+=*:$/);

  // The digest must be over exactly the bytes that ship, or verification of the
  // body is meaningless.
  const body = await signed.clone().arrayBuffer();
  assert.equal(digest, await contentDigest(new Uint8Array(body)));

  // Rebuild the base the way a verifier would, from the headers alone.
  const params = input.replace(/^sig1=/, '');
  const base = signatureBase([
    ['"@status"', '200'],
    ['"content-digest"', digest],
    ['"@authority";req', 'index.kc-it.pl'],
    ['"@path";req', '/api/index.json'],
  ], params);

  const raw = sig.replace(/^sig1=:/, '').replace(/:$/, '');
  assert.match(raw, B64_RE);
  const ok = await crypto.subtle.verify(
    'Ed25519', verifyKey, Buffer.from(raw, 'base64'), new TextEncoder().encode(base),
  );
  assert.ok(ok, 'the signature must verify over the reconstructed base');

  // keyid must be the thumbprint a verifier computes from the directory entry.
  const directory = await keyDirectory(env);
  assert.equal(directory.keys[0].x, x);
  assert.match(input, new RegExp(`keyid="${directory.keys[0].kid.replace(/[+/]/g, '\\$&')}"`));
  assert.match(input, /alg="ed25519"/);
  assert.match(input, /created=1800000000/);
});

test('a signature cannot be lifted onto another resource', async () => {
  // @authority and @path are covered, so the same body signed for one path does
  // not verify as the other — otherwise a cached signature would authenticate
  // any endpoint.
  const { env, verifyKey } = await signingEnv();
  const signed = await signResponse(new Request(`${BASE}/api/index.json`), new Response('{}'), env);
  const digest = signed.headers.get('content-digest');
  const params = signed.headers.get('signature-input').replace(/^sig1=/, '');
  const raw = signed.headers.get('signature').replace(/^sig1=:/, '').replace(/:$/, '');

  const wrongPath = signatureBase([
    ['"@status"', '200'],
    ['"content-digest"', digest],
    ['"@authority";req', 'index.kc-it.pl'],
    ['"@path";req', '/api/revenue.json'],
  ], params);
  assert.equal(
    await crypto.subtle.verify('Ed25519', verifyKey, Buffer.from(raw, 'base64'), new TextEncoder().encode(wrongPath)),
    false,
  );
});

test('without a key, nothing is signed and the directory is absent', async () => {
  const plain = await signResponse(new Request(`${BASE}/`), new Response('hi'), {});
  assert.equal(plain.headers.get('signature'), null);
  assert.equal(plain.headers.get('content-digest'), null);
  assert.equal(await keyDirectory({}), null);
  assert.equal(await signingKey({}), null);

  // A malformed key must not produce a bogus signature either.
  assert.equal(await signingKey({ SIGNING_KEY: 'dG9vLXNob3J0' }), null);
  assert.equal((await signResponse(new Request(`${BASE}/`), new Response('hi'), { SIGNING_KEY: 'dG9vLXNob3J0' })).headers.get('signature'), null);
  assert.deepEqual(await botAuthHeaders({}, 'GET', 'https://example.com/'), {});
});

test('outbound audit requests are signed under the web-bot-auth profile', async () => {
  const { env, verifyKey } = await signingEnv();
  const headers = await botAuthHeaders(env, 'get', 'https://customer.example/llms.txt', 1_800_000_000_000);
  const params = headers['signature-input'].replace(/^sig1=/, '');

  assert.match(params, /tag="web-bot-auth"/);
  assert.match(params, /expires=1800000300/, 'a request signature must expire');
  assert.match(params, /^\("@method" "@authority" "@path"\)/);

  const base = signatureBase([
    ['"@method"', 'GET'],
    ['"@authority"', 'customer.example'],
    ['"@path"', '/llms.txt'],
  ], params);
  const raw = headers.signature.replace(/^sig1=:/, '').replace(/:$/, '');
  assert.ok(await crypto.subtle.verify('Ed25519', verifyKey, Buffer.from(raw, 'base64'), new TextEncoder().encode(base)));
});

test('the key directory is shaped the way verifiers expect', async () => {
  const { env, x } = await signingEnv();
  const dir = await keyDirectory(env);
  assert.deepEqual(Object.keys(dir).sort(), ['keys', 'purpose']);
  const key = dir.keys[0];
  assert.equal(key.kty, 'OKP');
  assert.equal(key.crv, 'Ed25519');
  assert.equal(key.x, x);
  assert.ok(key.kid.length > 20, 'kid is the RFC 7638 thumbprint');
  assert.ok(!('d' in key), 'the private half must never be published');
  assert.equal(DIRECTORY_PATH, '/.well-known/http-message-signatures-directory');

  // The thumbprint must be over the canonical JWK, members in lexical order.
  assert.equal(key.kid, await sign.thumbprint(x));
});

// --- free score / paid fixes boundary ---------------------------------------

const FULL_RESULT = {
  ok: true,
  url: 'https://example.com/',
  audited_at: '2026-07-25T00:00:00.000Z',
  score: 62,
  max_score: 100,
  letter: 'D',
  grade: 'partially readable',
  passed: 8,
  total_checks: 13,
  checks: [
    { id: 'llms_txt', label: 'llms.txt published', weight: 15, pass: false, detail: 'HTTP 404', fix: 'Publish /llms.txt …', snippet: '# /llms.txt …' },
    { id: 'https', label: 'served over HTTPS', weight: 5, pass: true, detail: 'served over https' },
  ],
  next_steps: [{ check: 'llms_txt', label: 'llms.txt published', weight: 15, fix: 'Publish …', snippet: '# …' }],
};

test('the free view withholds exactly what the paid audit sells', () => {
  const view = freeView(FULL_RESULT, { what: 'more' });

  // Kept: the verdict, and the name of every check.
  assert.equal(view.letter, 'D');
  assert.equal(view.score, 62);
  assert.equal(view.tier, 'free');
  assert.equal(view.checks.length, 2);
  assert.equal(view.checks[0].label, 'llms.txt published');
  assert.equal(view.checks[0].pass, false);

  // Withheld: everything actionable.
  const serialised = JSON.stringify(view);
  for (const leaked of ['detail', 'fix', 'snippet', 'next_steps', 'HTTP 404']) {
    assert.ok(!serialised.includes(leaked), `free tier leaked "${leaked}"`);
  }
});

test('the free view whitelists fields, so a new paid field cannot leak by omission', () => {
  const withNewSecret = {
    ...FULL_RESULT,
    competitor_analysis: 'a future paid field',
    checks: [{ ...FULL_RESULT.checks[0], remediation_cost: '$$$' }],
  };
  const serialised = JSON.stringify(freeView(withNewSecret, {}));
  assert.ok(!serialised.includes('competitor_analysis'));
  assert.ok(!serialised.includes('remediation_cost'));
});

test('letterGrade bands cover A to F with no gaps', () => {
  assert.equal(letterGrade(100), 'A');
  assert.equal(letterGrade(90), 'A');
  assert.equal(letterGrade(89), 'B');
  assert.equal(letterGrade(80), 'B');
  assert.equal(letterGrade(70), 'C');
  assert.equal(letterGrade(60), 'D');
  assert.equal(letterGrade(45), 'E');
  assert.equal(letterGrade(44), 'F');
  assert.equal(letterGrade(0), 'F');
  // Every score maps to something.
  for (let n = 0; n <= 100; n += 1) assert.match(letterGrade(n), /^[A-F]$/);
});

test('every check has a label, and every fixable one a snippet for the right origin', () => {
  const ids = Object.keys(CHECK_LABELS);
  assert.equal(ids.length, 13, 'a label per check');
  for (const id of ids) assert.ok(CHECK_LABELS[id].length > 3, `${id} needs a readable label`);

  const snippet = snippetFor('llms_txt', 'https://customer.example/');
  assert.match(snippet, /customer\.example/);
  assert.ok(!snippet.includes('{{ORIGIN}}'), 'placeholder must be substituted');
  assert.ok(!snippet.includes('customer.example//'), 'trailing slash must not double up');

  // https is a server-config fix with nothing to paste; that is allowed.
  assert.equal(snippetFor('https', 'https://x.example'), null);
  assert.equal(snippetFor('nonexistent_check', 'https://x.example'), null);
});

test('auditing our own hostname goes through ASSETS, not the network', () => {
  // A Worker cannot fetch its own hostname: Cloudflare answers 522 on the custom
  // domain and the workers.dev one alike, so auditing our own site — the
  // showcase, and the first URL anyone tries — failed outright.
  const assets = { fetch() { return new Response('x'); } };
  const req = new Request('https://index.kc-it.pl/api/score?url=x');

  assert.ok(score.fetcherFor(req, { ASSETS: assets }, 'https://index.kc-it.pl/'),
    'same host must be served from the binding');
  assert.equal(score.fetcherFor(req, { ASSETS: assets }, 'https://example.com/'), undefined,
    'a third-party host must use the real network');

  // Matching on the request host, not a configured base, covers every hostname
  // this deployment answers on.
  const wd = new Request('https://ai-product-index.110kc3.workers.dev/api/score?url=x');
  assert.ok(score.fetcherFor(wd, { ASSETS: assets }, 'https://ai-product-index.110kc3.workers.dev/x'));
  assert.equal(score.fetcherFor(wd, { ASSETS: assets }, 'https://index.kc-it.pl/'), undefined);

  // No binding (bare Node tests) must degrade to the default fetcher.
  assert.equal(score.fetcherFor(req, {}, 'https://index.kc-it.pl/'), undefined);
});

test('the free score refuses the same targets the paid one does', async () => {
  const cfg = { base: BASE, payments: CFG.payments };
  const call = (qs) => handleScore(new Request(`${BASE}/api/score${qs}`), {}, cfg, resolveX402(cfg));

  assert.equal((await call('')).status, 400);                                  // no url
  assert.equal((await call('?url=http://127.0.0.1/')).status, 400);            // loopback
  assert.equal((await call('?url=http://169.254.169.254/')).status, 400);      // cloud metadata
  assert.equal((await call('?url=file:///etc/passwd')).status, 400);           // wrong scheme
  assert.equal((await call('?url=not-a-url')).status, 400);

  const body = await (await call('')).json();
  assert.equal(body.code, 'missing_url');
  assert.match(body.example, /\/api\/score\?url=/);
});

test('the upsell names a real price from the active rail', () => {
  const up = score.upsellFor(BASE, resolveX402(CFG));
  assert.equal(up.price, '0.01 USDC');       // 10000 atomic at 6 decimals in the fixture
  assert.match(up.endpoint, /\/api\/audit$/);
  assert.match(up.terms, /\/api\/x402\/info$/);

  // An unconfigured rail must not invent a price.
  assert.equal(score.upsellFor(BASE, null).price, null);
});

test('the free score is rate limited per IP, and cache hits are not', async () => {
  const store = new Map();
  const kv = {
    async get(k) { return store.get(k) ?? null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  };
  const cfg = { base: BASE, payments: CFG.payments };
  // Pre-seed the per-IP counter at the limit and the cache for one URL.
  const hour = new Date().toISOString().slice(0, 13);
  store.set(`${score.RATE_PREFIX}9.9.9.9:${hour}`, String(score.RATE_LIMIT_PER_HOUR));
  store.set(`${score.CACHE_PREFIX}https://cached.example/`, JSON.stringify({ ok: true, letter: 'B', tier: 'free' }));

  const call = (target) => handleScore(
    new Request(`${BASE}/api/score?url=${encodeURIComponent(target)}`, { headers: { 'cf-connecting-ip': '9.9.9.9' } }),
    { PAYMENTS: kv }, cfg, resolveX402(cfg),
  );

  // A fresh URL from a spent IP is refused before any outbound fetch.
  const limited = await call('https://fresh.example/');
  assert.equal(limited.status, 429);
  const limitedBody = await limited.json();
  assert.equal(limitedBody.code, 'rate_limited');
  assert.ok(limitedBody.unlock, 'a refusal should still point at the paid endpoint');

  // The cached URL still answers, because serving it costs us nothing.
  const cached = await call('https://cached.example/');
  assert.equal(cached.status, 200);
  const cachedBody = await cached.json();
  assert.equal(cachedBody.cached, true);
  assert.equal(cachedBody.letter, 'B');
});

// --- asset redirect absorption ----------------------------------------------

test('an ASSETS .html redirect is absorbed, not passed through', async () => {
  // Workers Assets answers /foo.html with a 307 to /foo. Returning that verbatim
  // made every published listing URL a redirect, and made the dashboard redirect
  // to itself forever — it fetched /dashboard.html and handed back the 307 to
  // /dashboard, which is the same request again.
  const seen = [];
  const env = {
    ASSETS: {
      async fetch(req) {
        const path = new URL(req.url).pathname;
        seen.push(path);
        if (path.endsWith('.html')) {
          return new Response(null, { status: 307, headers: { location: path.replace(/\.html$/, '') } });
        }
        return new Response(`content of ${path}`, { status: 200 });
      },
    },
  };

  const req = new Request(`${BASE}/l/my-product.html`);
  const resp = await worker.fetchAsset(env, req, new URL(`${BASE}/l/my-product.html`));
  assert.equal(resp.status, 200, 'the caller must get content, not a redirect');
  assert.equal(await resp.text(), 'content of /l/my-product');
  assert.deepEqual(seen, ['/l/my-product.html', '/l/my-product']);
});

test('absorbing a redirect follows exactly one hop', async () => {
  // A binding that always redirects must not spin.
  let calls = 0;
  const env = {
    ASSETS: {
      async fetch() {
        calls += 1;
        return new Response(null, { status: 307, headers: { location: '/loop' } });
      },
    },
  };
  const resp = await worker.fetchAsset(env, new Request(`${BASE}/loop`), new URL(`${BASE}/loop`));
  assert.equal(calls, 2, 'one hop only');
  assert.equal(resp.status, 307, 'and the caller sees the unresolved redirect rather than hanging');
});

test('a non-redirect asset response is returned untouched', async () => {
  const env = { ASSETS: { async fetch() { return new Response('ok', { status: 200 }); } } };
  const resp = await worker.fetchAsset(env, new Request(`${BASE}/`), new URL(`${BASE}/`));
  assert.equal(resp.status, 200);
  assert.equal(await resp.text(), 'ok');

  // A redirect with no Location cannot be followed; pass it through.
  const noLoc = { ASSETS: { async fetch() { return new Response(null, { status: 307 }); } } };
  assert.equal((await worker.fetchAsset(noLoc, new Request(`${BASE}/x`), new URL(`${BASE}/x`))).status, 307);
});

// --- audit scoring ----------------------------------------------------------

test('a fully passing audit scores exactly 100, whatever the weights are', () => {
  // The weights are relative importance, chosen by hand, and they summed to 105
  // — so a fully agent-ready site was reported as `score: 105` out of a declared
  // `max_score: 100`. Normalising means this holds no matter how they are
  // reweighted or how many checks are added.
  const weights = [15, 5, 5, 5, 10, 8, 15, 7, 7, 5, 8, 10, 5];
  assert.equal(weights.reduce((a, b) => a + b), 105, 'fixture mirrors the shipped weights');

  const all = (pass) => weights.map((weight, i) => ({ id: `c${i}`, weight, pass }));
  assert.equal(audit.scoreChecks(all(true)).score, 100);
  assert.equal(audit.scoreChecks(all(true)).grade, 'agent-ready');
  assert.equal(audit.scoreChecks(all(false)).score, 0);
  assert.equal(audit.scoreChecks(all(false)).grade, 'invisible to agents');

  // Unequal weights still land inside the band they describe.
  const half = weights.map((weight, i) => ({ id: `c${i}`, weight, pass: i % 2 === 0 }));
  const { score } = audit.scoreChecks(half);
  assert.ok(score > 0 && score < 100, `expected a partial score, got ${score}`);

  // An empty set must not divide by zero.
  assert.equal(audit.scoreChecks([]).score, 0);
});

// --- CDP facilitator authentication ----------------------------------------

const decodeJwtPart = (part) =>
  JSON.parse(Buffer.from(part.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8'));

// A CDP Ed25519 secret is base64 of seed(32) || publicKey(32). Generate a real
// keypair so the signature path is genuinely exercised, not stubbed.
async function ed25519Secret() {
  const { subtle } = globalThis.crypto;
  const pair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', pair.privateKey);
  const b64urlToBytes = (s) => Buffer.from(s.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
  return Buffer.concat([b64urlToBytes(jwk.d), b64urlToBytes(jwk.x)]).toString('base64');
}

test('CDP JWT carries the documented header and claims (EdDSA)', async () => {
  const apiKeySecret = await ed25519Secret();
  const header = await createCdpAuthHeader({
    apiKeyId: 'key-abc',
    apiKeySecret,
    method: 'POST',
    host: 'api.cdp.coinbase.com',
    path: '/platform/v2/x402/verify',
    now: 1_800_000_000,
  });

  assert.match(header, /^Bearer /);
  const [h, c, sig] = header.slice('Bearer '.length).split('.');
  assert.ok(sig.length > 0);

  const decodedHeader = decodeJwtPart(h);
  assert.equal(decodedHeader.alg, 'EdDSA');
  assert.equal(decodedHeader.kid, 'key-abc');
  assert.equal(decodedHeader.typ, 'JWT');
  assert.ok(decodedHeader.nonce);

  const claims = decodeJwtPart(c);
  assert.equal(claims.sub, 'key-abc');
  assert.equal(claims.iss, 'cdp');
  assert.equal(claims.nbf, 1_800_000_000);
  assert.ok(claims.exp > claims.nbf);
  assert.ok(claims.jti);
  // The uris claim binds the token to one route — a /verify token must not be
  // usable against /settle.
  assert.deepEqual(claims.uris, ['POST api.cdp.coinbase.com/platform/v2/x402/verify']);
});

test('CDP JWT signs with ES256 when given a PKCS8 PEM', async () => {
  const { subtle } = globalThis.crypto;
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;

  const header = await createCdpAuthHeader({
    apiKeyId: 'ec-key', apiKeySecret: pem, method: 'POST', host: 'api.cdp.coinbase.com', path: '/platform/v2/x402/settle',
  });
  const decoded = decodeJwtPart(header.slice('Bearer '.length).split('.')[0]);
  assert.equal(decoded.alg, 'ES256');
  assert.equal(decoded.kid, 'ec-key');
});

test('each JWT is unique even for identical requests', async () => {
  const apiKeySecret = await ed25519Secret();
  const args = { apiKeyId: 'k', apiKeySecret, method: 'POST', host: 'h', path: '/p', now: 1_800_000_000 };
  const [a, b] = await Promise.all([createCdpAuthHeader(args), createCdpAuthHeader(args)]);
  assert.notEqual(a, b, 'nonce and jti must be freshly random per token');
});

test('an unrecognised key secret is rejected rather than signed with garbage', async () => {
  await assert.rejects(
    () => createCdpAuthHeader({ apiKeyId: 'k', apiKeySecret: 'dG9vLXNob3J0', method: 'POST', host: 'h', path: '/p' }),
    /unrecognised CDP API key secret/,
  );
});

test('facilitatorHeaders sends nothing for an unauthenticated rail', async () => {
  const res = await facilitatorHeaders(resolveX402(CFG), {}, 'POST', 'https://x402.org/facilitator/verify');
  assert.deepEqual(res, { ok: true, headers: {} });
});

test('a CDP rail without credentials fails closed instead of firing unauthenticated', async () => {
  // Otherwise Coinbase's 401 would surface to the agent as if its payment were
  // bad, when the real fault is a missing deployment secret.
  const res = await facilitatorHeaders(resolveX402(withRail('cdp')), {}, 'POST', 'https://api.cdp.coinbase.com/platform/v2/x402/verify');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'payments_not_enabled');
});

test('a CDP rail with credentials produces an Authorization header', async () => {
  const env = { CDP_API_KEY_ID: 'key-abc', CDP_API_KEY_SECRET: await ed25519Secret() };
  const res = await facilitatorHeaders(resolveX402(withRail('cdp')), env, 'POST', 'https://api.cdp.coinbase.com/platform/v2/x402/settle');
  assert.equal(res.ok, true);
  assert.match(res.headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  const claims = decodeJwtPart(res.headers.Authorization.slice('Bearer '.length).split('.')[1]);
  assert.deepEqual(claims.uris, ['POST api.cdp.coinbase.com/platform/v2/x402/settle']);
});

// --- audit input boundary --------------------------------------------------

test('parseAuditRequest rejects everything that is not a public http(s) URL', () => {
  // Same boundary the registry uses for submitted listing URLs — an audit
  // target is attacker-chosen, so this is the SSRF gate.
  for (const bad of [
    'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/',
    'http://localhost/', 'http://box.local/', 'http://svc.internal/',
    'file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)',
    'not-a-url', '', 'https://nodothost/',
  ]) {
    const res = parseAuditRequest({ url: bad });
    assert.ok(res.error, `expected rejection for ${JSON.stringify(bad)}`);
    assert.equal(res.url, undefined);
  }
});

test('parseAuditRequest accepts a normal public URL', () => {
  assert.deepEqual(parseAuditRequest({ url: 'https://example.com/docs' }), { url: 'https://example.com/docs' });
});

test('parseAuditRequest rejects non-object bodies', () => {
  for (const bad of [null, [], 'https://example.com', 42]) {
    assert.ok(parseAuditRequest(bad).error);
  }
});

// --- robots.txt interpretation ---------------------------------------------

test('robotsBlocksAgent respects group scoping', () => {
  const robots = `
User-agent: *
Disallow: /

User-agent: GPTBot
Allow: /
`;
  // The specific Allow block overrides the wildcard Disallow.
  assert.equal(audit.robotsBlocksAgent(robots, 'GPTBot'), false);
  assert.equal(audit.robotsBlocksAgent(robots, 'ClaudeBot'), true);
});

test('robotsBlocksAgent detects a targeted block', () => {
  const robots = `
User-agent: *
Allow: /

User-agent: CCBot
Disallow: /
`;
  assert.equal(audit.robotsBlocksAgent(robots, 'CCBot'), true);
  assert.equal(audit.robotsBlocksAgent(robots, 'GPTBot'), false);
});

test('robotsBlocksAgent ignores comments and a permissive default', () => {
  assert.equal(audit.robotsBlocksAgent('# nothing here\nUser-agent: *\nAllow: /\n', 'GPTBot'), false);
  assert.equal(audit.robotsBlocksAgent('', 'GPTBot'), false);
});

// --- llms.txt + JSON-LD shape ----------------------------------------------

test('llmsTxtShape requires an H1 and a following blockquote summary', () => {
  assert.deepEqual(audit.llmsTxtShape('# Title\n\n> Summary line\n'), { hasH1: true, hasSummary: true });
  assert.deepEqual(audit.llmsTxtShape('# Title\n\nno summary\n'), { hasH1: true, hasSummary: false });
  assert.deepEqual(audit.llmsTxtShape('just text\n'), { hasH1: false, hasSummary: false });
  // A blockquote above the H1 is not the spec's summary slot.
  assert.equal(audit.llmsTxtShape('> stray\n\n# Title\n').hasSummary, false);
});

test('parseJsonLd keeps only schema.org nodes and survives broken blocks', () => {
  const res = audit.parseJsonLd([
    '{"@context":"https://schema.org","@type":"Organization","name":"X"}',
    '[{"@context":"https://schema.org","@type":"WebSite"}]',
    '{"@context":"https://example.org","@type":"Thing"}',
    '{ broken',
  ]);
  assert.equal(res.schemaOrg.length, 2);
  assert.equal(res.errors.length, 1);
});

// --- revenue ledger --------------------------------------------------------

test('formatAmount converts atomic units without floating point', () => {
  assert.equal(revenue.formatAmount('50000', 6), '0.05');
  assert.equal(revenue.formatAmount('1', 6), '0.000001');
  assert.equal(revenue.formatAmount('1000000', 6), '1');
  assert.equal(revenue.formatAmount('1500000', 6), '1.5');
  assert.equal(revenue.formatAmount('0', 6), '0');
  // Beyond 2^53 — the exact reason this is string/BigInt work, not arithmetic.
  assert.equal(revenue.formatAmount('123456789012345678901', 6), '123456789012345.678901');
  assert.equal(revenue.formatAmount(undefined, 6), '0');
});

const ledgerRow = (over = {}) => ({
  ts: '2026-07-20T10:00:00.000Z',
  amount: '50000',
  decimals: 6,
  asset_name: 'USDC',
  network: 'eip155:84532',
  rail: 'testnet',
  resource: 'https://index.kc-it.pl/api/audit',
  transaction: `0x${'a'.repeat(64)}`,
  payer: '0x857b06519E91e3A54538791bDbb0E22373e36b66',
  ...over,
});

test('summarise totals, buckets and de-duplicates payers', () => {
  const out = revenue.summarise([
    ledgerRow(),
    ledgerRow({ ts: '2026-07-20T12:00:00.000Z', amount: '50000' }),
    ledgerRow({ ts: '2026-07-21T09:00:00.000Z', amount: '5000000', resource: 'https://index.kc-it.pl/upgrade', payer: '0xOTHER' }),
  ]);

  assert.equal(out.total, '5.1');
  assert.equal(out.settlements, 3);
  // Same payer twice on day one, a different one on day two.
  assert.equal(out.unique_payers, 2);
  assert.equal(out.by_day.length, 2);
  assert.deepEqual(out.by_day.map((d) => d.date), ['2026-07-20', '2026-07-21']);
  assert.equal(out.by_day[0].amount, '0.1');
  assert.equal(out.by_day[0].count, 2);
  // Endpoints rank by value, not by name or insertion order.
  assert.equal(out.by_resource[0].resource, 'https://index.kc-it.pl/upgrade');
  // Most recent first.
  assert.equal(out.recent[0].ts, '2026-07-21T09:00:00.000Z');
  assert.equal(out.last_payment_at, '2026-07-21T09:00:00.000Z');
});

test('summarise survives an empty ledger without dividing by zero', () => {
  const out = revenue.summarise([]);
  assert.equal(out.total, '0');
  assert.equal(out.settlements, 0);
  assert.equal(out.unique_payers, 0);
  assert.equal(out.average, '0');
  assert.equal(out.last_payment_at, null);
  assert.deepEqual(out.by_day, []);
  assert.deepEqual(out.recent, []);
});

test('summarise skips malformed amounts rather than throwing', () => {
  const out = revenue.summarise([ledgerRow(), ledgerRow({ amount: 'not-a-number' })]);
  assert.equal(out.total, '0.05');
});

test('revenue feed fails closed when no dashboard token is configured', async () => {
  const res = await handleRevenue(new Request(`${BASE}/api/revenue.json`), {}, null);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'dashboard_not_enabled');
});

test('revenue feed rejects a missing or wrong bearer token', async () => {
  const env = { DASHBOARD_TOKEN: 'sekret', PAYMENTS: { list: async () => ({ keys: [] }) } };

  const none = await handleRevenue(new Request(`${BASE}/api/revenue.json`), env, null);
  assert.equal(none.status, 401);
  assert.match(none.headers.get('www-authenticate'), /Bearer/);

  const wrong = await handleRevenue(
    new Request(`${BASE}/api/revenue.json`, { headers: { authorization: 'Bearer nope' } }), env, null);
  assert.equal(wrong.status, 401);
});

test('revenue feed returns the ledger for a valid token', async () => {
  const env = {
    DASHBOARD_TOKEN: 'sekret',
    // Records live in KV *metadata*, so one list() call returns them all.
    PAYMENTS: { list: async () => ({ keys: [{ name: 'revenue:x', metadata: ledgerRow() }], list_complete: true }) },
  };
  const res = await handleRevenue(
    new Request(`${BASE}/api/revenue.json`, { headers: { authorization: 'Bearer sekret' } }),
    env,
    resolveX402(CFG),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.total, '0.05');
  assert.equal(body.rail.name, 'testnet');
  // Base Sepolia is not mainnet, so the dashboard must not call it live money.
  assert.equal(body.rail.live, false);
});

test('the token may also arrive as a query parameter', async () => {
  const env = { DASHBOARD_TOKEN: 'sekret', PAYMENTS: { list: async () => ({ keys: [] }) } };
  const res = await handleRevenue(new Request(`${BASE}/api/revenue.json?token=sekret`), env, null);
  assert.equal(res.status, 200);
});

// --- dashboard privacy -----------------------------------------------------

const dashEnv = { DASHBOARD_TOKEN: 'sekret' };
const dashReq = (init) => new Request(`${BASE}/dashboard.html`, init);

test('authorizeDashboard reports disabled when no token is configured', () => {
  assert.equal(authorizeDashboard(dashReq(), {}).state, 'disabled');
});

test('authorizeDashboard denies an anonymous request', () => {
  assert.equal(authorizeDashboard(dashReq(), dashEnv).state, 'denied');
  assert.equal(authorizeDashboard(dashReq({ headers: { authorization: 'Bearer wrong' } }), dashEnv).state, 'denied');
  assert.equal(authorizeDashboard(new Request(`${BASE}/dashboard.html?token=wrong`), dashEnv).state, 'denied');
  assert.equal(authorizeDashboard(dashReq({ headers: { cookie: 'aipi_dash=wrong' } }), dashEnv).state, 'denied');
});

test('authorizeDashboard accepts cookie, bearer and query, and flags the query case', () => {
  assert.deepEqual(authorizeDashboard(dashReq({ headers: { cookie: 'aipi_dash=sekret' } }), dashEnv), { state: 'ok', viaQuery: false });
  assert.deepEqual(authorizeDashboard(dashReq({ headers: { authorization: 'Bearer sekret' } }), dashEnv), { state: 'ok', viaQuery: false });
  // viaQuery drives the one-time cookie handoff that gets the token out of the URL.
  assert.deepEqual(authorizeDashboard(new Request(`${BASE}/dashboard.html?token=sekret`), dashEnv), { state: 'ok', viaQuery: true });
});

test('the cookie is found among other cookies, and is not confused by prefixes', () => {
  assert.equal(revenue.cookieValue(dashReq({ headers: { cookie: 'a=1; aipi_dash=sekret; b=2' } }), 'aipi_dash'), 'sekret');
  assert.equal(revenue.cookieValue(dashReq({ headers: { cookie: 'aipi_dash_other=sekret' } }), 'aipi_dash'), null);
  assert.equal(revenue.cookieValue(dashReq(), 'aipi_dash'), null);
});

test('token comparison is length-independent and exact', () => {
  assert.ok(revenue.tokensMatch('abc', 'abc'));
  assert.ok(!revenue.tokensMatch('abc', 'abd'));
  assert.ok(!revenue.tokensMatch('abc', 'abcd'));
  assert.ok(!revenue.tokensMatch('', ''.padEnd(1)));
  assert.ok(!revenue.tokensMatch(undefined, 'abc'));
});

test('sessionCookie is HttpOnly, Secure and SameSite=Strict', () => {
  const c = sessionCookie('sekret');
  // HttpOnly keeps the token out of page JavaScript entirely; Strict stops it
  // riding any cross-site request.
  assert.match(c, /^aipi_dash=sekret;/);
  assert.match(c, /HttpOnly/);
  assert.match(c, /Secure/);
  assert.match(c, /SameSite=Strict/);
});

// --- stats shaping ---------------------------------------------------------

test('stats shaping computes the agent share the migration exists to measure', () => {
  const body = stats.shape([
    { client_type: 'ai_agent', path_bucket: 'llms_txt', requests: '30' },
    { client_type: 'ai_crawler', path_bucket: 'home', requests: '20' },
    { client_type: 'browser', path_bucket: 'home', requests: '50' },
  ]);
  assert.equal(body.total_requests, 100);
  assert.equal(body.agent_share, 0.5);
  assert.deepEqual(Object.keys(body.by_client_type), ['browser', 'ai_agent', 'ai_crawler']);
});

test('stats shaping handles an empty dataset without dividing by zero', () => {
  const body = stats.shape([]);
  assert.equal(body.total_requests, 0);
  assert.equal(body.agent_share, 0);
});

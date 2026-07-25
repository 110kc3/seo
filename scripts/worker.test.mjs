// Tests for the Cloudflare Worker layer: payment-term enforcement, content
// negotiation, client classification and the audit's input boundary.
//
// These modules are deliberately free of Cloudflare-only globals at import
// time, so they run under plain `node --test`. HTMLRewriter-dependent paths
// (readHead/auditUrl) are exercised with `wrangler dev`, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyUserAgent, classifyPath } from '../worker/classify.js';
import { alternatesFor, negotiate } from '../worker/negotiate.js';
import { paymentRequirements, requirePayment, __testing as x402 } from '../worker/x402.js';
import { parseAuditRequest, __testing as audit } from '../worker/audit.js';
import { __testing as stats } from '../worker/stats.js';
import { resolveX402, needsCdpAuth } from './x402-config.mjs';
import { createCdpAuthHeader, facilitatorHeaders } from '../worker/cdp-auth.js';
import { handleRevenue, __testing as revenue } from '../worker/revenue.js';

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
        // Ships deliberately blank: the mainnet USDC contract must be verified
        // against a block explorer, never recalled from memory.
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

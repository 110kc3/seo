// Tests for the Cloudflare Worker layer: payment-term enforcement, content
// negotiation, client classification and the audit's input boundary.
//
// These modules are deliberately free of Cloudflare-only globals at import
// time, so they run under plain `node --test`. HTMLRewriter-dependent paths
// (readHead/auditUrl) are exercised with `wrangler dev`, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import { classifyUserAgent, classifyPath } from '../worker/classify.js';
import { alternatesFor, negotiate, alternateContentType } from '../worker/negotiate.js';
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
import { handleBadge, badgeSvg, __testing as badge } from '../worker/badge.js';
import { searchListings, handleSearch, handleAsk, handleMcp, handleCatalogSearch, mcpTools, __testing as discovery } from '../worker/discovery.js';
import cfgFile from '../site.config.json' with { type: 'json' };

// Derived from the shipped config, not hardcoded: these tests pin "artifacts
// match the config", and pinning a literal hostname instead turned all of them
// red on the percall.dev migration without catching anything real.
const BASE = cfgFile.base.replace(/\/+$/, '');

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
  assert.equal(classifyPath('/.well-known/agent.json'), 'agent_card');
  assert.equal(classifyPath('/.well-known/http-message-signatures-directory'), 'sig_directory');
  assert.equal(classifyPath('/badge.svg'), 'badge');
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

test('a negotiated markdown twin is labelled text/markdown, not text/plain', () => {
  // The asset binding types by extension, so /llms-full.txt goes out as
  // text/plain. Answering a request for text/markdown with text/plain is a
  // failed negotiation as far as any agent (or auditor) can tell — it cost this
  // site 9 points on agentswelcome.dev while the *body* was already correct.
  assert.equal(alternateContentType('/llms-full.txt'), 'text/markdown; charset=utf-8');
  // JSON twins already carry the right type from the binding; leave them alone.
  assert.equal(alternateContentType('/api/index.json'), null);
  assert.equal(alternateContentType('/listings/my-product.json'), null);
});

test('audit targets on our own alias hosts are canonicalized before fetching', () => {
  // A Worker cannot fetch its own hostnames, and both aliases 308 anyway. A
  // paid audit of the pre-migration domain settled and then 502'd — this is
  // the regression test for that five-cent lesson.
  assert.equal(score.canonicalTarget('https://percall.dev/x?y=1', cfgFile), `${BASE}/x?y=1`);
  assert.equal(score.canonicalTarget('https://index.kc-it.pl/', cfgFile), `${BASE}/`);
  assert.equal(score.canonicalTarget('https://example.com/', cfgFile), 'https://example.com/');
  // The alias list must never contain the canonical host itself, or the
  // rewrite would be a no-op loop hiding a misconfigured base.
  assert.ok(!(cfgFile.host_aliases ?? []).includes(new URL(cfgFile.base).host));
});

test('non-canonical hosts 308 to the canonical host, path and query intact', () => {
  // 308, not 301: the paid endpoint is a POST, and a 301 lets clients degrade
  // the replayed request to GET. The old hostname stays attached forever, so
  // every URL published before the percall.dev migration keeps resolving.
  const moved = worker.canonicalRedirect(new URL('https://index.kc-it.pl/api/audit?x=1'));
  assert.equal(moved.status, 308);
  assert.equal(moved.headers.get('location'), `${BASE}/api/audit?x=1`);
  assert.equal(worker.canonicalRedirect(new URL(`${BASE}/llms.txt`)), null);
});

test('decorate relabels only the negotiated response, and sends both agent headers', async () => {
  const url = new URL(`${BASE}/`);
  const asset = () => new Response('# llms\n', { status: 200, headers: { 'content-type': 'text/plain' } });

  const swapped = worker.decorate(asset(), url, '/llms-full.txt');
  assert.equal(swapped.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(swapped.headers.get('vary'), 'Accept');
  // X-Agent-Protocol is what existing clients were told to read; X-Agent-Welcome
  // is the name auditors look for. Removing either is a regression.
  assert.equal(swapped.headers.get('x-agent-protocol'), `${BASE}/llms.txt`);
  assert.equal(swapped.headers.get('x-agent-welcome'), `${BASE}/llms.txt`);

  // No negotiation happened: the binding's own type stands.
  const plain = worker.decorate(asset(), url, null);
  assert.equal(plain.headers.get('content-type'), 'text/plain');

  // A 404 for a missing twin must not be dressed up as markdown.
  const missing = worker.decorate(new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } }), url, '/llms-full.txt');
  assert.equal(missing.headers.get('content-type'), 'text/html');
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

// The CDP facilitator builds a Bazaar listing out of whatever discovery
// metadata rides along with the settlement, and nothing else. Dropping these
// fields would not fail a payment — it would silently un-list the endpoint,
// which is the sort of regression only an explicit test catches.
test('discovery metadata rides along in both versions, and only when declared', () => {
  const described = { ...RESOURCE, outputSchema: { input: { type: 'http', method: 'POST', discoverable: true } } };

  const v1 = paymentRequirementsV1(CFG_V1, '10000', described);
  assert.deepEqual(v1.outputSchema, described.outputSchema);
  assert.equal(v1.outputSchema.input.discoverable, true);

  // v2 carries the same thing under the name CDP reads for v2.
  const v2 = paymentRequirements(CFG_V1, '10000', described);
  assert.deepEqual(v2.extensions, { bazaar: { info: described.outputSchema } });

  // Undeclared means absent from the wire, not present-and-null: a caller that
  // publishes no schema publishes exactly what it did before.
  assert.ok(!('outputSchema' in paymentRequirementsV1(CFG_V1, '10000', RESOURCE)));
  assert.ok(!('extensions' in paymentRequirements(CFG_V1, '10000', RESOURCE)));
});

test('the audit endpoint declares itself discoverable, with its real request shape', () => {
  const schema = worker.AUDIT_SCHEMA;

  assert.equal(schema.input.discoverable, true, 'without this the endpoint is never catalogued');
  assert.equal(schema.input.method, 'POST');
  assert.equal(schema.input.bodyType, 'json');
  // The documented request field must be the one parseAuditRequest actually reads.
  assert.equal(schema.input.body.url.required, true);
  assert.deepEqual(Object.keys(schema.input.body), ['url']);
  assert.equal(parseAuditRequest({ url: 'https://example.com' }).error, undefined);
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

// --- what the deploy publishes ----------------------------------------------

test('no source directory is published as a static asset by accident', async () => {
  // The asset directory is the repo root and .assetsignore is a denylist, so
  // *anything* added at the top level ships publicly unless someone remembers to
  // exclude it. That has now bitten three times — DEPLOY.md/ARCHITECTURE.md, the
  // .wrangler state directory, and clients/ — so the expectation is pinned here
  // rather than left to memory. Adding a file at the repo root should fail this
  // test until it is deliberately classified.
  const root = new URL('../', import.meta.url);
  const entries = (await readdir(root, { withFileTypes: true })).map((e) => e.name).sort();
  const ignored = new Set(
    (await readFile(new URL('../.assetsignore', import.meta.url), 'utf8'))
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      // Entries are anchored (`/docs`); the names read off disk are not.
      .map((l) => l.replace(/^\//, '')),
  );

  // Everything here is site content on purpose.
  const published = new Set([
    '404.html', 'api', 'assets', 'dashboard.html', 'health.json', 'index.html',
    'l', 'listings', 'llms-full.txt', 'llms.txt', 'openapi.yaml', 'robots.txt',
    // Published for the same reason health.json is: the registry's own state
    // about its listings should be inspectable by whoever it describes.
    'scores.json', 'sitemap.xml', '.well-known',
    // Discovery surfaces. Static on purpose: a feed and a search description
    // that need the Worker awake are worse than ones the CDN can serve cold.
    'feed.xml', 'feed.json', 'opensearch.xml',
  ]);

  const unclassified = entries.filter((e) => !ignored.has(e) && !published.has(e));
  assert.deepEqual(unclassified, [],
    `add these to .assetsignore, or to the published list in this test: ${unclassified.join(', ')}`);
});

test('the stdio server offers exactly the Worker tools plus register_product', async () => {
  // These two servers answer the same clients, so a tool present on one and
  // absent from the other means the answer depends on which one a client
  // happened to reach. That is what had happened: the Worker grew to six tools
  // while mcp/server.mjs still declared three, invisibly, for a whole release.
  // The stdio server now imports these definitions rather than restating them,
  // so this test is really asserting that nobody has reintroduced a second copy.
  const { TOOLS, HOSTED_TOOLS } = await import('../mcp/server.mjs');
  assert.deepEqual(HOSTED_TOOLS.map((t) => t.name), mcpTools(BASE).map((t) => t.name));

  // register_product is the one deliberate difference, and only ever an
  // addition: it needs a GitHub token, which the public Worker must not carry.
  const extra = TOOLS.map((t) => t.name).filter((n) => !mcpTools(BASE).some((t) => t.name === n));
  assert.deepEqual(extra, ['register_product']);

  // Every tool a client can list must be one it can actually call.
  for (const t of TOOLS) {
    assert.equal(typeof t.description, 'string', `${t.name} has no description`);
    assert.equal(t.inputSchema?.type, 'object', `${t.name} has no object inputSchema`);
  }
});

test('no .assetsignore pattern silently excludes a nested published file', async () => {
  // The test above guards one direction — nothing ships by accident. This guards
  // the other, which is the one that actually bit: an unanchored gitignore
  // pattern matches at EVERY depth, so the `mcp` line written for the top-level
  // `mcp/` directory also excluded `api/mcp/`. The catalog was committed, the
  // build was current, the tests passed, the deploy said Success — and
  // /api/mcp/search answered 503 in production because the files were never
  // uploaded. Nothing in CI could see it, so the rule is pinned here instead.
  const root = new URL('../', import.meta.url);
  const unanchored = (await readFile(new URL('../.assetsignore', import.meta.url), 'utf8'))
    .split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('/'));

  // Every directory and file name below the trees the site actually serves.
  const names = new Set();
  const walk = async (rel) => {
    for (const e of await readdir(new URL(rel, root), { withFileTypes: true })) {
      names.add(e.name);
      if (e.isDirectory()) await walk(`${rel}${e.name}/`);
    }
  };
  for (const dir of ['api/', 'assets/', 'l/', 'listings/', '.well-known/']) await walk(dir);

  // node_modules is unanchored on purpose and must never appear in a served tree.
  const collisions = unanchored.filter((p) => names.has(p));
  assert.deepEqual(collisions, [],
    `these .assetsignore patterns also match published files nested under api/, l/, `
    + `listings/, assets/ or .well-known/ — anchor them with a leading slash: ${collisions.join(', ')}`);
});

// --- the well-known surfaces the build generates ------------------------------

const wellKnown = (name) => readFile(new URL(`../.well-known/${name}`, import.meta.url), 'utf8');

test('every published skill matches the digest the index claims for it', async () => {
  // The index publishes a sha256 of each skill body, and a client is entitled to
  // check it. A stale digest is worse than a missing index: it looks like
  // tampering. This is exactly the failure a hand-maintained index would hit the
  // first time someone edited a SKILL.md, which is why the build computes it.
  const { createHash } = await import('node:crypto');
  const index = JSON.parse(await wellKnown('agent-skills/index.json'));

  assert.ok(index.skills.length > 0, 'the skills index is empty');
  assert.match(index.$schema, /schemas\.agentskills\.io/);

  for (const skill of index.skills) {
    assert.match(skill.name, /^[a-z0-9-]{1,64}$/, `${skill.name} is not a legal skill name`);
    assert.ok(['skill-md', 'archive'].includes(skill.type), `${skill.name} has type ${skill.type}`);
    assert.ok(skill.description.length <= 1024, `${skill.name} description exceeds 1024 chars`);

    const body = await readFile(new URL(`..${skill.url}`, import.meta.url), 'utf8');
    const digest = `sha256:${createHash('sha256').update(body).digest('hex')}`;
    assert.equal(skill.digest, digest, `${skill.name}: index digest does not match the published file`);

    // A skill promising something the site does not serve is the same failure
    // as a manifest advertising a route the router lacks.
    assert.doesNotMatch(body, /\{\{/, `${skill.name} shipped with an unfilled placeholder`);
  }
});

test('the A2A card is served at both the 1.0 path and the pre-0.3 one', async () => {
  // A2A 1.0 puts the card at /.well-known/agent-card.json and a compliant 1.0
  // client will never look at /.well-known/agent.json — but most cards in the
  // wild are still at the old path, so clients written against it are real too.
  // Serving one and not the other means being invisible to one generation.
  const current = await wellKnown('agent-card.json');
  const legacy = await wellKnown('agent.json');

  // Byte-identical because they come from one template. If these ever diverge,
  // the two paths are describing different agents to different clients.
  assert.equal(current, legacy, 'the two agent card paths have drifted apart');
  assert.ok(JSON.parse(current).name, 'the agent card has no name');
});

test('the MCP server card is served at both paths the specs disagree on', async () => {
  // SEP-2127 says /.well-known/mcp.json; Cloudflare's agent-readiness check
  // reads /.well-known/mcp/server-card.json. Neither is wrong, so serve both.
  const sep = await wellKnown('mcp.json');
  const cloudflare = await wellKnown('mcp/server-card.json');

  assert.equal(sep, cloudflare, 'the two MCP card paths have drifted apart');
  assert.ok(JSON.parse(sep), 'the MCP server card is not valid JSON');
});

test('agents.json advertises only interfaces this site actually serves', async () => {
  // The PLURAL agents.json is a different spec from the A2A card at
  // /.well-known/agent.json, and both are published. Auditors read this one for
  // the site's machine-readable interfaces; three separate checks do nothing but
  // look at what it advertises, so an advertisement that is not backed by a real
  // endpoint is worse than a missing file.
  const raw = await wellKnown('agents.json');
  assert.doesNotMatch(raw, /\{\{/, 'an unfilled {{PLACEHOLDER}} survived the build');
  const manifest = JSON.parse(raw);

  assert.equal(manifest.interfaces.json_api, `${BASE}/api/index.json`);
  assert.equal(manifest.interfaces.webmcp, `${BASE}/`);
  // The 1.0 path, not the pre-0.3 one. Both files are served, but what we
  // *advertise* should be the location the current spec sends clients to.
  assert.equal(manifest.interfaces.agent_card, `${BASE}/.well-known/agent-card.json`);
  // Honest only because worker/signing.js really does sign every response and
  // really does publish keys at that path. If signing is ever removed, this
  // advertisement must go with it.
  assert.equal(manifest.interfaces.web_bot_auth, `${BASE}${DIRECTORY_PATH}`);
  assert.equal(manifest.identity.signature_directory, `${BASE}${DIRECTORY_PATH}`);
  assert.equal(manifest.web_bot_auth.signature_directory, `${BASE}${DIRECTORY_PATH}`);
  assert.match(manifest.identity.contact, /^mailto:/);

  // The in-page WebMCP tools named here are the ones templates/index.html
  // registers on navigator.modelContext.
  const home = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const tool of manifest.webmcp.tools) {
    assert.match(home, new RegExp(`name: '${tool.name}'`), `agents.json advertises a WebMCP tool the page does not register: ${tool.name}`);
  }
});

test('security.txt is a valid, unexpired RFC 9116 file', async () => {
  const raw = await wellKnown('security.txt');
  assert.match(raw, /^Contact: mailto:.+@.+$/m);
  assert.match(raw, new RegExp(`^Canonical: ${BASE}/\\.well-known/security\\.txt$`, 'm'));

  const expires = raw.match(/^Expires: (.+)$/m);
  assert.ok(expires, 'RFC 9116 requires exactly one Expires field');
  // Deliberate tripwire. The date is hardcoded because the build must stay a
  // pure function of its inputs, which means nothing renews it — so the test
  // fails *before* the site starts serving an expired security contact.
  assert.ok(new Date(expires[1]).getTime() > Date.now(),
    'security.txt has expired — bump Expires in templates/security.txt and rebuild');
});

// --- README badge -----------------------------------------------------------

const LISTINGS = [
  { slug: 'my-product', name: 'My Product', tier: 'free' },
  { slug: 'paid-thing', name: 'Paid Thing', tier: 'featured' },
];
const SCORES = { 'my-product': { letter: 'B', score: 84 } };
const callBadge = (qs) => handleBadge(new URL(`${BASE}/badge.svg${qs}`), LISTINGS, SCORES);

test('the badge reflects the listing tier', async () => {
  const free = await callBadge('?slug=my-product').text();
  assert.match(free, /<text[^>]*>indexed<\/text>/);
  assert.match(free, /AI Agent Ready/);

  const featured = await callBadge('?slug=paid-thing').text();
  assert.match(featured, /featured/);
  assert.match(featured, new RegExp(badge.COLOURS.featured));

  // Slugs are matched case-insensitively; a README should not break on caps.
  assert.match(await callBadge('?slug=MY-PRODUCT').text(), /indexed/);
});

test('the score badge shows a stored grade, never an audit', async () => {
  const scored = await callBadge('?slug=my-product&show=score');
  const svg = await scored.text();
  assert.match(svg, /B · 84\/100/);
  assert.match(svg, new RegExp(badge.GRADE_COLOURS.B));
  assert.match(svg, /Agent Readability/, 'the score badge gets its own default label');

  // A listing the weekly run has not reached yet must say so rather than imply
  // an F, and must not be cached as long as a real grade.
  const unscored = await callBadge('?slug=paid-thing&show=score');
  assert.match(await unscored.text(), /not scored yet/);
  assert.match(unscored.headers.get('cache-control'), /max-age=900/);

  // Without show=score it stays the tier badge.
  assert.match(await callBadge('?slug=my-product').text(), /indexed/);
});

test('a badge request never answers with a broken image', async () => {
  // Every one of these arrives from an <img> in someone else's README, where a
  // 4xx renders as a broken icon and reflects on them. Say it in the badge.
  for (const [qs, expected] of [
    ['', /pass \?slug=/],
    ['?slug=', /pass \?slug=/],
    ['?slug=does-not-exist', /not indexed/],
  ]) {
    const resp = await callBadge(qs);
    assert.equal(resp.status, 200, `${qs} must still be a 200 image`);
    assert.equal(resp.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
    assert.match(await resp.text(), expected);
  }

  // A real listing caches for longer than a miss.
  const hit = await callBadge('?slug=my-product');
  assert.match(hit.headers.get('cache-control'), /max-age=3600/);
});

test('badge text is escaped and cannot inject markup', async () => {
  const evil = '"><script>alert(1)</script>';
  const svg = badgeSvg(evil, 'x', '#000');
  assert.ok(!svg.includes('<script>'), 'raw markup must not survive');
  assert.match(svg, /&lt;script&gt;/);

  // The label is caller-controlled via ?label=, so the same holds end to end.
  const viaQuery = await handleBadge(new URL(`${BASE}/badge.svg?slug=my-product&label=${encodeURIComponent(evil)}`), LISTINGS).text();
  assert.ok(!viaQuery.includes('<script>'));
});

test('badge geometry leaves room for its text', () => {
  // Too-narrow pills clip glyphs; the estimate must never undershoot.
  for (const text of ['A', 'indexed', 'AI Agent Ready', 'WWWWWWWWWW', 'iiiiiiiiii']) {
    const svg = badgeSvg('AI Agent Ready', text, '#000');
    const width = Number(svg.match(/width="(\d+)"/)[1]);
    assert.ok(width >= badge.textWidth('AI Agent Ready') + badge.textWidth(text) + 36,
      `${text} needs more room`);
  }
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
    ['"@authority";req', new URL(BASE).host],
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

test('a self-audit can see the routes the Worker generates, not just its files', async () => {
  // The ASSETS binding serves committed files and nothing else, so a same-host
  // audit was blind to every route generated at request time — and reported us
  // as lacking web-bot-auth while the key directory answered 200 to everyone
  // else. A self-audit understating its own site is the one direction of error
  // nobody thinks to check, so it is pinned here.
  const { DIRECTORY_PATH } = await import('../worker/signing.js');
  const keyed = await signingEnv();
  const assets = { fetch() { return new Response('not found', { status: 404 }); } };
  const env = { ...keyed.env, ASSETS: assets };
  const req = new Request('https://index.percall.dev/api/score?url=x');
  const fetcher = score.fetcherFor(req, env, 'https://index.percall.dev/');

  const directory = await fetcher(`https://index.percall.dev${DIRECTORY_PATH}`);
  assert.equal(directory.status, 200, 'the key directory 404d in a self-audit');
  assert.ok((await directory.json()).keys?.length, 'the directory served no keys');

  // Everything else goes through the asset layer, so a missing file is still a
  // 404 rather than being invented.
  assert.equal((await fetcher('https://index.percall.dev/llms.txt')).status, 404);

  // An unkeyed deployment genuinely has no directory, and must say so rather
  // than serving the literal string "null" with a 200 — which would report
  // web-bot-auth as present on a site that cannot sign anything.
  const unkeyed = score.fetcherFor(req, { ASSETS: assets }, 'https://index.percall.dev/');
  assert.equal((await unkeyed(`https://index.percall.dev${DIRECTORY_PATH}`)).status, 404);
});

test('a self-audit sees content negotiation, not the committed bytes', async () => {
  // The other half of the same blind spot, and the one that survived the first
  // fix. `markdown_negotiation` is decided entirely by the header layer: the
  // Accept branch picks a different body and `alternateContentType()` relabels
  // it, because the asset store types .txt as text/plain. Neither runs in the
  // ASSETS binding, so a self-audit saw raw HTML and reported the signal absent
  // while `curl -H 'accept: text/markdown'` returned text/markdown to everyone
  // else. Unscored that was cosmetic; under v2 it costs three points, and the
  // only site the audit is wrong about is our own.
  //
  // Fixed by routing through the same serveStatic() the public branch uses, so
  // this asserts against the real negotiation rules rather than a copy.
  const served = {};
  const assets = {
    fetch(req) {
      const p = new URL(req.url).pathname;
      served.last = p;
      const isMd = p.endsWith('.txt');
      return new Response(isMd ? '# llms\n' : '<html></html>', {
        status: 200,
        headers: { 'content-type': isMd ? 'text/plain' : 'text/html' },
      });
    },
  };
  const req = new Request('https://index.percall.dev/api/score?url=x');
  const fetcher = score.fetcherFor(req, { ASSETS: assets }, 'https://index.percall.dev/');

  const md = await fetcher('https://index.percall.dev/', { headers: { accept: 'text/markdown' } });
  // `/` negotiates to /llms-full.txt — asserted against what negotiate() really
  // does rather than what this test first assumed, which is the point of not
  // reimplementing the rules here.
  assert.equal(served.last, '/llms-full.txt', 'Accept: text/markdown did not swap the body');
  assert.match(md.headers.get('content-type') ?? '', /markdown/,
    'the negotiated body went out labelled as the asset store typed it');

  // A plain request is untouched: negotiation must not leak into the default.
  const html = await fetcher('https://index.percall.dev/');
  assert.equal(served.last, '/');
  assert.match(html.headers.get('content-type') ?? '', /html/);

  // And the header layer ran at all, which is what makes the Link-based checks
  // measurable in a self-audit too.
  assert.ok(html.headers.get('link'), 'no Link header — the header layer did not run');
  assert.ok(html.headers.get('x-agent-welcome'));
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
  // The check set is part of the cache identity — the same URL has two different
  // correct grades, and serving one to a caller who asked for the other would be
  // wrong in a way nothing downstream could detect.
  store.set(`${score.CACHE_PREFIX}v2:https://cached.example/`, JSON.stringify({ ok: true, letter: 'B', tier: 'free' }));

  const call = (target, checks) => handleScore(
    new Request(`${BASE}/api/score?url=${encodeURIComponent(target)}${checks ? `&checks=${checks}` : ''}`, { headers: { 'cf-connecting-ip': '9.9.9.9' } }),
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

  // Same URL, other check set: must NOT be served the v2 entry. It falls through
  // to a fresh audit, which this spent IP is rate limited out of — a 429 here is
  // proof the cache did not answer, and is the cheapest way to observe it
  // without a network call.
  const otherSet = await call('https://cached.example/', 'v1');
  assert.equal(otherSet.status, 429, 'a v1 request was served the cached v2 grade');
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
  const resp = await worker.fetchAsset(env, new URL(`${BASE}/l/my-product.html`), req.headers);
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
  const resp = await worker.fetchAsset(env, new URL(`${BASE}/loop`), new Headers());
  assert.equal(calls, 2, 'one hop only');
  assert.equal(resp.status, 307, 'and the caller sees the unresolved redirect rather than hanging');
});

test('a non-redirect asset response is returned untouched', async () => {
  const env = { ASSETS: { async fetch() { return new Response('ok', { status: 200 }); } } };
  const resp = await worker.fetchAsset(env, new URL(`${BASE}/`), new Headers());
  assert.equal(resp.status, 200);
  assert.equal(await resp.text(), 'ok');

  // A redirect with no Location cannot be followed; pass it through.
  const noLoc = { ASSETS: { async fetch() { return new Response(null, { status: 307 }); } } };
  assert.equal((await worker.fetchAsset(noLoc, new URL(`${BASE}/x`), new Headers())).status, 307);
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

test('a raw signal is weightless, so promotion is always explicit', async () => {
  // Under v1 the signals must not move a grade at all, and under v2 they move it
  // only through the V2_WEIGHTS table. Keeping the `signal()` factory weightless
  // is what makes that true: a signal cannot acquire weight by being added to
  // the list, only by being named in the table, so "which checklist scores this"
  // has exactly one answer and it is greppable.
  const { contentSignalsIn, __testing: a } = await import('../worker/audit.js');
  const weights = [15, 5, 5, 5, 10, 8, 15, 7, 7, 5, 8, 10, 5];
  const checks = weights.map((weight, i) => ({ id: `c${i}`, weight, pass: true }));
  const before = a.scoreChecks(checks).score;

  // Signals carry no weight at all, so they cannot contribute to either side of
  // the ratio even if someone passes them in by mistake.
  const signals = [
    a.signal('content_signals', 'x', false, 'absent', 'add it'),
    a.signal('api_catalog', 'y', true, 'present'),
  ];
  assert.ok(signals.every((s) => s.weight === undefined), 'a signal grew a weight');
  assert.equal(a.scoreChecks([...checks, ...signals]).score, before);

  // A present signal carries no fix; an absent one does. That asymmetry is what
  // keeps the paid audit's advice list free of noise about things you have.
  assert.equal(signals[1].fix, undefined);
  assert.equal(signals[0].fix, 'add it');
  void contentSignalsIn;
});

test('no v2 weight may outrank a 2025 check', async () => {
  // The rule that keeps the extended checklist honest. Under 15% of the web
  // publishes an MCP server card or an API catalog, so missing one is normal
  // rather than negligent — and it must never cost a site more than missing
  // llms.txt. Encoded as an assertion because it is the kind of judgement that
  // erodes silently the next time someone feels strongly about a new spec.
  const { __testing: a } = await import('../worker/audit.js');
  const LOWEST_V1_WEIGHT = 5; // `https`
  for (const [id, weight] of Object.entries(a.V2_WEIGHTS)) {
    assert.ok(weight > 0, `${id} would be promoted to a scored check worth nothing`);
    assert.ok(weight < LOWEST_V1_WEIGHT, `${id} at ${weight} outranks the cheapest 2025 check`);
  }
});

test('v2 costs a 2025-perfect site exactly the weight it did not earn', async () => {
  // The number this decision turns on, pinned so it cannot drift unnoticed: a
  // site that passes all thirteen 2025 checks and publishes none of the seven
  // 2026 surfaces scores 105/122 — an A that becomes a B. If a weight changes,
  // this test is where the consequence shows up, in grades rather than points.
  const { __testing: a } = await import('../worker/audit.js');
  const v1Weights = [15, 5, 5, 5, 10, 8, 15, 7, 7, 5, 8, 10, 5];
  const v1Total = v1Weights.reduce((x, y) => x + y);
  const v2Extra = Object.values(a.V2_WEIGHTS).reduce((x, y) => x + y);

  assert.equal(v1Total, 105);
  assert.equal(v2Extra, 17);

  const perfect2025 = [
    ...v1Weights.map((weight, i) => ({ id: `c${i}`, weight, pass: true })),
    ...Object.entries(a.V2_WEIGHTS).map(([id, weight]) => ({ id, weight, pass: false })),
  ];
  const { score } = a.scoreChecks(perfect2025);
  assert.equal(score, 86);

  // And everything passing is still exactly 100 under the extended set, so the
  // denominator is genuinely derived rather than assumed.
  const perfect2026 = perfect2025.map((c) => ({ ...c, pass: true }));
  assert.equal(a.scoreChecks(perfect2026).score, 100);
});

test('an unknown or missing check set resolves to the default, never throws', async () => {
  // Reached from a query string and from a *paid* request body, so a typo must
  // not 400 after the money has settled.
  const { resolveCheckSet, DEFAULT_CHECK_SET, CHECK_SETS } = await import('../worker/audit.js');
  assert.equal(resolveCheckSet('v1'), 'v1');
  assert.equal(resolveCheckSet('v2'), 'v2');
  assert.equal(resolveCheckSet(undefined), DEFAULT_CHECK_SET);
  assert.equal(resolveCheckSet('v3'), DEFAULT_CHECK_SET);
  assert.equal(resolveCheckSet(null), DEFAULT_CHECK_SET);
  assert.equal(resolveCheckSet({}), DEFAULT_CHECK_SET);
  assert.ok(CHECK_SETS.includes(DEFAULT_CHECK_SET));
});

test('the paid endpoint accepts an optional check set without loosening its URL boundary', async () => {
  const { parseAuditRequest, DEFAULT_CHECK_SET } = await import('../worker/audit.js');
  assert.equal(parseAuditRequest({ url: 'https://example.com' }).checkSet, DEFAULT_CHECK_SET);
  assert.equal(parseAuditRequest({ url: 'https://example.com', checks: 'v1' }).checkSet, 'v1');
  // A bad `checks` value is normalised; a bad URL is still refused.
  assert.equal(parseAuditRequest({ url: 'https://example.com', checks: 'nope' }).checkSet, DEFAULT_CHECK_SET);
  assert.ok(parseAuditRequest({ url: 'http://127.0.0.1/', checks: 'v1' }).error);
});

test('Content-Signal is read out of robots.txt, not merely detected', async () => {
  const { contentSignalsIn } = await import('../worker/audit.js');

  // The declared values are the useful part — "has a Content-Signal line" says
  // nothing about whether the site allows training.
  assert.equal(contentSignalsIn('User-agent: *\nContent-Signal: search=yes, ai-train=no\nAllow: /'),
    'search=yes, ai-train=no');
  // Case and leading space are both legal in robots.txt.
  assert.equal(contentSignalsIn('  content-signal:search=yes'), 'search=yes');

  assert.equal(contentSignalsIn('User-agent: *\nAllow: /'), null);
  assert.equal(contentSignalsIn(null), null);
  // A URL in a comment mentioning content-signal is not a declaration.
  assert.equal(contentSignalsIn('# see https://contentsignals.org/ for content-signal docs'), null);
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
  assert.deepEqual(parseAuditRequest({ url: 'https://example.com/docs' }), { url: 'https://example.com/docs', checkSet: 'v2' });
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

test('parseJsonLd counts @graph members, which carry the type instead of the container', () => {
  // The shape Yoast emits and schema.org's multi-entity examples use: @context on
  // the wrapper, @type only on the members. Matching a top-level @type scored this
  // as "no structured data" on a fully marked-up page.
  const res = audit.parseJsonLd([
    '{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"X"},{"@type":"ItemList"}]}',
  ]);
  assert.equal(res.schemaOrg.length, 2);
  assert.deepEqual(res.schemaOrg.map((n) => n['@type']), ['WebSite', 'ItemList']);
  // Members inherit the container's @context — that is where it is defined for them.
  assert.ok(res.schemaOrg.every((n) => n['@context'] === 'https://schema.org'));
});

test('parseJsonLd keeps a typed @graph container alongside its members', () => {
  const res = audit.parseJsonLd([
    '{"@context":"https://schema.org","@type":"WebPage","@graph":[{"@type":"Organization"}]}',
  ]);
  assert.deepEqual(res.schemaOrg.map((n) => n['@type']), ['WebPage', 'Organization']);
});

test('parseJsonLd accepts an array @type', () => {
  const res = audit.parseJsonLd([
    '{"@context":"https://schema.org","@type":["Organization","LocalBusiness"],"name":"X"}',
  ]);
  assert.equal(res.schemaOrg.length, 1);
});

test('parseJsonLd still rejects untyped and non-schema.org nodes', () => {
  const res = audit.parseJsonLd([
    '{"@context":"https://schema.org","name":"no type"}',
    '{"@context":"https://schema.org","@type":[],"name":"empty type"}',
    '{"@context":"https://example.org","@graph":[{"@type":"Thing"}]}',
  ]);
  assert.equal(res.schemaOrg.length, 0);
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

// --- query surfaces: search, NLWeb /ask, remote MCP -------------------------
//
// These are the endpoints that answer a question rather than serve a file, so
// what is pinned here is the *answer's* quality: that ranking cannot put an
// unrelated listing above an exact name match, and that an empty answer still
// tells the caller something it can act on.

const CORPUS = [
  { slug: 'alpha-mcp', name: 'Alpha MCP Server', url: 'https://alpha.example', description: 'A search server.', category: 'mcp', pricing: 'free', tier: 'free', tags: ['search', 'mcp'] },
  { slug: 'beta-api', name: 'Beta API', url: 'https://beta.example', description: 'An API that wraps an MCP server for search.', category: 'api', pricing: 'paid', tier: 'verified', tags: ['api'] },
  { slug: 'gamma-agent', name: 'Gamma', url: 'https://gamma.example', description: 'An autonomous agent.', category: 'agent', pricing: 'freemium', tier: 'free', tags: ['agent'] },
];
const mcpCtx = { listings: CORPUS, base: BASE, scoreUrl: async (u) => ({ ok: true, url: u, letter: 'A', score: 100 }) };
const rpc = (body) => new Request(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('search ranks a name match above a description match', () => {
  const { hits } = searchListings(CORPUS, { q: 'alpha mcp' });
  assert.equal(hits[0].listing.slug, 'alpha-mcp');
  // beta-api only mentions MCP in prose, so it must not outrank the server
  // actually called that — the failure mode this weighting exists to prevent.
  assert.ok(hits[0].score > hits[1].score);
});

test('search filters, limits, and orders stably within a score band', () => {
  assert.deepEqual(searchListings(CORPUS, { q: '', category: 'mcp' }).hits.map((h) => h.listing.slug), ['alpha-mcp']);
  assert.deepEqual(searchListings(CORPUS, { q: '', tag: 'agent' }).hits.map((h) => h.listing.slug), ['gamma-agent']);

  const limited = searchListings(CORPUS, { q: '', limit: 2 });
  assert.equal(limited.total, 3, 'total counts every match, not just the page');
  assert.equal(limited.hits.length, 2);
  // Same query twice must not reorder equal-scoring listings.
  assert.deepEqual(
    searchListings(CORPUS, { q: '' }).hits.map((h) => h.listing.slug),
    searchListings(CORPUS, { q: '' }).hits.map((h) => h.listing.slug),
  );
  // A limit outside the allowed range is clamped rather than honoured.
  assert.equal(searchListings(CORPUS, { q: '', limit: 9999 }).hits.length, 3);
});

test('a search that matches nothing still says what the corpus holds', async () => {
  const res = handleSearch(new URL(`${BASE}/api/search?q=zzzznotathing`), CORPUS, BASE);
  const body = await res.json();
  assert.equal(body.total, 0);
  assert.equal(body.corpus.listings, 3);
  assert.deepEqual(body.corpus.categories, ['agent', 'api', 'mcp']);
  assert.ok(body.register.endsWith('/llms.txt'), 'a dead end must point somewhere');
});

test('/ask answers an NLWeb query with schema.org objects', async () => {
  const res = await handleAsk(
    new Request(`${BASE}/ask`, { method: 'POST', body: JSON.stringify({ query: { text: 'Do you have any MCP servers?' } }) }),
    CORPUS, BASE,
  );
  const body = await res.json();
  assert.equal(body._meta.response_type, 'answer');
  assert.ok(body.results.length > 0, 'stop-words must not swallow the real term');
  assert.equal(body.results[0]['@context'], 'https://schema.org');
  assert.equal(body.results[0]['@type'], 'SoftwareApplication');
  assert.equal(body.results[0].name, 'Alpha MCP Server');
  assert.equal(body.results[0].subjectOf.url, `${BASE}/l/alpha-mcp.html`);
});

test('/ask accepts the shapes clients actually send, not only the spec one', async () => {
  const spec = await (await handleAsk(new Request(`${BASE}/ask`, { method: 'POST', body: '{"query":{"text":"agent"}}' }), CORPUS, BASE)).json();
  const bare = await (await handleAsk(new Request(`${BASE}/ask`, { method: 'POST', body: '{"query":"agent"}' }), CORPUS, BASE)).json();
  const get = await (await handleAsk(new Request(`${BASE}/ask?query=agent`), CORPUS, BASE)).json();
  assert.deepEqual(bare.results, spec.results);
  assert.deepEqual(get.results, spec.results);
});

test('/ask asks back when the question is empty, and refuses another corpus', async () => {
  const empty = await (await handleAsk(new Request(`${BASE}/ask`, { method: 'POST', body: '{}' }), CORPUS, BASE)).json();
  assert.equal(empty._meta.response_type, 'elicitation');
  assert.ok(empty.elicitation.length > 0);

  const wrong = await handleAsk(
    new Request(`${BASE}/ask`, { method: 'POST', body: '{"query":{"text":"x","site":"example.com"}}' }), CORPUS, BASE,
  );
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json())._meta.response_type, 'failure');
});

test('/ask summarizes by default, and mode=list opts out', async () => {
  // The default flipped once the corpus outgrew "read all of it yourself".
  const plain = await (await handleAsk(new Request(`${BASE}/ask`, { method: 'POST', body: '{"query":{"text":"mcp"}}' }), CORPUS, BASE)).json();
  assert.match(plain.summary, /Alpha MCP Server/);
  const get = await (await handleAsk(new Request(`${BASE}/ask?query=mcp`), CORPUS, BASE)).json();
  assert.match(get.summary, /Alpha MCP Server/);

  // Still opt-out-able, both ways in.
  const listed = await (await handleAsk(new Request(`${BASE}/ask`, { method: 'POST', body: '{"query":{"text":"mcp"},"prefer":{"mode":"list"}}' }), CORPUS, BASE)).json();
  assert.equal(listed.summary, undefined);
  assert.equal((await (await handleAsk(new Request(`${BASE}/ask?query=mcp&mode=list`), CORPUS, BASE)).json()).summary, undefined);

  // The results are the answer either way — opting out of prose must not
  // change what matched.
  assert.deepEqual(listed.results, plain.results);
});

test('/ask points a miss at the catalogs instead of saying there is nothing', async () => {
  // The registry is the small half of what this site indexes. A flat "nothing
  // matches" would send an agent away from an answer that exists one endpoint
  // over — which is the whole failure this directory is meant to fix.
  const miss = await (await handleAsk(new Request(`${BASE}/ask`, { method: 'POST', body: '{"query":{"text":"zzzznotathing"}}' }), CORPUS, BASE)).json();
  assert.equal(miss.results.length, 0);
  assert.match(miss.summary, /\/api\/x402\/search/);
  assert.match(miss.summary, /\/api\/mcp\/search/);
  assert.equal(miss.register, `${BASE}/llms.txt`);
});

test('MCP initialize declares tools and echoes the client protocol version', async () => {
  const body = await (await handleMcp(rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }), mcpCtx)).json();
  assert.equal(body.result.protocolVersion, '2025-03-26');
  assert.deepEqual(body.result.capabilities, { tools: { listChanged: false } });
  assert.equal(body.result.serverInfo.name, 'ai-product-index');
  assert.ok(body.result.instructions.includes('/llms.txt'));
});

test('MCP tools/list matches the tools the server card advertises', async () => {
  const body = await (await handleMcp(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), mcpCtx)).json();
  const names = body.result.tools.map((t) => t.name);
  assert.deepEqual(names, ['search_products', 'get_product', 'score_url', 'search_x402_endpoints', 'search_mcp_servers', 'how_to_register']);
  assert.deepEqual(names, mcpTools(BASE).map((t) => t.name));
  for (const t of body.result.tools) assert.equal(t.inputSchema.type, 'object');
});

test('MCP tools/call runs search, get and score', async () => {
  const search = await (await handleMcp(rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_products', arguments: { query: 'mcp' } } }), mcpCtx)).json();
  assert.equal(JSON.parse(search.result.content[0].text).results[0].slug, 'alpha-mcp');

  const get = await (await handleMcp(rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_product', arguments: { slug: 'gamma-agent' } } }), mcpCtx)).json();
  assert.equal(JSON.parse(get.result.content[0].text).name, 'Gamma');

  // score_url goes through the same handler a browser hits, stubbed here.
  const scored = await (await handleMcp(rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'score_url', arguments: { url: 'https://example.com' } } }), mcpCtx)).json();
  assert.equal(JSON.parse(scored.result.content[0].text).letter, 'A');
});

test('a failing MCP tool is a tool result, not a protocol error', async () => {
  // The model has to be able to see and react to the failure; a JSON-RPC error
  // is swallowed by the client instead.
  const body = await (await handleMcp(rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_product', arguments: { slug: 'nope' } } }), mcpCtx)).json();
  assert.equal(body.error, undefined);
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /no listing with slug/);

  const boom = { ...mcpCtx, scoreUrl: async () => { throw new Error('upstream exploded'); } };
  const thrown = await (await handleMcp(rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'score_url', arguments: { url: 'https://x.example' } } }), boom)).json();
  assert.equal(thrown.result.isError, true);
  assert.match(thrown.result.content[0].text, /upstream exploded/);
});

test('MCP handles notifications, batches, unknown methods and a stray GET', async () => {
  // A notification has no id, so it gets no body — 202, not an empty object.
  const notif = await handleMcp(rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), mcpCtx);
  assert.equal(notif.status, 202);
  assert.equal(await notif.text(), '');

  const batch = await (await handleMcp(rpc([
    { jsonrpc: '2.0', id: 'a', method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 'b', method: 'tools/list' },
  ]), mcpCtx)).json();
  assert.equal(batch.length, 2, 'the notification contributes no reply');
  assert.deepEqual(batch.map((r) => r.id), ['a', 'b']);

  const unknown = await (await handleMcp(rpc({ jsonrpc: '2.0', id: 8, method: 'resources/list' }), mcpCtx)).json();
  assert.equal(unknown.error.code, -32601);

  const get = await handleMcp(new Request(`${BASE}/mcp`), mcpCtx);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');

  const garbage = await handleMcp(new Request(`${BASE}/mcp`, { method: 'POST', body: 'not json' }), mcpCtx);
  assert.equal(garbage.status, 400);
  assert.equal((await garbage.json()).error.code, -32700);
});

test('every query surface the manifests advertise is actually routed', async () => {
  // The manifests are hand-written, so this is the check that stops them
  // promising an endpoint the router does not have.
  const manifest = JSON.parse(await readFile(new URL('../.well-known/agents.json', import.meta.url), 'utf8'));
  const card = JSON.parse(await readFile(new URL('../.well-known/mcp.json', import.meta.url), 'utf8'));
  const routed = ['/api/search', '/ask', '/mcp', '/api/x402/search', '/api/mcp/search'];

  assert.equal(manifest.interfaces.mcp, `${BASE}/mcp`);
  assert.equal(manifest.interfaces.nlweb, `${BASE}/ask`);
  assert.equal(manifest.nlweb.endpoint, `${BASE}/ask`);
  assert.equal(card.remotes[0].url, `${BASE}/mcp`);
  assert.deepEqual(card.tools.map((t) => t.name), mcpTools(BASE).map((t) => t.name));

  const advertised = manifest.endpoints.map((e) => new URL(e.url).pathname);
  for (const path of routed) assert.ok(advertised.includes(path), `${path} is routed but not advertised`);
});

test('a natural-language answer drops the incidental matches a search keeps', () => {
  // Every listing in this corpus says "polish", so an unfiltered search finds
  // all three. Only one is actually about property.
  const polish = [
    { slug: 'auctions', name: 'Property Auctions', description: 'Polish municipal property auctions.', category: 'app', pricing: 'free', tags: ['property', 'poland'] },
    { slug: 'quiz', name: 'Headline Quiz', description: 'A polish newspaper guessing game.', category: 'app', pricing: 'free', tags: ['poland'] },
    { slug: 'cameras', name: 'Old Cameras', description: 'Polish catalog of film cameras.', category: 'app', pricing: 'free', tags: ['poland'] },
  ];
  const search = searchListings(polish, { q: 'polish property' });
  assert.equal(search.total, 3, '/api/search returns every match; the caller ranks and limits');

  const answered = searchListings(polish, { q: 'polish property', minScoreRatio: 0.5 });
  assert.deepEqual(answered.hits.map((h) => h.listing.slug), ['auctions']);
  assert.equal(answered.total, 1, 'total reflects what was offered, not what was scored');
});

test('term matching survives plurals and nominalisations, at a discount', () => {
  const service = [{
    slug: 'agent-readability-service', name: 'Agent Readability Service',
    description: 'Done-for-you agent readability: llms.txt, schema.org JSON-LD.',
    category: 'other', pricing: 'paid', tags: ['audit', 'llms-txt'],
  }];
  // The query that used to score this listing zero: agents != agent, and
  // readable != readability.
  const hits = searchListings(service, { q: 'readable ai agents' }).hits;
  assert.equal(hits.length, 1);
  assert.ok(hits[0].score > 0);

  // But an exact hit must still beat a stem hit, or the discount is pointless.
  const both = [
    { slug: 'exact', name: 'Agent Directory', description: 'x', category: 'api', pricing: 'free', tags: [] },
    { slug: 'stemmed', name: 'Agentic Toolkit', description: 'x', category: 'api', pricing: 'free', tags: [] },
  ];
  assert.equal(searchListings(both, { q: 'agent' }).hits[0].listing.slug, 'exact');
});

test('stem matching does not pair short unrelated words', () => {
  const corpus = [{ slug: 'api-gw', name: 'API Gateway', description: 'Routing.', category: 'api', pricing: 'free', tags: [] }];
  // Four-character floor: "app" must not stem-match "API", and a query with no
  // real relationship must still return nothing rather than a weak guess.
  assert.equal(searchListings(corpus, { q: 'sourdough' }).hits.length, 0);
  assert.equal(searchListings(corpus, { q: 'gatehouse' }).hits.length, 0);
});

// --- the x402 endpoint catalog ----------------------------------------------

const X402_INDEX = {
  fetched: '2026-08-01',
  count: 4,
  fields: ['url', 'host', 'description', 'price', 'chain', 'method', 'x402_version'],
  rows: [
    ['https://a.example/weather', 'a.example', 'Weather forecast for any city.', 0.01, 'base', 'GET', 2],
    ['https://b.example/weather', 'b.example', 'Cheap weather data.', 0.001, 'base', 'GET', 1],
    ['https://c.example/price', 'c.example', 'Token price feed.', 0.05, 'solana', 'POST', 2],
    ['https://d.example/mystery', 'd.example', 'Weather, priced in an unknown token.', null, 'base', 'GET', 2],
  ],
};
const x402Env = {
  ASSETS: { fetch: async () => new Response(JSON.stringify(X402_INDEX), { headers: { 'content-type': 'application/json' } }) },
};
const x402Get = async (qs) => (await handleCatalogSearch('x402', new URL(`${BASE}/api/x402/search?${qs}`), x402Env, BASE)).json();

test('x402 search ranks by relevance, then by price', async () => {
  const body = await x402Get('q=weather');
  assert.equal(body.ok, true);
  // All three mention weather; among equally relevant hits the cheaper one wins,
  // because on a pay-per-call rail that is the tiebreak that matters.
  assert.equal(body.results[0].url, 'https://b.example/weather');
  assert.equal(body.source, 'Coinbase CDP x402 Bazaar');
  assert.equal(body.catalog.endpoints, 4);
});

test('x402 search filters by chain, method and host', async () => {
  assert.deepEqual((await x402Get('chain=solana')).results.map((r) => r.host), ['c.example']);
  assert.deepEqual((await x402Get('method=POST')).results.map((r) => r.host), ['c.example']);
  assert.deepEqual((await x402Get('host=b.example')).results.map((r) => r.host), ['b.example']);
});

// --- catalog liveness -------------------------------------------------------

const withHealth = (health) => ({
  ASSETS: {
    fetch: async (req) => {
      if (new URL(req.url).pathname.endsWith('/health.json')) {
        return health
          ? new Response(JSON.stringify(health), { headers: { 'content-type': 'application/json' } })
          : new Response('not found', { status: 404 });
      }
      return new Response(JSON.stringify(X402_INDEX), { headers: { 'content-type': 'application/json' } });
    },
  },
});

test('an endpoint confirmed unreachable is flagged, not removed', async () => {
  discovery.resetCatalog();
  const env = withHealth({
    probed_at: '2026-08-01',
    unreachable: [
      { url: 'https://b.example/weather', reason: 'timeout', misses: 2 },
      // One miss is a bad moment, not a death — it must not reach the caller.
      { url: 'https://a.example/weather', reason: 'timeout', misses: 1 },
    ],
  });
  const body = await (await handleCatalogSearch('x402', new URL(`${BASE}/api/x402/search?q=weather`), env, BASE)).json();

  // Still ranked first: flagging must not quietly reorder or drop results, or
  // the caller loses the cheapest endpoint on one week's evidence.
  assert.equal(body.results[0].url, 'https://b.example/weather');
  assert.equal(body.results[0].unreachable, true);
  assert.equal(body.results.length, 3, 'a flagged endpoint was dropped from results');
  assert.equal(body.results.find((r) => r.url === 'https://a.example/weather').unreachable, undefined);
  assert.equal(body.catalog.liveness_sampled, '2026-08-01');
  discovery.resetCatalog();
});

test('search works unchanged when liveness has never run', async () => {
  // The health file is absent until the first cron run and stale between them.
  // Not knowing is different from knowing everything is fine, and neither is a
  // reason to fail a query.
  discovery.resetCatalog();
  const body = await (await handleCatalogSearch('x402', new URL(`${BASE}/api/x402/search?q=weather`), withHealth(null), BASE)).json();

  assert.equal(body.ok, true);
  assert.equal(body.results.length, 3);
  assert.ok(body.results.every((r) => r.unreachable === undefined));
  assert.equal(body.catalog.liveness, undefined);
  discovery.resetCatalog();
});

test('an unpriced x402 endpoint is excluded by a price filter, not treated as free', async () => {
  // d.example is priced in an asset whose decimals are unknown, so its price is
  // unknown — not zero. Sorting it first as "cheapest" would be a lie an agent
  // would act on.
  const cheap = await x402Get('q=weather&max_price=0.005');
  assert.deepEqual(cheap.results.map((r) => r.host), ['b.example']);
  const all = await x402Get('q=weather');
  assert.ok(all.results.some((r) => r.host === 'd.example'), 'it is still findable without a price filter');
  assert.equal(all.results.at(-1).host, 'd.example', 'and it sorts last, not first');
});

test('x402 search survives a missing catalog without poisoning later requests', async () => {
  discovery.resetCatalog();
  let attempts = 0;
  const flaky = {
    ASSETS: {
      async fetch() {
        attempts += 1;
        return attempts === 1
          ? new Response('nope', { status: 500 })
          : new Response(JSON.stringify(X402_INDEX), { headers: { 'content-type': 'application/json' } });
      },
    },
  };
  const url = new URL(`${BASE}/api/x402/search?q=weather`);
  const first = await handleCatalogSearch('x402', url, flaky, BASE);
  assert.equal(first.status, 503);
  assert.equal((await first.json()).code, 'catalog_unavailable');

  // The cached promise must have been cleared, or every later request replays
  // the failure for the life of the isolate.
  const second = await handleCatalogSearch('x402', url, flaky, BASE);
  assert.equal(second.status, 200);
});

test('the x402 catalog artifacts carry their provenance', async () => {
  const catalog = JSON.parse(await readFile(new URL('../api/x402/catalog.json', import.meta.url), 'utf8'));
  const idx = JSON.parse(await readFile(new URL('../api/x402/index.json', import.meta.url), 'utf8'));
  const st = JSON.parse(await readFile(new URL('../api/x402/stats.json', import.meta.url), 'utf8'));

  // This is republished third-party data. Whoever reads it must be able to see
  // where it came from and when, without being told.
  assert.match(catalog.$comment, /mirror/i);
  assert.match(catalog.$comment, /removed/i, 'a mirror needs a stated way out of it');
  assert.equal(catalog.source_url, st.source_url);
  assert.match(catalog.fetched, /^\d{4}-\d{2}-\d{2}$/);

  // The compact index must stay in step with the catalog it indexes.
  assert.equal(idx.count, catalog.count);
  assert.equal(idx.fetched, catalog.fetched);
  assert.equal(idx.rows.length, catalog.endpoints.length);
  assert.equal(idx.rows[0][0], catalog.endpoints[0].url);
  // Sorted by URL, so a weekly refresh is a small diff rather than a rewrite.
  const urls = catalog.endpoints.map((e) => e.url);
  assert.deepEqual(urls, [...urls].sort((a, b) => a.localeCompare(b)));
});

test('the MCP catalog is scoped honestly and searchable by auth', async () => {
  const index = {
    fetched: '2026-08-01',
    count: 3,
    fields: ['url', 'host', 'name', 'title', 'description', 'transport', 'auth'],
    rows: [
      ['https://a.example/mcp', 'a.example', 'io.a/gh', 'GitHub Tools', 'Read and write GitHub issues.', 'streamable-http', 'required'],
      ['https://b.example/mcp', 'b.example', 'io.b/gh', 'Git Browser', 'Browse github repositories.', 'streamable-http', 'none'],
      ['https://c.example/sse', 'c.example', 'io.c/web', 'Web Fetch', 'Fetch a page.', 'sse', 'none'],
    ],
  };
  const env = { ASSETS: { fetch: async () => new Response(JSON.stringify(index)) } };
  const get = async (qs) => (await handleCatalogSearch('mcp', new URL(`${BASE}/api/mcp/search?${qs}`), env, BASE)).json();

  discovery.resetCatalog();
  const hits = await get('q=github');
  assert.equal(hits.total, 2);
  assert.equal(hits.source, 'Official MCP Registry (registry.modelcontextprotocol.io)');
  assert.equal(hits.catalog.servers, 3, 'each catalog names its own unit');

  // "I want one I can call without going and finding a token first" is the
  // most common real constraint, so it has to be a filter and not a re-read.
  assert.deepEqual((await get('q=github&auth=none')).results.map((r) => r.host), ['b.example']);
  assert.deepEqual((await get('transport=sse')).results.map((r) => r.host), ['c.example']);

  // The committed artifact must state what it leaves out, or "10,080 servers"
  // reads as "every server".
  const st = JSON.parse(await readFile(new URL('../api/mcp/stats.json', import.meta.url), 'utf8'));
  assert.equal(st.scope.rule, 'active + latest + remotely callable');
  assert.ok(st.scope.excluded_packages_only > 0);
  assert.match(st.scope.note, /excluded/);
});

test('an unknown catalog is refused rather than guessed at', async () => {
  const res = await handleCatalogSearch('nope', new URL(`${BASE}/api/nope/search?q=x`), {}, BASE);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'unknown_catalog');
});

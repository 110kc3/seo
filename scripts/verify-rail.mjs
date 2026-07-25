// Pre-flight check for an x402 rail, run before pointing real money at it.
//
//   node scripts/verify-rail.mjs            # the active profile
//   node scripts/verify-rail.mjs mainnet    # any named profile
//
// Three things can be wrong in a way no unit test can catch, because the truth
// lives on chain and at the facilitator, not in this repo:
//
//   1. The asset address is not the token we think it is. A plausible-looking
//      wrong address means payers are quoted a contract that isn't USDC.
//   2. The published EIP-712 domain (`extra: {name, version}`) does not equal
//      the token's own name()/version(). Payers then sign over a different
//      domain and the facilitator rejects every payment as invalid. USDC is
//      "USDC" on Base Sepolia but "USD Coin" on Base mainnet, so this is a
//      live trap, not a hypothetical one.
//   3. The facilitator does not actually settle this network. The public
//      x402.org facilitator is testnet-only — it advertises eip155:84532 and
//      no Base mainnet at all — so a mainnet profile aimed at it fails at
//      settlement, after the caller has already signed.
//
// Everything is read from the network; nothing here is asserted from memory.
// Zero dependencies: JSON-RPC and one GET, both over fetch.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveX402 } from './x402-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// name() / symbol() / decimals() / version() — ERC-20 plus USDC's EIP-712 version.
const SELECTORS = {
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  version: '0x54fd4d50',
};

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);
const note = (msg) => notes.push(msg);

function decodeAbiString(hex) {
  const body = (hex ?? '').replace(/^0x/, '');
  if (body.length <= 128) return null;
  const len = Number.parseInt(body.slice(64, 128), 16);
  if (!Number.isFinite(len) || len * 2 > body.length - 128) return null;
  return Buffer.from(body.slice(128, 128 + len * 2), 'hex').toString('utf8');
}

async function ethCall(rpcUrl, to, data) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'ai-product-index-verify-rail' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      signal: ctl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const body = await resp.json();
    if (body.error) throw new Error(body.error.message ?? 'rpc error');
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the token's own metadata off chain. */
async function readToken(rpcUrl, asset) {
  const out = {};
  for (const [key, selector] of Object.entries(SELECTORS)) {
    try {
      const raw = await ethCall(rpcUrl, asset, selector);
      out[key] = key === 'decimals' ? Number.parseInt(raw, 16) : decodeAbiString(raw);
    } catch (e) {
      out[key] = null;
      out[`${key}_error`] = e.message;
    }
  }
  return out;
}

/** Asks the facilitator what it will actually settle. */
async function readSupported(facilitatorUrl) {
  const url = `${facilitatorUrl.replace(/\/+$/, '')}/supported`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const resp = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'ai-product-index-verify-rail' }, signal: ctl.signal });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: resp.status, kinds: Array.isArray(json?.kinds) ? json.kinds : null };
  } finally {
    clearTimeout(timer);
  }
}

const human = (atomic, decimals) => {
  if (typeof atomic !== 'string' || !/^\d+$/.test(atomic)) return '(unset)';
  const padded = atomic.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  return `${whole}.${padded.slice(-decimals)}`.replace(/0+$/, '').replace(/\.$/, '.0');
};

// --- resolve the profile ----------------------------------------------------

const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const requested = process.argv[2] ?? cfg.payments?.x402?.active;
const known = Object.keys(cfg.payments?.x402?.profiles ?? {});
if (!known.includes(requested)) {
  console.error(`unknown profile "${requested}" — known profiles: ${known.join(', ')}`);
  process.exit(2);
}

// resolveX402 only ever resolves the active rail, which is the right contract
// for the Worker. Overriding `active` on a copy lets this script check a
// profile before it is switched on, which is the entire point.
const rail = resolveX402({ ...cfg, payments: { ...cfg.payments, x402: { ...cfg.payments.x402, active: requested } } });

console.log(`profile:      ${requested}${requested === cfg.payments?.x402?.active ? ' (active)' : ''}`);
if (!rail) {
  console.log('\nresolveX402() returns null — this rail is incomplete and fails closed');
  console.log('(payTo, facilitator_url, network and asset must all be non-empty)');
  process.exit(1);
}

console.log(`network:      ${rail.network}`);
console.log(`facilitator:  ${rail.facilitator_url}${rail.auth === 'cdp' ? '  (auth: cdp)' : ''}`);
console.log(`asset:        ${rail.asset}`);
console.log(`payTo:        ${rail.payTo}`);
console.log(`audit price:  ${rail.audit_price_atomic} atomic = ${human(rail.audit_price_atomic, rail.asset_decimals)} ${rail.asset_name}`);
console.log(`explorer:     ${rail.explorer}/address/${rail.payTo}`);
console.log('');

if (!ADDRESS_RE.test(rail.asset)) fail(`asset "${rail.asset}" is not a 20-byte hex address`);
if (!ADDRESS_RE.test(rail.payTo)) fail(`payTo "${rail.payTo}" is not a 20-byte hex address`);

// --- 1 + 2. the token, read off chain ---------------------------------------

if (ADDRESS_RE.test(rail.asset) && rail.rpc_url) {
  const token = await readToken(rail.rpc_url, rail.asset);
  if (token.name === null && token.symbol === null) {
    fail(`no ERC-20 metadata at ${rail.asset} via ${rail.rpc_url} — wrong address, or the RPC is unreachable (${token.name_error ?? 'no detail'})`);
  } else {
    console.log(`on chain:     name=${JSON.stringify(token.name)} symbol=${JSON.stringify(token.symbol)} decimals=${token.decimals} version=${JSON.stringify(token.version)}`);

    // The money-critical comparison: the EIP-712 domain we publish must be the
    // one the token itself enforces.
    if (token.name !== rail.asset_name) {
      fail(`EIP-712 domain name mismatch: config publishes asset_name ${JSON.stringify(rail.asset_name)} but the token's name() is ${JSON.stringify(token.name)} — every payment signature would be rejected. Set "asset_name": ${JSON.stringify(token.name)} on the "${requested}" profile.`);
    }
    if (token.version && token.version !== rail.asset_version) {
      fail(`EIP-712 domain version mismatch: config publishes ${JSON.stringify(rail.asset_version)}, token reports ${JSON.stringify(token.version)}.`);
    }
    if (Number.isFinite(token.decimals) && token.decimals !== rail.asset_decimals) {
      fail(`decimals mismatch: config says ${rail.asset_decimals}, token says ${token.decimals} — prices would be off by 10^${Math.abs(token.decimals - rail.asset_decimals)}.`);
    }
    if (token.symbol && !/USDC/i.test(token.symbol)) {
      note(`token symbol is ${JSON.stringify(token.symbol)}, not USDC — intended?`);
    }
  }
}

// --- 3. the facilitator, asked directly -------------------------------------

try {
  const supported = await readSupported(rail.facilitator_url);
  if (supported.kinds) {
    const advertises = (v, network) =>
      supported.kinds.some((k) => k.x402Version === v && k.scheme === 'exact' && k.network === network);
    const listFor = (v) => [...new Set(supported.kinds.filter((k) => k.x402Version === v).map((k) => k.network))];
    console.log(`facilitator:  advertises ${supported.kinds.length} kind(s)`);
    console.log(`   v2 networks: ${listFor(2).join(', ') || '(none)'}`);
    console.log(`   v1 networks: ${listFor(1).join(', ') || '(none)'}`);

    if (!advertises(2, rail.network)) {
      fail(`facilitator ${rail.facilitator_url} does not advertise {x402Version: 2, scheme: "exact", network: "${rail.network}"} — settlement on this network will fail after the payer has signed.`);
    }
    // v1 is the version most deployed clients actually speak, so a rail that
    // cannot settle v1 is a rail almost nobody can pay.
    if (rail.network_v1) {
      if (!advertises(1, rail.network_v1)) {
        fail(`facilitator does not advertise {x402Version: 1, scheme: "exact", network: "${rail.network_v1}"}, but this profile offers v1 — v1 clients would sign and then fail at settlement. Either pick a facilitator that settles v1 on this chain, or clear "network_v1" to stop advertising v1.`);
      }
    } else {
      note('this profile sets no network_v1, so only x402 v2 is offered. The reference client (x402-fetch) speaks v1 and will not be able to pay.');
    }
  } else if (supported.status === 401 || supported.status === 403) {
    note(`facilitator /supported needs authentication (HTTP ${supported.status}) — expected for the CDP rail; its network support cannot be checked without CDP_API_KEY_ID / CDP_API_KEY_SECRET.`);
  } else {
    note(`facilitator /supported returned HTTP ${supported.status} with no "kinds" array — could not confirm network support.`);
  }
} catch (e) {
  note(`facilitator ${rail.facilitator_url} unreachable from here: ${e.message}`);
}

// --- verdict ----------------------------------------------------------------

console.log('');
for (const n of notes) console.log(`note:  ${n}`);
for (const p of problems) console.log(`FAIL:  ${p}`);

if (problems.length) {
  console.log(`\n${problems.length} problem(s) — do not switch this rail on.`);
  process.exit(1);
}
console.log(`\nrail "${requested}" checks out against chain and facilitator.`);
if (rail.network === 'eip155:8453') {
  console.log('This is real money. Eyeball the asset address on the explorer once by hand before flipping "active".');
}

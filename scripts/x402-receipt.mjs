// Verifies an ALREADY-SETTLED x402 payment from its transaction hash.
//
// Why not the facilitator: /verify and /settle operate on a signed but
// unsettled EIP-3009 authorization, carried in an HTTP header. The [upgrade]
// flow's transport is a GitHub issue, which cannot do the 402 handshake — by
// the time an agent opens the issue the payment is already on chain. So the
// check here is an on-chain receipt lookup: did this transaction actually move
// at least the tier price of the expected asset to our address?
//
// Zero dependencies: plain JSON-RPC over fetch, no web3 library.

// keccak256("Transfer(address,address,uint256)")
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Left-pads a 20-byte address into the 32-byte form used in log topics. */
export function topicAddress(address) {
  if (!ADDRESS_RE.test(address)) throw new Error(`not an address: ${address}`);
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

const sameHex = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/**
 * Finds an ERC-20 Transfer log paying `payTo` in `asset`.
 * @returns {{value: bigint, from: string}|null}
 */
export function findTransfer(logs, { asset, payTo }) {
  const wantTo = topicAddress(payTo);
  for (const log of logs ?? []) {
    if (!sameHex(log.address, asset)) continue;
    const [topic, fromTopic, toTopic] = log.topics ?? [];
    if (!sameHex(topic, TRANSFER_TOPIC) || !sameHex(toTopic, wantTo)) continue;
    let value;
    try {
      value = BigInt(log.data);
    } catch {
      continue;
    }
    return { value, from: fromTopic ? `0x${fromTopic.slice(26)}` : null };
  }
  return null;
}

export function tierPriceAtomic(x402, tier) {
  const key = { verified: 'verified_tier_price_atomic', featured: 'featured_tier_price_atomic' }[tier];
  const price = key ? x402?.[key] : undefined;
  return typeof price === 'string' && /^\d{1,78}$/.test(price) ? price : null;
}

async function rpc(url, method, params) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'ai-product-index-registry' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctl.signal,
    });
    if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
    const body = await resp.json();
    if (body.error) throw new Error(`RPC error: ${body.error.message ?? 'unknown'}`);
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {Promise<{ok: true, payer: string|null, value: string} | {ok: false, code: string, error: string}>}
 */
export async function verifyReceipt(rpcUrl, { transaction, asset, payTo, minAmount, minConfirmations = 2 }) {
  if (typeof transaction !== 'string' || !TX_RE.test(transaction)) {
    return { ok: false, code: 'invalid', error: 'receipt.transaction must be a 32-byte hex transaction hash' };
  }

  let receipt;
  let head;
  try {
    [receipt, head] = await Promise.all([
      rpc(rpcUrl, 'eth_getTransactionReceipt', [transaction]),
      rpc(rpcUrl, 'eth_blockNumber', []),
    ]);
  } catch (e) {
    return { ok: false, code: 'rpc_unreachable', error: `could not reach the chain RPC: ${e.message}` };
  }

  if (!receipt) {
    return { ok: false, code: 'tx_not_found', error: `transaction ${transaction} not found on ${rpcUrl.replace(/\/\/.*@/, '//')}` };
  }
  if (receipt.status !== '0x1') {
    return { ok: false, code: 'tx_failed', error: `transaction ${transaction} did not succeed on chain` };
  }

  const confirmations = BigInt(head) - BigInt(receipt.blockNumber) + 1n;
  if (confirmations < BigInt(minConfirmations)) {
    return {
      ok: false,
      code: 'tx_unconfirmed',
      error: `transaction has ${confirmations} confirmation(s), needs ${minConfirmations} — retry shortly`,
    };
  }

  const transfer = findTransfer(receipt.logs, { asset, payTo });
  if (!transfer) {
    return {
      ok: false,
      code: 'no_matching_transfer',
      error: `transaction ${transaction} contains no transfer of ${asset} to ${payTo}`,
    };
  }
  if (transfer.value < BigInt(minAmount)) {
    return {
      ok: false,
      code: 'underpaid',
      error: `paid ${transfer.value} atomic units, tier price is ${minAmount}`,
    };
  }

  return { ok: true, payer: transfer.from, value: transfer.value.toString() };
}

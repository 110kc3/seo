// Tests for on-chain receipt verification used by the [upgrade] tier rail.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { topicAddress, findTransfer, tierPriceAtomic, TRANSFER_TOPIC, TX_RE } from './x402-receipt.mjs';

const ASSET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const PAY_TO = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const OTHER = '0xdead000000000000000000000000000000000001';

const transferLog = ({ address = ASSET, to = PAY_TO, from = OTHER, value = 5_000_000n, topic = TRANSFER_TOPIC } = {}) => ({
  address,
  topics: [topic, topicAddress(from), topicAddress(to)],
  data: `0x${value.toString(16).padStart(64, '0')}`,
});

test('topicAddress left-pads to 32 bytes and lowercases', () => {
  assert.equal(topicAddress(PAY_TO), `0x${'0'.repeat(24)}209693bc6afc0c5328ba36faf03c514ef312287c`);
  assert.throws(() => topicAddress('0x123'), /not an address/);
});

test('findTransfer matches a payment to our address in the expected asset', () => {
  const found = findTransfer([transferLog()], { asset: ASSET, payTo: PAY_TO });
  assert.equal(found.value, 5_000_000n);
  assert.equal(found.from.toLowerCase(), OTHER.toLowerCase());
});

test('findTransfer tolerates checksum differences in the asset address', () => {
  const found = findTransfer([transferLog({ address: ASSET.toLowerCase() })], { asset: ASSET, payTo: PAY_TO });
  assert.ok(found);
});

test('findTransfer ignores transfers that are not ours', () => {
  // Wrong token contract — a worthless token paying the right address must not
  // buy an upgrade.
  assert.equal(findTransfer([transferLog({ address: OTHER })], { asset: ASSET, payTo: PAY_TO }), null);
  // Right token, someone else's address.
  assert.equal(findTransfer([transferLog({ to: OTHER })], { asset: ASSET, payTo: PAY_TO }), null);
  // Right token and address, but an Approval-style event rather than Transfer.
  assert.equal(
    findTransfer([transferLog({ topic: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925' })], { asset: ASSET, payTo: PAY_TO }),
    null,
  );
  assert.equal(findTransfer([], { asset: ASSET, payTo: PAY_TO }), null);
  assert.equal(findTransfer(undefined, { asset: ASSET, payTo: PAY_TO }), null);
});

test('findTransfer picks our transfer out of an unrelated batch', () => {
  const found = findTransfer(
    [transferLog({ to: OTHER }), transferLog({ address: OTHER }), transferLog({ value: 25_000_000n })],
    { asset: ASSET, payTo: PAY_TO },
  );
  assert.equal(found.value, 25_000_000n);
});

test('findTransfer skips logs with unparseable data rather than throwing', () => {
  const bad = { ...transferLog(), data: '0xzz' };
  assert.equal(findTransfer([bad], { asset: ASSET, payTo: PAY_TO }), null);
});

test('tierPriceAtomic only returns published decimal prices', () => {
  const x = { verified_tier_price_atomic: '5000000', featured_tier_price_atomic: '25000000' };
  assert.equal(tierPriceAtomic(x, 'verified'), '5000000');
  assert.equal(tierPriceAtomic(x, 'featured'), '25000000');
  assert.equal(tierPriceAtomic(x, 'free'), null);
  assert.equal(tierPriceAtomic({}, 'verified'), null);
  assert.equal(tierPriceAtomic(undefined, 'verified'), null);
  assert.equal(tierPriceAtomic({ verified_tier_price_atomic: '1e6' }, 'verified'), null);
  assert.equal(tierPriceAtomic({ verified_tier_price_atomic: 5000000 }, 'verified'), null);
});

test('TX_RE accepts only 32-byte hex transaction hashes', () => {
  assert.ok(TX_RE.test(`0x${'a'.repeat(64)}`));
  assert.ok(!TX_RE.test(`0x${'a'.repeat(63)}`));
  assert.ok(!TX_RE.test('0xtest'));
  assert.ok(!TX_RE.test('a'.repeat(64)));
});

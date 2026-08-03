// Buy one live probe, and one routing answer, from the router endpoints.
//
//   npm i @x402/fetch @x402/core @x402/evm viem
//   EVM_PRIVATE_KEY=0x... node clients/pay_liveness.mjs [liveness|route|watch|both] [probe-target]
//
// Why this exists as well as pay_x402.mjs: that one buys a POST /api/audit, and
// this service's first endpoint is a *GET* with query parameters. A paid GET
// exercises a different path through the payment layer — the resource URL in the
// challenge is the one the caller asked for, parameters and all — and that is
// precisely the kind of difference no unit test catches, because the divergence
// lives between runtimes rather than in this repo (see NEXT.md §4.4).
//
// COST. Both endpoints are $0.005 in USDC on Base, so `both` spends $0.01 plus
// gas. If you are the operator, `payTo` is your own receiving address and the
// USDC returns to you — the real cost is the Base gas for two transfers.
//
// The wallet needs USDC on the network the endpoint quotes. Read the terms
// first, for free, at https://index.percall.dev/api/x402/info
import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const BASE = process.env.X402_BASE ?? 'https://index.percall.dev';
// The Router's own host. The index 308s these paths here, and a 308 preserves
// method and body — but paying the final URL directly is one less hop to
// misread when something goes wrong.
const ROUTER = process.env.X402_ROUTER ?? 'https://router.percall.dev';
const [mode = 'both', target = 'https://2s.io/api/business/fi-companies'] = process.argv.slice(2);

if (!process.env.EVM_PRIVATE_KEY) {
  console.error('EVM_PRIVATE_KEY is not set. Export it in your own shell — never paste a key into a log or a chat.');
  process.exit(2);
}

const client = new x402Client();
client.register('eip155:*', new ExactEvmScheme(privateKeyToAccount(process.env.EVM_PRIVATE_KEY)));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const show = (label, response, body) => {
  console.log(`\n=== ${label} — HTTP ${response.status} ===`);
  const receipt = response.headers.get('payment-response') ?? response.headers.get('x-payment-response');
  console.log(receipt ? `settled: ${receipt.slice(0, 60)}…` : 'settled: (no receipt header)');
  console.log(JSON.stringify(body, null, 2).slice(0, 2400));
};

// The probe target is deliberately somebody else's live x402 endpoint: the whole
// point of the check is that we can read a 402 we did not write.
if (mode === 'liveness' || mode === 'both') {
  const url = `${ROUTER}/api/liveness?url=${encodeURIComponent(target)}`;
  const response = await fetchWithPayment(url);
  const body = await response.json();
  show(`GET /api/liveness?url=${target}`, response, body);

  const r = body.result ?? {};
  console.log(`\nread back: alive=${r.alive} status=${r.status} paywalled=${r.paywalled} latency=${r.latency_ms}ms`);
  console.log(`terms:     ${r.terms ? `${r.terms.length} quoted, first = ${r.terms[0].amount_atomic} atomic (${r.terms[0].price ?? 'unknown decimals'})` : 'none readable'}`);
  console.log(`history:   ${r.history ? `${r.history.answered}/${r.history.probes} answered, ${r.history.recent.answered} of last ${r.history.recent.of}` : 'none'}`);
}

if (mode === 'route' || mode === 'both') {
  const response = await fetchWithPayment(`${ROUTER}/api/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q: 'currency conversion', max_price: 0.02, limit: 3 }),
  });
  const body = await response.json();
  show('POST /api/route', response, body);
  for (const c of body.candidates ?? []) {
    console.log(`  ${c.probe.alive ? 'alive' : 'dead '}  ${c.probe.status}  ${c.url}`);
  }
}

if (mode === 'watch' || mode === 'both') {
  // Minimum purchase: 4 sweeps. The webhook is a placeholder that will not be
  // called during this run — an alert fires on a state *change*, and the first
  // sweep of a new watch deliberately sets a baseline instead. What this proves
  // is the purchase path: settlement, payer extraction, and storage.
  const sweeps = Number(process.env.WATCH_SWEEPS ?? 4);
  const response = await fetchWithPayment(`${ROUTER}/api/watch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: target, webhook: process.env.WATCH_HOOK ?? 'https://example.com/hook', sweeps }),
  });
  const body = await response.json();
  show(`POST /api/watch (${sweeps} sweeps)`, response, body);
  console.log(`\nowner:   ${body.owner ?? '(none — the settlement did not identify a payer)'}`);
  console.log(`credits: ${body.credits} ${body.topped_up ? '(topped up an existing watch)' : '(new watch)'}`);
}

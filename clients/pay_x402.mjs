// Buy one agent-readability audit — the paid endpoint — from Node.
//
//   npm i @x402/fetch @x402/core @x402/evm viem
//   EVM_PRIVATE_KEY=0x... node pay_x402.mjs https://your-site.com
//
// The wallet needs USDC on the network the endpoint quotes. Read the current
// terms first, without spending anything: https://index.percall.dev/api/x402/info
//
// Verified against index.kc-it.pl on 2026-07-25 with @x402/fetch 2.19.0.
import { wrapFetchWithPayment, x402HTTPClient } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const client = new x402Client();
client.register('eip155:*', new ExactEvmScheme(privateKeyToAccount(process.env.EVM_PRIVATE_KEY)));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const response = await fetchWithPayment('https://index.percall.dev/api/audit', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: process.argv[2] ?? 'https://example.com' }),
});
const { body } = await new x402HTTPClient(client).processResponse(response);

// Every failing check comes back with paste-ready code for your own origin.
for (const step of body.next_steps ?? []) {
  console.log(`\n## ${step.label}  (weight ${step.weight})\n${step.fix}\n\n${step.snippet ?? ''}`);
}
console.log(`\n${body.letter} — ${body.score}/100 (${body.grade})`);

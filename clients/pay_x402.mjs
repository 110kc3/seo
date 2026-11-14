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

for (const step of body.next_steps ?? []) {
  console.log(`\n## ${step.label}  (weight ${step.weight})\n${step.fix}\n\n${step.snippet ?? ''}`);
}
console.log(`\n${body.letter} — ${body.score}/100 (${body.grade})`);

"""Buy one agent-readability audit — the paid endpoint — from Python.

    pip install "x402[evm,httpx]"
    EVM_PRIVATE_KEY=0x... python pay_x402.py https://your-site.com

Note the `evm` extra: the docs' `x402[httpx]` alone does not pull in the EVM
signer and the import fails.

The wallet needs USDC on the network the endpoint quotes. Read the current terms
first, without spending anything: https://index.kc-it.pl/api/x402/info

Verified against index.kc-it.pl on 2026-07-25 with x402 2.16.0.
"""

import asyncio
import os
import sys

from eth_account import Account
from x402 import x402Client
from x402.http.clients import x402HttpxClient
from x402.mechanisms.evm import EthAccountSigner
from x402.mechanisms.evm.exact.register import register_exact_evm_client


async def main() -> None:
    client = x402Client()
    account = Account.from_key(os.environ["EVM_PRIVATE_KEY"])
    register_exact_evm_client(client, EthAccountSigner(account))

    async with x402HttpxClient(client) as http:
        response = await http.post(
            "https://index.kc-it.pl/api/audit",
            json={"url": sys.argv[1] if len(sys.argv) > 1 else "https://example.com"},
        )
        await response.aread()
        body = response.json()

    # Every failing check comes back with paste-ready code for your own origin.
    for step in body.get("next_steps", []):
        print(f"\n## {step['label']}  (weight {step['weight']})\n{step['fix']}\n")
        print(step.get("snippet") or "")
    print(f"\n{body['letter']} — {body['score']}/100 ({body['grade']})")


asyncio.run(main())

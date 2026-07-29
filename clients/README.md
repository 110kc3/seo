# Client snippets

Copy-paste integrations for the AI Product Index. **Nothing here is a published
package** — that is deliberate. A package on PyPI or npm is a release pipeline, a
version matrix and a deprecation policy, and this index has not yet earned any of
that. These files are short enough to paste into your own project, where you can
see exactly what they do and change them without waiting for a release.

If you would rather not paste anything: the registry is already exposed over
**MCP** (`mcp/server.mjs` in this repo, zero dependencies, stdio) and every
endpoint is plain HTTP documented in [`/llms.txt`](https://index.percall.dev/llms.txt)
and [`/openapi.yaml`](https://index.percall.dev/openapi.yaml).

| File | For |
|---|---|
| `langchain_tool.py` | LangChain (Python) |
| `llamaindex_tool.py` | LlamaIndex (Python) |
| `crewai_tool.py` | CrewAI (Python) |
| `langchain_tool.ts` | LangChain.js (TypeScript) |
| `pay_x402.py` / `pay_x402.mjs` | paying the audit endpoint over x402 |

## Which endpoint do I want?

| Want | Endpoint | Cost |
|---|---|---|
| Search the registry | `GET /api/index.json` | free |
| One listing | `GET /listings/<slug>.json` | free |
| Is my site agent-readable? (A–F) | `GET /api/score?url=…` | free |
| …and how do I fix it? | `POST /api/audit` | $0.05 over x402 |
| Register a product | GitHub issue titled `[register]` | free |

The read endpoints need no key, no account and no payment. Only `/api/audit`
charges, and it tells you the terms in its own 402 — see the paying snippets.

## Verified

Every snippet in this directory was run against `https://index.kc-it.pl` on
2026-07-25. The paying ones were driven with real signing keys, and reach the
facilitator's balance check — the only thing between them and a completed
purchase is funding the wallet.

Client versions used: `x402@2.16.0` (Python), `@x402/fetch@2.19.0` and
`x402-fetch@1.2.0` (Node). The endpoint answers **both** x402 protocol versions,
so all three work.

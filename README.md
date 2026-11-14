# AI Product Index

An open registry and discovery API for AI products, agent tools, and MCP services.

- **Machine-readable registry:** One canonical page, JSON document, and `llms.txt` entry per product.
- **Search & discovery:** Ranked keyword search, NLWeb natural-language endpoint, and Streamable HTTP MCP server.
- **Agent-readability audits:** Free technical grading of crawler policies, metadata, content negotiation, and HTTPS.
- **Live Services:** [Live Index](https://index.percall.dev) · [OpenAPI](https://index.percall.dev/openapi.yaml) · [MCP Card](https://index.percall.dev/.well-known/mcp.json)
- **Documentation:** [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`DEPLOY.md`](DEPLOY.md) · [`NEXT.md`](NEXT.md) · [`TODO.md`](TODO.md)

## Status

Since 2026-09-05, `POST /api/audit` ($0.05 USDC over x402) is the only paid HTTP
endpoint. `/api/check`, `/api/liveness`, `/api/route` and `/api/watch` return
`410 endpoint_retired` without accepting payment. New watches and top-ups are
closed; existing prepaid weekly sweeps continue until their credits are exhausted.

The score measures technical checklist coverage, not AI visibility or referrals.
In the catalogs, "no credentials declared" does not mean free, and an HTTP
response does not prove successful authentication or tool execution.

## Register a product

Open a [registration issue](https://github.com/110kc3/seo/issues/new?template=register.yml)
containing JSON that conforms to the [published schema](https://index.percall.dev/api/schema.json).
The workflow validates it, checks for duplicate slugs and URLs, confirms the URL
responds, and publishes the listing. The original submitter can replace it through
the [update workflow](https://github.com/110kc3/seo/issues/new?template=update.yml).

## Quick Start

Requires Node.js 22 or newer. Generated files are committed and deterministic:
after changing listings, templates or build logic, build twice and confirm the
second run leaves no diff.

```bash
# Run test suite
node --test scripts/*.test.mjs

# Rebuild generated registry artifacts
node scripts/build.mjs

# Start local worker dev server
npx wrangler dev
```

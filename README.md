# AI Product Index

An open registry and discovery API for AI products, agent tools, and MCP services.

- **Machine-readable registry:** One canonical page, JSON document, and `llms.txt` entry per product.
- **Search & discovery:** Ranked keyword search, NLWeb natural-language endpoint, and Streamable HTTP MCP server.
- **Agent-readability audits:** Free technical grading of crawler policies, metadata, content negotiation, and HTTPS.
- **Live Services:** [Live Index](https://index.percall.dev) · [OpenAPI](https://index.percall.dev/openapi.yaml) · [MCP Card](https://index.percall.dev/.well-known/mcp.json)
- **Documentation:** [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`DEPLOY.md`](DEPLOY.md) · [`NEXT.md`](NEXT.md) · [`TODO.md`](TODO.md)

## Quick Start

```bash
# Run test suite
node --test scripts/*.test.mjs

# Rebuild generated registry artifacts
node scripts/build.mjs

# Start local worker dev server
npx wrangler dev
```

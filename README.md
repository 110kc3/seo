# AI Product Index

An open registry and discovery API for AI products, agent tools, and MCP services.

[Live index](https://index.percall.dev) · [JSON registry](https://index.percall.dev/api/index.json) · [OpenAPI document](https://index.percall.dev/openapi.yaml) · [MCP server card](https://index.percall.dev/.well-known/mcp.json)

AI Product Index publishes each accepted listing as structured HTML and JSON, then makes the registry available through search, NLWeb, MCP, feeds, sitemaps, and `llms.txt`. Products can register through a validated GitHub issue workflow; accepted changes are rebuilt, committed, and deployed automatically.

## What it provides

- A public, machine-readable registry with one canonical page and JSON document per product.
- Ranked search over names, descriptions, tags, categories, and pricing models.
- Natural-language queries through an NLWeb-compatible endpoint.
- A remote MCP server for product discovery, URL scoring, catalog search, and registration guidance.
- A free agent-readability score covering `llms.txt`, structured data, crawler policy, discovery manifests, content negotiation, canonical URLs, and HTTPS.
- Searchable MCP-server and x402-endpoint catalog snapshots with sampled availability data.
- Deterministic static builds, automated validation, and weekly listing health checks.

## Try it

Read the registry:

```bash
curl https://index.percall.dev/api/index.json
```

Search for a product:

```bash
curl 'https://index.percall.dev/api/search?q=document+automation&limit=5'
```

Ask a natural-language question:

```bash
curl https://index.percall.dev/ask \
  -H 'content-type: application/json' \
  -d '{"query":{"text":"Which products provide an MCP server?"}}'
```

Grade a public URL for agent readability:

```bash
curl 'https://index.percall.dev/api/score?url=https%3A%2F%2Fexample.com'
```

List the MCP tools:

```bash
curl https://index.percall.dev/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Any MCP client that supports Streamable HTTP can connect directly to:

```text
https://index.percall.dev/mcp
```

## Register a product

Registration uses GitHub issues and does not require an account with the index. Open a [registration issue](https://github.com/110kc3/seo/issues/new?template=register.yml) containing JSON that conforms to the [published schema](https://index.percall.dev/api/schema.json):

```json
{
  "slug": "example-product",
  "name": "Example Product",
  "url": "https://example.com",
  "description": "A concise description of what the product does.",
  "category": "api",
  "pricing": "free",
  "tags": ["automation", "documents"]
}
```

The workflow validates the schema, checks for duplicate slugs and URLs, confirms that the product URL responds, and publishes the listing. The original submitter can later use the [update workflow](https://github.com/110kc3/seo/issues/new?template=update.yml) to replace it.

An accepted listing receives:

- a crawlable HTML page with schema.org JSON-LD;
- an individual JSON document and inclusion in the full registry;
- inclusion in `llms.txt`, `llms-full.txt`, feeds, and the sitemap;
- a stable badge endpoint for READMEs and documentation.

The complete machine-oriented registration protocol is available in [`llms.txt`](https://index.percall.dev/llms.txt).

## Public interfaces

| Interface | Purpose |
|---|---|
| `/api/index.json` | Complete registry snapshot |
| `/api/search` | Ranked product search |
| `/ask` | NLWeb-compatible natural-language queries |
| `/mcp` | Model Context Protocol over HTTP |
| `/api/score` | Free agent-readability score for a public URL |
| `/api/mcp/search` | Search the MCP-server catalog |
| `/api/x402/search` | Search the x402-endpoint catalog |
| `/badge.svg` | Listing tier or readability-grade badge |
| `/llms.txt` | Concise machine-readable project and registration guide |
| `/openapi.yaml` | Complete HTTP API description |

See the [OpenAPI document](https://index.percall.dev/openapi.yaml) for request and response schemas. Implementation and protocol details live in [ARCHITECTURE.md](ARCHITECTURE.md).

## How it works

The project combines a deterministic static build with a small Cloudflare Worker:

1. `listings/*.json`, `templates/`, and `site.config.json` are the source of truth.
2. `scripts/build.mjs` validates the inputs and generates the HTML, JSON, manifests, feeds, and sitemap committed to the repository.
3. `worker/` serves dynamic search, NLWeb, MCP, scoring, routing, response negotiation, and aggregate request statistics.
4. GitHub Actions validate registration and update issues, rebuild the registry, and deploy accepted changes.
5. A weekly workflow checks listing health, refreshes readability scores, and samples the external catalogs.

The runtime has no package dependencies. Worker modules are written so that most behavior can be tested under plain Node.

## Repository layout

| Path | Contents |
|---|---|
| `listings/` | One source JSON file per registered product |
| `templates/` | Templates for generated pages and machine-readable documents |
| `worker/` | Cloudflare Worker routes and protocol handlers |
| `scripts/` | Build, validation, health, catalog, and administration scripts |
| `mcp/` | Optional local stdio MCP adapter |
| `api/` | Generated registry and catalog artifacts |
| `.well-known/` | Agent, MCP, security, and discovery manifests |

## Local development

Node.js 22 or newer is recommended.

```bash
node --test scripts/*.test.mjs
node scripts/build.mjs
npx wrangler dev
```

Use `scripts/*.test.mjs`, not `node --test scripts/`; Node treats a bare directory argument as a module path.

To simulate registration without opening a GitHub issue:

```bash
ISSUE_BODY='{"slug":"example-product","name":"Example Product","url":"https://example.com","description":"What it does.","category":"api","pricing":"free"}' \
ISSUE_USER=you SKIP_LIVENESS=1 node scripts/process-issue.mjs
```

Generated assets are deterministic and committed. After changing listings, templates, or build logic, run the build twice and confirm that the second run produces no diff.

## Deployment

Pushes to `main` run the test suite, verify that generated files are current, and deploy the Worker through GitHub Actions. See [DEPLOY.md](DEPLOY.md) for environment setup, Cloudflare bindings, credentials, operational checks, and recovery procedures.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — components, data flow, security boundaries, and protocol design.
- [DEPLOY.md](DEPLOY.md) — deployment and operations runbook.
- [NEXT.md](NEXT.md) — current project queue.
- [TODO.md](TODO.md) — completed work and decision history.

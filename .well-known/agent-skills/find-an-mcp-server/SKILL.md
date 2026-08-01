---
name: find-an-mcp-server
description: Search ~10,000 remotely-callable MCP servers by capability, transport, host and whether they need credentials. Use when looking for an MCP server to connect to, needing a tool source that requires no install, or asking what MCP servers exist for a task.
---

# Find an MCP server you can connect to right now

`https://index.percall.dev` mirrors the official MCP registry, filtered to the servers an agent
can actually reach.

## Search

```
GET https://index.percall.dev/api/mcp/search?q=github&auth=none
```

| parameter | meaning |
|---|---|
| `q` | what the server should do — "github issues", "browser automation" |
| `auth` | `none` for servers needing no credentials, `required` for the rest |
| `transport` | e.g. `streamable-http`, `sse` |
| `host` | substring match on hostname |
| `limit` | results to return |

Full catalog: `https://index.percall.dev/api/mcp/catalog.json`.
Aggregates and the exact scope rule: `https://index.percall.dev/api/mcp/stats.json`.

## The scope rule is the opinion

*Active, latest version, and remotely callable.* Every entry has a URL, so it can
be added without installing anything. **Servers distributed only as installable
packages are deliberately excluded** — this answers "what can I call right now",
not "what exists". The exclusion counts are published in `stats.json` so you can
see what the filter removed rather than trusting it.

## Two caveats worth carrying

**Some URLs are templates the publisher never filled in**, like
`https://{tenant_host}/mcp`. They are real registry entries and they are not
callable as-is; you need the publisher's own tenant value. They are counted as
`untestable` rather than dead, because the fault is the registry's data, not the
endpoint's.

**Some are dead.** A rotating sample is probed weekly and published at
`https://index.percall.dev/api/mcp/health.json`. A server confirmed unreachable twice running
carries `"unreachable": true` and is still returned — one weekly probe from one
network path is evidence, not proof. Have a fallback rather than skipping it.

## Connecting

Most entries speak streamable HTTP, so a client that takes a URL can add them
directly. For example, this index itself:

```
claude mcp add --transport http ai-product-index https://index.percall.dev/mcp
```

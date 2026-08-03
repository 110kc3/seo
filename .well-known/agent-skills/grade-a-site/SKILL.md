---
name: grade-a-site
description: Grade any public URL for agent-readability across 20 checks and get paste-ready fixes. Use when asked whether a site is readable by AI agents, why an agent cannot use a site, or how to make a site discoverable to LLMs and agents.
---

# Grade a site for agent-readability

Two endpoints on `https://index.percall.dev`. The free one tells you the grade and what failed;
the paid one tells you why and hands you the fix.

## Free — the grade and the failing checks

```
GET https://index.percall.dev/api/score?url=https://example.com
```

Returns a letter A–F, a score out of 100, and all 20 checks with pass/fail:
llms.txt (published, has a title and summary, llms-full.txt), robots.txt
(published, AI crawlers not blocked), sitemap.xml, schema.org JSON-LD, title and
meta description, Open Graph, canonical URL, machine-readable alternates, an A2A
agent card, and HTTPS.

It also returns `signals` — emerging 2026 surfaces that are **detected but not
scored**: Content Signals in robots.txt, the A2A 1.0 card path, an MCP server
card, an RFC 9727 API catalog, an Agent Skills index, and a Web Bot Auth key
directory. Absence is normal rather than negligent; adoption of most is still
tiny. They do not affect the grade.

Cached for an hour per URL. 20 uncached audits per hour per IP.

## Paid — the reason and the fix

```
POST https://index.percall.dev/api/audit
Content-Type: application/json

{"url": "https://example.com"}
```

Answers HTTP 402 with x402 payment terms. Pay it and the same 20 checks come
back with, for each failure, why it failed, a fix ranked by how much it is worth,
and a paste-ready snippet with the caller's own origin already substituted in.
Read the terms without provoking a 402 at `https://index.percall.dev/api/x402/info`.

## Reading the result

- **Grade bands**: `agent-ready` ≥ 80, `partially readable` ≥ 55, `weak` ≥ 30,
  below that `invisible to agents`.
- `next_steps` is already sorted by weight, so working down it fixes the most
  valuable thing first.
- A failing `ai_crawlers_allowed` usually means a host-level default rather than
  a deliberate choice — worth checking the CDN before rewriting robots.txt.

## What this cannot tell you

It reads what a site publishes. It cannot tell you whether the content is
*good*, whether the facts are true, or whether an agent will choose to use it.
A site can score 100 and still be useless.

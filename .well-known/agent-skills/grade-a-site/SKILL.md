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

The default check set is v2: all 20 checks count. With `?set=v1`, the
2026 signals are reported separately without affecting that version's score.
`interpretation` explains the limits; each free check includes `scope` and
`applicability` to distinguish site information from optional service interfaces.

Cached for an hour per URL. 60 uncached audits per hour per IP.

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

- **Coverage descriptions**: `high checklist coverage` ≥ 80, `partial checklist coverage` ≥ 55, `low checklist coverage` ≥ 30, below that `very low checklist coverage`. Numeric scores and A–F letter thresholds are unchanged.
- `next_steps` is already sorted by weight, so working down it fixes the most
  heavily weighted item first. First assess whether each check applies to the site; optional interfaces should describe capabilities that actually exist.
- A failing `ai_crawlers_allowed` usually means a host-level default rather than
  a deliberate choice — worth checking the CDN before rewriting robots.txt.

## What this cannot tell you

It reads what a site publishes. It cannot tell you whether the content is
*good*, whether the facts are true, or whether an agent will choose to use it.
It does not measure AI referrals, visibility or successful task completion. A content-only site need not offer MCP, A2A or APIs. Missing optional interfaces still affects this fixed checklist; a high score is not a reason to publish nonexistent capabilities.

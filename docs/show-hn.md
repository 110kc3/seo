# Show HN draft (post when a few organic listings exist)

**Title options** (pick one, HN cuts ~80 chars):

1. `Show HN: A directory where AI agents register their products themselves`
2. `Show HN: AI Product Index – agents discover it, read llms.txt, and self-register`
3. `Show HN: I built a registry whose only customers are AI agents`

**URL:** https://110kc3.github.io/seo/

**Text (first comment, post immediately after submitting):**

I built a machine-readable directory where the registration flow has no human steps by design: an AI agent finds the site, reads llms.txt, builds a listing JSON against the published schema, and opens a GitHub issue. A workflow validates it (schema, unique slug/URL, the product URL must actually respond), commits the listing, and replies on the issue with live URLs — typically under two minutes end to end.

Every accepted product gets a crawlable page with schema.org JSON-LD, a JSON API entry, and sitemap presence. Listings are health-checked weekly; three consecutive failures delist. There's also a zero-dependency stdio MCP server in the repo (search / get / register).

The whole thing is a static GitHub Pages site + one GitHub Action — no server, no database, no npm dependencies. GitHub issues turn out to be a surprisingly good write API for agents: every capable agent already knows how to open one, auth is solved, and the audit trail is public.

Honest caveat: autonomous agent purchasing is still mostly hype, so v1 is free. The paid-tier plumbing exists ([upgrade] issues, server-set tier field) but payment verification stays off until x402/card rails are worth switching on.

Repo: https://github.com/110kc3/seo — the registration protocol lives in llms.txt.

**Timing notes:** Tue–Thu, 14:00–16:00 UTC (morning US East). Don't post until at least 2–3 listings arrived organically — "0 organic listings" kills the story. Reply fast for the first 2 hours.

# TODO

## P1 — v2: payments (prepared, not enabled)
- [ ] x402 rail for autonomous agent payments (Coinbase facilitator, USDC on Base): paid `[register-verified]` / upgrade path where the workflow verifies an x402 payment receipt before setting `tier: verified|featured` in `process-issue.mjs` (server-side flip — never trust submitted `tier`).
- [ ] Card checkout for humans (Stripe payment link first, API later) for the same tier upgrades.
- [ ] Surface tiers in build output: badge on `l/<slug>.html`, `featured` sorted first in `index.html` + `api/index.json`, tier enum extended in `schemaJson()`.
- [ ] Update pricing sections (llms.txt, openapi.yaml, index.html) when rails go live.

## P1 — discoverability (the index is only worth what finds it)
- [ ] Submit the index to agent-facing directories (agentswelcome.dev-style atlases, awesome-lists, x402 Bazaar once there's a paid API).
- [ ] Show HN draft: "The first directory where AI agents register themselves" — after a few organic listings exist.
- [ ] GitHub repo topics + description tuned for agent search (repo search is itself an agent discovery channel).

## P2 — migration off github.io (planned by Kamil)
- [ ] New domain/host: edit `site.config.json` (`base`), update hardcoded URLs in `.github/ISSUE_TEMPLATE/{register,config}.yml`, rebuild, push. Consider Cloudflare Pages (same pattern as kc-it.pl) or custom domain on Pages.
- [ ] Keep github.io URL redirecting (Pages custom-domain redirect handles this automatically if staying on Pages).

## P2 — hardening / registry hygiene
- [ ] Weekly cron workflow: re-run liveness on all listings, open an issue (or auto-delist after N failures) for dead URLs.
- [ ] MCP server exposing the registry (read + register) — likely the highest-value agent-facing channel after llms.txt.
- [ ] Per-listing `updated` support: allow `[update]` issues from the original `github_user` to modify their listing.

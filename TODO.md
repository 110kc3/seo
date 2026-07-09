# TODO

## Blocked on Kamil (everything else is implemented)

- [ ] **Enable payments** — 3 steps, needs your credentials (full checklist in README → Payments): x402 wallet address + complete `verifyPayment()` against the facilitator; Stripe payment link; set prices in `templates/llms.txt`. The `[upgrade]` flow, tier ranking/badges, and `set-tier.mjs` manual flip are all live and tested.
- [ ] **Post Show HN** — draft ready in `docs/show-hn.md` (titles, body, timing). Wait for 2–3 organic listings first.
- [ ] **Migration off github.io** — your call on domain/host. Checklist in README → Migration (one config knob + two issue-template URLs).
- [ ] **Publish the domain-root discovery repo** — `/home/borg/repos/110kc3.github.io` is committed and ready; one `gh repo create --push` (exact command in `docs/distribution.md` §0). Without it the domain root 404s llms.txt/robots/agents.json and the agent-readiness audit scores 21/100; with it ~75 (certifiable). Blocked on you because it claims your `110kc3.github.io` namespace.
- [ ] **Directory submissions** — all researched with ready-to-run commands in `docs/distribution.md`: awesome-mcp-servers PR (agent-PRs fast-tracked 🤖), Awesome-llms-txt PR, llms-txt-hub, agentswelcome.dev API submit (needs §0 first). Blocked on you: they publish under your GitHub identity.

## Done (v1 + v2 autonomous scope, 2026-07-09)

- [x] Agent registry live at https://110kc3.github.io/seo/ — llms.txt, JSON API + schema, per-listing JSON-LD pages, sitemap/robots/OpenAPI, custom 404.
- [x] `[register]` flow — verified live end to end (accept / reject / duplicate, no commits on rejection).
- [x] `[update]` flow — original submitter replaces their listing; `created`/`tier` preserved, `updated` stamped.
- [x] `[upgrade]` flow — ownership + shape checks live; payment verification stubbed to `payments_not_enabled` until rails configured.
- [x] Tier system — `verified`/`featured` in schema, featured-first ranking, badges, `scripts/set-tier.mjs`.
- [x] Weekly health cron — 3-strike auto-delist, committed `health.json`, report issues.
- [x] MCP server — `mcp/server.mjs`, zero-dep stdio: search_products / get_product / register_product.
- [x] Repo topics + description tuned for GitHub search.
- [x] Show HN draft (`docs/show-hn.md`).

## Later / nice-to-have

- [ ] Automate Stripe reconciliation (webhook → repository_dispatch → set-tier) once there's a first paying customer.
- [ ] x402 Bazaar listing once the index itself exposes a paid x402 endpoint.
- [ ] Listing analytics: badge/click-through counters (needs non-static ingest — revisit after migration).

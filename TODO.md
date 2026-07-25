# TODO

## LIVE — https://index.kc-it.pl

Deployed 2026-07-25 from `main` by CI. Custom domain attached, Analytics Engine
enabled, KV bound, private revenue dashboard up. Full status table in DEPLOY.md.

## Blocked on Kamil

One thing stands between this and real revenue; the rest is distribution and
optional rails.

### The one that matters

- [ ] **Put $0.05 through it on testnet.** The only step left that code cannot do. Fund a *throwaway payer* wallet from a Base Sepolia USDC faucet — not the receiving address, since a 402 asks for someone else's money — and pay yourself with the copy-paste client in DEPLOY.md → Phase 2. Then confirm a replay is refused and the settlement shows on `sepolia.basescan.org`, and watch it appear on https://revenue.local.kc-it.pl.
- [ ] **Then go to mainnet** — `node scripts/verify-rail.mjs mainnet`, eyeball the asset on basescan once, set `"active": "mainnet"`, push. Details below.
### Distribution and optional rails

- [x] **Receiving address** — done 2026-07-25: `0x48934cDA4F8f3F692d4deEED3D2B4f15852E2424` (Binance Web3 Wallet, self-custodial, Base).
- [x] **Payment rail proven end to end** — done 2026-07-25. The official `x402-fetch@1.2.0` client was driven against a local `wrangler dev`: it parsed the 402, signed an EIP-3009 authorization, paid, and the **live** `x402.org` facilitator verified the signature and failed only on `invalid_exact_evm_insufficient_balance` (unfunded throwaway wallet). The same signature was also accepted through the v2 path. Nothing is left to prove but funding.
- [ ] **Swap the analytics token for a scoped one.** `/api/stats.json` publishes today because `push-secrets` mirrors the deploy token into `CF_ANALYTICS_TOKEN` — it turned out to satisfy Account Analytics: Read. But it also carries Workers Scripts: Edit, so a bug that ever exposed the Worker's env would hand over deploy rights. Create a token with **only** Account Analytics: Read, `gh secret set CF_ANALYTICS_TOKEN`, re-run `gh workflow run cf-admin -f action=push-secrets`; the mirror then stops on its own.
- [ ] **Optional: CDP API key** — no longer the only route to mainnet, so genuinely optional. Buys a free tier (1,000 tx/month) and auto-inclusion in the x402 Bazaar, which is real discovery for a site nobody visits. `portal.cdp.coinbase.com/access/api` → Secret API Key → Ed25519. The portal's x402 page is metrics-only and "Custodial Wallet" needs a business account — neither is the right door. Its `/supported` needs auth, so this is the one rail `verify-rail.mjs` cannot pre-check.
- [ ] **Optional: Stripe machine-payments access** — request it so the fiat rail (settles to the Stripe balance in USD, no crypto handling) becomes available later. The existing `pk_test_…` key belongs to the card rail and unlocks nothing for x402.
- [ ] **Post Show HN** — draft ready in `docs/show-hn.md`. Wait for 2–3 organic listings first. Worth rewriting the angle around the paid audit endpoint and the measured agent share, which are more interesting than "another directory".
- [x] **Publish the domain-root discovery repo** — done 2026-07-10: `110kc3/110kc3.github.io` live. Note this is now partly superseded — `index.kc-it.pl` is itself a domain root, so it serves its own `/llms.txt`, `/robots.txt`, `/sitemap.xml` and `/.well-known/agent.json`.
- [ ] **Directory submissions — now unblocked.** `https://index.kc-it.pl/` is live and every published URL resolves and returns 200, so the reason to wait is gone. Ready-to-run commands in `docs/distribution.md`; still blocked on you only because they publish under your GitHub identity. Submit the custom domain, never the old `110kc3.github.io/seo/` URL or the workers.dev fallback.

## Revenue dashboard — live at https://revenue.local.kc-it.pl

Tailnet only, and no token in the URL. Caddy on the Pi injects the bearer token
from `~/docker/.env`, so the secret never reaches a browser, address bar or
bookmark; the vhost also 404s anything outside `100.64.0.0/10`, because ports
80/443 are bound on every interface and DNS is routing rather than access
control. Publicly, `index.kc-it.pl/dashboard` is an ordinary 404 — its existence
is not disclosed. Full design and the three-place rotation procedure in
DEPLOY.md → Phase 5.

## The decision gate

The reason this work happened: after 16 days live, the registry had **zero organic registrations** — all 6 issues were self-authored E2E tests from 2026-07-09 — and GitHub Pages gave no logs, so there was no way to tell whether an agent had ever visited.

Once the Worker has been live for a week, read `/api/stats.json`:

- **`agent_share` is non-trivial** → the registry has an audience; keep feeding it and run the Show HN.
- **`agent_share` is ~0** → that is the answer. Stop investing in the registry and put the hours into Track A sales, where the bot-traffic statistics are the pitch rather than the product. The audit endpoint stands on its own either way.

## Done (v3.7 — score badge, publish guard, flows re-verified, 2026-07-25)

- [x] **Score badge** — `/badge.svg?slug=…&show=score` shows the live A–F grade from `scores.json`, not an audit per request: the badge renders in other people's READMEs, so it is hit by every page view of every listee. `scripts/score-listings.mjs` runs weekly in the health cron and asks our own public `/api/score`, which dogfoods the endpoint an agent would call. A transient failure keeps last week's grade rather than blanking a badge; a listing the cron has not reached says "not scored yet" rather than implying an F. Both badges are offered on every listing page.
- [x] **A guard against publishing source by accident** — `clients/` was being served as static assets. The asset directory is the repo root and `.assetsignore` is a denylist, so anything added at the top level ships unless someone remembers; this had already bitten with `DEPLOY.md`/`ARCHITECTURE.md` and `.wrangler`. A test now fails on any top-level entry that is neither ignored nor deliberately classified as site content. Verified by adding a directory and watching it fail — and it caught `scores.json` on its first run.
- [x] **The autonomous flows re-verified**, untested since the Cloudflare migration: `[register]` accepts, `[update]` preserves `created`/`tier` and refuses a non-owner, duplicate slugs and malformed bodies are refused, and every rejection exits non-zero so the workflow replies and closes as not-planned. `[upgrade]` now reaches **live on-chain receipt verification** and correctly answers `tx_not_found` for an invented hash — the payment path had never run post-migration.
- [x] Workflows off deprecated Node 20. 109 tests.

## Done (v3.6 — signing, badges, clients, DX, 2026-07-25)

- [x] **RFC 9421 response signing** — every response carries `Content-Digest` and an Ed25519 `Signature` over `@status`, content-digest and the request's `@authority`/`@path`, so a signature cannot be lifted onto another resource. Keys at `/.well-known/http-message-signatures-directory` (kid = RFC 7638 thumbprint), in the format Cloudflare's reference deployment serves. The public half is derived from the secret at runtime, so directory and key cannot drift. Unkeyed → nothing signed, directory 404s.
- [x] **web-bot-auth on outbound audits** — the auditor signs its own fetches (`tag="web-bot-auth"` + `Signature-Agent`), so a site being audited can verify us cryptographically instead of trusting a user-agent string.
- [x] **`/api/stats.json` publishes.** `stats-probe` found the deploy token already satisfies Account Analytics: Read, so the decision gate is readable now rather than after a second token. Over-privileged — see above.
- [x] **`/badge.svg?slug=…`** — the reciprocal-link loop. Hand-built SVG (no shields.io in the path), reads the committed registry, never audits. Every failure mode returns a 200 image, because these render in other people's READMEs. Copy-paste markdown on each listing page.
- [x] **`clients/`** — paste-ready LangChain, LlamaIndex, CrewAI and LangChain.js tools, plus runnable Node and Python x402 payment examples. Not published packages: a release pipeline is a commitment this index has not earned. All three official x402 clients were run against production first.
- [x] **x402 snippets on the homepage** — a paid endpoint is unusable to someone who doesn't know how to pay it. Testing them corrected the official docs: the Python quickstart's `x402[httpx]` extra cannot sign, `x402[evm]` is needed.
- [x] **A zero-dependency API explorer** instead of Swagger UI/Scalar — a 7-endpoint read API already described in llms.txt and openapi.yaml does not justify a CDN bundle on every page view, on a site whose pitch is being clean.
- [x] **Duplicate hostnames retired** — GitHub Pages disabled, `workers_dev = false`. `index.kc-it.pl` is the only public copy.
- [x] Show HN draft rewritten around the paid endpoint and the traffic numbers. 107 tests.

## Done (v3.5 — free score, paid fixes, 2026-07-25)

- [x] **`GET /api/score?url=…` — free A–F grade**, with all 13 checks by label and pass/fail. Homepage now leads with an input box that calls it: type a domain, get a grade. The audit runs server-side because a browser cannot read another origin's llms.txt or robots.txt.
- [x] **The paid endpoint now sells fixes, not just a verdict** — every failing check comes back with a paste-ready code snippet (llms.txt, JSON-LD, robots.txt AI-crawler stanza, sitemap, OG tags, canonical, alternates, agent card) with the caller's own origin substituted in, plus `next_steps` ranked by weight.
- [x] **The paywall boundary is a whitelist, not a delete.** `freeView()` names the fields the free tier keeps, so a field added to the audit later cannot leak by omission; a test asserts a hypothetical new paid field stays out.
- [x] **Abuse boundary for a free URL-fetching endpoint** — same `urlError()` validation as the paid path (no SSRF hop), results cached per URL for an hour, 20 uncached audits/hour/IP. Cache hits are unmetered because they cost nothing. `/api/score` is its own telemetry bucket, so free→paid conversion is measurable.
- [x] **A Worker cannot fetch its own hostname** (522, on both hostnames), so auditing our own site — the 100/100 showcase, and the first URL anyone types — failed. Same-host targets are now served from the ASSETS binding. 98 tests.

## Done (v3.4 — dashboard on the tailnet, and two live bugs, 2026-07-25)

- [x] **Workers Assets' `.html` redirect was leaking, and it broke two things.** `html_handling` defaults to rewriting `/foo.html` → `/foo` with a 307. Returned verbatim, that made *every published listing URL* answer 307 rather than 200 — sitemap, canonical, JSON-LD `@id` and llms.txt all say `/l/<slug>.html`, so every canonical URL pointed at a redirect on a site whose product is machine-readability. Worse, the dashboard fetched `/dashboard.html`, got the 307 to `/dashboard` and handed it back, so `/dashboard` redirected to itself: **it had never been reachable on any path.** Asset fetches now absorb one internal hop. Fixed here rather than with `html_handling = "none"`, which would stop `/` serving index.html and would couple the build to Cloudflare.
- [x] **Private dashboard on the tailnet** — `revenue.local.kc-it.pl`, same pattern as `vault`/`obsidian`/`claude`: Caddy vhost, TLS via Cloudflare DNS-01, wildcard `*.local.kc-it.pl` A record on the Pi's Tailscale address. Caddy injects `Authorization: Bearer`, so no token in the URL, plus a `remote_ip 100.64.0.0/10` guard as defence in depth.
- [x] **`cf-admin -f action=push-secrets`** — pushes `DASHBOARD_TOKEN` from repo secrets into the Worker without the value touching a command line, a log or the repo.
- [x] Analytics Engine binding restored; custom domain confirmed to survive redeploys.
- [x] 90 tests.

## Done (v3.3 — first deployment, 2026-07-25)

- [x] **Deployed.** CI now builds, tests, and ships to Cloudflare on every push to `main`. Four failures got there, each a real problem rather than a retry: `wrangler-action@v3`'s pinned wrangler could not parse import attributes or `run_worker_first`; Analytics Engine needed an account-level opt-in; the custom domain needed zone permissions the token lacks; and `workers_dev` placed after `[assets]` was silently parsed as `assets.workers_dev`.
- [x] **Deploy with `npx wrangler@4`** instead of `wrangler-action@v3` — the action's wrangler rejected config that current wrangler accepts without warning. Same version as `cf-admin.yml` now.
- [x] **`cf-admin.yml`** — a manual workflow for the account operations that need the API token (`kv-setup`, `whoami`, `subdomain`). The token exists only as a repo secret, so these have nowhere to run locally without copying a credential onto a machine.
- [x] **Custom domain kept out of `wrangler.toml`** — one zone-scoped trigger call failing took the whole deploy with it, workers.dev included. Attached out-of-band instead, so CI stays account-scoped and a domain change cannot break a deploy.
- [x] **The audit's score could exceed its own maximum** — the 13 check weights sum to 105, not the 100 the code claimed, so a fully agent-ready site was returned `score: 105` against `max_score: 100`. Found by auditing the live deployment. Now normalised to a percentage of achievable weight, with scoring extracted into a pure exported function so the invariant is testable (`auditUrl` needs HTMLRewriter and cannot run under `node --test`).
- [x] **The audit executed for the first time** — it was the only path never run, being both paywalled and HTMLRewriter-dependent. Exercised on the real Workers runtime via a throwaway harness: 13 checks, this site 100/100 "agent-ready", example.com 5/100.
- [x] 87 tests.

## Done (v3.2 — the rail actually works, 2026-07-25)

Three defects found by running the thing instead of reading it. Each would have
survived deployment and cost real money or real payments.

- [x] **x402 v1 is now served alongside v2** — the reference client (`x402-fetch@1.2.0`, current npm latest) *threw a ZodError* on our v2-only 402: it requires `network: "base-sepolia"` rather than a CAIP-2 id, `maxAmountRequired` rather than `amount`, and it sends `X-PAYMENT`, not `PAYMENT-SIGNATURE`. A perfect deploy would still have taken zero payments. One 402 now answers both: v2 in the `PAYMENT-REQUIRED` header, v1 in the body (they cannot be merged into one `accepts` array — a v1 client validates the whole array and rejects the response). Receipts go back in whichever header the payer listens on, and the replay nonce is keyed on the CAIP-2 network so it spans both versions rather than allowing one replay per version.
- [x] **`asset_name` is per-profile** — it is published as the EIP-712 domain the payer signs against, and USDC's own `name()` is `"USDC"` on Base Sepolia but `"USD Coin"` on Base mainnet. The single shared value would have published a wrong domain on mainnet, making the facilitator reject *every* payment as an invalid signature.
- [x] **`.wrangler/` and the root runbooks are excluded from the asset upload** — the asset directory is the repo root, so a `wrangler deploy` from a machine that had ever run `wrangler dev` would have published the local KV state at `/.wrangler/…`. `DEPLOY.md` and `ARCHITECTURE.md` were likewise being served (README/TODO were already excluded, so this was an oversight, not a decision). `.wrangler/` is gitignored too.
- [x] **`scripts/verify-rail.mjs`** — pre-flight for any profile: reads the token's `name`/`symbol`/`decimals`/`version` off chain and asks the facilitator what it will settle, then compares both against the config. Catches the two mistakes above, and the third one below, before money is involved.
- [x] **The mainnet facilitator was wrong** — `mainnet` pointed at `x402.org/facilitator`, which is **testnet only** (its `/supported` lists no Base mainnet, and the x402 docs say not to use it in production). Now PayAI, from the official facilitator directory: no API key, and it advertises Base mainnet under both protocol versions.
- [x] 86 tests (was 63), including the v1 transport, cross-version replay protection, per-version receipt headers, and invariants on the shipped `site.config.json` itself.

## Done (v3.1 — x402 rail switched on, 2026-07-25)

- [x] Named rail profiles (`testnet` / `mainnet` / `cdp`) with an `active` selector and one shared resolver (`scripts/x402-config.mjs`), used by both the Worker and the `[upgrade]` issue flow.
- [x] Receiving address wired in; audit priced at $0.05 (`50000` atomic USDC).
- [x] CDP Bearer-JWT authentication on WebCrypto, zero new dependencies — EdDSA and ES256, with the `uris` claim binding each token to a single route.
- [x] `GET /api/x402/info` — public payment terms without provoking a 402; referenced from llms.txt, the agent card and OpenAPI.
- [x] Mainnet profiles ship with `asset` blank so an unverified contract address cannot take payments.
- [x] 63 tests passing, including real Ed25519/ES256 signature round-trips.

## Done (v3 — Cloudflare migration + paid endpoint, 2026-07-25)

- [x] Migrated off GitHub Pages to a Cloudflare Worker with static assets (`wrangler.toml`, `worker/`, `.assetsignore`, `.github/workflows/deploy.yml`). Base URL is now `https://index.kc-it.pl`.
- [x] Per-request measurement to Analytics Engine (bucketed path, classified client type, method, status class, truncated UA, ASN — no IPs) + public `/api/stats.json` with `agent_share`.
- [x] `POST /api/audit` — 13-check agent-readability audit, paid per call over x402 v2 (PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE). Target URL validated before any charge.
- [x] Payment-term enforcement server-side (scheme/network/asset/payTo/amount + independent authorization check), BigInt amount comparison, reserve-before-settle KV nonce replay protection.
- [x] `[upgrade]` rail completed — on-chain receipt verification in `scripts/x402-receipt.mjs` (success, confirmations, ERC-20 `Transfer` to our address in the right asset for at least the tier price) + a committed `payments.json` ledger that burns spent transaction hashes.
- [x] `Link:` alternates header and `Accept`-based content negotiation — the two agent-readiness checks that static hosting made impossible.
- [x] `.well-known/agent.json` A2A agent card, generated by the build (only possible now that the index sits at a domain root).
- [x] 54 tests covering classification, negotiation, payment-gate rejection paths, the audit's SSRF boundary, robots.txt group scoping, and receipt verification.

## Done (v1 + v2 autonomous scope, 2026-07-09)

- [x] Agent registry live — llms.txt, JSON API + schema, per-listing JSON-LD pages, sitemap/robots/OpenAPI, custom 404.
- [x] `[register]` flow — verified live end to end (accept / reject / duplicate, no commits on rejection).
- [x] `[update]` flow — original submitter replaces their listing; `created`/`tier` preserved, `updated` stamped.
- [x] Tier system — `verified`/`featured` in schema, featured-first ranking, badges, `scripts/set-tier.mjs`.
- [x] Weekly health cron — 3-strike auto-delist, committed `health.json`, report issues.
- [x] MCP server — `mcp/server.mjs`, zero-dep stdio: search_products / get_product / register_product.
- [x] Repo topics + description tuned for GitHub search.
- [x] Show HN draft (`docs/show-hn.md`).

## Later / nice-to-have

- [ ] Join the Cloudflare Monetization Gateway waitlist — being on Cloudflare is the prerequisite, and it would let the same 402 metering apply to `/api/index.json` without code.
- [ ] Automate Stripe reconciliation (webhook → repository_dispatch → set-tier) once there's a first paying customer.
- [ ] x402 Bazaar listing — now genuinely applicable, since the index exposes a paid x402 endpoint.
- [x] ~~RFC 9421 web-bot-auth response signing~~ — done 2026-07-25, both directions.
- [ ] Publish the `clients/` wrappers as real packages (PyPI + npm) — only once there is traffic that justifies a release pipeline.
- [x] ~~Score badge variant~~ — done 2026-07-25 as `/badge.svg?slug=…&show=score`, fed by `scores.json` from the weekly cron.
- [x] ~~Retire the old `110kc3.github.io/seo/` Pages deploy~~ — done 2026-07-25.

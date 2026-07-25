# TODO

## Blocked on Kamil (everything else is implemented)

Two steps stand between this and taking money. Both need your Cloudflare login;
neither is code. Full detail in DEPLOY.md → Phase 1.

- [ ] **1. Cloudflare credentials** — add repo secrets `CLOUDFLARE_API_TOKEN` (dashboard → My Profile → API Tokens → *Edit Cloudflare Workers* template) and `CLOUDFLARE_ACCOUNT_ID` (Workers & Pages → right sidebar). `gh secret list` is currently empty, which is why every `deploy` run skips the deploy step and exits green. `deploy.yml` itself is already on `main` and running.
- [ ] **2. KV namespace** — `npx wrangler kv namespace create PAYMENTS`, paste the id over `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.toml`. Then `gh workflow run deploy`. DNS for `index.kc-it.pl` should appear automatically (`wrangler.toml` declares the custom domain); add it by hand under the `kc-it.pl` zone if not.
- [x] **Receiving address** — done 2026-07-25: `0x48934cDA4F8f3F692d4deEED3D2B4f15852E2424` (Binance Web3 Wallet, self-custodial, Base).
- [x] **Payment rail proven end to end** — done 2026-07-25. The official `x402-fetch@1.2.0` client was driven against a local `wrangler dev`: it parsed the 402, signed an EIP-3009 authorization, paid, and the **live** `x402.org` facilitator verified the signature and failed only on `invalid_exact_evm_insufficient_balance` (unfunded throwaway wallet). The same signature was also accepted through the v2 path. Nothing is left to prove but funding.
- [ ] **Run the testnet rehearsal** — fund a *throwaway payer* wallet (not the receiving address — the 402 asks for someone else's money) from a Base Sepolia USDC faucet and pay yourself $0.05. Copy-paste client in DEPLOY.md → Phase 2. Settlement shows on `sepolia.basescan.org`, not in the Binance app (wallets don't list testnets).
- [ ] **Go to mainnet** — the `mainnet` profile is now filled in and pre-checked: asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Circle's published address, confirmed on chain: name "USD Coin", symbol USDC, 6 decimals, version 2), facilitator PayAI. Run `node scripts/verify-rail.mjs mainnet`, eyeball the address on basescan once, then set `"active": "mainnet"` and push. **No Coinbase account needed** — see below.
- [ ] **Optional: CDP API key** — no longer the only route to mainnet, so genuinely optional. Buys a free tier (1,000 tx/month) and auto-inclusion in the x402 Bazaar, which is real discovery for a site nobody visits. `portal.cdp.coinbase.com/access/api` → Secret API Key → Ed25519. The portal's x402 page is metrics-only and "Custodial Wallet" needs a business account — neither is the right door. Its `/supported` needs auth, so this is the one rail `verify-rail.mjs` cannot pre-check.
- [ ] **Optional: Stripe machine-payments access** — request it so the fiat rail (settles to the Stripe balance in USD, no crypto handling) becomes available later. The existing `pk_test_…` key belongs to the card rail and unlocks nothing for x402.
- [ ] **Post Show HN** — draft ready in `docs/show-hn.md`. Wait for 2–3 organic listings first. Worth rewriting the angle around the paid audit endpoint and the measured agent share, which are more interesting than "another directory".
- [x] **Publish the domain-root discovery repo** — done 2026-07-10: `110kc3/110kc3.github.io` live. Note this is now partly superseded — `index.kc-it.pl` is itself a domain root, so it serves its own `/llms.txt`, `/robots.txt`, `/sitemap.xml` and `/.well-known/agent.json`.
- [ ] **Directory submissions** — ready-to-run commands in `docs/distribution.md`. **Do these against `https://index.kc-it.pl/`, only after the Worker is live** — the old `110kc3.github.io/seo/` URL should never reach an external directory, since nothing links to it yet and re-submitting to fix stale links is painful. Blocked on you: they publish under your GitHub identity.

## Revenue dashboard

Private by construction — see DEPLOY.md → Phase 5. Set `DASHBOARD_TOKEN`, open
`/dashboard.html?token=…` once, and the Worker trades it for an HttpOnly session
cookie. Everyone else gets a 404, including before the secret is ever set, so
nothing is exposed in the meantime.

## The decision gate

The reason this work happened: after 16 days live, the registry had **zero organic registrations** — all 6 issues were self-authored E2E tests from 2026-07-09 — and GitHub Pages gave no logs, so there was no way to tell whether an agent had ever visited.

Once the Worker has been live for a week, read `/api/stats.json`:

- **`agent_share` is non-trivial** → the registry has an audience; keep feeding it and run the Show HN.
- **`agent_share` is ~0** → that is the answer. Stop investing in the registry and put the hours into Track A sales, where the bot-traffic statistics are the pitch rather than the product. The audit endpoint stands on its own either way.

## Done (v3 — Cloudflare migration + paid endpoint, 2026-07-25)

- [x] Migrated off GitHub Pages to a Cloudflare Worker with static assets (`wrangler.toml`, `worker/`, `.assetsignore`, `.github/workflows/deploy.yml`). Base URL is now `https://index.kc-it.pl`.
- [x] Per-request measurement to Analytics Engine (bucketed path, classified client type, method, status class, truncated UA, ASN — no IPs) + public `/api/stats.json` with `agent_share`.
- [x] `POST /api/audit` — 13-check agent-readability audit, paid per call over x402 v2 (PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE). Target URL validated before any charge.
- [x] Payment-term enforcement server-side (scheme/network/asset/payTo/amount + independent authorization check), BigInt amount comparison, reserve-before-settle KV nonce replay protection.
- [x] `[upgrade]` rail completed — on-chain receipt verification in `scripts/x402-receipt.mjs` (success, confirmations, ERC-20 `Transfer` to our address in the right asset for at least the tier price) + a committed `payments.json` ledger that burns spent transaction hashes.
- [x] `Link:` alternates header and `Accept`-based content negotiation — the two agent-readiness checks that static hosting made impossible.
- [x] `.well-known/agent.json` A2A agent card, generated by the build (only possible now that the index sits at a domain root).
- [x] 54 tests covering classification, negotiation, payment-gate rejection paths, the audit's SSRF boundary, robots.txt group scoping, and receipt verification.

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
- [ ] RFC 9421 web-bot-auth response signing — now possible on Workers; was one of the audit checks static hosting could never pass.
- [ ] Retire the old `110kc3.github.io/seo/` Pages deploy once `index.kc-it.pl` is confirmed live.

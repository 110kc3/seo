# AI Product Index

A machine-readable directory ("SEO for AIs") where **AI products register themselves so AI agents can discover them**. The customers are AI agents acting autonomously: an agent finds the site, reads `llms.txt`, and registers a product with zero human steps.

> 🟢 **Live, on real money, and proven.** https://index.percall.dev is deployed with the payment rail on **mainnet** — `POST /api/audit` quotes $0.05 in USDC on Base and settles it to the receiving address. The rail completed its first end-to-end settlement on 2026-07-29: paid by the stock `x402-fetch` client, settled on chain, replay refused, recorded on the revenue dashboard. Details in **[DEPLOY.md](DEPLOY.md)** → Phase 3.3. Migrated the same day from `index.kc-it.pl`, which stays attached and answers a method-preserving 308 — percall.dev is the umbrella domain for the paid-services portfolio this is becoming.
>
> 🟢 **Two products, one Worker, three hostnames** (since 2026-08-03). `percall.dev` serves the portfolio page; `index.percall.dev` is the AI Product Index; `router.percall.dev` is **The Router** — live probing and routing at $0.005 per call, plus prepaid weekly watches at $0.005 per sweep. The one-shot Router endpoints settled real money on Base mainnet on 2026-08-03; watch delivery was subsequently proven through outage and recovery. Each host owns its own paths and 308s everything else, so there is exactly one address per document.

**Documentation:** [NEXT.md](NEXT.md) — **what's outstanding, and whose turn it is** · [DEPLOY.md](DEPLOY.md) — how to get it live, phase by phase · [ARCHITECTURE.md](ARCHITECTURE.md) — how it works and why · [TODO.md](TODO.md) — the changelog, and the reasoning behind each change

- **Registration is free and stays free**: registering *is* the "purchase" — an agent opens a GitHub issue with listing JSON, a workflow validates and publishes it.
- **The paid product is `POST /api/audit`**: an agent-readability audit of any URL, priced per call over x402 (HTTP 402). Its value does not depend on how many listings the registry holds, which is why it — not the tier upgrade — is what sits behind the payment gate.
- **Paid tiers** (`verified`, `featured`) exist in the schema and ranking; the `[upgrade]` flow verifies x402 receipts on chain.

What a listed product gets: a crawlable HTML page with schema.org JSON-LD (`/l/<slug>.html`), presence in the JSON registry (`/api/index.json` + `/listings/<slug>.json`), sitemap inclusion, and llms.txt/llms-full.txt presence.

## Strategy: two tracks, one build

- **Track A — human-paid GEO service (revenue now).** Humans already pay $29–489/mo for AI visibility. The offer: done-for-you llms.txt + schema.org JSON-LD + agent-readability audit on the customer's own domain. Sold via the landing page's "For humans" section — `[hire]` issue or email. First jobs delivered by hand; no payment infra until someone pays.
- **Track B — the agent registry (asset that ages).** This repo. It markets Track A: every listing page is a live demo of the deliverable, and the funnel is built in (agent registers free → operator sees the listing → upsell). The seed listings are the registry itself, the Track A service, and the operator's seven other deployed sites (dogfood).

## How it works

Static build in the repo root, served by a **Cloudflare Worker with static assets** (`wrangler.toml` → `worker/index.js`). Zero runtime dependencies; plain-Node scripts. Build and test with Node ≥ 22 (the same version CI uses).

The Worker exists for the three things GitHub Pages structurally could not do:

| | GitHub Pages | Worker |
|---|---|---|
| HTTP 402 + payment manifest | impossible | `POST /api/audit` |
| Custom response headers, `Accept` negotiation | impossible | `Link:` alternates, JSON/markdown variants |
| Request logs | none at all | Analytics Engine → `/api/stats.json` |

That last row is the point: before the migration there was no way to tell whether a single agent had ever hit the site.

**Worker routes** (`worker/`):
- `GET /api/search?q=…` — ranked search over the registry, with `category`, `tag` and `limit`. Matching is weighted (name > tags > slug > description) and tiered (whole word > substring > shared stem), because on a corpus this small a scorer that can rank an unrelated listing above an exact name match is worse than one that returns nothing: an agent can widen its own query, but it cannot tell a confident wrong answer from a right one. A zero-result answer reports what the corpus *does* contain and where to register, so a dead end still teaches something. `discovery.js`.
- `POST /ask` — **NLWeb** ([nlweb.ai](https://nlweb.ai/docs/specification)). Natural language in, schema.org objects out, grounded only in the registry — nothing is generated. Strips stop-words, then applies a relevance floor at half the top score, because "polish property auctions" matching seven of eight listings on the word "polish" is a worse answer than the two right ones. Accepts the spec's `{"query": {"text": …}}`, a bare `{"query": "…"}`, and `GET ?query=…`, because every hand-written client gets the nesting wrong once. `discovery.js`.
- `POST /mcp` — **Model Context Protocol over streamable HTTP**. No auth, nothing to install: any MCP client that accepts a URL can add this index as a tool source (`claude mcp add --transport http ai-product-index https://index.percall.dev/mcp`). Six tools: `search_products`, `get_product`, `score_url`, `search_x402_endpoints`, `search_mcp_servers`, `how_to_register`. `score_url` is proxied through the real `/api/score` handler rather than reimplemented, so an MCP caller and a browser cannot disagree about a grade. Only the JSON-RPC half of the transport is implemented — a server with no server-initiated messages has nothing to stream, and `initialize` says so by declaring only `tools`. `discovery.js`.
- `GET /badge.svg?slug=…` — the README badge a listed product embeds; `&show=score` shows its live A–F grade instead of its tier. Reads the committed registry and `scores.json`, never audits, and always returns a 200 image: it renders inside someone else's README, where a 4xx is a broken icon. Grades are refreshed weekly by `scripts/score-listings.mjs` in the health cron. `badge.js`.
- `GET /.well-known/http-message-signatures-directory` — Ed25519 public keys for the RFC 9421 signatures on every response. `signing.js`.
- `GET /api/score?url=…` — **free**. The A–F letter grade, the numeric score, and all 20 checks by label with pass/fail. This is what the input box on the homepage calls; the audit runs server-side because a browser cannot read another origin's llms.txt or robots.txt. Cached per URL for an hour (cache hits unmetered), 20 uncached audits/hour/IP. `score.js`.
- `POST /api/audit` — **paid**. The same 20 checks plus, for each failure, why it failed, a fix ranked by weight, and a paste-ready code snippet with the caller's own origin substituted in. Validates the target with `urlError()` **before** charging, then gates on x402. `audit.js`.
- `GET /api/liveness?url=…` — **paid, on `router.percall.dev`.** Probes one machine-payable endpoint right now: whether it answered, how fast, and the payment terms it currently quotes, parsed from its own 402 in either x402 version. What is sold is *freshness* — the catalogs and their weekly aggregates stay free, but the x402 Bazaar keeps an entry for 30 days after its last settlement, so "listed" and "answers" are different facts and only one was published anywhere. `route.js`.
- `POST /api/route` — **paid, on `router.percall.dev`.** `{"q": "unit conversion", "max_price": 0.01}` → candidates ranked by the catalog's own search, each probed live, each with the terms it quotes now and the URL to call. Endpoints that did not answer are reported rather than dropped, and a query that matches nothing is not charged for. `route.js`.
- `POST /api/watch` — **paid, on `router.percall.dev`.** Prepay 4–52 weekly sweeps of one endpoint at $0.005 each. The payer address owns the watch; the webhook fires only on an answering→failing or failing→answering edge, and once when credits run out. There is no account, subscription mandate, or later charge. `watch.js`.
- Both carry the endpoint's **history** — probes, answered, consecutive failures, and how many of the last 30 observations answered — accumulated from live probes rather than a crawl, so the answer improves the more the service is used. Neither ever pays: an unpaid probe of a paid endpoint returns its 402, and a 402 states its terms, so **the caller pays the endpoint directly from its own wallet**. This deployment holds no key that could sign a transfer, and a test forbids any module under `worker/` from setting an outbound payment header.
- `GET /api/stats.json` — 30-day request counters by inferred client type, path bucket and **hostname**, plus `agent_share`. Reads the Analytics Engine dataset over the SQL API; reports `stats_not_enabled` without credentials. `stats.js`.
- `GET /api/x402/info` — the active rail's payment terms and the protocol versions accepted, so an agent can read the price without provoking a 402.
- `GET /api/revenue.json` + `/dashboard.html` — the revenue ledger and its dashboard, **private**. The page itself is gated, not just the data: unauthorized requests get the ordinary 404, so its existence is never disclosed. Access is via `?token=<DASHBOARD_TOKEN>` once, traded for an HttpOnly session cookie. The dashboard labels testnet settlements as testnet rather than calling them revenue. `revenue.js`.
- Everything else falls through to the `ASSETS` binding, decorated by `negotiate.js` (`Link:` header, `Accept`-based content negotiation) — the two agent-readiness checks the audit scored as impossible on static hosting.
- Every request is logged to Analytics Engine with a bucketed path, a classified client type (`classify.js`), method, status class, truncated UA and ASN. **No IP addresses.**

**Source of truth** (hand-edited or workflow-written):
- `listings/<slug>.json` — one file per listing
- `templates/` — index.html, 404.html, llms.txt, robots.txt, openapi.yaml with `{{BASE}}`/`{{REPO}}`/`{{COUNT}}`/`{{LISTINGS_HTML}}` placeholders
- `site.config.json` — base URL + repo slug (the **single knob for migration**)
- `scripts/validate.mjs` — the security boundary: field rules, `validate()`, `reconstruct()`, `esc()`, `jsonLd()`, plus `schemaJson()` so the published schema is generated from the same constants that enforce it

**Generated by `node scripts/build.mjs`** (committed; deterministic — no timestamps, build twice → zero diff): `index.html`, `404.html`, `llms.txt`, `llms-full.txt`, `robots.txt`, `openapi.yaml`, `sitemap.xml`, `api/index.json`, `api/schema.json`, `.well-known/agent.json` (A2A card), `.well-known/agents.json` (the plural agents-manifest — a different spec, read by agent-readiness auditors), `.well-known/security.txt` (RFC 9116; its `Expires` is hardcoded in the template because the build may not stamp a timestamp, and a test fails once it passes), `l/*.html` (the `l/` dir is wiped and rebuilt so removed listings can't leave stale pages).

Plus the surfaces whose whole job is to make the routes above findable by something that only knows the domain: `.well-known/mcp.json` (MCP server card — SEP-1649/2127 are draft, so it carries only the fields both drafts agree on), `opensearch.xml` (still the one format that turns a bare domain into a callable search box), `feed.xml` + `feed.json` (a directory that gains entries is a feed), and `.well-known/ai-plugin.json` (superseded, and probed often enough that answering costs less than the 404s). A test asserts the manifests cannot advertise a route the Worker does not have.

**Write paths (the autonomous transactions)** — `.github/workflows/register.yml`, gated on issue-title prefix (not a label, which REST-API agents couldn't set):
- **`[register]`** — new listing. `scripts/process-issue.mjs` (input via env only, never shell-interpolated): 20 KB cap → parse (```json fence or bare body) → `validate()` → unique slug + normalized-URL dedup → ≤ 10 listings per GitHub account → liveness check (product URL must answer < 400 in 10 s) → write reconstructed `listings/<slug>.json`.
- **`[update]`** — full replacement of an existing listing; only the original `github_user` (or the repo owner) may update; `created`/`github_user`/`tier` preserved, `updated` stamped.
- **`[upgrade]`** — paid tier change (`{"slug", "tier": "verified|featured", "rail": "x402", "receipt": {"transaction": "0x…"}}`): ownership + shape checks, then on-chain receipt verification via `scripts/x402-receipt.mjs` — the transaction must have succeeded, have enough confirmations, and contain an ERC-20 `Transfer` of at least the tier price in the configured asset to `payments.x402_address`. Spent transaction hashes are burned into the committed `payments.json` ledger so one payment cannot buy two upgrades. Rejects `payments_not_enabled` while the rail is unconfigured; `rail: "card"` returns `manual_reconciliation`.
- All modes: build + commit + push with a reset-and-redo retry loop ×3 (not an Actions `concurrency` group, which silently cancels queued runs; after `reset --hard` the dedup re-runs, so a lost race fails cleanly), then a machine-readable bot comment (`{"ok":…,"code":…,"errors":…}`) and issue close. Pages redeploys on the push (~1 min).

**Tiers**: `free` < `verified` < `featured` — paid tiers sort first in the index and get a badge. Manual flip (e.g. after an out-of-band payment): `node scripts/set-tier.mjs <slug> <tier>`, then commit + push.

**Health** — `.github/workflows/health.yml` (Mondays 04:17 UTC + manual dispatch): `scripts/check-liveness.mjs` re-checks every listing URL; strike state in committed `health.json`; **3 consecutive weekly failures delist** (page 404s, registry updated); failures/delistings reported as a GitHub issue.

**Catalog liveness** — `scripts/probe-catalogs.mjs`, same weekly cron: neither upstream registry checks whether its entries still answer, so a rotating sample of both catalogs is probed and the results published at `api/{x402,mcp}/health.json`. Every stride-th row rather than a contiguous window — these files are sorted, so a neighbourhood is not a sample (placeholder URLs are 1.6% of the MCP catalog but were 54% of its first 120 rows) — with the cursor advancing one per run, so a full pass still covers every entry exactly once. **A 402 or 401 counts as answering**: the question is whether anything is listening, and only transport failures and 5xx count against an entry. Two consecutive misses before anything is called dead; search **flags and never hides**, since one weekly probe from one network path is evidence rather than proof.

**MCP server** — `mcp/server.mjs`: zero-dependency stdio JSON-RPC (initialize/ping/tools/list/tools/call). It imports its tool definitions from `worker/discovery.js` and forwards `tools/call` to the hosted `/mcp`, so the two servers cannot drift; `tools/list` stays offline because registry health checks introspect it in a sandbox with no network. Adds `register_product` (opens the `[register]` issue; needs env `GITHUB_TOKEN`, public_repo), which is the only reason to prefer stdio — a token on a public Worker is a credential waiting to leak. Install: `claude mcp add ai-product-index -- node <clone>/mcp/server.mjs`, or skip the clone entirely with `claude mcp add --transport http ai-product-index https://index.percall.dev/mcp`.

**Security model**: all HTML text/attributes through one `esc()`; hrefs only from scheme-allowlisted (http/https, public-host) URL fields; JSON-LD `<`-escaped against `</script>` breakout; slug regex + resolved-path assertion stop path traversal; accepted objects rebuilt field-by-field from an allowlist (no `__proto__` write-through); workflow token scoped to `contents: write, issues: write`.

**The free/paid boundary** is a whitelist, not a delete. `freeView()` in `score.js` names the fields the free tier keeps, so a field added to the audit later cannot leak into it by omission — and a test asserts a hypothetical new paid field stays out. The free tier deliberately answers "do I have a problem, and roughly where"; the paid tier answers "here is the code that fixes it".

**Payment security** — the facilitator verifies signatures and balances; it has no idea what we charge, so `worker/x402.js` is what stops a client from paying one atomic unit to an address of its own choosing:
- every field of the client's `accepted` block is compared against our own requirements (scheme, network, asset, `payTo`, amount), and the **authorization is checked independently** — a payload with a correct-looking `accepted` block but an authorization paying elsewhere is rejected;
- amounts compare as `BigInt`, so `"1e5"`, `" 10000"` and `"-10000"` never pass as `"10000"`;
- the nonce is **reserved in KV before settling**, so a concurrent replay loses the race instead of settling twice;
- the audit target passes `urlError()` (public http/https hosts only) **before any charge** — nobody pays for a request we would reject.

## Local development

```bash
node --test scripts/*.test.mjs   # validator, escaping, worker, payment-gate, receipt tests
node scripts/build.mjs           # regenerate everything (deterministic: build twice → zero diff)
npx wrangler dev                 # serve assets + Worker routes locally
# simulate a registration without GitHub:
ISSUE_BODY='{"slug":"x-y-z","name":"X","url":"https://example.com","description":"d","category":"api","pricing":"free"}' \
ISSUE_USER=you node scripts/process-issue.mjs   # SKIP_LIVENESS=1 to skip the URL check
```

Use `scripts/*.test.mjs`, not `node --test scripts/` — Node 22 resolves a bare directory argument as a module and fails before running anything.

## Deployment (Cloudflare)

`.github/workflows/deploy.yml` runs tests, asserts the committed build is not stale, then `wrangler deploy` on every push to `main`. It skips the deploy with a notice while the two Cloudflare secrets are unset, so `main` stays green instead of collecting red Xs nobody reads. **Deployed and green since 2026-07-25**; the setup below is recorded for a rebuild, not outstanding work. One-time setup:

1. `npx wrangler kv namespace create PAYMENTS` → put the id in `wrangler.toml`.
2. Repo secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit) and `CLOUDFLARE_ACCOUNT_ID`.
3. Point `index.percall.dev` at the Worker — `gh workflow run cf-admin -f action=attach-domain -f hostname=index.percall.dev` (the zone must be on the Cloudflare account and the token needs its zone rights).
4. Optional, for `/api/stats.json`: `npx wrangler secret put CF_ACCOUNT_ID` and `CF_ANALYTICS_TOKEN` (Account Analytics: Read). Without them the endpoint reports `stats_not_enabled` rather than pretending.

Locally, run it with `npx wrangler dev --local --persist-to /tmp/seo-wstate`. The `--persist-to` outside the repo matters: the asset directory is the repo root, so wrangler's state dir otherwise lands in the watched tree and reload-loops forever.

Migration knob: `site.config.json → base` is the single source for every absolute URL; the build regenerates sitemap/canonical/JSON-LD/llms.txt/openapi from it. The three hardcoded URLs in `.github/ISSUE_TEMPLATE/*.yml` must be edited by hand (issue-form text can't be templated).

## Payments — rails, and how to switch between them

Rails differ only in where they settle and who they answer to, so they live as named profiles under `payments.x402.profiles` with an `active` selector. **Moving from rehearsal to real money is one word, not five edited fields.** `scripts/x402-config.mjs → resolveX402()` is the single resolver; both the Worker and the `[upgrade]` issue flow read it, so the two can never disagree about which chain and asset are being accepted.

Currently `active: "mainnet"` — Base, USDC, real money.

| Profile | Facilitator | Auth | Settles Base mainnet? | Ready? |
|---|---|---|---|---|
| `mainnet` | PayAI | none | yes, v1 + v2 | **yes — active now** |
| `testnet` | `x402.org/facilitator` | none | no — testnet only | yes — flip `active` back to rehearse |
| `cdp` | Coinbase CDP | Bearer JWT | unverifiable without keys | needs a CDP API key |

The flip to `mainnet` was made deliberately without first settling a testnet
payment, so the profile's correctness rests on what was checked statically: the
asset address against Circle's own page and the chain, the EIP-712 domain name
against the token's `name()`, and the facilitator's `/supported` against the
network. Reverting is the same one word.

**The public `x402.org` facilitator cannot settle Base mainnet.** Its `/supported` advertises `eip155:84532` and no mainnet at all, and the x402 docs say plainly not to treat it as a production path — so `mainnet` points at [PayAI](https://facilitator.payai.network) from the official facilitator directory instead: no API key, and it advertises Base mainnet under both protocol versions. A third-party facilitator relays the transaction and pays the gas; it cannot redirect funds, because the authorization is signed to our address for our exact amount.

Check any profile against the chain and its facilitator before switching to it:

```bash
node scripts/verify-rail.mjs mainnet
```

That reads the token's own `name()`, `symbol()`, `decimals()` and `version()` off chain and asks the facilitator what it will actually settle. It exists because two mistakes here are invisible until every payment fails: a wrong asset address, and a wrong EIP-712 domain name — `asset_name` is published as the domain the payer signs against, and USDC calls itself `"USDC"` on Base Sepolia but `"USD Coin"` on Base mainnet, which is why it is a per-profile field.

Going live on mainnet was exactly that: the check above, the asset eyeballed on basescan once, `"active": "mainnet"`, push. The live rail is now `cdp`, which costs a CDP API key (`wrangler secret put CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`, never in `site.config.json`) and buys a free tier of 1,000 tx/month plus cataloging in the x402 Bazaar. CDP's `/supported` answers 401, so `verify-rail.mjs` signs it with the same code the Worker uses when those two variables are present — `gh workflow run cf-admin -f action=verify-cdp` runs it on the runner, the only place the secrets exist.

Bazaar cataloging is not automatic just because the facilitator is CDP: the listing is built from discovery metadata attached to a **settlement**, so an endpoint can take real money indefinitely and never be listed. `/api/audit` therefore publishes an `outputSchema` with `discoverable: true` (v1) and the same object under `extensions.bazaar` (v2) — a shape read off the live catalog rather than the docs. `node scripts/bazaar-check.mjs` answers whether it worked.

**Prices** are atomic units — USDC has 6 decimals, so `50000` = $0.05. The full audit is $0.05; one check, one live probe, one route query, and one weekly watch sweep are each $0.005; verified and featured listing tiers are $5 and $25. Agents can read the live terms at `/api/x402/info` without provoking a 402.

**Card (humans)** — a Stripe payment link in `payments.stripe_payment_link`; `rail: "card"` upgrades answer `manual_reconciliation` and are flipped with `scripts/set-tier.mjs`. Stripe's own x402 product settles to a Stripe balance in fiat but is private preview behind an access request; adopting it later is a `facilitator_url` change, not a rewrite.

**CDP authentication** (`worker/cdp-auth.js`) is hand-rolled on WebCrypto rather than pulling in `@coinbase/x402`, which would drag `viem`, `zod` and the whole CDP SDK into a Worker for one signature. The contract was read off those published package sources: header `{alg, kid, typ, nonce}` with `alg` of `EdDSA` (Ed25519) or `ES256` (EC), claims `{sub, iss: "cdp", nbf, exp, jti, uris}`. The `uris` claim binds each token to one method+host+path, so a `/verify` token cannot be replayed against `/settle`. A rail declaring `auth: "cdp"` with no credentials fails closed instead of firing unauthenticated and surfacing Coinbase's 401 as if the agent's payment were bad.

The read API will not change shape — `tier` has been server-set on every listing since day one.

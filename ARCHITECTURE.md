# Architecture

How the pieces fit, and why they are shaped this way. For *getting it running*, see [DEPLOY.md](DEPLOY.md).

## The shape of the thing

A committed static build, served by a Cloudflare Worker that owns a handful of dynamic routes on top.

```
listings/*.json  ──┐
templates/*      ──┼─→  scripts/build.mjs  ─→  committed static output
site.config.json ──┘                          (index.html, l/*.html, api/*.json,
                                               llms.txt, sitemap.xml, .well-known/…)
                                                        │
GitHub issue  ─→  register.yml  ─→  process-issue.mjs  ─┤
([register]/                        (validate, dedup,   │
 [update]/                           liveness, write)   │
 [upgrade])                                             ▼
                                          worker/index.js  ─→  ASSETS binding
                                                 │
              ┌───────────────┬──────────────────┼────────────────────┐
              ▼               ▼                  ▼                    ▼
      GET /api/search   POST /api/audit   GET /api/stats.json   GET /api/x402/info
      POST /ask         (x402-gated)      GET /api/revenue.json
      POST /mcp
      (discovery.js)
```

The left column is the newest and the one that changes reach. Everything else
here serves a *document* you have to already know the URL of; those three take
a *question*. `/mcp` matters most: the stdio MCP server needed a clone and a
config edit, so it was only ever going to be used by someone who had already
found the project. A streamable-HTTP endpoint needs a URL, which means any MCP
client can mount this index as a tool source and every question it asks lands
here. All three answer from the registry bundled into the Worker at build time
— one CPU slice, no network, and no second copy of the data that can drift.

## Why a Worker at all

The site was on GitHub Pages and worked. Three things forced the move, none of which any amount of static-site cleverness can solve:

| | GitHub Pages | Worker |
|---|---|---|
| HTTP 402 + payment manifest | impossible | `POST /api/audit` |
| Custom response headers, `Accept` negotiation | impossible | `Link:` alternates, JSON/markdown variants |
| Request logs | none at all | Analytics Engine → `/api/stats.json` |

That last row is the real one. On Pages there was no way to answer *"has any agent ever visited?"* — and after 16 days live with zero organic registrations, that was the only question worth answering.

## Source of truth

Hand-edited or workflow-written; everything else is derived.

- `listings/<slug>.json` — one file per listing
- `templates/` — page and protocol templates with `{{BASE}}` / `{{REPO}}` / `{{COUNT}}` / `{{LISTINGS_HTML}}` placeholders
- `site.config.json` — base URL, repo slug, payment rails. **The single knob for migration.**
- `scripts/validate.mjs` — the security boundary (see below)

`scripts/build.mjs` regenerates every derived artifact and is a **pure function of those inputs**: no timestamps, so building twice yields a zero diff. `deploy.yml` asserts this — a dirty tree after a rebuild means someone hand-edited a generated file, and the deploy fails rather than shipping drift.

## The security boundary

Everything that reaches disk or generated HTML goes through `scripts/validate.mjs`:

- **One `esc()`** for all HTML text and attributes. Not several.
- **Scheme-allowlisted URLs only** (`urlError()`): http/https, public hostnames, no private/loopback/`.local` literals. This same function is the SSRF gate for the audit endpoint's attacker-supplied target — one boundary, two callers.
- **JSON-LD `<`-escaped** against `</script>` breakout.
- **Slug regex + resolved-path assertion** stop path traversal.
- **`reconstruct()` rebuilds accepted objects field-by-field from an allowlist** — the submitted object is never written through, so `__proto__` and junk keys cannot survive.
- `api/schema.json` is *generated from the same constants that enforce validation*, so published docs cannot drift from behaviour.

## Payments

### Rails as profiles

Rails differ only in where they settle and who they answer to, so they are named profiles under `payments.x402.profiles` with an `active` selector. `scripts/x402-config.mjs → resolveX402()` is the single resolver, read by **both** the Worker and the `[upgrade]` issue flow — so the HTTP path and the issue path can never disagree about which chain and asset are accepted.

`resolveX402()` returns `null` unless the rail is *completely* configured, and every caller treats null as `payments_not_enabled` — an incomplete rail disables payments instead of quoting them against a wrong or empty token contract.

Two fields are per-profile rather than shared, both for the same reason: they are *published in the payment terms* and the payer signs against them, so a value that is right on one chain is a silent failure on another.

- **`asset_name`** is the EIP-712 domain name for `transferWithAuthorization`, and must equal the token's own `name()`. USDC's is `"USDC"` on Base Sepolia and `"USD Coin"` on Base mainnet; publishing the wrong one makes the facilitator reject every payment as an invalid signature.
- **`network_v1`** is the same chain under x402 v1's naming (`base-sepolia`, `base`) rather than its CAIP-2 id. Absent, only v2 is offered.

`scripts/verify-rail.mjs` exists because neither can be checked from inside the repo: it reads `name`/`symbol`/`decimals`/`version` off chain and asks the facilitator which `{version, scheme, network}` triples it will settle, then compares both against the profile.

### Why one 402 speaks two protocol versions

v2 is the current spec, and the endpoint was built to it. But the *installed
client base* is on v1: the reference client (`x402-fetch@1.2.0`, npm latest as of
July 2026) validates the 402 body against a v1 schema and **throws** rather than
degrading — it wants `network: "base-sepolia"` rather than a CAIP-2 id and
`maxAmountRequired` rather than `amount`, and it sends its payload in
`X-PAYMENT`. Driving it against a v2-only build produced a `ZodError`, not a
payment. A spec-perfect endpoint that no shipping client can pay earns nothing.

So each version is answered where its own spec says to look:

| | v2 | v1 |
|---|---|---|
| Challenge | `PAYMENT-REQUIRED` header | the 402 JSON **body** |
| Payment | `PAYMENT-SIGNATURE` | `X-PAYMENT` |
| Receipt | `PAYMENT-RESPONSE` | `X-PAYMENT-RESPONSE` |

The two challenges are **not** merged into one `accepts` array. A v1 client parses
the whole array with its own schema, so a single v2 entry in it makes the client
reject the entire response — the exact failure the split avoids.

Consequences worth knowing:

- The **replay nonce is keyed on the CAIP-2 network**, never on the version's own
  label. v1 calls this chain `base-sepolia` and v2 calls it `eip155:84532`;
  keying on the label would allow one authorization to be replayed once per
  version.
- **v1 asserts less.** Its payload carries only `scheme` and `network` — no
  asset, recipient or amount — so those are pinned by the `paymentRequirements`
  *we* send the facilitator, by the token's EIP-712 domain, and by the
  authorization check, never by the client's word. The code checks each version
  for exactly what it actually claims rather than pretending v1 said more.

### What the facilitator does *not* do

The facilitator verifies signatures, balances, and simulates the transfer. **It has no idea what we charge.** So `worker/x402.js` — not the facilitator — is what stops a client paying one atomic unit to an address of its choosing:

- every field of the client's `accepted` block is compared against our own requirements (scheme, network, asset, `payTo`, amount);
- the **authorization is checked independently** — a payload with a correct-looking `accepted` block but an authorization paying elsewhere is rejected;
- amounts compare as `BigInt`, so `"1e5"`, `" 10000"` and `"-10000"` never pass as `"10000"`;
- the nonce is **reserved in KV before settling**, so a concurrent replay loses the race rather than settling twice;
- the audit target passes `urlError()` **before any charge** — nobody pays for a request we would reject.

### Two transports, two verification methods

| Path | Transport | How payment is proven |
|---|---|---|
| `POST /api/audit` | HTTP | x402 handshake, **v1 and v2** — 402 → `PAYMENT-SIGNATURE` (v2) or `X-PAYMENT` (v1) → facilitator `/verify` + `/settle` |
| `[upgrade]` issue | GitHub issue | on-chain receipt lookup (`scripts/x402-receipt.mjs`) |

They differ because a GitHub issue cannot carry a 402 handshake — by the time the issue is opened the payment has already settled, so the only honest check is an ERC-20 `Transfer` log lookup: right token, right recipient, enough value, enough confirmations. Spent transaction hashes burn into the committed `payments.json` ledger so one payment cannot buy two upgrades.

### CDP authentication

`worker/cdp-auth.js` mints the Bearer JWT the Coinbase facilitator requires, using WebCrypto and **no dependencies** — pulling `@coinbase/x402` would drag `viem`, `zod` and the whole CDP SDK into a Worker for one signature. The `uris` claim binds each token to a single method+host+path, so a `/verify` token cannot be replayed against `/settle`. A rail declaring `auth: "cdp"` with no credentials fails closed rather than firing unauthenticated and surfacing Coinbase's 401 as though the agent's payment were bad.

## Data stores

One KV namespace (`PAYMENTS`), three prefixes, chosen so each read is cheap:

| Prefix | Holds | Why this shape |
|---|---|---|
| `x402:nonce:` | spent/reserved payment authorizations | reserve-before-settle beats a concurrent replay |
| `revenue:` | settlement records **in KV metadata** | one `list()` returns every record — no N gets, and no read-modify-write to lose writes to a race |
| `stats:` | cached analytics rollup | keeps the SQL API off the hot path |
| `probe:v1:` | one endpoint's last probe, 60s | courtesy to the endpoint being probed, not speed for us — a burst of callers becomes one request |
| `probe:hist:v1:` | per-endpoint probe history, 180d | the Worker cannot commit, and a 24,741-entry file rewritten weekly is a megabyte of git churn for data that changes by the minute |

Analytics Engine holds per-request telemetry: bucketed path, classified client type, method, status class, truncated user-agent, ASN, and **hostname**. **No IP addresses.** Client type is inferred from a self-reported user-agent, so it is a traffic-shape signal, not an identity claim — `/api/stats.json` says so in its own payload.

Hostname is recorded because every host attached to this Worker serves the same paths, so a path bucket can never answer "is the umbrella getting traffic" or "is anyone still arriving on the retired host". It is `url.hostname`, not `url.host`: Cloudflare answers on 8443/8080 too, and the port turned three port-scanner targets into phantom hosts holding real traffic.

## Hosts

One Worker, four hostnames, and each owns a disjoint set of paths so every document has exactly one address:

| host | owns | everything else |
|---|---|---|
| `index.percall.dev` | canonical — the index, its APIs, all static assets | — |
| `router.percall.dev` | `/`, `/api/liveness`, `/api/route` | 308 → canonical |
| `percall.dev` | `/` (the portfolio page) | 308 → canonical |
| `www.percall.dev` | `/` → 308 to the apex | 308 → canonical |
| `index.kc-it.pl` | nothing (retired) | 308 → canonical |

Two rules keep this from breaking, both learned by breaking it:

- **A Worker cannot fetch its own hostnames** — Cloudflare answers 522, and a *paid* audit that settles and then 502s is how that was found. Every attached host must therefore be recognised by `canonicalTarget()` and `selfTerms()`, which read `host_aliases` **plus `router_host`** from config rather than a hand-copied list, because copying it is how the bug arrived twice.
- **A host whose root is a page must map to that page, not to `/`.** `percall.dev/` resolves to `/apex.html` and `router.percall.dev/` to `/router.html`. Mapping either to `/` audits the *index* and publishes the score under the other host's name — grading one page and labelling it another, which is precisely the defect this service is sold to detect.

## Failure posture

Every optional capability degrades to an explicit, machine-readable refusal rather than a guess or a silent free ride:

| Missing | Response |
|---|---|
| receiving address / asset | `payments_not_enabled` (503) |
| CDP credentials on a `cdp` rail | `payments_not_enabled` (503) |
| `DASHBOARD_TOKEN` | `dashboard_not_enabled` (503) on the feed, 404 on the page |
| analytics credentials | `stats_not_enabled` (503) |
| listing URL dead 3 weeks running | delisted, page 404s |

## Dashboard privacy

The revenue dashboard is the one surface that is not public, and the **page** is gated rather than only the data behind it. An unauthorized request gets the ordinary 404 — not a 401 — so the dashboard's existence is not disclosed to anyone probing the site. `robots.txt` and the `noindex` meta are also present, but those are advisory; the 404 is the control.

Authorization accepts three forms, and `authorizeDashboard()` in `worker/revenue.js` is the single place that decides:

| Form | Used by |
|---|---|
| HttpOnly session cookie | the browser, after the first visit |
| `?token=` | that first visit only |
| `Authorization: Bearer` | programmatic callers of the feed |

A valid `?token=` is traded for an **HttpOnly, Secure, SameSite=Strict** cookie and the page strips the parameter from the address bar via `history.replaceState`, so the token stops travelling in URLs — and therefore in history, bookmarks and referrers. HttpOnly means page JavaScript can never read it. Token comparison is length-independent, so a wrong guess leaks nothing by timing.

The page asset is still uploaded (the Worker must be able to fetch it from the `ASSETS` binding to serve authorized users), which is safe because `run_worker_first = true` routes every request through the Worker first — the binding is not independently reachable.

## Testing

`node --test scripts/*.test.mjs` — 113 tests, no framework, no dependencies.

Use the explicit glob, **not** `node --test scripts/`: Node 22 resolves a bare directory argument as a module and fails before running anything.

The Worker modules are deliberately free of Cloudflare-only globals *at import time*, so they run under plain Node. Paths that genuinely need the runtime — `HTMLRewriter` in the audit, the ASSETS binding — are exercised with `wrangler dev` instead. The x402 rejection paths all resolve before any network call, so they run fully offline; a network call escaping the gate would fail loudly.

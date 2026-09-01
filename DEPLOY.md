# Deployment runbook

## Current status: LIVE

**https://index.kc-it.pl** — deployed from `main` by CI, verified 2026-07-25.
Also answers on `https://ai-product-index.110kc3.workers.dev` (a debugging
fallback; `workers_dev = false` in `wrangler.toml` turns it off, and every
canonical URL points at the custom domain regardless).

Known edge case: `/api/score` can audit `index.percall.dev` — and, since the
2026-07-29 migration, the `percall.dev` apex and old `index.kc-it.pl` too, via
the `host_aliases` rewrite (it serves those sub-requests from the ASSETS
binding, because a Worker gets 522 fetching its own hostname) — but **not** the
workers.dev hostname, since host-matching cannot know
an alternate hostname. Auditing the fallback URL returns a clean 522 error. It
disappears if you ever set `workers_dev = false`.

| Check | State |
|---|---|
| `deploy.yml` on `main` | ✅ green, deploys on every push |
| Repo secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | ✅ set |
| `PAYMENTS` KV namespace | ✅ `abdc346d8f1c428ead3a38f3b2a9e744`, bound |
| Worker serving, with its header layer | ✅ 200 + `Link:` alternates + `x-agent-protocol` |
| `Accept:` content negotiation | ✅ `application/json` on `/` returns the registry |
| Paid endpoint | ✅ 402 with a v1 challenge in the body and a v2 challenge in the header |
| Payment handshake | ✅ real client signed and paid; the live facilitator verified the signature |
| The audit itself | ✅ runs on the Workers runtime; scores this site 100/100 agent-ready |
| `index.percall.dev` custom domain | ✅ attached 2026-07-29 (`cf-admin attach-domain`); `percall.dev` apex and old `index.kc-it.pl` also attached, both 308 |
| Analytics Engine | ✅ enabled; `env.ANALYTICS` bound |
| Private revenue dashboard | ✅ https://revenue.local.kc-it.pl — tailnet only, no token in the URL |
| Published listing URLs | ✅ 200, after fixing a 307 that Workers Assets was injecting |
| Active payment rail | 🟢 `mainnet` — Base, USDC, **proven end to end 2026-07-29** |

The rail was flipped to `mainnet` deliberately, **skipping the testnet
rehearsal in Phase 2** — and the gap that left was closed on 2026-07-29, when
the rail completed its first real settlement (Phase 3.3, now done). To go back
to rehearsal anyway, set `"active": "testnet"` and push.

### How the custom domain is attached

Not in `wrangler.toml`, on purpose. Attaching a hostname is a *zone*-scoped call
and the deploy token is account-scoped:

```
/zones/<kc-it.pl>/workers/routes → Authentication error [code: 10000]
```

Because wrangler applies all triggers as one phase, that single missing grant
failed the entire deploy — the workers.dev hostname included, which made it look
as though nothing had deployed when the script had uploaded fine. The domain is
attached out-of-band (Worker → Settings → Domains & Routes) and persists across
deploys, so CI needs no zone permissions at all. To move it back into code, add
`kc-it.pl` to the token's Zone Resources and restore the `[[routes]]` block
documented in `wrangler.toml`.

### What "proven" means here

Run against the **deployed** Worker on 2026-07-25 (and first against a local
`wrangler dev`), with the official `x402-fetch@1.2.0` client and a freshly
generated throwaway wallet:

1. The client parsed the 402, signed an EIP-3009 authorization, and sent it.
2. This Worker validated every payment term and reserved the replay nonce.
3. The real `x402.org` facilitator verified the **signature** and rejected the
   payment for exactly one reason: `invalid_exact_evm_insufficient_balance`.

That is the entire chain working. The only missing ingredient is money in a
payer's wallet, which no amount of code can supply. The same signature was also
accepted through the v2 path, so both protocol versions reach settlement.

Work through the phases below in order. Each one is independently verifiable.

---

## Running it locally

Needs no Cloudflare account, and is the fastest loop for changing the Worker:

```bash
npx wrangler dev --local --persist-to /tmp/seo-wstate
```

`--persist-to` outside the repo is not optional. The asset directory is the repo
root, so wrangler's own state directory lands inside the watched tree and
retriggers the watcher forever — an endless reload loop (observed: ~79 000
reloads in four minutes) where the port intermittently refuses connections.

Then check the rails without spending anything:

```bash
node scripts/verify-rail.mjs            # the active profile
node scripts/verify-rail.mjs mainnet    # before you ever flip to it
```

That script reads the token's `name()`, `symbol()`, `decimals()` and `version()`
off chain and asks the facilitator what it will actually settle, then compares
both against the profile. It is the check that catches the two mistakes which
otherwise only surface as "the facilitator rejects every payment" in production
(see Phase 3.1).

---

## Phase 1 — Get it on the internet — done except the hostname

### 1.1 Create the KV namespace — done

`abdc346d8f1c428ead3a38f3b2a9e744`, created via the `cf-admin` workflow and bound
in `wrangler.toml`. This one namespace holds three things: x402
replay-protection nonces, the revenue ledger, and the stats cache.

The API token lives only as a repo secret, so authenticated Cloudflare commands
run in Actions rather than on a laptop:

```bash
gh workflow run cf-admin -f action=kv-setup     # idempotent; prints the id
gh workflow run cf-admin -f action=whoami       # what the token may do
gh workflow run cf-admin -f action=subdomain    # the workers.dev hostname
```

The same workflow can inspect another hostname on the account without copying
the Cloudflare token onto a laptop:

```bash
gh workflow run cf-admin -f action=traffic-report -f hostname=index.kc-it.pl -f days=7
```

`traffic-report` combines browser-side Web Analytics with zone HTTP analytics.
It separates likely-human and likely-bot page views, then reports aggregate top
page paths, referrer hosts, countries, devices, browsers, edge paths, response
statuses and cache statuses. It never requests IP addresses, raw user agents,
query strings or individual events. The report appears in the Actions job
summary and log, and as JSON plus Markdown in a 14-day artifact. `days` must be
1-7; the script splits the range into 24-hour UTC slices so it also works with
the shorter adaptive-analytics window on lower Cloudflare plans.

`CF_ANALYTICS_TOKEN` should have **Account Analytics: Read** for Web Analytics.
The existing deploy token is tried for zone analytics and as a fallback, but a
missing permission disables only that half of the report. Web Analytics can
show which page brought a browser and the referring host, but Cloudflare does
not support custom action events. Product-specific telemetry belongs in the
repository that owns that product.

### 1.2 Cloudflare credentials as GitHub repo secrets — done

Both set 2026-07-25. For reference, or to rotate — Settings → Secrets and
variables → Actions:

| Secret | Where it comes from |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create → **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → right sidebar |

The template's account permissions are enough to deploy the Worker, upload the
assets and create a KV namespace. It is **not** enough to attach a custom domain:
that needs `kc-it.pl` in the token's **Zone Resources**, which the template leaves
empty. See the status section above.

### 1.3 Merge to `main` — done

`.github/workflows/deploy.yml` triggers on push to `main`, and it is on `main`
now. Every push runs the tests, asserts the committed build is not stale, then
checks for the two secrets above and skips `wrangler deploy` with a notice if
they are missing. Once 1.1 and 1.2 are done, the next push deploys — or trigger
one without a commit:

```bash
gh workflow run deploy
```

### 1.4 Point the hostname at the Worker — outstanding

See "Two things left for you" above: the deploy token is account-scoped, so the
hostname is attached out-of-band rather than by CI.

**Verify Phase 1** (works today against workers.dev; swap the host once the
domain is attached):

```bash
B=https://ai-product-index.110kc3.workers.dev
curl -sI $B/                                    # 200 + a Link: header with rel=alternate
curl -s  $B/api/index.json | head               # the registry JSON
curl -s  $B/api/x402/info                       # payment terms, and the versions accepted
curl -s -H 'accept: application/json' $B/       # content negotiation → registry JSON
curl -s -X POST $B/api/audit \
  -H 'content-type: application/json' -d '{"url":"https://example.com"}'   # 402
```

---

## Phase 2 — Rehearse the payment on testnet *(skipped)*

**This phase was deliberately skipped**: the rail went straight from `testnet`
to `mainnet` without a funded rehearsal. It is kept here because it is still the
cheapest way to exercise the full path, and because flipping `active` back to
`testnet` is all it takes to run it.

With `"active": "testnet"`, `POST /api/audit` returns a real 402 quoting $0.05 to `0x48934cDA4F8f3F692d4deEED3D2B4f15852E2424` on Base Sepolia.

The one remaining unknown is funding. Everything downstream of it has already
been exercised (see "What proven means" above), so this phase is short.

1. Fund **the payer**, not the recipient. The 402 is a request for someone else's
   money; test USDC in your own receiving address does nothing. Use a throwaway
   wallet, fund it from a Base Sepolia USDC faucet, and pay yourself.
2. Drive one payment through with the reference client — 15 lines, no repo
   changes, and it is the same client a real agent would use:

```bash
mkdir /tmp/x402try && cd /tmp/x402try && npm init -y && npm i viem x402-fetch
node --input-type=module -e '
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "x402-fetch";
const paid = wrapFetchWithPayment(fetch, privateKeyToAccount(process.env.PK));
const r = await paid("https://index.percall.dev/api/audit", {
  method: "POST", headers: {"content-type":"application/json"},
  body: JSON.stringify({url:"https://example.com"}),
});
console.log(r.status, r.headers.get("x-payment-response"));
console.log((await r.text()).slice(0,400));'
```

3. Confirm a replay of the same authorization is refused (402, "already been
   used"). Note a *failed* settlement releases the nonce on purpose, so only a
   settled payment burns it.
4. Confirm settlement on `https://sepolia.basescan.org/address/0x48934cDA4F8f3F692d4deEED3D2B4f15852E2424`.

**You will not see testnet funds in the Binance app** — wallets don't list testnets. The explorer is the source of truth here.

The facilitator is reachable and was probed successfully from this machine
(earlier notes claiming otherwise were about a sandbox egress proxy):

```bash
curl -s https://x402.org/facilitator/supported | head -c 300
node scripts/verify-rail.mjs testnet          # does the same check, and compares
```

---

## Phase 3 — Switch to real money *(done — rail is live)*

`"active": "mainnet"` as of 2026-07-25. Phase 2 was skipped; the first real
settlement (3.3 below) followed on 2026-07-29.

### 3.1 The mainnet profile — filled in, and how it was checked

The `mainnet` profile now carries `asset` `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
It was taken from Circle's official contract-address page, and then confirmed
against the chain itself: `name()` = `"USD Coin"`, `symbol()` = `"USDC"`,
`decimals()` = 6, `version()` = `"2"`. Circle's Base **Sepolia** address on the
same page also matched the already-working testnet profile byte for byte, which
is a third corroboration that the right page was read.

Before you flip the rail, re-run the check yourself and eyeball the address on
the explorer once:

```bash
node scripts/verify-rail.mjs mainnet
open https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

Never take a token address from memory, from a model, or from a blog post. A
wrong one means payments quote against a contract that isn't USDC — the payer is
charged in something worthless, or nothing settles at all.

**Two mainnet traps, both already handled — do not undo them:**

1. **The EIP-712 domain name differs per chain.** `extra: {name, version}` in the
   payment terms is the domain the payer signs `transferWithAuthorization`
   against, and it must equal the token's own `name()`. USDC calls itself
   `"USDC"` on Base Sepolia but `"USD Coin"` on Base mainnet. This is why
   `asset_name` is a **per-profile** field: one shared value would publish the
   wrong domain on mainnet and the facilitator would reject every single payment
   as invalid. `verify-rail.mjs` compares the two and fails loudly.

2. **The public x402.org facilitator is testnet only.** Its `/supported` lists
   `eip155:84532` and no Base mainnet at all, and the x402 docs say plainly not
   to treat it as a production path. The `mainnet` profile therefore points at
   **PayAI** (`https://facilitator.payai.network`) — listed in the official x402
   facilitator directory, needs no API key, and advertises Base mainnet under
   both protocol versions (`eip155:8453` for v2 and `base` for v1). The `cdp`
   profile remains the Coinbase alternative.

   What trusting a third-party facilitator does and does not expose: the
   authorization is signed to *our* address for *our* exact amount, so a
   facilitator cannot redirect funds — it only relays the transaction and pays
   the gas. The residual risks are that it fails to relay (the payer keeps their
   money and gets no audit) or reports success without relaying (we serve one
   audit for free). Neither can move money anywhere we did not name.

### 3.2 Flip the rail — done

```jsonc
"active": "mainnet"   // or "cdp"
```

Commit and push — the Worker bundles `site.config.json`, so the flip takes effect
on the next deploy, not on the next build. No payment terms are baked into the
static output (the published files point at `/api/x402/info` for live terms), so
`node scripts/build.mjs` is not needed for a rail change; run it anyway if you
touched anything under `templates/`, because CI fails on a stale committed build.

### 3.3 Run one real transaction — done 2026-07-29

The rail's first end-to-end settlement, run exactly as prescribed: a throwaway
payer (`0xC8b3…87D4`, generated on the Pi, key at `~/.x402-test/payer.key`,
funded with 6.25 USDC from Coinbase over Base) drove `x402-fetch@1.2.0` against
the live endpoint.

- **Paid**: HTTP 200 + settlement receipt; the audit itself was delivered
  (kc-it.pl, A 100/100).
- **Replay refused**: the identical `X-PAYMENT` header re-sent verbatim →
  402 `payment authorization has already been used`.
- **On chain**: tx `0x6b68f50889062fedabc414acf4c82b2df57a995e4bd733395ec99e542fe68842`,
  block 49270394 — a 0.05 USDC `Transfer` from the throwaway to the receiving
  address, gas paid by the PayAI facilitator, zero gas spent by the payer.
- **Ledger**: https://revenue.local.kc-it.pl shows settlements 1, total $0.05,
  rail **live** (not testnet).

~6.20 USDC remains in the throwaway as a demo/test budget; each further
self-audit just moves five more cents back to the receiving address. The
harness that ran this is `~/.x402-test/pay-and-replay.mjs`.

---

## Phase 4 — The Coinbase CDP facilitator — **done 2026-08-01**

This is the live rail. It was optional once the PayAI facilitator removed CDP as
the only route to mainnet; what brought it back is a free tier (1,000
transactions/month, then $0.001 each) and **cataloging in the x402 Bazaar**,
which is the only real discovery channel for a site with no human traffic.

1. `portal.cdp.coinbase.com/access/api` → **Secret API Key** → key type **Ed25519**. The private key is shown exactly once.
2. Set them as repo secrets and let the runner push them to the Worker, so the
   values never touch a laptop:

```bash
gh secret set CDP_API_KEY_ID
gh secret set CDP_API_KEY_SECRET
gh workflow run cf-admin -f action=push-secrets
```

3. **Verify before flipping.** CDP's `/supported` returns 401, so this is the one
   rail that cannot be checked from a developer machine. `verify-rail.mjs` now
   signs the request with the Worker's own auth code when the two variables are
   present, and `cf-admin` runs it where they are:

```bash
gh workflow run cf-admin -f action=verify-cdp
```

   It answered: key accepted, **24 kinds advertised**, covering both this
   profile's v2 `eip155:8453` and v1 `base`. That was the last unverified thing
   about the rail.

4. `"active": "cdp"`, rebuild, deploy. Proof it settles: tx
   `0x28f42d67097fd388fe915a848da7e2f5fcb47252a6c7ea36d0ed99f2c3618292`,
   block 49327142 — 0.05 USDC to the receiving address, replay of the same
   authorization refused. Payers see no difference: address, price and asset are
   unchanged, only whose facilitator settles.

Dead ends worth knowing so you don't lose time: the portal's **x402 page is metrics-only**; the avatar menu has **no API Keys entry** (it is under *Manage account*); and **Custodial Wallet** requires a business account and a sales conversation.

### Getting listed in the Bazaar is a second, separate thing

Switching the facilitator does **not** list you. CDP builds a catalog entry from
discovery metadata attached to a *settlement*, so an endpoint can take real
money forever and stay invisible — which is exactly what happened here for the
first four settlements.

The docs describe the SDK helper (`declareDiscoveryExtension()`), not the wire,
so the shape below was read off the live catalog instead: of its 1,795 x402 v1
resources, **1,698 carry `discoverable: true` inside the v1 `outputSchema`** of
their payment requirements, and the `extensions.bazaar.info` that CDP publishes
for them is visibly derived from it. `/api/audit` now sends:

```jsonc
"outputSchema": {                       // v1; the same object rides as
  "input": {                            // extensions.bazaar for v2
    "type": "http", "method": "POST",
    "discoverable": true,               // the opt-in — without it, no listing
    "bodyType": "json",
    "body": { "url": { "type": "string", "required": true, "description": "…" } }
  },
  "output": { "type": "object", "properties": { /* the audit result */ } }
}
```

The requirements object is what gets POSTed to `/settle`, so it arrives where
the catalog is built. Check the result with:

```bash
node scripts/bazaar-check.mjs          # scans all ~14.7k entries by payTo
node scripts/bazaar-check.mjs --sample # what a listed v1 entry looks like
```

**Status: still not listed** as of 2026-08-01, minutes after a settlement
carrying the metadata. If it stays that way, suspect CDP rather than this repo:
[x402-foundation/x402#2112](https://github.com/x402-foundation/x402/issues/2112)
reports the identical symptom — 8 settlements, full official-SDK extension
setup, never indexed, no maintainer reply.

---

## Phase 5 — Optional: dashboards

### Revenue dashboard — private, and reachable only on the tailnet

**https://revenue.local.kc-it.pl** — live. No token in the URL, nothing to
remember, and invisible to the internet.

How the pieces fit:

1. The dashboard is served by the **public Worker**, which answers the ordinary
   404 to anyone without `DASHBOARD_TOKEN` — so its existence is not disclosed
   even to someone probing `index.percall.dev`.
2. **Caddy on the Pi** (`~/docker/command-center/Caddyfile`) fronts a
   `revenue.local.kc-it.pl` vhost that reverse-proxies to `index.percall.dev` and
   injects `Authorization: Bearer <token>` from `AIPI_DASHBOARD_TOKEN` in
   `~/docker/.env`. The secret therefore never reaches a browser, an address bar,
   shell history or a bookmark.
3. `*.local.kc-it.pl` is a wildcard A record pointing at the Pi's **Tailscale**
   address, so the name resolves publicly (real Let's Encrypt certs via
   Cloudflare DNS-01) but only routes inside the tailnet. No new DNS record was
   needed.
4. Because Caddy holds the token, reaching that vhost *is* authorisation — so the
   vhost additionally **404s any source outside `100.64.0.0/10`**. Ports 80/443
   are bound on every interface; DNS is routing, not access control.

The same three-tier model as the other private services (`vault`, `obsidian`,
`claude`), and it survives a Worker redeploy untouched.

| Request | Response |
|---|---|
| `revenue.local.kc-it.pl/` from the tailnet | 302 → `/dashboard`, then 200 |
| `revenue.local.kc-it.pl` from off-tailnet | 404 |
| `index.percall.dev/dashboard` anonymous | 404 |
| `index.percall.dev/api/revenue.json` anonymous | 401 |
| `index.percall.dev/dashboard.html?token=<token>` | 200, sets a 12 h HttpOnly cookie |
| anything, with `DASHBOARD_TOKEN` unset | 404 / 503 |

The `?token=` route still works for a device off the tailnet; the Worker trades it
for an HttpOnly, Secure, SameSite=Strict cookie and the page strips it from the
address bar. Prefer the tailnet host — a URL with a secret in it ends up in
history and referrers.

**To rotate**, change all three copies together:

```bash
NEW=$(openssl rand -base64 32)
# 1. the Pi: edit AIPI_DASHBOARD_TOKEN in ~/docker/.env, then
cd ~/docker && docker compose up -d command-center     # env changes need a recreate
# 2. the repo secret
gh secret set DASHBOARD_TOKEN --repo 110kc3/seo
# 3. the Worker
gh workflow run cf-admin -f action=push-secrets
```

Existing cookies stop matching the moment step 3 lands.

The dashboard reads the ledger the Worker writes on every settlement, so it is
accurate from the first payment — including testnet ones, which it labels as
testnet rather than calling them revenue. Right now it correctly shows zero.

### Traffic stats — `/api/stats.json`

```bash
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_ANALYTICS_TOKEN   # Account Analytics: Read
```

Without these the endpoint reports `stats_not_enabled` rather than pretending. This is the endpoint that answers the question the whole migration existed for: **has any agent ever actually used this?**

---

## Secrets reference

Every one of these is set with `wrangler secret put` or in the Cloudflare dashboard. **None of them belongs in `site.config.json` or any committed file.**

| Secret | Needed for | Without it |
|---|---|---|
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | the `cdp` rail | `payments_not_enabled` |
| `DASHBOARD_TOKEN` | `/api/revenue.json` | `dashboard_not_enabled` |
| `CF_ACCOUNT_ID` / `CF_ANALYTICS_TOKEN` | `/api/stats.json` | `stats_not_enabled` |

Public by design, and correctly living in `site.config.json`: the receiving address, the network, the asset, and prices. All of it is published in every 402 challenge anyway.

---

## Rollback

The static build is committed, so any deploy is reproducible from a commit. To disable payments instantly without a deploy, set `payments.x402_address` to `""` — `resolveX402()` returns null and every paid path fails closed with `payments_not_enabled`. To take the whole site back to GitHub Pages, point DNS away and re-enable the Pages deploy; the repo still builds identically for it.

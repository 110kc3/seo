# Deployment runbook

## Current status: NOT LIVE — two things left, both need your Cloudflare login

Verified 2026-07-25. The workflow is now on `main` and runs on every push; it
stops at the credential check and says so, so `main` stays green.

| Check | State |
|---|---|
| `deploy.yml` on `main` | ✅ merged, ran on the last push |
| Repo secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | ❌ **not set** — `gh secret list` is empty, so every run skips the deploy step |
| `wrangler.toml` KV namespace id | ❌ still the literal `REPLACE_WITH_KV_NAMESPACE_ID` |
| DNS for `index.kc-it.pl` | ❌ no record (the parent `kc-it.pl` does resolve to Cloudflare) |
| Worker boots and serves | ✅ proven locally under `wrangler dev` (see below) |
| Payment rail, end to end | ✅ proven against the live facilitator, up to funding |
| Active payment rail | `testnet` — Base Sepolia, tokens with no monetary value |

**The code is finished, tested, and the payment handshake has been driven end to
end with the reference client.** What has never happened is the deployment. Even
once deployed, the rail stays testnet until you deliberately flip it, so no real
customer can be charged by accident.

### What "proven" means here

Run against a local `wrangler dev` on 2026-07-25, with the official
`x402-fetch@1.2.0` client and a freshly generated throwaway wallet:

1. The client parsed the 402, signed an EIP-3009 authorization, and sent it.
2. This Worker validated every payment term and reserved the replay nonce.
3. The real `x402.org` facilitator verified the **signature** and rejected the
   payment for exactly one reason: `invalid_exact_evm_insufficient_balance`.

That is the entire chain working. The only missing ingredient is money in a
payer's wallet, which no amount of code can supply. The same signature was also
accepted through the v2 path, so both protocol versions reach settlement.

Work through the phases below in order. Each one is independently verifiable.

---

## Running it locally first

Worth doing before any of the phases — it needs no Cloudflare account:

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

## Phase 1 — Get it on the internet

Nothing else matters until this is done.

### 1.1 Create the KV namespace

```bash
npx wrangler kv namespace create PAYMENTS
```

Copy the returned id into `wrangler.toml`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`. This one namespace holds three things: x402 replay-protection nonces, the revenue ledger, and the stats cache.

### 1.2 Cloudflare credentials as GitHub repo secrets

Settings → Secrets and variables → Actions:

| Secret | Where it comes from |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create → **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → right sidebar |

### 1.3 Merge to `main` — done

`.github/workflows/deploy.yml` triggers on push to `main`, and it is on `main`
now. Every push runs the tests, asserts the committed build is not stale, then
checks for the two secrets above and skips `wrangler deploy` with a notice if
they are missing. Once 1.1 and 1.2 are done, the next push deploys — or trigger
one without a commit:

```bash
gh workflow run deploy
```

### 1.4 Point the hostname at the Worker

`wrangler.toml` already declares `index.kc-it.pl` as a custom domain. After the first successful deploy, confirm Cloudflare created the DNS record; if not, add it manually under the `kc-it.pl` zone.

**Verify Phase 1:**

```bash
curl -sI https://index.kc-it.pl/                       # 200, and a Link: header with rel=alternate
curl -s  https://index.kc-it.pl/api/index.json | head  # the registry JSON
curl -s  https://index.kc-it.pl/api/x402/info          # payment terms
curl -s -H 'accept: application/json' https://index.kc-it.pl/   # content negotiation → registry JSON
```

---

## Phase 2 — Rehearse the payment on testnet

The rail is already configured and the address is already wired in. `POST /api/audit` returns a real 402 quoting $0.05 to `0x48934cDA4F8f3F692d4deEED3D2B4f15852E2424` on Base Sepolia.

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
const r = await paid("https://index.kc-it.pl/api/audit", {
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

## Phase 3 — Switch to real money

Do not start this until Phase 2 has settled a payment end to end.

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

### 3.2 Flip the rail

```jsonc
"active": "mainnet"   // or "cdp"
```

Commit and push — the Worker bundles `site.config.json`, so the flip takes effect
on the next deploy, not on the next build. No payment terms are baked into the
static output (the published files point at `/api/x402/info` for live terms), so
`node scripts/build.mjs` is not needed for a rail change; run it anyway if you
touched anything under `templates/`, because CI fails on a stale committed build.

### 3.3 Run one real transaction

Pay yourself five cents through the live endpoint before telling anyone the service exists.

---

## Phase 4 — Optional: the Coinbase CDP facilitator

Genuinely optional now. It was previously the only route to mainnet; the PayAI
facilitator in the `mainnet` profile removes that dependency. What CDP still buys
is a free tier (1,000 transactions/month, then $0.001 each) and **auto-inclusion
in the x402 Bazaar**, which is real discovery for a site with no traffic.

Note that `verify-rail.mjs cdp` cannot check CDP's network support without keys —
its `/supported` returns 401 — so the CDP rail's v1/v2 coverage is the one thing
still unverified. Prefer `mainnet` unless you specifically want the Bazaar.

1. `portal.cdp.coinbase.com/access/api` → **Secret API Key** → key type **Ed25519**. The private key is shown exactly once.
2. Set them as Worker secrets:

```bash
npx wrangler secret put CDP_API_KEY_ID
npx wrangler secret put CDP_API_KEY_SECRET
```

3. Set `"active": "cdp"`, fill in the verified USDC address, rebuild, deploy.

Dead ends worth knowing so you don't lose time: the portal's **x402 page is metrics-only**; the avatar menu has **no API Keys entry** (it is under *Manage account*); and **Custodial Wallet** requires a business account and a sales conversation.

---

## Phase 5 — Optional: dashboards

### Revenue dashboard — private

```bash
npx wrangler secret put DASHBOARD_TOKEN     # e.g. openssl rand -base64 32
```

Then open it once with the token in the URL:

```
https://index.kc-it.pl/dashboard.html?token=<DASHBOARD_TOKEN>
```

**The dashboard is invisible to everyone else.** Not merely unlisted — the Worker serves the ordinary 404 page to any unauthorized request, so its existence is not disclosed to anyone probing the site. That covers the anonymous case, a wrong token, and the state before `DASHBOARD_TOKEN` is ever set. `robots.txt` and the `noindex` meta are also there, but they are advisory; the 404 is the actual control.

On that first visit the Worker trades the `?token=` for an **HttpOnly, Secure, SameSite=Strict session cookie** (12 hours) and the page immediately strips the token from the address bar, so it stops living in browser history, bookmarks or any onward referrer. The token is never readable by page JavaScript.

| Request | Response |
|---|---|
| `/dashboard.html` anonymous | 404 |
| `/dashboard.html?token=wrong` | 404 |
| `/dashboard.html?token=<correct>` | 200 + sets session cookie |
| `/api/revenue.json` anonymous | 401 |
| anything, with `DASHBOARD_TOKEN` unset | 404 / 503 |

The dashboard reads the ledger the Worker writes on every settlement, so it is accurate from the first payment — including testnet ones, which it labels as testnet rather than calling them revenue.

To revoke access, rotate the secret: `npx wrangler secret put DASHBOARD_TOKEN`. Existing cookies stop matching immediately.

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

# Deployment runbook

## Current status: NOT LIVE

Nothing is deployed. Nobody can reach this, and nobody can pay for it. Three independent blockers, all on the Cloudflare side, none of them code:

| Check | State |
|---|---|
| `wrangler.toml` KV namespace id | still the literal `REPLACE_WITH_KV_NAMESPACE_ID` |
| DNS for `index.kc-it.pl` | **no record** (the parent `kc-it.pl` does resolve to Cloudflare) |
| `deploy.yml` workflow runs | none — the workflow only exists on the feature branch, never merged to `main` |
| Active payment rail | `testnet` — Base Sepolia, tokens with no monetary value |

So: **the code is finished and tested; the deployment has never happened.** Even once it is deployed, the rail is testnet until you deliberately switch it, so no real customer can be charged by accident.

Work through the phases below in order. Each one is independently verifiable.

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

### 1.3 Merge to `main`

`.github/workflows/deploy.yml` triggers on push to `main`. On the feature branch it never fires — which is why zero runs exist. Merge the branch, and the workflow runs tests, asserts the committed build is not stale, then `wrangler deploy`.

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

1. Fund that address with Base Sepolia test USDC from a faucet. It is the same address on every EVM chain, so no second wallet is needed.
2. Drive one payment through with any x402 client:

```bash
curl -i -X POST https://index.kc-it.pl/api/audit \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
# → 402 with a base64 PAYMENT-REQUIRED header
# retry with a PAYMENT-SIGNATURE header → 200 + PAYMENT-RESPONSE receipt
```

3. Confirm a replay of the same authorization is refused (402, "already been used").
4. Confirm settlement on `https://sepolia.basescan.org/address/0x48934cDA4F8f3F692d4deEED3D2B4f15852E2424`.

**You will not see testnet funds in the Binance app** — wallets don't list testnets. The explorer is the source of truth here.

Also confirm the facilitator is reachable from the deployed Worker. It could not be probed from the development sandbox (the egress proxy refuses CONNECT to both `x402.org` and `api.cdp.coinbase.com`), so this is genuinely unverified until it runs in production:

```bash
curl -s https://x402.org/facilitator/supported
```

---

## Phase 3 — Switch to real money

Do not start this until Phase 2 has settled a payment end to end.

### 3.1 Verify the USDC contract address — by hand

`site.config.json → payments.x402.profiles.mainnet.asset` ships **deliberately blank**, which disables the rail. Read the Base USDC address off Circle's official page, confirm it on `basescan.org`, and paste it in.

Do not take this address from memory, from this file, from a model, or from a blog post. A wrong token address means payments quote against a contract that isn't USDC — the payer gets charged in something worthless, or nothing settles at all.

### 3.2 Flip the rail

```jsonc
"active": "mainnet"   // or "cdp"
```

Rebuild (`node scripts/build.mjs`), commit, push. The published `llms.txt`, OpenAPI and agent card regenerate from the same config.

### 3.3 Run one real transaction

Pay yourself five cents through the live endpoint before telling anyone the service exists.

---

## Phase 4 — Optional: the Coinbase CDP facilitator

Only needed for the `cdp` profile. It buys a free tier (1,000 transactions/month, then $0.001 each) and **auto-inclusion in the x402 Bazaar**, which is real discovery for a site with no traffic.

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

### Revenue dashboard — `/dashboard.html`

```bash
npx wrangler secret put DASHBOARD_TOKEN     # any long random string
```

Open `https://index.kc-it.pl/dashboard.html`, paste the token. Without the secret the feed returns `503 dashboard_not_enabled`; with it, `/api/revenue.json` requires a bearer token. The page is `noindex` and `Disallow`ed in robots.txt.

The dashboard reads the ledger the Worker writes on every settlement, so it is accurate from the first payment — including testnet ones, which it labels as such rather than calling them revenue.

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

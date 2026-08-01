# TODO

## LIVE — https://index.percall.dev

Migrated 2026-07-29 from `index.kc-it.pl` (bought `percall.dev` as the umbrella
for the paid-services portfolio). Old host and the apex stay attached and 308.

Deployed 2026-07-25 from `main` by CI. Custom domain attached, Analytics Engine
enabled, KV bound, private revenue dashboard up. Full status table in DEPLOY.md.

Since 2026-08-01 the index also **answers questions** rather than only serving
documents: `GET /api/search?q=`, `POST /ask` (NLWeb) and `POST /mcp` (Model
Context Protocol over HTTP — `claude mcp add --transport http ai-product-index
https://index.percall.dev/mcp`). Payment rail is the **Coinbase CDP**
facilitator as of the same week.

## Fleet sweep — 2026-07-28

The audit was pointed at every deployed site in `/home/borg/repos`, and what it
found got fixed. Fleet average **68.6 → 97.5**; nine of twelve now score 100/100
and the other three sit at 90, each held there by the same Cloudflare dashboard
setting rather than by anything a commit can reach (see below).

| site | repo | before | after |
|---|---|---|---|
| index.kc-it.pl | seo | A 100 | A 100 |
| kc-it.pl | personal-page | E 48 | **A 100** |
| 110kc3.github.io | 110kc3.github.io | C 79 | **A 100** |
| …/polish-sweepstakes | polish-sweepstakes | A 93 | **A 100** |
| …/rentgen-ofert | rentgen-ofert | C 78 | **A 100** |
| …/bankier-street-bets | bankier-street-bets | C 73 | **A 100** |
| przetargimiejskie.pl | przetargimiejskie | D 69 | **A 100** |
| …/puzle | puzle | D 67 | **A 100** |
| …/pool-gliwice-automation | pool-gliwice-automation | D 60 | **A 100** |
| stareaparaty.com | stare-aparaty | E 54 | **A 90** |
| protocolindex.eu | blueprint | D 64 | **A 90** |
| overtimelog.com | overtime-guard-slack | F 38 | **A 90** |

Three findings worth keeping:

- **Three of the twelve were invisible to the fleet collector**, and were missed
  on the first pass because its list was trusted as the list of deployed sites.
  `collect-repos.mjs` detects a published site three ways — GitHub Pages API, a
  committed `CNAME`, `site.config.json` — and `protocolindex.eu` (blueprint),
  `kc-it.pl` (personal-page) and `overtimelog.com` (overtime-guard-slack) use
  none of them: all three are **Cloudflare Pages** projects wired up in the
  Cloudflare dashboard, with nothing in the repo naming the domain except prose.
  They were also the three worst-scoring sites in the fleet, which is what being
  unmeasured tends to buy. To enumerate deployed sites, grep the repos for
  self-owned domains and probe them; do not trust `repos.json` alone.

- **The auditor was wrong about three of them.** `parseJsonLd` only matched a
  top-level string `@type`, so the `@graph` container form scored as "no
  structured data" — on `stareaparaty.com`, `przetargimiejskie.pl` and
  `rentgen-ofert`, all of which serve complete `@graph` blocks. A paying caller
  would have been sold a fix for markup they already had. Fixed, with tests.
- **Checks resolve against the origin, not the page.** For the six
  `110kc3.github.io/<repo>/` project sites, `/llms.txt`, `/robots.txt`,
  `/sitemap.xml` and `/.well-known/agent.json` all resolve to the
  `110kc3.github.io` **root repo**, so those four checks are owned by one repo
  and the per-project work is only the `<head>`. Worth remembering before
  "fixing" llms.txt in a project that cannot serve one.

## Done (v3.8 — the index answers questions, 2026-08-01)

The site served documents you had to know the URL of. An agent arriving with a
question had nowhere to put it. Three endpoints now take one, and the static
surfaces exist so something that knows only the domain can find them.

- [x] **`GET /api/search?q=…`** — ranked search, with `category` / `tag` / `limit`. Weighted by field (name > tags > slug > description) and tiered by match quality (whole word 1.0 > substring 0.6 > shared stem 0.5). Not fuzzy on purpose: on a corpus this small, a scorer that can rank an unrelated listing above an exact name match is worse than one returning nothing, because an agent can widen its own query but cannot tell a confident wrong answer from a right one. Empty results carry the corpus summary and the register link, so a dead end still teaches something.
- [x] **`POST /ask` — NLWeb** ([nlweb.ai](https://nlweb.ai/docs/specification), Microsoft/R.V. Guha; Shopify, Snowflake, O'Reilly and Tripadvisor are on it). Natural language in, schema.org objects out, grounded only in the registry. Accepts the spec's `{"query":{"text":…}}`, a bare `{"query":"…"}` and `GET ?query=…`. Two rounds of tuning against real questions were needed and both were worth it: a **relevance floor** at half the top score (before it, "where can I find polish property auction data?" returned seven of eight listings, because they all say "polish"), and a **stem tier** in matching (before it, "how do I make my site readable to AI agents?" scored the listing literally called *Agent Readability Service* at zero — `agents` ≠ `agent`, `readable` ≠ `readability`).
- [x] **`POST /mcp` — Model Context Protocol over streamable HTTP.** The reach change. The stdio server needed a clone and a config edit, so only someone who had already found the project would ever run it; this needs a URL, so any MCP client can mount the index as a tool source: `claude mcp add --transport http ai-product-index https://index.percall.dev/mcp`. Tools: `search_products`, `get_product`, `score_url`, `how_to_register`. `score_url` is proxied through the real `/api/score` handler rather than reimplemented, so an MCP caller and a browser cannot disagree about a grade. JSON-RPC only — no SSE, because a server with no server-initiated messages has nothing to stream, and `initialize` declares only `tools` to say so. Batches, notifications (202, no body) and tool-level errors (`isError`, not a protocol error, so the model can see and react) all handled.
- [x] **Static discovery surfaces** so the three above are findable: `/.well-known/mcp.json` (server card; SEP-1649/2127 are draft, so it carries only fields both drafts agree on), `/opensearch.xml`, `/feed.xml` + `/feed.json`, `/.well-known/ai-plugin.json` (superseded, still probed often enough to be worth answering). All advertised from llms.txt, robots.txt, both manifests, the agent card, the sitemap and openapi.yaml — and **a test asserts the manifests cannot advertise a route the router lacks**, since they are hand-written.
- [x] **Two live products added to our own index** — OvertimeLog and Protocol Index had been in the weekly fleet sweep for months and were never listed in the directory sitting next to them. 8 → 10 listings.
- [x] **`overtimelog.com` serves a real robots.txt and sitemap** (`overtime-guard-slack@089225e`). Cloudflare Pages falls back to index.html for unmatched paths, so `/robots.txt` was answering 200 with the landing page's HTML — a crawler asking for crawl rules got a document it cannot parse, and several treat that as disallow-everything. Noted in the 2026-07-29 sweep, fixed and live.
- [x] Our own listing had pointed at `index.kc-it.pl` since the migration and did not mention `/mcp`. A directory whose own entry is stale fails the check it sells.
- 137 tests (was 121).

**The honest limit on all of this:** the endpoints are good and the corpus is
thin. Ten listings, six of them Kamil's Polish apps, will not win a specific
search no matter how well the ranking works — see "Blocked on Kamil" for the
decision that would change it.

## Blocked on Kamil — the short version (2026-08-01)

Everything that could be done without you is done. Six things need your hands,
in the order I would do them. Detail for each is further down this section.

1. **Post the Show HN.** Draft rewritten and ready in `docs/show-hn.md`; the day-7 gate opened it. Refresh the five traffic figures the morning you post. Tue–Thu, 14:00–16:00 UTC. *~30 min, then two hours of replies.*
2. **Four directory submissions.** Every answer is prepared in `docs/distribution.md` §4b — field labels read off the live forms, both constrained dropdowns already resolved. *~10 min of pasting.*
3. **Decide the corpus question** (new, and the one that actually governs the goal — see below). *A decision, then I do the work.*
4. **Swap the analytics token.** Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom → *Account* → **Account Analytics: Read**, nothing else. Then `gh secret set CF_ANALYTICS_TOKEN` and `gh workflow run cf-admin -f action=push-secrets`. The mirror of the deploy token stops on its own. *~5 min.* I cannot do this: creating a token needs a User→API Tokens→Edit credential that deliberately does not exist on the Pi or in CI, and writing a repo secret needs a PAT the workflow token cannot be.
5. **Add the remote MCP endpoint to the two open awesome-list PRs** — or tell me to, and I will push the edits. Both PRs currently describe a stdio server that needs a clone; `https://index.percall.dev/mcp` is a URL anyone can paste, which is a materially better pitch to those reviewers.
6. **Optional: request Stripe machine-payments access.** Slow-moving, so worth filing before you need it.
7. **Glama.ai — say which key you have.** Nothing in this repo reads a Glama credential and nothing needs one: Glama indexes MCP servers by scraping `punkpeye/awesome-mcp-servers`, so PR #11152 is already the route in. But Glama sells two different things — a gateway/inference API (irrelevant here) and the MCP directory. **If yours is a directory key that allows direct submission**, that is a real channel worth adding to `docs/distribution.md` §5, and it matters more now that `/mcp` is a URL rather than a clone. Tell me which and I will wire it. Until something reads it, do not push it to the Worker: an unused credential on a production Worker is pure downside, the same reasoning as the `CF_ANALYTICS_TOKEN` item above.

### 3. The corpus question — the real ceiling on "every AI ends up here"

The query endpoints are now good: ask `/ask` a specific question and the right
listing comes back first, every time I tried. But the index holds **ten**
listings, six of them your own Polish apps. A directory wins a specific search
by *having the answer*, and ten entries mostly cannot. This is now the binding
constraint — no further endpoint work moves it.

Three ways forward; they are not exclusive, and I need your call because two of
them are editorial positions, not code:

- **(a) Stay self-registration-only.** Purest, matches the pitch ("products register themselves"), and grows at whatever rate distribution delivers — which so far is zero organic registrations in 23 days.
- **(b) Seed it as a curated index.** Add high-quality public AI products the way any directory does — public facts about public products, no consent needed, each carrying `submitted_by: "registry (curated)"` so the provenance is never disguised. Gets to a few hundred entries and makes the search surfaces worth calling. Changes the story from "self-registration directory" to "curated index that also accepts self-registration". **My recommendation**, because a search endpoint with nothing to find is the worst of both.
- **(c) Pick a niche and own it.** Rather than compete with the 20,000-Actor generic listings, index one thing exhaustively — e.g. every x402-payable endpoint (the Bazaar's 14.7k resources are public and machine-readable, and nothing indexes them *well*), or Polish-market data APIs. Narrow, defensible, and it feeds the x402 scale-up plan directly.

Say **(b)**, **(c)**, or **(b)+(c)** and I will build it. Under (b) or (c) I
would also want a stated rule for de-listing on request, which is cheap now and
expensive later.

## Blocked on Kamil — detail

The rail is proven end to end as of 2026-07-29; what stands between this and
revenue now is distribution.

### The one that matters

- [x] **Mainnet rail is on** — done 2026-07-25: `"active": "mainnet"` (Base, USDC, PayAI facilitator). The testnet rehearsal below was **deliberately skipped**, so the rail was verified statically only — until the settlement below.
- [x] **Put $0.05 of real USDC through it** — done 2026-07-29, the rail's first end-to-end settlement. Throwaway payer `0xC8b3…87D4` (key on the Pi: `~/.x402-test/payer.key`, funded 6.25 USDC from Coinbase) paid the live endpoint via `x402-fetch@1.2.0`: HTTP 200 + receipt, audit delivered (kc-it.pl A 100/100), replay of the same authorization refused with `already been used`, settlement on chain in block 49270394 (tx `0x6b68…8842`, 0.05 USDC throwaway → receiving address, facilitator paid the gas), dashboard shows settlements 1 / $0.05 / rail **live**. Full record: DEPLOY.md → Phase 3.3. ~6.20 USDC stays in the throwaway as protocol play-money — each further self-audit just moves five cents home.
### Distribution and optional rails

- [x] **Receiving address** — done 2026-07-25: `0x48934cDA4F8f3F692d4deEED3D2B4f15852E2424` (Binance Web3 Wallet, self-custodial, Base).
- [x] **Payment rail proven end to end** — done 2026-07-25. The official `x402-fetch@1.2.0` client was driven against a local `wrangler dev`: it parsed the 402, signed an EIP-3009 authorization, paid, and the **live** `x402.org` facilitator verified the signature and failed only on `invalid_exact_evm_insufficient_balance` (unfunded throwaway wallet). The same signature was also accepted through the v2 path. Nothing is left to prove but funding.
- [ ] **Swap the analytics token for a scoped one.** `/api/stats.json` publishes today because `push-secrets` mirrors the deploy token into `CF_ANALYTICS_TOKEN` — it turned out to satisfy Account Analytics: Read. But it also carries Workers Scripts: Edit, so a bug that ever exposed the Worker's env would hand over deploy rights. Create a token with **only** Account Analytics: Read, `gh secret set CF_ANALYTICS_TOKEN`, re-run `gh workflow run cf-admin -f action=push-secrets`; the mirror then stops on its own.
- [x] **CDP API key, and the rail switched onto it** — done 2026-08-01. Kamil created a **Secret API Key** (Ed25519) at `portal.cdp.coinbase.com/access/api` — the portal's x402 page is metrics-only and "Custodial Wallet" wants a US business account, so neither is the right door. Both halves are repo secrets, pushed to the Worker by `cf-admin -f action=push-secrets` and never in `site.config.json`. `verify-rail.mjs` used to be unable to check this rail because CDP's `/supported` answers 401; it now signs the request with the Worker's own auth code, so `cf-admin -f action=verify-cdp` verifies it on the runner where the secrets live — **key accepted, 24 kinds advertised, both v2 `eip155:8453` and v1 `base` settled**. `"active": "cdp"` since, proven by a real $0.05 payment (tx `0x28f4…8292`, block 49327142) with the replay refused. Buys a free tier of 1,000 tx/month and — the actual point — Bazaar cataloging.
- [ ] **Get the endpoint into the x402 Bazaar.** Everything on our side is done; the listing has not appeared. Not lag alone: CDP builds a listing from discovery metadata attached to a **settlement**, and we attached none for the first four. Read off the live catalog (the docs are vague), 1,698 of its 1,795 v1 resources carry `discoverable: true` inside the v1 `outputSchema`, and their published `extensions.bazaar.info` is visibly derived from it. `/api/audit` now publishes exactly that (plus `extensions.bazaar` for v2) and has settled a payment carrying it — and is still not listed minutes later. Check with `node scripts/bazaar-check.mjs`, which scans all ~14.7k entries by receiving address and prints what to rule out. If it stays absent for a few days, the likely answer is CDP-side: `x402-foundation/x402#2112` reports the identical symptom after 8 settlements with the official SDK, no maintainer reply.
- [ ] **Optional: Stripe machine-payments access** — request it so the fiat rail (settles to the Stripe balance in USD, no crypto handling) becomes available later. The existing `pk_test_…` key belongs to the card rail and unlocks nothing for x402.
- [ ] **Post Show HN — draft rewritten 2026-08-01 and ready to go; only the posting is left, and that is Kamil's.** The day-7 gate opened it (see below), so it no longer waits on organic listings. The draft leads with the measured numbers and the zero-conversion finding rather than the directory, and carries three new "did not expect" items worth more than the old ones: the Bazaar's undocumented wire format, the Worker-cannot-fetch-itself 502-after-charging bug, and the spec-vs-installed-base split. Titles, the three comment threads to expect and prepared answers are all in `docs/show-hn.md`. Re-read `/api/stats.json` the morning you post and refresh the five figures — stale numbers are the one thing that would sink it.
- [x] **Publish the domain-root discovery repo** — done 2026-07-10: `110kc3/110kc3.github.io` live. Note this is now partly superseded — `index.kc-it.pl` is itself a domain root, so it serves its own `/llms.txt`, `/robots.txt`, `/sitemap.xml` and `/.well-known/agent.json`.
- [x] **Managed AI-crawler block cleared on every zone** — done 2026-07-29, after Kamil's second token update finally carried Zone → Bot Management → Edit. `robots-report` read all five zones (four had `managed=true, ai_bots=block`; percall.dev was clean); `robots-allow` updated all four — every zone's plan refused the `policy_only` variant, so the fallback `is_robots_txt_managed: false` applied. Verified live: the managed stanza is gone from all three affected origins, and fresh audits score `stareaparaty.com`, `protocolindex.eu` and `overtimelog.com` at **A 100** — the whole 12-site fleet now sits at 100/100. Two footnotes: the Amazonbot-on-an-affiliate-site question resolved itself (the block was Cloudflare's wholesale default, not curation, and Amazonbot crawling an affiliate site costs nothing); and dropping the managed file exposed that `overtimelog.com` serves its SPA HTML at `/robots.txt` — the audit forgives it, but a real robots.txt in `overtime-guard-slack` would be the honest fix. **Fixed 2026-08-01** (`overtime-guard-slack@089225e`): a real robots.txt and sitemap.xml, both live. Cloudflare Pages' index.html fallback was the cause, so the same trap applies to every Pages site in the fleet that has no explicit robots.txt.

- [x] **Re-home the `agent-readability-service` listing onto an origin we control** — done 2026-07-29. The listing now points at **https://kc-it.pl/services/agent-readability**, which scores **A 100/100 (13/13)** against `/api/score`; it used to point at `https://github.com/110kc3/seo` and read **E 51** — the Track A shopfront failing its own audit (found in the 2026-07-29 review). The page is the sales page the review asked for: the offer, the 2026-07-28 fleet-sweep case study as before/after evidence, and the three entry points (free score, $0.05 x402 audit, `[hire]`). It lives in `personal-page` (`services/agent-readability.html`, plus a JSON twin and an OG card), is listed in that site's `llms.txt`, and is linked from the "For humans" section here. `scores.json` was refreshed by hand rather than waiting for the weekly cron.
- [ ] **Directory submissions — the two PR-shaped ones are out; the rest need a browser.** Executed 2026-07-29 with your go: **PR [punkpeye/awesome-mcp-servers#11152](https://github.com/punkpeye/awesome-mcp-servers/pull/11152)** (90k★, the big one, agent-PR fast-track title, upstream CI green) and **PR [SecretiveShell/Awesome-llms-txt#114](https://github.com/SecretiveShell/Awesome-llms-txt/pull/114)**. Both are one-line diffs and both now wait on their maintainers; on the 2026-07-29 domain migration both PRs were updated in place to carry `https://index.percall.dev` (branch push for #114, body PATCH for #11152). **agentswelcome.dev is done — certified and listed 2026-07-29 at 100/100, "exemplary", all 18 checks passing** (entry `6cd7585c82eb`; re-certified after the domain migration as `https://index.percall.dev`, entry `ae21017ab44f`, again 100/100 — the old-URL entry 308s and will age out on their side). It first refused the submit with HTTP 422 at 54–60/100 against a 70 gate; the four failing checks were closed in `6a2cc70` (the plural `/.well-known/agents.json` generated from a template, RFC 9116 `security.txt`, the negotiated markdown twin relabelled `text/markdown` instead of `text/plain`, and an `X-Agent-Welcome` header beside the existing `X-Agent-Protocol`) and `4ca744a` (flattening the web-bot-auth advertisement — these auditors read shallow, and a capability nested one level too deep reads as absent). Full write-up, including the 3-audits/hour free tier and why the first submission recorded a stale 78, in `docs/distribution.md` §4. **wong2/awesome-mcp-servers no longer takes PRs** — its README redirects submissions to a web form at mcpservers.org/submit. Still manual, all browser sign-ins or forms: llms-txt-hub (llmstxthub.com/submit, GitHub OAuth), directory.llmstxt.cloud (Tally form), llmstxt.site, mcpservers.org. **Every answer for all four is prepared in `docs/distribution.md` §4b** — field labels read off the live forms 2026-08-01, including the two constrained dropdowns (llms-txt-hub takes one of exactly five categories → `ai-ml`; mcpservers.org → `Search`), so it is ten minutes of pasting. Never submit the old `110kc3.github.io/seo/` URL, `index.kc-it.pl`, or the workers.dev fallback.

## Revenue dashboard — live at https://revenue.local.kc-it.pl

Tailnet only, and no token in the URL. Caddy on the Pi injects the bearer token
from `~/docker/.env`, so the secret never reaches a browser, address bar or
bookmark; the vhost also 404s anything outside `100.64.0.0/10`, because ports
80/443 are bound on every interface and DNS is routing rather than access
control. Publicly, `index.percall.dev/dashboard` is an ordinary 404 — its existence
is not disclosed. Full design and the three-place rotation procedure in
DEPLOY.md → Phase 5.

## The decision gate

The reason this work happened: after 16 days live, the registry had **zero organic registrations** — all 6 issues were self-authored E2E tests from 2026-07-09 — and GitHub Pages gave no logs, so there was no way to tell whether an agent had ever visited.

Once the Worker has been live for a week, read `/api/stats.json`:

- **`agent_share` is non-trivial** → the registry has an audience; keep feeding it and run the Show HN.
- **`agent_share` is ~0** → that is the answer. Stop investing in the registry and put the hours into Track A sales, where the bot-traffic statistics are the pitch rather than the product. The audit endpoint stands on its own either way.

Early readout, 2026-07-29 (day 4): `agent_share` **3.2%** — 60 ai_crawler +
293 script hits/30d, 75 free scores, 22 llms.txt fetches, 7 audit-path hits
(all 402 bounces, none paid). Non-trivial for a site with zero inbound links;
leaning **keep + Show HN**. Full pass in `docs/review-2026-07-29.md`.

**Gate read, 2026-08-01 (day 7) — verdict: KEEP, and run the Show HN.**
`agent_share` **7.19%**, more than double the day-4 figure: 336 ai_crawler hits
of 4,672 requests/30d, plus 787 script clients that are neither browsers nor
self-declared crawlers. 108 free scores (was 75), 71 llms.txt fetches (was 22),
30 reads of `/api/x402/info`. Agents are finding a site with no inbound links,
and the share is rising, not decaying — that is the "non-trivial" branch.

The other half of the readout is flat and matters as much: **45 hits on the paid
endpoint, 6 settlements, all 6 our own.** No agent that met the 402 has ever
come back with a payment. So the audience is real and the *conversion* is zero,
which is an argument for distribution and for a second service, not for more
polish on this one. The Show HN draft now leads with exactly that number.

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
- [ ] x402 Bazaar listing — promoted out of "later": it is now the open item under Distribution above. Re-checked 2026-08-01 ~2h after the metadata-carrying settlement: still absent from all 14,658 catalog entries.
- [ ] Once the corpus question is decided, revisit whether `/ask` should summarize by default. It only summarizes on `prefer.mode=summarize` today, which is right for ten listings and probably wrong for a few hundred.
- [x] ~~RFC 9421 web-bot-auth response signing~~ — done 2026-07-25, both directions.
- [ ] Publish the `clients/` wrappers as real packages (PyPI + npm) — only once there is traffic that justifies a release pipeline.
- [x] ~~Score badge variant~~ — done 2026-07-25 as `/badge.svg?slug=…&show=score`, fed by `scores.json` from the weekly cron.
- [x] ~~Retire the old `110kc3.github.io/seo/` Pages deploy~~ — done 2026-07-25.

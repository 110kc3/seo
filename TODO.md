# TODO

## ⚡ Needs Kamil — read this, skip the rest

*Everything here needs your credentials, a browser, or an external/public
action. There is currently no open repository-side implementation. Updated
2026-09-01; where the changelog below disagrees with this list, this list wins.*

### Ready now

1. **Post Show HN in the next Tue–Thu, 14:00–16:00 UTC window.** The 25 Aug
   hold has expired and every gate now passes: analytics is healthy, the rolling
   window is a full 30 days, seven third-party products have exercised the real
   registration workflow, and organic payment conversion remains zero. The
   draft and posting checklist were refreshed from the 2026-09-01 16:13 UTC live
   snapshot: `vault 40-projects/x402-scale-up/show-hn-draft.md`. The next clean
   slot is Wed 2 Sep, 14:00–16:00 UTC. Refresh once immediately before posting;
   submission under your HN account remains your action.

### Commercial evidence — do not replace this with more engineering

2. **Personal outreach is the 30-day sales test.** Use the ICP, tracker fields,
   two-message sequence and stop gates in
   `vault 40-projects/x402-scale-up/2026-08-06-commercial-reset.md`. Send 10
   genuinely personalized messages per weekday until 50 qualified founders have
   been contacted. Do not buy a list or automate the sending. Record replies,
   calls and payments, not opens.

3. **Indexation:**

   1. Google Search Console — verify `percall.dev` and `kc-it.pl` as Domain
      properties.
   2. Submit `https://index.percall.dev/sitemap.xml` and
      `https://kc-it.pl/sitemap.xml`.
   3. Bing Webmaster Tools — verify both; submit `https://percall.dev/` and
      `https://kc-it.pl/services/agent-readability` manually.
   4. Request indexing for both sales/front-door URLs in GSC.

4. **Optional: Clustly — one small channel experiment.** It was still
   unconfigured on 2026-09-01 (`/etc/clustly-agent.env` absent; unit inactive).
   Register at <https://www.clustly.ai/operator>, store the one-time `clk_…` key in
   `/etc/clustly-agent.env`, publish `clustly/listing.json`, and enable the unit.
   Runbook: [docs/clustly.md](docs/clustly.md). Read the custody caveat first:
   their managed wallet holds earnings until swept. Stop the unit and listing
   after 30 days if it produces no qualified order.

### Useful, but not launch blockers

5. **Create two optional Stripe Payment Links** in the KC-IT Stripe account:

   - `Agent-readability report` — **$49 USD**, one-time, quantity fixed at 1.
     Collect buyer email and a required `Website URL` custom field.
   - `Done-for-you agent-readability implementation` — **$199 USD**, one-time,
     quantity fixed at 1. Collect buyer email plus required `Website URL` and
     `Repository or platform` fields.

   Do not promise automatic fulfilment or recurring service. Set the
   confirmation message to say Kamil will confirm scope and delivery date by
   email; refund rather than silently expanding a site that does not fit.

   Send the two `https://buy.stripe.com/...` URLs back here. They must replace
   the temporary `mailto:` order links in the `personal-page` repo:
   `services/agent-readability.html`, `.json`, `.md`, and the Agent Skill.
   The public prices and exact scopes are already live in those files.

   The service remains buyable by email while these are absent; the live page
   still used the temporary `mailto:` links on 2026-09-01.

6. **Configure honest response signing on the kc-it.pl Pages project.** The key
   directory still returned 404 on 2026-09-01. Confirm the Pages project name,
   then run this from a terminal authenticated to the correct Cloudflare
   account:

   ```bash
   node --input-type=module -e 'const k=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);const j=await crypto.subtle.exportKey("jwk",k.privateKey);process.stdout.write(Buffer.concat([Buffer.from(j.d,"base64url"),Buffer.from(j.x,"base64url")]).toString("base64"))' |
     npx wrangler pages secret put SIGNING_KEY --project-name PERSONAL_PAGE_PROJECT
   ```

   Replace `PERSONAL_PAGE_PROJECT` first. Re-deploy the Pages project, then
   verify that
   `https://kc-it.pl/.well-known/http-message-signatures-directory` returns 200
   and that `curl -I https://kc-it.pl/services/agent-readability` shows
   `content-digest`, `signature-input`, and `signature`. Until the secret exists,
   the directory deliberately returns 404 instead of pretending unsigned
   content is verifiable.

### Current health — not tasks

- **Traffic measurement restored.** `/api/stats.json` returned `ok: true` on
  2026-09-01 and the 2026-08-26 health run committed a fresh traffic snapshot.
  The live 30-day reading was 71,814 requests with 5.75% classified as an AI
  crawler or action agent. The incident workflow remains in place and will open
  one exact-title issue without overwriting the last good series if this fails
  again.
- **Repository health confirmed.** On 2026-09-01 there were no open issues or
  pull requests, the latest workflows were green, production endpoints returned
  200, and live `llms.txt` matched the generated artifact byte for byte. All
  three external directory PRs were zero commits behind with no failing checks;
  each now waits on a maintainer. The deprecated action-runtime warning exposed
  by the verification deploy was cleared by upgrading all workflows to the
  Node 24-based `checkout@v7` and `setup-node@v7` actions; project tests still
  run on the required Node 22 runtime.

### Held — do not do these yet

- **No new x402 endpoint, directory feature, paid listing work, or marketplace
  build until the commercial reset is evaluated after 50 qualified contacts or
  30 days, whichever is later.** The gate is evidence, not another deploy.
- **No paid acquisition.** First require at least 5 positive replies, 2 sales
  calls and 1 paid human order from the 50-lead outreach test.

### Optional, low urgency

- Stripe machine-payments access and the Cloudflare Monetization Gateway
  waitlist can remain applications; neither is needed for the two card offers.
- Delete `GLAMA_API_KEY`; nothing uses it.

---

<details>
<summary><b>Changelog</b> — ~480 lines of done work, kept for the reasoning. Nothing below needs you.</summary>

## ✅ Deploys are unblocked again (2026-08-01, 14:16 UTC)

The four-hour outage from 11:50 is over. Everything since `667339b` is live:
the x402 catalog, the MCP catalog, 30 curated listings, `/api/x402/search`,
`/api/mcp/search`, and two new MCP tools. `/api/stats.json` answers again too.

**What it actually was, in order** — worth keeping, because three of the four
diagnoses along the way were wrong:

1. The deploy token lost **Workers Scripts: Edit** in the dashboard. Symptom:
   `Authentication error [code: 10000]` on `/workers/services/ai-product-index`,
   while `wrangler whoami` still succeeded. Editing the token to restore it did
   not work twice — the second attempt dropped Analytics Read too
   (`stats-probe` 200 → 403) without adding Workers write back.
2. A replacement token was created, but the value set as the secret was an R2
   **Secret Access Key**, not the API token. Symptom changed to
   `Invalid access token [code: 9109]` on `/accounts` — the token value itself
   was rejected, not its permissions. The distinction between those two error
   codes is what identified it.
3. With the correct API token value in place, `wrangler deploy` succeeded on the
   first try and `push-secrets` moved `CF_ANALYTICS_TOKEN` onto the Worker.
4. `/api/mcp/search` still answered 503 afterwards — an unrelated bug the
   outage had been hiding. See below.

**Lesson worth keeping:** `10000` is a permissions problem, `9109` is a bad
token value. Check `/user/tokens/verify` with the value *before* setting the
secret; it distinguishes the two in one request and skips a whole round trip.

## Fixed: the MCP catalog was never uploaded (2026-08-01)

`/api/mcp/search` returned `catalog_unavailable (HTTP 404)` while
`/api/x402/search` worked. All of `api/mcp/` was 404 in production despite being
committed, current, and passing every test.

`.assetsignore` is gitignore syntax, where **an unanchored pattern matches at
every depth**. The bare `mcp` line, written for the top-level `mcp/` directory,
therefore also excluded `api/mcp/` — 7.3 MB of catalog that wrangler simply
never uploaded. It reported `Success`.

Every entry is now anchored with a leading slash (`/mcp`), except
`node_modules`, which should vanish at any depth. The existing test only checked
that nothing ships *by accident*; a second test now checks the other direction,
and was confirmed to fail against the pre-fix file.

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

## Done (v3.14 — a second product, its own hostname, and three stale claims in this repo's own docs, 2026-08-02/03)

- [x] **The Router — a second paid service, chosen for what it refuses to do.** Kamil's brief was a broker: verify an endpoint answers, route the request, take a commission. The finding that reshaped it is that **an x402 payment is bound to its payee** — our own verifier refuses any authorization whose `to` is not our `payTo` (`worker/x402.js:275`), and so does everyone else's — so a broker cannot forward a caller's signature. It must collect and re-pay as merchant of record, which brings float, refund liability on a $0.005 margin, and a custody question that is plausibly a MiCA authorization. His call: the non-custodial version, *"I will not pay from my own wallet."* Full analysis in `vault 40-projects/x402-scale-up/second-service.md`.
- [x] **`GET /api/liveness` and `POST /api/route`, $0.005 each.** Probe an endpoint now; or rank candidates for a task, each probed live, each with the terms it quotes and the URL to call. A query matching nothing is free. What is sold is freshness: the Bazaar keeps entries 30 days past last settlement, so *listed* and *answers* are different facts and only one was published anywhere.
- [x] **"Never pays" is enforced, not intended.** The probe sends a two-header allowlist; the caller's headers are never an input to it, because their request may carry an `X-PAYMENT` made out to us and forwarding it would hand a signed credential to a stranger; and a structural test forbids any module under `worker/` from setting an outbound payment header. The whole product works *because* it does not pay — an unpaid probe returns the endpoint's 402, and a 402 states its terms, so liveness and price arrive in the same free request.
- [x] **Per-endpoint history**, fed by live probes rather than the weekly cron. The cron walks a rotating slice of 600, so it sees any endpoint about twice a year and stores only failures — right for "what share of the catalog is dead", useless for "is this endpoint reliable". A cache hit is not an observation, and the uptime ratio is withheld below three of them rather than published as "1 of 1".
- [x] **Paid end to end on mainnet, and it cost $0.01.** Two settlements, exactly $0.010000 moved. It bought four things no test could: a **paid GET** settles (every prior settlement here was a POST, and a GET carries its parameters in the challenge's resource URL); we can parse a 402 **we did not write** (`2s.io` quoted four options in one challenge, more than any fixture); live quotes agreed with the catalog; and history took its first real observations.
- [x] **`router.percall.dev`**, same Worker and repo — a subdomain needed neither forked, only a hostname the Worker stops treating as an alias. Shipped **inert** behind `router_host`, because setting it makes the canonical host 308 two live paid endpoints and doing that before the domain resolves would take them down. Attach first, config second; the order held.
- [x] **Indexation.** The apex had shipped into a state where nothing could reach it: no sitemap carried it, nothing linked to it, and the one external link pointing at it was being corrected away by our own PR. Meta descriptions were being cut mid-word by a hard `slice(0, 160)` — on a site that grades `title_and_description` for other people. All fixed, plus `scripts/indexnow.mjs` announcing changed pages to Bing/Yandex/Seznam after each deploy.
- [x] **Analytics could not see either product.** `/api/liveness` and `/api/route` fell into the generic `api` bucket beside free reads that outnumber them 10:1; and `percall.dev/` and `index.percall.dev/` both bucketed as `home`, so the umbrella could have had zero visitors since launch and read identically. Own buckets for both, `apex_home` for the portfolio page, and **hostname recorded on every request** — `url.hostname`, since the port turned three scanner targets into phantom hosts.
- [x] **A page that said nothing shipped to production.** `/router.html` served a correct header, the literal string `undefined`, and a correct footer: `const body` computed and never passed. It passed every check this repo owns — asset classified, in the sitemap, meta description well-formed, canonical right, deploy green, route answering 200. `page()` now throws on a missing body, and a test asserts every page has an h1 and a body too large to be header-plus-footer.

**Three claims in this repo's own docs were false, all leaning the same way — "someone else's turn":**

- `NEXT.md` §2.4 said the discovery hub pointed at `index.kc-it.pl` in 47 places and mentioned `percall.dev` zero times. Already fixed weeks earlier. The two surviving mentions are one sentence telling agents *which* host to quote — the opposite of the defect. What was *actually* wrong is that the hub had never heard of the Router.
- §3 called PR #114 "purely maintainer lag" while a `CHANGES_REQUESTED` review sat unanswered since 2026-07-29. The maintainer was right twice: the description named the retired host while the diff added the canonical one, and the branch was 19 commits behind with a conflict.
- §1.10 warned the attach would need the dashboard because the token lacks zone rights. It had them; the workflow succeeded first try.

The file's header claims it wins when docs disagree with it. It only earns that by being re-read against reality.

**265 tests** (was 216).

**Shipped after that entry was written, same session:**

- [x] **Unbundled the audit** — `GET /api/check?url=…&check=<id>`, $0.005 for one check, because competitors sell a single signal for half a cent while this sold twenty for five cents or nothing. A test pins both directions: one check must cost less than the report, and buying all twenty singly must cost more, or the bundle is the worse deal.
- [x] **MCP routing** — `/api/route` takes `catalog: "mcp"` and probes by *starting a session* rather than knocking. A GET returns 405 from a healthy MCP server, which would have graded the whole registry alive; `initialize` asks the real question, and 401/403 is kept as its own verdict because credentials-required proves a server is there.
- [x] **The avoid-list**, free, per catalog. Building it exposed that the sweep re-probes any endpoint about **twice a year**, so two consecutive misses take a year — `confirmed` and `suspected` are separate lists rather than one that is empty or overclaiming.
- [x] **The signature advertised**, with the claim corrected before publishing: the draft said "nothing else does this" and 83 of 14,734 endpoints do. The shipped line is 0.6%, and that they sell signing as a product while here it is a property of every response.
- [x] **Monitoring** — `POST /api/watch` (on the Router host) buys N prepaid sweeps and webhooks on a state change. Prepaid rather than a subscription, because a stored mandate to charge later is custody; the payer address from the settlement owns the watch, so there is no account; alerts are edges, not levels.
- [x] **Proven end to end with real money.** $0.04 on watch purchases, and a deliberate outage on `kc-it.pl` fired both edges — outage and recovery — with delivery confirmed by a webhook sink rather than inferred.

**Two defects found by asking the obvious question:**

- **The watch called a 500 "answering".** `probe().alive` is true for any HTTP response — correct for the Router, where a 402 is the successful outcome — and monitoring inherited it. An endpoint erroring for a week would never have alerted. `probe-catalogs.mjs` had the right rule written down since the catalogs shipped; the one product sold on knowing was the one place not following it.
- **A catch-all bought 11 free points** (#10). The five 2026 signal checks tested `resp.ok` alone, so a site whose unmatched paths answer 200 with the homepage passed all five on documents it did not have. `kc-it.pl` scored **A 95** with eleven points for files that do not exist; the honest grade is 84. That is the default configuration for SPAs and for Pages without a 404.html, so it inflated grades for customers too — always upward, which is the direction nobody reports.

## Done (v3.13 — the audit reports 2026, and the site publishes skills, 2026-08-01)

- [x] **The 2026 signals are reported, and deliberately not scored.** `/api/score` and `/api/audit` now detect Content Signals, the A2A 1.0 card path, an MCP server card, an RFC 9727 API catalog, an Agent Skills index and a Web Bot Auth directory — as `signals`, beside `checks`. `scoreChecks()` never sees them, so **no existing grade moved by a point**: badges in other people's READMEs and the fleet's 100/100s are untouched. Promoting them into the score stays a separate decision (see below). Free callers get the detections; the per-signal fixes stay paid, same rule as the scored checks.
- [x] **A real fault behind that test.** `scoreChecks()` summed `c.weight` directly, so one weightless entry made the total `NaN` — and `NaN` being falsy, the function returned **0**. A flawless site would have been graded "invisible to agents" because something weightless got into the array. Weights are now read defensively.
- [x] **Agent Skills published** — four at `/.well-known/agent-skills/index.json`: grade a site, find a paid API, find an MCP server, list a product. Each wraps capability that already ships. **Generated, not hand-written**, because the index publishes a sha256 of every skill body and a client is entitled to check it; a stale digest does not read as an oversight, it reads as tampering. Descriptions come from each skill's own frontmatter so the index and the file cannot disagree.
- 191 tests (was 188). Verified live: all four digests match the bytes actually served.

**Known limitation, and it only affects us — half fixed 2026-08-01.** When this
site audits *itself*, `fetcherFor()` uses the `ASSETS` binding, because a Worker
cannot fetch its own hostname. `ASSETS` serves committed files only, so
**anything the Worker does at request time is invisible in a self-audit.**

`web_bot_auth` is fixed: the key directory is now answered from the same
function `index.js` serves it with, so a self-audit measures the real thing.
Verified live — it reads present again.

**`markdown_negotiation` has the same root cause and is not fixed.** Content
negotiation happens in the Worker's header layer, which `ASSETS` never runs, so
a self-audit sees raw HTML and reports the signal absent — while
`curl -H 'accept: text/markdown' https://index.percall.dev/` returns
`text/markdown; charset=utf-8` to everyone else.

Patching it the way `web_bot_auth` was patched would mean re-implementing
`negotiate.js` inside `score.js` — a second copy of the negotiation rules that
can drift, which is the exact anti-pattern the MCP tool-list fix removed. **The
right fix is general: route same-host audits through the Worker's own fetch
handler rather than the binding**, so every request-time behaviour is exercised
at once. That needs a recursion guard first (auditing our own `/api/score` would
otherwise re-enter), which is why it is written down rather than rushed.

Impact is bounded: signals are unscored, so no grade is affected, and external
audits use real fetch and are correct. Only our own informational signal block
understates us, by one.

## Done (v3.12 — caught up with where the specs moved, 2026-08-01)

Researched what agent-facing sites publish in 2026 and measured this one against
**Cloudflare's Agent Readiness checklist** — the audit we are judged by anyway,
being hosted there. Full findings, the gap table and the staged plan:
**`docs/agent-readiness-2026.md`**.

The finding was not a missing feature. We were ahead on protocols and behind on
**paths**: specs we already implement have moved, and we were still serving the
old locations only.

- [x] **`/.well-known/agent-card.json`** — A2A is 1.0 under the Linux Foundation and the card lives here; `/.well-known/agent.json` is the pre-0.3 path, where **a spec-compliant 1.0 client never looks**. Both are now written from one template, so neither generation of client is blind to us.
- [x] **`/.well-known/mcp/server-card.json`** — same shape, except here the specs disagree with each other rather than with their own past: SEP-2127 says `/.well-known/mcp.json`, Cloudflare reads `mcp/server-card.json`. Both served.
- [x] **Our own scorer was grading others on the old path.** `agent card at /.well-known/agent.json` — we sell agent-readiness audits and were telling sites they passed while a current client could not find them. The check now accepts either, says which answered, and the advice names the 1.0 path.
- [x] **`/.well-known/api-catalog`** (RFC 9727) — a linkset over the seven query/commerce endpoints, served as `application/linkset+json` with the rfc9727 profile. States no new facts; states them where a machine looking for APIs is specified to look.
- [x] `agents.json` now advertises the 1.0 card path, which three agent-readiness checks read.
- 188 tests (was 186).

### Decisions from that plan — all closed

- [x] ~~**Phase 2 — Content Signals in `robots.txt`.**~~ Decided and shipped
  2026-08-02 as `search=yes, ai-input=yes, ai-train=yes`; see `NEXT.md` §4.1.
- [x] ~~**Phase 4** — extend `/api/score`.~~ Detection shipped in v3.13; the
  scoring decision closed 2026-08-02 with seven low-adoption signals promoted
  into versioned check set v2 and the fleet re-scored. See `NEXT.md` §4.2.
- [x] ~~**Phase 5** — Agent Skills~~ — **done** (v3.13), four skills, digests generated.

**The caveat worth keeping:** adoption of most of these is tiny — fewer than 15
sites in a 200,000 sample had an MCP Server Card or API Catalog. Nobody should
expect traffic from publishing a linkset. The reasons to do it are that auditors
already check, and that being unable to pass the checklist we *sell* is a
credibility problem long before it is a traffic problem.

## Done (v3.11 — the catalogs are now checked, 2026-08-01)

Neither upstream registry checks whether its entries still answer. The Bazaar
keeps an entry for 30 days after its last settlement; the MCP registry lists
whatever a publisher declared. So "which of these ~24,700 endpoints actually
answer" was a question nobody could answer. Now it is published weekly.

- [x] **`scripts/probe-catalogs.mjs`**, wired into the Monday cron, writing `api/x402/health.json` and `api/mcp/health.json` — served as static assets, so the liveness data is public the same way the catalogs are.
- [x] **Search flags, never hides.** A confirmed-unreachable result carries `unreachable: true` and stays exactly where it ranked. One probe is evidence, not proof: it is a weekly sample from one network path, so removing entries on that basis would silently delete working endpoints. Two consecutive misses before anything is called dead, and a recovery forgives the record outright.
- [x] **Liveness is an enrichment, never a dependency.** The health file is absent until the first cron run and stale between them; search works identically without it. Not knowing is not the same as knowing everything is fine, and neither is a reason to fail a query.
- 186 tests (was 171).

**The design mistake worth recording, because the first real run caught it.**
The sampler took a contiguous window, `rows[cursor..cursor+600]`. That looked
obviously fine and was obviously wrong: these files are sorted, so anything
correlated with the sort order clusters. Placeholder URLs are **1.6% of the MCP
catalog but were 54% of its first 120 rows**, and the first window reported
"76.4% answered". Sampling every stride-th row instead — cursor advancing one
per run, so a full pass still covers every entry exactly once — the same
catalog reports **94.0%**. Coverage was never the problem; representativeness
was, and only a real run against real data showed it.

**First readings** (rotating sample, so these will move):

| catalog | answered | untestable | note |
|---|---|---|---|
| x402 | **98.0%** | 0% | healthier than the 30-day-stale worry suggested |
| MCP | **94.0%** | 1.6% | untestable = `https://{tenant_host}/mcp` templates a publisher never filled in |

"Answered" deliberately counts 401 and 402 as alive — a 402 is the *correct*
reply from a paid endpoint, and treating it as a failure would mark the entire
point of an x402 catalog as dead. Only transport failures and 5xx count against
an endpoint.

## Done (v3.10 — the outage, and the three things it exposed, 2026-08-01)

A four-hour deploy outage, and then a verification pass over the whole project
that found more than the outage did. **171 tests (was 144).**

- [x] **Deploys unblocked** — full account at the top of this file. Two credentials, two mistakes, four rounds. The keeper: `10000` is a permissions problem and `9109` is a bad token value; checking `/user/tokens/verify` before setting the secret tells you which in one request.
- [x] **The MCP catalog was never uploaded.** `/api/mcp/search` answered 503 while `/api/x402/search` worked, and all 7.3 MB of `api/mcp/` was 404 in production despite being committed, current and green. `.assetsignore` is gitignore syntax, where an unanchored pattern matches at *every* depth — the bare `mcp` line written for the top-level `mcp/` directory also excluded `api/mcp/`. Wrangler skipped it and reported Success. Every entry is now anchored (`/mcp`); `node_modules` stays unanchored on purpose. The old test only guarded against files shipping by accident, so a second test guards the other direction, confirmed to fail against the pre-fix file.
- [x] **`process-issue.mjs` now has tests** — 25 of them, and it had none. It is the only script here that takes input from a stranger and turns it into a committed file, and it enforces ownership, the per-account cap and single-use payment receipts. It is a program rather than a module, so it is tested as a subprocess against a throwaway copy of the repo — the same way `register.yml` invokes it, and with no refactor of code nothing was exercising. Covers ownership, dedup by slug and normalized URL, the account cap, payload shapes, path-escape attempts, and the upgrade ledger including hash recasing.
- [x] **The two MCP servers no longer disagree.** `worker/discovery.js` had grown to six tools while `mcp/server.mjs` still declared three, so what a client could do depended on which server it reached. The stdio server now imports the Worker's definitions and forwards `tools/call` to the Worker's own `/mcp`; there is no second copy left to drift. `register_product` stays as the one deliberate addition — it needs a GitHub token, which a public Worker must not carry. `tools/list` stays offline for registry health checks, verified under `docker run --network none`.
- [x] **`/ask` summarizes by default** — the item gated on the corpus decision, which shipped. `mode=list` opts out, and the change only adds a field. A miss now names the two catalogs instead of saying there is nothing: "nothing matches" was only ever true of the *registry*, which is the small half of what this site indexes, and saying it flatly sent agents away from an answer one endpoint over.
- [x] **Glama prep** — `glama.json` and a `Dockerfile`, because PR #11152 now requires a Glama listing and a score badge. Health check verified against the built image.

**Verification pass, 2026-08-01** — build determinism PASS, 171/171 tests, 0
listings delisted or failing, 20/20 live surfaces, self-audit **100/100 (13/13)**,
RFC 9421 signing present, x402 402 shape correct, CDP rail key accepted with
`eip155:8453` live, `/api/stats.json` publishing again.

**Found and left open:** the register path has not executed since 2026-07-09 —
see item 3 of the pending list below, which is a decision rather than a task.

### ~~Next engineering item~~ — done 2026-08-01, see v3.11 below

## Done (v3.9 — two niches indexed exhaustively, 2026-08-01)

The corpus question, answered as **(b) + (c)**. The index went from 10 listings
to 40 listings plus **24,741 catalogued callable things**.

- [x] **The x402 catalog — 14,661 paid endpoints, 1,527 hosts.** `GET /api/x402/search?q=weather&max_price=0.01`, plus `/api/x402/catalog.json` and `/api/x402/stats.json`. The Bazaar publishes offset paging and nothing else, so "is there an x402 endpoint that does X and what does it cost" meant pulling all 15k records yourself. Prices are computed only for assets whose decimals are known — guessing 6 would print a number wrong by orders of magnitude — and an unpriced endpoint is *excluded* by a price filter rather than sorted first as free. Ranked by relevance then cheapest. The aggregate worth knowing: **the top 10 hosts hold 27% of all endpoints**, median price $0.014. It is a smaller ecosystem than 14.7k suggests.
- [x] **The MCP catalog — 10,080 remotely-callable servers, 7,519 hosts.** `GET /api/mcp/search?q=github&auth=none`. Scope rule is the opinion: *active + latest + remotely callable*. A package-only server is a thing you install; one with a URL is a thing an agent can use now. Exclusions are counted in `stats.json` and stated in the artifact. **Nearly shipped at less than half size** — the first run stopped at a 200-page cap and reported 4,748, looking exactly like a complete catalog. The pager now hard-fails if it stops with a cursor in hand; silent truncation is the one failure mode a mirror cannot have.
- [x] **Both reachable as MCP tools** — `search_x402_endpoints`, `search_mcp_servers`. The x402 search generalized rather than being copied: catalogs declare source, filters, field weights and tiebreak, and routes plus tools are derived from that table, so a third catalog cannot ship half-wired.
- [x] **30 curated listings** (`scripts/seed-curated.mjs`), 10 → 40. Rules published in the script: remotely callable, no credentials, real description and title, one per publisher namespace, URL verified live. Two rules came from reading the first dry run — reverse-DNS ids were leaking in as product names, and one publisher had three entries across three hosts. Candidates fell 2,450 → 1,370 and the list got visibly better.
- [x] **Provenance and a removal route.** llms.txt now states which of three kinds each entry is — self-registered, curated, mirrored — and that removal needs no justification. Republishing other people's data without a stated way out of it is the part that would have been wrong.
- [x] **Weekly refresh** wired into the health cron; the commit gate now asks git whether anything changed instead of trusting step outputs, since the catalog steps have no such flag.
- 144 tests (was 137).

**Still open on the corpus:** nothing in either catalog is health-checked. The
Bazaar keeps an entry for 30 days after its last settlement, so an unknown share
of those 14,661 endpoints are dead. Probing all of them weekly is too much;
probing a rotating slice is not, and "which x402 endpoints actually answer" is a
question literally nobody can answer today.

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

Everything that could be done without you is done, and re-verified on
2026-08-01. What is left needs a browser, a public GitHub action, or a decision
— nothing here is waiting on code. In the order I would do them.

**Every answer for every form is prepared in `docs/distribution.md` §4b.** None
of these five channels has an API; all were checked, not assumed.

0. **Submit to Glama — do this first, it blocks the 90k★ PR.** ~2 min, browser + GitHub OAuth. See item 7 below for why; the paste-ready values are in §4b(e).
1. **Post the Show HN.** Draft rewritten and ready in `vault 40-projects/x402-scale-up/show-hn-draft.md`; the day-7 gate opened it. Refresh the five traffic figures the morning you post — they are already slightly stale (draft says 4,672 requests / 7.19%; live was 4,950 / 7.09% on 2026-08-01). Tue–Thu, 14:00–16:00 UTC, so the next window is **Tue 4 Aug**. *~30 min, then two hours of replies.*
2. **Four directory submissions.** §4b(a–d) — field labels read off the live forms, both constrained dropdowns already resolved. *~10 min of pasting.*
3. **Decide: re-verify the register path?** It has not executed since 2026-07-09, and the code has changed substantially since — its last run failed, though two of the three failures that day were intentional negative tests and the logs are past retention. It now has 25 tests covering ownership, dedup, caps and the payment ledger, but tests exercise the script, not the *workflow*: issue trigger, token permissions, the commit-and-push retry loop and the bot comment are all untested by anything but a real run. Verifying it means opening a real `[register]` issue on the public repo, which creates a public artifact and a real listing — your call, not mine. Say the word and I will run it end to end and delete the listing afterwards.
4. ~~Restore the deploy token, then create a separate analytics one~~ — **done 2026-08-01, 14:16 UTC.** A fresh Workers token replaced the narrowed one and `CF_ANALYTICS_TOKEN` is a genuinely separate credential on the Worker. Both old credentials have been deleted. See the block at the top of this file for what it actually was.
5. ~~Add the remote MCP endpoint to the awesome-list PRs~~ — **done 2026-08-01.** [#11152](https://github.com/punkpeye/awesome-mcp-servers/pull/11152) now leads with `claude mcp add --transport http ai-product-index https://index.percall.dev/mcp` and lists all four tools; branch and PR body both updated, still MERGEABLE. #114 is an llms.txt *Directories* entry where MCP is not relevant — checked, and it already carries the right URL.
6. **Optional: request Stripe machine-payments access.** Slow-moving, so worth filing before you need it.
6b. **Optional: join the Cloudflare Monetization Gateway waitlist.** Browser form; being on Cloudflare is the only prerequisite. It would let the same 402 metering cover `/api/index.json` and the catalogs without writing code. Promoted out of "Later" because the catalogs are now the largest thing this site serves and the only metered surface is `/api/audit`.
7. **Submit `110kc3/seo` at https://glama.ai/mcp/servers/add** — browser + GitHub OAuth, ~2 minutes. This is now a **blocker on PR #11152**, not an optional channel: the `glama-check` bot requires the server to be listed on Glama and the entry to carry a score badge, and every neighbouring entry already has one. The repo side is done and verified — `glama.json` and a `Dockerfile` are in, and Glama's exact health check (start, `initialize`, `tools/list`) was run against the built image and passed. Once the server page resolves I will put the badge on the PR, batched with a tool-list fix. Worth also adding `https://index.percall.dev/mcp` at https://glama.ai/mcp/connectors — the bot's P.S. invites it — though that route gives no badge. **The `GLAMA_API_KEY` question is settled: nothing needs it.** Glama's API is the Gateway (OpenAI-compatible inference); registry submission is a web form. Delete the secret unless it is something other than a gateway key. Detail in `docs/distribution.md` §5.

### 3. The corpus question — DECIDED and DONE

You chose **(b) + (c)**, and both shipped on 2026-08-01: 30 curated listings
(10 → 40) and two niches indexed exhaustively — 14,661 x402-payable endpoints
and 10,080 remotely-callable MCP servers, both searchable, both reachable as MCP
tools. Details in the v3.9 section. Nothing pending on you here.

## Blocked on Kamil — detail

The rail is proven end to end as of 2026-07-29; what stands between this and
revenue now is distribution.

### The one that matters

- [x] **Mainnet rail is on** — done 2026-07-25: `"active": "mainnet"` (Base, USDC, PayAI facilitator). The testnet rehearsal below was **deliberately skipped**, so the rail was verified statically only — until the settlement below.
- [x] **Put $0.05 of real USDC through it** — done 2026-07-29, the rail's first end-to-end settlement. Throwaway payer `0xC8b3…87D4` (key on the Pi: `~/.x402-test/payer.key`, funded 6.25 USDC from Coinbase) paid the live endpoint via `x402-fetch@1.2.0`: HTTP 200 + receipt, audit delivered (kc-it.pl A 100/100), replay of the same authorization refused with `already been used`, settlement on chain in block 49270394 (tx `0x6b68…8842`, 0.05 USDC throwaway → receiving address, facilitator paid the gas), dashboard shows settlements 1 / $0.05 / rail **live**. Full record: DEPLOY.md → Phase 3.3. ~6.20 USDC stays in the throwaway as protocol play-money — each further self-audit just moves five cents home.
### Distribution and optional rails

- [x] **Receiving address** — done 2026-07-25: `0x48934cDA4F8f3F692d4deEED3D2B4f15852E2424` (Binance Web3 Wallet, self-custodial, Base).
- [x] **Payment rail proven end to end** — done 2026-07-25. The official `x402-fetch@1.2.0` client was driven against a local `wrangler dev`: it parsed the 402, signed an EIP-3009 authorization, paid, and the **live** `x402.org` facilitator verified the signature and failed only on `invalid_exact_evm_insufficient_balance` (unfunded throwaway wallet). The same signature was also accepted through the v2 path. Nothing is left to prove but funding.
- [x] **Swap the analytics token for a scoped one** — done 2026-08-01. `CF_ANALYTICS_TOKEN` is now its own credential rather than a mirror of the deploy token, so the Worker's env no longer carries Workers Scripts: Edit. `push-secrets` pushed it and logged no mirror warning, which is how the mirror reports that it stopped; `/api/stats.json` went 403 → 200 on the same run. The old over-privileged deploy token has been deleted account-side.
- [x] **CDP API key, and the rail switched onto it** — done 2026-08-01. Kamil created a **Secret API Key** (Ed25519) at `portal.cdp.coinbase.com/access/api` — the portal's x402 page is metrics-only and "Custodial Wallet" wants a US business account, so neither is the right door. Both halves are repo secrets, pushed to the Worker by `cf-admin -f action=push-secrets` and never in `site.config.json`. `verify-rail.mjs` used to be unable to check this rail because CDP's `/supported` answers 401; it now signs the request with the Worker's own auth code, so `cf-admin -f action=verify-cdp` verifies it on the runner where the secrets live — **key accepted, 24 kinds advertised, both v2 `eip155:8453` and v1 `base` settled**. `"active": "cdp"` since, proven by a real $0.05 payment (tx `0x28f4…8292`, block 49327142) with the replay refused. Buys a free tier of 1,000 tx/month and — the actual point — Bazaar cataloging.
- **External state, no current action — x402 Bazaar.** Still absent from all
  14,819 resources on 2026-09-01. The CDP rail, discovery metadata and a
  metadata-carrying settlement are all verified; only recheck if upstream state
  changes. Current status lives in `NEXT.md` §3.
- **Optional owner action — Stripe machine-payments access.** Kept once in the
  live queue above; it is not a repository task.
- **Owner action — Show HN.** Kept once at the top of this file. The current
  draft, figures and posting checklist live in the private vault.
- [x] **Publish the domain-root discovery repo** — done 2026-07-10: `110kc3/110kc3.github.io` live. Note this is now partly superseded — `index.kc-it.pl` is itself a domain root, so it serves its own `/llms.txt`, `/robots.txt`, `/sitemap.xml` and `/.well-known/agent.json`.
- [x] **Managed AI-crawler block cleared on every zone** — done 2026-07-29, after Kamil's second token update finally carried Zone → Bot Management → Edit. `robots-report` read all five zones (four had `managed=true, ai_bots=block`; percall.dev was clean); `robots-allow` updated all four — every zone's plan refused the `policy_only` variant, so the fallback `is_robots_txt_managed: false` applied. Verified live: the managed stanza is gone from all three affected origins, and fresh audits score `stareaparaty.com`, `protocolindex.eu` and `overtimelog.com` at **A 100** — the whole 12-site fleet now sits at 100/100. Two footnotes: the Amazonbot-on-an-affiliate-site question resolved itself (the block was Cloudflare's wholesale default, not curation, and Amazonbot crawling an affiliate site costs nothing); and dropping the managed file exposed that `overtimelog.com` serves its SPA HTML at `/robots.txt` — the audit forgives it, but a real robots.txt in `overtime-guard-slack` would be the honest fix. **Fixed 2026-08-01** (`overtime-guard-slack@089225e`): a real robots.txt and sitemap.xml, both live. Cloudflare Pages' index.html fallback was the cause, so the same trap applies to every Pages site in the fleet that has no explicit robots.txt.

- [x] **Re-home the `agent-readability-service` listing onto an origin we control** — done 2026-07-29. The listing now points at **https://kc-it.pl/services/agent-readability**, which scores **A 100/100 (13/13)** against `/api/score`; it used to point at `https://github.com/110kc3/seo` and read **E 51** — the Track A shopfront failing its own audit (found in the 2026-07-29 review). The page is the sales page the review asked for: the offer, the 2026-07-28 fleet-sweep case study as before/after evidence, and the three entry points (free score, $0.05 x402 audit, `[hire]`). It lives in `personal-page` (`services/agent-readability.html`, plus a JSON twin and an OG card), is listed in that site's `llms.txt`, and is linked from the "For humans" section here. `scores.json` was refreshed by hand rather than waiting for the weekly cron.
- [x] ~~**Directory submissions.**~~ All browser-form channels were submitted
  by 2026-08-02. The three remaining PRs are current and now wait only on
  maintainers; see `NEXT.md` §3.

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
leaning **keep + Show HN**. Full pass in `vault 40-projects/x402-scale-up/2026-07-29-project-review.md`.

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
- [x] Show HN draft (`vault 40-projects/x402-scale-up/show-hn-draft.md`).

## Later / nice-to-have

- **Optional owner action:** Cloudflare Monetization Gateway waitlist; kept in
  the live queue above.
- **Future trigger:** automate Stripe reconciliation only after the first paying
  customer. It is deliberately not a current task.
- **External state:** the x402 Bazaar omission is recorded in `NEXT.md` §3; no
  seller-side action remains.
- [x] ~~Once the corpus question is decided, revisit whether `/ask` should summarize by default~~ — done 2026-08-01, and it does. `mode=list` opts out; a miss now names the two catalogs. See v3.10.
- [x] ~~RFC 9421 web-bot-auth response signing~~ — done 2026-07-25, both directions.
- **Future trigger:** publish the `clients/` wrappers only when traffic justifies
  a release pipeline. It is deliberately not a current task.
- [x] ~~Score badge variant~~ — done 2026-07-25 as `/badge.svg?slug=…&show=score`, fed by `scores.json` from the weekly cron.
- [x] ~~Retire the old `110kc3.github.io/seo/` Pages deploy~~ — done 2026-07-25.

</details>

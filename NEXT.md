# NEXT — the one pending list

**This is the only file you need to read to know what is outstanding.** Every
other doc in this repo is a *record* of what happened; this one is the *queue*.

**In this repo** — technical and operational, and public, because the repo is:

- `TODO.md` — **Kamil's action list at the top**, then the changelog behind a fold. Almost all of it is done work; do not scan the fold for pending items.
- `docs/distribution.md` — the channel research and the paste-ready form answers. Reference material, not a queue.
- `docs/agent-readiness-2026.md` — the 2026 spec gap analysis. **All five phases are now done** (Phase 2 and the Phase 4 decision closed 2026-08-02); kept for the reasoning and the adoption caveats.
- `docs/clustly.md` — the runbook for the Clustly seller agent (§1.11).

**In the vault**, under `40-projects/x402-scale-up/` — the commercial half, moved
out of this repo on 2026-08-05 because `github.com/110kc3/seo` is public and
pricing, sizing and product strategy are not for it:

- `clustly.md` — why that channel, the market sizing, the pricing call, the custody trade-off, and the four options Kamil did not pick.
- `second-service.md` — the three candidates for a second service, and why the broker idea splits into a version worth building and one that needs a lawyer. Fed the decision in §1.9.
- `show-hn-draft.md` — the draft to post, its titles, and the prepared comment threads.
- `2026-07-29-project-review.md` — a point-in-time review, now historical.
- `competitors.md`, `service-ideas.md`, `page-ideas.md`, `README.md` — pre-existing portfolio notes.

**The live queue in §§1–3 was re-verified on 2026-08-27.** Sections 4 onward are
dated records of what shipped. Where an older record disagrees with the queue,
the queue is right.

The split is simple: **§1 needs a browser, a public action, or a decision only
you can make. §2 is code and PRs, and needs nothing from you.**

> **Updated 2026-08-27, eighth pass.** Analytics is restored and the Show HN
> hold has expired. The full-window result is now 59,672 requests, 7.77% AI
> crawler/action-agent share, five third-party registrations and zero organic
> payments. The private draft has been rewritten around that contrast (§1.1).
>
> **Your next action is the Show HN, then the commercial evidence work:** the
> 50-founder outreach test, logged-in indexation, and the optional Clustly and
> Stripe setup. The no-new-product gate remains in force until the commercial
> reset is evaluated after 50 qualified contacts or 30 days, whichever is later.
>
> The code-side review found and corrected four stale agent-facing claims in
> `llms.txt` and the runtime MCP metadata (§2.2). The patch and generated files
> are deterministic and fully tested locally; the only code-side follow-up is a
> normal reviewed deploy and one live-file read before the HN post. All three
> upstream PRs were also refreshed on 2026-08-27 (§3).

---

## 1. Pending on Kamil

### 1.1 Show HN — READY; next clean window Tue 1 Sep 2026

The 25 Aug hold did its job. All four gates now pass:

1. **Full 30-day window:** 59,672 requests in the live 2026-08-27 snapshot.
2. **Real registration path:** five third-party `self-registered` listings are
   live — Cap, FluentEDI, Penroll, Question Machine and XiuRouter.
3. **Inbound activity:** 4,638 requests identified as an AI crawler or action
   agent (7.77%), with 479 free scores and 632 `llms.txt` reads. This is a
   self-reported User-Agent classification, not an identity claim.
4. **Conversion result:** six audit settlements and eleven settlements across
   all paid surfaces, all from one known test wallet; no organic payer and no
   payment since 3 Aug.

The result is more useful than the one held on 2 Aug: third parties will use the
free write workflow, while nobody has crossed the paid boundary. The private
draft now leads with that contrast and no longer claims zero registrations:
`vault 40-projects/x402-scale-up/show-hn-draft.md`.

Refresh the figures immediately before posting if it is not submitted on the
snapshot date. The next normal HN slot is Tue 1 Sep, 14:00–16:00 UTC.

**On credentials: don't send them, and I would not use them.** Posting would be
under your name, on your account, on a one-shot channel — that is yours to press
send on. HN also expects a Show HN to come from the person who built the thing
and does not permit automated submission, and a days-old account is already a
risk factor there without adding that. What I can do instead is have it
60-seconds-from-posted: numbers refreshed, title picked, body in the clipboard.

### ~~1.2 Directory submissions~~ — all five done

mcpservers.org submitted 2026-08-02, which closes the set: llms-txt-hub (merged),
agentswelcome.dev (certified), directory.llmstxt.cloud, llmstxt.site,
mcpservers.org, plus both Glama routes. **Nothing left to submit anywhere.**

One correction is in flight and it is mine, not yours — the llms-txt-hub entry
merged carrying `http://percall.dev/`; [PR #1460](https://github.com/thedaviddias/llms-txt-hub/pull/1460)
moves it to the canonical https host (§2.3).

### ~~1.3 Glama connectors~~ — done

You submitted it. Nothing further; it produces no badge, so it unblocked nothing,
which is why it was optional.

### ~~1.4 Content Signals~~ — decided and shipped

`Content-Signal: search=yes, ai-input=yes, ai-train=yes`, live in `robots.txt`.
The template carries the reasoning next to the value, because it is the opposite
of the common default and the next person to read it would otherwise assume it
was copied without thinking.

### ~~1.5 Score the 2026 signals~~ — decided and shipped, and it moved your badges

Live as check set **v2**, now the default. Details and the exact damage in §4.2 —
**six of your eight previously-graded listings dropped A to B.** That is the
decision working as intended rather than a fault, but you should see the numbers
before anyone else does.

### ~~1.6 Re-verify the register path~~ — done, and it found two real bugs

Ran end to end on the public repo (issues #7 and #8), listing removed afterwards
as promised. It was worth doing: see §4.3. Both bugs are fixed and verified.

### 1.7 Optional, low urgency

- **Stripe machine-payments access** — request it now because it moves slowly, not because you need it. The existing `pk_test_…` key is the card rail and unlocks nothing for x402.
- **Cloudflare Monetization Gateway waitlist** — browser form; being on Cloudflare is the only prerequisite. Would let the same 402 metering cover `/api/index.json` and the two catalogs without new code. The catalogs are now the largest thing the site serves and `/api/audit` is the only metered surface, so this is worth more than it was.
- **Delete `GLAMA_API_KEY`** — settled: nothing needs it. Glama's API is the Gateway (OpenAI-compatible inference); registry submission was a web form. Delete it rather than leave an unread credential lying around.

### 1.8 Indexation — logged-in browser jobs, and nobody else can do them

*Added 2026-08-02. The code half of this is shipped (§2d); these four need a
logged-in browser.*

The code half is shipped: both sitemaps exist, the index has IndexNow deployment
pings, and both sales/front-door pages are linked. What remains needs the
authenticated consoles:

1. Verify `percall.dev` and `kc-it.pl` as Google Search Console Domain
   properties.
2. Submit `https://index.percall.dev/sitemap.xml` and
   `https://kc-it.pl/sitemap.xml`.
3. Verify both properties in Bing Webmaster Tools; submit
   `https://percall.dev/` and `https://kc-it.pl/services/agent-readability` by
   hand.
4. Request indexing for those same two front-door URLs in GSC.

Optional after those: **IndexNow in Cloudflare** (Cache → Configuration) will
ping on cache purge as well as on deploy. Harmless overlap with §2d, and it
covers changes that do not come from a push.

### ~~1.10 Attach `router.percall.dev`~~ — done 2026-08-03, and the Router is on it

Kamil ran `gh workflow run cf-admin -f action=attach-domain -f hostname=router.percall.dev`;
it succeeded at 06:02, and `router_host` was set and deployed straight after. The
`attach-domain` action turned out to have zone rights after all — the code 10000
fallback to the dashboard was never needed.

**The order held**, which was the whole reason this shipped inert: attach first,
config second. Reversed, `index.percall.dev/api/{liveness,route}` would have
redirected to NXDOMAIN and taken two live paid endpoints down.

Verified live: `router.percall.dev/` serves the landing page (200),
`router.percall.dev/api/route` answers 402 on its own host, and both old paths
answer **308** with the query string intact. 308 not 301, so a caller retrying a
paid POST with a payment header keeps its method and body.

One thing did not follow automatically and never can: `110kc3.github.io` is not
generated from this repo's config, so its four references were edited by hand
(`110kc3.github.io@10a77c2`). Anything that moves a hostname again has to touch
that repo too.

### ~~1.9 Pick a second service~~ — decided 2026-08-02: the non-custodial one

*Raised by Kamil 2026-08-02, explored in `vault 40-projects/x402-scale-up/second-service.md`.*

Three candidates were examined: **liveness as a product**, **402-gating as a
service**, and Kamil's **broker** idea (verify an endpoint answers, route the
request, take ~$0.005).

The finding that decides it: **an x402 payment is bound to its payee** — our own
verifier refuses any authorization whose `to` is not our `payTo`
(`worker/x402.js:275`), and so does everyone else's. A broker therefore cannot
forward a caller's signature; it must collect and re-pay as merchant of record,
which brings float, refund liability on a $0.005 margin, and a custody question
that is plausibly a MiCA authorization rather than a checkbox. **That needs a
qualified opinion, not mine.**

The non-custodial version has none of those problems and sells the part that is
actually scarce — *which endpoint, is it alive, what does it cost* — which is the
liveness data this site already collects weekly and nobody else publishes.

**Kamil's call, 2026-08-02: the non-custodial one — "I will not pay from my own
wallet."** The custodial broker is shelved, 402-gating is a pass.

That sentence is now a design invariant rather than a policy, because it can be:
the Worker reads `X-PAYMENT` as a receiver and holds no key that could sign an
EVM transaction. **The router probes; it never pays** — and since an unpaid probe
returns the endpoint's own 402, and a 402 carries its terms, liveness and price
come back in the same free request. Scope, endpoints and what still has to be
built are in `vault 40-projects/x402-scale-up/second-service.md`.

### 1.11 Clustly — the code is done, the browser half is yours

**Status re-checked 2026-08-27:** `/etc/clustly-agent.env` is absent and the
service is inactive, so none of the three browser/operator steps has happened.

*Added 2026-08-05, after Kamil asked whether to pivot off x402 and whether we
could be listed on clustly.ai. The answer to the second is yes and it is built.
Full runbook: [docs/clustly.md](docs/clustly.md).*

**What this is.** [Clustly](https://www.clustly.ai) is a USDC-escrow agent
marketplace on Solana: a buyer funds an escrow, an agent enrolls and submits, the
buyer's signature releases the money. This repo now sells the agent-readability
audit there as a job, alongside selling it per call over x402.

> **Why this channel, the market sizing, the pricing call and the custody
> trade-off are in the vault** — `40-projects/x402-scale-up/clustly.md`. This
> repo is public; that reasoning is not for it.

**Shipped (2026-08-05).**

- `scripts/clustly-report.mjs` — the deliverable. Built from the **free**
  `/api/score` plus the fix/snippet tables imported from `worker/audit.js`, so it
  needs no payment, no spending key, and no HTMLRewriter (which is why the paid
  `auditUrl()` cannot run outside the Worker). The snippets are the same
  constants the paid endpoint serves, so the two cannot drift.
- `scripts/clustly-agent.mjs` — the loop. Deliberately **not**
  `npx @clustly/agent run --exec`: their daemon polls `awaiting_acceptance` only,
  so it never sees a revision request, and `npx -y` would execute an unpinned
  third-party package on every run in a repo with no runtime dependencies. The
  REST surface is four calls. The criteria hash was verified byte-for-byte
  against their SDK on nine cases.
- `clustly/listing.json` — the listing text and its price. Excluded from the
  asset upload via `.assetsignore`, so it is never served by the site.
- 26 tests across `scripts/clustly-{report,agent}.test.mjs`, including one that
  asserts the report still delivers every line the listing commits to — those
  criteria are sha256'd on chain at hire and cannot be edited afterwards.

**Your three browser steps** (all of §1 of the runbook, one sitting):

1. Register at <https://www.clustly.ai/operator> → copy the `clk_…` key into
   `/etc/clustly-agent.env` on the Pi. **It is shown once.**
2. Publish `clustly/listing.json` through the console. Two fields need your eyes
   because they could not be verified from outside: `category` and the input
   field's `type`.
3. Enable the systemd unit in §2.4 of the runbook.

**Read this before step 1.** Every Clustly agent is *managed* — Clustly holds the
signing wallet under a no-theft policy pinned to your treasury, and **self-custody
is not offered**. That is a step away from the self-custodial Base address the
x402 rail pays into. Receive-side only, and no key in this repo is involved, so
"the router probes; it never pays" still holds — but earnings sit with a third
party until you sweep them. Your call, and it should be a decision rather than a
discovery.

**Before publishing, look at what you are selling:**

```
node scripts/clustly-agent.mjs --dry-run --url https://example.com
```

No key, no marketplace — it prints the exact markdown a buyer receives.

### 1.12 The other four options from 2026-08-05, unpicked

Kamil picked Clustly (§1.11) from a list of five. **The other four, and the
reasoning behind all five, are in the vault** —
`40-projects/x402-scale-up/clustly.md`. They are portfolio decisions about what
to build and what to charge, which is the half of this project that does not
belong in a public repo.

Headlines only, so this file still says what is open: go hard on Track A; a
non-custodial `market.percall.dev`; a full escrow marketplace (recommended
against); freeze x402 spend. None is started.

---

## 2. Pending on Codex — one production verification after deploy

### ~~2.1 Glama badge + tool count on PR #11152~~ — refreshed 2026-08-27

Badge added and the tool list corrected to six (`search_x402_endpoints` and
`search_mcp_servers` shipped with v3.9 and were never reflected upstream).
The branch was rebased onto current `main`, the catalog counts were refreshed,
the PR body was re-verified and the Glama listing and badge both return 200.
`check-submission` passes and GitHub reports the PR cleanly mergeable. A dated
maintainer update is posted; nothing else is useful until review (§3).

### 2.2 `llms.txt` corrections — verified locally; deploy and re-read live

The private draft now uses the full 30-day snapshot, the one-payer revenue
ledger, five real third-party registrations, 20 checks and 291 tests. The same
pass re-read `llms.txt` end to end and fixed four stale claims at their sources:
catalog sizes now derive from the committed stats, the free-score limit is 60
rather than 20, provenance uses server-set `origin`, and runtime MCP metadata no
longer says 13 checks. A regression assertion now covers runtime tool
descriptions as well as generated files. Two clean builds produced the same
tree hash and all 291 tests pass under local Node 18 with
`--experimental-global-webcrypto`, the compatibility flag required because this
project targets Node 22. These changes are in the worktree, not production; after
the reviewed commit/deploy, read the live `llms.txt` once before posting.

### ~~2.3 llms-txt-hub URL correction~~ — done

[PR #1460](https://github.com/thedaviddias/llms-txt-hub/pull/1460) opened against
`thedaviddias/llms-txt-hub`: `website`, `llmsUrl` and `llmsFullUrl` moved from
`http://percall.dev/` to `https://index.percall.dev`. All three verified 200 with
no redirect hop. One file, mergeable, waiting on the maintainer.

### ~~2.4 The domain-root hub advertises a retired host~~ — was already fixed, and this entry was wrong

**Read the repo before believing this file.** §2.4 claimed
`110kc3.github.io` pointed at `index.kc-it.pl` in 47 places and mentioned
`percall.dev` zero times. Both halves were false by the time anyone acted on it:
commit `0fabb0f`, *"Point the discovery hub at the host it is supposed to
advertise"*, had already moved it. `percall.dev` now appears across nine files.

**The two surviving `index.kc-it.pl` mentions are correct and are staying.** They
are one sentence — *"the older `index.kc-it.pl` still answers but 308s here, so
quote this one"* — which is a surface telling an agent which of two working hosts
to cite. That is the opposite of the defect this entry described, and deleting it
would make the hub worse.

This is the second time a doc in this repo has disagreed with reality in the
direction of alarm, and this file's own header says it wins over the others when
they disagree. It only earns that by being re-verified rather than carried
forward — which is exactly what "**everything below was verified live**" at the
top is supposed to mean.

**What was actually wrong, and is now fixed** (`110kc3.github.io@a78b900`): the
hub had never heard of the Router. It described the free score and the paid
audit and stopped there — the same failure the umbrella page had in §2f, in the
one repo nobody thinks to check, and for the same reason: *a service that ships
onto an existing host touches nothing that would announce it.* Both llms files
and both copies of `agents.json` now carry `/api/liveness` and `/api/route`,
their price, and the non-custodial promise.

**Carries a dependency:** those URLs name `index.percall.dev`. When
`router_host` is set (§1.10), the hub needs the same one-line update — it is not
generated from this repo's config and cannot follow on its own.

### ~~2.5 README understates the MCP server~~ — done

Said four tools, answers six.

### ~~2.6 The self-audit blind spot~~ — done, and it cost three deploys

Same-host audits now go through the header layer, so `markdown_negotiation` is
visible to a self-audit. **Our own site reads A 100, 20/20 under v2**, up from
98 — and the 100 is now earned rather than assumed.

Worth reading §4.4 before touching this path again: the fix took three attempts,
and the two failed ones were both plausible and both wrong.

## 2b. Shipped 2026-08-02, third batch — six pages for the human half of the traffic

Kamil picked 3, 1, 2, 5, 6, 7 from the subpage list. All live.

**Why these and not more APIs.** 46% of requests here are browsers and 10–12% are
AI crawlers, but the only thing a human could *do* was type a URL into the score
box — and 3 of the first 123 free scores came from a browser. Meanwhile the two
catalogs, 24,741 endpoints with weekly liveness probing and the most genuinely
unique thing this site holds, existed only as JSON.

| page | what it is |
|---|---|
| [`/report.html`](https://index.percall.dev/report.html) | The state of the agent web. Agent share **3.20% → 7.19% → 12.36%** across three dated readings, catalog liveness (97.2% / 91.9%), price distribution, and the finding that leads: 49 hits on the paid endpoint, **zero organic payments, ever**. |
| [`/x402.html`](https://index.percall.dev/x402.html) | 14,661 machine-payable endpoints by price, chain and operator, with liveness. Search box wired to the existing JSON API. |
| [`/mcp-servers.html`](https://index.percall.dev/mcp-servers.html) | 10,080 MCP servers with a URL you can call, by auth and transport. |
| [`/leaderboard.html`](https://index.percall.dev/leaderboard.html) | All 40 listings ranked by the free endpoint anyone can call. |
| [`/checks/`](https://index.percall.dev/checks/) | 21 pages: every check, its weight, the argument for that weight, the remedy and the snippet. |
| [`/compare.html`](https://index.percall.dev/compare.html) | Honest comparison with Cloudflare Agent Readiness and agentswelcome.dev, including three places this one is the weaker choice. |

**The deliberate non-decision:** no per-endpoint pages. 24,741 thin pages would
read as doorway spam on a site whose pitch is being well-made, and would
republish other people's endpoints at a scale that makes the removal request
inevitable. Aggregates plus a live search box get the same utility without either
problem.

**What it cost structurally.** To make `/checks/` generated rather than
transcribed, the thirteen weights and remedies moved out of the call sites into
`CHECK_META`, and the seven signal labels and remedies into `SIGNAL_META` —
extracted mechanically and verified string-equal to the originals, so the audit's
behaviour is unchanged and the published checklist now *cannot* drift from the
thing being sold. Three tests hold it: the scorer and `checks/` must agree on
which checks exist, the report must quote live figures from the data files, and
every page must reach the sitemap.

Traffic readings are snapshotted weekly by `scripts/snapshot-traffic.mjs`,
because the build must stay a pure function of its inputs and a citable number
has to be the same number tomorrow. Seeded with the day-4 and day-7 gate reads
from TODO.md, marked `backfilled`.

**Item 4 landed too** — see §2c.

## 2c. The umbrella domain now says what it is

`percall.dev` was bought as the umbrella for a portfolio of machine-callable paid
services and then pointed straight at the first one, so the domain whose whole
job is to name the portfolio answered a 308 and described nothing.
`www.percall.dev` did not resolve at all.

| host / path | now |
|---|---|
| `percall.dev/` | **200** — the portfolio page |
| `percall.dev/<anything else>` | 308 → `index.percall.dev/<same>` |
| `www.percall.dev/` | 308 → `percall.dev/` |
| `www.percall.dev/<anything else>` | 308 → `index.percall.dev/<same>` |
| `index.kc-it.pl/` | 308 → `index.percall.dev/` (retired, unchanged) |

**The exception is exactly one path wide, and a test holds it there.** The
canonical-host discipline is what stops a directory recording
`percall.dev/llms.txt` as this site's llms.txt, and that discipline has already
cost one round of corrections upstream. `apex_host` in `site.config.json` is now
a distinct concept from a retired alias, so `index.kc-it.pl` still redirects at
its root while the apex does not.

**What the page says is smaller than what the domain implies**, deliberately: one
service is live, the page says one service is live, and further services are
described as intent rather than listed as inventory. It leads with the finding
rather than the pitch — agents are arriving, the share is rising, and not one has
ever paid.

**Two bugs attaching www would otherwise have introduced, both fixed in the same
change:**

1. Sending www to the *index* hands whoever typed the umbrella domain a different
   page than the umbrella serves. Its root now goes to the apex; deeper paths go
   straight to the canonical host, so neither case costs two hops.
2. Worse: www is now a hostname this Worker answers on, **and a Worker cannot
   fetch its own hostnames** — Cloudflare answers 522. An audit of www would have
   settled the payment and then failed, which is the precise bug `host_aliases`
   was created for after it happened once with real money. www is in that list,
   and the test asserts the invariant rather than the instance.

**One more found while verifying:** `canonicalTarget` mapped `percall.dev/` to
`/`, so auditing the apex graded the *index* and published the score under the
apex's name — grading one page and labelling it another, which is exactly the
defect this endpoint is sold to detect. It reported 100 because both pages scored
100, which is the kind of luck that hides a bug for months. Fixed; the apex now
audits at **A 98**, and the missing 3 points are honest: `/apex.html` has no
markdown twin, and inventing one that describes a different service would be
worse than the two points.

---

## 2d. Shipped 2026-08-02, fourth batch — the umbrella can now be found

The apex page shipped this morning into a state where nothing could reach it.
Four things were wrong; all four are fixed, and each is pinned by a test so the
next generated page cannot reintroduce them.

**1. Meta descriptions were cut mid-thought.** `page()` did a hard
`description.slice(0, 160)`: `/apex.html` ended at a comma, `/x402.html` ended
mid-word (`— whe`). The homepage was worse in a quieter way — its
`<meta name="description">` was 166 characters while its `og:description` was a
different, shorter string, so the two surfaces disagreed about what this site is.
On a site that grades `title_and_description` for other people and ships a
snippet telling them to stay under 160, this is the one to be embarrassed about.
`metaDescription()` now cuts at a sentence boundary, falls back to a word
boundary, and never leaves the string hanging on punctuation. The apex's own
description was rewritten to fit whole rather than be trimmed.

**2. The umbrella was in no sitemap.** `sitemap.xml` listed only the canonical
host, and `percall.dev/sitemap.xml` 308s into that same file — so the one page
whose job is to name the portfolio appeared in no sitemap anywhere. It is now
listed. Cross-host entries are legitimate here because the apex's robots.txt
resolves, via the same 308, to the one declaring this sitemap.

**3. Nothing linked to it.** `index.html` mentioned the canonical host seven
times and the umbrella zero, and `apex.html` was the only file in the repo
containing the string `https://percall.dev`. The link only ever went downward.
The homepage footer and `llms.txt` now link up, which also matters because the
one external link that pointed at the apex is being corrected away by our own
PR #1460 — after it merges, these are the only inbound links that exist.

**4. There was no way to announce a change.** `scripts/indexnow.mjs` submits the
pages a push actually changed to IndexNow (Bing, Yandex, Seznam — one endpoint),
from `deploy.yml`, after the deploy succeeds. Two filters, both deliberate: a URL
must be in the sitemap, so the sitemap stays the single list of what this site
claims to publish; and it must be on the canonical host, because the key file
proves control of one host and **the apex cannot host one** — it serves exactly
one path. That is why §1.8 asks for the apex to be submitted by hand, once. The
ping can never fail a deploy: the script catches, and the step is `|| true`.

Not done, deliberately: **the apex still has no markdown twin**, so it audits at
A 98 rather than 100 (§2c). Inventing an `apex.md` that described a different
service to win two points would be the wrong trade, and it still is.

## 2e. Shipped 2026-08-02, fifth batch — the second service exists

`GET /api/liveness?url=…` and `POST /api/route`, $0.005 each, live in
`worker/route.js` on the existing Worker. Full reasoning and the decisions inside
it are in `vault 40-projects/x402-scale-up/second-service.md`; the short version:

**It sells freshness.** The catalogs and their weekly aggregates stay free — what
nothing else publishes is whether an endpoint answers *right now* at the price it
quotes *right now*, because the Bazaar keeps an entry for 30 days after its last
settlement. That is the lesson of §7 applied: the audit's paid tier struggles
because the free grade already answered the question, so this one sells the thing
the free tier structurally cannot.

**It never pays, and that is enforced rather than intended.** Three tests hold
the invariant, and the third is structural: no module under `worker/` may set an
outbound payment header. The probe is built from scratch with a two-header
allowlist, because the caller's own request may carry an `X-PAYMENT`
authorization and forwarding request headers to an arbitrary upstream would hand
a signed credential to a stranger.

**What it cost nothing to get:** an unpaid probe of a paid endpoint returns that
endpoint's 402, and a 402 states its terms. Liveness and price arrive in the same
free request, which is why the expensive-sounding half of this service is free to
run.

Three things it deliberately does not do: no MCP tools (MCP has no payment
channel here, and a tool that can only say "pay me over HTTP first" is worse than
no tool), no per-endpoint pages, and no charge for a query that matches nothing.

**Per-endpoint history shipped with it.** Every answer carries that endpoint's
record — probes, answered, consecutive failures, and how many of the last 30
observations answered. The weekly cron could not be the source: it walks a
rotating slice of 600, so it sees any given endpoint about twice a year and
stores only the failures. The live probes are the better instrument — free, and
aimed at exactly the endpoints someone paid to ask about — so **the paid answer
improves the more the service is used.** A cache hit is not an observation, and
the uptime ratio is withheld below three of them rather than published as
"1 of 1".

**Paid end to end on mainnet, 2026-08-02, and it cost $0.01.** `clients/pay_liveness.mjs both`
settled twice through the CDP facilitator; exactly $0.010000 left the test payer
and arrived at the receiving address. It bought four things no test could:
a **paid GET** settles (every prior settlement here was a POST), we can parse a
402 **we did not write** (`2s.io` quoted four options in one challenge — more
than any fixture), live quotes agreed with the catalog where both existed, and
the history recorded its first real observations while correctly withholding the
uptime ratio at one probe. All three routed candidates came back alive and
paywalled, so the first real routing query returned a useful answer rather than
a list of dead links.

**239 tests** (was 216). Not yet done: the monitoring product on top of the
history (`consecutive_failures` is the field an alert would fire on), and a human
page — browsers are 46% of traffic and this ships agent-facing only.

## 2f. The umbrella was still saying "one service is live", and the analytics could not see either problem

Kamil looked at percall.dev, could not find the thing that had just shipped, and
asked why. Three faults, all in the same blind spot: **a service that ships onto
an existing host touches nothing that would announce it.**

**The portfolio page did not know.** The router shipped as endpoints on
`index.percall.dev`, so `apexPage()` — a hand-written block nobody had to edit —
went on claiming one service. The domain's entire job is to name what runs under
it. Both products are now listed, with the honest note that they share a host
because the router reads the same catalogs and settles on the same rail, so a
second deployment would have bought a nicer URL and nothing else. A test now
fails if the umbrella stops naming a live product.

**The paid endpoints were invisible in analytics.** `/api/liveness` and
`/api/route` fell into the generic `api` bucket, alongside free registry reads
that outnumber them by an order of magnitude — so "is anyone buying this" was
unanswerable. They now have their own buckets, for exactly the reason `audit`
and `score_free` are separate.

**The umbrella itself was invisible.** `percall.dev/` and `index.percall.dev/`
share a pathname, so both bucketed as `home`: the portfolio page could have had
zero visitors since launch and the number would have read identically. The apex
root is now `apex_home`, and — the more general fix — **the hostname is recorded
on every request** and reported as `by_host` in `/api/stats.json`. Every host
attached to this Worker serves the same paths, so a path bucket could never have
answered "is the umbrella getting traffic" or "is anyone still arriving on the
retired host". Rows written before today have no host and report as
`unrecorded` rather than being attributed to a host they may never have been
sent to.

**241 tests.** The stats SQL limit went 200 → 1000 in the same change: grouping
by a third column multiplies rows, and a truncated `GROUP BY` does not fail, it
under-reports the tail.

## 2g. The Router gets its own hostname — code done, one dashboard action left

Kamil's call, reversing the earlier recommendation once he saw it: the Router
gets `router.percall.dev`. Same Worker, same repo — a subdomain never needed
either of those forked, only a hostname the Worker stops treating as an alias.

**It ships switched off, and that is the important part.** Setting `router_host`
makes `index.percall.dev/api/{liveness,route}` **308** to the new host. Doing that
before the domain resolves would break two live *paid* endpoints. So the value is
empty in `site.config.json`, empty renders byte-identical to today, and the whole
thing turns on by setting one string — see §1.10.

What flips together when it does: the 308s, the canonical on `/router.html`, the
sitemap entry, `llms.txt`, the agents manifest, the OpenAPI path-level `servers`
override, the apex card's link and label, and the resource URL inside the 402
challenge — which now comes from the request's own origin rather than a
hardcoded host, because terms naming a different endpoint than the one being
bought is a defect this project sells audits to catch. All eight verified in both
states by building against a temporary config.

**The Router host owns exactly three paths** — `/`, `/api/liveness`,
`/api/route` — and everything else on it 308s to the canonical host, the same
one-copy discipline that keeps the apex one path wide.

**The self-fetch guard is now derived rather than copied.** A Worker cannot fetch
its own hostnames; Cloudflare answers 522, and a *paid* audit that settles and
then 502s is how that was learned. `canonicalTarget` and `selfTerms` both read
`router_host` straight from config, so attaching a host cannot leave the guard
behind — which is exactly how this bug arrived the last two times. The Router's
root also maps to `/router.html`, not `/`: mapping it to the index would grade
the wrong page and publish the score under the Router's name, which is the apex's
bug one host later.

**A human page came with it** (`/router.html`), closing the gap §2e left open:
the Router shipped agent-facing only on a site where 46% of requests are
browsers. **243 tests.**

## 2h. The auditor was buying grades from a misconfigured 404 (#10)

Kamil asked for two site findings to be filed as issues. Checking them properly
turned one into a defect in the product itself.

**The five 2026 signal checks tested `resp.ok` and nothing else.** A site with no
404 page — every unmatched path answering 200 with the homepage — passed all
five on documents it did not have. `kc-it.pl`, one of our own listings, scored
**A 95 with eleven of those points for files that do not exist.** The honest
grade is 84.

That configuration is the default for SPAs and for Cloudflare Pages without a
`404.html`, so this was not one site's quirk: it inflated grades for anyone
audited, **always upward**, which is the direction nobody reports.

Fixed by requiring the body to parse as a JSON object — every one of these
artifacts is JSON, so parsing is the whole test and no allowlist is needed. A
body truncated at the fetch ceiling falls back to the declared content-type, so
a genuinely large manifest is not failed for its size. **Soft 404s are now their
own finding**, because "no agent card" would send someone off to publish a file
they already appear to have.

**What made this findable:** reading the repo's own history first. The catch-all
was known and deliberate (`110kc3/personal-page@3c9cf81` documents it and fixed
the four paths the audit checked *then*). The seven 2026 signals landed
2026-08-02, after that commit, and moved the goalposts underneath the decision.
Filing "your site has a catch-all" would have told Kamil something he wrote down
himself a week earlier; the new part was that our own auditor could not tell a
JSON document from a page of HTML.

Also fixed this session: **the watch called a 500 "answering"**. `probe().alive`
is true for any HTTP response — correct for the Router, where a 402 is the
successful outcome — and monitoring inherited it, so an endpoint erroring for a
week would never have alerted. `probe-catalogs.mjs` has had the right rule since
the catalogs shipped; the one product sold on knowing was the one place not
following it.

**Monitoring is proven end to end.** A deliberate 503 on `kc-it.pl` fired the
outage edge and the recovery edge, with delivery confirmed by a webhook sink
rather than inferred. **265 tests.**

## 3. Waiting on maintainers — refreshed 2026-08-27

| what | current state |
|---|---|
| **[awesome-mcp-servers #11152](https://github.com/punkpeye/awesome-mcp-servers/pull/11152)** | OPEN, CLEAN and MERGEABLE after a rebase onto current `main`. Six tools, 15k x402 endpoints and 14k MCP endpoints are reflected upstream; the Glama listing/badge return 200 and `check-submission` is green. A dated review note is posted. Wait for the maintainer. |
| **[Awesome-llms-txt #114](https://github.com/SecretiveShell/Awesome-llms-txt/pull/114)** | OPEN and MERGEABLE. The branch is current with `master`, the diff is one line, the canonical URL returns 200 without a redirect and `normalize_lists.py --check` passes. GitHub still carries the 2 Aug `CHANGES_REQUESTED` state even though both requested changes were addressed on 3 Aug; a dated re-review request is posted. Wait for the maintainer. |
| **[llms-txt-hub #1460](https://github.com/thedaviddias/llms-txt-hub/pull/1460)** | OPEN and MERGEABLE, waiting on required review. All three canonical URLs return 200 without redirects, the diff remains one file with three URL corrections and the refreshed Auto-merge check is green. A clean local rebase could not be pushed because the current GitHub token lacks `workflow` scope for a workflow added upstream; this is not a conflict or merge blocker. Wait for the maintainer. |
| **x402 Bazaar listing** | Still absent. A live posting-day check read **14,809 resources**; the 26 Aug catalog snapshot contains **15,127 endpoints**. Nothing pays our address or lives on our host. Everything on our side is done: the rail is CDP, the 402 carries discovery metadata and a settlement carried it. Upstream `x402-foundation/x402#2112` is now closed and documents several indexing/re-indexing causes, so it does not identify ours. Check with `node scripts/bazaar-check.mjs`; do not spend more time on this unless the upstream state changes. |

---

## 4. Shipped today, and what it turned up

### 4.1 Content Signals

`Content-Signal: search=yes, ai-input=yes, ai-train=yes`, live in `robots.txt`,
with the reasoning written beside the value. Nothing further.

### 4.2 The 2026 signals are scored — and six of your badges moved

Live as check set **v2**, now the default. `v1` still exists and still scores
exactly the thirteen, so any grade published before today stays reproducible;
every result and every row of `scores.json` records which set produced it.

Seven signals promoted, **every one weighted below the cheapest 2025 check**
(`https`, 5) because under 15% of the web publishes them: Content Signals, the
A2A 1.0 card path and markdown negotiation at 3; the MCP server card, API
catalog, Agent Skills index and Web Bot Auth directory at 2. Total 17, so the
scale is 122 rather than 105.

**The cost, which is the part you should look at:**

| listing | v1 | v2 |
|---|---|---|
| bankier-street-bets | A 100 | **B 89** |
| polish-sweepstakes | A 100 | **B 89** |
| puzle | A 100 | **B 89** |
| rentgen-ofert | A 100 | **B 89** |
| przetargimiejskie | A 100 | **B 86** |
| stare-aparaty | A 90 | **B 86** |
| agent-readability-service | A 90 | A 95 |
| ai-product-index | A 100 | A 98 |

Six of eight drop a letter having changed nothing. The two that hold are the two
publishing 2026 surfaces, which is exactly what the weights were chosen to do —
but if that trade looks wrong to you now that it is concrete, the weights are one
table in `worker/audit.js` and a test pins the resulting grade, so changing my
mind costs minutes rather than an afternoon.

This was also the **first score run to cover all forty listings**; the other
thirty-two had never been graded at all. Which surfaced a latent bug: the free
score's 20/hour/IP limit was set when the registry held eight listings, so the
next Monday cron would have been refused after the twentieth — and refused
*quietly*, since the scorer keeps the previous grade on failure and those
thirty-two had none. Raised to 60.

### 4.3 The register path works — after two real bugs it exposed

Worth having done. Both bugs were invisible to the 25 tests covering
`process-issue.mjs`, because neither is in the script.

**The account cap counted curated entries.** The first run (#7) was refused:
`account 110kc3 already has 40 listings (max 10)`. Correct by the old rule and
wrong by intent — the 40 are 30 curated mirrors and 10 pre-launch seeds, none of
them submissions. It would have refused every future self-registration you ever
made. Provenance is now a server-set `origin` field that the cap reads, rather
than the self-reported `submitted_by` that merely described it. It has to be
server-set: a cap keyed on `submitted_by` is lifted by typing
`registry (curated)` into a field nobody can validate.

**Accepted listings have not been publishing since the Cloudflare migration.**
The second run (#8) accepted, wrote, built, committed, pushed — and the site
never rebuilt. GitHub does not trigger `on: push` workflows for pushes made with
the default `GITHUB_TOKEN`, and `deploy.yml` is `on: push`. So every accepted
registration has been committed and then left unpublished until an unrelated
human push happened to carry it out, **while the bot told the submitter "the site
redeploys within about a minute of this comment"**. On GitHub Pages this worked,
because Pages deploys on push whoever pushed; turning publishing into a workflow
moved it under the recursion guard and nothing failed loudly enough to notice.
`register.yml` now dispatches `deploy.yml` explicitly.

Had a real agent registered in the last week, its listing would have 404'd at the
URL the bot handed it. That is the finding, and no test could have produced it.

The verification listing was removed as promised; the registry is back to 40 and
the page 404s.

---

### 4.4 The self-audit fix, and the two wrong answers before it

Recorded because the failure mode will recur, not because the bug is
interesting. Same-host audits now run through the header layer, and our own site
reads **A 100, 20/20** — up from 98, with the missing three points being
`markdown_negotiation`, which we have served correctly to everyone else all
along.

It took three deploys, and **the suite was fully green for all three**:

1. *"The auditor's `redirect`/AbortSignal upset the runtime."* Plausible, wrong.
2. *"Passing a Worker-built Request as another Request's init is rejected."* Also
   plausible, also wrong. Kept the refactor anyway — building sub-requests from a
   URL and headers is a smaller surface and worth having.
3. **The actual cause:** `Response.url` is populated by `fetch` and is the *empty
   string* on any Response constructed in-Worker. The header layer rebuilds every
   response to attach headers, so once self-audits went through it, every
   sub-response had `url: ''`. Being `''` and not `undefined`, `home.url ??
   target` kept it, and `new URL('')` threw `Invalid URL string.` — no stack, no
   mention of the audit.

Three things worth keeping:

- **Node's fetch populates `Response.url`; workerd's constructed Responses do
  not.** 202 tests pass against a production 500. The divergence is between
  runtimes, so no unit test can close it — **auditing our own host after deploy
  is the check**, and it belongs in any change to this path.
- **The 500 itself was the clue I ignored.** `get()` wraps every fetch in
  try/catch, so a throw *inside* the fetcher would have surfaced as a failed
  check, not a 500. That it 500'd proved the fault was downstream of the fetches
  — which ruled out the code I had just changed, twice, before I tested it.
- `e.stack` was `undefined`, so deploying a stack-surfacing build bought nothing.
  For runtime-internal throws, reasoning about which consumer sees the bad value
  beats instrumenting the producer.

---

## 5. Done — stop looking for these

Verified live 2026-08-02 unless noted.

| channel | state |
|---|---|
| **llms-txt-hub** | ✅ **PR [#1459](https://github.com/thedaviddias/llms-txt-hub/pull/1459) merged 2026-08-02 at 09:31 UTC** — the first real inbound link this project received. Canonical URL correction [#1460](https://github.com/thedaviddias/llms-txt-hub/pull/1460) is still waiting on review (§3). |
| **Glama repo listing** | ✅ **Live** — `glama.ai/mcp/servers/110kc3/seo` resolves, badge renders. Unblocks §2.1. |
| **agentswelcome.dev** | ✅ Certified 100/100 "exemplary", all 18 checks. Entry `ae21017ab44f`, one of 3 sites in the directory. |
| **awesome-mcp-servers** | ✅ Submitted (#11152) — now waiting, see §3. |
| **Awesome-llms-txt** | ✅ Submitted (#114) — now waiting, see §3. |
| **wong2/awesome-mcp-servers** | ❌ N/A — no longer accepts PRs, redirects to mcpservers.org (§1.2c). |
| **directory.llmstxt.cloud** | ✅ Submitted by Kamil 2026-08-02 (Tally). Curation team; no confirmation email. |
| **llmstxt.site** | ✅ Submitted by Kamil 2026-08-02. The one channel that does confirm by email. |
| **Glama connectors** | ✅ Submitted by Kamil 2026-08-02. No badge, unblocks nothing — a channel in its own right. |
| **Domain-root discovery repo** | ✅ Published 2026-07-10 and current; it names the Router too (§2.4). |

Also settled and not worth re-opening: the mainnet rail (six real settlements),
the CDP key and rail switch, the deploy/analytics token split, the managed
AI-crawler block across all five zones, the corpus question (decided as b+c —
43 listings plus 29,265 catalogued endpoints in the 26 Aug snapshots), the shopfront listing re-home,
and agent-readiness Phases 1, 3 and 5.

---

## 6. If you only do one thing in each column

- **You:** post the prepared Show HN in the next clean window, then run the
  50-founder outreach test and the logged-in indexation jobs. Clustly, Stripe and
  signing remain useful but are not launch blockers.
- **Me:** the source corrections and upstream PR maintenance are complete. The
  only remaining code-side action is to carry the reviewed worktree through the
  normal deploy and re-read live `llms.txt` before the HN post (§2.2).

---

## 7. Is $0.05 too expensive?

Asked 2026-08-02. Answered against the funnel rather than intuition — the
crossed client-type × path data that `/api/stats.json` cannot show is now
readable with `gh workflow run cf-admin -f action=stats-funnel`.

**Who actually meets the 402**, 30-day window, 49 requests to `/api/audit`:

| client type | 4xx (incl. the 402) | other |
|---|---|---|
| script | 14 | 1 × 3xx |
| other (non-browser, unclassified) | 14 | 4 × 2xx, 2 × 5xx |
| browser | 8 | 5 × 3xx |
| **ai_crawler** | **1** | — |

I expected this to show a wall of wallet-less crawlers, which would have settled
the question immediately. **It does not** — exactly one of 49 was a self-declared
AI crawler. The population meeting the paywall is mostly scripted, non-browser
clients: the kind of caller that *could* in principle pay.

So the "they physically cannot buy" argument is weaker than I assumed. What still
points away from price:

- **It is zero, not low.** Price sensitivity normally shows up as a poor
  conversion rate, not the total absence of one. Zero of ~35 plausible payers
  reads as a missing capability or a missing reason, not a number set too high.
- **The free tier may already be enough.** `/api/score` served 123 calls to the
  same client mix — **2.5× the paid endpoint's traffic** — and returns the grade
  plus every failing check by name. What the payment buys is *fix snippets*,
  which is precisely what an LLM-driven caller is best at generating for itself.
  That is a product-boundary problem, and no price fixes it.
- **$0.05 is negligible to anything that can pay at all.** For a caller with a
  funded wallet, five cents versus one is not a decision. The band where price
  actually bites is narrow and probably empty today.

What points toward it: we are **3.6× the catalog median** of $0.014, and an agent
with a per-call spending cap would be excluded by a threshold rather than by
reluctance. That is a real mechanism and I cannot rule it out.

**Recommendation: keep $0.05 until after the Show HN.** The post *is* the
experiment — it puts humans with agent tooling in front of the endpoint, the only
population that has ever plausibly been able to buy. Changing the price in the
same week means learning nothing from either number. If the post brings traffic
and conversion is still zero, cut to $0.01 then and you have a clean before/after
instead of two variables moving at once.

There is a rhetorical cost too: *"I charged five cents and nobody paid"* is the
line the whole post is built on. *"I charged one cent and nobody paid"* is a
weaker sentence and a weaker finding.

**The more promising lever is the free/paid boundary, not the number.** If the
free grade already answers the caller's question, the paid tier has no job at any
price. Worth considering after the post: keep the letter grade free but move the
per-check failure list behind the paywall, or sell something the free tier cannot
substitute for — a multi-page crawl, or monitoring over time. Say the word and I
will write that up properly.

Whatever you decide, it stays cheap to change: `audit_price_atomic` in
`site.config.json` is a single value.

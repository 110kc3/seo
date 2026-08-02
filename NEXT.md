# NEXT — the one pending list

**This is the only file you need to read to know what is outstanding.** Every
other doc in this repo is a *record* of what happened; this one is the *queue*.

- `TODO.md` — the changelog. 450 lines, almost all of it done work. Do not scan it for pending items.
- `docs/distribution.md` — the channel research and the paste-ready form answers. Reference material, not a queue.
- `docs/agent-readiness-2026.md` — the 2026 spec gap analysis. **All five phases are now done** (Phase 2 and the Phase 4 decision closed 2026-08-02); kept for the reasoning and the adoption caveats.
- `docs/show-hn.md` — the draft to post. Reference material.
- `docs/review-2026-07-29.md` — a point-in-time review, now historical.

**Everything below was verified live on 2026-08-02**, not copied forward from the
older docs. Where a doc disagrees with this file, this file is right.

The split is simple: **§1 needs a browser, a public action, or a decision only
you can make. §2 is code and PRs, and needs nothing from you.**

> **Updated 2026-08-02, second pass.** Kamil submitted tally.so, llmstxt.site and
> the Glama connector, and decided §1.4 (Content Signals — all three yes), §1.5
> (score the 2026 signals) and §1.6 (verify the register path). All three are
> **shipped and live**; what they turned up is in §4. What is left on your side
> is now the Show HN, one form, and two optional items.

---

## 1. Pending on Kamil

### 1.1 Post the Show HN — the biggest single lever

*~30 min to post, then two hours of replies. Next window: **Tue 4 Aug, 14:00–16:00 UTC**.*

Draft is ready in `docs/show-hn.md`. **Do not post before I have refreshed the
numbers** (§2.2) — the draft's five figures are now a day and a half stale and
understate you: it says 4,672 requests / 7.19% agent share, live is **6,659 /
10.63%**. Stale numbers are the one thing that sinks a "here is what I measured"
post.

One claim in the draft needs softening and I will handle it in the same pass:
"zero inbound links" is no longer true — llms-txt-hub merged today (§3.1).

Title to use: *"Show HN: I charged AI agents 5 cents a call and logged whether
any turned up"* or *"Show HN: 7% of my traffic is AI crawlers. None of them will
pay 5 cents."* (the second needs its number updated to 10.6%). The three comment
threads to expect and the prepared answers are at the bottom of `docs/show-hn.md`.

### 1.2 One directory submission left — ~4 minutes

You did tally.so (directory.llmstxt.cloud) and llmstxt.site. **Only
mcpservers.org remains.** Answers are in `docs/distribution.md` §4b(d).

| channel | where | notes |
|---|---|---|
| mcpservers.org | /submit | Category **`Search`**. Link should be the **repo** (`https://github.com/110kc3/seo`), not the site — reviewers there look for source. Skip the $39 "premium review"; the free queue is the same directory. |

**Submit `https://index.percall.dev` and nothing else.** Not the apex, not
`index.kc-it.pl`, not `110kc3.github.io/seo/`. This matters more than it sounds:
the llms-txt-hub entry that merged went in as `http://percall.dev/`, and now
needs a correction PR (§2.3).

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

---

## 2. Pending on Claude — no input needed, say go

### 2.1 Put the Glama badge on PR #11152, and fix the tool count — **newly unblocked**

This was the blocker on the 90k★ PR and **it cleared today**:
`https://glama.ai/mcp/servers/110kc3/seo` resolves and the badge SVG renders
(both verified 200 this morning). The PR entry is the only recent addition in
its category without a badge.

Two edits, batched into one push so a 90k★ repo gets one notification instead of two:

1. Add `[![110kc3/seo MCP server](https://glama.ai/mcp/servers/110kc3/seo/badges/score.svg)](https://glama.ai/mcp/servers/110kc3/seo)` to the entry, matching the format every neighbouring line uses.
2. **Correct the tool list: the entry and body say four tools, the hosted server answers six.** Verified against live `/mcp` today: `search_products`, `get_product`, `score_url`, `search_x402_endpoints`, `search_mcp_servers`, `how_to_register`. The two catalog tools shipped with v3.9 and were never reflected upstream.

*This is the highest-value item on either list — it is the last thing standing
between a merged 90k★ listing and a maintainer.*

### 2.2 Refresh the Show HN numbers — blocks §1.1

Read `/api/stats.json` and update the five figures, then soften "zero inbound
links" to "one" now that llms-txt-hub has merged. Current drift:

| figure | draft says | live, 2026-08-02 |
|---|---|---|
| requests / 30d | 4,672 | **6,659** |
| agent share | 7.19% (336) | **10.63% (708)** |
| free scores | 108 | **123** |
| llms.txt fetches | 71 | **125** |
| audit-path hits | 45 | **49** |

The finding the post is built on is unchanged and got stronger: **more agents
are arriving, and still none of them pay.** I will re-read the figures again on
the morning you post rather than trusting these.

### 2.3 Correct the llms-txt-hub entry — it merged with the wrong URL

PR #1459 merged at 09:31 UTC today, and the entry it added carries
`http://percall.dev/` — **http, and the apex rather than the canonical host**.
It works (one 308 hop to `https://index.percall.dev/`), so nothing is broken
today. But the hub's dataset now records a non-canonical http URL as this site's
identity, and that dataset is mirrored by other tools.

One-line frontmatter fix to
`packages/content/data/websites/ai-product-index-llms-txt.mdx`, three fields
(`website`, `llmsUrl`, `llmsFullUrl`). Cheap now, annoying to chase later.

### 2.4 The domain-root hub still advertises a retired host

`110kc3.github.io` points at **`index.kc-it.pl` in 47 places across 9 files**,
and mentions `percall.dev` **zero** times. The affected files are the exact
surfaces crawlers read: `llms.txt`, `llms-full.txt`, `agents.json`,
`.well-known/agents.json`, `.well-known/agent.json`,
`.well-known/agent-card.json`, `sitemap.xml`, `index.html`, `README.md`.

The old host 308s, so agents get there. But this is the same class of problem as
§2.3, on a surface built specifically to tell machines where things are — and it
is the one repo where nobody would think to look, because its own last commit
says "Point the hub at index.kc-it.pl".

### 2.5 `README.md` understates the MCP server

Says `/mcp` offers four tools; it answers six (see §2.1). Trivial, but this repo
sells the idea that its own machine-readable surfaces do not lie.

### 2.6 Fix the self-audit blind spot — it now costs real points

When this site audits *itself*, `fetcherFor()` uses the `ASSETS` binding, because
a Worker cannot fetch its own hostname. `ASSETS` serves committed files only, so
**anything the Worker does at request time is invisible in a self-audit** —
`markdown_negotiation` reads as absent in our own signal block while
`curl -H 'accept: text/markdown' https://index.percall.dev/` correctly returns
`text/markdown` to everyone else.

`web_bot_auth` was already patched case-by-case. Doing the same again would mean
a second copy of the negotiation rules that can drift — the exact anti-pattern
the MCP tool-list fix removed. **The right fix is general: route same-host audits
through the Worker's own fetch handler**, which needs a recursion guard first
(auditing our own `/api/score` would otherwise re-enter).

**This stopped being cosmetic when v2 shipped.** While the signals were unscored
it cost us nothing; now it costs three points, and it is the entire reason our
own site reads **A 98** rather than 100 in `scores.json`. We are the only site in
the fleet the audit is wrong about, and we are wrong about ourselves in the
understating direction — the one nobody would think to check.

External audits still use a real fetch and are correct, so nothing anyone else
sees is affected. Promoted from "worth doing" to the next engineering item.

---

## 3. Waiting on other people — nothing to do

| what | state, 2026-08-02 |
|---|---|
| **awesome-mcp-servers #11152** | OPEN, MERGEABLE. Waits on a maintainer — but only sensibly *after* §2.1 lands the badge. |
| **Awesome-llms-txt #114** | OPEN. One-line diff, Socket checks green. Purely maintainer lag. |
| **x402 Bazaar listing** | Still absent. Re-checked today across **14,794 catalog entries** — nothing pays our address or lives on our host. Everything on our side is done: rail is CDP, the 402 carries discovery metadata, and a settlement has carried it. Upstream `x402-foundation/x402#2112` reports the identical symptom after 8 settlements with the official SDK, unanswered. Check with `node scripts/bazaar-check.mjs`. **Do not spend more time on this** — the next move is theirs. |

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

## 5. Done — stop looking for these

Verified live 2026-08-02 unless noted.

| channel | state |
|---|---|
| **llms-txt-hub** | ✅ **PR [#1459](https://github.com/thedaviddias/llms-txt-hub/pull/1459) MERGED today, 09:31 UTC** — the first real inbound link this project has ever had. URL needs correcting (§2.3). |
| **Glama repo listing** | ✅ **Live** — `glama.ai/mcp/servers/110kc3/seo` resolves, badge renders. Unblocks §2.1. |
| **agentswelcome.dev** | ✅ Certified 100/100 "exemplary", all 18 checks. Entry `ae21017ab44f`, one of 3 sites in the directory. |
| **awesome-mcp-servers** | ✅ Submitted (#11152) — now waiting, see §3. |
| **Awesome-llms-txt** | ✅ Submitted (#114) — now waiting, see §3. |
| **wong2/awesome-mcp-servers** | ❌ N/A — no longer accepts PRs, redirects to mcpservers.org (§1.2c). |
| **directory.llmstxt.cloud** | ✅ Submitted by Kamil 2026-08-02 (Tally). Curation team; no confirmation email. |
| **llmstxt.site** | ✅ Submitted by Kamil 2026-08-02. The one channel that does confirm by email. |
| **Glama connectors** | ✅ Submitted by Kamil 2026-08-02. No badge, unblocks nothing — a channel in its own right. |
| **Domain-root discovery repo** | ✅ Published 2026-07-10. Content is stale (§2.4). |

Also settled and not worth re-opening: the mainnet rail (six real settlements),
the CDP key and rail switch, the deploy/analytics token split, the managed
AI-crawler block across all five zones, the corpus question (decided as b+c —
40 listings plus 24,741 catalogued endpoints), the shopfront listing re-home,
and agent-readiness Phases 1, 3 and 5.

---

## 6. If you only do one thing in each column

- **You:** post the Show HN on Tuesday (§1.1). It is the only item left on your list with real upside; the rest is one form and two optionals.
- **Me:** the Glama badge on PR #11152 (§2.1). It is the last edit between a 90k★ listing and a maintainer, and its blocker cleared this morning.

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

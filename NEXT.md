# NEXT — the one pending list

**This is the only file you need to read to know what is outstanding.** Every
other doc in this repo is a *record* of what happened; this one is the *queue*.

- `TODO.md` — the changelog. 450 lines, almost all of it done work. Do not scan it for pending items.
- `docs/distribution.md` — the channel research and the paste-ready form answers. Reference material, not a queue.
- `docs/agent-readiness-2026.md` — the 2026 spec gap analysis. Phases 1, 3, 5 done; Phase 2 and the Phase 4 decision are listed below.
- `docs/show-hn.md` — the draft to post. Reference material.
- `docs/review-2026-07-29.md` — a point-in-time review, now historical.

**Everything below was verified live on 2026-08-02**, not copied forward from the
older docs. Where a doc disagrees with this file, this file is right.

The split is simple: **§1 needs a browser, a public action, or a decision only
you can make. §2 is code and PRs, and needs nothing from you.**

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

### 1.2 Three directory submissions — ~10 minutes of pasting

All three are browser forms with no API. Two of the five channels are now done
(§3), so this is what is left. **Every answer is prepared in
`docs/distribution.md` §4b** — field labels were read off the live forms, and
both constrained dropdowns are already resolved.

| # | channel | where | notes |
|---|---|---|---|
| a | directory.llmstxt.cloud | Tally form, https://tally.so/r/wAydjB | No account. Adoption-story text is written for you in §4b(b). Say **no** to sponsorship. |
| b | llmstxt.site | /submit | Only channel that asks for `llms-full.txt`; both URLs are in the §4b table. |
| c | mcpservers.org | /submit | Category **`Search`**. Link should be the **repo**, not the site. Skip the $39 "premium review". |

**Submit `https://index.percall.dev` and nothing else.** Not the apex, not
`index.kc-it.pl`, not `110kc3.github.io/seo/`. This matters more than it sounds:
the llms-txt-hub entry that merged today went in as `http://percall.dev/`, and
now needs a correction PR (§2.3).

### 1.3 Optional: Glama connectors — ~2 min

The repo listing is done (§3.2). The *connectors* listing is a separate,
lower-value channel — https://glama.ai/mcp/connectors → "Add Server", URL
`https://index.percall.dev/mcp`, transport streamable-http, auth none. It
produces **no badge and unblocks nothing**, so it is genuinely optional.

*If you already did this when you did the repo listing, tell me and I will strike it.*

### 1.4 Decision: what should Content Signals say?

*One line in `templates/robots.txt`. Five minutes of my time once you answer.*

Cloudflare's default is `search=yes, ai-train=no`, written for a publisher
protecting an archive. **That default is wrong for this site** — it is a
directory whose entire purpose is to be consumed by models, so being in training
data is distribution, not leakage.

My recommendation: `Content-Signal: search=yes, ai-input=yes, ai-train=yes`.

It is a call about your content, so it is yours. Only ~4% of sites declare it
and Cloudflare scores it, so it is cheap differentiation either way.

### 1.5 Decision: should the six 2026 signals count toward the grade?

`/api/score` already **detects** Content Signals, the A2A 1.0 card, the MCP
server card, the RFC 9727 API catalog, the Agent Skills index and Web Bot Auth —
and deliberately does not score any of them, so nobody's grade has moved.

Promoting them into the score is the revenue-relevant half, and it is a real
decision because **it moves badges rendering in other people's READMEs**, and
several of your own fleet sites would drop from A to B overnight through no
change of their own. Doing it properly needs a versioned check set (v1 = 13
checks, v2 = extended) and a fleet re-score *before* announcing.

Say go and I will do it that way. Say no and it stays as reporting, which is
already useful.

### 1.6 Decision: re-verify the register path?

It has not executed since 2026-07-09 and the code has changed substantially
since. It now has 25 tests, but tests exercise the *script*, not the
**workflow** — the issue trigger, token permissions, the commit-and-push retry
loop and the bot comment are untested by anything but a real run.

Verifying it means opening a real `[register]` issue on the public repo, which
creates a public artifact and a real listing. That is your call, not mine. Say
the word and I run it end to end and delete the listing afterwards.

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

### 2.6 Ship the Content Signals line — gated on §1.4

Five minutes once you decide. Listed separately so it is not lost between a
decision and a task.

### 2.7 Fix the self-audit blind spot properly

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

Impact is bounded and cosmetic — signals are unscored, external audits use real
fetch and are correct, and only our own informational block understates us, by
one. So it is real work with low urgency: worth doing, not worth rushing.

---

## 3. Waiting on other people — nothing to do

| what | state, 2026-08-02 |
|---|---|
| **awesome-mcp-servers #11152** | OPEN, MERGEABLE. Waits on a maintainer — but only sensibly *after* §2.1 lands the badge. |
| **Awesome-llms-txt #114** | OPEN. One-line diff, Socket checks green. Purely maintainer lag. |
| **x402 Bazaar listing** | Still absent. Re-checked today across **14,794 catalog entries** — nothing pays our address or lives on our host. Everything on our side is done: rail is CDP, the 402 carries discovery metadata, and a settlement has carried it. Upstream `x402-foundation/x402#2112` reports the identical symptom after 8 settlements with the official SDK, unanswered. Check with `node scripts/bazaar-check.mjs`. **Do not spend more time on this** — the next move is theirs. |

---

## 4. Done — stop looking for these

Verified live 2026-08-02 unless noted.

| channel | state |
|---|---|
| **llms-txt-hub** | ✅ **PR [#1459](https://github.com/thedaviddias/llms-txt-hub/pull/1459) MERGED today, 09:31 UTC** — the first real inbound link this project has ever had. URL needs correcting (§2.3). |
| **Glama repo listing** | ✅ **Live** — `glama.ai/mcp/servers/110kc3/seo` resolves, badge renders. Unblocks §2.1. |
| **agentswelcome.dev** | ✅ Certified 100/100 "exemplary", all 18 checks. Entry `ae21017ab44f`, one of 3 sites in the directory. |
| **awesome-mcp-servers** | ✅ Submitted (#11152) — now waiting, see §3. |
| **Awesome-llms-txt** | ✅ Submitted (#114) — now waiting, see §3. |
| **wong2/awesome-mcp-servers** | ❌ N/A — no longer accepts PRs, redirects to mcpservers.org (§1.2c). |
| **Domain-root discovery repo** | ✅ Published 2026-07-10. Content is stale (§2.4). |

Also settled and not worth re-opening: the mainnet rail (six real settlements),
the CDP key and rail switch, the deploy/analytics token split, the managed
AI-crawler block across all five zones, the corpus question (decided as b+c —
40 listings plus 24,741 catalogued endpoints), the shopfront listing re-home,
and agent-readiness Phases 1, 3 and 5.

---

## 5. If you only do one thing in each column

- **You:** post the Show HN on Tuesday (§1.1). Everything else on your list is minutes of pasting or a decision that can wait a week.
- **Me:** the Glama badge on PR #11152 (§2.1). It has been the blocker on a 90k★ listing for four days and it cleared this morning.

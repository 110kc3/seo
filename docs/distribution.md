# Distribution — researched channels + ready-to-run submissions

Researched 2026-07-09; URLs updated 2026-07-25 for the move to `index.kc-it.pl` and again **2026-08-01 for `https://index.percall.dev`**, which is the canonical host now — §4b has the current values, and the command blocks in §1–4 below are kept verbatim as the record of what was actually submitted on the day, old URLs and all. **Executed 2026-07-29** with Kamil's go-ahead — status per section below. Everything still marked as prepared needs a browser sign-in or a web form, which an agent cannot drive.

> **Submit the canonical host and nothing else — `https://index.percall.dev`.** Nothing external links to this project yet, which is exactly why the domain was settled first: a submission carrying a since-retired URL has to be chased across several awesome-lists to correct, and that has already cost one round of edits. Re-run the agentswelcome.dev audit after the Worker is up: custom response headers and `Accept` content negotiation were two of the checks that capped the score at 81/100 on static hosting. **Both now pass — the site audits 100/100 and is certified (#4).**

## Status at a glance (2026-07-29)

| channel | status |
|---|---|
| punkpeye/awesome-mcp-servers | ✅ PR [#11152](https://github.com/punkpeye/awesome-mcp-servers/pull/11152) |
| SecretiveShell/Awesome-llms-txt | ✅ PR [#114](https://github.com/SecretiveShell/Awesome-llms-txt/pull/114) |
| agentswelcome.dev | ✅ **certified 100/100, "exemplary"** — listed, see #4 |
| llms-txt-hub, directory.llmstxt.cloud, llmstxt.site, mcpservers.org | ⏳ browser sign-in or web form — **every answer is prepared in §4b**, ten minutes of pasting |

## 0. FIRST: publish the domain-root discovery repo (blocks #4, boosts everything)

AI crawlers and the agentswelcome.dev auditor look for `llms.txt` / `robots.txt` / `sitemap.xml` / `agents.json` / `.well-known/*` at the **domain root** — a project site (`/seo/`) can't serve those. A complete user-site repo is prepared and committed at `/home/borg/repos/110kc3.github.io` (root llms.txt/robots/sitemap-index/agents.json/security.txt/agent-card + minimal landing page linking kc-it.pl). Publish with:

```bash
cd /home/borg/repos/110kc3.github.io
gh repo create 110kc3.github.io --public --source=. --remote=origin --push \
  --description "Domain-root discovery surface (llms.txt, robots, agents.json) for 110kc3 project sites"
# user sites usually auto-enable Pages; if not:
gh api -X POST repos/110kc3/110kc3.github.io/pages -f 'source[branch]=main' -f 'source[path]=/'
```

**✅ DONE 2026-07-10** — repo published (approved by Kamil), Pages live, all root surfaces 200. Audit went **21 → 81/100, "agent-ready (certifiable)"** after also adding og:image, `interfaces.json_api`/`webmcp` in agents.json, the A2A card at `/.well-known/agent.json`, and in-page WebMCP tools. Only the static-hosting-impossible checks fail (markdown content-negotiation, RFC 9421 web-bot-auth, custom response headers).

## 1. awesome-mcp-servers (punkpeye) — biggest audience, agent-PRs fast-tracked

90k★, active, feeds Glama's auto-index. CONTRIBUTING.md fast-tracks agent-authored PRs: append `🤖🤖🤖` to the PR title. **Exact change** (verified against upstream 2026-07-10): append to the `### 🔎 Search & Data Extraction` category (entries there are not alphabetical):

```markdown
- [110kc3/seo](https://github.com/110kc3/seo) 📇 ☁️ 🏠 - AI Product Index: search and self-register AI products in a machine-readable directory. Zero-dependency stdio server (search_products / get_product / register_product); registration lands autonomously via GitHub issues.
```

```bash
gh repo fork punkpeye/awesome-mcp-servers --clone /tmp/awesome-mcp && cd /tmp/awesome-mcp
# paste the line above at the end of the "Search & Data Extraction" category
git checkout -b add-ai-product-index && git add README.md
git commit -m "Add AI Product Index MCP server" && git push -u origin add-ai-product-index
gh pr create --repo punkpeye/awesome-mcp-servers --title "Add AI Product Index 🤖🤖🤖" \
  --body "Zero-dependency stdio MCP server for the AI Product Index (https://index.kc-it.pl/) — search_products / get_product / register_product; registration is autonomous via GitHub issues. 🤖 Agent-authored."
```

**✅ SUBMITTED 2026-07-29** — <https://github.com/punkpeye/awesome-mcp-servers/pull/11152>, one-line diff, upstream `check-submission` CI green. Re-verified against upstream first: the section is now headed `### 🔎 <a name="search"></a>Search & Data Extraction` (anchor added, same section), no entry for this project existed, and CONTRIBUTING.md still fast-tracks agent PRs titled with a trailing `🤖🤖🤖`. CONTRIBUTING asks for alphabetical order within a category but the tail of that section is plainly append-ordered, so the prepared line went at the end as planned.

## 2. Awesome-llms-txt (SecretiveShell) — trivial PR, active

**Exact change** (verified 2026-07-10): add to the `## Directories` section (current entries: llms.txt hub, directory.llmstxt.cloud, llmstxt.site):

```markdown
- [AI Product Index](https://index.kc-it.pl/llms.txt)
```

Same fork/PR dance as #1 against `SecretiveShell/Awesome-llms-txt`.

**✅ SUBMITTED 2026-07-29** — <https://github.com/SecretiveShell/Awesome-llms-txt/pull/114>, one-line diff, Socket Security checks green. Re-verified first: `## Directories` still holds exactly those three entries and nothing pointed here yet. Worth knowing before the next edit: that repo's README is **partly generated**. `scripts/normalize_lists.py` rewrites and re-sorts the block from the first list entry up to the next `## ` heading, and a `pull_request` workflow runs it with `--check`. `## Directories` sits after that heading, so it is in the untouched suffix — appending there is safe, but an edit to the main llms.txt list must be normalized locally or CI fails. Ran `--check` on the branch before pushing; it passes.

## 3. llms-txt-hub (thedaviddias) — largest llms.txt directory

llmstxthub.com/submit → GitHub sign-in → automated PR. Note: ~110 open PRs, merges slow. Do after #0 so the root URL exists.

**⏳ MANUAL — not done.** The submit flow is an OAuth sign-in in a browser; there is no API to POST to, so this one waits for you.

## 4. agentswelcome.dev — no account, pure API, our exact niche

```bash
curl -X POST https://agentswelcome.dev/api/directory -H 'content-type: application/json' -d '{"url":"https://index.kc-it.pl/"}'
```

**✅ CERTIFIED AND LISTED 2026-07-29 — 100/100, "exemplary", all 18 checks pass.**

```json
{"congratulations":"Certified. Welcome to the directory.",
 "entry":{"id":"6cd7585c82eb","url":"https://index.kc-it.pl","score":100,
          "grade":"exemplary","certified_at":"2026-07-29T14:00:56.877Z",
          "badge":"/badge.svg?score=100","tier":"standard"}}
```

`GET /api/directory` now returns `count: 2` — this site and agentswelcome.dev itself. It is, for the moment, the only third-party entry in the directory.

The history below is kept because the gap it describes is the same gap this site audits others for.

**❌ RUN 2026-07-29 (first attempt), REFUSED — HTTP 422:** `{"error":"Score 54/100 — certification needs ≥ 70.", …}`.

The 81/100 recorded above was **`110kc3.github.io`**, audited 2026-07-10 — not this site. `index.kc-it.pl` had never been put through that auditor, and it scores lower. `POST /api/audit` (3 free/hour, same 100-point scale) gives the breakdown; run the same day it returned **60/100, "partially legible"**, 40 points lost across seven checks:

| w | check | evidence |
|---|---|---|
| 9 | `markdown-negotiation` | `content-type: text/plain` |
| 7 | `agents-manifest` | `/.well-known/agents.json` → 404 |
| 5 | `json-api` | not advertised (no agents.json) |
| 5 | `webmcp` | not advertised (no agents.json) |
| 5 | `web-bot-auth` | no identity block in agents.json |
| 5 | `agent-welcome-header` | no agent-welcoming header |
| 4 | `security-txt` | `/.well-known/security.txt` → 404 |

Three of these are near-free, and one file carries most of the weight:

- **`/.well-known/agents.json` is worth 22 points on its own** — `agents-manifest` plus the three checks that only read what the manifest advertises (`json_api`, `webmcp`, `identity`). Note the **plural**: this site serves `/.well-known/agent.json`, the A2A card, which is a different spec and does not satisfy it. `110kc3.github.io` serves both, which is why it scored 81. Publishing it alone takes 60 → 82, past the certification gate.
- **`security.txt`** (4) — a `Contact:` and an `Expires:`, generated by the build like the agent card.
- **`agent-welcome-header`** (5) — the Worker sends `X-Agent-Protocol: …/llms.txt`; the auditor looks for `X-Agent-Welcome`. Sending both costs one line.
- **`markdown-negotiation`** (9) is the only real work: `Accept: text/markdown` on `/` already returns the llms.txt body and `Vary: Accept` is correct, but the response is labelled `text/plain`, so the check fails on the content type alone. This is our own audit's mirror-image blind spot — worth checking whether `worker/`'s negotiation path should return `text/markdown`.

### What was actually done, 2026-07-29 (commits `6a2cc70`, `4ca744a`)

All four landed in the build and the Worker, so nothing here is hand-maintained:

- **`/.well-known/agents.json`** — new `templates/agents-manifest.json`, generated by `build.mjs` alongside the A2A card. Both files are published; they are different specs. Everything it advertises is served: `interfaces.json_api` → `/api/index.json`, `interfaces.webmcp` → the in-page `navigator.modelContext` tools `index.html` really registers, `web_bot_auth` → the key directory `worker/signing.js` really serves. A test asserts the advertised WebMCP tool names match the ones the page registers, so the manifest cannot drift into lying.
- **`markdown-negotiation`** — `alternateContentType()` in `worker/negotiate.js`, applied by `decorate()`. The body and `Vary` were already right; only the label was wrong, because the asset binding types `.txt` as `text/plain`. **Only the negotiated response is relabelled** — a direct `GET /llms.txt` is untouched.
- **`X-Agent-Welcome`** — one line in `decorate()`, same value as the existing `X-Agent-Protocol`, which stays. Their `fix` text names the header explicitly: *"Send an agent-welcoming response header (e.g. X-Agent-Welcome) pointing agents to /llms.txt."*
- **`/.well-known/security.txt`** — new `templates/security.txt`. `Expires` is **hardcoded** (2027-07-29), because the build must stay a pure function of its inputs and a computed "now + 1 year" would diff on every rebuild. A test fails once that date passes, since nothing else would renew it.

Two things worth knowing before the next run at this endpoint:

- **The free tier is 3 audits/hour and it is shared with whatever ran earlier that day.** Past that, `POST /api/audit` answers 402 with a *demo* x402 flow of its own ("DEMO — no real money"): `POST /api/pay` returns a token, retry with `X-Payment: <token>`. That is their documented path, not a bypass.
- **`web-bot-auth` did not pass on the first try** at 95/100, reporting "no identity block in agents.json" against a manifest that had a top-level `identity` object — the same way `110kc3.github.io` fails it. Flattening fixed it (`4ca744a`): `web_bot_auth` hoisted to a top-level sibling of `identity`, the signature directory moved up one level inside `identity`, and an `interfaces.identity` alias. The lesson generalises — **these auditors read shallow.** A capability nested one level too deep reads as absent.
- **Re-POSTing `/api/directory` updates the existing entry in place.** The response carries a fresh `id` each time, which looks like a duplicate but is not: `GET /api/directory` still shows one row for this site, with the newer score. The first submission scored **78**, not the 95 the audit had just returned, because a cold Cloudflare POP still had `/.well-known/agents.json` as a 404 — exactly the 7+5+5 weight of the three manifest checks. **Wait for the new artifact to serve from several requests before submitting**, or the directory records a stale score.

Re-POST to `/api/directory` after a change; the endpoint is idempotent to retry and states so (`"retry": "Fix these, then POST again."`).

## 4b. The five browser-only channels — paste-ready answers (2026-08-01)

These cannot be scripted: three are OAuth sign-ins, two are hosted forms. All of
them were re-checked for an API route first, and none has one. What *can* be
prepared is every answer, so the whole set is ~15 minutes of pasting. Field
labels below were read off the live forms on 2026-08-01, not guessed.

**The canonical answers.** Every one of these forms asks a subset of this:

| asked as | value |
|---|---|
| name / product / server name | `AI Product Index` |
| website / domain / link | `https://index.percall.dev` |
| llms.txt URL | `https://index.percall.dev/llms.txt` |
| llms-full.txt URL | `https://index.percall.dev/llms-full.txt` |
| short description (≤160 chars) | `Machine-readable directory of AI products, with a free agent-readability score and a paid audit an agent can buy over x402.` |
| longer description | `A directory AI agents can read, register in, and buy from. GET /api/score grades any URL across 13 agent-readability checks for free; POST /api/audit returns per-check fixes and paste-ready snippets for $0.05, settled in USDC on Base via HTTP 402. Products self-register by opening a GitHub issue against a published schema — no human step. Zero dependencies, 171 tests, traffic published at /api/stats.json.` |
| contact | `110kc3@gmail.com` |
| your name | `Kamil` |

**Never submit** `110kc3.github.io/seo/`, `index.kc-it.pl`, or the workers.dev
fallback. The old hosts 308 here, but a directory that records the redirect
target is one you have to go back and correct.

### a. llms-txt-hub — llmstxthub.com/submit

GitHub OAuth (recommended over email — it opens the PR for you and gets the
contributor badge). ~1,405 entries, ~110 open PRs, merges are slow.

The form maps onto their `websites.json` schema: `name`, `domain`,
`description`, `llmsTxtUrl`, `category`. **Category must be one of exactly
five**: `ai-ml` (538), `developer-tools` (548), `data-analytics` (199),
`infrastructure-cloud` (62), `security-identity` (58). **Pick `ai-ml`** — this
is an AI-product directory, not a dev tool; `developer-tools` is the fallback if
a reviewer pushes back.

### b. directory.llmstxt.cloud — Tally form at https://tally.so/r/wAydjB

Live, verified 2026-08-01. No account. Fields: website/product name
(required), llms.txt URL (required — it finds llms-full.txt itself), category,
email (optional), X username (optional), an open "adoption story" box, and a
sponsorship-interest question.

For the adoption story, something true and short beats marketing:

> Built the site so agents could read it, then measured whether they do:
> 7.19% of 4,672 requests over 30 days are AI crawlers. llms.txt is the first
> thing they fetch after robots.txt.

Say **no** to sponsorship. Submissions wait on their curation team.

### c. llmstxt.site — form at /submit

Fields: Product Name, Website URL, Your Name, Email Address, llms.txt URL,
llms-full.txt URL, Additional Notes. Both txt URLs exist and return 200 — this
is the only channel that asks for `llms-full.txt`, so use the table above.

### d. mcpservers.org/submit — replaces PRs to wong2/awesome-mcp-servers

4.2k★ sibling of #1; its README now refuses PRs and points here. Client-side
React form, so nothing to script. Fields: Server Name, Short Description, Link
(GitHub or docs), Category, Contact Email.

**Category: `Search`** (options are Development, Productivity, Database, Search,
Web Scraping, File System, Version Control, Communication, Cloud Service, Cloud
Storage, Marketing, Finance, Design, Memory, Other — `Search` matches the
category the awesome-mcp-servers PR used).

For **Link**, use the repo `https://github.com/110kc3/seo` rather than the site:
this is an MCP directory and reviewers look for source. Description:

> Zero-dependency stdio MCP server for the AI Product Index: search_products /
> get_product / register_product. Registration lands autonomously via GitHub
> issues.

There is a **$39 one-time "premium review"** upsell — skip it. The free queue is
the same directory.

### e. Glama — TWO separate submissions, and only one of them matters for the PR

**Do this one first.** It is the only item in this section that another channel
is blocked on: PR #11152 (90k★) will not be merged until it is done. Full
background in §5; this is just the pasting.

Both need a Glama account — GitHub OAuth, no password. Neither can be scripted:
registry submission is not part of Glama's API (that API is the Gateway, an
OpenAI-compatible inference product, and is unrelated). The add page is a
client-side app with no form action and no unauthenticated route, so there is
nothing to POST to. Browser automation would work if the Claude in Chrome
extension were connected; it is not.

**e1. The repo listing — https://glama.ai/mcp/servers/add** ← unblocks the badge

| asked as | value |
|---|---|
| repository | `https://github.com/110kc3/seo` |
| display name | `AI Product Index` |
| short description | `Machine-readable directory of AI products that register themselves, plus an agent-readability grader for any URL.` |

If it asks for a Dockerfile — the bot's wording is that you add it "directly to
Glama" — the repo root already has one, and this is it:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY site.config.json ./
COPY mcp/ ./mcp/
ENTRYPOINT ["node", "mcp/server.mjs"]
```

Glama's check starts the server and calls `initialize` then `tools/list`. That
exact exchange was run against this image on 2026-08-01 and both answered, so
the check has no known reason to fail. `glama.json` (maintainers: `110kc3`) is
already committed.

**When the page at https://glama.ai/mcp/servers/110kc3/seo resolves**, the badge
below goes onto the PR entry — batched with the four-tools→six-tools correction,
so the 90k★ repo gets one notification rather than two:

```
[![110kc3/seo MCP server](https://glama.ai/mcp/servers/110kc3/seo/badges/score.svg)](https://glama.ai/mcp/servers/110kc3/seo)
```

**e2. The connector listing — https://glama.ai/mcp/connectors → "Add Server"**

A real channel in its own right (10,627 servers indexed), and the `glama-check`
bot's own P.S. invites it. It produces **no badge**, so it does not unblock
anything — do it second, or skip it under time pressure.

| asked as | value |
|---|---|
| URL | `https://index.percall.dev/mcp` |
| transport | streamable-http |
| auth | none |

### After submitting

Note the date against each channel in the status table above. None of these
confirm by email except (c), so the only way to know is to look again in a week.
Glama is the exception that reports quickly: most submissions pass automated
checks within minutes, so the server page either resolves or it does not.

## 5. Lower priority

- directory.llmstxt.cloud — Tally form https://tally.so/r/wAydjB (2 min, no account, activity unclear). **⏳ MANUAL — not done**, browser form.
- llmstxt.site — form at /submit (semi-active). **⏳ MANUAL — not done**, browser form.
- wong2/awesome-mcp-servers — ~~smaller sibling of #1, same PR pattern~~. **❌ NOT APPLICABLE as of 2026-07-29** — the README now opens with `> [!NOTE] We do not accept PRs. Please submit your MCP on the website: https://mcpservers.org/submit`. That submit page is a client-side React form (server name / description / link / category / contact email, with a $39 "premium" queue-skip upsell), so there is no request to script. **⏳ MANUAL** if 4.2k★ is judged worth the form; the free tier is fine.
- Official MCP Registry (registry.modelcontextprotocol.io) — needs the server packaged as an `mcpb` bundle attached to a GitHub Release + `mcp-publisher` device auth. Medium effort; do if the MCP server gets traction.
- Skip: mcp.so (stale/403), Smithery (auto-index; passive benefit already flows from #1).

### Glama — promoted out of "skip": #1 now *requires* it (2026-08-01)

Glama was written off here as a passive auto-index. That is no longer true, and
it is now a hard dependency of the 90k★ PR rather than a nice-to-have. The
`glama-check` bot commented on
[#11152](https://github.com/punkpeye/awesome-mcp-servers/pull/11152) on
2026-07-29 with new listing requirements:

1. the server must be listed on Glama and pass its checks, and
2. the PR entry must carry a score badge —
   `[![110kc3/seo MCP server](https://glama.ai/mcp/servers/110kc3/seo/badges/score.svg)](https://glama.ai/mcp/servers/110kc3/seo)`

Every neighbouring entry in the Search & Data Extraction category already
carries one; ours is the only recent addition without. Both the badge and the
server page 404 today, which is simply what "not yet listed" looks like.

**Glama has two separate front doors, and the badge only comes from one:**

| route | what it takes | gives a badge? |
|---|---|---|
| `glama.ai/mcp/servers/add` | a **GitHub repo**; Glama builds it and runs the stdio server | **yes** — `/mcp/servers/110kc3/seo` |
| `glama.ai/mcp/connectors` | a public **streamable-http URL** | no |

So the repo route is the one that unblocks #11152. The connectors route is worth
doing too — the bot's own P.S. invites it and `https://index.percall.dev/mcp` is
exactly what it wants — but it will not produce the badge.

**Repo side is done and verified** (`glama.json` + `Dockerfile`, 2026-08-01).
Glama's health check starts the server and calls `initialize` and `tools/list`;
that exact exchange was run against the built image and both answered, so the
check has no reason to fail. `glama.json` carries only `maintainers`, which is
all its schema defines.

**Left to do, and it needs a browser + GitHub OAuth:** submit `110kc3/seo` at
https://glama.ai/mcp/servers/add. Once the server page resolves, the badge line
goes onto the PR — batched with the tool-list correction below so a 90k★ repo
gets one notification instead of two.

**Also stale in the PR entry:** it names four tools, and the hosted server now
answers six — `search_x402_endpoints` and `search_mcp_servers` shipped with
v3.9. Note the repo's stdio server (`mcp/server.mjs`) still exposes only three
(`search_products`, `get_product`, `register_product`) and has drifted from the
Worker; the entry advertises the hosted endpoint, so it should describe the six.

**The GLAMA_API_KEY question is answered: it is not needed here.** Glama's API
docs are for the Gateway, an OpenAI-compatible inference product. Registry
submission is a web form, not an API call. Unless the key is something other
than a gateway key, delete it rather than leave an unread credential around.

## Passive channels already live

GitHub repo topics (`ai-agents`, `mcp`, `mcp-server`, `llms-txt`, `agentic-commerce`, `directory`, `seo`) + tuned description — GitHub search is itself an agent discovery channel. Show HN draft: `docs/show-hn.md`.

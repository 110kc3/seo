# Distribution — researched channels + ready-to-run submissions

Researched 2026-07-09; URLs updated 2026-07-25 for the move to `https://index.kc-it.pl`. **Executed 2026-07-29** with Kamil's go-ahead — status per section below. Everything still marked as prepared needs a browser sign-in or a web form, which an agent cannot drive.

> **Run these only after the Cloudflare Worker is live at `index.kc-it.pl`.** Nothing external links to this project yet, which is exactly why the domain was settled first — a submission carrying the old `110kc3.github.io/seo/` URL would have to be chased across several awesome-lists to correct. Re-run the agentswelcome.dev audit after the Worker is up: custom response headers and `Accept` content negotiation were two of the checks that capped the score at 81/100 on static hosting.

## Status at a glance (2026-07-29)

| channel | status |
|---|---|
| punkpeye/awesome-mcp-servers | ✅ PR [#11152](https://github.com/punkpeye/awesome-mcp-servers/pull/11152) |
| SecretiveShell/Awesome-llms-txt | ✅ PR [#114](https://github.com/SecretiveShell/Awesome-llms-txt/pull/114) |
| agentswelcome.dev | ❌ 422, scores 60/100 and the gate is 70 — see #4 |
| llms-txt-hub, directory.llmstxt.cloud, llmstxt.site, mcpservers.org | ⏳ browser sign-in or web form, manual |

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

**❌ RUN 2026-07-29, REFUSED — HTTP 422:** `{"error":"Score 54/100 — certification needs ≥ 70.", …}`.

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

Re-POST to `/api/directory` after those land; the endpoint is idempotent to retry and states so (`"retry": "Fix these, then POST again."`).

## 5. Lower priority

- directory.llmstxt.cloud — Tally form https://tally.so/r/wAydjB (2 min, no account, activity unclear). **⏳ MANUAL — not done**, browser form.
- llmstxt.site — form at /submit (semi-active). **⏳ MANUAL — not done**, browser form.
- wong2/awesome-mcp-servers — ~~smaller sibling of #1, same PR pattern~~. **❌ NOT APPLICABLE as of 2026-07-29** — the README now opens with `> [!NOTE] We do not accept PRs. Please submit your MCP on the website: https://mcpservers.org/submit`. That submit page is a client-side React form (server name / description / link / category / contact email, with a $39 "premium" queue-skip upsell), so there is no request to script. **⏳ MANUAL** if 4.2k★ is judged worth the form; the free tier is fine.
- Official MCP Registry (registry.modelcontextprotocol.io) — needs the server packaged as an `mcpb` bundle attached to a GitHub Release + `mcp-publisher` device auth. Medium effort; do if the MCP server gets traction.
- Skip: mcp.so (stale/403), Glama & Smithery (auto-index; passive benefit already flows from #1).

## Passive channels already live

GitHub repo topics (`ai-agents`, `mcp`, `mcp-server`, `llms-txt`, `agentic-commerce`, `directory`, `seo`) + tuned description — GitHub search is itself an agent discovery channel. Show HN draft: `docs/show-hn.md`.

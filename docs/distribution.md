# Distribution — researched channels + ready-to-run submissions

Researched 2026-07-09. Everything below is prepared; the external/publishing steps need your go (they publish under your GitHub identity / claim public namespaces).

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
  --body "Zero-dependency stdio MCP server for the AI Product Index (https://110kc3.github.io/seo/) — search_products / get_product / register_product; registration is autonomous via GitHub issues. 🤖 Agent-authored."
```

## 2. Awesome-llms-txt (SecretiveShell) — trivial PR, active

**Exact change** (verified 2026-07-10): add to the `## Directories` section (current entries: llms.txt hub, directory.llmstxt.cloud, llmstxt.site):

```markdown
- [AI Product Index](https://110kc3.github.io/seo/llms.txt)
```

Same fork/PR dance as #1 against `SecretiveShell/Awesome-llms-txt`.

## 3. llms-txt-hub (thedaviddias) — largest llms.txt directory

llmstxthub.com/submit → GitHub sign-in → automated PR. Note: ~110 open PRs, merges slow. Do after #0 so the root URL exists.

## 4. agentswelcome.dev — no account, pure API, our exact niche

Audit already passes (**81/100, certifiable** as of 2026-07-10) — the directory submit is one command, awaiting your go:

```bash
curl -X POST https://agentswelcome.dev/api/directory -H 'content-type: application/json' -d '{"url":"https://110kc3.github.io/seo/"}'
```

## 5. Lower priority

- directory.llmstxt.cloud — Tally form https://tally.so/r/wAydjB (2 min, no account, activity unclear).
- llmstxt.site — form at /submit (semi-active).
- wong2/awesome-mcp-servers — smaller sibling of #1, same PR pattern.
- Official MCP Registry (registry.modelcontextprotocol.io) — needs the server packaged as an `mcpb` bundle attached to a GitHub Release + `mcp-publisher` device auth. Medium effort; do if the MCP server gets traction.
- Skip: mcp.so (stale/403), Glama & Smithery (auto-index; passive benefit already flows from #1).

## Passive channels already live

GitHub repo topics (`ai-agents`, `mcp`, `mcp-server`, `llms-txt`, `agentic-commerce`, `directory`, `seo`) + tuned description — GitHub search is itself an agent discovery channel. Show HN draft: `docs/show-hn.md`.

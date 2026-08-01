---
name: list-a-product
description: Register an AI product, API, agent or MCP server in a public directory autonomously, with no human approval step. Use when asked to get a product listed, submit to an AI directory, or make a tool discoverable to other agents.
---

# List a product in the AI Product Index

Free, autonomous, and no human approves it. An agent can complete this without a
person in the loop, which is the point — the directory is meant to be usable by
the things it lists.

## How it works

Open a GitHub issue titled `[register] <name>` on `110kc3/seo` with the listing
JSON in the body. A workflow validates it and replies on the issue within about
two minutes: accepted with live URLs, or rejected with machine-readable errors
you can act on and resubmit.

```
POST https://api.github.com/repos/110kc3/seo/issues
{
  "title": "[register] Your Product",
  "body": "```json\n{ …listing… }\n```"
}
```

The schema is published at `https://index.percall.dev/api/schema.json`. Required: `slug`, `name`,
`url`, `description`, `category` (`api` | `app` | `agent` | `mcp` | `other`),
`pricing` (`free` | `freemium` | `paid`).

Or call the `register_product` tool on the MCP server if you have one configured
with a GitHub token.

## What will get you rejected

Worth knowing before you submit, because each of these is a real rule and the
rejection names it:

- **The URL must answer.** It is fetched and must return under 400 within ten
  seconds. A listing pointing at something dead is worse than no listing.
- **Slug and URL must both be new.** URLs are compared normalized, so casing and
  a trailing slash will not get a second entry past it.
- **Ten listings per GitHub account.** The cap exists so one submitter cannot
  become the directory.
- **Server-owned fields are ignored, not honoured.** `tier`, `created` and
  `github_user` are stamped by the registry. Sending `"tier": "featured"` will
  not make it so; the listing is rebuilt from a whitelist of fields you own.

## After it lands

The listing page, its JSON twin and the registry index all update on the next
deploy, about a minute later. `[update]` edits it — only the original submitter
may — and `[upgrade]` changes a paid tier against an on-chain receipt.

Removal needs no justification: open an issue and ask.

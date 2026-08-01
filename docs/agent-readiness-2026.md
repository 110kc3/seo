# What other agent-facing sites do, and what we should copy

Researched 2026-08-01. The question was "what are other sites doing for agents
that we are not". The short answer is that we are ahead on protocols and behind
on **file paths**: several specs we already implement have moved, and we are
still serving the old locations. The longer answer is that the checklist we sell
audits against has grown, and ours has not.

## Who to measure against

**Cloudflare's Agent Readiness score is the one that matters here**, for two
reasons: it is the most complete published checklist, and we are hosted on
Cloudflare, so it is the audit our own site will be judged by whether or not we
ask. Its four dimensions and every check:

| dimension | checks |
|---|---|
| Discoverability | `robots.txt` (RFC 9309), `sitemap.xml`, Link headers (RFC 8288) |
| Content | markdown content negotiation, `llms.txt` |
| Bot access control | Content Signals in `robots.txt`, AI bot rules, Web Bot Auth at `/.well-known/http-message-signatures-directory` |
| Capabilities | Agent Skills, API Catalog (RFC 9727), OAuth discovery (RFC 8414/9728), MCP Server Card, WebMCP |
| Commerce *(checked, not scored)* | x402, Universal Commerce Protocol, Agentic Commerce Protocol |

Cross-checked against [AgentReady](https://www.agentready.org/) (MCP, A2A, x402,
llms.txt, Web Bot Auth) and the A2A 1.0 specification.

## Where we actually stand

Verified against the live site on 2026-08-01, not assumed:

| signal | path | us |
|---|---|---|
| robots.txt, sitemap, Link headers | — | ✅ |
| llms.txt / llms-full.txt | — | ✅ |
| markdown content negotiation | — | ✅ |
| AI bot rules | `robots.txt` | ✅ explicit allow-list |
| Web Bot Auth | `/.well-known/http-message-signatures-directory` | ✅ |
| x402 commerce | `/api/x402/info` | ✅ live rail |
| security.txt (RFC 9116) | `/.well-known/security.txt` | ✅ |
| **Content Signals** | `robots.txt` | ❌ **missing** |
| **A2A agent card (1.0 path)** | `/.well-known/agent-card.json` | ❌ **404** |
| **MCP Server Card (CF path)** | `/.well-known/mcp/server-card.json` | ❌ **404** |
| **API Catalog (RFC 9727)** | `/.well-known/api-catalog` | ❌ **404** |
| **Agent Skills** | `/.well-known/agent-skills/index.json` | ❌ **404** |
| OAuth protected resource | `/.well-known/oauth-protected-resource` | ❌ n/a today, see below |
| ai.txt / RSL licensing | `/ai.txt`, `/rsl.xml` | ❌ deliberately skipped, see below |

We serve `/.well-known/agent.json` and `/.well-known/mcp.json`. Both are real
files at real paths — they are simply **the previous locations**.

## The two findings that actually matter

### 1. We are on the pre-1.0 A2A path, and so is our audit product

A2A is at 1.0 under the Linux Foundation, and the agent card lives at
`/.well-known/agent-card.json`. `/.well-known/agent.json` is the pre-0.3 path,
and **a spec-compliant 1.0 client will never look there.** Publishing both
during the transition is the normal practice.

Worse, our own scorer grades other people on it:

```js
agent_card: 'agent card at /.well-known/agent.json',
```

So the directory that sells agent-readiness audits is checking a path the
current spec moved away from, and telling sites they pass when a 1.0 client
cannot find them. That is the same class of failure as our own listing pointing
at a dead host — the shopfront failing its own audit — and it is the single
highest-value fix in this document.

### 2. Our checklist is 13 items and the standard is now ~20

`/api/score` checks llms.txt ×3, robots.txt ×2, sitemap, JSON-LD, title/meta,
Open Graph, canonical, machine alternates, agent card, HTTPS. Every one is still
valid. But nothing in it covers Content Signals, the API Catalog, Agent Skills,
MCP Server Cards, or Web Bot Auth — five things Cloudflare now scores and that
**only 4% of sites declare** in the Content Signals case.

That gap is the product opportunity, not just a chore: an audit that reports the
2026 checklist is worth more than one reporting the 2025 one, and we already
have the crawler, the scoring model, the paid endpoint and the badge.

## The plan

Ordered by value per hour. Phases 1–2 are unambiguous; 3 onward involve real
judgement calls, flagged inline.

### Phase 1 — serve the current paths (~1 hour, no judgement needed)

1. **`/.well-known/agent-card.json`** — same content as `agent.json`, generated
   from the same template so they cannot drift. Keep `agent.json` for
   pre-1.0 clients; costs one file.
2. **`/.well-known/mcp/server-card.json`** — same content as `mcp.json`. SEP-2127
   says `mcp.json`, Cloudflare checks `mcp/server-card.json`; the specs disagree
   with each other, so serve both and let the client pick.
3. **Update the `agent_card` check** to pass on *either* path, and to say in the
   fix text that `agent-card.json` is the current one. Wording matters: this is
   advice people pay for.
4. Extend the existing test that asserts "no manifest advertises a route the
   router lacks" to cover the new paths.

**Do this first even if nothing else happens.** It is pure upside — no design
decisions, no scoring changes, and it fixes a correctness bug in a paid product.

### Phase 2 — Content Signals (~30 min, one decision)

Add to `templates/robots.txt`:

```
# Content signals — https://contentsignals.org/
Content-Signal: search=yes, ai-input=yes, ai-train=yes
```

**The decision is what those values should be**, and the usual default is wrong
for us. Cloudflare's default is `search=yes, ai-train=no`, which suits a
publisher protecting an archive. This site is a *directory whose entire purpose
is to be consumed by models and agents* — being in training data is
distribution, not leakage. So `ai-train=yes` is very likely right here, and it
is the opposite of what most guidance says. Worth 30 seconds of thought before
copying a default that was written for a newspaper.

The three signals: `search` (indexing and link/snippet), `ai-input` (real-time
use in generated answers, i.e. RAG), `ai-train` (training and fine-tuning).

### Phase 3 — API Catalog, RFC 9727 (~1 hour)

`/.well-known/api-catalog`, media type `application/linkset+json`, profile
`https://www.rfc-editor.org/info/rfc9727`. We already publish `openapi.yaml`, so
this is a wrapper, not new information:

```json
{
  "linkset": [
    {
      "anchor": "https://index.percall.dev/.well-known/api-catalog",
      "item": [
        { "href": "https://index.percall.dev/openapi.yaml" }
      ]
    }
  ]
}
```

Generate it from `build.mjs` off the same config the OpenAPI template uses, and
serve the content type via the Worker — a static asset will otherwise go out as
`application/json` and fail a strict check.

### Phase 4 — extend the audit from 13 checks to ~20 (~half a day, real care)

The revenue-relevant phase. Candidate checks, all mechanically detectable:

| check | why it is fair to score |
|---|---|
| Content Signals declared | scored by Cloudflare; 4% adoption makes it a differentiator |
| `agent-card.json` at the 1.0 path | the spec moved; clients follow the spec |
| MCP Server Card | the discovery route for tool-using agents |
| API Catalog (RFC 9727) | machine-readable API discovery, trivial to add |
| Agent Skills index | states capabilities without reading docs |
| Web Bot Auth directory | lets a site distinguish real agents from scrapers |
| markdown content negotiation | Cloudflare scores it; we already implement it |

**The trap: changing the scorer changes everyone's grade.** `scores.json`, the
badges rendering in other people's READMEs, and the fleet's 100/100 scores all
move the moment a check is added — and several of our own sites would drop from
A to B overnight through no change of their own. Handle it deliberately:

- Version the check set (`v1` = 13 checks, `v2` = the extended set) and record
  which version produced a stored grade.
- Weight new checks below the established ones. Missing `llms.txt` should always
  cost more than missing an Agent Skills index that <1% of the web publishes.
- Re-score the fleet *before* announcing, so the Show HN and the badges do not
  disagree for a week.

### Phase 5 — Agent Skills (~half a day, and the most speculative)

`/.well-known/agent-skills/index.json`, schema
`https://schemas.agentskills.io/discovery/0.2.0/schema.json`. Each entry needs
`name`, `type` (`skill-md` | `archive`), `description`, `url`, and a
`sha256:` digest.

Unlike everything above, this needs **content, not plumbing** — real SKILL.md
files describing what an agent can do here. The honest candidates are: grade a
URL, find a paid API by capability and price, find a callable MCP server,
register a product. All four already exist as MCP tools, so the skills would be
prose wrappers over shipped capability rather than new promises.

Do this last. It is the only item requiring writing rather than wiring, and the
digest requirement means it needs a build step to stay correct.

## Deliberately not doing

- **OAuth protected resource metadata (RFC 9728)** — describes how to
  authenticate to a protected resource. Our `/mcp` is deliberately open and
  payment is per-call via x402, so there is nothing to describe. Adding an empty
  metadata document to win an audit point would be pretending to have an auth
  model. Revisit if `/mcp` ever gains authenticated tiers.
- **ai.txt (Spawning)** — overlaps Content Signals, which is the one Cloudflare
  scores and the one with momentum. Two competing opt-out files saying the same
  thing is worse than one.
- **RSL (Really Simple Licensing)** — aimed at publishers licensing content for
  payment. Our catalogs are explicitly mirrors whose facts belong to the endpoint
  operators; claiming licensable rights over them would be wrong.
- **WebMCP** — browser-side, and we are a JSON-first site with a thin HTML
  surface. Worth re-reading once the spec settles, not now.

## The honest caveat

Most of these standards have **very low adoption** — under 15 sites in a 200,000
sample had an MCP Server Card or API Catalog. So the traffic case is weak today
and nobody should expect agents to arrive because we published a linkset.

Two reasons to do it anyway, and neither is "agents will come":

1. **Auditors already check.** Cloudflare's score is live, and ours is a product.
   Being unable to pass the checklist we sell is a credibility problem well
   before it is a traffic problem.
2. **The cost is hours, not weeks.** Phases 1–3 are a morning, and they are the
   ones with actual reasoning behind them. Phase 4 is where the value is, and it
   is only worth doing because we already own the scorer.

If only one thing gets done: **Phase 1**. We are grading other people against a
path the spec abandoned.

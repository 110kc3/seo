# Show HN draft

Rewritten 2026-07-25. The old draft pitched "a directory AI agents register
themselves in" and buried the payment story as unfinished. Both halves of that
have changed: the site now runs on a Worker with a real paid endpoint, and the
interesting claim is no longer the directory — it is **an HTTP endpoint an agent
can buy from, and what the traffic logs say about whether agents actually show
up.** A directory nobody has heard of is not a story; a working machine-payable
API with honest numbers is.

**Title options** (HN truncates around 80 chars):

1. `Show HN: An API an AI agent can pay for itself, with HTTP 402 and USDC`
2. `Show HN: I charged AI agents 5 cents a call and logged whether any turned up`
3. `Show HN: Agent-readability audit, free score, paid fixes, paid over x402`
4. `Show HN: A directory whose only customers are AI agents (and what it earned)`

Prefer 1 or 2. Both promise a number, which is what this audience turns up for.

**URL:** https://index.kc-it.pl/

---

## Text (post as the first comment, immediately after submitting)

Two years of "agents will buy things" and I wanted to know whether anything can
actually pay an HTTP endpoint today. So I built one and put a price on it.

`POST /api/audit` scores how readable a site is to AI agents across 13 weighted
checks — llms.txt and its shape, schema.org JSON-LD, robots.txt AI-crawler
posture, sitemap, agent card, machine-readable alternates, canonical, HTTPS. An
unpaid request answers `402` with the terms. You retry with a signed EIP-3009
authorization in a header, a facilitator settles it on Base, and you get the
audit plus a settlement receipt. Five cents a call. The free tier at
`GET /api/score?url=…` gives you the A–F grade and which checks failed; the
payment buys the reason each one failed and a paste-ready snippet for your own
domain.

Three things I did not expect:

**The spec and the installed base disagree, and building to the spec means
earning nothing.** x402 v2 uses CAIP-2 network ids, an `amount` field, and
`PAYMENT-SIGNATURE`. The reference client on npm still validates the 402 against
a v1 schema and *throws* — it wants `base-sepolia`, `maxAmountRequired`, and
sends `X-PAYMENT`. A spec-perfect v2-only endpoint is unpayable by the clients
most likely to call it. It now answers both from one 402: v2 in the header, v1 in
the body. They can't be merged into one `accepts` array, because a v1 client
validates the whole array and rejects the response if a v2 entry appears in it.

**USDC does not use the same name on every chain, and the name is load-bearing.**
The `extra: {name, version}` you publish is the EIP-712 domain the payer signs
`transferWithAuthorization` against, so it must equal the token's own `name()`.
That's `"USDC"` on Base Sepolia and `"USD Coin"` on Base mainnet. Get it wrong
and the facilitator rejects every payment as an invalid signature, with nothing
pointing at a string as the cause.

**The public facilitator is testnet-only.** `x402.org/facilitator` advertises no
Base mainnet at all. Rehearsal works perfectly and mainnet silently cannot
settle. There are production facilitators that need no API key.

The registry underneath it is the older idea: products register themselves with
no human steps — an agent reads llms.txt, builds a listing against the published
schema, and opens a GitHub issue. A workflow validates it and replies with live
URLs in about two minutes. GitHub issues turn out to be a good write API for
agents: every capable one already knows how to open one, auth is solved, and the
audit trail is public.

**The honest part.** I ran the registry on static hosting for 16 days and got
zero organic registrations — and no logs, so I couldn't even tell whether an
agent had ever visited. That's why it moved to a Worker: every request is now
classified and counted, and the numbers are public at `/api/stats.json`. If the
agent share turns out to be noise, that is the answer, and the audit endpoint
stands on its own. Zero npm dependencies throughout; the payment gate, the
EIP-712 handling and the CDP JWT signing are all hand-rolled on WebCrypto.

Repo: https://github.com/110kc3/seo — the whole protocol is in
https://index.kc-it.pl/llms.txt

---

## Before posting — checklist

- [ ] **`/api/stats.json` must be publishing.** The "here are the real numbers"
      paragraph is the strongest thing in the post and it needs the analytics
      read token set. Without it, cut that paragraph rather than hand-wave.
- [ ] **At least one settled payment**, so "an agent can pay this" is a statement
      of fact and not of intent. Ideally quote the total.
- [ ] Have a couple of listings that are not self-authored, or don't lead with
      the directory at all — use title 1 or 2.
- [ ] Retire the duplicate hostnames first (`110kc3.github.io/seo/`), so nobody
      finds three copies of the site.
- [ ] Re-read `/llms.txt` end to end — it is the second link everyone clicks.

## Timing

Tue–Thu, 14:00–16:00 UTC (US East morning). Reply fast for the first two hours;
on HN the comments are the post. Expect the top thread to be "is agentic payment
real or a solution looking for a problem" — the honest answer, with the traffic
numbers, is a better comment than a defence.

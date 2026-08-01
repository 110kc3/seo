# Show HN draft

Rewritten 2026-08-01, for the third time, and this is the version to post. The
2026-07-25 draft promised numbers it did not have and pitched the payment rail
as the story. Both have changed:

- **The numbers exist now.** Seven days of classified traffic, published at
  `/api/stats.json`, and the decision gate that traffic was collected to settle
  has been read: `agent_share` **7.19%**, up from 3.2% at day 4.
- **The rail is boring, and that is the point.** Six real settlements on Base
  mainnet. The interesting material moved to what breaks *around* a working
  rail — the client/spec split, the EIP-712 domain name, and the discovery
  layer, which turns out not to work the way its documentation says.
- **The domain moved** to `percall.dev`, which is now the umbrella for further
  paid services. Do not post a `kc-it.pl` or `110kc3.github.io` URL.

**Title options** (HN truncates around 80 chars):

1. `Show HN: I charged AI agents 5 cents a call and logged whether any turned up`
2. `Show HN: An API an AI agent can pay for itself, with HTTP 402 and USDC`
3. `Show HN: 7% of my traffic is AI crawlers. None of them will pay 5 cents.`

Prefer 1 or 3. Both promise a number and admit a negative result, which is the
honest shape of this post and the thing this audience rewards. 2 is the safe
fallback if the tone of the day is hostile to "I measured X" posts.

**URL:** https://index.percall.dev/

---

## Text (post as the first comment, immediately after submitting)

Two years of "agents will buy things" and I wanted to know whether anything can
actually pay an HTTP endpoint today. So I built one, put a price on it, and
logged what showed up.

`POST /api/audit` scores how readable a site is to AI agents across 13 weighted
checks — llms.txt and its shape, schema.org JSON-LD, robots.txt AI-crawler
posture, sitemap, agent card, machine-readable alternates, canonical, HTTPS. An
unpaid request answers `402` with the terms. You retry with a signed EIP-3009
authorization in a header, a facilitator settles it on Base, and you get the
audit plus a settlement receipt. Five cents a call. The free tier at
`GET /api/score?url=…` gives the A–F grade and which checks failed; the payment
buys why each one failed and a paste-ready snippet for your own domain.

**The numbers, since that is why you clicked.** Thirty-day window, live for
eleven days, zero inbound links at the start:

- 4,672 requests. **7.19% are AI crawlers** (336 hits) — GPTBot, ClaudeBot and
  friends, up from 3.2% four days earlier. Another 787 are scripted clients that
  are not browsers and do not claim to be crawlers.
- 108 free scores served, 71 `llms.txt` fetches, 30 reads of the machine-readable
  payment terms at `/api/x402/info`.
- **45 hits on the paid endpoint. Six settlements, all six mine.** Not one
  agent that hit the 402 came back with a payment.

That last line is the finding. Agents are already crawling a site nobody links
to, they read the price, and they do not buy. Anyone selling you "the agentic
economy" should have to explain that gap; I can't yet.

Four things I did not expect:

**The spec and the installed base disagree, and building to the spec means
earning nothing.** x402 v2 uses CAIP-2 network ids, an `amount` field, and
`PAYMENT-SIGNATURE`. The reference client on npm still validates the 402 against
a v1 schema and *throws* — it wants `base-sepolia`, `maxAmountRequired`, and
sends `X-PAYMENT`. A spec-perfect v2-only endpoint is unpayable by the clients
most likely to call it. It now answers both from one 402: v2 in the header, v1
in the body. They can't be merged into one `accepts` array, because a v1 client
validates the whole array and rejects the response if a v2 entry appears in it.

**USDC does not use the same name on every chain, and the name is load-bearing.**
The `extra: {name, version}` you publish is the EIP-712 domain the payer signs
`transferWithAuthorization` against, so it must equal the token's own `name()`.
That's `"USDC"` on Base Sepolia and `"USD Coin"` on Base mainnet. Get it wrong
and the facilitator rejects every payment as an invalid signature, with nothing
pointing at a string as the cause. There is now a pre-flight script that reads
`name()`, `version()` and `decimals()` off chain and diffs them against the
config, because no unit test can catch this.

**The discovery layer is documented as an SDK call, not as a wire format — and
the SDK call is the only thing anyone will tell you.** Coinbase's Bazaar is the
catalog agents actually browse. Listing is described as automatic once you use
their facilitator. It isn't: the catalog entry is built from discovery metadata
attached to a *settlement*, so an endpoint can take real money indefinitely and
never appear. The docs describe `declareDiscoveryExtension()`, which is useless
if you didn't build on their SDK. So I read the wire format off the live catalog
instead — of its 1,795 x402 v1 resources, 1,698 carry `discoverable: true`
inside the v1 `outputSchema` field of their payment requirements, and the
metadata the catalog publishes for them is visibly derived from it. Publishing
that shape and settling a payment carrying it still hasn't produced a listing;
someone else has an open issue reporting the same thing after eight settlements
with the official SDK, unanswered.

**A Cloudflare Worker cannot fetch its own hostname, and the failure is
expensive.** After moving domains I kept the old host attached to the same
Worker. Auditing a URL on either of my own hostnames made the Worker fetch
itself, which Cloudflare answers with a 502 — *after* the payment had already
settled. Charge, then fail. Found it with real money. The fix is four lines that
rewrite any of our own aliases to the canonical host before fetching, and the
lesson is that the payment boundary and the work boundary need to fail in that
order.

The registry underneath it is the older idea: products register themselves with
no human steps — an agent reads llms.txt, builds a listing against the published
schema, and opens a GitHub issue. A workflow validates it and replies with live
URLs in about two minutes. GitHub issues turn out to be a good write API for
agents: every capable one already knows how to open one, auth is solved, and the
audit trail is public. It has had zero organic registrations, which belongs in
the same honest column as the zero organic payments.

Zero npm dependencies throughout: the payment gate, the EIP-712 handling, the
RFC 9421 response signing and the CDP JWT auth are hand-rolled on WebCrypto.
171 tests.

Repo: https://github.com/110kc3/seo — the whole protocol is in
https://index.percall.dev/llms.txt, the traffic is at
https://index.percall.dev/api/stats.json, and you can grade your own site for
free at https://index.percall.dev/.

---

## Before posting — checklist

- [x] **`/api/stats.json` publishes** — the numbers paragraph is the strongest
      thing in the post and it is live. Re-read it the morning you post and
      update the five figures; do not post stale ones.
- [x] **Settled payments exist**, so "an agent can pay this" is fact, not intent.
      Six, all self-paid — say so plainly rather than letting someone find it.
- [x] Duplicate hostnames retired: GitHub Pages off, `workers_dev = false`, and
      both `percall.dev` and the old `index.kc-it.pl` 308 to the canonical host.
- [ ] Re-read `/llms.txt` end to end — it is the second link everyone clicks.
- [ ] Check the two open awesome-list PRs (#11152, #114). If either merged,
      the "zero inbound links" claim needs softening to "one".
- [ ] Decide in advance whether you will name the unanswered upstream issue. It
      is fair and it is public, but it reads as a complaint if you lead with it.

## Timing

Tue–Thu, 14:00–16:00 UTC (US East morning). Reply fast for the first two hours;
on HN the comments are the post.

Expect three threads, and have the answer ready rather than improvising:

1. *"Is agentic payment real or a solution looking for a problem?"* — the honest
   answer with the traffic numbers is a better comment than a defence. You
   measured it and the answer was no. That is the post.
2. *"Why crypto instead of a card?"* — because a card needs a human to enrol and
   a five-cent card charge is uneconomic. Also say what the card rail costs you:
   Stripe's machine-payments product exists but is gated behind an access
   request.
3. *"Your audit is just a checklist."* — yes, and the weights are published, the
   free tier shows every check, and it grades its own site with the same code.
   The interesting artifact is the traffic data, not the checklist.

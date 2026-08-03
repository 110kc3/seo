# The second service — three candidates, and what the broker idea runs into

Written 2026-08-02, after Kamil asked to explore the liveness product, the
"402-gating as a service" product, and an idea of his own: **proxy other
people's x402 endpoints — verify they answer, route the request, take ~$0.005.**

This is reference material, not a queue. The decision it feeds sits in
[NEXT.md](../NEXT.md) §1.9.

---

## Decided 2026-08-02: the non-custodial one (C2), and it is a hard constraint

Kamil's words: *"I will not pay from my own wallet."* That is not a preference to
be honoured by policy — it is an invariant the code should make impossible to
violate, because a broker that can pay is a broker that can be tricked into
paying.

**It is already true, and this is why.** The Worker reads `X-PAYMENT` as a
receiver and never sends one; `worker/signing.js` holds an Ed25519 key for RFC
9421 response signatures, which cannot sign an EVM transaction. There is no
spending key in the deployment and no code path that attaches a payment header
to an outbound request. The only things in this repo that can pay are
`clients/pay_x402.*` (examples for callers) and `scripts/verify-rail.mjs` (a dev
script, never deployed).

So the build starts from a property that already holds, and the job is to pin it
before adding code that fetches other people's paid endpoints:

> **The router probes; it never pays.** No outbound request it makes may carry
> `X-PAYMENT` or `PAYMENT-SIGNATURE`, and the deployment holds no key that could
> produce one. A 402 is the *successful* outcome of a probe, not a failure to
> retry.

That invariant is also what makes the product cheap to run: **an unpaid probe
returns the endpoint's own 402, and a 402 carries its current terms.** Liveness
and pricing come back in the same free request. The expensive-sounding part of
this service costs nothing but the request.

### What it is, concretely

Free, and already shipped — the catalogs and their aggregate liveness. Cannot be
taken back and should not be: `/api/x402/search`, `/api/mcp/search`,
`/x402.html`, `/mcp-servers.html`, both `health.json` files.

Paid, and new — **freshness**, which is the one thing a caller cannot generate
for itself and an LLM cannot substitute for. That is the lesson of NEXT.md §7:
the audit's paid tier struggles because the free grade already answered the
question. A week-old aggregate does not answer "can I call this right now, and
what will it charge me".

1. `GET /api/liveness?url=…` — probe now, unpaid. Returns: answered / did not,
   status, latency, and the terms parsed out of the 402 (price, asset, network,
   `payTo`, scheme, x402 version). Authoritative because it comes from the
   endpoint rather than from the Bazaar's 30-day-stale record.
2. `POST /api/route` — the routing question. *"Something that does X, under
   $0.02, on Base"* → ranked candidates, each probed live, each with its current
   terms and the URL to call. **The caller then pays the endpoint directly.** No
   traffic passes through here, so nothing is misattributed and no operator's
   per-caller pricing or rate limit is broken.
3. Both as MCP tools, alongside the six that exist.

### Built 2026-08-02

`worker/route.js`, wired into the existing Worker rather than a second one — one
deploy, one signing key, one agent card, and both catalogs are already loaded
there. A subdomain is a dashboard action later, if it earns its own identity.

| route | price | what it does |
|---|---|---|
| `GET /api/liveness?url=…` | $0.005 | Probes one endpoint now: answered or not, latency, and the terms parsed out of its 402 — either x402 version, or both if it offers both. |
| `POST /api/route` | $0.005 | `{"q": "unit conversion", "max_price": 0.01}` → ranked candidates, each probed live, each with its current terms and the URL to call. |

Decisions inside it worth keeping:

- **A query that matches nothing is free.** The gate is only reached once the
  catalog has found candidates. Charging for an empty result set is charging for
  a 404.
- **Dead endpoints are reported, not dropped.** The caller asked what exists;
  returning three of five silently misrepresents the network they are trying to
  use. Alive ranks first, then the cheapest live quote, then catalog relevance.
- **`alive` means the host answered at all** — a 402 is the *successful* outcome,
  and so is a 405 from probing a POST-only endpoint with GET. A 200 from an
  unpaid probe of a paid endpoint means its paywall is broken, which is also
  worth knowing.
- **An unknown asset reports atomic units and no price.** Dividing by an assumed
  10^6 is how a caller reads $0.05 as $50. Decimals come from the assets in
  `site.config.json`; anything else gets `price: null` and the exact string the
  endpoint sent.
- **Our own hosts are answered from configuration, never fetched.** A Worker
  cannot fetch its own hostnames — Cloudflare answers 522, which this codebase
  has paid for twice (`score.js` `canonicalTarget`). Our terms are a thing we
  know, so probing them is a lookup.
- **Probes are shared for 60 seconds through KV.** The cache exists to be kind to
  the endpoint being probed, not to be fast for us — and a courtesy cache that
  can take the feature down with it is worse than none, so a KV failure falls
  through to a live probe.
- **No MCP tools for these, deliberately.** The six existing tools are free, and
  MCP has no payment channel here: a tool that can only answer "pay me over
  HTTP first" is worse than no tool. Revisit if MCP grows one.

The invariant has three tests, and the third is structural: no module under
`worker/` may set an outbound payment header, so a future change that adds a
paying code path has to come and delete that test on purpose.

### Per-endpoint history — built 2026-08-02

Every answer now carries the endpoint's record: total probes, how many answered,
consecutive failures, and how many of the last 30 observations answered.

**The weekly cron cannot be the source, and it is worth writing down why.**
`scripts/probe-catalogs.mjs` walks a rotating slice of 600 per catalog, so a full
pass over 14,661 x402 endpoints takes ~24 weeks and any one endpoint is seen
roughly twice a year. It also stores only the failures. That is the right design
for *"what share of the catalog is dead"* and the wrong one for *"is this
endpoint reliable"*.

So history is fed by the live probes instead. They are free — the 402 is the
answer — and they land on exactly the endpoints somebody cared enough to pay to
ask about. **The paid answer gets better the more the service is used**, which is
the right way round for a product whose value is accumulated observation.

Three decisions inside it:

- **A cache hit is not an observation.** Otherwise one real request lets a
  popular endpoint accumulate a flattering record all day, which is the opposite
  of what the number is for.
- **No uptime ratio below three observations.** "Answered 1 of 1" is technically
  true and practically a lie, and a caller comparing two endpoints will compare
  those numbers whatever the sample size. The counts are published, the ratio is
  withheld, and the response says why in a `note`.
- **KV, not a committed file.** The Worker cannot commit, and a 24,741-entry
  history rewritten weekly would be a megabyte of git churn for data that changes
  by the minute. Records expire after 180 days, so endpoints nobody asks about
  again do not accumulate forever.

### Verified with real money, 2026-08-02

`clients/pay_liveness.mjs both`, paid from the test payer
`0xC8b3424936Af77D8684fa2f78391Fc7c0f3387D4`. **$0.010000 exactly** left that
wallet and arrived at the receiving address — two settlements of $0.005, both
HTTP 200 with a receipt header, on Base mainnet through the CDP facilitator.

This was worth spending, because four things could only be true or false in
production:

1. **A paid GET settles.** Every prior settlement on this rail bought a POST
   `/api/audit`. A GET carries its parameters in the resource URL of the
   challenge, which is a different string through the payment layer, and §4.4 is
   this repo's standing reminder that green tests and a working deploy can still
   sit on top of a runtime divergence.
2. **We can read a 402 we did not write.** Every fixture in the test suite was
   written by me from our own implementation. Against real endpoints:
   `2s.io` quoted **four** accepted options in one challenge — more than any
   fixture — and three independent currency-conversion endpoints each parsed
   cleanly, with the right `payTo`, `asset_name` and decimals.
3. **Live quotes agreed with the catalog** where both existed
   (`x402currencyconvert` catalogued at $0.002, quoted 2000 atomic). The
   endpoint's value is in showing when they *disagree*, and it can now be
   believed when they do not.
4. **History recorded its first real observations**, and correctly withheld the
   uptime ratio at one probe rather than publishing "1 of 1".

Product note from the same run: all three routed candidates were alive and
paywalled, so the routing answer was genuinely useful on its first real query
rather than a list of dead links — which is the outcome the catalog's 97.2%
liveness figure predicted but had never demonstrated end to end.

Payer gas was zero, and that is not luck: EIP-3009 authorizations are gasless for
the signer, and the facilitator submits. The payer wallet holds no ETH at all.

### Still to build

- ~~**The monitoring product on top.**~~ **Built 2026-08-03** — `POST /api/watch`
  buys N weekly sweeps of one endpoint and POSTs a webhook when the state
  changes. Three decisions in `worker/watch.js` worth knowing: it is **prepaid
  credits, not a subscription**, because x402 has no recurring billing and a
  stored mandate to charge later is custody by another name; **the payer address
  from the settlement owns the watch**, so there is no account to create and a
  body claiming a different owner is ignored; and **alerts are edges, not
  levels** — a webhook on every failing sweep is a mailing list nobody reads.
  The sweep runs from the weekly health workflow rather than a Cloudflare cron
  trigger, because `wrangler deploy` applies triggers as one phase and a trigger
  it cannot apply takes the whole deployment down, which has happened here once.
- ~~**A human page.**~~ Shipped as `/router.html`, and since 2026-08-03 linked
  from the index homepage too — it had been reachable only from the apex and the
  discovery hub, which are not where the traffic is.
- **Per-host probe concurrency.** The fan-out is capped at 5 candidates and
  cached for 60s, which is enough while the catalog search rarely returns five
  URLs on one host. It stops being enough if routing gets popular.

---

## The constraint that shapes all three

**An x402 payment is bound to its payee.** The caller signs an EIP-3009
`transferWithAuthorization` naming `to`, `value`, validity window and nonce, and
this site's own verifier refuses anything else — `worker/x402.js:275` rejects the
payload unless `auth.to` equals our `payTo`. Every other correct implementation
does the same, because not doing it is how a client pays 1 atomic unit to the
wrong address.

So a signed authorization made out to a broker **cannot be forwarded upstream**.
There is no pass-through. A broker is a merchant of record: collect from the
caller, then pay upstream from its own wallet, as two separate settlements.

That single fact is what separates the candidates below.

---

## A. Liveness as a product

**What exists already:** 14,661 x402 endpoints and 10,080 MCP servers, probed on
a weekly rotating sample, published as `api/*/health.json` and rendered on
`/x402.html` and `/mcp-servers.html`. Current readings: 97.2% and 91.9%.

**Why it is the strongest asset here.** The x402 Bazaar keeps an entry for 30
days after its last settlement, so "listed" and "answers" are different facts and
only one of them is published anywhere. Probing an x402 endpoint is also
*free by construction*: the 402 challenge **is** the response, so liveness
costs a request and no money. MCP servers answer `initialize` the same way.

**Buyers, in order of how plausible they are:**

1. An operator watching their own endpoint — the clearest willingness to pay,
   and the same buyer as the monitoring product in NEXT.md §7.
2. An agent framework picking between endpoints at call time.
3. A researcher wanting the time series. Probably wants it free.

**Cost of building:** the probe already runs. The new parts are per-endpoint
history, a webhook, and an alert. Days, not weeks.

## B. 402 gating as a service

**What it is:** let someone put their existing API behind x402 without
implementing it.

**Non-custodial version** — issue the 402 challenge, verify settlement to *their*
address, let their origin serve the response. No custody, no float, legally
clean. Revenue is a flat fee or a per-call charge billed separately.

**Why it is the weakest of the three anyway:**

- **Cloudflare is building it.** The Monetization Gateway (waitlist, NEXT.md
  §1.7) is the same product, from the platform this site already runs on, sold
  by the party that terminates the TLS. Competing there means renting the moat
  from the competitor.
- **The SDK is an afternoon.** Anyone who can operate an endpoint can add
  `x402-express` or the Worker equivalent. This site did. The thing that took
  three weeks here was not the gate, it was the *facilitator relationship,
  replay protection and receipts* — and a hosted gate does not remove those from
  the customer's mind, it just moves them.
- The genuinely hard, genuinely valuable role in that stack is **facilitator**
  (verify + settle). That is Coinbase CDP and PayAI. Different bar entirely.

## C. The broker — Kamil's idea

Two versions, and the difference between them is the whole analysis.

### C1. Custodial: collect from the caller, pay upstream, keep the spread

**Mechanically it works, and it is a real business.** But per the constraint
above it is two settlements, not one, and it means:

- **Float and ordering.** Collect first, always. A broker that pays upstream
  before the caller's settlement confirms is drainable in a loop, and the loop
  is cheap for the attacker.
- **Failure liability.** Upstream takes the money and returns a 500 — the caller
  paid the broker, so the refund is the broker's problem. Every refund is an
  on-chain transfer and a support conversation, on a $0.005 margin.
- **Custody.** Taking USDC and forwarding it on someone's behalf is a payment
  intermediary. In the EU that is plausibly a CASP under MiCA ("transfer services
  for crypto-assets on behalf of clients"), which is an authorization, not a
  checkbox. **This needs a qualified opinion before any code is written** — I am
  flagging it, not answering it. It is the single largest cost in C1 and it is
  not an engineering cost.
- **Consent.** Proxying someone's paid endpoint is a bigger version of the thing
  already declined in NEXT.md §2b: 24,741 per-endpoint pages were refused because
  the removal requests were inevitable. Routing *paid traffic* through a
  middleman the operator never agreed to is more invasive than listing them.
  Upstream sees the broker's wallet and IP, not the caller's, which breaks
  per-caller pricing and rate limits for them.

**The economics are thin where the catalog actually lives.** $0.005 against the
catalog median of $0.014 is a **36% take rate**. Against this site's own $0.05 it
is 10%. A flat fee is regressive exactly where the volume is, and the volume is
where the fee hurts most.

**And the volume is the real problem.** `/report.html` measures 49 hits on the
paid endpoint and **zero organic payments, ever**; `scripts/bazaar-check.mjs`
finds nothing paying our address across 14,794 catalog entries. A commission on
a transaction flow that is currently ~zero is ~zero. C1 is a bet that the
category grows, not a bet on measurable demand — which can be the right bet, but
it should be made with open eyes and after the Show HN, not before it.

### C2. Non-custodial: route the request, sell the routing

Return the upstream's **own** 402 to the caller — untouched, so the caller pays
upstream directly and the broker never touches funds. Charge for the part that is
actually scarce: *which endpoint, is it alive, what does it cost, here are its
terms*.

This drops every problem in C1 — no float, no refunds, no custody, no MiCA
question, no misattributed traffic — and keeps the part nobody else has, because
it is the liveness data from **A**. It also composes: "give me a live endpoint
that does X under $0.02, with its current terms" is one paid call, and answering
it well needs the catalog plus the probe, which is exactly what already exists.

The honest weakness: it sells a lookup, not a transaction, so it cannot earn a
percentage of a growing payment volume. It earns per question asked.

---

## Recommendation

**A and C2 are one product; build that one.** Liveness is the input, routing is
the interface, and neither needs a wallet, a licence or anyone's consent to
proxy. It is also the only option that turns the site's existing weekly probe
into something someone can buy.

**C1 stays on the shelf** until a real caller asks to be brokered *and* the
custody question has a real answer. It is not a bad idea; it is an idea whose
cheapest version should be proven first, and C2 is that version.

**B is a pass.** Cloudflare is shipping it, the SDK undercuts it, and the hard
part of that stack is a role this project should not want.

One caveat over all of it, from this project's own data: **no agent has ever paid
for anything here.** The Show HN on ~25 Aug is the first experiment that puts a
population with wallets in front of a paid endpoint. A second service built
before that reading is inventory built against an unmeasured demand — with the
exception of A, which is cheap, already half-built, and attacks the specific
reason NEXT.md §7 believes the paid tier is not selling.

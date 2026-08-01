---
name: find-a-paid-api
description: Search ~14,700 x402-payable HTTP endpoints by capability, chain, host and maximum price. Use when an agent needs an API it can pay for per call with USDC, wants to know what a call costs before making it, or is looking for machine-payable data sources.
---

# Find a paid API you can call with x402

`https://index.percall.dev` mirrors the Coinbase CDP x402 Bazaar and makes it searchable.
Upstream offers offset paging and no query, so "is there an x402 endpoint that
does X, and what does it cost" otherwise means pulling ~15k records yourself.

## Search

```
GET https://index.percall.dev/api/x402/search?q=weather&max_price=0.01
```

| parameter | meaning |
|---|---|
| `q` | what the endpoint should do — "weather forecast", "token price" |
| `chain` | restrict to a chain: `base`, `solana`, `polygon`, … |
| `method` | restrict to an HTTP method |
| `host` | substring match on hostname |
| `max_price` | maximum USD per call |
| `limit` | results to return |

Ranked by relevance, then **cheapest first** — on a pay-per-call rail that is
the tiebreak that matters.

Full catalog: `https://index.percall.dev/api/x402/catalog.json`.
Aggregates — price percentiles, chains, host concentration:
`https://index.percall.dev/api/x402/stats.json`.

## Two things that will mislead you if you do not know them

**An unpriced endpoint is excluded by `max_price`, not sorted as free.** Prices
are computed only for assets whose decimals are known; guessing 6 would print a
number wrong by orders of magnitude. So an endpoint priced in an unrecognised
token has an *unknown* price, and a price filter excludes it rather than
pretending it costs nothing.

**Some of these are dead.** The Bazaar keeps an entry for 30 days after its last
settlement, so listings outlive the service. A rotating sample is probed weekly
and results published at `https://index.percall.dev/api/x402/health.json`; a result confirmed
unreachable twice running carries `"unreachable": true`. It is still returned —
one weekly probe from one network path is evidence, not proof — so treat the
flag as a reason to have a fallback, not as a reason to skip it.

## Then what

The endpoint answers HTTP 402 with payment terms. Pay with any x402 client
(`x402-fetch` and similar) and retry. The catalog tells you what exists and what
it costs; it does not proxy the call or take a cut.

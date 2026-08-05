# Selling the audit on Clustly

**What this is.** A second sales channel for the deliverable this repo already
produces, on a marketplace where the buyer arrives with money already escrowed.
The code is `scripts/clustly-agent.mjs` (the loop) and
`scripts/clustly-report.mjs` (the deliverable); the listing is
`clustly/listing.json`.

**What it is technically.** Clustly ([clustly.ai](https://www.clustly.ai)) is a
USDC-escrow marketplace on Solana: a buyer funds an escrow, an agent enrolls and
submits a deliverable, and the buyer's signature releases the funds. This repo
sells the agent-readability audit there as a job, alongside selling it per call
over x402.

> **This repo is public.** The commercial half of this decision — why this
> channel, the market sizing, the comparable listings, the pricing call and when
> to change it, and the custody trade-off — lives in the vault at
> `40-projects/x402-scale-up/clustly.md`. What follows is the runbook.

---

## 1. What Kamil has to do — the browser half

Nothing here can be done from a terminal; all of it is one sitting.

### 1.1 Register the operator and the agent

1. Open <https://www.clustly.ai/operator> and register. This provisions a managed
   Privy server wallet and returns an API key `clk_…`.
2. **The key is shown once.** Copy it straight into the Pi (step 2.1 below). It
   is hashed at rest; if it is lost, regenerate from the console — that
   immediately revokes the old one.

> **Custody caveat, so it is a decision and not a surprise.** All Clustly agents
> are *managed*: Clustly holds the signing wallet under a no-theft policy whose
> only outbound destination is your own operator treasury. Self-custody is not
> offered. This is a step away from the self-custodial Base address the x402 rail
> pays into (`site.config.json` → `x402_address`). It is receive-side only and
> touches no key in this repo, so it does not violate "the router probes; it
> never pays" — but earnings do sit with a third party until swept.

### 1.2 Publish the listing

Enter `clustly/listing.json` into the console's new-listing form. The fields map
one-to-one; the `_`-prefixed keys are commentary and are not part of the payload.

Two fields could not be verified from outside and the console is authoritative:

- **`category`** — set to `research`; pick whichever of the console's own
  categories fits and correct the file to match.
- **`input_schema.fields[0].type`** — set to `text`. If the console offers a
  dedicated URL type, use it. Either works: the agent promotes a bare
  `example.com` to `https://` and then validates it with the same `urlError()`
  the public endpoints use.

**Do not reword `default_criteria` without changing the generator.** That text is
sha256'd into the order's on-chain `criteria_hash` at hire and neither side can
move it afterwards. It is a specification, not marketing copy —
`scripts/clustly-report.test.mjs` asserts the report still delivers every line of
it, and that test is what stops the listing promising something the agent cannot
produce.

### 1.3 Sweep earnings when there are some

Earnings accrue to the agent's wallet as jobs are approved. The console's
**sweep** moves the balance to your operator treasury; the signing policy pins
the destination, so a sweep can only ever pay you.

---

## 2. Running the agent on the Pi

### 2.1 The key

```bash
sudo install -m 600 /dev/null /etc/clustly-agent.env
sudo tee /etc/clustly-agent.env >/dev/null <<'EOF'
CLUSTLY_API_KEY=clk_paste_it_here
EOF
```

Not in the repo, not in `site.config.json`, and 0600 because it is a bearer
token that can accept jobs and submit work as this agent.

### 2.2 See the deliverable before anyone is charged for it

No key needed — this path never touches the marketplace:

```bash
node scripts/clustly-agent.mjs --dry-run --url https://example.com
```

That prints the exact markdown a buyer receives. Run it against a real prospect's
site before publishing the listing, and read it as they would.

### 2.3 One pass, then exit

```bash
sudo -u borg CLUSTLY_API_KEY=clk_… node scripts/clustly-agent.mjs --once
```

Useful for the first live order and for cron. Logs go to stderr.

### 2.4 As a service

```ini
# /etc/systemd/system/clustly-agent.service
[Unit]
Description=Clustly seller agent — agent-readability audits
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=borg
WorkingDirectory=/home/borg/repos/seo
EnvironmentFile=/etc/clustly-agent.env
Environment=CLUSTLY_STATE=/home/borg/repos/seo/.clustly-state.json
ExecStart=/usr/bin/node scripts/clustly-agent.mjs
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now clustly-agent
journalctl -u clustly-agent -f
```

**The SLA is why this wants to be a service rather than a cron job.** The listing
commits to 24 hours; enrolling and then missing that is scored against the agent
on chain as abandonment. `Restart=always` plus a 24-hour margin means a reboot or
a dead uplink costs nothing. The work itself takes about a minute.

---

## 3. How it behaves

**The ledger** (`.clustly-state.json`, gitignored) records which units of work
have been started and finished, and survives restarts. A unit is an order for a
first delivery and `<order_id>#r<n>` for revision round *n* — keyed that way
because a revision is a second unit on the same order, and keying by order alone
would make every revision look already-handled.

**It refuses rather than risks.** Three cases end with the order left
un-accepted, logged loudly, and the buyer auto-refunded after 48 hours:

- the criteria do not hash to the on-chain `criteria_hash` (the terms shown to us
  are not the terms committed);
- the order carries no usable URL;
- the URL is private, local, or otherwise fails `urlError()`.

Refusing costs a sale. Accepting and then not delivering costs on-chain
reputation, which is the thing that is hard to get back.

**Revisions are handled, and re-audit rather than reprint.** A change request
puts the order back to `enrolled` with `needs_rework` — a status the vendor's own
`clustly run` daemon never polls, which is the main reason this repo does not use
it. For this product a revision usually means "I applied your fixes, look again",
and a fresh audit answers that. The buyer's feedback is verified against
`reject_reason_hash` first, on the same reasoning as the criteria.

**Failures back off and then give up.** Five attempts with exponential backoff
capped at five minutes, then the order is abandoned with a `GIVING UP` line in
the log. That line is the only thing that brings a human, so it is worth alerting
on.

**What is not automated:** disputes (`/orders/{id}/dispute-response`) and sweeps.
Both are rare, both are the operator's call, and both are in the console.

---

## 4. Watch these

- `journalctl -u clustly-agent | grep -E 'REFUSING|GIVING UP'` — the two lines
  that mean a human is needed.
- A revision request is a signal about the deliverable, not just an order state.
  The first one is worth reading in full before touching the generator.
- Whether anything sells, and what to do about it either way, is tracked in the
  vault note rather than here.

#!/usr/bin/env node
// The Clustly seller agent — polls for hires, runs the audit, delivers the report.
//
// Clustly (clustly.ai) is a USDC-escrow marketplace on Solana where buyers hire
// agents: the buyer funds an escrow, the agent enrolls and submits, the buyer's
// signature releases the money. It is the opposite shape to the x402 endpoint
// this repo already sells — there, a caller must arrive already holding a funded
// wallet and a reason, and across 49 encounters with the paywall none ever did.
// Here the buyer arrives with money already escrowed and a human intent to spend
// it. Same deliverable, a channel that starts on the other side of the problem.
//
// WHY THIS IS NOT `npx @clustly/agent run --exec …`, which their docs recommend:
//
//   1. Their daemon polls `awaiting_acceptance` only. A buyer gets two revision
//      rounds, and a change request puts the order back to `enrolled` with
//      `needs_rework` — a status that daemon never looks at. Ignoring revisions
//      means the third request auto-refunds the buyer and the agent wears the
//      abandonment. Revisions are handled here, in `sweepRework()`.
//   2. `npx -y` resolves and executes the latest published version on every run.
//      This repo has no runtime dependencies anywhere else and does not start
//      here — the REST surface is four calls.
//
// The correctness rules are theirs and are not negotiable; they are restated at
// each site below: accept BEFORE working, persist the ledger BEFORE any side
// effect, and key every write with an idempotency key so a retry after a
// timeout cannot double-submit.
//
// Usage:
//   CLUSTLY_API_KEY=clk_… node scripts/clustly-agent.mjs            # poll forever
//   CLUSTLY_API_KEY=clk_… node scripts/clustly-agent.mjs --once     # one pass, exit
//   node scripts/clustly-agent.mjs --dry-run --url https://x.dev    # print a report, no key needed

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { urlError } from './validate.mjs';
import { buildReport } from './clustly-report.mjs';

const API_BASE = (process.env.CLUSTLY_BASE_URL ?? 'https://clustly-v2.vercel.app/v1').replace(/\/+$/, '');
const INDEX_BASE = (process.env.INDEX_BASE ?? 'https://index.percall.dev').replace(/\/+$/, '');
const STATE_PATH = process.env.CLUSTLY_STATE ?? '.clustly-state.json';
const POLL_MS = Number(process.env.CLUSTLY_INTERVAL_MS ?? 30_000);
const MAX_ATTEMPTS = 5;

const log = (...a) => console.error(`[clustly ${new Date().toISOString()}]`, ...a);

// --- criteria commitment ---------------------------------------------------

/**
 * Canonicalisation for the criteria and reject-reason hashes.
 *
 * Byte-identical to `ClustlyAgent.canonicalize` (CRLF→LF, collapse runs of
 * spaces/tabs per line, trim, drop blank lines, join with LF). If this drifts by
 * one character the hash stops matching what is committed on chain and the agent
 * refuses every job — which is the safe direction to fail, but still a failure.
 */
const canonicalize = (text) => String(text)
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line.replace(/[ \t]+/g, ' ').trim())
  .filter((line) => line.length > 0)
  .join('\n');

export const criteriaHash = (text) => createHash('sha256').update(canonicalize(text), 'utf8').digest('hex');

/** True iff `text` is what was committed on chain. Tolerates a 0x prefix and case. */
export const hashMatches = (text, onchainHex) =>
  typeof onchainHex === 'string' && criteriaHash(text) === onchainHex.replace(/^0x/, '').toLowerCase();

// --- the ledger ------------------------------------------------------------

/**
 * Which units of work have been started or finished, across restarts.
 *
 * Keyed by *unit*, not by order: a revision is a second unit on the same order
 * (`<order_id>#r2`), so marking the first delivery done must not make the
 * revision look already-handled. Getting this wrong is silent — the order sits
 * enrolled, the buyer waits, and the agent thinks it is finished.
 *
 * Atomic write (temp file + rename) so a crash mid-write cannot leave a corrupt
 * ledger; a corrupt one is read as empty, whose worst case is re-doing work that
 * the server's idempotency keys then de-duplicate.
 */
class Ledger {
  constructor(path) {
    this.path = path;
    this.active = new Set();
    this.done = new Set();
    this.failures = new Map();
    this.retryAt = new Map();
    if (existsSync(path)) {
      try {
        const s = JSON.parse(readFileSync(path, 'utf8'));
        // Anything left `active` was interrupted mid-job — keep it active so it
        // resumes rather than being silently dropped.
        this.active = new Set(s.active ?? []);
        this.done = new Set(s.done ?? []);
        this.failures = new Map(Object.entries(s.failures ?? {}));
        this.retryAt = new Map(Object.entries(s.retryAt ?? {}));
      } catch {
        log(`ledger at ${path} unreadable — starting clean`);
      }
    }
  }

  persist() {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({
      active: [...this.active],
      done: [...this.done],
      failures: Object.fromEntries(this.failures),
      retryAt: Object.fromEntries(this.retryAt),
    }));
    renameSync(tmp, this.path);
  }

  seen(id) { return this.active.has(id) || this.done.has(id); }
  ready(id, now) { return (this.retryAt.get(id) ?? 0) <= now; }
  start(id) { this.active.add(id); this.persist(); }
  finish(id) {
    this.active.delete(id); this.done.add(id);
    this.failures.delete(id); this.retryAt.delete(id);
    this.persist();
  }

  /** Records a failure and returns the attempt count. Backs off exponentially, capped at 5 min. */
  fail(id, now) {
    const n = (this.failures.get(id) ?? 0) + 1;
    this.failures.set(id, n);
    this.active.delete(id);
    if (n >= MAX_ATTEMPTS) {
      // Give up rather than tight-loop forever. `done` is the abandon marker —
      // it stops the retry; the log line is what brings a human.
      this.done.add(id);
      log(`GIVING UP on ${id} after ${n} attempts — needs a human`);
    } else {
      this.retryAt.set(id, now + Math.min(2000 * 2 ** (n - 1), 5 * 60_000));
    }
    this.persist();
    return n;
  }
}

// --- the Clustly REST surface ----------------------------------------------

class Clustly {
  constructor(apiKey, base = API_BASE, fetchImpl = fetch) {
    this.apiKey = apiKey;
    this.base = base;
    this.f = fetchImpl;
  }

  async req(path, { method = 'GET', body, idempotencyKey } = {}) {
    const headers = { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' };
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    const res = await this.f(`${this.base}${path}`, { method, headers, body });
    const parsed = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`clustly ${method} ${path} → ${res.status} ${parsed.error ?? ''} ${parsed.message ?? res.statusText}`.trim());
    }
    return parsed;
  }

  listOrders(status = 'awaiting_acceptance') {
    return this.req(`/orders?status=${encodeURIComponent(status)}`);
  }

  /** Enroll on a hire. 202 — enrollment is chain-authoritative and settles asynchronously. */
  accept(orderId) {
    return this.req(`/orders/${orderId}/accept`, { method: 'POST', idempotencyKey: orderId });
  }

  /**
   * Upload the deliverable to Clustly's private bucket; returns the ref and the
   * server-computed hash to submit. Multipart, so `content-type` is left to
   * fetch — setting it by hand omits the boundary and the upload 400s.
   */
  async upload(orderId, content, filename) {
    const form = new FormData();
    form.append('file', new Blob([content], { type: 'text/markdown' }), filename);
    const res = await this.f(`${this.base}/orders/${orderId}/deliverable`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    const parsed = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`clustly upload → ${res.status} ${parsed.message ?? res.statusText}`);
    return { deliverable_ref: String(parsed.deliverable_ref), deliverable_hash: String(parsed.deliverable_hash) };
  }

  submit(orderId, deliverable, idempotencyKey) {
    return this.req(`/orders/${orderId}/submit`, {
      method: 'POST',
      body: JSON.stringify(deliverable),
      idempotencyKey,
    });
  }
}

// --- the work --------------------------------------------------------------

const URL_KEYS = ['url', 'site', 'site_url', 'website', 'domain', 'target', 'target_url'];

/**
 * The URL to audit, out of whatever the buyer typed into the listing's form.
 *
 * A bare host is accepted and promoted to https:// — "example.com" is what a
 * human types into a field labelled "your website", and refusing it would burn a
 * paid order on a scheme. Everything then goes through `urlError`, the same
 * validator the public endpoints use, so a private or local host is refused
 * here exactly as it would be there.
 */
export function targetFrom(inputs) {
  if (!inputs || typeof inputs !== 'object') return { error: 'no inputs on the order' };
  const key = URL_KEYS.find((k) => typeof inputs[k] === 'string' && inputs[k].trim());
  if (!key) return { error: `no URL in the order inputs (looked for: ${URL_KEYS.join(', ')})` };
  let raw = inputs[key].trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  const err = urlError(raw, 'url');
  return err ? { error: err } : { url: raw };
}

/** The free grade for one URL, from our own deployment. */
async function scoreOf(url, fetchImpl = fetch) {
  const res = await fetchImpl(`${INDEX_BASE}/api/score?url=${encodeURIComponent(url)}`, {
    headers: { accept: 'application/json', 'user-agent': 'clustly-seller-agent (+https://index.percall.dev/llms.txt)' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(`score ${url} → ${res.status} ${body.code ?? ''} ${body.error ?? ''}`.trim());
  }
  return body;
}

/** Audit the target and render the deliverable. Separated so `--dry-run` can call it alone. */
export async function produce(url, { orderId, rerunOf } = {}, fetchImpl = fetch) {
  const score = await scoreOf(url, fetchImpl);
  return {
    score,
    markdown: buildReport(score, { base: INDEX_BASE, orderId, rerunOf }),
  };
}

const filenameFor = (url) => {
  const host = (() => { try { return new URL(url).host; } catch { return 'site'; } })();
  return `agent-readability-audit-${host.replace(/[^a-z0-9.-]/gi, '-')}.md`;
};

/**
 * One order, start to delivered.
 *
 * `unit` is the ledger key: the order id for a first delivery, `#r<n>` for a
 * revision. `idem` is what the server de-duplicates on and must be distinct per
 * round for the same reason — reusing the first submission's key on a revision
 * would have the server treat the new report as a replay and drop it.
 */
async function deliver(api, order, { unit, idem, rework = false }) {
  const { url, error } = targetFrom(order.inputs);
  if (error) throw new Error(`unusable inputs: ${error}`);

  log(`${unit}: auditing ${url}`);
  const { score, markdown } = await produce(url, {
    orderId: order.order_id,
    rerunOf: rework ? order.last_submitted_at ?? order.created_at : undefined,
  });
  log(`${unit}: ${score.letter ?? '?'} ${score.score}/100, ${markdown.length} bytes`);

  const uploaded = await api.upload(order.order_id, markdown, filenameFor(url));
  await api.submit(order.order_id, uploaded, idem);
  log(`${unit}: submitted`);
}

// --- the loop --------------------------------------------------------------

/**
 * Fresh hires. Accept FIRST, then work.
 *
 * The order stays `awaiting_acceptance` until the indexer sees the enrollment
 * event, so working-then-accepting would let the next poll see the same order
 * and do it twice. Accepting first moves it off the polled status immediately.
 */
async function sweepHires(api, ledger, now) {
  const orders = await api.listOrders('awaiting_acceptance');
  for (const order of orders) {
    const unit = order.order_id;
    if (ledger.seen(unit) || !ledger.ready(unit, now())) continue;

    // Verified BEFORE enrolling. A mismatch means the criteria shown to us are
    // not the ones committed on chain — the buyer could hold us to terms we
    // never read. Their docs are explicit that the correct response is to
    // refuse, and refusing before accepting also leaves the buyer refundable.
    if (!hashMatches(order.criteria ?? '', order.criteria_hash ?? '')) {
      log(`REFUSING ${unit}: criteria_hash mismatch — not enrolling`);
      ledger.finish(unit);
      continue;
    }

    // Checked before enrolling too: an order whose inputs carry no usable URL
    // cannot be delivered, and enrolling on it would convert "buyer is refunded
    // in 48h" into "agent enrolled and ghosted", which costs on-chain
    // reputation. Left un-accepted and logged loudly for a human instead.
    const { error } = targetFrom(order.inputs);
    if (error) {
      log(`REFUSING ${unit}: ${error} — not enrolling, buyer auto-refunds in 48h`);
      ledger.finish(unit);
      continue;
    }

    ledger.start(unit); // persisted before any side effect
    try {
      await api.accept(order.order_id);
      await deliver(api, order, { unit, idem: order.order_id });
      ledger.finish(unit);
    } catch (err) {
      log(`${unit}: ${err.message}`);
      ledger.fail(unit, now());
    }
  }
}

/**
 * Revision requests — the path the vendor's own daemon does not cover.
 *
 * A rejected delivery reverts the order to `enrolled` and sets `needs_rework`,
 * which is indistinguishable from a fresh enrollment except for that flag. The
 * buyer's feedback is committed on chain as `reject_reason_hash` for the same
 * reason the criteria are, so it gets the same treatment: verify before acting.
 *
 * Re-auditing rather than re-rendering is deliberate and is usually what was
 * actually wanted — for this product a revision most often means "I applied your
 * fixes, check again", and a fresh audit answers that. It also means a buyer who
 * rejected for a different reason gets current data rather than a reprint.
 */
async function sweepRework(api, ledger, now) {
  const orders = await api.listOrders('enrolled');
  for (const order of orders) {
    if (!order.needs_rework) continue;
    const round = order.rejection_round ?? 1;
    const unit = `${order.order_id}#r${round}`;
    if (ledger.seen(unit) || !ledger.ready(unit, now())) continue;

    if (order.reject_reason && order.reject_reason_hash
      && !hashMatches(order.reject_reason, order.reject_reason_hash)) {
      log(`REFUSING ${unit}: reject_reason_hash mismatch — feedback altered after commitment`);
      ledger.finish(unit);
      continue;
    }

    log(`${unit}: revision requested — ${String(order.reject_reason ?? '(no reason given)').slice(0, 200)}`);
    ledger.start(unit);
    try {
      await deliver(api, order, { unit, idem: unit, rework: true });
      ledger.finish(unit);
    } catch (err) {
      log(`${unit}: ${err.message}`);
      ledger.fail(unit, now());
    }
  }
}

/** One full pass. Exported so a test can drive it with a fake API. */
export async function tick(api, ledger, now = Date.now) {
  await sweepHires(api, ledger, now);
  await sweepRework(api, ledger, now);
}

// --- entry point -----------------------------------------------------------

async function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? '') : null;
  };

  if (argv.includes('--dry-run')) {
    // No key, no marketplace, no order — just the deliverable, on stdout, so the
    // thing being sold can be read before anyone is charged for it.
    const url = flag('--url');
    if (!url) { console.error('usage: --dry-run --url https://example.com'); process.exit(2); }
    const err = urlError(url, 'url');
    if (err) { console.error(err); process.exit(2); }
    const { markdown } = await produce(url, { orderId: 'dry-run' });
    process.stdout.write(markdown);
    return;
  }

  const key = process.env.CLUSTLY_API_KEY;
  if (!key) {
    console.error('CLUSTLY_API_KEY is not set. Get one from the operator console at https://www.clustly.ai/operator');
    console.error('(or run with --dry-run --url https://example.com to see the deliverable without one)');
    process.exit(2);
  }

  const api = new Clustly(key);
  const ledger = new Ledger(flag('--state') ?? STATE_PATH);
  const once = argv.includes('--once');
  const interval = Number(flag('--interval') ?? POLL_MS);

  log(`polling ${API_BASE} every ${interval}ms · auditing via ${INDEX_BASE} · state ${ledger.path}`);
  for (;;) {
    try {
      await tick(api, ledger);
    } catch (err) {
      // A failed poll must not kill the daemon — the marketplace being briefly
      // unreachable is the ordinary case, and an agent that exits on it stops
      // earning until someone notices.
      log(`poll failed: ${err.message}`);
    }
    if (once) return;
    await new Promise((r) => setTimeout(r, interval));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err) => { log(err.stack ?? err.message); process.exit(1); });
}

export { Clustly, Ledger, sweepHires, sweepRework };

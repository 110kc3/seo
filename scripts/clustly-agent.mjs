#!/usr/bin/env node

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


const canonicalize = (text) => String(text)
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line.replace(/[ \t]+/g, ' ').trim())
  .filter((line) => line.length > 0)
  .join('\n');

export const criteriaHash = (text) => createHash('sha256').update(canonicalize(text), 'utf8').digest('hex');

export const hashMatches = (text, onchainHex) =>
  typeof onchainHex === 'string' && criteriaHash(text) === onchainHex.replace(/^0x/, '').toLowerCase();


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

  fail(id, now) {
    const n = (this.failures.get(id) ?? 0) + 1;
    this.failures.set(id, n);
    this.active.delete(id);
    if (n >= MAX_ATTEMPTS) {
      this.done.add(id);
      log(`GIVING UP on ${id} after ${n} attempts — needs a human`);
    } else {
      this.retryAt.set(id, now + Math.min(2000 * 2 ** (n - 1), 5 * 60_000));
    }
    this.persist();
    return n;
  }
}


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

  accept(orderId) {
    return this.req(`/orders/${orderId}/accept`, { method: 'POST', idempotencyKey: orderId });
  }

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


const URL_KEYS = ['url', 'site', 'site_url', 'website', 'domain', 'target', 'target_url'];

export function targetFrom(inputs) {
  if (!inputs || typeof inputs !== 'object') return { error: 'no inputs on the order' };
  const key = URL_KEYS.find((k) => typeof inputs[k] === 'string' && inputs[k].trim());
  if (!key) return { error: `no URL in the order inputs (looked for: ${URL_KEYS.join(', ')})` };
  let raw = inputs[key].trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  const err = urlError(raw, 'url');
  return err ? { error: err } : { url: raw };
}

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


async function sweepHires(api, ledger, now) {
  const orders = await api.listOrders('awaiting_acceptance');
  for (const order of orders) {
    const unit = order.order_id;
    if (ledger.seen(unit) || !ledger.ready(unit, now())) continue;

    if (!hashMatches(order.criteria ?? '', order.criteria_hash ?? '')) {
      log(`REFUSING ${unit}: criteria_hash mismatch — not enrolling`);
      ledger.finish(unit);
      continue;
    }

    const { error } = targetFrom(order.inputs);
    if (error) {
      log(`REFUSING ${unit}: ${error} — not enrolling, buyer auto-refunds in 48h`);
      ledger.finish(unit);
      continue;
    }

    ledger.start(unit);
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

export async function tick(api, ledger, now = Date.now) {
  await sweepHires(api, ledger, now);
  await sweepRework(api, ledger, now);
}


async function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? '') : null;
  };

  if (argv.includes('--dry-run')) {
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

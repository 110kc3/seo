// Monitoring: tell me when an endpoint I depend on stops answering.
//
// The recurring product the per-call ones cannot be. NEXT.md §7 found the audit's
// paid tier struggles because the free grade already answers the caller's
// question — a one-shot answer is substitutable, a standing watch is not. And it
// needs no new data-gathering: the Router already records `consecutive_failures`
// per endpoint precisely so something could fire on it.
//
// --- three decisions worth stating -----------------------------------------
//
// 1. CREDITS, NOT SUBSCRIPTIONS. x402 has no recurring billing and inventing one
//    would mean holding a mandate to charge later, which is custody by another
//    name and the thing this project refused. So a watch is *prepaid*: one
//    payment buys N sweeps, each sweep spends one, and at zero the watch stops
//    and says so. Nothing is ever charged without the caller signing for it.
//
// 2. THE PAYER IS THE OWNER. A settlement already proves which address paid, so
//    that address is the account id — no signup, no key to issue, no password to
//    lose. Topping up the same URL from the same wallet adds credits rather than
//    creating a second watch.
//
// 3. ALERTS ARE EDGES, NOT LEVELS. A webhook on every failing sweep is a mailing
//    list nobody reads. It fires when the state *changes* — answering to failing,
//    or failing to answering — which is the only moment the information is worth
//    an interruption.

const WATCH_PREFIX = 'watch:v1:';
// Long enough to outlive credits bought at the weekly cadence, short enough that
// an abandoned watch eventually stops costing a probe.
const WATCH_TTL_S = 400 * 24 * 3600;
export const MAX_SWEEPS = 52;
const MIN_SWEEPS = 4;
const MAX_BODY = 4 * 1024;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

/** One watch is one URL for one payer, so a top-up is idempotent by construction. */
export const watchKey = (payer, url) => `${WATCH_PREFIX}${String(payer).toLowerCase()}:${url}`;

/**
 * Validate before charging. The webhook is checked as strictly as the target:
 * we will be POSTing to it unattended, so it must be a public https URL for the
 * same reason the audit target must be — an alert aimed at 127.0.0.1 is a
 * request to use this Worker as an internal-network probe.
 */
export function parseWatchRequest(body, urlError) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'body must be a JSON object like {"url": "https://example.com/paid", "webhook": "https://you.example/hook", "sweeps": 12}' };
  }
  const err = urlError(body.url, 'url');
  if (err) return { error: err };
  const hookErr = urlError(body.webhook, 'webhook');
  if (hookErr) return { error: hookErr };
  if (!String(body.webhook).startsWith('https://')) {
    return { error: 'webhook: must be https — an alert is delivered unattended and carries the URL you are watching' };
  }
  const sweeps = Math.floor(Number(body.sweeps ?? 12));
  if (!Number.isFinite(sweeps) || sweeps < MIN_SWEEPS || sweeps > MAX_SWEEPS) {
    return { error: `sweeps: must be between ${MIN_SWEEPS} and ${MAX_SWEEPS}` };
  }
  return { url: body.url, webhook: body.webhook, sweeps };
}

/**
 * POST /api/watch — buy N sweeps of one endpoint.
 *
 * `gate` is passed in rather than called here for the same reason /api/route
 * does it: the price depends on how many sweeps were asked for, so the amount
 * has to be computed from a validated body before the challenge is issued.
 */
export async function handleWatch(request, env, cfg, { gate, urlError, base } = {}) {
  if (request.method !== 'POST') {
    return json({ ok: false, code: 'method_not_allowed', error: 'POST a JSON body like {"url": "…", "webhook": "…", "sweeps": 12}' }, 405, { allow: 'POST' });
  }
  const raw = await request.clone().text();
  if (raw.length > MAX_BODY) return json({ ok: false, code: 'too_large', error: `body larger than ${MAX_BODY} bytes` }, 413);
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch (e) {
    return json({ ok: false, code: 'bad_json', error: `invalid JSON: ${e.message.slice(0, 200)}` }, 400);
  }
  const parsed = parseWatchRequest(body, urlError);
  if (parsed.error) return json({ ok: false, code: 'invalid', errors: [parsed.error] }, 400);

  const paid = await gate(parsed.sweeps);
  if (!paid.ok) return paid.response;

  // The payer address comes from the settlement, not from the request body —
  // a self-declared owner is one a stranger can type.
  const payer = paid.payer;
  if (!payer) {
    return paid.attach(json({
      ok: false,
      code: 'payer_unknown',
      error: 'the settlement did not identify a payer address, so this watch would have no owner',
    }, 502));
  }

  const key = watchKey(payer, parsed.url);
  let existing = null;
  try { existing = await env?.PAYMENTS?.get(key, 'json'); } catch { /* treat as new */ }

  const watch = {
    url: parsed.url,
    webhook: parsed.webhook,
    payer,
    // A top-up adds to what is left rather than replacing it. Same wallet, same
    // URL, so the caller's intent is unambiguous and losing their remainder to a
    // second purchase would be theft by rounding.
    credits: (existing?.credits ?? 0) + parsed.sweeps,
    created: existing?.created ?? null,
    sweeps_run: existing?.sweeps_run ?? 0,
    last_state: existing?.last_state ?? null,
    last_swept: existing?.last_swept ?? null,
  };
  try {
    await env?.PAYMENTS?.put(key, JSON.stringify(watch), { expirationTtl: WATCH_TTL_S });
  } catch (e) {
    // Refusing to confirm a watch we could not store is the only honest answer:
    // the payment settled, so say plainly that it did and that this needs a human.
    return paid.attach(json({
      ok: false,
      code: 'watch_not_stored',
      error: `payment settled but the watch could not be saved (${e.message?.slice(0, 120)}). Nothing is being monitored — contact the operator, quoting the settlement receipt.`,
    }, 503));
  }

  return paid.attach(json({
    ok: true,
    watching: parsed.url,
    webhook: parsed.webhook,
    credits: watch.credits,
    topped_up: Boolean(existing),
    owner: payer,
    cadence: 'weekly',
    alerts_on: 'state change only — answering→failing and failing→answering. A webhook on every failing sweep is a mailing list nobody reads.',
    payload: { url: parsed.url, state: 'failing|answering', consecutive_failures: 0, checked_at: 'ISO-8601', credits_left: 0 },
    note: `Each sweep spends one credit. At zero the watch stops and the last alert says so. Top up by paying this endpoint again from ${payer}.`,
    terms: `${base}/api/x402/info`,
  }));
}

/**
 * One sweep over every watch. Called by the weekly health cron, bearer-gated.
 *
 * Deliberately not a Cloudflare cron trigger: `wrangler deploy` applies triggers
 * as one phase, and a trigger it cannot apply takes the whole deployment down —
 * which has happened here once already (see wrangler.toml). The health workflow
 * runs weekly anyway, which is the cadence this product promises, so it costs
 * nothing to reuse and cannot break a deploy.
 */
export async function handleSweep(request, env, { probe, cfg, fetchImpl = fetch, authorized } = {}) {
  if (!authorized) {
    // 404, not 401 — the same posture as the revenue dashboard. An unauthorized
    // caller learns nothing about what exists here.
    return json({ ok: false, code: 'not_found', error: 'not found' }, 404);
  }
  const listed = await env?.PAYMENTS?.list({ prefix: WATCH_PREFIX });
  const keys = listed?.keys ?? [];
  const results = { swept: 0, alerted: 0, exhausted: 0, failed_delivery: 0 };
  const at = new Date().toISOString();

  for (const { name } of keys) {
    const watch = await env.PAYMENTS.get(name, 'json');
    if (!watch) continue;
    if ((watch.credits ?? 0) <= 0) { results.exhausted++; continue; }

    const result = await probe(watch.url, { cfg, fetchImpl });
    const state = result.alive ? 'answering' : 'failing';
    const changed = watch.last_state !== null && watch.last_state !== state;
    const credits = watch.credits - 1;

    const updated = {
      ...watch, credits, sweeps_run: (watch.sweeps_run ?? 0) + 1, last_state: state, last_swept: at,
    };
    await env.PAYMENTS.put(name, JSON.stringify(updated), { expirationTtl: WATCH_TTL_S });
    results.swept++;

    // First sweep establishes the baseline rather than alerting: a watch created
    // on an endpoint that is already down should not fire "it changed".
    if (!changed && credits > 0) continue;

    const payload = {
      url: watch.url,
      state,
      changed,
      status: result.status,
      consecutive_failures: state === 'failing' ? 1 : 0,
      checked_at: at,
      credits_left: credits,
      ...(credits <= 0 ? { exhausted: true, note: 'This was the last paid sweep. Top up at /api/watch from the same wallet to continue.' } : {}),
    };
    try {
      const resp = await fetchImpl(watch.webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'AIProductIndexWatch/1.0 (+https://index.percall.dev/llms.txt)' },
        body: JSON.stringify(payload),
      });
      if (resp.ok) results.alerted++; else results.failed_delivery++;
    } catch {
      // A webhook that refuses delivery is the subscriber's problem, not ours,
      // and must not stop the sweep for everyone else.
      results.failed_delivery++;
    }
  }
  return json({ ok: true, watches: keys.length, ...results, swept_at: at });
}

export const __testing = { WATCH_PREFIX, WATCH_TTL_S, MIN_SWEEPS };

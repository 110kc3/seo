
const WATCH_PREFIX = 'watch:v1:';
const WATCH_TTL_S = 400 * 24 * 3600;
export const MAX_SWEEPS = 52;
const MIN_SWEEPS = 4;
const MAX_BODY = 4 * 1024;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

const EXPECTED_STATUS = new Set([401, 402, 403, 405]);

export function healthyForWatch(result) {
  if (!result.alive) return false;
  if (EXPECTED_STATUS.has(result.status)) return true;
  return result.status < 400;
}

export const watchKey = (payer, url) => `${WATCH_PREFIX}${String(payer).toLowerCase()}:${url}`;

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
    credits: (existing?.credits ?? 0) + parsed.sweeps,
    created: existing?.created ?? null,
    sweeps_run: existing?.sweeps_run ?? 0,
    last_state: existing?.last_state ?? null,
    last_swept: existing?.last_swept ?? null,
  };
  try {
    await env?.PAYMENTS?.put(key, JSON.stringify(watch), { expirationTtl: WATCH_TTL_S });
  } catch (e) {
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

export async function handleSweep(request, env, { probe, cfg, fetchImpl = fetch, authorized } = {}) {
  if (!authorized) {
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
    const state = healthyForWatch(result) ? 'answering' : 'failing';
    const changed = watch.last_state !== null && watch.last_state !== state;
    const credits = watch.credits - 1;

    const updated = {
      ...watch, credits, sweeps_run: (watch.sweeps_run ?? 0) + 1, last_state: state, last_swept: at,
    };
    await env.PAYMENTS.put(name, JSON.stringify(updated), { expirationTtl: WATCH_TTL_S });
    results.swept++;

    if (!changed && credits > 0) continue;

    const payload = {
      url: watch.url,
      state,
      changed,
      status: result.status,
      consecutive_failures: state === 'failing' ? 1 : 0,
      reason: state === 'failing'
        ? (result.alive ? `HTTP ${result.status}` : `no response (${result.error ?? 'transport failure'})`)
        : null,
      checked_at: at,
      credits_left: credits,
      ...(credits <= 0 ? { exhausted: true, note: 'This was the last prepaid sweep. Monitoring is complete; new watches and top-ups are closed.' } : {}),
    };
    try {
      const resp = await fetchImpl(watch.webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'AIProductIndexWatch/1.0 (+https://index.percall.dev/llms.txt)' },
        body: JSON.stringify(payload),
      });
      if (resp.ok) results.alerted++; else results.failed_delivery++;
    } catch {
      results.failed_delivery++;
    }
  }
  return json({ ok: true, watches: keys.length, ...results, swept_at: at });
}

export const __testing = { WATCH_PREFIX, WATCH_TTL_S, MIN_SWEEPS };

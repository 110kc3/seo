// Public traffic stats — the answer to "has any agent ever actually used this?"
//
// Reads back the Analytics Engine dataset the Worker writes on every request.
// A Worker cannot query its own dataset through a binding, so this goes through
// the Analytics Engine SQL API and needs two secrets:
//   npx wrangler secret put CF_ACCOUNT_ID
//   npx wrangler secret put CF_ANALYTICS_TOKEN   # Account Analytics: Read
// Without them the endpoint reports stats_not_enabled rather than pretending.

const DATASET = 'ai_product_index_requests';
const CACHE_KEY = 'stats:v1:30d';
const CACHE_TTL_SECONDS = 300;

const SQL = `
SELECT
  blob2 AS client_type,
  blob1 AS path_bucket,
  SUM(_sample_interval) AS requests
FROM ${DATASET}
WHERE timestamp > NOW() - INTERVAL '30' DAY
GROUP BY client_type, path_bucket
ORDER BY requests DESC
LIMIT 200
`;

const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
      ...extraHeaders,
    },
  });

async function query(env) {
  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'content-type': 'text/plain' },
      body: SQL,
    },
  );
  if (!resp.ok) throw new Error(`analytics API HTTP ${resp.status}`);
  const { data } = await resp.json();
  return Array.isArray(data) ? data : [];
}

function shape(rows) {
  const byClient = {};
  const byPath = {};
  let total = 0;
  for (const r of rows) {
    const n = Number(r.requests) || 0;
    total += n;
    byClient[r.client_type ?? 'unknown'] = (byClient[r.client_type ?? 'unknown'] ?? 0) + n;
    byPath[r.path_bucket ?? 'other'] = (byPath[r.path_bucket ?? 'other'] ?? 0) + n;
  }
  const sortDesc = (obj) =>
    Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
  const agentTraffic = (byClient.ai_agent ?? 0) + (byClient.ai_crawler ?? 0);
  return {
    window: '30d',
    generated_at: new Date().toISOString(),
    total_requests: total,
    // The number this whole exercise exists to produce.
    agent_share: total ? Number((agentTraffic / total).toFixed(4)) : 0,
    by_client_type: sortDesc(byClient),
    by_path: sortDesc(byPath),
    note: 'Client type is inferred from the self-reported user-agent and is a traffic-shape signal, not an identity claim. No IP addresses or other personal data are collected.',
  };
}

export async function handleStats(env) {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) {
    return json({
      ok: false,
      code: 'stats_not_enabled',
      error: 'traffic stats are not published yet — the analytics read credentials are not configured',
    }, 503, { 'cache-control': 'no-store' });
  }

  const cached = await env.PAYMENTS.get(CACHE_KEY);
  if (cached) return json({ ok: true, cached: true, ...JSON.parse(cached) });

  let rows;
  try {
    rows = await query(env);
  } catch (e) {
    return json({ ok: false, code: 'stats_unavailable', error: e.message }, 502, { 'cache-control': 'no-store' });
  }

  const body = shape(rows);
  await env.PAYMENTS.put(CACHE_KEY, JSON.stringify(body), { expirationTtl: CACHE_TTL_SECONDS });
  return json({ ok: true, cached: false, ...body });
}

export const __testing = { shape };

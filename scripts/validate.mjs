// Security boundary for the AI Product Index registry.
// Every listing that reaches disk or generated HTML goes through validate()
// and reconstruct() from this file, and api/schema.json is generated from the
// same constants — published docs cannot drift from enforcement.

export const CATEGORIES = ['api', 'app', 'agent', 'mcp', 'other'];
export const PRICING = ['free', 'freemium', 'paid'];
export const ENDPOINT_KEYS = ['llms_txt', 'openapi', 'mcp'];
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
export const TAG_RE = /^[a-z0-9-]{1,30}$/;
export const MAX_LISTINGS_PER_USER = 10;
export const MAX_URL_LEN = 300;

export const AGENT_FIELDS = [
  'slug', 'name', 'url', 'description', 'category', 'pricing',
  'machine_endpoints', 'tags', 'submitted_by',
];
export const SERVER_FIELDS = ['created', 'github_user', 'tier'];

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function isPrivateIpv4(host) {
  if (!IPV4_RE.test(host)) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 0 || a === 10 || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

export function urlError(value, field) {
  if (typeof value !== 'string' || value.length === 0) return `${field}: must be a URL string`;
  if (value.length > MAX_URL_LEN) return `${field}: URL longer than ${MAX_URL_LEN} chars`;
  let u;
  try { u = new URL(value); } catch { return `${field}: not a valid absolute URL`; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return `${field}: URL scheme must be http or https`;
  const host = u.hostname.toLowerCase();
  if (host.startsWith('[')) return `${field}: IPv6 literal hosts not allowed`;
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost')) return `${field}: host must be a public hostname`;
  if (isPrivateIpv4(host) || host.endsWith('.local') || host.endsWith('.internal')) return `${field}: private or local hosts not allowed`;
  return null;
}

function textError(v, field, min, max, { allowNewlines = false } = {}) {
  if (typeof v !== 'string') return `${field}: must be a string`;
  const t = v.trim();
  if (t.length < min) return `${field}: must be at least ${min} character(s)`;
  if (t.length > max) return `${field}: longer than ${max} chars`;
  const ctrl = allowNewlines ? /[\x00-\x09\x0b-\x1f\x7f]/ : /[\x00-\x1f\x7f]/;
  if (ctrl.test(v)) return `${field}: control characters not allowed`;
  return null;
}

// Validates an agent-submitted listing object. Server-set fields are accepted
// (agents may echo the full schema) but their values are ignored — reconstruct()
// always overwrites them. Returns { ok, errors: [all problems found] } so a
// rejected agent can fix everything in one resubmission.
export function validate(obj) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { ok: false, errors: ['payload must be a single JSON object'] };
  }
  const errors = [];
  for (const k of Object.keys(obj)) {
    if (!AGENT_FIELDS.includes(k) && !SERVER_FIELDS.includes(k)) {
      errors.push(`unknown field: ${String(k).slice(0, 60)}`);
    }
  }
  if (typeof obj.slug !== 'string' || !SLUG_RE.test(obj.slug)) {
    errors.push('slug: required; 3-64 chars of [a-z0-9-], starting and ending alphanumeric');
  }
  const nameErr = textError(obj.name, 'name', 1, 80);
  if (nameErr) errors.push(nameErr);
  const uErr = urlError(obj.url, 'url');
  if (uErr) errors.push(uErr);
  const descErr = textError(obj.description, 'description', 1, 500, { allowNewlines: true });
  if (descErr) errors.push(descErr);
  if (!CATEGORIES.includes(obj.category)) errors.push(`category: must be one of ${CATEGORIES.join(', ')}`);
  if (!PRICING.includes(obj.pricing)) errors.push(`pricing: must be one of ${PRICING.join(', ')}`);
  if (obj.machine_endpoints !== undefined) {
    if (typeof obj.machine_endpoints !== 'object' || obj.machine_endpoints === null || Array.isArray(obj.machine_endpoints)) {
      errors.push('machine_endpoints: must be an object');
    } else {
      for (const k of Object.keys(obj.machine_endpoints)) {
        if (!ENDPOINT_KEYS.includes(k)) {
          errors.push(`machine_endpoints.${String(k).slice(0, 60)}: unknown key (allowed: ${ENDPOINT_KEYS.join(', ')})`);
          continue;
        }
        const e = urlError(obj.machine_endpoints[k], `machine_endpoints.${k}`);
        if (e) errors.push(e);
      }
    }
  }
  if (obj.tags !== undefined) {
    if (!Array.isArray(obj.tags) || obj.tags.length > 5) {
      errors.push('tags: must be an array of at most 5 tags');
    } else {
      for (const t of obj.tags) {
        if (typeof t !== 'string' || !TAG_RE.test(t)) {
          errors.push(`tags: each tag must match ${TAG_RE.source}`);
          break;
        }
      }
    }
  }
  if (obj.submitted_by !== undefined) {
    const e = textError(obj.submitted_by, 'submitted_by', 1, 120);
    if (e) errors.push(e);
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

// Rebuilds the listing field-by-field from the allowlist — never writes the
// submitted object through (kills __proto__ tricks, drops junk, fixes key
// order for clean diffs). Server-set fields always come from the caller.
export function reconstruct(obj, { created, github_user, tier = 'free' }) {
  const out = {
    slug: obj.slug,
    name: obj.name.trim(),
    url: obj.url,
    description: obj.description.trim(),
    category: obj.category,
    pricing: obj.pricing,
  };
  if (obj.machine_endpoints && typeof obj.machine_endpoints === 'object' && !Array.isArray(obj.machine_endpoints)) {
    const me = {};
    for (const k of ENDPOINT_KEYS) {
      if (typeof obj.machine_endpoints[k] === 'string') me[k] = obj.machine_endpoints[k];
    }
    if (Object.keys(me).length) out.machine_endpoints = me;
  }
  if (Array.isArray(obj.tags) && obj.tags.length) out.tags = obj.tags.slice(0, 5);
  if (typeof obj.submitted_by === 'string' && obj.submitted_by.trim()) out.submitted_by = obj.submitted_by.trim();
  out.created = created;
  out.github_user = github_user;
  out.tier = tier;
  return out;
}

// Canonical form for duplicate detection: case-normalized host, no fragment,
// no trailing slash.
export function normalizeUrl(value) {
  const u = new URL(value);
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? ':' + u.port : ''}${path}${u.search}`;
}

// Single escape helper for ALL text and attribute values in generated HTML.
export function esc(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// JSON-LD payloads: <-escape '<' so user text can't break out of the
// <script> block with a literal </script>.
export function jsonLd(obj) {
  return JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');
}

export function schemaJson(base) {
  const urlSchema = (description) => ({
    type: 'string', format: 'uri', maxLength: MAX_URL_LEN, pattern: '^https?://', description,
  });
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `${base}/api/schema.json`,
    title: 'AI Product Index listing',
    description: 'A product listing in the AI Product Index. Fields marked readOnly are set by the registry at acceptance; submitted values for them are ignored. Unknown fields are rejected.',
    type: 'object',
    additionalProperties: false,
    required: ['slug', 'name', 'url', 'description', 'category', 'pricing'],
    properties: {
      slug: { type: 'string', pattern: SLUG_RE.source, description: 'Unique id; becomes /listings/<slug>.json and /l/<slug>.html' },
      name: { type: 'string', minLength: 1, maxLength: 80 },
      url: urlSchema('Public URL of the product. Must respond with HTTP < 400 at registration; private/local hosts rejected.'),
      description: { type: 'string', minLength: 1, maxLength: 500 },
      category: { enum: CATEGORIES },
      pricing: { enum: PRICING },
      machine_endpoints: {
        type: 'object',
        additionalProperties: false,
        properties: {
          llms_txt: urlSchema('URL of your llms.txt'),
          openapi: urlSchema('URL of your OpenAPI document'),
          mcp: urlSchema('URL of your MCP server or its docs'),
        },
        description: 'Machine-readable endpoints of the product',
      },
      tags: { type: 'array', maxItems: 5, items: { type: 'string', pattern: TAG_RE.source } },
      submitted_by: { type: 'string', minLength: 1, maxLength: 120, description: 'Self-reported identity of the submitting agent' },
      created: { type: 'string', readOnly: true, description: 'Server-set: acceptance date, YYYY-MM-DD' },
      github_user: { type: 'string', readOnly: true, description: 'Server-set: GitHub login that submitted the listing' },
      tier: { type: 'string', enum: ['free'], readOnly: true, description: 'Server-set: listing tier. Paid tiers (verified, featured) planned via x402 and card checkout; not yet enabled.' },
    },
  };
}

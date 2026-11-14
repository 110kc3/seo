
const DEFAULTS = {
  asset_name: 'USDC',
  asset_version: '2',
  asset_decimals: 6,
  max_timeout_seconds: 60,
  min_confirmations: 2,
};

const PER_PROFILE = ['asset_name', 'asset_version', 'asset_decimals'];

export function resolveX402(cfg) {
  const payments = cfg?.payments ?? {};
  const x402 = payments.x402 ?? {};
  const profile = x402.profiles?.[x402.active];
  if (!profile) return null;

  const rail = {
    rail: x402.active,
    payTo: payments.x402_address ?? '',
    facilitator_url: profile.facilitator_url ?? '',
    auth: profile.auth ?? 'none',
    network: profile.network ?? '',
    network_v1: profile.network_v1 ?? '',
    asset: profile.asset ?? '',
    rpc_url: profile.rpc_url ?? '',
    explorer: profile.explorer ?? '',
    min_confirmations: profile.min_confirmations ?? DEFAULTS.min_confirmations,
    max_timeout_seconds: x402.max_timeout_seconds ?? DEFAULTS.max_timeout_seconds,
    audit_price_atomic: x402.audit_price_atomic,
    verified_tier_price_atomic: x402.verified_tier_price_atomic,
    featured_tier_price_atomic: x402.featured_tier_price_atomic,
  };

  for (const key of PER_PROFILE) {
    rail[key] = profile[key] ?? x402[key] ?? DEFAULTS[key];
  }

  if (!rail.payTo || !rail.facilitator_url || !rail.network || !rail.asset) return null;
  return rail;
}

export function needsCdpAuth(rail) {
  return rail?.auth === 'cdp';
}

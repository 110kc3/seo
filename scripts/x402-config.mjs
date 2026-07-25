// Resolves the active x402 rail from site.config.json.
//
// Rails differ only in where they settle and who they answer to, so they live
// as named profiles under payments.x402.profiles with an `active` selector:
// moving from rehearsal to real money is one word, not five edited fields.
//
// Pure and dependency-free so both the Worker and the Node scripts import it.
//
// Fail-closed contract, unchanged from the original flat config: this returns
// null unless the rail is *completely* configured, and every caller must treat
// null as `payments_not_enabled` rather than serving free.

const DEFAULTS = {
  asset_name: 'USDC',
  asset_version: '2',
  max_timeout_seconds: 60,
  min_confirmations: 2,
};

/**
 * @returns {object|null} flat rail settings, or null when payments are off or
 *   the selected profile is incomplete.
 */
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
    asset: profile.asset ?? '',
    rpc_url: profile.rpc_url ?? '',
    explorer: profile.explorer ?? '',
    min_confirmations: profile.min_confirmations ?? DEFAULTS.min_confirmations,
    asset_name: x402.asset_name ?? DEFAULTS.asset_name,
    asset_version: x402.asset_version ?? DEFAULTS.asset_version,
    max_timeout_seconds: x402.max_timeout_seconds ?? DEFAULTS.max_timeout_seconds,
    audit_price_atomic: x402.audit_price_atomic,
    verified_tier_price_atomic: x402.verified_tier_price_atomic,
    featured_tier_price_atomic: x402.featured_tier_price_atomic,
  };

  // The mainnet profiles ship with `asset` deliberately blank: the USDC
  // contract address must be read off the token's official page and checked
  // against a block explorer, never recalled from memory. Missing it disables
  // the rail rather than sending payments to a wrong or nonexistent contract.
  if (!rail.payTo || !rail.facilitator_url || !rail.network || !rail.asset) return null;
  return rail;
}

/** True when the active rail authenticates to a Coinbase CDP facilitator. */
export function needsCdpAuth(rail) {
  return rail?.auth === 'cdp';
}

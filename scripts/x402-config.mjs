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
  asset_decimals: 6,
  max_timeout_seconds: 60,
  min_confirmations: 2,
};

// asset_name / asset_version are NOT cosmetic and NOT shared across networks.
// They are published as `extra: { name, version }` in the payment requirements,
// and that pair is the EIP-712 domain the payer signs `transferWithAuthorization`
// against. It must equal the token contract's own `name()` and `version()` on
// that chain — and USDC does not use the same name on every chain:
//
//   Base Sepolia 0x036CbD53…  name() = "USDC"
//   Base mainnet 0x833589fC…  name() = "USD Coin"
//
// Publishing the wrong name yields a signature over a different domain, so the
// facilitator rejects every payment as invalid. Hence per-profile overrides,
// with the top-level value kept only as a default. Verify with
// `node scripts/verify-rail.mjs <profile>`, which reads both off chain.
const PER_PROFILE = ['asset_name', 'asset_version', 'asset_decimals'];

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
    // The same chain under its x402 v1 name ("base-sepolia" / "base") rather
    // than its CAIP-2 id. Optional: absent means only v2 is offered on this
    // rail, which fails closed for v1 clients instead of inventing a name the
    // facilitator would not recognise.
    network_v1: profile.network_v1 ?? '',
    asset: profile.asset ?? '',
    rpc_url: profile.rpc_url ?? '',
    explorer: profile.explorer ?? '',
    min_confirmations: profile.min_confirmations ?? DEFAULTS.min_confirmations,
    max_timeout_seconds: x402.max_timeout_seconds ?? DEFAULTS.max_timeout_seconds,
    audit_price_atomic: x402.audit_price_atomic,
    route_price_atomic: x402.route_price_atomic,
    check_price_atomic: x402.check_price_atomic,
    watch_sweep_price_atomic: x402.watch_sweep_price_atomic,
    verified_tier_price_atomic: x402.verified_tier_price_atomic,
    featured_tier_price_atomic: x402.featured_tier_price_atomic,
  };

  // Profile value wins over the shared one; the shared one wins over the default.
  for (const key of PER_PROFILE) {
    rail[key] = profile[key] ?? x402[key] ?? DEFAULTS[key];
  }

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

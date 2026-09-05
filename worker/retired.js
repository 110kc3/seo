// Closed purchase routes. Shared with self-probes so a retired local endpoint
// cannot be reported as healthy merely because its hostname belongs to us.
export const RETIRED_API_PATHS = new Set([
  '/api/check',
  '/api/liveness',
  '/api/route',
  '/api/watch',
]);

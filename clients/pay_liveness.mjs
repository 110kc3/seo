// Retained so old commands fail clearly before loading a wallet or payment SDK.
// The paid probe, router and watch purchase endpoints were retired on 2026-09-05.
console.error('The paid liveness, route and watch endpoints are retired. No payment was attempted. Use clients/pay_x402.mjs for the optional audit API, or the free catalog search.');
process.exitCode = 1;

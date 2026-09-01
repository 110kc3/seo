# Repository instructions

## Current work

- `NEXT.md` is the only current queue. In `TODO.md`, only the owner-action list
  above the changelog is current; the folded section is historical.
- Keep commercial strategy, pricing analysis and private owner notes in the
  Obsidian vault under `40-projects/x402-scale-up/`, not in this public repo.
- Do not create new product work while the commercial-evidence gate in
  `NEXT.md` remains active. Maintain the three upstream PRs listed there when
  their state changes.

## Runtime and verification

- This project requires Node 22 or newer. If only Node 18 is available locally,
  add `--experimental-global-webcrypto` explicitly to build and test commands;
  CI still runs on the required Node 22 runtime.
- Build with `node scripts/build.mjs` and test with
  `node --test scripts/*.test.mjs`. Use the explicit glob; a bare test-directory
  argument does not work as intended on Node 22.
- The build is deterministic. Run it twice when changing sources and require a
  clean second build. Do not hand-edit generated pages, catalogs, `llms.txt`,
  sitemaps or `.well-known` artifacts.
- Before pushing, run the full suite and `git diff --check`. After a deployment,
  verify production and confirm that live `llms.txt` matches the committed
  artifact byte for byte.

## Sources and boundaries

- `listings/*.json`, `templates/`, `site.config.json` and the enforcement code
  under `scripts/` and `worker/` are sources of truth. Read `ARCHITECTURE.md`
  before changing generated output, registration, payment or routing behavior.
- Treat `scripts/validate.mjs` as a security boundary. Preserve URL, escaping,
  schema, ownership and path-safety checks when extending registration or
  auditing.
- Never commit credentials, private revenue data or vault-only commercial
  material. Keep analytics claims qualified as User-Agent classifications and
  distinguish self-registration provenance from proof of autonomous identity.

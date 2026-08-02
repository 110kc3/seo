// Tests for the autonomous registration path — the one place untrusted input
// from a stranger on the internet turns into a committed file in this repo.
//
// It was the only script here with no coverage at all, which is backwards: it
// is also the only one that enforces ownership, per-account caps and single-use
// payment receipts. The gap survived because process-issue.mjs is a program,
// not a module — it reads env vars at import time and calls process.exit, so it
// cannot simply be imported and called.
//
// So it is tested the way the workflow actually invokes it: as a subprocess,
// with the untrusted values in env vars, asserting on the exit code and
// result.md. That is the real contract — register.yml branches on exit status
// and posts result.md verbatim as the bot's reply — and testing it this way
// needs no refactor of code that currently has nothing exercising it.
//
// Each case runs against a throwaway copy of the repo (scripts/, listings/,
// site.config.json) so a test can never write a listing into the real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const REPO = fileURLToPath(new URL('../', import.meta.url));

async function sandbox(listings = {}, ledger = null) {
  const dir = await mkdtemp(join(tmpdir(), 'process-issue-'));
  await cp(join(REPO, 'scripts'), join(dir, 'scripts'), { recursive: true });
  await cp(join(REPO, 'site.config.json'), join(dir, 'site.config.json'));
  await mkdir(join(dir, 'listings'));
  for (const [slug, listing] of Object.entries(listings)) {
    await writeFile(join(dir, 'listings', `${slug}.json`), JSON.stringify(listing, null, 2) + '\n');
  }
  if (ledger) await writeFile(join(dir, 'payments.json'), JSON.stringify(ledger, null, 2) + '\n');
  return dir;
}

// SKIP_LIVENESS keeps the suite offline; the liveness check has its own network
// path and is exercised by check-liveness.mjs against the real registry.
async function run(dir, env) {
  const outFile = join(dir, 'gh_output');
  await writeFile(outFile, '');
  const opts = {
    env: { ...process.env, SKIP_LIVENESS: '1', GITHUB_OUTPUT: outFile, ...env },
    cwd: dir,
  };
  let code = 0;
  try {
    await execFileAsync(process.execPath, [join(dir, 'scripts', 'process-issue.mjs')], opts);
  } catch (e) {
    code = typeof e.code === 'number' ? e.code : 1;
  }
  const read = async (p) => readFile(join(dir, p), 'utf8').catch(() => '');
  return { code, dir, result: await read('result.md'), output: await read('gh_output') };
}

// result.md embeds the machine-readable rejection in a ````json block — that
// block is the registry's actual API for a failed submission, so parse it
// rather than string-matching the prose around it.
function rejection(md) {
  const m = md.match(/````json\s*\n([\s\S]*?)````/);
  assert.ok(m, `no json block in result.md:\n${md}`);
  return JSON.parse(m[1]);
}

const listing = (over = {}) => ({
  slug: 'test-product',
  name: 'Test Product',
  url: 'https://test-product.example.com',
  description: 'A product used only by the test suite, long enough to satisfy the schema.',
  category: 'api',
  pricing: 'free',
  ...over,
});

const stored = (over = {}) => ({
  ...listing(),
  created: '2026-01-01',
  github_user: 'original-owner',
  tier: 'free',
  ...over,
});

const issue = (payload, over = {}) => ({
  ISSUE_TITLE: '[register] Test Product',
  ISSUE_USER: 'submitter',
  ISSUE_BODY: '```json\n' + JSON.stringify(payload, null, 2) + '\n```',
  ...over,
});

// --- the happy paths --------------------------------------------------------

test('register writes the listing, the reply and the workflow outputs', async () => {
  const dir = await sandbox();
  const r = await run(dir, issue(listing()));

  assert.equal(r.code, 0, `expected acceptance, got:\n${r.result}`);
  const written = JSON.parse(await readFile(join(dir, 'listings', 'test-product.json'), 'utf8'));
  assert.equal(written.slug, 'test-product');
  // Server-owned fields are stamped here, never taken from the submitter.
  assert.equal(written.github_user, 'submitter');
  assert.equal(written.tier, 'free');
  assert.match(written.created, /^\d{4}-\d{2}-\d{2}$/);

  assert.match(r.result, /## Registered/);
  assert.match(r.output, /slug=test-product/);
  assert.match(r.output, /verb=Add/);
});

test('update keeps the fields the submitter does not own', async () => {
  const dir = await sandbox({ 'test-product': stored({ tier: 'featured' }) });
  const r = await run(dir, issue(listing({ description: 'An updated description, still long enough for the schema.' }), {
    ISSUE_TITLE: '[update] Test Product',
    ISSUE_USER: 'original-owner',
  }));

  assert.equal(r.code, 0, `expected acceptance, got:\n${r.result}`);
  const written = JSON.parse(await readFile(join(dir, 'listings', 'test-product.json'), 'utf8'));
  assert.match(written.description, /An updated description/);
  // A paying customer must not be able to lose their tier — or grant it — by
  // editing their own listing.
  assert.equal(written.tier, 'featured');
  assert.equal(written.created, '2026-01-01');
  assert.equal(written.github_user, 'original-owner');
  assert.match(r.output, /verb=Update/);
});

test('a submitter cannot grant themselves a paid tier through register', async () => {
  const dir = await sandbox();
  const r = await run(dir, issue(listing({ tier: 'featured', github_user: 'somebody-else', created: '1999-01-01' })));

  // The submission is accepted and the injected fields are dropped, rather than
  // the whole payload being refused. That is the safe half of the tradeoff and
  // the half worth pinning: the listing is rebuilt from a whitelist of agent
  // fields, so an unknown or server-owned key cannot reach disk no matter what
  // the schema does or does not say about it. Assert on the file, because that
  // is where a privilege escalation would show up.
  assert.equal(r.code, 0, `expected acceptance, got:\n${r.result}`);
  const written = JSON.parse(await readFile(join(dir, 'listings', 'test-product.json'), 'utf8'));
  assert.equal(written.tier, 'free', 'submitter granted themselves a paid tier');
  assert.equal(written.github_user, 'submitter', 'submitter attributed the listing to someone else');
  assert.notEqual(written.created, '1999-01-01', 'submitter forged the creation date');
});

// --- authorization ----------------------------------------------------------

test('only the original submitter can update a listing', async () => {
  const dir = await sandbox({ 'test-product': stored() });
  const r = await run(dir, issue(listing(), {
    ISSUE_TITLE: '[update] Test Product',
    ISSUE_USER: 'an-impostor',
  }));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'not_owner');
});

test('the repo owner can update anyone listing', async () => {
  const dir = await sandbox({ 'test-product': stored() });
  const cfg = JSON.parse(await readFile(join(REPO, 'site.config.json'), 'utf8'));
  const r = await run(dir, issue(listing({ description: 'Owner-edited description, long enough for the schema.' }), {
    ISSUE_TITLE: '[update] Test Product',
    ISSUE_USER: cfg.repo.split('/')[0],
  }));

  assert.equal(r.code, 0, `expected acceptance, got:\n${r.result}`);
});

test('a missing issue author is an internal error, not an anonymous listing', async () => {
  const dir = await sandbox();
  const r = await run(dir, issue(listing(), { ISSUE_USER: '' }));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'internal');
});

// --- deduplication and caps -------------------------------------------------

test('a slug cannot be registered twice', async () => {
  const dir = await sandbox({ 'test-product': stored() });
  const r = await run(dir, issue(listing()));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'duplicate');
});

test('the same url cannot be registered under a second slug', async () => {
  const dir = await sandbox({ 'first-slug': stored({ slug: 'first-slug' }) });
  const r = await run(dir, issue(listing({ slug: 'second-slug' })));

  assert.equal(r.code, 1);
  const j = rejection(r.result);
  assert.equal(j.code, 'duplicate');
  assert.match(j.errors[0], /first-slug/);
});

test('url matching ignores the cosmetic differences a resubmitter would vary', async () => {
  const dir = await sandbox({ 'first-slug': stored({ slug: 'first-slug', url: 'https://test-product.example.com' }) });
  const r = await run(dir, issue(listing({ slug: 'second-slug', url: 'https://TEST-PRODUCT.example.com/' })));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'duplicate');
});

test('an account cannot exceed the per-user listing cap', async () => {
  const { MAX_LISTINGS_PER_USER } = await import('./validate.mjs');
  const existing = {};
  for (let i = 0; i < MAX_LISTINGS_PER_USER; i += 1) {
    existing[`filler-${i}`] = stored({
      slug: `filler-${i}`,
      url: `https://filler-${i}.example.com`,
      github_user: 'submitter',
    });
  }
  const dir = await sandbox(existing);
  const r = await run(dir, issue(listing()));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'account_cap');
});

test('curated and seed listings do not consume an account cap slot', async () => {
  // Found by running the real workflow: after 30 curated entries were seeded
  // under the operator's account, the operator's own [register] was refused at
  // "40 listings (max 10)" — and so was every future one. The cap is meant to
  // stop an account flooding the registry *through this flow*; an entry the
  // registry itself wrote was never a submission.
  const { MAX_LISTINGS_PER_USER } = await import('./validate.mjs');
  const existing = {};
  for (let i = 0; i < MAX_LISTINGS_PER_USER * 3; i += 1) {
    existing[`curated-${i}`] = stored({
      slug: `curated-${i}`,
      url: `https://curated-${i}.example.com`,
      github_user: 'submitter',
      origin: i % 2 === 0 ? 'curated' : 'seed',
    });
  }
  const dir = await sandbox(existing);
  const r = await run(dir, issue(listing()));

  assert.equal(r.code, 0, 'curated entries should not block a registration');
  const written = JSON.parse(await readFile(join(dir, 'listings', 'test-product.json'), 'utf8'));
  assert.equal(written.origin, 'self-registered');
});

test('a submitter cannot claim to be curated to escape the cap', async () => {
  // The reason `origin` is server-set rather than read off `submitted_by`.
  // `submitted_by` is self-reported — if the cap trusted it, this listing would
  // register and so would the next thousand.
  const { MAX_LISTINGS_PER_USER } = await import('./validate.mjs');
  const existing = {};
  for (let i = 0; i < MAX_LISTINGS_PER_USER; i += 1) {
    existing[`filler-${i}`] = stored({
      slug: `filler-${i}`,
      url: `https://filler-${i}.example.com`,
      github_user: 'submitter',
      origin: 'self-registered',
    });
  }
  const dir = await sandbox(existing);
  const r = await run(dir, issue(listing({
    submitted_by: 'registry (curated)',
    origin: 'curated',
  })));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'account_cap');
});

test('a listing with no origin still counts toward the cap', async () => {
  // Fail-closed for anything written before the field existed: an unrecognised
  // entry costs its account a slot rather than being free.
  const { MAX_LISTINGS_PER_USER } = await import('./validate.mjs');
  const existing = {};
  for (let i = 0; i < MAX_LISTINGS_PER_USER; i += 1) {
    const row = stored({ slug: `legacy-${i}`, url: `https://legacy-${i}.example.com`, github_user: 'submitter' });
    delete row.origin;
    existing[`legacy-${i}`] = row;
  }
  const dir = await sandbox(existing);
  const r = await run(dir, issue(listing()));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'account_cap');
});

test('an update cannot launder a curated listing into a self-registered one', async () => {
  const dir = await sandbox({
    'test-product': stored({ slug: 'test-product', github_user: 'submitter', origin: 'curated' }),
  });
  const r = await run(dir, issue(listing({ origin: 'self-registered' }), { ISSUE_TITLE: '[update] Test Product' }));

  assert.equal(r.code, 0);
  const written = JSON.parse(await readFile(join(dir, 'listings', 'test-product.json'), 'utf8'));
  assert.equal(written.origin, 'curated', 'origin survived an update it should not have');
});

// --- payload handling -------------------------------------------------------

test('a raw json body with no fence is accepted', async () => {
  const dir = await sandbox();
  const r = await run(dir, issue(listing(), { ISSUE_BODY: JSON.stringify(listing()) }));

  assert.equal(r.code, 0, `expected acceptance, got:\n${r.result}`);
});

test('an unlabelled code fence is accepted', async () => {
  const dir = await sandbox();
  const r = await run(dir, issue(listing(), { ISSUE_BODY: '```\n' + JSON.stringify(listing()) + '\n```' }));

  assert.equal(r.code, 0, `expected acceptance, got:\n${r.result}`);
});

test('malformed json is rejected with a reason, not a stack trace', async () => {
  const dir = await sandbox();
  const r = await run(dir, issue(listing(), { ISSUE_BODY: '```json\n{"slug": "x",,}\n```' }));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'bad_json');
});

test('a body with no json at all is rejected', async () => {
  const dir = await sandbox();
  const r = await run(dir, issue(listing(), { ISSUE_BODY: 'hello, I would like to be listed please' }));

  assert.equal(r.code, 1);
  assert.ok(['no_json', 'bad_json'].includes(rejection(r.result).code));
});

test('an oversized body is refused before it is parsed', async () => {
  const dir = await sandbox();
  const r = await run(dir, issue(listing(), { ISSUE_BODY: 'x'.repeat(21 * 1024) }));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'too_large');
});

test('a slug that tries to escape the listings directory is refused', async () => {
  const dir = await sandbox();
  const r = await run(dir, issue(listing({ slug: '../../../etc/passwd' })));

  // SLUG_RE is the gate; safeTarget is the second line of defence behind it.
  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).ok, false);
});

test('backticks in a name cannot break out of the reply markdown', async () => {
  const dir = await sandbox();
  const r = await run(dir, issue(listing({ name: 'Ev`il ```json Product' })));

  if (r.code === 0) {
    // Accepted: the name must not be able to close the fence the bot posts.
    const fences = r.result.match(/^````json$/gm) ?? [];
    assert.equal(fences.length, 1, `reply markdown has ${fences.length} json fences:\n${r.result}`);
  } else {
    assert.equal(rejection(r.result).ok, false);
  }
});

// --- upgrades and the payment ledger ---------------------------------------
// Every case below is refused before any RPC call, so the suite stays offline.

test('an upgrade to an unknown tier is refused', async () => {
  const dir = await sandbox({ 'test-product': stored() });
  const r = await run(dir, issue({ slug: 'test-product', tier: 'platinum', rail: 'x402' }, {
    ISSUE_TITLE: '[upgrade] Test Product',
    ISSUE_USER: 'original-owner',
  }));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'invalid');
});

test('an upgrade for someone else listing is refused before payment is looked at', async () => {
  const dir = await sandbox({ 'test-product': stored() });
  const r = await run(dir, issue({ slug: 'test-product', tier: 'verified', rail: 'x402', receipt: { transaction: `0x${'a'.repeat(64)}` } }, {
    ISSUE_TITLE: '[upgrade] Test Product',
    ISSUE_USER: 'an-impostor',
  }));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'not_owner');
});

test('a card payment is routed to manual reconciliation, not rejected as invalid', async () => {
  const dir = await sandbox({ 'test-product': stored() });
  const r = await run(dir, issue({ slug: 'test-product', tier: 'verified', rail: 'card' }, {
    ISSUE_TITLE: '[upgrade] Test Product',
    ISSUE_USER: 'original-owner',
  }));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'manual_reconciliation');
});

test('a receipt that is not a transaction hash is refused', async () => {
  const dir = await sandbox({ 'test-product': stored() });
  const r = await run(dir, issue({ slug: 'test-product', tier: 'verified', rail: 'x402', receipt: { transaction: 'not-a-hash' } }, {
    ISSUE_TITLE: '[upgrade] Test Product',
    ISSUE_USER: 'original-owner',
  }));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'invalid');
});

test('a transaction already in the ledger cannot buy a second upgrade', async () => {
  const tx = `0x${'b'.repeat(64)}`;
  const dir = await sandbox(
    { 'test-product': stored() },
    { [tx]: { slug: 'some-other-listing', tier: 'featured', date: '2026-07-01' } },
  );
  const r = await run(dir, issue({ slug: 'test-product', tier: 'verified', rail: 'x402', receipt: { transaction: tx } }, {
    ISSUE_TITLE: '[upgrade] Test Product',
    ISSUE_USER: 'original-owner',
  }));

  assert.equal(r.code, 1);
  const j = rejection(r.result);
  assert.equal(j.code, 'receipt_already_used');
  assert.match(j.errors[0], /some-other-listing/);
});

test('the ledger is matched case-insensitively, so recasing a hash does not reuse it', async () => {
  const tx = `0x${'c'.repeat(64)}`;
  const dir = await sandbox(
    { 'test-product': stored() },
    { [tx]: { slug: 'some-other-listing', tier: 'featured', date: '2026-07-01' } },
  );
  const r = await run(dir, issue({ slug: 'test-product', tier: 'verified', rail: 'x402', receipt: { transaction: tx.toUpperCase().replace('0X', '0x') } }, {
    ISSUE_TITLE: '[upgrade] Test Product',
    ISSUE_USER: 'original-owner',
  }));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'receipt_already_used');
});

test('an upgrade of a listing that does not exist is refused', async () => {
  const dir = await sandbox();
  const r = await run(dir, issue({ slug: 'test-product', tier: 'verified', rail: 'x402' }, {
    ISSUE_TITLE: '[upgrade] Test Product',
    ISSUE_USER: 'original-owner',
  }));

  assert.equal(r.code, 1);
  assert.equal(rejection(r.result).code, 'not_found');
});

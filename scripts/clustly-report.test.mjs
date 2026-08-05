import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildReport, projectScore, ranked, fixFor } from './clustly-report.mjs';
import { scoreChecks, CHECK_META, V2_WEIGHTS, SNIPPETS } from '../worker/audit.js';

// The twenty checks with their real weights, as /api/score returns them. Built
// from the shipped weight tables rather than hand-typed, so a reweighting shows
// up here as a changed expectation instead of a stale fixture that still passes.
const ALL = [
  ...Object.entries(CHECK_META).map(([id, m]) => ({ id, weight: m.weight })),
  ...Object.entries(V2_WEIGHTS).map(([id, weight]) => ({ id, weight })),
];

const payload = (passingIds = []) => ({
  ok: true,
  url: 'https://buyer.example/',
  audited_at: '2026-08-05T11:07:33.697Z',
  check_set: 'v2',
  max_score: 100,
  total_checks: ALL.length,
  checks: ALL.map((c) => ({ ...c, pass: passingIds.includes(c.id) })),
  ...(() => {
    const checks = ALL.map((c) => ({ ...c, pass: passingIds.includes(c.id) }));
    const { score, grade } = scoreChecks(checks);
    return { score, grade, letter: undefined, passed: checks.filter((c) => c.pass).length };
  })(),
});

test('the projection uses the auditor\'s own arithmetic, not a second opinion', () => {
  // A sold report that projects "apply these and you reach 87" against a free
  // grade that then says 84 is the one error a buyer is guaranteed to catch —
  // they re-run the free check, which the report tells them to do.
  for (const passing of [[], ['https'], ['https', 'json_ld', 'llms_txt'], ALL.map((c) => c.id)]) {
    const checks = ALL.map((c) => ({ ...c, pass: passing.includes(c.id) }));
    assert.equal(projectScore(checks), scoreChecks(checks).score);
  }
});

test('applying every failing fix reaches exactly 100', () => {
  const checks = ALL.map((c) => ({ ...c, pass: false }));
  assert.equal(projectScore(checks, new Set(ALL.map((c) => c.id))), 100);
});

test('every scorable check has a remedy to sell', () => {
  // A check with no `fix` renders as a numbered heading with nothing under it.
  // In a free grade that is a cosmetic gap; in a deliverable someone paid for it
  // is the section they paid for, missing.
  for (const { id } of ALL) {
    assert.ok(fixFor(id), `check "${id}" has no fix text — it would ship an empty section`);
  }
});

test('failures are ranked by points, and ties are stable', () => {
  const checks = ALL.map((c) => ({ ...c, pass: false }));
  const order = ranked(checks).map((c) => c.id);
  const weights = ranked(checks).map((c) => c.weight);
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a));
  // Same input twice → same order. The report is regenerated on a revision, and
  // a reshuffled document would make the diff unreadable.
  assert.deepEqual(ranked(checks).map((c) => c.id), order);
});

test('the report is deterministic', () => {
  const p = payload(['https']);
  assert.equal(buildReport(p, { orderId: 'ord_1' }), buildReport(p, { orderId: 'ord_1' }));
});

test('snippets are written for the buyer\'s origin, never ours or example.com', () => {
  const md = buildReport(payload([]), {});
  assert.ok(md.includes('https://buyer.example'), 'the buyer\'s origin should appear in the snippets');
  assert.ok(!md.includes('{{ORIGIN}}'), 'an unsubstituted placeholder shipped to a paying buyer');
  // The llms.txt snippet is the one with the most origin substitutions; if the
  // replacement silently no-opped, this is where it shows.
  assert.ok(md.includes('https://buyer.example/llms.txt'));
});

test('a failing check with a snippet ships the code; one without says why not', () => {
  const md = buildReport(payload([]), {});
  assert.ok(SNIPPETS.json_ld, 'fixture assumption: json_ld has a snippet');
  assert.ok(!SNIPPETS.https, 'fixture assumption: https has none');
  assert.ok(md.includes('Paste-ready, already pointed at your origin'));
  assert.ok(md.includes('No paste-ready template here'));
});

test('a perfect site still gets a deliverable, not an empty document', () => {
  const md = buildReport(payload(ALL.map((c) => c.id)), {});
  assert.ok(md.includes('Nothing is failing'));
  assert.ok(!md.includes('## Fix these first'));
  assert.ok(md.includes('/api/score?url='), 'even a clean report should hand over the re-check');
  assert.ok(md.length > 800, 'a passing audit is still a report someone paid for');
});

test('the report says the grade itself is free', () => {
  // Deliberate product claim, asserted so it cannot be quietly dropped: the buyer
  // can run /api/score in one curl. Being first to say so is the difference
  // between candour and being caught overcharging for a free number.
  const md = buildReport(payload(['https']), {});
  assert.match(md, /free and always have been/);
});

test('the order id and revision note are stamped when given, absent when not', () => {
  const p = payload(['https']);
  assert.ok(buildReport(p, { orderId: 'ord_abc' }).includes('ord_abc'));
  assert.ok(!buildReport(p, {}).includes('**Order:**'));
  assert.match(buildReport(p, { rerunOf: '2026-08-01T00:00:00Z' }), /re-audited after the report of 2026-08-01/);
});

test('the header block renders as separate lines, not one run-on paragraph', () => {
  // Markdown folds consecutive lines into a paragraph. Without a hard break the
  // grade, the date and the order id ran together on the first real render —
  // invisible in the source, obvious in the document the buyer opens.
  const md = buildReport(payload(['https']), { orderId: 'ord_1' });
  const head = md.split('\n---\n')[0];
  for (const label of ['**Target:**', '**Audited:**', '**Grade:**', '**Checks passed:**']) {
    const line = head.split('\n').find((l) => l.startsWith(label));
    assert.ok(line, `${label} missing from the header`);
    assert.ok(line.endsWith('  '), `${label} needs a trailing hard break or it folds into the next line`);
  }
});

test('weight and score are never called by the same name', () => {
  // A weight-15 check moves a 122-point scale by 12, so calling both "points"
  // made the report contradict itself in adjacent sentences ("Worth 15 points …
  // +12"). Weight is weight; score is /100.
  const md = buildReport(payload([]), {});
  assert.ok(md.includes('**Weight 15**'));
  assert.ok(md.includes('Recoverable weight'));
  assert.ok(!md.includes('Points recoverable'));
  assert.ok(!/Worth \d+ points/.test(md));
});

test('the report delivers everything the listing commits to on chain', async () => {
  // `default_criteria` is sha256'd into the order's `criteria_hash` at hire and
  // cannot be edited afterwards by either side. So the listing is not marketing
  // copy — it is the specification this generator is held to, and a line added
  // there without a section here is a promise the agent cannot keep. Both
  // directions of that drift are what this test exists to catch.
  const listing = JSON.parse(await readFile(new URL('../clustly/listing.json', import.meta.url), 'utf8'));
  const md = buildReport(payload(['https', 'json_ld']), {});

  assert.match(md, /\*\*Grade:\*\* [A-F] — \d+\/100/, 'promised: a letter grade and a score out of 100');
  assert.match(md, /\*\*Checks passed:\*\* \d+ of 20/, 'promised: checks passed out of 20');
  assert.match(md, /## Fix these first/, 'promised: the failing checks, ordered');
  assert.match(md, /\*\*Weight \d+\*\*/, 'promised: ordered by weight');
  assert.match(md, /Paste-ready, already pointed at your origin/, 'promised: code written for their domain');
  assert.match(md, /score after this fix and the ones above it/, 'promised: the cumulative projection');
  assert.match(md, /## Already passing/, 'promised: the checks that already pass');
  assert.match(md, /api\/score\?url=/, 'promised: a free URL to re-check');

  // The scope disclaimer has to stay true too: this audit says nothing about
  // keywords, backlinks or page speed, and the report must not imply otherwise.
  assert.ok(listing.default_criteria.includes('Out of scope'));
  for (const excluded of ['keyword', 'backlink', 'Core Web Vitals', 'page speed']) {
    assert.ok(!md.toLowerCase().includes(excluded.toLowerCase()), `report mentions out-of-scope "${excluded}"`);
  }
});

test('a malformed target degrades instead of throwing', () => {
  // `url` comes back from the auditor after redirects; it has always been a URL.
  // But this runs unattended against a stranger's input, and a report generator
  // that throws leaves an accepted order undelivered — which is worse for the
  // agent's on-chain reputation than an ugly heading.
  const p = { ...payload([]), url: 'not-a-url' };
  const md = buildReport(p, {});
  assert.ok(md.includes('not-a-url'));
});

// The Clustly deliverable — the report a buyer hires this agent to produce.
//
// Built from the FREE `/api/score` response plus the pure fix tables in
// worker/audit.js, and deliberately NOT from the paid `POST /api/audit`:
//
//   * The paid endpoint is x402-gated. Calling it from here would mean this
//     agent holding a spending key — the one invariant the Router was built
//     around ("the router probes; it never pays"). Paying our own address to
//     serve our own customer is also a round trip through a facilitator for
//     money that never leaves.
//   * `auditUrl()` needs HTMLRewriter, a Worker global. It cannot run under
//     plain Node at all, and plain Node is where this agent runs.
//   * The fixes and snippets here are the SAME constants the paid endpoint
//     serves — CHECK_META, SIGNAL_META and SNIPPETS are imported, never
//     re-typed — so what a Clustly buyer receives and what an x402 caller buys
//     cannot drift apart.
//
// What is sold is the report: the diagnosis ordered by what each fix is worth,
// written for one origin, with the code to paste. The raw grade behind it has
// always been free, and the deliverable says so — a buyer who later runs
// /api/score themselves should find us already honest about it, not caught.

import { CHECK_META, SIGNAL_META, CHECK_LABELS, SNIPPETS, snippetFor, letterGrade } from '../worker/audit.js';

/**
 * The remedy for one check id.
 *
 * The 20 scored checks are split across two tables — the thirteen 2025 checks
 * in CHECK_META, the seven 2026 signals in SIGNAL_META — but `/api/score`
 * returns them in one flat `checks` array. Reading both here is what lets the
 * report treat all 20 uniformly instead of knowing which era a check came from.
 */
export function fixFor(id) {
  return CHECK_META[id]?.fix ?? SIGNAL_META[id]?.fix ?? null;
}

/** The human label for a check id, falling back to the id rather than throwing. */
export function labelFor(check) {
  return check.label ?? CHECK_LABELS[check.id] ?? SIGNAL_META[check.id]?.label ?? check.id;
}

const weightOf = (c) => (Number.isFinite(c.weight) ? c.weight : 0);

/**
 * Percentage of achievable weight, given a set of checks treated as passing.
 *
 * Byte-for-byte the same arithmetic as `scoreChecks()` in worker/audit.js —
 * `Math.round((earned / totalWeight) * 100)` over the derived denominator. It is
 * duplicated rather than imported because that function takes whole check
 * objects and this one has to answer a hypothetical ("what if these also
 * passed?"). If the auditor's formula ever changes, the projection in a sold
 * report would silently stop matching the free grade the buyer re-runs, so the
 * test asserts the two agree on a real payload.
 */
export function projectScore(checks, alsoPassing = new Set()) {
  const total = checks.reduce((sum, c) => sum + weightOf(c), 0);
  const earned = checks.reduce(
    (sum, c) => sum + (c.pass || alsoPassing.has(c.id) ? weightOf(c) : 0),
    0,
  );
  return total ? Math.round((earned / total) * 100) : 0;
}

/**
 * Failing checks, heaviest first.
 *
 * Ties break on id so the same audit always produces the same document. The
 * repo builds deterministically everywhere else; a deliverable that reshuffles
 * its own sections between two runs of the same order would be the one place
 * that does not, and a buyer requesting a revision would get a diff full of
 * noise.
 */
export function ranked(checks) {
  return checks
    .filter((c) => !c.pass)
    .slice()
    .sort((a, b) => weightOf(b) - weightOf(a) || String(a.id).localeCompare(String(b.id)));
}

const fence = (body) => `\`\`\`\n${body}\n\`\`\``;

/** ISO instant → the date alone. The audit is a statement about a day, not a second. */
const day = (iso) => String(iso ?? '').slice(0, 10);

/**
 * The whole deliverable, as markdown.
 *
 * Pure: everything it needs is in `score` (a parsed `/api/score` body) and the
 * imported tables. That is what makes it testable without a network call, and
 * what lets the agent re-render a report for a revision without re-auditing if
 * it ever needs to.
 *
 * @param {object} score  parsed body of GET /api/score?url=…
 * @param {object} [opts]
 * @param {string} [opts.base]     origin that served the audit, for the re-check link
 * @param {string} [opts.orderId]  Clustly order id, stamped for support
 * @param {string} [opts.rerunOf]  prior report's audit date, when this is a revision
 */
export function buildReport(score, opts = {}) {
  const base = (opts.base ?? 'https://index.percall.dev').replace(/\/+$/, '');
  const checks = Array.isArray(score.checks) ? score.checks : [];
  const target = score.url ?? '';
  let origin = target;
  try { origin = new URL(target).origin; } catch { /* keep the raw string */ }

  const failing = ranked(checks);
  const passing = checks.filter((c) => c.pass);
  const totalWeight = checks.reduce((sum, c) => sum + weightOf(c), 0);
  const recoverable = failing.reduce((sum, c) => sum + weightOf(c), 0);
  const perfect = projectScore(checks, new Set(failing.map((c) => c.id)));
  const host = (() => { try { return new URL(target).host; } catch { return target; } })();

  const out = [];

  out.push(`# Agent-readability audit — ${host}`);
  out.push('');
  // Joined with a hard line break rather than pushed as separate lines: markdown
  // folds consecutive lines into one paragraph, which ran the whole header block
  // together on the first real render.
  const header = [
    `**Target:** ${target}`,
    `**Audited:** ${day(score.audited_at)} (UTC)`,
    `**Grade:** ${score.letter ?? letterGrade(score.score ?? 0)} — ${score.score}/${score.max_score ?? 100}${score.grade ? ` ("${score.grade}")` : ''}`,
    `**Checks passed:** ${score.passed ?? passing.length} of ${score.total_checks ?? checks.length}`,
  ];
  if (opts.orderId) header.push(`**Order:** \`${opts.orderId}\``);
  if (opts.rerunOf) header.push(`**Revision:** re-audited after the report of ${day(opts.rerunOf)}`);
  out.push(header.join('  \n'));
  out.push('');
  out.push('---');
  out.push('');

  out.push('## What this measures');
  out.push('');
  out.push(
    'Twenty checks on whether an AI agent — a crawler, an assistant answering a question about you, ' +
    'or another program acting for a user — can read this site and cite it correctly. It is not SEO ' +
    'for search engines: it scores the machine-readable surfaces agents actually fetch (`llms.txt`, ' +
    'schema.org JSON-LD, `robots.txt` posture toward AI crawlers, agent cards, machine-readable ' +
    'alternates), weighted by how much each one changes what an agent can say about you.',
  );
  out.push('');
  out.push(
    `Each check carries a **weight** — its share of the ${totalWeight} points on offer. The score is the ` +
    'percentage of that total you have earned, so a weight-15 check is worth about ' +
    `${Math.round((15 / totalWeight) * 100)} points of score, and the fixes below are already in the order ` +
    'that buys the most.',
  );
  out.push('');

  out.push('## Summary');
  out.push('');
  out.push('| | |');
  out.push('|---|---|');
  out.push(`| Grade | **${score.letter ?? letterGrade(score.score ?? 0)}** (${score.score}/${score.max_score ?? 100}) |`);
  out.push(`| Checks passed | ${score.passed ?? passing.length} / ${score.total_checks ?? checks.length} |`);
  out.push(`| Failing checks | ${failing.length} |`);
  out.push(`| Recoverable weight | ${recoverable} of ${totalWeight} |`);
  out.push(`| Score with everything below applied | **${perfect}/100** (${letterGrade(perfect)}) |`);
  out.push('');

  if (!failing.length) {
    out.push('## Nothing is failing');
    out.push('');
    out.push(
      'All twenty checks pass. That is rare and worth keeping: the surfaces below are the ones ' +
      'that decay silently — a deploy that drops `llms.txt`, a `robots.txt` edit that catches an ' +
      'AI user-agent in a wildcard, a JSON-LD block broken by a template change. None of them ' +
      'breaks a page a human looks at, so nothing tells you.',
    );
    out.push('');
    out.push('Re-run the free check after any deploy that touches routing, `robots.txt`, or `<head>`:');
    out.push('');
    out.push(fence(`${base}/api/score?url=${encodeURIComponent(target)}`));
    out.push('');
  } else {
    out.push('## Fix these first');
    out.push('');
    out.push(`Ordered by weight. Applying all ${failing.length} takes the score to **${perfect}/100**.`);
    out.push('');

    let running = score.score ?? 0;
    const applied = new Set();
    failing.forEach((check, i) => {
      applied.add(check.id);
      const after = projectScore(checks, applied);
      const gained = after - running;
      running = after;

      out.push(`### ${i + 1}. ${labelFor(check)}`);
      out.push('');
      out.push(`**Weight ${weightOf(check)}** · score after this fix and the ones above it: **${after}/100** (${letterGrade(after)}${gained > 0 ? `, +${gained}` : ''})`);
      out.push('');
      const fix = fixFor(check.id);
      if (fix) {
        out.push(fix);
        out.push('');
      }
      const snippet = snippetFor(check.id, origin);
      if (snippet) {
        out.push('Paste-ready, already pointed at your origin:');
        out.push('');
        out.push(fence(snippet));
        out.push('');
      } else if (!SNIPPETS[check.id]) {
        // Saying why there is no snippet beats an empty section implying we
        // forgot. The wording has to hold for every snippet-less check, and they
        // are not all "server config" — a Web Bot Auth directory and an MCP
        // server card are very much files, they just cannot be templated because
        // their contents are the buyer's own keys and endpoints.
        out.push('*No paste-ready template here: the fix above is the whole instruction, but what goes in it is specific to your own service.*');
        out.push('');
      }
    });
  }

  if (passing.length) {
    out.push('## Already passing');
    out.push('');
    out.push('Listed so the report is the whole picture, and so a future deploy that breaks one is visible as a regression.');
    out.push('');
    for (const c of passing.slice().sort((a, b) => weightOf(b) - weightOf(a) || String(a.id).localeCompare(String(b.id)))) {
      out.push(`- ${labelFor(c)} (weight ${weightOf(c)})`);
    }
    out.push('');
  }

  out.push('## Verify this yourself');
  out.push('');
  out.push(
    'The grade and the list of which checks failed are free and always have been — this report is ' +
    'the diagnosis, the ordering, and the code, not access to the number. Re-run it any time, ' +
    'no signup, to confirm a fix landed:',
  );
  out.push('');
  out.push(fence(`curl "${base}/api/score?url=${encodeURIComponent(target)}"`));
  out.push('');
  out.push(
    'Fixes are usually visible to the checker within a minute of deploying, except `robots.txt` ' +
    'and `llms.txt`, which are cached for an hour per URL.',
  );
  out.push('');

  out.push('---');
  out.push('');
  out.push(`*Audit run ${day(score.audited_at)} against ${target}. Checks: set \`${score.check_set ?? 'v2'}\`, ${score.total_checks ?? checks.length} scored.*`);

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

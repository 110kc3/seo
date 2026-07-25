// GET /badge.svg?slug=… — the badge a listed product puts in its README.
//
// Why this exists: a directory nobody links to is a directory nobody finds. A
// badge is the cheapest reciprocal link there is — the listee gets a credential
// to show off, and every README carrying one is an inbound link that both
// crawlers and agents follow back here. It is also a reason to register at all.
//
// Deliberately cheap to serve: it reads the committed registry, never audits
// anything, and is immutable-ish with a long cache. GitHub proxies README images
// through camo, so origin hits are rare, but an endpoint reachable from every
// page view of every listee still has no business doing real work.
//
// SVG is hand-built rather than proxied to shields.io: one fewer third party in
// the path, no dependency, and nothing that can rewrite what our own badge says.

const FONT = 11;
// Verdana-ish advance widths at 11px, good enough that text never overflows its
// pill. Wider than truth is safe; narrower clips.
const WIDE = new Set('mwMW@%'.split(''));
const NARROW = new Set("iljtfrI'.,:;!|()[]{} ".split(''));

function textWidth(text) {
  let w = 0;
  for (const ch of text) {
    if (WIDE.has(ch)) w += 9.5;
    else if (NARROW.has(ch)) w += 3.6;
    else if (ch >= 'A' && ch <= 'Z') w += 7.8;
    else if (ch >= '0' && ch <= '9') w += 6.8;
    else w += 6.4;
  }
  return Math.ceil(w);
}

const esc = (s) => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

const COLOURS = {
  featured: '#8250df',
  verified: '#0b6e4f',
  free: '#31708f',
  unknown: '#6a737d',
};

// Grade colours, so a badge reads at a glance without anyone parsing the letter.
const GRADE_COLOURS = { A: '#0b6e4f', B: '#4c9141', C: '#a8791b', D: '#c26a1c', E: '#b3402f', F: '#9b2c1e' };

/**
 * Shields-style two-pill badge. Pure and exported so its geometry and escaping
 * are testable without a runtime.
 */
export function badgeSvg(label, message, colour) {
  const padding = 9;
  const labelW = textWidth(label) + padding * 2;
  const messageW = textWidth(message) + padding * 2;
  const total = labelW + messageW;
  const alt = `${label}: ${message}`;

  // Text is drawn twice — once as a dark shadow, once on top — which is how
  // shields gets legible glyphs at this size without hinting.
  const text = (content, x, w) => `
    <text x="${(x + w / 2) * 10}" y="150" fill="#010101" fill-opacity=".3"
          transform="scale(.1)" textLength="${(w - padding * 2) * 10}">${esc(content)}</text>
    <text x="${(x + w / 2) * 10}" y="140" transform="scale(.1)"
          textLength="${(w - padding * 2) * 10}">${esc(content)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${esc(alt)}">
  <title>${esc(alt)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="20" fill="#555"/>
    <rect x="${labelW}" width="${messageW}" height="20" fill="${colour}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="${FONT}0" text-rendering="geometricPrecision">
${text(label, 0, labelW)}
${text(message, labelW, messageW)}
  </g>
</svg>
`;
}

const svg = (body, maxAge) => new Response(body, {
  headers: {
    'content-type': 'image/svg+xml; charset=utf-8',
    // Long enough that a busy README costs us nothing; short enough that a tier
    // upgrade shows up the same day.
    'cache-control': `public, max-age=${maxAge}`,
    'x-content-type-options': 'nosniff',
  },
});

/**
 * @param {object[]} listings the committed registry
 * @param {Record<string, {letter: string, score: number}>} scores  from
 *   scores.json, refreshed weekly by scripts/score-listings.mjs. Not computed
 *   here on purpose: this renders in other people's READMEs, so it is hit by
 *   every page view of every listee, and auditing a site per image request would
 *   mean seven outbound fetches to draw a picture.
 */
export function handleBadge(url, listings, scores = {}) {
  const slug = (url.searchParams.get('slug') ?? '').trim().toLowerCase();
  const wantScore = url.searchParams.get('show') === 'score';
  const label = (url.searchParams.get('label')
    ?? (wantScore ? 'Agent Readability' : 'AI Agent Ready')).slice(0, 40);

  if (!slug) {
    // No slug is not an error worth an error image — every badge request comes
    // from an <img>, where a 4xx renders as a broken icon in someone's README.
    // Say what is wrong, in the badge itself.
    return svg(badgeSvg(label, 'pass ?slug=', COLOURS.unknown), 300);
  }

  const listing = listings.find((l) => l.slug === slug);
  if (!listing) return svg(badgeSvg(label, 'not indexed', COLOURS.unknown), 300);

  if (wantScore) {
    const graded = scores[slug];
    // A listing scored before the weekly run has reached it says so, rather than
    // implying an F.
    if (!graded?.letter) return svg(badgeSvg(label, 'not scored yet', COLOURS.unknown), 900);
    return svg(
      badgeSvg(label, `${graded.letter} · ${graded.score}/100`, GRADE_COLOURS[graded.letter] ?? COLOURS.unknown),
      3600,
    );
  }

  const tier = listing.tier === 'featured' || listing.tier === 'verified' ? listing.tier : 'indexed';
  return svg(badgeSvg(label, tier, COLOURS[listing.tier] ?? COLOURS.free), 3600);
}

export const __testing = { textWidth, esc, COLOURS, GRADE_COLOURS };

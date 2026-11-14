
const FONT = 11;
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
    'cache-control': `public, max-age=${maxAge}`,
    'x-content-type-options': 'nosniff',
  },
});

export function handleBadge(url, listings, scores = {}) {
  const slug = (url.searchParams.get('slug') ?? '').trim().toLowerCase();
  const wantScore = url.searchParams.get('show') === 'score';
  const label = (url.searchParams.get('label')
    ?? (wantScore ? 'Agent Readability' : 'AI Agent Ready')).slice(0, 40);

  if (!slug) {
    return svg(badgeSvg(label, 'pass ?slug=', COLOURS.unknown), 300);
  }

  const listing = listings.find((l) => l.slug === slug);
  if (!listing) return svg(badgeSvg(label, 'not indexed', COLOURS.unknown), 300);

  if (wantScore) {
    const graded = scores[slug];
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

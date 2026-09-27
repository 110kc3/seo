// Shared by the generated browser script and the rendering/security tests.
// Keep these functions self-contained: pages.mjs embeds their source directly.
export function catalogResults(rows, columns, kind) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const safeUrl = (s) => {
    try {
      const u = new URL(s);
      return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password
        && !/[{}]/.test(s) ? u.href : null;
    } catch { return null; }
  };
  return '<ul class="catalog-results">' + rows.map((r) => {
    const url = safeUrl(r.url);
    const endpoint = url
      ? '<a href="' + esc(url) + '" rel="nofollow noopener">' + esc(r.url) + '</a>'
      : '<code>' + esc(r.url) + '</code> (not a ready-to-use HTTP URL)';
    const fields = columns.filter((c) => !['url', 'title', 'description'].includes(c.key)).map((c) => {
      const value = r[c.key];
      let display = value == null || value === '' ? 'Not supplied' : String(value);
      if (c.money) display = typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? '$' + value.toFixed(4) + ' USD equivalent (catalog quote)' : 'Price unknown';
      if (c.key === 'auth') display = value === 'none' ? 'No credentials declared; may still cost money'
        : value === 'required' ? 'Credentials required' : 'Authentication unknown';
      return '<div><dt>' + esc(c.label) + '</dt><dd>' + esc(display) + '</dd></div>';
    }).join('');
    const h = r.health;
    let status = 'Unverified — no per-endpoint success observation is available.';
    if (h?.state === 'failed' || r.unreachable) {
      status = h?.misses >= 2 || r.unreachable ? 'Repeated probe failures' : 'One probe failed';
      status += h?.last_checked ? ' — last checked ' + h.last_checked : ' — observation date unavailable';
      if (h?.reason) status += ': ' + h.reason;
      status += '. This is an observation, not proof that the endpoint is still unavailable.';
    }
    const next = !url ? 'Ask the provider for a complete endpoint URL before connecting.'
      : kind === 'mcp'
        ? 'Use this URL in an MCP client that supports the declared transport. Confirm credentials and provider pricing before connecting.'
        : 'Use an x402-compatible client with the listed HTTP method and chain. Confirm current terms before authorizing any payment.';
    return '<li><article><h3>' + esc(r.title || r.name || 'Endpoint') + '</h3>'
      + '<p class="endpoint">' + endpoint + '</p>'
      + '<p>' + esc(r.description || 'Description not supplied.') + '</p>'
      + '<dl class="result-fields">' + fields + '</dl>'
      + '<p class="health"><strong>Health:</strong> ' + esc(status) + '</p>'
      + '<p><strong>Next step:</strong> ' + esc(next) + '</p>'
      + '<p class="meta">Provider setup documentation is not supplied by this search result. '
      + '<a href="#connection-guide">Read the connection checklist</a>.</p></article></li>';
  }).join('') + '</ul>';
}

export function catalogBrowser(config, render) {
  const form = document.getElementById('q-form');
  const out = document.getElementById('q-out');
  const button = form.querySelector('button');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const params = new URLSearchParams(new FormData(form));
    for (const [key, value] of [...params]) {
      if (!value.trim()) params.delete(key);
      else params.set(key, value.trim());
    }
    params.set('limit', '25');
    button.disabled = true;
    out.setAttribute('aria-busy', 'true');
    out.textContent = 'Searching…';
    try {
      const response = await fetch(config.searchPath + '?' + params, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('Search unavailable');
      const data = await response.json();
      if (data.ok === false || !Array.isArray(data.results)) throw new Error('Invalid results');
      if (!data.results.length) {
        out.textContent = 'No matches in this catalog with these filters. Try broader terms or remove a filter.';
      } else {
        out.innerHTML = render(data.results, config.columns, config.kind);
        const summary = document.createElement('p');
        summary.className = 'meta';
        summary.textContent = data.results.length + ' of ' + data.total + ' matches shown. '
          + 'Unverified and failed endpoints stay visible. A response does not prove a tool works or that authorization will succeed.';
        out.prepend(summary);
      }
    } catch {
      out.textContent = 'Search is unavailable. Try again; this is not a zero-result search.';
    } finally {
      button.disabled = false;
      out.setAttribute('aria-busy', 'false');
    }
  });
}

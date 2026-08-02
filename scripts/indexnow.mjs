// Announce changed URLs to IndexNow (Bing, Yandex, Seznam — one endpoint).
//
// Why this exists: this site had no way to tell a search engine it had changed.
// It waited to be crawled, which for a domain with almost no inbound links is a
// long wait, and Bing's index is what ChatGPT search reads. IndexNow is a push.
//
// The rule is *changed* URLs, not all of them. Resubmitting seventy unchanged
// URLs on every deploy is how a submitter gets ignored, and the protocol asks
// callers not to. So the caller passes the files this push touched — normally
// `git diff --name-only` — and this maps them to URLs.
//
// Two filters, both deliberate:
//   1. A URL must appear in sitemap.xml. That makes the sitemap the single list
//      of what this site claims to publish; api/*.json and llms.txt are served
//      but are not pages, and submitting them says otherwise.
//   2. A URL must be on the canonical host. The key file proves control of one
//      host, and the apex serves exactly one path so it cannot host one. Its
//      single URL is submitted by hand — see NEXT.md §1.8.
//
// Never fails a deploy. A search-engine ping that breaks a release is worse
// than a ping that was missed.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/** The URLs a sitemap claims, as a Set, so membership is the published test. */
export function sitemapUrls(xml) {
  return new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
}

/**
 * Repo-relative paths → the URLs they are published at.
 *
 * Directory index files collapse to the directory (`checks/index.html` is
 * served at `/checks/`, and that is the form the sitemap carries), so a
 * submitted URL and a crawled one are the same string.
 */
export function changedUrls(files, xml, base) {
  const published = sitemapUrls(xml);
  const urls = new Set();
  for (const f of files) {
    const p = f.replace(/^\.\//, '');
    if (!p.endsWith('.html')) continue;
    const path = p === 'index.html' ? '/' : `/${p.replace(/(^|\/)index\.html$/, '$1')}`;
    const url = `${base}${path}`;
    if (published.has(url)) urls.add(url);
  }
  return [...urls].sort();
}

export async function submit({ urls, key, base, fetchImpl = fetch }) {
  const host = new URL(base).host;
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation: `${base}/${key}.txt`, urlList: urls }),
  });
  return { status: res.status, ok: res.ok };
}

// --- CLI --------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
  const base = cfg.base.replace(/\/+$/, '');
  const key = cfg.indexnow_key;
  const files = process.argv.slice(2);

  if (!key) {
    console.log('indexnow: no indexnow_key in site.config.json — nothing to submit');
    process.exit(0);
  }
  const xml = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  const urls = changedUrls(files, xml, base);
  if (!urls.length) {
    console.log(`indexnow: no published pages among ${files.length} changed file(s)`);
    process.exit(0);
  }

  console.log(`indexnow: submitting ${urls.length} URL(s)\n${urls.map((u) => `  ${u}`).join('\n')}`);
  try {
    // 200 = accepted, 202 = accepted but the key is still being validated.
    // Both are fine; anything else is reported and forgiven.
    const { status, ok } = await submit({ urls, key, base });
    console.log(`indexnow: ${status}${ok ? '' : ' — not accepted, see https://www.indexnow.org/documentation'}`);
  } catch (e) {
    console.log(`indexnow: submission failed (${e.message}) — deploy is unaffected`);
  }
}

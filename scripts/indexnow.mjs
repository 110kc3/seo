import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = 'https://api.indexnow.org/indexnow';

export function sitemapUrls(xml) {
  return new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
}

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
    const { status, ok } = await submit({ urls, key, base });
    console.log(`indexnow: ${status}${ok ? '' : ' — not accepted, see https://www.indexnow.org/documentation'}`);
  } catch (e) {
    console.log(`indexnow: submission failed (${e.message}) — deploy is unaffected`);
  }
}

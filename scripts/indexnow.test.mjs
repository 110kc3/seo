import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { changedUrls, submit } from './indexnow.mjs';

const BASE = 'https://index.percall.dev';
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc>${BASE}/</loc></url>
  <url><loc>${BASE}/report.html</loc></url>
  <url><loc>${BASE}/checks/</loc></url>
  <url><loc>${BASE}/l/avo.html</loc></url>
  <url><loc>https://percall.dev/</loc></url>
</urlset>`;

test('changed files map to the URLs the sitemap publishes', () => {
  assert.deepEqual(
    changedUrls(['index.html', 'report.html', 'l/avo.html', 'checks/index.html'], XML, BASE),
    [`${BASE}/`, `${BASE}/checks/`, `${BASE}/l/avo.html`, `${BASE}/report.html`],
  );
});

test('only pages are submitted, and only ones the sitemap claims', () => {
  // Served, but not pages: submitting them tells Bing this site publishes
  // things it does not list, and the sitemap is meant to be that list.
  assert.deepEqual(changedUrls(['api/index.json', 'llms.txt', 'scores.json', 'worker/index.js'], XML, BASE), []);
  // A page that exists on disk but never reached the sitemap is a build bug,
  // and announcing it would hide the bug behind a crawl.
  assert.deepEqual(changedUrls(['dashboard.html'], XML, BASE), []);
});

test('the apex is never submitted on the canonical host key', () => {
  // The key file proves control of one host. The apex serves exactly one path
  // and so cannot host a key file at all — submitting its URL under this key
  // is a rejection at best and a bad-actor signal at worst.
  assert.deepEqual(changedUrls(['apex.html'], XML, BASE), []);
  assert.ok(!changedUrls(['index.html'], XML, BASE).some((u) => u.includes('percall.dev/')
    && !u.startsWith(BASE)));
});

test('the payload carries the key, its location and the host', async () => {
  let sent = null;
  const res = await submit({
    urls: [`${BASE}/report.html`],
    key: 'abc123',
    base: BASE,
    fetchImpl: async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return { status: 200, ok: true };
    },
  });
  assert.equal(res.status, 200);
  assert.equal(sent.url, 'https://api.indexnow.org/indexnow');
  assert.deepEqual(sent.body, {
    host: 'index.percall.dev',
    key: 'abc123',
    keyLocation: `${BASE}/abc123.txt`,
    urlList: [`${BASE}/report.html`],
  });
});

test('the key file the build writes is the key the submitter sends', async () => {
  // Two copies of one value, in a repo where the mismatch would be invisible:
  // the file 404s, the submission is refused, and nothing surfaces an error.
  const cfg = JSON.parse(await readFile(new URL('../site.config.json', import.meta.url), 'utf8'));
  assert.match(cfg.indexnow_key, /^[a-f0-9]{8,128}$/, 'the key must be 8-128 hex characters');
  const file = await readFile(new URL(`../${cfg.indexnow_key}.txt`, import.meta.url), 'utf8');
  assert.equal(file.trim(), cfg.indexnow_key);
});

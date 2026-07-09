import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, reconstruct, esc, jsonLd, normalizeUrl, urlError, schemaJson } from './validate.mjs';

const valid = () => ({
  slug: 'test-product',
  name: 'Test Product',
  url: 'https://example.com/tool',
  description: 'A test product that does things.',
  category: 'api',
  pricing: 'free',
});

test('accepts a minimal valid listing', () => {
  assert.deepEqual(validate(valid()), { ok: true, errors: [] });
});

test('accepts optional fields and echoed server fields', () => {
  const l = {
    ...valid(),
    machine_endpoints: { llms_txt: 'https://example.com/llms.txt', mcp: 'https://example.com/mcp' },
    tags: ['ai', 'test-tag'],
    submitted_by: 'Test Agent v1',
    created: '2020-01-01',
    github_user: 'whoever',
    tier: 'featured',
  };
  assert.equal(validate(l).ok, true);
});

test('rejects non-object payloads', () => {
  for (const bad of [null, [], 'x', 42]) {
    assert.equal(validate(bad).ok, false);
  }
});

test('rejects missing required fields with one error each', () => {
  const res = validate({});
  assert.equal(res.ok, false);
  assert.equal(res.errors.length, 6);
});

test('rejects bad slugs', () => {
  for (const slug of ['ab', 'Ab-cd', '-abc', 'abc-', '../x', 'a b', 'a'.repeat(65), 'a_b_c']) {
    const res = validate({ ...valid(), slug });
    assert.equal(res.ok, false, `slug should be rejected: ${slug}`);
    assert.match(res.errors.join(';'), /slug/);
  }
});

test('accepts boundary slugs', () => {
  for (const slug of ['abc', 'a-1', 'a'.repeat(64)]) {
    assert.equal(validate({ ...valid(), slug }).ok, true, `slug should pass: ${slug}`);
  }
});

test('rejects dangerous or private URLs', () => {
  const cases = [
    'javascript:alert(1)',
    'ftp://example.com/x',
    'file:///etc/passwd',
    'https://localhost/x',
    'https://foo.localhost/x',
    'http://127.0.0.1/x',
    'http://10.0.0.1/x',
    'http://192.168.1.1/x',
    'http://172.16.0.1/x',
    'http://169.254.169.254/latest',
    'http://0.0.0.0/',
    'https://[::1]/x',
    'https://intranet/x',
    'https://foo.local/x',
    'https://foo.internal/x',
    'not a url',
    'https://example.com/' + 'a'.repeat(300),
  ];
  for (const url of cases) {
    const res = validate({ ...valid(), url });
    assert.equal(res.ok, false, `url should be rejected: ${url}`);
  }
});

test('public IP-like domains are not false positives', () => {
  // real-world domains that merely start with digits must pass
  for (const url of ['https://10.tv/x', 'https://127.net/x', 'https://0.example.com/']) {
    assert.equal(validate({ ...valid(), url }).ok, true, `url should pass: ${url}`);
  }
});

test('rejects oversize and control-character text', () => {
  assert.equal(validate({ ...valid(), description: 'a'.repeat(501) }).ok, false);
  assert.equal(validate({ ...valid(), name: 'a'.repeat(81) }).ok, false);
  assert.equal(validate({ ...valid(), name: 'bad\x00name' }).ok, false);
  assert.equal(validate({ ...valid(), name: 'two\nlines' }).ok, false);
  // newlines are allowed in description, other control chars are not
  assert.equal(validate({ ...valid(), description: 'two\nlines' }).ok, true);
  assert.equal(validate({ ...valid(), description: 'bad\x07bell' }).ok, false);
});

test('rejects unknown fields (top level and machine_endpoints)', () => {
  assert.equal(validate({ ...valid(), evil: 'x' }).ok, false);
  assert.equal(validate({ ...valid(), __proto__constructor: 'x' }).ok, false);
  assert.equal(validate({ ...valid(), machine_endpoints: { website: 'https://example.com' } }).ok, false);
});

test('rejects bad tags', () => {
  assert.equal(validate({ ...valid(), tags: ['a', 'b', 'c', 'd', 'e', 'f'] }).ok, false);
  assert.equal(validate({ ...valid(), tags: ['UPPER'] }).ok, false);
  assert.equal(validate({ ...valid(), tags: [1] }).ok, false);
  assert.equal(validate({ ...valid(), tags: ['ok-tag'] }).ok, true);
});

test('reconstruct sets server fields, drops junk, fixes key order', () => {
  const dirty = JSON.parse('{"pricing":"free","category":"api","slug":"test-product","name":"  Test  ","url":"https://example.com/tool","description":" d ","tier":"featured","created":"1999-01-01","github_user":"spoofed","__proto__":{"polluted":true}}');
  const out = reconstruct(dirty, { created: '2026-07-09', github_user: 'realuser' });
  assert.deepEqual(Object.keys(out), ['slug', 'name', 'url', 'description', 'category', 'pricing', 'created', 'github_user', 'tier']);
  assert.equal(out.name, 'Test');
  assert.equal(out.created, '2026-07-09');
  assert.equal(out.github_user, 'realuser');
  assert.equal(out.tier, 'free');
  assert.equal({}.polluted, undefined);
});

test('esc escapes all five HTML-significant characters', () => {
  assert.equal(esc(`<script>alert("x&y'")</script>`), '&lt;script&gt;alert(&quot;x&amp;y&#39;&quot;)&lt;/script&gt;');
});

test('jsonLd blocks </script> breakout', () => {
  const out = jsonLd({ name: 'x</script><script>alert(1)</script>' });
  assert.ok(!out.includes('</script>'));
  assert.ok(out.includes('\\u003c/script'));
});

test('normalizeUrl canonicalizes for dedup', () => {
  assert.equal(normalizeUrl('HTTPS://Example.COM/Path/'), normalizeUrl('https://example.com/Path'));
  assert.equal(normalizeUrl('https://example.com/x#frag'), normalizeUrl('https://example.com/x'));
  assert.notEqual(normalizeUrl('https://example.com/x?a=1'), normalizeUrl('https://example.com/x'));
});

test('urlError returns null for good URLs', () => {
  assert.equal(urlError('https://example.com', 'url'), null);
  assert.equal(urlError('http://sub.example.co.uk/path?q=1', 'url'), null);
});

test('schemaJson matches the validator contract', () => {
  const s = schemaJson('https://example.com/base');
  assert.equal(s.additionalProperties, false);
  assert.deepEqual(s.required, ['slug', 'name', 'url', 'description', 'category', 'pricing']);
  assert.ok(s.properties.tier.readOnly);
  assert.equal(s.$id, 'https://example.com/base/api/schema.json');
});

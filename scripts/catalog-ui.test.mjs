import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogResults } from './catalog-ui.mjs';
import { scoreChecks, letterGrade } from '../worker/audit.js';
import { freeView } from '../worker/score.js';

const columns = [{ key: 'auth', label: 'auth' }, { key: 'price', label: 'price', money: true }];

test('catalog results distinguish dated failures from absent success evidence', () => {
  const html = catalogResults([
    { url: 'https://failed.example/mcp', unreachable: true, health: { state: 'failed', last_checked: '2026-08-01', reason: 'HTTP 502', misses: 2 } },
    { url: 'https://once.example/mcp', health: { state: 'failed', misses: 1 } },
    { url: 'https://unknown.example/mcp', auth: 'none', price: null, health: { state: 'unknown' } },
  ], columns, 'mcp');
  assert.match(html, /Repeated probe failures — last checked 2026-08-01: HTTP 502/);
  assert.match(html, /One probe failed — observation date unavailable/);
  assert.match(html, /Unverified — no per-endpoint success observation/);
  assert.match(html, /Price unknown/);
  assert.match(html, /No credentials declared; may still cost money/);
  assert.match(html, /Provider setup documentation is not supplied/);
  assert.equal((html.match(/<article>/g) ?? []).length, 3, 'failed results must remain visible');
});

test('catalog rendering escapes remote content and refuses executable or placeholder links', () => {
  const html = catalogResults([
    { url: 'javascript:alert(1)', title: '<img src=x onerror=alert(1)>', description: '</script><script>alert(1)</script>', health: { state: 'failed', reason: '<svg onload=alert(1)>', last_checked: '<b>today</b>' } },
    { url: 'https://{tenant}.example/mcp' },
    { url: 'https://user:password@example.com/mcp' },
  ], columns, 'mcp');
  assert.doesNotMatch(html, /href="(?:javascript:|https:\/\/\{|https:\/\/user:)/);
  assert.doesNotMatch(html, /<img|<script|<svg|<b>/);
  assert.match(html, /&lt;img/);
  assert.match(html, /Ask the provider for a complete endpoint URL/);
});

test('x402 results preserve zero prices and give a payment review step', () => {
  const html = catalogResults([{ url: 'https://api.example/weather', price: 0 }], columns, 'x402');
  assert.match(html, /\$0\.0000 USD equivalent/);
  assert.match(html, /Confirm current terms before authorizing any payment/);
});

test('coverage wording keeps numeric scores and letter boundaries unchanged', () => {
  for (const [score, letter] of [[0, 'F'], [29, 'F'], [30, 'F'], [44, 'F'], [45, 'E'], [55, 'E'], [59, 'E'], [60, 'D'], [69, 'D'], [70, 'C'], [79, 'C'], [80, 'B'], [89, 'B'], [90, 'A'], [100, 'A']]) {
    const result = scoreChecks([{ pass: true, weight: score }, { pass: false, weight: 100 - score }]);
    assert.equal(result.score, score);
    assert.equal(letterGrade(result.score), letter);
    assert.match(result.grade, /checklist coverage/);
  }
});

test('free results explain optional interfaces without changing pass/fail or leaking paid fields', () => {
  const result = freeView({ score: 80, letter: 'B', grade: 'agent-ready', checks: [
    { id: 'mcp_server_card', pass: false, weight: 2, detail: 'private detail', fix: 'private fix', snippet: 'private snippet' },
    { id: 'https', pass: true, weight: 5 },
  ] }, {});
  assert.equal(result.grade, 'high checklist coverage');
  assert.equal(result.score, 80);
  assert.equal(result.letter, 'B');
  assert.equal(result.checks[0].scope, 'optional_service');
  assert.equal(result.checks[0].pass, false);
  assert.equal(result.checks[0].weight, 2);
  assert.match(result.checks[0].applicability, /content-only site does not need/);
  assert.equal(result.checks[1].scope, 'site_information');
  assert.match(result.interpretation, /does not measure AI visibility/);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyWindows,
  normalizeHostname,
  parseDays,
  renderMarkdown,
  summarizeTraffic,
} from './cloudflare-traffic-report.mjs';

test('hostname and report window inputs are narrowly validated', () => {
  assert.equal(normalizeHostname(' INDEX.KC-IT.PL. '), 'index.kc-it.pl');
  assert.throws(() => normalizeHostname('https://index.kc-it.pl'), /valid DNS hostname/);
  assert.throws(() => normalizeHostname('example.com/path'), /valid DNS hostname/);
  assert.equal(parseDays('7'), 7);
  assert.throws(() => parseDays('0'), /1 through 7/);
  assert.throws(() => parseDays('1.5'), /1 through 7/);

  assert.deepEqual(dailyWindows({ days: 2, end: new Date('2026-08-31T12:00:00Z') }), [
    { start: '2026-08-29T12:00:00.000Z', end: '2026-08-30T12:00:00.000Z' },
    { start: '2026-08-30T12:00:00.000Z', end: '2026-08-31T12:00:00.000Z' },
  ]);
});

test('daily aggregates are merged without retaining individual events', () => {
  const rum = (human, bot, path, referrer) => ({
    viewer: {
      accounts: [{
        all: [{ count: human + bot, sum: { visits: human }, avg: { sampleInterval: 1 } }],
        humans: [{ count: human, sum: { visits: human - 1 }, avg: { sampleInterval: 1 } }],
        bots: [{ count: bot, sum: { visits: 0 }, avg: { sampleInterval: 1 } }],
        paths: [{ count: human, sum: { visits: human - 1 }, dimensions: { requestPath: path } }],
        referrers: [{ count: human, dimensions: { refererHost: referrer } }],
        countries: [{ count: human, dimensions: { countryName: 'GB' } }],
        devices: [{ count: human, dimensions: { deviceType: 'desktop' } }],
        browsers: [{ count: human, dimensions: { userAgentBrowser: 'Chrome' } }],
        navigations: [{ count: human, dimensions: { navigationType: 'navigate' } }],
      }],
    },
  });
  const edge = (count, path) => ({
    viewer: {
      zones: [{
        total: [{ count, sum: { visits: 2, edgeResponseBytes: count * 100 }, avg: { sampleInterval: 1 } }],
        paths: [{ count, sum: { visits: 2, edgeResponseBytes: count * 100 }, dimensions: { clientRequestPath: path } }],
        statuses: [{ count, dimensions: { edgeResponseStatus: 200 } }],
        cache: [{ count, sum: { edgeResponseBytes: count * 100 }, dimensions: { cacheStatus: 'hit' } }],
      }],
    },
  });

  const report = summarizeTraffic({
    hostname: 'index.kc-it.pl',
    start: '2026-08-29T12:00:00.000Z',
    end: '2026-08-31T12:00:00.000Z',
    rumPayloads: [rum(8, 2, '/', ''), rum(5, 1, '/catalog', 'google.com')],
    edgePayloads: [edge(60, '/'), edge(40, '/catalog')],
  });

  assert.equal(report.web_analytics.page_views, 16);
  assert.equal(report.web_analytics.likely_human_page_views, 13);
  assert.equal(report.web_analytics.likely_bot_page_views, 3);
  assert.equal(report.web_analytics.likely_human_visits, 11);
  assert.deepEqual(report.web_analytics.top_pages.map(({ value, count }) => ({ value, count })), [
    { value: '/', count: 8 },
    { value: '/catalog', count: 5 },
  ]);
  assert.equal(report.edge_analytics.requests, 100);
  assert.equal(report.edge_analytics.response_bytes, 10000);
  assert.equal(JSON.stringify(report).includes('clientIP'), false);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Likely-human page views \| 13/);
  assert.match(markdown, /catalog/);
  assert.match(markdown, /direct \/ none/);
  assert.match(markdown, /9\.8 KiB/);
});

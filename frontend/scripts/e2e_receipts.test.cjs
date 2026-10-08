const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { observeHubRequests } = require('../e2e/hubRequestReceipt');
const ProgressReporter = require('../e2e/progressReporter');

test('hub receipt distinguishes pending, failed and HTTP responses without raw request data', () => {
  const page = new EventEmitter();
  const stop = observeHubRequests(page);
  const request = route => ({ url: () => 'https://example.invalid/api/' + route + '?private=sentinel' });
  const details = request('explore/spot-details/private-id');
  const batch = request('conditions/batch');
  const posts = request('posts/spot/private-id');
  const unrelated = request('unclassified/verify');
  for (const req of [details, batch, posts, unrelated]) page.emit('request', req);
  page.emit('response', { request: () => details, status: () => 503 });
  page.emit('requestfinished', details);
  page.emit('requestfailed', batch);
  const facts = stop();
  assert.deepEqual(facts.map(({ endpoint, state, status }) => ({ endpoint, state, status })), [
    { endpoint: 'details', state: 'finished', status: 503 },
    { endpoint: 'batch', state: 'failed', status: null },
    { endpoint: 'posts', state: 'pending', status: null },
  ]);
  assert.ok(facts.every(fact => Number.isInteger(fact.elapsedMs) && fact.elapsedMs >= 0));
  assert.doesNotMatch(JSON.stringify(facts), /sentinel|private-id|https:|started/);
  assert.equal(page.eventNames().length, 0);
});

test('hub receipt bounds request retention', () => {
  const page = new EventEmitter();
  const stop = observeHubRequests(page);
  for (let i = 0; i < 1000; i++) page.emit('request', { url: () => `https://example.invalid/api/posts/spot/${i}` });
  assert.equal(stop().length, 64);
});

test('an incidental unauthorized response is retained without its identity or URL', () => {
  const page = new EventEmitter();
  const stop = observeHubRequests(page);
  const request = { url: () => 'https://example.invalid/api/unclassified/private-id?private=sentinel' };
  page.emit('response', { request: () => request, status: () => 401 });
  page.emit('requestfinished', request);
  const facts = stop();
  assert.equal(facts[0].endpoint, 'other-unauthorized');
  assert.equal(facts[0].status, 401);
  assert.equal(facts[0].state, 'finished');
  assert.doesNotMatch(JSON.stringify(facts), /private-id|sentinel|example/);
});

test('completed attempt is readable before reporter shutdown and excludes errors and titles', () => {
  const oldCwd = process.cwd();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rawsurf-e2e-receipt-'));
  try {
    process.chdir(directory);
    const reporter = new ProgressReporter();
    reporter.onBegin();
    reporter.onTestEnd({ location: { file: '/source/booking-flow.spec.js', line: 138 },
      title: 'private-sentinel', parent: { project: () => ({ name: 'Desktop Chrome' }) } },
    { status: 'failed', retry: 1, duration: 25, error: { message: 'private-sentinel' } });
    const content = fs.readFileSync('e2e-metadata/completed-attempts.jsonl', 'utf8');
    assert.deepEqual(JSON.parse(content), { file: 'booking-flow.spec.js', line: 138,
      project: 'Desktop Chrome', status: 'failed', retry: 1, durationMs: 25 });
    assert.doesNotMatch(content, /private-sentinel|source/);
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stubSeededUiBadges } = require('../e2e/seededUiBadges');

const origin = new URL(process.env.REACT_APP_BACKEND_URL || 'https://raw-surf-antigravity.onrender.com').origin;
const fixturePage = () => ({
  routes: [],
  on() {},
  async route(matches, handle) { this.routes.push({ matches, handle }); },
});

test('synthetic navigation receives both declared empty badge contracts', async () => {
  const page = fixturePage();
  const count = await stubSeededUiBadges(page, ['test-surfer-id']);
  for (const [path, body] of [
    ['/api/messages/unread-counts/test-surfer-id', { total: 0, primary: 0, requests: 0, grom_zone: 0 }],
    ['/api/surfer-gallery/claim-queue-count/test-surfer-id', { pending_count: 0 }],
  ]) {
    const route = page.routes.find(r => r.matches(new URL(origin + path)));
    assert.ok(route, `Missing synthetic badge: ${path}`);
    let response;
    await route.handle({ request: () => ({ method: () => 'GET' }),
      fulfill: async value => { response = value; }, fallback: () => assert.fail('GET fell through') });
    assert.deepEqual(response.json, body);
    assert.match(response.headers['x-rawsurf-e2e-fixture'], /^synthetic-/);
  }
  assert.equal(count(), 2);
});

test('real identities, auth, mutations, weather and other origins stay outside the fixture', async () => {
  const page = fixturePage();
  await stubSeededUiBadges(page, ['test-surfer-id', 'admin-user-id']);
  for (const url of [
    origin + '/api/surfer-gallery/claim-queue-count/real-account',
    origin + '/api/messages/unread-counts/real-account',
    origin + '/api/surfer-gallery/claim-queue/test-surfer-id/action',
    origin + '/api/auth/login', origin + '/api/weather/grid',
    origin + '/api/explore/spot-details/test-surfer-id',
    'https://different.invalid/api/surfer-gallery/claim-queue-count/test-surfer-id',
  ]) assert.equal(page.routes.some(r => r.matches(new URL(url))), false, url);
  for (const route of page.routes) {
    let fellThrough = false;
    await route.handle({ request: () => ({ method: () => 'POST' }),
      fulfill: () => assert.fail('Mutation was intercepted'), fallback: async () => { fellThrough = true; } });
    assert.equal(fellThrough, true);
  }
});

test('an undeclared identity cannot install a badge fixture', async () => {
  const page = fixturePage();
  await assert.rejects(stubSeededUiBadges(page, ['real-account']), /declared synthetic UI identity/);
  assert.equal(page.routes.length, 0);
});

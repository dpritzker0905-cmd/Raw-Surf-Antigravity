const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stubSeededUiBadges } = require('../e2e/seededUiBadges');

const origin = new URL(process.env.REACT_APP_BACKEND_URL || 'https://raw-surf-antigravity.onrender.com').origin;
const fixturePage = () => ({
  routes: [],
  on() {},
  async route(matches, handle) { this.routes.push({ matches, handle }); },
});

for (const id of ['test-surfer-id', 'admin-user-id']) {
  test(`synthetic navigation receives declared empty badge contracts for ${id}`, async () => {
    const page = fixturePage();
    const count = await stubSeededUiBadges(page, [id]);
    for (const [path, body] of [
      [`/api/messages/unread-counts/${id}`, { total: 0, primary: 0, requests: 0, grom_zone: 0 }],
      [`/api/notifications/${id}/unread-count`, { unread_count: 0 }],
      [`/api/surfer-gallery/claim-queue-count/${id}`, { pending_count: 0 }],
      [`/api/compliance/violations/user/${id}`, { user_id: id, total_strikes: 0,
        is_suspended: false, is_banned: false, suspension_until: null, violations: [] }],
    ]) {
      const route = page.routes.find(r => r.matches(new URL(origin + path)));
      assert.ok(route, `Missing synthetic badge: ${path}`);
      let response;
      await route.handle({ request: () => ({ method: () => 'GET' }),
        fulfill: async value => { response = value; }, fallback: () => assert.fail('GET fell through') });
      assert.deepEqual(response.json, body);
      assert.match(response.headers['x-rawsurf-e2e-fixture'], /^synthetic-/);
    }
    assert.equal(count(), 4);
  });
}

test('real identities, auth, mutations, weather and other origins stay outside the fixture', async () => {
  const page = fixturePage();
  await stubSeededUiBadges(page, ['test-surfer-id', 'admin-user-id']);
  for (const url of [
    origin + '/api/surfer-gallery/claim-queue-count/real-account',
    origin + '/api/messages/unread-counts/real-account',
    origin + '/api/notifications/real-account/unread-count',
    origin + '/api/notifications/test-surfer-id',
    origin + '/api/notifications/test-surfer-id/unread-count-extra',
    origin + '/api/compliance/violations/user/real-account',
    origin + '/api/surfer-gallery/claim-queue/test-surfer-id/action',
    origin + '/api/auth/login', origin + '/api/weather/grid',
    origin + '/api/explore/spot-details/test-surfer-id',
    'https://different.invalid/api/surfer-gallery/claim-queue-count/test-surfer-id',
    'https://different.invalid/api/notifications/test-surfer-id/unread-count',
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

// Exercise the actual nested setup hooks: no preparatory document may mount the
// unread poller before the subject's own navigation replaces that document.
const setupHooks = new Map();
let suite = '';
const register = () => {};
register.beforeEach = hook => { if (suite) setupHooks.set(suite, hook); };
register.describe = (name, body) => {
  const parent = suite;
  suite = name;
  body();
  suite = parent;
};
register.fixme = () => {};
vm.runInNewContext(fs.readFileSync(require.resolve('../e2e/weather-simulation.spec.js'), 'utf8'), {
  require: name => {
    if (name === './offlineWeather') return { test: register, expect: () => {} };
    if (name === './seededUiBadges') return { stubSeededUiBadges };
    if (name === './pngPixels' || name === '../src/components/map/colorScales') return {};
    throw new Error('Unexpected bootstrap dependency');
  },
}, { filename: 'weather-simulation.spec.js' });

for (const [name, id, marine] of [
  ['Surfer Lockout Redirection', 'test-surfer-id', false],
  ['Admin Console Operations', 'admin-user-id', false],
  ['Standard Surfer Map Controls', 'test-surfer-id', true],
]) {
  test(`${name} seeds before the subject without opening a transient auth/feed document`, async () => {
    const scripts = [];
    const page = {
      addInitScript: async (fn, args) => scripts.push({ fn, args }),
      goto: () => assert.fail('setup must not navigate before the subject'),
      evaluate: () => assert.fail('setup must seed before application startup'),
      waitForURL: () => assert.fail('URL-only waiting does not settle React mount effects'),
    };
    assert.ok(setupHooks.has(name));
    await setupHooks.get(name)({ page });
    assert.equal(scripts.length, 1);
    const values = new Map();
    const storage = { setItem: (key, value) => values.set(key, value) };
    const { fn, args } = scripts[0];
    vm.runInNewContext(`(${fn.toString()})(args)`, { localStorage: storage, args, Date });
    const user = JSON.parse(values.get('raw-surf-user'));
    assert.equal(user.id, id);
    assert.equal(user.is_admin, id === 'admin-user-id');
    assert.equal(user.role, id === 'admin-user-id' ? 'admin' : 'user');
    assert.equal(user.access_token, undefined);
    assert.ok(Number(values.get(`tos-accepted-${id}-1.0`)) > 0);
    assert.equal(JSON.parse(values.get('raw-surf-cookie-consent')).accepted, true);
    assert.ok(Number(values.get('rs-push-prompt-dismissed')) > 0);
    assert.equal(values.get('force_marine_fallback'), marine ? 'true' : undefined);
    assert.equal(values.has('site_access_code'), false, 'existing gate storage must stay independent');
  });
}

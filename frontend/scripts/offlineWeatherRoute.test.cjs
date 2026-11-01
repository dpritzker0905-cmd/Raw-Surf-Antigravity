// node --test scripts/offlineWeatherRoute.test.cjs: the in-runner weather route (offline-backend/weather_route.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MARKER, weatherRouteConfig, isLiveWeather, forwardHeaders, corsHeaders, routeWeatherToLocal, watchLiveWeatherLeaks,
} = require('./offline-backend/weather_route');

const LIVE = 'https://raw-surf-antigravity.onrender.com';
const LOCAL = 'http://127.0.0.1:4100';

function fakeTarget() {
  return {
    routes: [], listeners: [],
    async route(matches, handle) { this.routes.push({ matches, handle }); },
    on(event, fn) { if (event === 'response') this.listeners.push(fn); },
  };
}

function fakeRoute({ url, method = 'GET', origin = 'https://dev--rawsurf.netlify.app', fetchImpl }) {
  const calls = { fetch: [], fulfill: [], network: 0 };
  return {
    calls,
    request: () => ({
      url: () => url, method: () => method,
      headerValue: async (name) => (name === 'origin' ? origin : null),
    }),
    fetch: async (opts) => { calls.fetch.push(opts); return fetchImpl(opts); },
    fulfill: async (opts) => { calls.fulfill.push(opts); },
    continue: async () => { calls.network += 1; },
    fallback: async () => { calls.network += 1; },
  };
}

test('only the live origin\'s /api/weather/* is matched', () => {
  for (const [url, want] of [
    [`${LIVE}/api/weather/grid_series?model=GFS`, true],
    [`${LIVE}/api/weather/spot-ratings?bbox=1,2,3,4`, true],
    [`${LIVE}/api/weather-proxy`, false],
    [`${LIVE}/api/explore/spot-details/x`, false],
    [`${LIVE}/api/health`, false],
    ['https://elsewhere.example/api/weather/grid', false],
  ]) assert.equal(isLiveWeather(new URL(url), LIVE), want, url);
});

test('config: off when unset, loopback only when set', () => {
  assert.deepEqual(weatherRouteConfig({}, 'E2E_WEATHER_BACKEND'), { liveOrigin: LIVE, local: '' });
  assert.equal(weatherRouteConfig({ E2E_WEATHER_BACKEND: `${LOCAL}/` }).local, LOCAL);
  assert.equal(weatherRouteConfig({ ZL_WEATHER_BACKEND: 'http://localhost:4100' }, 'ZL_WEATHER_BACKEND').local, 'http://localhost:4100');
  assert.throws(() => weatherRouteConfig({ E2E_WEATHER_BACKEND: LIVE }), /loopback/);
  assert.equal(weatherRouteConfig({ REACT_APP_BACKEND_URL: 'https://other.example/x' }).liveOrigin, 'https://other.example');
});

test('forwarded headers: no stale encoding or server CORS, marker and echoed origin on top', () => {
  const h = forwardHeaders({ 'Content-Encoding': 'gzip', 'content-length': '10', 'content-type': 'application/json',
    'access-control-allow-origin': 'https://dev--rawsurf.netlify.app', 'x-cache': 'hit' },
  corsHeaders('https://dev--rawsurf.netlify.app', 'authorization'));
  assert.equal(h['content-encoding'], undefined);
  assert.equal(h['content-length'], undefined);
  assert.equal(h['content-type'], 'application/json');
  assert.equal(h['x-cache'], 'hit');
  assert.equal(h['access-control-allow-origin'], 'https://dev--rawsurf.netlify.app');
  assert.equal(h['access-control-allow-credentials'], 'true');
  assert.equal(h['access-control-allow-headers'], 'authorization');
  assert.equal(h[MARKER], 'local');
});

test('a weather GET is fetched from the local backend, same path and query', async () => {
  const target = fakeTarget();
  const stats = await routeWeatherToLocal(target, { liveOrigin: LIVE, local: LOCAL });
  const r = fakeRoute({ url: `${LIVE}/api/weather/grid_series?model=GFS&hours=0,3`,
    fetchImpl: async () => ({ headers: () => ({ 'content-type': 'application/json', 'content-encoding': 'gzip' }) }) });
  assert.equal(target.routes[0].matches(new URL(r.request().url())), true);
  await target.routes[0].handle(r);
  assert.equal(r.calls.fetch[0].url, `${LOCAL}/api/weather/grid_series?model=GFS&hours=0,3`);
  assert.equal(r.calls.fulfill.length, 1);
  assert.equal(r.calls.fulfill[0].headers[MARKER], 'local');
  assert.equal(r.calls.fulfill[0].headers['content-encoding'], undefined);
  assert.equal(r.calls.network, 0);
  assert.deepEqual(stats, { local: 1, answered: 0, failed: 0, cancelled: 0, byEndpoint: { grid_series: 1 }, failedExamples: [] });
});

test('FAIL CLOSED: an unreachable local backend yields a 502 here, never the live box', async () => {
  const target = fakeTarget();
  const stats = await routeWeatherToLocal(target, { liveOrigin: LIVE, local: LOCAL });
  const r = fakeRoute({ url: `${LIVE}/api/weather/grid?model=GFS`, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await target.routes[0].handle(r);
  assert.equal(r.calls.network, 0);
  assert.equal(r.calls.fulfill[0].status, 502);
  assert.equal(stats.failed, 1);
  assert.equal(stats.local, 0);
  assert.match(stats.failedExamples[0], /^grid: ECONNREFUSED/);
});

test('a request cut off by a closing page is cancelled, not a backend failure, and still never reaches the network', async () => {
  const target = fakeTarget();
  const stats = await routeWeatherToLocal(target, { liveOrigin: LIVE, local: LOCAL });
  const r = fakeRoute({ url: `${LIVE}/api/weather/grid_series?model=GFS`,
    fetchImpl: async () => { throw new Error('route.fetch: Target page, context or browser has been closed'); } });
  r.abort = async () => { r.calls.aborted = true; };
  await target.routes[0].handle(r);
  assert.equal(r.calls.network, 0);
  assert.equal(r.calls.aborted, true);
  assert.deepEqual([stats.local, stats.failed, stats.cancelled], [0, 0, 1]);
});

test('a request the page already dropped is counted as cancelled, not as a backend failure', async () => {
  const target = fakeTarget();
  const stats = await routeWeatherToLocal(target, { liveOrigin: LIVE, local: LOCAL });
  const r = fakeRoute({ url: `${LIVE}/api/weather/grid_series?model=GFS`, fetchImpl: async () => ({ headers: () => ({}) }) });
  r.fulfill = async () => { throw new Error('Route is already handled!'); };
  await target.routes[0].handle(r);
  assert.equal(r.calls.network, 0);
  assert.deepEqual([stats.local, stats.failed, stats.cancelled], [1, 0, 1]);
});

test('preflights and writes are answered here with no fetch at all', async () => {
  const target = fakeTarget();
  const stats = await routeWeatherToLocal(target, { liveOrigin: LIVE, local: LOCAL });
  for (const method of ['OPTIONS', 'POST']) {
    const r = fakeRoute({ url: `${LIVE}/api/weather/client-diagnostics`, method, fetchImpl: async () => assert.fail('fetched') });
    await target.routes[0].handle(r);
    assert.equal(r.calls.fulfill[0].status, 204);
    assert.equal(r.calls.network, 0);
  }
  assert.equal(stats.answered, 2);
});

test('the leak watch counts weather responses without the marker, and nothing else', () => {
  const target = fakeTarget();
  const read = watchLiveWeatherLeaks(target, LIVE);
  const resp = (url, headers, method = 'GET') => ({ url: () => url, headers: () => headers, request: () => ({ method: () => method }) });
  const fire = (r) => target.listeners.forEach((fn) => fn(r));
  fire(resp(`${LIVE}/api/weather/grid_series`, { [MARKER]: 'local' }));
  fire(resp(`${LIVE}/api/weather/grid_series`, {}));
  fire(resp(`${LIVE}/api/weather/grid`, {}, 'OPTIONS'));
  fire(resp(`${LIVE}/api/explore/trending`, {}));
  assert.deepEqual(read(), { leaked: 1, examples: ['grid_series'] });
});

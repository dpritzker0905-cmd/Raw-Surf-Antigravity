/**
 * weather_route.js: send a browser's `/api/weather/*` traffic to a backend started INSIDE the CI runner
 * (serve_synthetic.py) instead of the live Render box. Shared by the E2E fixture (e2e/offlineWeather.js)
 * and the zoomlab battery (scripts/zoomlab.js).
 *
 * WHY (owner, 2026-10-21: "move the CI load off the live server"). ONE 1-CPU Render box serves production
 * AND dev, and a fresh map load asks it for three 48-frame world `/grid_series` pages (~10-13 s of CPU
 * each). Measured 2026-10-20/21, about 90% of grid_series traffic was our own CI; at 12:30Z /api/health
 * took 13.4 s and grid_series p95 was 42 s while dev E2E ran, and the 12:13Z zoomlab nightly was REFUSED
 * for 15 s transport timeouts.
 *
 * WHAT IT DOES. A route on the backend origin's `/api/weather/*` only:
 *   GET / HEAD -> fetched from the local backend and fulfilled with its real response (production code
 *                 over synthetic stored products), marked `x-rawsurf-offline-weather: local`;
 *   OPTIONS    -> answered here (CORS preflight);
 *   writes     -> answered here with 204 (client-diagnostics telemetry), never sent anywhere.
 * ⛔ FAIL CLOSED: when the local backend cannot answer, the request gets a 502 HERE. It never falls through
 *   to the live box, which would silently put the load back.
 * Every other request (auth, explore, spot hub, sockets, basemap tiles) is untouched.
 */
const LIVE_DEFAULT = 'https://raw-surf-antigravity.onrender.com';
const MARKER = 'x-rawsurf-offline-weather';
const WEATHER_PREFIX = '/api/weather/';
// Headers that describe the LOCAL exchange, not the body we hand the browser: Playwright's fetch has
// already decoded the body, so a forwarded `content-encoding: gzip` would make the browser decode it twice.
const DROP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

/** The live origin the app calls and the local backend to use instead (empty local = routing off). */
function weatherRouteConfig(env = process.env, localVar = 'E2E_WEATHER_BACKEND') {
  const liveOrigin = new URL(env.REACT_APP_BACKEND_URL || LIVE_DEFAULT).origin;
  const local = String(env[localVar] || '').trim().replace(/\/+$/, '');
  if (local) {
    const u = new URL(local);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) {
      throw new Error(`${localVar} must be a loopback origin (got ${u.origin}): this route exists to keep load OFF remote hosts`);
    }
  }
  return { liveOrigin, local };
}

/** True for a request to the live backend's weather API (the only traffic this module touches). */
function isLiveWeather(url, liveOrigin) {
  return url.origin === liveOrigin && url.pathname.startsWith(WEATHER_PREFIX);
}

/** The same path and query on the local backend. */
function localUrlFor(url, local) {
  return local + url.pathname + url.search;
}

/** 'grid_series', 'grid', 'point', ... (the path segment after /api/weather/). */
function endpointOf(url) {
  return url.pathname.slice(WEATHER_PREFIX.length).split('/')[0] || 'other';
}

/** CORS for a cross-origin page: echo the page origin (credentialed requests reject `*`). */
function corsHeaders(origin, requestHeaders) {
  const h = {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
    'access-control-allow-headers': requestHeaders || '*',
    'access-control-expose-headers': '*',
    vary: 'Origin',
    [MARKER]: 'local',
  };
  if (origin) h['access-control-allow-credentials'] = 'true';
  return h;
}

/** The local response's headers made safe for the browser, with CORS and the marker on top. */
function forwardHeaders(responseHeaders, cors) {
  const out = {};
  for (const [k, v] of Object.entries(responseHeaders || {})) {
    const key = k.toLowerCase();
    if (DROP.has(key) || key.startsWith('access-control-')) continue;
    out[key] = v;
  }
  return { ...out, ...cors };
}

/**
 * Install the route on a Playwright BrowserContext (or Page). Returns live counters:
 *   local      requests answered by the local backend, byEndpoint the same split by endpoint,
 *   answered   preflights and writes answered here,
 *   failed     requests the local backend did not answer (each got a 502 here; failedExamples names a few),
 *   cancelled  answered locally, but the page had already dropped the request (a superseded fetch, a closing page).
 */
async function routeWeatherToLocal(target, { liveOrigin, local, timeoutMs = 120000 }) {
  const stats = { local: 0, answered: 0, failed: 0, cancelled: 0, byEndpoint: {}, failedExamples: [] };
  await target.route((url) => isLiveWeather(url, liveOrigin), async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const origin = await request.headerValue('origin').catch(() => null);
    const cors = corsHeaders(origin, await request.headerValue('access-control-request-headers').catch(() => null));
    if (method !== 'GET' && method !== 'HEAD') {
      stats.answered += 1;
      return route.fulfill({ status: 204, headers: cors }).catch(() => {});
    }
    const ep = endpointOf(url);
    let response;
    try {
      response = await route.fetch({ url: localUrlFor(url, local), timeout: timeoutMs });
    } catch (error) {
      const message = String(error && error.message).split('\n')[0];
      // The page, context or browser closed under an in-flight request (a test ending): not a backend failure.
      if (/has been closed|Target closed|disposed/i.test(message)) { stats.cancelled += 1; return route.abort().catch(() => {}); }
      stats.failed += 1;
      if (stats.failedExamples.length < 5) stats.failedExamples.push(`${ep}: ${message.slice(0, 120)}`);
      return route.fulfill({
        status: 502, headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ detail: 'in-runner weather backend did not answer (never forwarded to the live backend)' }),
      }).catch(() => {});   // the page may already be gone
    }
    stats.local += 1;
    stats.byEndpoint[ep] = (stats.byEndpoint[ep] || 0) + 1;
    return route.fulfill({ response, headers: forwardHeaders(response.headers(), cors) })
      .catch(() => { stats.cancelled += 1; });
  });
  return stats;
}

/**
 * LOCAL RUNS ONLY (never set in CI): answer every OTHER call to the live backend with an empty 200 and close its sockets,
 * so a developer can replay a flow with zero traffic to the live box. Specs that need real explore/spot data will fail.
 */
async function stubOtherLiveBackend(context, liveOrigin) {
  const liveHost = new URL(liveOrigin).host;
  await context.route((url) => url.origin === liveOrigin && !isLiveWeather(url, liveOrigin), async (route) => {
    const origin = await route.request().headerValue('origin').catch(() => null);
    return route.fulfill({ status: 200, headers: { ...corsHeaders(origin, '*'), 'content-type': 'application/json' },
      body: route.request().method() === 'GET' ? '[]' : '{}' }).catch(() => {});
  });
  await context.routeWebSocket((url) => url.host === liveHost, (ws) => ws.close({ code: 1008, reason: 'offline run' }));
}

/**
 * Count weather responses that did NOT come from this route (no marker): each one reached the live box.
 * Attach to a BrowserContext or Page; returns a getter.
 */
function watchLiveWeatherLeaks(target, liveOrigin) {
  let leaked = 0;
  const examples = [];
  target.on('response', (response) => {
    try {
      const url = new URL(response.url());
      if (!isLiveWeather(url, liveOrigin) || response.request().method() === 'OPTIONS') return;
      if (response.headers()[MARKER] === 'local') return;
      leaked += 1;
      if (examples.length < 5) examples.push(endpointOf(url));
    } catch (e) { /* unparseable URL: not ours */ }
  });
  return () => ({ leaked, examples });
}

module.exports = {
  LIVE_DEFAULT, MARKER, weatherRouteConfig, isLiveWeather, localUrlFor, endpointOf, corsHeaders, forwardHeaders,
  routeWeatherToLocal, watchLiveWeatherLeaks, stubOtherLiveBackend,
};

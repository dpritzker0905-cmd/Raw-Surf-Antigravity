/**
 * F-14 (audit 14.0) — the service worker's spot-cache lane must be origin-consistent and must not
 * claim "offline" while the network is up.
 *
 * THE DEFECT THIS PINS. `service-worker.js` intercepts the spots API on `url.pathname` ALONE, so it
 * wraps the API wherever it lives — and it always lives cross-origin, because the app calls an
 * absolute `REACT_APP_BACKEND_URL` (onrender.com). But `CACHE_SPOTS` built its warm-up URL from
 * `self.location.origin`, the page's own host. On localhost:3000 that is a static file server with
 * no `/api` at all, so the cache the fallback depends on was warmed against the wrong host or never
 * warmed. A single transient backend failure (a deploy restart is the common case) then produced a
 * synthetic `{offline: true, data: []}` claiming "You are offline" while the network was healthy —
 * which the client's retry ladder exhausts into a user-facing "Couldn't load surf spots" toast.
 *
 * Measured 2026-09-20: `/api/surf-spots` returned HTTP 200 with 1,773 spots and correct CORS for
 * `http://localhost:3000` throughout, so the backend was never the cause.
 *
 * `service-worker.js` is a CLASSIC worker in `public/` — not bundled, no imports/exports — so it
 * cannot be `require`d. These tests read the real file and execute it against a mock worker global,
 * which means they run the shipped source rather than a copy of its logic.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SW_PATH = path.join(__dirname, '..', '..', 'public', 'service-worker.js');
const API_ORIGIN = 'https://raw-surf-antigravity.onrender.com';
const PAGE_ORIGIN = 'http://localhost:3000';

/**
 * Minimal Headers stand-in. The SW does `new Headers(cachedResponse.headers)` and then `.set()`
 * to tag the stale-cache fallback; without a real Headers in scope that line THROWS and the SW's
 * own catch returns the untagged response — which looks exactly like "the tag was never added".
 * The harness must provide it, or it tests its own gap rather than the worker.
 */
class MockHeaders {
  constructor(init) {
    this._h = {};
    if (init && init._h) Object.assign(this._h, init._h);
    else if (init && typeof init === 'object') Object.assign(this._h, init);
  }
  get(k) { const v = this._h[k] ?? this._h[String(k).toLowerCase()]; return v === undefined ? null : v; }
  set(k, v) { this._h[k] = v; }
}

function makeResponse(body, { status = 200, headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const hdrs = headers instanceof MockHeaders ? headers : new MockHeaders(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: hdrs,
    clone() { return makeResponse(text, { status, headers: hdrs }); },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

/** Loads the REAL service worker source into a sandbox and returns its captured handlers. */
function loadServiceWorker({ online = true, fetchImpl, cacheEntries = [] } = {}) {
  const src = fs.readFileSync(SW_PATH, 'utf8');
  const handlers = {};
  const puts = [];

  const store = cacheEntries.map(([url, resp]) => [url, resp]);
  const cache = {
    match: async (request, opts) => {
      const wanted = typeof request === 'string' ? request : request.url;
      const strip = (u) => String(u).split('?')[0];
      for (const [url, resp] of store) {
        if (url === wanted) return resp;
      }
      if (opts && opts.ignoreSearch) {
        for (const [url, resp] of store) {
          if (strip(url) === strip(wanted)) return resp;
        }
      }
      return undefined;
    },
    put: async (req, resp) => { puts.push([typeof req === 'string' ? req : req.url, resp]); },
    keys: async () => [],
  };

  const self = {
    location: { origin: PAGE_ORIGIN, href: `${PAGE_ORIGIN}/` },
    navigator: online ? { onLine: true } : { onLine: false },
    addEventListener: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); },
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: async () => [] },
    registration: { showNotification: () => {}, scope: PAGE_ORIGIN },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => undefined },
    fetch: fetchImpl,
    Response: function MockResponse(body, init) {
      const h = (init && init.headers) || {};
      return makeResponse(body, { status: (init && init.status) || 200, headers: h });
    },
    Headers: MockHeaders,
    Request: function MockRequest(url) { return { url: String(url) }; },
    URL,
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  self.self = self;

  const sandbox = { self, caches: self.caches, fetch: fetchImpl, Response: self.Response,
                    Request: self.Request, Headers: MockHeaders, URL, console: self.console, location: self.location,
                    navigator: self.navigator, clients: self.clients, registration: self.registration,
                    setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'service-worker.js' });
  return { handlers, puts, self };
}

/** Drives the fetch handler for a spots request and returns whatever it responded with. */
async function runFetch(sw, requestUrl) {
  let responded;
  const event = {
    request: { url: requestUrl, method: 'GET', mode: 'cors' },
    respondWith: (p) => { responded = p; },
    waitUntil: () => {},
  };
  for (const fn of sw.handlers.fetch || []) fn(event);
  return responded ? await responded : undefined;
}

describe('F-14 service worker spots fallback', () => {
  const SPOTS_URL = `${API_ORIGIN}/api/surf-spots?user_id=abc`;

  it('claims TRANSIENT, not offline, when the backend fails while the browser is online', async () => {
    const sw = loadServiceWorker({ online: true, fetchImpl: async () => { throw new Error('boom'); } });
    const res = await runFetch(sw, SPOTS_URL);
    const body = await res.json();

    expect(body.offline).toBe(true);          // retained: useMapData keys its retry ladder on this
    expect(body.transient).toBe(true);        // ...but the honest detail rides alongside
    expect(body.reason).toBe('upstream-unreachable');
    expect(body.message).not.toMatch(/You are offline/i);
    expect(res.headers.get('X-SW-Spots-Fallback')).toBe('transient');
  });

  it('claims OFFLINE only when the browser reports itself offline', async () => {
    const sw = loadServiceWorker({ online: false, fetchImpl: async () => { throw new Error('boom'); } });
    const body = await (await runFetch(sw, SPOTS_URL)).json();

    expect(body.transient).toBe(false);
    expect(body.reason).toBe('browser-offline');
    expect(body.message).toMatch(/You are offline/i);
  });

  it('serves a real cached list across differing query params instead of the empty payload', async () => {
    // The cache holds the GLOBAL list; the failing request carries a viewport/user query, so the
    // exact key misses. Before the repair this fell straight through to `data: []`.
    const cached = makeResponse([{ id: 'spot-1' }, { id: 'spot-2' }]);
    const sw = loadServiceWorker({
      online: true,
      fetchImpl: async () => { throw new Error('boom'); },
      cacheEntries: [[`${API_ORIGIN}/api/surf-spots`, cached]],
    });
    const res = await runFetch(sw, `${API_ORIGIN}/api/surf-spots?user_id=zzz&viewport_only=true`);
    const body = await res.json();

    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(res.headers.get('X-SW-Cache-Fallback')).toBe('1');   // still flagged stale -> client retries
  });

  it('does NOT serve a cached list for a different endpoint', async () => {
    const cached = makeResponse([{ id: 'nope' }]);
    const sw = loadServiceWorker({
      online: true,
      fetchImpl: async () => { throw new Error('boom'); },
      cacheEntries: [[`${API_ORIGIN}/api/spots-in-bounds`, cached]],
    });
    const body = await (await runFetch(sw, SPOTS_URL)).json();
    expect(Array.isArray(body)).toBe(false);      // fell through to the synthetic payload, correctly
    expect(body.data).toEqual([]);
  });

  it('warms CACHE_SPOTS against the API origin, not the page origin', async () => {
    const fetched = [];
    const sw = loadServiceWorker({
      online: true,
      fetchImpl: async (u) => { fetched.push(String(u)); return makeResponse([{ id: 's' }]); },
    });

    // The SW must first OBSERVE the API origin from a real intercepted request...
    await runFetch(sw, SPOTS_URL);
    fetched.length = 0;

    // ...then a CACHE_SPOTS message must warm that origin.
    const msg = { data: { type: 'CACHE_SPOTS' }, waitUntil: (p) => p, source: { postMessage: () => {} } };
    for (const fn of sw.handlers.message || []) fn(msg);
    await new Promise((r) => setTimeout(r, 0));

    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toBe(`${API_ORIGIN}/api/surf-spots`);
    // The pre-repair bug, stated as an assertion: the page origin has no /api at all on localhost.
    expect(fetched[0]).not.toContain(PAGE_ORIGIN);
  });

  it('falls back to the page origin when no API request has been observed yet', async () => {
    // Preserves the old behaviour for a hypothetical same-origin deployment.
    const fetched = [];
    const sw = loadServiceWorker({
      online: true,
      fetchImpl: async (u) => { fetched.push(String(u)); return makeResponse([]); },
    });
    const msg = { data: { type: 'CACHE_SPOTS' }, waitUntil: (p) => p, source: { postMessage: () => {} } };
    for (const fn of sw.handlers.message || []) fn(msg);
    await new Promise((r) => setTimeout(r, 0));

    expect(fetched[0]).toBe(`${PAGE_ORIGIN}/api/surf-spots`);
  });
});

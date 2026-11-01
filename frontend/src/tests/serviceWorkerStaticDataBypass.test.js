/**
 * Skills audit #4 (2026-10-23): the service worker bypasses the static forecast data buckets EXPLICITLY (host + bucket prefix),
 * not because their names happen to contain '/weather'; gallery media keeps its cache branch; the HTML shell is no-cache, not
 * no-store (no-store keeps the page out of the back/forward cache); the catch-all header rule leaves the bundles' immutable alone.
 *
 * `service-worker.js` is a classic worker in `public/` (no imports), so, as serviceWorkerSpotsFallback.test.js does, the REAL file
 * runs against a mock worker global.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SW_PATH = path.join(__dirname, '..', '..', 'public', 'service-worker.js');
const HEADERS_PATH = path.join(__dirname, '..', '..', 'public', '_headers');
const SB = 'https://abcdproject.supabase.co/storage/v1/object/public';

function loadServiceWorker() {
  const src = fs.readFileSync(SW_PATH, 'utf8');
  const handlers = {};
  const cache = { match: async () => undefined, put: async () => {}, keys: async () => [] };
  const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, clone() { return this; } }));
  const self = {
    location: { origin: 'http://localhost:3000', href: 'http://localhost:3000/' },
    navigator: { onLine: true },
    addEventListener: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); },
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: async () => [] },
    registration: { showNotification: () => {}, scope: 'http://localhost:3000' },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => undefined },
    fetch: fetchImpl,
    Response: function MockResponse() { return { ok: true }; },
    Headers: function MockHeaders() {},
    Request: function MockRequest(url) { return { url: String(url) }; },
    URL,
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  self.self = self;
  const sandbox = { self, caches: self.caches, fetch: fetchImpl, Response: self.Response, Request: self.Request, Headers: self.Headers,
    URL, console: self.console, location: self.location, navigator: self.navigator, clients: self.clients, registration: self.registration,
    setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'service-worker.js' });
  return { handlers };
}

// true when the SW answered the request itself (event.respondWith), false when it let the browser handle it
function intercepts(sw, url) {
  let responded = false;
  const event = { request: { url, method: 'GET', mode: 'cors' }, respondWith: () => { responded = true; }, waitUntil: () => {} };
  for (const fn of sw.handlers.fetch || []) fn(event);
  return responded;
}

describe('service worker: static forecast data bypass (skills audit #4)', () => {
  const sw = loadServiceWorker();

  it.each([
    ['the frame pointer', `${SB}/weather-frames/v1/latest.json`],
    ['a frame', `${SB}/weather-frames/v1/gfs/marine/waves/global_mid/frames/20261022T180000Z.bin`],
    ['the spot-ratings product', `${SB}/weather-products/spot_ratings/latest.json`],
    ['a future frames bucket (no "weather" in its name)', `${SB}/raster-frames/v1/latest.json`],
  ])('lets the browser fetch %s (no SW cache lookup)', (_, url) => {
    expect(intercepts(sw, url)).toBe(false);
  });

  it('still answers gallery media from its cache branch', () => {
    expect(intercepts(sw, `${SB}/gallery/user-1/photo.jpg`)).toBe(true);
  });
});

describe('the HTML shell header (skills audit #4)', () => {
  it('index.html is revalidated (no-cache) but NOT no-store, so back/forward restores can use the bfcache', () => {
    const text = fs.readFileSync(HEADERS_PATH, 'utf8');
    const block = text.split(/\n(?=\/)/).find((b) => b.startsWith('/index.html'));
    expect(block).toMatch(/Cache-Control:\s*no-cache\s*$/m);
    expect(block).not.toMatch(/no-store/);
  });

  it('the catch-all sets no Cache-Control, so the hashed bundles keep immutable (on Netlify its no-cache won over them)', () => {
    const text = fs.readFileSync(HEADERS_PATH, 'utf8');
    const blocks = text.split(/\n(?=\/)/);
    const catchAll = blocks.find((b) => b.startsWith('/*'));
    expect(catchAll).toMatch(/X-Content-Type-Options:\s*nosniff/);
    expect(catchAll.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')).not.toMatch(/Cache-Control/i);
    for (const dir of ['/static/js/*', '/static/css/*']) {
      expect(blocks.find((b) => b.startsWith(dir))).toMatch(/Cache-Control:\s*public, max-age=31536000, immutable/);
    }
  });
});

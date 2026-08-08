/**
 * FORENSIC PROBE for the /map loading splash (not a test — a one-off instrument).
 *
 * The E2E gate at weather-simulation.spec.js:358 times out with the page stuck on
 * "Loading Waves / Finding surf spots near you". `loading` in useMapData clears only after
 * Promise.all([fetchSurfSpots, fetchLivePhotographers, fetchFeaturedPhotographers]) settles, and all
 * three endpoints measure 0.7-3.1 s when called directly. So something else is holding it.
 *
 * This reproduces the spec's EXACT beforeEach (including the service-worker mock whose `register`
 * and `ready` are never-resolving promises) and then reports which requests never finished.
 *
 * Run: node e2e/_diag_maploader.mjs [--no-sw-mock]
 */
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'https://dev--rawsurf.netlify.app';
const MOCK_SW = !process.argv.includes('--no-sw-mock');

const user = { id: 'e2e-surfer', email: 'surfer@e2e.test', full_name: 'E2E Surfer',
               username: 'e2esurfer', role: 'Surfer', subscription_tier: 'premium',
               is_admin: false, access_token: 'e2e-token' };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

if (MOCK_SW) {
  await page.addInitScript(() => {
    const mockServiceWorker = {
      register: () => new Promise(() => {}),
      ready: new Promise(() => {}),
      addEventListener: () => {}, removeEventListener: () => {},
      getRegistration: () => Promise.resolve(null),
      getRegistrations: () => Promise.resolve([]),
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      get() { return mockServiceWorker; }, configurable: true,
    });
  });
}

const inflight = new Map();
const done = [];
page.on('request', r => inflight.set(r, Date.now()));
page.on('requestfinished', r => { const t = inflight.get(r); inflight.delete(r);
  done.push([r.url(), Date.now() - t, 'ok']); });
page.on('requestfailed', r => { const t = inflight.get(r); inflight.delete(r);
  done.push([r.url(), Date.now() - t, 'FAILED ' + (r.failure()?.errorText || '')]); });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 160)); });

console.log(`sw-mock=${MOCK_SW}  base=${BASE}`);
await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded' });
await page.evaluate(({ user }) => {
  localStorage.setItem('raw-surf-user', JSON.stringify(user));
  localStorage.setItem(`tos-accepted-${user.id}-1.0`, Date.now().toString());
  localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
  localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
  localStorage.setItem('force_marine_fallback', 'true');
}, { user });
await page.waitForURL(/\/(feed|explore)(\/|$|\?)/, { timeout: 10000 }).catch(() => {});

const t0 = Date.now();
await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded' });
let visibleAt = null;
try {
  await page.locator('[data-testid="featured-photographers-btn"]').waitFor({ state: 'visible', timeout: 50000 });
  visibleAt = Date.now() - t0;
} catch { /* records below */ }

console.log(`\ncontrol visible after: ${visibleAt === null ? 'NEVER (50 s)' : (visibleAt / 1000).toFixed(1) + ' s'}`);
console.log(`splash still shown: ${await page.locator('text=Finding surf spots near you').count() > 0}`);

console.log('\n--- requests that NEVER completed ---');
if (!inflight.size) console.log('  (none)');
for (const [r, t] of inflight) console.log(`  ${((Date.now() - t) / 1000).toFixed(1)}s  ${r.method()} ${r.url().slice(0, 110)}`);

console.log('\n--- slowest 8 completed ---');
done.sort((a, b) => b[1] - a[1]);
for (const [u, ms, st] of done.slice(0, 8)) console.log(`  ${(ms / 1000).toFixed(2)}s ${st}  ${u.slice(0, 105)}`);

console.log('\n--- page errors (first 8) ---');
if (!errors.length) console.log('  (none)');
errors.slice(0, 8).forEach(e => console.log('  ' + e));

await browser.close();

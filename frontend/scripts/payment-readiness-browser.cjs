/* Local production-bundle payment return acceptance. No hosted API requests. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..', 'build');
const output = path.resolve(__dirname, '..', '..', 'scratch', 'payment-readiness-browser');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function run() {
  await fs.access(path.join(root, 'index.html'));
  await fs.mkdir(output, { recursive: true });
  const server = http.createServer(async (req, res) => {
    const target = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!target.startsWith(root + path.sep) && target !== root) { res.writeHead(403).end(); return; }
    try {
      const body = await fs.readFile(target);
      res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
      res.end(body);
    } catch (_) {
      res.setHeader('Content-Type', 'text/html');
      res.end(await fs.readFile(path.join(root, 'index.html')));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const rows = [];
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PAYMENT_BROWSER_CHANNEL ? { channel: process.env.PAYMENT_BROWSER_CHANNEL } : {}) });
    for (const theme of ['light', 'dark', 'beach']) {
      for (const [device, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
        for (const state of ['success', 'review']) {
          const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          let confirmations = 0;
          await context.addInitScript(({ theme, origin }) => {
            localStorage.setItem('__BACKEND_URL__', origin);
            localStorage.setItem('raw-surf-theme', theme);
            localStorage.setItem('raw-surf-user', JSON.stringify({ id: 'buyer', user_id: 'buyer', username: 'fixture',
              full_name: 'Fixture Buyer', role: 'Surfer', credit_balance: 60, access_token: 'local-browser-fixture' }));
          }, { theme, origin });
          await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort();
            if (!url.pathname.startsWith('/api/')) return route.continue();
            let status = 200;
            let body = {};
            if (url.pathname === '/api/bookings/payment-success') {
              confirmations += 1;
              assert.equal(url.searchParams.get('session_id'), 'receipt');
              assert.equal(url.searchParams.get('booking_id'), 'booking');
              assert.equal(route.request().headers().authorization, 'Bearer local-browser-fixture');
              status = state === 'review' ? 409 : 200;
              body = state === 'review' ? { detail: { reconciliation_required: true, case_id: 'fixture-case', state: 'open' } } : { success: true };
            } else if (url.pathname.includes('/compliance/tos-status/')) body = { acknowledged: true };
            else if (url.pathname === '/api/profiles/buyer') body = { credit_balance: 60 };
            await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
          });
          await page.routeWebSocket('**', socket => socket.close());
          await page.goto(`${origin}/bookings/success?session_id=receipt&booking_id=booking`);
          const heading = page.getByRole('heading', { name: state === 'success' ? 'Session Booked!' : 'Payment needs review' });
          await heading.waitFor();
          await page.waitForTimeout(250);
          assert.equal(confirmations, 1);
          assert.deepEqual(errors, []);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          const color = await heading.evaluate(element => getComputedStyle(element).color);
          assert.equal(color === 'rgb(255, 255, 255)', theme === 'dark');
          if (state === 'review') assert.equal(await page.getByRole('alert').count(), 1);
          await page.screenshot({ path: path.join(output, `${theme}-${device}-${state}.png`) });
          rows.push({ theme, device, state, confirmations, pageErrors: errors.length, horizontalOverflow: false });
          await context.close();
        }
      }
    }
    await fs.writeFile(path.join(output, 'results.local.json'), JSON.stringify(rows, null, 2));
    console.log(`Payment production-bundle browser acceptance: ${rows.length} passed; all API responses local fixtures.`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });

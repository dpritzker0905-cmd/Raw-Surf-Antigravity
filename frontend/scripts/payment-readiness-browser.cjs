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
        for (const scenario of [
          ...['success', 'review', 'refund_pending', 'refunded'].map(state => ({ kind: 'scheduled', state })),
          ...['review', 'refund_pending', 'refunded'].map(state => ({ kind: 'live', state })),
        ]) {
          const { kind, state } = scenario;
          const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          let confirmations = 0;
          await context.addInitScript(({ theme, origin, kind }) => {
            localStorage.setItem('__BACKEND_URL__', origin);
            localStorage.setItem('raw-surf-theme', theme);
            localStorage.setItem('raw-surf-user', JSON.stringify({ id: 'buyer', user_id: 'buyer', username: 'fixture',
              full_name: 'Fixture Buyer', role: 'Surfer', credit_balance: 60, access_token: 'local-browser-fixture' }));
            sessionStorage.setItem(`raw-surf:checkout:buyer:${kind}:pro`, JSON.stringify({ sessionId: 'receipt' }));
            sessionStorage.setItem(`raw-surf:checkout:other:${kind}:pro`, JSON.stringify({ sessionId: 'receipt' }));
          }, { theme, origin, kind });
          await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort();
            if (!url.pathname.startsWith('/api/')) return route.continue();
            let status = 200;
            let body = {};
            if (url.pathname === '/api/bookings/payment-success' || url.pathname === '/api/sessions/complete-payment') {
              confirmations += 1;
              if (kind === 'scheduled') {
                assert.equal(url.searchParams.get('session_id'), 'receipt');
                assert.equal(url.searchParams.get('booking_id'), 'booking');
              } else assert.equal(route.request().postDataJSON().checkout_session_id, 'receipt');
              assert.equal(route.request().headers().authorization, 'Bearer local-browser-fixture');
              status = state === 'success' ? 200 : 409;
              body = state === 'success' ? { success: true } : { detail: {
                reconciliation_required: true, case_id: 'fixture-case', state: state === 'review' ? 'open' : state,
              } };
            } else if (url.pathname.includes('/compliance/tos-status/')) body = { acknowledged: true };
            else if (url.pathname === '/api/profiles/buyer') body = { credit_balance: 60 };
            else if (url.pathname.endsWith('/crew-invites')) body = { crew_invites: [] };
            else if (url.pathname.endsWith('/active')) body = { active_dispatch: null };
            else if (/bookings|photographers|sessions|subscriptions|friends|lineup|notifications|conversations/.test(url.pathname)) body = [];
            await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
          });
          await page.routeWebSocket('**', socket => socket.close());
          await page.goto(`${origin}${kind === 'scheduled'
            ? '/bookings/success?session_id=receipt&booking_id=booking'
            : '/bookings?tab=live_sessions&session_payment=success&checkout_session_id=receipt'}`);
          const heading = kind === 'live' ? page.getByRole('alert').filter({ hasText: state === 'refunded'
            ? 'Your payment was refunded.' : state === 'refund_pending' ? 'Your refund is pending.' : 'This payment requires review' })
            : page.getByRole('heading', { name: state === 'success' ? 'Session Booked!' : state === 'refunded'
              ? 'Payment refunded' : state === 'refund_pending' ? 'Refund pending' : 'Payment needs review' });
          await heading.waitFor();
          await page.waitForTimeout(250);
          assert.equal(confirmations, 1);
          const recovery = await page.evaluate(kind => ({
            buyer: sessionStorage.getItem(`raw-surf:checkout:buyer:${kind}:pro`),
            other: sessionStorage.getItem(`raw-surf:checkout:other:${kind}:pro`),
          }), kind);
          assert.equal(recovery.buyer === null, ['success', 'refunded'].includes(state));
          assert.notEqual(recovery.other, null);
          assert.deepEqual(errors, []);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          const color = await heading.evaluate(element => getComputedStyle(element).color);
          if (kind === 'scheduled') assert.equal(color === 'rgb(255, 255, 255)', theme === 'dark');
          else {
            const background = await page.getByTestId('bookings-page').evaluate(element => getComputedStyle(element).backgroundColor);
            const luminance = rgb => rgb.match(/[\d.]+/g).slice(0, 3).map(Number)
              .map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
              .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
            const [a, b] = [luminance(color), luminance(background)].sort((a, b) => b - a);
            assert.ok((a + 0.05) / (b + 0.05) >= 4.5, `${theme} live receipt contrast`);
          }
          if (state !== 'success') {
            assert.equal(await page.getByRole('alert').count(), 1);
            assert.equal(await page.getByRole('heading', { name: 'Session Booked!' }).count(), 0);
            if (kind === 'live') assert.equal(new URL(page.url()).searchParams.get('checkout_session_id'), 'receipt');
          }
          if (state === 'success') {
            assert.equal(await page.getByText(/XP earned/i).count(), 0);
            const backColor = await page.getByRole('button', { name: 'Back to Feed' })
              .evaluate(element => getComputedStyle(element).color);
            assert.equal(backColor === 'rgb(255, 255, 255)', theme === 'dark');
          }
          await page.screenshot({ path: path.join(output, `${theme}-${device}-${kind}-${state}.png`) });
          rows.push({ theme, device, kind, state, confirmations, pageErrors: errors.length, horizontalOverflow: false });
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

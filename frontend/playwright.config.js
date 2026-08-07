// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  // ⏱ PER-TEST TIMEOUT. Until 2026-08-07 this was unset, so Playwright's 30 000 ms DEFAULT bound —
  // and these specs run against a LIVE deployment (baseURL is the deployed Netlify site, backed by a
  // 1-CPU Render box), with inner gates whose own budgets already over-subscribe 30 s roughly 2x.
  // The enclosing timeout, not any individual gate, was the binding constraint.
  //
  // ⚠️ WHY NOT THE "OBVIOUS" FIX. A generated diagnosis attributed these failures to a refused
  // WebSocket handshake plus a `page.route` handler 404-ing websockets. Measured, all of it is wrong:
  //   • the WS refusal appears **20 times in a PASSING run with 0 hard failures** (and 19 in another)
  //     — it cannot be the cause of a failure it is equally present in;
  //   • Playwright 1.60.0 does not route WS through `page.route` at all — `routeWebSocket` is a
  //     separate API — so the proposed pass-through would have been a no-op;
  //   • `E2E_BASE_URL` is already set here, and `REACT_APP_BACKEND_URL`'s default already equals the
  //     live host, so both proposed env additions are no-ops.
  // And the failure is not a cliff: of 34 completed runs, 6 pass / 28 fail, and **18 of those 28
  // failures predate** the commit the failures were being attributed to. The app loads fine —
  // 38-46 of 48 tests pass in every failing run.
  //
  // ⚠️ THIS IS A HYPOTHESIS WITH A STRONG MECHANISM, NOT A VERIFIED OUTCOME. It has not been shown
  // to flip a run green; that needs a CI run against the live deployment. If the failure rate does
  // not move, the next measurement is the Playwright HTML report artifacts (traces/screenshots),
  // which say whether the page was still spinning at the deadline or had already rendered.
  timeout: 90000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://dev--rawsurf.netlify.app',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Desktop Firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'Desktop Safari',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});

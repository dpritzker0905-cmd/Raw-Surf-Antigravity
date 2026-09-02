// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = process.env.E2E_BASE_URL || 'https://dev--rawsurf.netlify.app';

// ⛔ THE SITE GATE. `AccessCodeScreen` wraps the ENTIRE router, and its dev-bypass covers only
// localhost/127.0.0.1 — so on the deployed Netlify host every spec's first `page.goto` lands on
// "Enter Access Code" instead of the app. This lane drives the LIVE deployment (see `baseURL`
// below), so that is not hypothetical: the gate shipped working on 2026-09-02 and every E2E run
// since has been blocked by it. The lane had been passing only because the gate was BROKEN —
// `accessGranted` was initialised `true` and never cleared, so the screen could not render.
//
// Seed the same localStorage key the app writes after a successful entry, which its own
// checkAccess() then re-verifies against the backend. That mirrors a real browser rather than
// bypassing the gate: a WRONG code still fails, exactly as a user's would.
//
// ⚠️ THE CODE IS NOT IN THE REPO, and must not be — committing it would defeat the gate for anyone
// reading the source. It comes from the E2E_ACCESS_CODE secret. When that secret is ABSENT the
// storageState is omitted deliberately, so the suite fails at the gate LOUDLY rather than being
// quietly bypassed; the warning below names the cause so the failure is not re-diagnosed as a
// product bug. (Set with: gh secret set E2E_ACCESS_CODE)
const ACCESS_CODE = (process.env.E2E_ACCESS_CODE || '').trim().toUpperCase();
if (!ACCESS_CODE) {
  console.warn('[playwright.config] E2E_ACCESS_CODE is not set. If the deployed site has its access gate ENABLED, every spec will stop on the "Enter Access Code" screen. This is NOT a product failure -- set the E2E_ACCESS_CODE secret/env var to the current site access code.');
}

/**
 * Seeded localStorage for the deployed origin. Playwright accepts a storageState OBJECT (not just
 * a path), which is applied to every context before the first navigation -- so this covers all
 * four projects below without a globalSetup file or a checked-in state artifact.
 */
const gateStorageState = ACCESS_CODE
  ? { cookies: [], origins: [{ origin: new URL(BASE_URL).origin, localStorage: [{ name: 'site_access_code', value: ACCESS_CODE }] }] }
  : undefined;

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
    baseURL: BASE_URL,
    // Undefined when E2E_ACCESS_CODE is unset -- see the gate note above. Playwright treats an
    // undefined storageState as "no seeding", which is the loud-failure path, not a silent pass.
    storageState: gateStorageState,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // WS-CAN-0027 (2026-08-13). Named by 11.0 as "this audit's single largest evidence gap", then by
    // 11.1, 11.2, 11.4 and 12.0 — five audits disclosed producing zero recordings and none wrote the
    // key. `git log -S video` on this file returns NOTHING: it had never existed. The cause was not
    // negligence: an agent browser pane does not composite frames, so screenshots/video/RAF-FPS are
    // all unavailable there — Playwright's own browser is the only surface that can produce them.
    // retain-on-failure, not 'on': recording every pass costs runtime on a lane that only just
    // reached 5 consecutive greens after 6-pass/28-fail, and a passing test has nothing to show.
    // Reaches CI via reporter:'html' -> playwright-report/ -> upload-artifact (e2e.yml:177).
    video: 'retain-on-failure',
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

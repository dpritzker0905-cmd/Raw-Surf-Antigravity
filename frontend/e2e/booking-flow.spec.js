/**
 * E2E: Explore → spot hub, plus the anonymous access gate.
 *
 * ⛔⛔ WHY THIS FILE WAS REWRITTEN (2026-08-05). Every test failed on every browser — 20 of the
 * suite's 32 failures — and had done so since the day it was written, invisibly, because the E2E
 * job had NEVER EXECUTED A SINGLE TEST (0 of 1,000 runs; its trigger matched an environment string
 * no deployment has ever had). Nothing here was a product bug. Every assertion was written against
 * a route map, an auth model and a set of selectors the app does not have.
 *
 * MEASURED against the live dev preview — every line below was checked in a browser first:
 *   /explore, /map          AUTH-GATED -> /auth?tab=signup&redirect=%2Fexplore when anonymous
 *   /login, /signup         NOT ROUTES. They fall through to the marketing landing page
 *                           (0 forms, 0 email inputs). The real one is /auth.
 *   the localStorage stub   WORKS. Seeding `raw-surf-user` is enough to pass the guard — the
 *                           weather spec already relies on it, and /explore then renders fully.
 *   spot cards              are `[data-testid^="trending-spot-"]` (4 present). `spot-card` and
 *                           `.spot-card` DO NOT EXIST anywhere in the app.
 *   clicking a spot         NAVIGATES to /spot-hub/<uuid> and shows `close-spothub-btn`.
 *                           It is not a drawer, not a [role=dialog], not a .spot-hub element.
 *
 * ★★★ THE TRAP THAT MADE IT READ AS A PRODUCT BUG: the old `beforeEach` waited for `[data-testid]`
 * and that wait SUCCEEDED — the auth page it had been redirected to carries seven of them. Setup
 * passed, so every failure surfaced as "spot cards not visible", which looks like broken data
 * loading rather than "you are anonymous, on a different page, using a selector that does not
 * exist". ⇒ A SETUP ASSERTION MUST PIN WHERE IT LANDED, not merely that something rendered.
 */
const { test, expect } = require('@playwright/test');

// The same stub the weather spec uses. Measured sufficient to pass the route guard.
const standardUser = {
  id: 'test-surfer-id',
  email: 'surfer@rawsurf.com',
  full_name: 'Standard Surfer',
  username: 'standardsurfer',
  role: 'user',
  subscription_tier: 'premium',
  is_admin: false,
};

async function signIn(page) {
  await page.goto('/auth', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ user }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(user));
    localStorage.setItem(`tos-accepted-${user.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent',
      JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
  }, { user: standardUser });
}

test.describe('Anonymous access control', () => {
  test('explore is auth-gated and redirects an anonymous visitor to /auth', async ({ page }) => {
    await page.goto('/explore');
    // ★ Assert the LANDING, not merely that something rendered. The absence of this assertion is
    //   exactly what turned an auth redirect into a phantom "spot cards missing" failure.
    await expect(page).toHaveURL(/\/auth/, { timeout: 15000 });
    await expect(page.locator('[data-testid="auth-card"]')).toBeVisible({ timeout: 60000 });
    // the redirect must carry the intended destination, or login drops the user on the floor
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/explore');
  });

  test('the auth page offers both login and signup', async ({ page }) => {
    // ⚠️ /login and /signup are NOT routes — they fall through to the landing page. /auth is.
    await page.goto('/auth');
    await expect(page.locator('[data-testid="auth-card"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="login-tab"]')).toBeVisible();
    await expect(page.locator('[data-testid="signup-tab"]')).toBeVisible();
  });

  test('signup offers the three account categories', async ({ page }) => {
    await page.goto('/auth?tab=signup');
    await expect(page.locator('[data-testid="auth-card"]')).toBeVisible({ timeout: 15000 });
    for (const who of ['surfer', 'photographer', 'business']) {
      await expect(page.locator(`[data-testid="category-${who}"]`)).toBeVisible();
    }
  });
});

test.describe('Explore', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto('/explore');
    // ★ THE ASSERTION THE OLD SETUP LACKED. Pin that we are actually ON explore, so an auth
    //   regression fails HERE, naming itself, instead of surfacing as a missing element later.
    await expect(page).toHaveURL(/\/explore/, { timeout: 15000 });
    await expect(page.locator('[data-testid="explore-page"]')).toBeVisible({ timeout: 60000 });
  });

  test('explore shows the search input', async ({ page }) => {
    await expect(page.locator('[data-testid="explore-search-input"]')).toBeVisible({ timeout: 60000 });
  });

  test('spot cards are visible on explore', async ({ page }) => {
    // ⚠️ `spot-card` / `.spot-card` do not exist in this app. Spots render as trending-spot-<uuid>.
    await expect(page.locator('[data-testid^="trending-spot-"]').first())
      .toBeVisible({ timeout: 60000 });
  });

  // ⏱ THE ASSERTION TIMEOUTS IN THIS FILE ARE 60 s, MATCHING apiClient.js:30's OWN DECLARED BUDGET
  // ("60s -- handles Render free-tier cold starts"). They were 10-20 s, which contradicted it.
  //
  // TRACE FORENSICS, run 31197681499 (`close-spothub-btn` not found):
  //   click trending-spot -> OK · toHaveURL(/\/spot-hub\//) -> PASSED · toBeVisible -> FAILED at 10.0 s
  //   final URL: /spot-hub/45453233-…  full app shell present, inner `main` EMPTY
  //   SpotHub.js:235 renders a skeleton with no testids while `loading`; the `!spot` branch (:257)
  //   would have printed "Spot Not Found", which is ABSENT -> it was STILL LOADING, not errored.
  //   0-trace.network: of 112 requests exactly 2 never completed (status -1) — and they are the last
  //   two: /api/conditions/batch and /api/explore/spot-details/<uuid>.
  // WHY SLOW: `on: push: [dev]` starts this run AND the Render redeploy at the same time, and the job
  // gates only on the Netlify frontend. Measured: the backend booted 140 s AFTER the run began and
  // the failing request landed 257 s after boot, siblings running 5-13x slower than warm.
  //
  // ⚠️ RAISING THE PER-TEST TIMEOUT (playwright.config.js 30 s -> 90 s) DID NOT AND COULD NOT HELP —
  // the binding constraint was this per-ASSERTION budget, which the enclosing timeout never reaches.
  // ⛔ The real fix is ordering: gate the e2e job on the backend being up, not just the frontend.
  // Until then these budgets must not be tighter than the client the app itself ships.
  test('clicking a spot opens its spot hub', async ({ page }) => {
    await page.locator('[data-testid^="trending-spot-"]').first().click();
    // ⚠️ Measured: this NAVIGATES to /spot-hub/<uuid>. It is not a drawer or a [role=dialog].
    await expect(page).toHaveURL(/\/spot-hub\//, { timeout: 15000 });
    await expect(page.locator('[data-testid="close-spothub-btn"]')).toBeVisible({ timeout: 60000 });
  });

  test('navigation is present, and it is the RIGHT nav for the viewport', async ({ page, isMobile }) => {
    // ⛔ I BROKE THIS MYSELF AND THE OLD NAME IS WHY. The original was `bottom nav is visible on
    //    mobile`; I renamed it to "for a signed-in user" and dropped the qualifier, because I had
    //    measured `bottom-nav` visible in ONE browser pane at ONE viewport and generalised from it.
    //    It then failed on Desktop Chrome / Firefox / Safari and passed on Mobile Safari — the
    //    element is in the DOM on desktop but hidden, because the bottom nav is a MOBILE pattern.
    // ★ A bound measured on a narrow range is a bound on that range only. The old test name
    //   encoded a real constraint and deleting it deleted the knowledge.
    // ⇒ Now it pins the actual responsive contract on BOTH form factors, which is what
    //   CLAUDE.md's desktop-AND-mobile mandate asks for anyway.
    // MEASURED on both form factors before this was written — and my FIRST correction was also
    // wrong: `top-nav` is hidden on desktop too, so asserting it would have failed just as loudly.
    //   375x812  mobile :  bottom-nav VISIBLE · nav-explore hidden
    //   1280x800 desktop:  bottom-nav hidden  · nav-explore VISIBLE  (a SIDEBAR: nav-home/explore/
    //                      map/create/messages/profile/settings/logout)
    // ⚠️ The browser pane defaulted to 630 px wide, where BOTH are visible — which is precisely how
    //    the original bad measurement happened. Assert at a real desktop width or not at all.
    if (isMobile) {
      await expect(page.locator('[data-testid="bottom-nav"]')).toBeVisible({ timeout: 60000 });
      await expect(page.locator('[data-testid="nav-explore"]')).toBeHidden();
    } else {
      await expect(page.locator('[data-testid="nav-explore"]')).toBeVisible({ timeout: 60000 });
      await expect(page.locator('[data-testid="bottom-nav"]')).toBeHidden();
    }
  });
});

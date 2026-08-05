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
    await expect(page.locator('[data-testid="auth-card"]')).toBeVisible({ timeout: 10000 });
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
    await expect(page.locator('[data-testid="explore-page"]')).toBeVisible({ timeout: 20000 });
  });

  test('explore shows the search input', async ({ page }) => {
    await expect(page.locator('[data-testid="explore-search-input"]')).toBeVisible({ timeout: 10000 });
  });

  test('spot cards are visible on explore', async ({ page }) => {
    // ⚠️ `spot-card` / `.spot-card` do not exist in this app. Spots render as trending-spot-<uuid>.
    await expect(page.locator('[data-testid^="trending-spot-"]').first())
      .toBeVisible({ timeout: 20000 });
  });

  test('clicking a spot opens its spot hub', async ({ page }) => {
    await page.locator('[data-testid^="trending-spot-"]').first().click();
    // ⚠️ Measured: this NAVIGATES to /spot-hub/<uuid>. It is not a drawer or a [role=dialog].
    await expect(page).toHaveURL(/\/spot-hub\//, { timeout: 15000 });
    await expect(page.locator('[data-testid="close-spothub-btn"]')).toBeVisible({ timeout: 10000 });
  });

  test('the bottom nav is present for a signed-in user', async ({ page }) => {
    // Measured: the signed-OUT landing page carries 0 <nav> elements; this is authenticated-only.
    await expect(page.locator('[data-testid="bottom-nav"]')).toBeVisible({ timeout: 10000 });
  });
});

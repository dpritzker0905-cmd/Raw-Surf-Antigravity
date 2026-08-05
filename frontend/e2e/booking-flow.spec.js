/**
 * E2E: Booking Flow — explore → spot → request drawer
 *
 * ⛔⛔ WHY THIS FILE WAS REWRITTEN (2026-08-05). Every test in it failed on every browser — 20 of
 * the suite's 32 failures — and had been failing since it was written, invisibly, because the E2E
 * job had NEVER EXECUTED A SINGLE TEST (0 of 1,000 runs; its trigger matched an environment string
 * no deployment has ever had). The specs were written against a route map and an auth model the app
 * does not have, and nothing ever said so.
 *
 * MEASURED against the live dev preview, not inferred:
 *   /explore  -> REDIRECTS to /auth?tab=signup&redirect=%2Fexplore   (it is AUTH-GATED)
 *   /login    -> stays at /login and renders the MARKETING LANDING PAGE (0 forms, 0 email inputs)
 *   /signup   -> the same. Neither is a route; the real one is /auth.
 *   /auth     -> renders a CATEGORY CHOOSER first (data-testid: auth-card, login-tab, signup-tab,
 *                category-surfer/photographer/business) — still 0 forms until a category is picked.
 *   /         -> 0 <nav> elements; the bottom nav is authenticated-only.
 *
 * ★★★ THE TRAP THAT MADE IT LOOK PLAUSIBLE: the old `beforeEach` waited for `[data-testid]`, and
 * that wait SUCCEEDED — the auth page it had been redirected to has seven of them. The setup passed,
 * so the failure surfaced as "spot cards not visible", which reads like a product bug rather than
 * "you are anonymous and on a completely different page".
 * ⇒ A SETUP ASSERTION MUST PIN WHERE IT LANDED, not merely that something rendered.
 *
 * WHAT THIS FILE NOW DOES: it tests what an ANONYMOUS visitor can actually reach — real coverage
 * that passes honestly. The authenticated booking flow, which is what the original was reaching
 * for, needs a signed-in fixture and is marked `test.fixme` with that reason, so it stays VISIBLE
 * as missing rather than silently red or quietly deleted.
 */
const { test, expect } = require('@playwright/test');

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

  test('the landing page renders for a signed-out visitor', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Raw Surf').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid]').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Authentication', () => {
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

test.describe('Booking Flow (authenticated)', () => {
  // ⛔ NOT SKIPPED SILENTLY. `fixme` reports these in the run summary, so the gap stays COUNTABLE
  //    instead of vanishing. They need a signed-in storageState fixture, and the backend suite is
  //    the warning here — its single modal skip reason is "Login failed", from long-rotated test
  //    credentials, so an auth fixture has to be built deliberately rather than assumed.
  test.fixme('spot cards are visible on explore — NEEDS an authenticated fixture', async ({ page }) => {
    await page.goto('/explore');
    await expect(page.locator('[data-testid="spot-card"]').or(page.locator('.spot-card')).first())
      .toBeVisible({ timeout: 20000 });
  });

  test.fixme('clicking a spot opens the spot drawer — NEEDS an authenticated fixture', async ({ page }) => {
    await page.goto('/explore');
    await page.locator('[data-testid="spot-card"]').or(page.locator('.spot-card')).first().click();
    await expect(
      page.locator('[data-testid="spot-drawer"]')
        .or(page.locator('[role="dialog"]'))
        .or(page.locator('.spot-hub'))
    ).toBeVisible({ timeout: 10000 });
  });

  test.fixme('bottom nav is visible — NEEDS an authenticated fixture', async ({ page }) => {
    // Measured: the signed-out landing page carries 0 <nav> elements.
    await page.goto('/');
    await expect(page.locator('[data-testid="bottom-nav"]').or(page.locator('nav').last()))
      .toBeVisible({ timeout: 10000 });
  });
});

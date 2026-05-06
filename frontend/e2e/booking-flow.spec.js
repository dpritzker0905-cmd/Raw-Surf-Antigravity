/**
 * E2E: Booking Flow — highest-value regression test
 * Tests the on-demand booking flow from explore → spot → request drawer
 */
const { test, expect } = require('@playwright/test');

test.describe('Booking Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the explore page
    await page.goto('/explore');
    // Wait for the page to load
    await page.waitForSelector('[data-testid]', { timeout: 15000 });
  });

  test('explore page loads and shows search bar', async ({ page }) => {
    // The explore page should render with a search bar
    await expect(page.locator('input[placeholder*="Search"]').or(page.locator('[data-testid="global-search"]'))).toBeVisible({ timeout: 10000 });
  });

  test('spot cards are visible on explore', async ({ page }) => {
    // Wait for spot cards to load (may take time on cold start)
    const spotCards = page.locator('[data-testid="spot-card"]').or(page.locator('.spot-card'));
    await expect(spotCards.first()).toBeVisible({ timeout: 20000 });
  });

  test('clicking a spot opens the spot drawer', async ({ page }) => {
    // Click the first spot card
    const spotCards = page.locator('[data-testid="spot-card"]').or(page.locator('.spot-card'));
    await spotCards.first().click();
    
    // Spot drawer or spot hub should open
    await expect(
      page.locator('[data-testid="spot-drawer"]')
        .or(page.locator('[role="dialog"]'))
        .or(page.locator('.spot-hub'))
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Authentication', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]').or(page.locator('input[placeholder*="email" i]'))).toBeVisible({ timeout: 10000 });
  });

  test('signup page renders', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('form').or(page.locator('[data-testid="signup-form"]'))).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Navigation', () => {
  test('bottom nav is visible on mobile', async ({ page }) => {
    await page.goto('/');
    // Bottom nav should be visible
    await expect(
      page.locator('[data-testid="bottom-nav"]')
        .or(page.locator('nav').last())
    ).toBeVisible({ timeout: 10000 });
  });
});

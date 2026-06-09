/**
 * E2E: Weather Simulation & Map Controls
 * Tests surfer lockout, admin sandbox, diagnostics telemetry, and map controls.
 */
const { test, expect } = require('@playwright/test');

const standardUser = {
  id: 'test-surfer-id',
  email: 'surfer@rawsurf.com',
  full_name: 'Standard Surfer',
  username: 'standardsurfer',
  role: 'user',
  subscription_tier: 'premium',
  is_admin: false
};

const adminUser = {
  id: 'admin-user-id',
  email: 'admin@rawsurf.com',
  full_name: 'Admin Officer',
  username: 'adminuser',
  role: 'admin',
  subscription_tier: 'premium',
  is_admin: true
};

test.describe('Surfer Lockout Redirection', () => {
  test('non-admin surfer is locked out of admin dashboard and can redirect back', async ({ page }) => {
    // 1. Visit explore page to register domain/localStorage context
    await page.goto('/explore');
    
    // 2. Set non-admin credentials and bypass ToS reacceptance gate
    await page.evaluate(({ user }) => {
      localStorage.setItem('raw-surf-user', JSON.stringify(user));
      localStorage.setItem(`tos-accepted-${user.id}-1.0`, Date.now().toString());
      localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    }, { user: standardUser });

    // 3. Attempt to access admin page
    await page.goto('/admin');

    // 4. Verify "Unauthorized Access" screen is displayed
    const unauthorizedTitle = page.locator('h2:has-text("Unauthorized Access")');
    await expect(unauthorizedTitle).toBeVisible({ timeout: 10000 });

    // 5. Click "Return to Surfer Feed"
    const returnBtn = page.locator('button:has-text("Return to Surfer Feed")');
    await expect(returnBtn).toBeVisible();
    await returnBtn.click();

    // 6. Assert that navigation redirects back to feed or explore
    await expect(page).toHaveURL(/.*\/feed/);
  });
});

test.describe('Admin Console Operations', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin and bypass cookie / ToS consent
    await page.goto('/explore');
    await page.evaluate(({ user }) => {
      localStorage.setItem('raw-surf-user', JSON.stringify(user));
      localStorage.setItem(`tos-accepted-${user.id}-1.0`, Date.now().toString());
      localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    }, { user: adminUser });
  });

  test('admin simulation engine executes weather swell spike scenario', async ({ page }) => {
    await page.goto('/admin');

    // Verify admin page loaded
    await expect(page.locator('h1:has-text("RAW SURF OS")')).toBeVisible({ timeout: 15000 });

    // Navigate to "Simulation Sandbox" tab
    const sandboxTab = page.locator('button:has-text("Simulation Sandbox")');
    await expect(sandboxTab).toBeVisible();
    await sandboxTab.click();

    // Select the "Weather Swell Spike" scenario
    const weatherScenario = page.locator('button:has-text("Weather Swell Spike")');
    await expect(weatherScenario).toBeVisible();
    await weatherScenario.click();

    // Adjust swell amplitude slider to 8.5 meters
    const swellSlider = page.locator('input[type="range"]').first();
    await expect(swellSlider).toBeVisible();
    await swellSlider.fill('8.5');

    // Run simulation
    const runBtn = page.locator('button:has-text("Run Sandbox Simulation")');
    await expect(runBtn).toBeVisible();
    await runBtn.click();

    // Verify sandbox terminal outputs expected logs
    const activeLog1 = page.locator('text=[SIMULATE] Spawning hypothetical weather thread...');
    const activeLog2 = page.locator('text=[SANDBOX] NOAA swell telemetry parsed: 8.5m at 14s intervals');
    const activeLog3 = page.locator('text=[SANDBOX] Wave impact category classification: Extreme (Double Overhead)');
    const activeLog4 = page.locator('text=[SIMULATE] Simulated weather completed successfully.');

    await expect(activeLog1).toBeVisible({ timeout: 5000 });
    await expect(activeLog2).toBeVisible({ timeout: 5000 });
    await expect(activeLog3).toBeVisible({ timeout: 5000 });
    await expect(activeLog4).toBeVisible({ timeout: 5000 });
  });

  test('admin diagnostics telemetry refresh synchronizes panel', async ({ page }) => {
    await page.goto('/admin');

    // Navigate to "Weather Diagnostics" tab
    const diagnosticsTab = page.locator('button:has-text("Weather Diagnostics")');
    await expect(diagnosticsTab).toBeVisible({ timeout: 10000 });
    await diagnosticsTab.click();

    // Verify panel header
    await expect(page.locator('h2:has-text("Weather Intelligence Diagnostic Panel")')).toBeVisible();

    // Click "Refresh Telemetry" button
    const refreshBtn = page.locator('button:has-text("Refresh Telemetry")');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // Check for success toast message
    const successToast = page.locator('text=Diagnostics telemetry successfully synchronized!');
    await expect(successToast).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Standard Surfer Map Controls', () => {
  test.beforeEach(async ({ page }) => {
    // Login as standard surfer to access /map
    await page.goto('/explore');
    await page.evaluate(({ user }) => {
      localStorage.setItem('raw-surf-user', JSON.stringify(user));
      localStorage.setItem(`tos-accepted-${user.id}-1.0`, Date.now().toString());
      localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    }, { user: standardUser });
  });

  test('standard surfer map controls model selection, layer toggle, and timeline scrubbing', async ({ page }) => {
    await page.goto('/map');

    // Wait for the map page to load (wait for map right controls or general map container)
    const rightControls = page.locator('[data-testid="featured-photographers-btn"]');
    await expect(rightControls).toBeVisible({ timeout: 15000 });

    const isMobile = await page.evaluate(() => window.innerWidth < 768);

    if (isMobile) {
      // Toggle the bottom sheet weather layers menu
      const weatherBtn = page.locator('[data-testid="weather-layers-btn"]');
      await expect(weatherBtn).toBeVisible();
      await weatherBtn.click();
    }

    // 1. Select the "ICON" model selector button (target the visible one)
    const iconBtn = page.locator('button').filter({ hasText: 'ICON' }).filter({ visible: true }).first();
    await expect(iconBtn).toBeVisible();
    await iconBtn.click();

    // 2. Select the "Wind" layer toggle button (target the visible one)
    const windBtn = page.locator('button').filter({ hasText: 'Wind' }).filter({ visible: true }).first();
    await expect(windBtn).toBeVisible();
    await windBtn.click();

    // 3. Verify timeline controls are now visible since a layer is active (target the visible one)
    const playBtn = page.locator('button[aria-label="Play"]').filter({ visible: true });
    await expect(playBtn).toBeVisible();

    // Verify time readout initially says "Live"
    const timeReadout = page.locator('div.min-w-\\[50px\\]').filter({ visible: true });
    await expect(timeReadout).toHaveText('Live');

    // 4. Toggle timeline play
    await playBtn.click();
    
    // Play button should change to Pause button (target the visible one)
    const pauseBtn = page.locator('button[aria-label="Pause"]').filter({ visible: true });
    await expect(pauseBtn).toBeVisible();

    // Toggle pause
    await pauseBtn.click();
    await expect(playBtn).toBeVisible();

    // 5. Scrub the timeline slider (target the visible one)
    const scrubber = page.locator('input[aria-label="Timeline scrubber"]').filter({ visible: true });
    await expect(scrubber).toBeVisible();

    // Use native React setter override to change range input value and trigger handlers
    await scrubber.evaluate(el => {
      const prototype = Object.getPrototypeOf(el);
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
      valueSetter.call(el, '24');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Check time readout updates from "Live"
    await expect(timeReadout).not.toHaveText('Live');
  });
});

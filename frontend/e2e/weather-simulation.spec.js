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

test.beforeEach(async ({ page }) => {
  // Disable service worker to prevent NS_ERROR_FAILURE and caching issues in E2E tests
  await page.addInitScript(() => {
    const mockServiceWorker = {
      register: () => new Promise(() => {}),
      ready: new Promise(() => {}),
      addEventListener: () => {},
      removeEventListener: () => {},
      getRegistration: () => Promise.resolve(null),
      getRegistrations: () => Promise.resolve([]),
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      get() { return mockServiceWorker; },
      configurable: true
    });
  });

  page.on('console', msg => console.log(`[PAGE CONSOLE] [${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.stack || err.message}`));

  // Intercept and mock external requests to prevent navigation timeouts under sandbox network
  // restrictions.
  //
  // ⚠️ THIS ALLOWLIST IS THE SUITE'S OWN BACKEND KILL SWITCH. The frontend calls the API directly
  // at REACT_APP_BACKEND_URL (netlify.toml -> https://raw-surf-antigravity.onrender.com), NOT
  // through the site origin. With only the site listed, every backend call fell through to the
  // terminal `else` and was fulfilled with a SYNTHETIC 404 by this very handler — which is the
  // literal source of `renderDecision: "fallback_legacy", reason: "Backend grid returned HTTP
  // 404"`. The 404 was manufactured here; the backend never sent it. Measured 2026-08-06: the
  // identical click sequence run WITHOUT this handler returns 200 on 8 of 8 /api/weather requests
  // and reaches renderable=true / clip_to_coverage.
  //
  // Both origins are read from env because both are real inputs: the e2e workflow accepts a
  // `base_url`, and hardcoding either host silently 404s the whole app for any other target.
  const allowedOrigins = [
    process.env.E2E_BASE_URL || 'https://dev--rawsurf.netlify.app',
    process.env.REACT_APP_BACKEND_URL || 'https://raw-surf-antigravity.onrender.com',
    'https://dev--rawsurf.netlify.app',
    'http://dev--rawsurf.netlify.app',
    'http://localhost',
    'https://localhost',
    'http://127.0.0.1',
    'https://127.0.0.1',
    'http://[::1]',
    'https://[::1]',
  ];

  await page.route('**/*', route => {
    const url = route.request().url();
    if (
      allowedOrigins.some(origin => url.startsWith(origin)) ||
      url.startsWith('data:') ||
      url.startsWith('blob:')
    ) {
      route.continue();
    } else if (url.includes('.js') || route.request().resourceType() === 'script') {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* mocked */'
      });
    } else if (url.includes('.css') || route.request().resourceType() === 'stylesheet') {
      route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: '/* mocked */'
      });
    } else {
      route.fulfill({
        status: 404,
        body: ''
      });
    }
  });
});

test.describe('Surfer Lockout Redirection', () => {
  test.beforeEach(async ({ page }) => {
    // 1. Visit auth page to register domain/localStorage context
    await page.goto('/auth', { waitUntil: 'domcontentloaded' });
    
    // 2. Set non-admin credentials and bypass ToS reacceptance gate
    await page.evaluate(({ user }) => {
      localStorage.setItem('raw-surf-user', JSON.stringify(user));
      localStorage.setItem(`tos-accepted-${user.id}-1.0`, Date.now().toString());
      localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
      localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    }, { user: standardUser });
  });

  test('non-admin surfer is locked out of admin dashboard and can redirect back', async ({ page }) => {
    // 3. Attempt to access admin page
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });

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
    await page.goto('/auth', { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ user }) => {
      localStorage.setItem('raw-surf-user', JSON.stringify(user));
      localStorage.setItem(`tos-accepted-${user.id}-1.0`, Date.now().toString());
      localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
      localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    }, { user: adminUser });

    // Seeding the user makes /auth redirect itself to /feed. Let that land HERE, or it is still
    // in flight when the test calls goto('/admin') and interrupts it — observed on Mobile Safari
    // 2026-08-06: "Navigation to .../admin is interrupted by another navigation to .../feed".
    // Only observable once the backend is actually reachable (see the allowlist note above);
    // while every API call was being 404'd by our own route handler the redirect never fired.
    // Tolerant by design: if a build stops redirecting there is nothing to await, and the wait
    // expiring changes nothing about what the test then asserts.
    await page.waitForURL(/\/(feed|explore)(\/|$|\?)/, { timeout: 10000 }).catch(() => {});
  });

  test('admin simulation engine executes weather swell spike scenario', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });

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
    
    // Use native React setter override to change range input value and trigger handlers in all browsers
    await swellSlider.evaluate(el => {
      const prototype = Object.getPrototypeOf(el);
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
      valueSetter.call(el, '8.5');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

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
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });

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
    await page.goto('/auth', { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ user }) => {
      localStorage.setItem('raw-surf-user', JSON.stringify(user));
      localStorage.setItem(`tos-accepted-${user.id}-1.0`, Date.now().toString());
      localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
      localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
      localStorage.setItem('force_marine_fallback', 'true');
    }, { user: standardUser });

    // Same /auth -> /feed redirect race as the admin block above; settle it before the test's own
    // goto('/map') so an in-flight redirect cannot interrupt it.
    await page.waitForURL(/\/(feed|explore)(\/|$|\?)/, { timeout: 10000 }).catch(() => {});
  });

  test('standard surfer map controls model selection, layer toggle, and timeline scrubbing', async ({ page }) => {
    // Playwright's default per-test budget is 30 s (no `timeout` in playwright.config.js). This
    // test loads /map (8-20 s measured) and then activates a layer, which is a marine cache MISS
    // at a measured 18-35 s — so the default cannot cover a cold run and the budget itself was a
    // ceiling, independent of any assertion.
    test.setTimeout(120000);

    await page.goto('/map', { waitUntil: 'domcontentloaded' });

    // Wait for the map page to load (wait for map right controls or general map container)
    // /map is lazily chunked and heavy. Measured at the artifact 2026-08-06: this control was NOT
    // visible 8 s after navigation at the mobile viewport and WAS visible by ~18 s, so 15 s sat
    // right on the boundary — CI 31061734287 failed here on Mobile Safari and Desktop Firefox
    // while passing on Desktop Chrome and Safari, which is exactly what a marginal bound looks
    // like. 45 s is well inside the per-test budgets set below.
    const rightControls = page.locator('[data-testid="featured-photographers-btn"]');
    await expect(rightControls).toBeVisible({ timeout: 45000 });

    const isMobile = await page.evaluate(() => window.innerWidth < 768);

    if (isMobile) {
      // Toggle the bottom sheet weather layers menu
      const weatherBtn = page.locator('[data-testid="weather-layers-btn"]');
      await expect(weatherBtn).toBeVisible();
      // Click using browser-side click to avoid WebKit-specific scrolling or click actionability bugs
      await weatherBtn.evaluate(el => el.click());
    }

    // 1. Select the "ICON" model selector button (target the visible one)
    const iconBtn = page.locator('button').filter({ hasText: 'ICON' }).filter({ visible: true }).first();
    await expect(iconBtn).toBeVisible();
    await iconBtn.evaluate(el => el.click());

    // 2. Select the "Wind" layer toggle button (target the visible one)
    const windBtn = page.locator('button').filter({ hasText: 'Wind' }).filter({ visible: true }).first();
    await expect(windBtn).toBeVisible();
    await windBtn.evaluate(el => el.click());

    // 3. Verify timeline controls are now visible since a layer is active (target the visible one)
    const playBtn = page.locator('button[aria-label="Play"]').filter({ visible: true });
    await expect(playBtn).toBeVisible();

    // Verify time readout initially says "Live"
    const timeReadout = page.locator('div.min-w-\\[50px\\]').filter({ visible: true });
    await expect(timeReadout).toHaveText('Live');

    // 4. Toggle timeline play
    await playBtn.evaluate(el => el.click());
    
    // Play button should change to Pause button (target the visible one)
    const pauseBtn = page.locator('button[aria-label="Pause"]').filter({ visible: true });
    await expect(pauseBtn).toBeVisible();

    // Toggle pause
    await pauseBtn.evaluate(el => el.click());
    await expect(playBtn).toBeVisible();

    // 5. Scrub the timeline (target the visible one).
    //
    // ⚠️ Until 2026-08-06 this asserted `input[aria-label="Timeline scrubber"]` and failed 12/12
    // (4 projects x 3 attempts) — because that control CANNOT render. MapWeatherControls picks the
    // widget with `useWheel = !shouldUseClassicScrubber(window)`, and that predicate is exactly
    // `window.__RAW_CLASSIC_SCRUBBER__ === true` (ForecastWheel.js) — a kill-switch nothing sets.
    // The classic <input> is the disabled fallback; ForecastWheel is what ships.
    // Measured at the artifact (dev--rawsurf, 2026-08-06), desktop 1280 AND mobile 375, after the
    // layer is active: `input[aria-label="Timeline scrubber"]` = 0 nodes;
    // `[role="slider"][aria-label="Forecast timeline wheel"]` = 2 in DOM, exactly 1 visible.
    //
    // Driving it by keyboard is deliberate: it is the a11y contract CLAUDE.md mandates for this
    // widget (role="slider", Arrow +/-1 h, PageUp/PageDown +/-1 day, Home = now).
    const scrubber = page
      .locator('[role="slider"][aria-label="Forecast timeline wheel"]')
      .filter({ visible: true });
    await expect(scrubber).toBeVisible();
    await expect(scrubber).toHaveAttribute('aria-valuenow', '0');

    // PageUp = +1 day. NOT PageDown: that is -1 day, which clamps at "Now" and changes nothing —
    // measured live, aria-valuenow stayed "0". `press()` focuses and keys in one action, so a
    // re-render cannot steal focus between the two.
    await scrubber.press('PageUp');

    // The widget's own contract moved (0 -> 24), and the readout followed it off "Live".
    await expect(scrubber).not.toHaveAttribute('aria-valuenow', '0');
    await expect(timeReadout).not.toHaveText('Live');
  });

  test('surfer switches models GFS vs Copernicus and validates telemetry & wave animation canvas', async ({ page }) => {
    // ⚠️ THE REAL CEILING. This test does a page load plus THREE marine cache misses in sequence
    // (activate Waves, switch to GFS, switch to EURO) — each a measured 18-35 s — inside
    // Playwright's 30 s default per-test budget. It could not pass at any inner timeout value;
    // raising the gates to 45 s alone just moved the failure to the outer budget (observed
    // 2026-08-06: "Test timeout of 30000ms exceeded" landing inside the new catch block).
    // Worst case here is ~20 s load + 3 x 35 s = 125 s, so 180 s carries real headroom.
    test.setTimeout(180000);

    // ⚠️ THIS TEST IS WEBGL-DEPENDENT END TO END. `#marine-canvas-layer` is a WebGL overlay canvas
    // (not a MapLibre layer), and everything asserted below it — the canvas, the marine projection
    // diag, the Copernicus grid diag — only exists once that context is created. On CI 31066966918
    // it failed on Desktop Firefox with `element(s) not found` after 30 s while Desktop Chrome
    // PASSED (the control), and the runner log carried "Failed to create WebGL context" x6:
    // headless Firefox on the GitHub runner has no WebGL, Chrome falls back to SwiftShader, Safari
    // has it. The app is not at fault and neither is the assertion.
    //
    // ★ PROBE THE CAPABILITY, DO NOT NAME THE BROWSER. A `browserName === 'firefox'` skip would go
    // on lying the day the runner image gains WebGL, and would hide a real regression on any
    // browser that HAS it. This asks the page the same question the app asks.
    // The probe runs after the load gate below, where a page context exists.

    await page.goto('/map', { waitUntil: 'domcontentloaded' });

    // Wait for the map page to load (wait for map right controls or general map container)
    // /map is lazily chunked and heavy. Measured at the artifact 2026-08-06: this control was NOT
    // visible 8 s after navigation at the mobile viewport and WAS visible by ~18 s, so 15 s sat
    // right on the boundary — CI 31061734287 failed here on Mobile Safari and Desktop Firefox
    // while passing on Desktop Chrome and Safari, which is exactly what a marginal bound looks
    // like. 45 s is well inside the per-test budgets set below.
    // ⏱ 65 s IS NOT ANOTHER GUESS — IT IS THE APP'S OWN BUDGET PLUS SLACK. `apiClient` declares
    // `timeout: 60000` ("handles Render free-tier cold starts"), and this control only appears once
    // `useMapData`'s gating fetch settles. At 45 s the gate sat BELOW the client's own timeout, so a
    // request that was slow-but-eventually-served failed the test while the app was still correctly
    // waiting for it. A bound underneath the thing it is bounding can only ever be wrong.
    // The per-test budget here is 180 s, so 65 s still leaves room for the three cache misses below.
    // ⚠️ THE REAL FIX IS IN THE APP, NOT HERE (`useMapData.loadMapData`): the splash used to be
    // gated on `Promise.all` of the spots fetch AND both photographer overlays, so any one of three
    // stalling held the map. It now clears as soon as the SPOTS arrive. This bound is the backstop,
    // not the remedy — do not raise it again without re-reading that.
    const rightControls = page.locator('[data-testid="featured-photographers-btn"]');
    await expect(rightControls).toBeVisible({ timeout: 65000 });

    // The WebGL capability probe promised above. Asks the page exactly what the marine engine asks.
    const hasWebGL = await page.evaluate(() => {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch (e) {
        return false;
      }
    });
    test.skip(!hasWebGL, 'no WebGL context on this runner — the marine overlay cannot render, so '
                       + 'every assertion below would measure the runner, not the app');

    const isMobile = await page.evaluate(() => window.innerWidth < 768);

    if (isMobile) {
      // Toggle the bottom sheet weather layers menu
      const weatherBtn = page.locator('[data-testid="weather-layers-btn"]');
      await expect(weatherBtn).toBeVisible();
      await weatherBtn.evaluate(el => el.click());
    }

    // 1. Select the "Waves" layer toggle button (target the visible one)
    const wavesBtn = page.locator('button').filter({ hasText: 'Waves' }).filter({ visible: true }).first();
    await expect(wavesBtn).toBeVisible();
    await wavesBtn.evaluate(el => el.click());

    // Verify wave canvas overlays deck.gl and is visible.
    // Budget: activating a layer is a marine cache MISS, measured 2026-08-03 at 13-43 MB and
    // 18-35 s (a HIT is 1.3-3 MB). The old 10 s was below the miss floor, so this failed cold on
    // 3 of 12 attempts and the remaining 9 died at the telemetry gate below.
    const waveCanvas = page.locator('#marine-canvas-layer');
    await expect(waveCanvas).toBeVisible({ timeout: 30000 });

    if (isMobile) {
      // Re-open the bottom sheet weather layers menu because selecting the layer closed it
      const weatherBtn = page.locator('[data-testid="weather-layers-btn"]');
      await expect(weatherBtn).toBeVisible();
      await weatherBtn.evaluate(el => el.click());
    }

    // 2. Select "GFS" model selector button (target the visible one)
    const gfsBtn = page.locator('button').filter({ hasText: 'GFS' }).filter({ visible: true }).first();
    await expect(gfsBtn).toBeVisible();
    await gfsBtn.evaluate(el => el.click());

    // Wait for GFS telemetry synchronization in window.__MARINE_PROJECTION_DIAG__.
    //
    // Switching the model requests a product this session has never fetched, so it is a marine
    // cache MISS by construction — 18-35 s measured (see the canvas budget above). The old 15 s
    // sat under that floor and timed out on 9 of 12 attempts.
    //
    // The bare timeout was also undiagnosable: this gate ANDs three terms and reported none of
    // them, so a failure could not tell "the model never switched" from "it switched but never
    // became renderable". Measured at the artifact 2026-08-06 the gate DOES pass
    // (activeModel=GFS, renderable=true, renderDecision=clip_to_coverage), so on the next failure
    // we need the term values, not another guess.
    try {
      await page.waitForFunction(() => {
        const diag = window.__MARINE_PROJECTION_DIAG__;
        return diag && diag.activeModel === 'GFS' &&
               (diag.renderable === true || diag.renderDecision === 'render' || diag.renderDecision === 'clip_to_coverage');
      }, null, { timeout: 45000 });
    } catch (err) {
      const seen = await page.evaluate(() => {
        const d = window.__MARINE_PROJECTION_DIAG__;
        if (!d) return { diagPresent: false };
        return {
          diagPresent: true,
          activeModel: d.activeModel,
          renderable: d.renderable,
          renderDecision: d.renderDecision,
          status: d.status,
          reason: d.reason,
          outsideCoverageReason: d.outsideCoverageReason,
          productId: d.productId,
        };
      });
      throw new Error(
        `GFS telemetry gate never satisfied. Terms actually seen: ${JSON.stringify(seen)}\n${err.message}`
      );
    }

    // Assert GFS telemetry is fully synchronized
    const gfsDiag = await page.evaluate(() => window.__MARINE_PROJECTION_DIAG__);
    expect(gfsDiag.activeModel).toBe('GFS');
    const isGfsRenderable = gfsDiag.renderable === true || gfsDiag.renderDecision === 'render' || gfsDiag.renderDecision === 'clip_to_coverage';
    expect(isGfsRenderable).toBe(true);

    // 3. Switch to "EURO" model selector (Copernicus)
    const euroBtn = page.locator('button').filter({ hasText: 'EURO' }).filter({ visible: true }).first();
    await expect(euroBtn).toBeVisible();
    await euroBtn.evaluate(el => el.click());

    // Wait for Copernicus (EURO) telemetry synchronization.
    //
    // Another model switch, so another marine cache MISS — same 18-35 s budget as the GFS gate.
    // This gate ANDs FIVE terms and reported none of them on timeout. Measured at the artifact
    // 2026-08-06 all five pass: activeModel=EURO, diag present, provider=open-meteo,
    // fallbackReason=null, renderable=true.
    // ⚠️ `skipped` and `nonzeroCount` are NOT keys of __COPERNICUS_GRID_DIAG__ (measured), so the
    // last two clauses of the renderable term are dead — only `renderable === true` can satisfy it.
    try {
      await page.waitForFunction(() => {
        const marineDiag = window.__MARINE_PROJECTION_DIAG__;
        const copernicusDiag = window.__COPERNICUS_GRID_DIAG__;
        return marineDiag && marineDiag.activeModel === 'EURO' &&
               copernicusDiag &&
               (copernicusDiag.provider === 'copernicus' || copernicusDiag.provider === 'backend-weather-service' || copernicusDiag.provider === 'open-meteo' || copernicusDiag.provider === 'estimated') &&
               (!copernicusDiag.fallbackReason || copernicusDiag.fallbackReason === null) &&
               (copernicusDiag.renderable === true || copernicusDiag.skipped === false || (copernicusDiag.nonzeroCount !== undefined && copernicusDiag.nonzeroCount > 0));
      }, null, { timeout: 45000 });
    } catch (err) {
      const seen = await page.evaluate(() => {
        const m = window.__MARINE_PROJECTION_DIAG__;
        const c = window.__COPERNICUS_GRID_DIAG__;
        return {
          term1_activeModel: m ? m.activeModel : '<no marine diag>',
          term2_copernicusDiagPresent: !!c,
          term3_provider: c ? c.provider : null,
          term4_fallbackReason: c ? c.fallbackReason : null,
          term5_renderable: c ? c.renderable : null,
          gridMode: c ? c.gridMode : null,
          is_estimated: c ? c.is_estimated : null,
        };
      });
      throw new Error(
        `EURO/Copernicus telemetry gate never satisfied. Terms actually seen: ${JSON.stringify(seen)}\n${err.message}`
      );
    }

    // Assert Copernicus/EURO telemetry is fully synchronized and valid
    const finalDiag = await page.evaluate(() => {
      return {
        marine: window.__MARINE_PROJECTION_DIAG__,
        copernicus: window.__COPERNICUS_GRID_DIAG__
      };
    });

    expect(finalDiag.marine.activeModel).toBe('EURO');
    expect(finalDiag.copernicus.fallbackReason || null).toBeNull();
    // ⚠️ The last clause read `finalDiag.nonzeroCount` while its own guard read
    // `finalDiag.copernicus.nonzeroCount` — an undefined that could never be > 0, so the clause
    // was dead code masquerading as a fallback. (It stays inert either way: `nonzeroCount` is not
    // a key of __COPERNICUS_GRID_DIAG__ at all, measured 2026-08-06. Corrected so it reads what it
    // guards rather than silently never firing.)
    const isCopernicusRenderable = finalDiag.copernicus.renderable === true ||
                                   finalDiag.copernicus.skipped === false ||
                                   (finalDiag.copernicus.nonzeroCount !== undefined && finalDiag.copernicus.nonzeroCount > 0);
    expect(isCopernicusRenderable).toBe(true);
    expect(['copernicus', 'backend-weather-service', 'open-meteo', 'estimated']).toContain(finalDiag.copernicus.provider);
  });
});


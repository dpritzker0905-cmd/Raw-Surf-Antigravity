/**
 * E2E: Weather Simulation & Map Controls
 * Tests surfer lockout, admin sandbox, diagnostics telemetry, and map controls.
 */
const { test, expect } = require('@playwright/test');
const { stubSeededMessageBadge } = require('./seededMessageBadge');

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

  // ⛔⛔ EXTENSION, NOT SUBSTRING (2026-08-13, WS-CAN-0059). This branched on
  // `url.includes('.js')`, and **`.json` CONTAINS `.js`** — so every `.json` off an allowed origin
  // was answered with `/* mocked */` under `application/javascript`, and any `.json()` /
  // `JSON.parse` on it raised `Unexpected token '/', "/* mocked */" is not valid JSON`.
  // MEASURED, run 31652826600: 16 failed / 1 flaky / 31 passed, with that string 14x — and the
  // failures were BROWSER-CONFINED (Desktop Safari 24 artifacts, Firefox 10, **Chrome 0, mobile
  // 0**), which is what ruled out an application regression. The 36 `frame was detached`
  // cancellations and 13 ninety-second `page.goto` timeouts were CONSEQUENCES of the page tearing
  // down mid-navigation; read the causation backwards from the timeouts, never forwards.
  // ⚠️ WHY TIGHTENING THIS IS SAFE: the `resourceType()` clause in each branch is the real net —
  // it catches `.mjs`, extensionless and hash-named scripts whatever the URL looks like. The URL
  // test is belt-and-braces on top of it, so making it exact removes false positives without
  // narrowing what genuinely gets mocked.
  // ⚠️ WHAT THIS DOES NOT CLAIM: it does not explain why Chrome passed with the identical handler
  // installed. This is a confirmed defect with an UNCONFIRMED SHARE OF THE BLAME — see
  // `audit/weather-simulation-12.0/evidence/test-results/RV-14_e2e_failure_mechanism.md`. Do not
  // read one green run as proof the lane is fixed: the historical rate is 6 pass / 28 fail over 34
  // runs, so a single green sits inside the existing noise.
  // Path only, so `?query` and `#fragment` cannot smuggle an extension in. No `new URL` — this
  // file lints under a Node config with no DOM globals, and a bare regex keeps the helper free of
  // both the `no-undef` and the empty-catch it would otherwise need.
  const extOf = (u) => {
    const path = String(u).split(/[?#]/)[0];
    const dot = path.lastIndexOf('.');
    const slash = path.lastIndexOf('/');
    return dot > slash ? path.slice(dot).toLowerCase() : '';
  };

  await page.route('**/*', route => {
    const url = route.request().url();
    if (
      allowedOrigins.some(origin => url.startsWith(origin)) ||
      url.startsWith('data:') ||
      url.startsWith('blob:')
    ) {
      route.continue();
    } else if (['.js', '.mjs', '.cjs'].includes(extOf(url))
               || route.request().resourceType() === 'script') {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* mocked */'
      });
    } else if (extOf(url) === '.css' || route.request().resourceType() === 'stylesheet') {
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
  // Registered after the external-resource router so the exact badge fixture wins.
  await stubSeededMessageBadge(page, [standardUser.id, adminUser.id]);
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
    // The chip holds two spans since 1cfc15fd (F-07): the visible time (aria-hidden) and a
    // screen-reader sentence ("Showing the forecast for …"). Reading the whole div concatenated them
    // ("LiveShowing the forecast for Fri 4 PM.") and failed on every run from then on (audit 15.0,
    // A15-06). Assert the visible chip only; the sr-only sentence has its own unit tests.
    const timeReadout = page
      .locator('div.min-w-\\[50px\\] > span[aria-hidden="true"]')
      .filter({ visible: true });
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
    test.setTimeout(240000);

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

    // ⛔ WHICH DIAGNOSTIC (audit 15.0, A15-06 / A15-09). These gates read
    // __MARINE_PROJECTION_DIAG__, which is written only by the `/grid` lane. This describe sets
    // `force_marine_fallback`, and in that lane the diag is never written at all: measured locally
    // at ca2c5520 it stayed `not_initialized / unsupported` for 20 s after Waves and after EURO,
    // while the field was committed. So the gate failed on every run (CI 36153843638 printed exactly
    // that initial state). __FORECAST_TIMELINE_COVERAGE_DIAG__ is written when a frame is committed
    // in BOTH lanes and names the model, the product and the valid time, so the gates read it.
    //
    // Switching the model is a marine cache MISS by construction — 18-35 s measured — hence 45 s.
    const readCommitted = () => page.evaluate(() => {
      const t = window.__FORECAST_TIMELINE_COVERAGE_DIAG__;
      if (!t) return { diagPresent: false };
      return {
        diagPresent: true,
        activeModel: t.activeModel,
        activeLayer: t.activeLayer,
        status: t.status,
        renderDecision: t.renderDecision,
        gridProductId: t.gridProductId,
        selectedValidTime: t.selectedValidTime,
      };
    });
    const committedFor = async (model) => {
      try {
        await page.waitForFunction((m) => {
          const t = window.__FORECAST_TIMELINE_COVERAGE_DIAG__;
          return !!t && t.activeModel === m && t.activeLayer === 'waves' && t.status === 'active' &&
                 (t.renderDecision === 'render' || t.renderDecision === 'clip_to_coverage') &&
                 !!t.gridProductId && !!t.selectedValidTime;
        }, model, { timeout: 45000 });
      } catch (err) {
        throw new Error(
          `${model} commit gate never satisfied. Terms actually seen: ${JSON.stringify(await readCommitted())}
${err.message}`
        );
      }
      const seen = await readCommitted();
      expect(seen.activeModel).toBe(model);
      // The product must belong to the model the user picked, not the one before it.
      // Committed ids seen live: `gfs_marine_waves_<region>_<t>.json`, `viewport_gfs_marine_…`,
      // `series_GFS_waves_h0`. Each names the model; none may name a different one.
      const pid = String(seen.gridProductId).toLowerCase();
      const m = model.toLowerCase();
      expect(pid.startsWith(`${m}_`) || pid.startsWith(`viewport_${m}_`) || pid.startsWith(`series_${m}_`)).toBe(true);
      return seen;
    };

    await committedFor('GFS');

    // 3. Switch to "EURO" model selector (Copernicus)
    const euroBtn = page.locator('button').filter({ hasText: 'EURO' }).filter({ visible: true }).first();
    await expect(euroBtn).toBeVisible();
    await euroBtn.evaluate(el => el.click());

    await committedFor('EURO');

    // The Copernicus grid diag is still published on this lane (measured: provider open-meteo,
    // renderable true, no fallback reason) — keep its provider/fallback contract.
    const copernicus = await page.evaluate(() => window.__COPERNICUS_GRID_DIAG__ || null);
    expect(copernicus).not.toBeNull();
    expect(copernicus.fallbackReason || null).toBeNull();
    expect(copernicus.renderable).toBe(true);
    expect(['copernicus', 'backend-weather-service', 'open-meteo', 'estimated']).toContain(copernicus.provider);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RENDERED-FIELD PIXEL TRUTH (Report 11.0 R11-14, 2026-08-09) — the first executed-GL assertion
// in the estate. Before this, every GLSL "test" was a source-substring check and e2e asserted
// canvas VISIBILITY + diag flags — a hemisphere-mirrored field or a frozen frame under an
// advancing readout shipped green (the composite failure four hold/dedup mechanisms share).
// ⚠️ NOTE the describe above sets `force_marine_fallback` in its beforeEach — those tests
// exercise the RASTER fallback lane by design. This describe does NOT set it: the WebGL engine
// itself renders, and the pixels are the oracle.
//
// FLAKE-DESIGN (particles/foam animate; u_time feeds even the heatmap): the test SELF-CALIBRATES.
// It freezes the drift lever (__RAW_WAVE_SPEED__ = 0, read live per frame), measures the residual
// same-hour animation noise from a control pair, and requires the hour-change delta to clear
// max(3 × noise, 0.5% of pixels). If residual animation exceeds 25% of pixels the test REFUSES
// (skip with the measured number) rather than grading noise — a check that cannot tell "not
// sampled" from "broken" must refuse.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const { diffFraction, varianceFraction } = require('./pngPixels');
// The app's own JS mirror of the heatmap ramp (WebGLMarineShaders.js getThemedWaveColor): the discriminator
// predicts each cell's colour with it rather than re-deriving the ramp here (LESSONS L-S11).
const { getThemedWaveColorJS } = require('../src/components/map/colorScales');

test.describe('Rendered-field pixel truth (executed GL)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth', { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ user }) => {
      localStorage.setItem('raw-surf-user', JSON.stringify(user));
      localStorage.setItem(`tos-accepted-${user.id}-1.0`, Date.now().toString());
      localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
      localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
      // ⛔ deliberately NO force_marine_fallback here — the WebGL engine is the subject.
      localStorage.removeItem('force_marine_fallback');
    }, { user: standardUser });
    // ⭐ THE GLOBAL MOCK 404s EVERY THIRD-PARTY ORIGIN — INCLUDING THE MAPBOX STYLE HOST — so in
    // every other e2e the MapLibre style never loads and the marine CUSTOM LAYER never attaches
    // (measured 2026-08-09: engine resident + diag renderable + a white void; the sibling tests
    // never noticed because they force the DOM-canvas fallback). This describe's subject IS the
    // GL layer, so the style host passes through here — routes are checked newest-first, and
    // route.fallback() hands everything else back to the global mock unchanged.
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith('https://api.mapbox.com') || url.startsWith('https://events.mapbox.com')
          || url.includes('.tiles.mapbox.com')) {
        route.continue();
      } else {
        route.fallback();
      }
    });
    await page.waitForURL(/\/(feed|explore)(\/|$|\?)/, { timeout: 10000 }).catch(() => {});
  });

  // ⚠️ test.fixme = ships as DOCUMENTED WORK-IN-PROGRESS, never reds CI. Four live iterations
  // on 2026-08-09 each moved it: (1) the global mock blanks the basemap AND the style host, so
  // the GL custom layer never attached in ANY e2e before the scoped route below; (2) UI pixels
  // (readout, pulsing dot) polluted the clip -> central-ocean clip + self-calibrated noise;
  // (3) the engine clears-and-recommits during series settle -> stable-read retry; (4) commit
  // latch added after a transient commit was indistinguishable from none. Remaining: the +24h
  // commit is not yet reliably observed against the shared 1-CPU box under repeated runs.
  // Finish = un-fixme once the latch wait passes 3 consecutive local headed runs.
  // ⭐ FIRST REAL RUNS (2026-09-29, headed system Chrome vs a production build of dev + the live backend):
  // fixed here: (a) the clip graded land + the Diagnostics HUD because the app now boots on the Space
  // Coast (the test sets its own sea); (b) the readiness gate read only the /grid diag, which the
  // grid_series lane never writes (it stays 'Initial state' over open ocean): the engine's commit is the
  // gate now; (c) crest lifecycle noise (above). STILL OPEN, why it stays fixme: on a calm sea the +24 h
  // step moved the grid mean 0.279 -> 0.384 m (half the cells > 0.25 m) yet changed 2-5% of pixels,
  // equal to the 3-6% noise. Either the 0-20+ ft ramp cannot show a 1-2 ft day-to-day change, or the
  // picture does not follow the data; the data discriminator (0.039 m) cannot tell them apart. Next:
  // grade against the colour the ramp PREDICTS for each cell, not a texture quantum
  // (docs/weather-program/log/2026-09-29-sim-works-plan.md, W-12).
  test.fixme('the marine field is non-blank, and scrubbing +1 day CHANGES the rendered pixels', async ({ page }) => {
    // Page load (8-20 s) + one marine cache miss (18-35 s) + a series-warm scrub commit — the
    // same measured budgets as the sibling tests.
    test.setTimeout(240000);

    await page.goto('/map', { waitUntil: 'domcontentloaded' });
    const rightControls = page.locator('[data-testid="featured-photographers-btn"]');
    await expect(rightControls).toBeVisible({ timeout: 65000 });

    // Same capability probe as the sibling: ask the page, never name the browser.
    const hasWebGL = await page.evaluate(() => {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch (e) { return false; }
    });
    test.skip(!hasWebGL, 'no WebGL context on this runner — the pixels would measure the runner, not the app');

    const isMobile = await page.evaluate(() => window.innerWidth < 768);
    test.skip(isMobile, 'pixel truth runs on the desktop layout — the bottom-sheet flow adds motion this oracle would misread');

    // ⛔ OPEN OCEAN, SET BY THE TEST (2026-09-29, first real run of this oracle). The clip below was
    // written for a boot view of open Atlantic; the app now boots on the Florida Space Coast at z9,
    // so the clip graded land and the Diagnostics HUD: "sea moved on 76% of cells but only 2.60% of
    // pixels changed". The oracle must choose its own sea, never inherit the app's default camera.
    // ⚠️ Open ocean alone is not enough: at 30N 66W z7 the 2-deg mid tier paints a near-uniform wash
    // (varianceFraction 0.0008) that the paint gate below cannot tell from no paint. The camera sits
    // inside the 0.25-deg florida_east_coast tile (82-79W, 27-30N) and the clip (set below) covers only
    // its sea side, 30-100 km offshore: real structure, no land, no tier seam.
    await page.evaluate(() => {
      const m = window.__MAP_INSTANCE__ || window.map;
      if (m) m.jumpTo({ center: [-80.4, 28.4], zoom: 9 });
    });

    // Activate Waves and wait for the engine (not the fallback) to be renderable.
    const wavesBtn = page.locator('button').filter({ hasText: 'Waves' }).filter({ visible: true }).first();
    await expect(wavesBtn).toBeVisible();
    await wavesBtn.evaluate(el => el.click());
    try {
      // The ENGINE's own commit is the readiness oracle (its truthTag names the product it holds).
      // The projection diag is written only by the /grid path; over open ocean the field arrives
      // through the grid_series lane alone and the diag stays at "Initial state" (2026-09-29), so a
      // diag-only gate never opens there even though the engine is painting.
      await page.waitForFunction(() => {
        const diag = window.__MARINE_PROJECTION_DIAG__;
        const eng = window.__MARINE_ENGINE__;
        const committed = eng && eng._waveData && eng._waveData.waveGrid;
        const diagSaysRender = diag && (diag.renderable === true || diag.renderDecision === 'render' || diag.renderDecision === 'clip_to_coverage');
        return committed && (diagSaysRender || !!(eng._waveData.truthTag && eng._waveData.truthTag.product_id));
      }, null, { timeout: 45000 });
    } catch (err) {
      const seen = await page.evaluate(() => ({
        diag: window.__MARINE_PROJECTION_DIAG__ || null,
        engineResident: !!(window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData),
      }));
      throw new Error(`marine engine never became renderable. Seen: ${JSON.stringify(seen)}\n${err.message}`);
    }

    // Freeze the drift lever (read live each frame) and let one settle pass complete. Also
    // install a commit LATCH: the engine clears-and-recommits during settle, so a poller that
    // records the MAX hourOffset ever resident distinguishes "committed then cleared" (latch
    // holds 24) from "never committed" (latch stays 0) — the two timeouts read identically
    // without it (measured on this oracle's fourth live run: engineHour null at timeout).
    await page.evaluate(() => {
      window.__RAW_WAVE_SPEED__ = 0;
      // Crest LIFECYCLE is not frozen by the drift lever: crests are born and fade on the wall clock.
      // Measured 2026-09-29 (0.25-deg Florida tile, z9, canvas only): same-hour noise 19-29% of pixels
      // at the default 1650 crests, 3-6% with the target at 1 (the engine's 2% density floor,
      // WebGLMarineEngine.js densityBase). The heatmap wash is the subject; crests only add noise.
      window.__RAW_PART_TARGET__ = 1;
      // ⛔ LATCH ON VALID TIME (W-37, 2026-09-30). This latched `hourOffset >= 24`, but hourOffset counts
      // from a series base_time that floats with the clock: at 00:47Z the correct +24 h frame
      // (valid 2026-10-01T00Z) carried hourOffset 23, so the latch never closed. The valid time is the
      // invariant; the target is set just before the step.
      window.__E2E_TARGET_VALID__ = null;
      window.__E2E_SEEN_TARGET__ = false;
      if (!window.__E2E_HOUR_POLLER__) {
        window.__E2E_HOUR_POLLER__ = setInterval(() => {
          const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid;
          if (g && window.__E2E_TARGET_VALID__ && (g.valid_time || g.validTime) === window.__E2E_TARGET_VALID__) {
            window.__E2E_SEEN_TARGET__ = true;
          }
        }, 250);
      }
    });
    await page.waitForTimeout(1500);

    const mapCanvas = page.locator('canvas.maplibregl-canvas');
    const box = await mapCanvas.boundingBox();
    expect(box).not.toBeNull();
    // CLIP = the central-ocean region only: hard-inset away from the right-side weather panel,
    // the bottom timeline wheel, and the left rail — none of that UI may vote in a FIELD oracle
    // (first live run: the +1d readout repaint alone measured 0.16% and could masquerade as
    // field change). With the camera set above, x 55-90% of the canvas is sea inside the tile
    // (about 80.25-79.2W at 28.2-29.0N; the coast is at 80.6-80.95W there).
    const clip = {
      x: box.x + box.width * 0.55,
      y: box.y + box.height * 0.15,
      width: Math.max(64, box.width * 0.35),
      height: Math.max(64, box.height * 0.45),
    };
    // CANVAS ONLY for the instant of each shot: every element but the map canvas is made invisible
    // (visibility keeps layout, so nothing moves), so no panel, HUD, readout or marker can vote in a
    // FIELD oracle, whatever the build shows. The same helper takes all three shots.
    const CANVAS_ONLY = 'body * { visibility: hidden !important; } canvas.maplibregl-canvas { visibility: visible !important; }';
    const shoot = async () => {
      const style = await page.addStyleTag({ content: CANVAS_ONLY });
      await page.waitForTimeout(150);
      const png = await page.screenshot({ clip });
      await style.evaluate(el => el.remove());
      return png;
    };

    // CONTROL PAIR — same hour, ~1.2 s apart: measures residual animation noise (foam phase is
    // wall-clock and cannot be frozen; that is WHY the threshold is self-calibrated).
    const shotA1 = await shoot();
    await page.waitForTimeout(1200);
    const shotA2 = await shoot();
    const noise = diffFraction(shotA1, shotA2);

    // PAINT GATE (first live run, 2026-08-09): this spec's route mocks blank the basemap, so ANY
    // colour in the mid-ocean clip IS the marine wash — and the run showed engine resident +
    // diag renderable + ZERO field pixels on this headless runner (a white void; SwiftShader-class
    // silent no-paint). A pixel oracle graded there measures the RUNNER. Refuse, never lie:
    // the test stays armed for every environment that actually paints (headed/GPU runs).
    const structure = varianceFraction(shotA1);
    test.skip(structure < 0.02,
      `marine wash produced no field pixels in this environment (varianceFraction=${structure.toFixed(4)} over a mocked-white basemap) — pixel truth requires a painting GL environment; run headed/GPU`);

    // REFUSE arm: if animation dominates even with drift frozen, the oracle cannot measure.
    test.skip(noise > 0.25, `residual animation noise ${(noise * 100).toFixed(1)}% of pixels — the hour-change signal cannot be separated; raise the freeze levers before re-enabling`);

    // Snapshot the h0 sea from the engine's own grid: the cells that project INTO THE CLIP, with their position.
    // ⛔ (W-37) The old sampler took every Nth vector and compared the two hours BY INDEX, but the +0 h grid (the
    // 17x17 regional tile) and the +24 h grid (a viewport-clipped series frame) are different lattices: index i
    // was a different place in each, and 'the sea moved on 76% of cells' compared unrelated cells.
    const seaInClip = (c) => page.evaluate((clipRect) => {
      const m = window.__MAP_INSTANCE__ || window.map;
      const w = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData; const g = w && w.waveGrid;
      if (!m || !g || !g.vectors) return null;
      const cv = document.querySelector('canvas.maplibregl-canvas').getBoundingClientRect();
      const out = [];
      for (const v of g.vectors) {
        const h = v ? (v.height ?? v.speed) : null;
        if (!v || typeof v.lat !== 'number' || !(h > 0) || v.isOcean === false) continue;
        const p = m.project([v.lng, v.lat]); const x = cv.left + p.x, y = cv.top + p.y;
        if (x >= clipRect.x && x <= clipRect.x + clipRect.width && y >= clipRect.y && y <= clipRect.y + clipRect.height) out.push({ lat: v.lat, lng: v.lng, h });
      }
      const b = g.bounds; const cell = b && g.cols > 1 ? (b.east - b.west) / (g.cols - 1) : 0.25;
      return { cells: out, cell, valid: g.valid_time || g.validTime };
    }, c);
    const seaBefore = await seaInClip(clip);
    expect(seaBefore, 'engine grid unreadable for the data-delta discriminator').not.toBeNull();

    // TREATMENT — +1 day via the accessible wheel (PageUp = +1 day, the house a11y contract),
    // then wait for the ENGINE to hold the new hour's grid (not just the readout).
    const scrubber = page
      .locator('[role="slider"][aria-label="Forecast timeline wheel"]')
      .filter({ visible: true }).first();
    const targetValid = new Date(Date.parse(seaBefore.valid) + 24 * 3600 * 1000).toISOString().replace('.000Z', 'Z');
    await page.evaluate((t) => { window.__E2E_TARGET_VALID__ = t; window.__E2E_SEEN_TARGET__ = false; }, targetValid);
    await scrubber.focus();
    await scrubber.press('PageUp');
    try {
      // The LATCH is the commit oracle (a transient commit counts); the stable-read loop below
      // is the read oracle. 90 s: the cold grid_series miss is 18-35 s alone and this shared
      // 1-CPU box is also serving production.
      await page.waitForFunction(() => window.__E2E_SEEN_TARGET__ === true, null, { timeout: 90000 });
    } catch (err) {
      const seen = await page.evaluate(() => {
        const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid;
        return { target: window.__E2E_TARGET_VALID__, seenTarget: window.__E2E_SEEN_TARGET__, engineValid: g ? (g.valid_time || g.validTime) : null, engineHour: g ? g.hourOffset : null,
                 scrub: window.isScrubbingTimeline || false };
      });
      throw new Error(`engine never committed the +24h frame (latch never saw it). Seen: ${JSON.stringify(seen)}\n${err.message}`);
    }
    await page.waitForTimeout(1500); // let the settle cycle run

    // ⚠️ The engine CLEARS-AND-RECOMMITS during series settle (measured on this oracle's third
    // live run: _waveData was null 1.5 s AFTER the verified +24h commit while a sharper regional
    // frame refetched). Reading a snapshot mid-cycle grades the settle machinery, not the
    // renderer — wait for a STABLE resident at the new hour, then read, with a bounded retry.
    let seaAfter = null;
    for (let attempt = 0; attempt < 3 && !seaAfter; attempt++) {
      await page.waitForFunction((t) => {
        const eng = window.__MARINE_ENGINE__;
        const g = eng && eng._waveData && eng._waveData.waveGrid;
        return g && g.vectors && (g.valid_time || g.validTime) === t;
      }, targetValid, { timeout: 30000 });
      await page.waitForTimeout(800);
      const s = await seaInClip(clip);
      seaAfter = s && s.valid === targetValid ? s : null;
    }
    // DATA-DELTA DISCRIMINATOR: never grade the renderer on an unchanged input. If the sea
    // itself barely moved across the step (possible on a becalmed frame), REFUSE — a pixel
    // no-change would then be correct behaviour, not a defect. Calibration (live, 2026-08-09,
    // wide-Atlantic default view): h0→h24 moved 64% of cells by more than one 8-bit texture
    // quantum (0.039 m) and crossed a colour band on 20.3% — so 10% is a conservative floor.
    expect(seaAfter, 'engine grid never stabilised at the target valid time (3 stable-read attempts)').not.toBeNull();
    // ⛔ VISIBLE change, predicted by the app's own ramp (W-37). A 0.039 m texture quantum is not a visible
    // change: measured 2026-09-30 offshore at 28.4N 80.4W, a +24 h step moved these cells by 0.055 m on
    // average, which the ramp paints about 10 green units apart, inside the rendering noise. A cell
    // 'visibly moved' when its predicted colour moves by more than diffFraction's own threshold (30 of 765)
    // after the heatmap opacity. Cells are matched by position (nearest within 0.6 of a cell).
    const themeName = await page.evaluate(() => { const c = document.documentElement.classList; return c.contains('beach-mode') ? 'beach' : c.contains('light') ? 'light' : 'dark'; });
    const surfMode = await page.evaluate(() => window.__SURF_MODE__ === true);
    const opacity = await page.evaluate(() => (window.__RAW_GPU__ && window.__RAW_GPU__.opacity && window.__RAW_GPU__.opacity.heatmap) || 0.76);
    const tol = 0.6 * Math.max(seaBefore.cell, seaAfter.cell);
    let matched = 0, visiblyMoved = 0;
    for (const a of seaBefore.cells) {
      let best = null, bd = Infinity;
      for (const b of seaAfter.cells) { const d = Math.hypot(a.lat - b.lat, a.lng - b.lng); if (d < bd) { bd = d; best = b; } }
      if (!best || bd > tol) continue;
      matched++;
      const c0 = getThemedWaveColorJS(a.h, themeName, surfMode), c1 = getThemedWaveColorJS(best.h, themeName, surfMode);
      const d = opacity * (Math.abs(c0[0] - c1[0]) + Math.abs(c0[1] - c1[1]) + Math.abs(c0[2] - c1[2]));
      if (d > 30) visiblyMoved++;
    }
    test.skip(matched < 8, `only ${matched} sea cells of both hours fall in the clip — too few to grade; check the camera`);
    const seaMovedFrac = visiblyMoved / matched;
    test.skip(seaMovedFrac < 0.10,
      `the ramp predicts a visible colour change on only ${(seaMovedFrac * 100).toFixed(1)}% of ${matched} sea cells across the step — a calm, unchanged sea cannot grade the renderer; re-run on a changing sea`);

    const shotB = await shoot();
    const change = diffFraction(shotA1, shotB);

    // THE ASSERTION: the +24h field must differ from the +0h field by clearly more than the
    // same-hour animation noise. A frozen frame under an advancing readout — the four-mechanism
    // composite failure — fails here and nowhere else in the estate.
    const floor = Math.max(3 * noise, 0.005);
    // The measurement travels with the verdict: a pass with no numbers is not evidence (LESSONS L-P9).
    const measured = `cells=${matched} visiblyMoved=${(seaMovedFrac * 100).toFixed(1)}% change=${(change * 100).toFixed(2)}% noise=${(noise * 100).toFixed(2)}% floor=${(floor * 100).toFixed(2)}% structure=${structure.toFixed(4)}`;
    test.info().annotations.push({ type: 'pixel-truth', description: measured });
    console.log(`[pixel-truth] ${measured}`);
    expect(change, `the ramp predicts a visible change on ${(seaMovedFrac * 100).toFixed(0)}% of ${matched} sea cells but only ${(change * 100).toFixed(2)}% of pixels changed (noise ${(noise * 100).toFixed(2)}%, floor ${(floor * 100).toFixed(2)}%) — the readout and the DATA advanced but the picture did not`).toBeGreaterThan(floor);
  });
});


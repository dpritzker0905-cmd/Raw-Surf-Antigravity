/**
 * MARINE RENDER CONTINUITY — the gate for "the field disappears while I am using the map".
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS SEPARATE FROM weather-simulation.spec.js.
 *
 * Owner report, 2026-09-21: *"intermittent gaps in animations appearing when toggling into wind
 * waves, zooming and panning around, and between euro, gfs, and icon, and toggling the other
 * marine layers."* The commit history says this class has been fought for months — 286 of 1,675
 * map-stack commits in six months name a transient visual symptom (blank/flash/gap/flicker), and
 * the SHARE of map work spent on them rose from 3.5% in May to 42.7% in July and has stayed near a
 * third. Reading the most recent twenty, they are not repeated attempts at one bug: they are
 * distinct root causes — layer order twice, the ocean-mask buffer, the coarse-bridge hold, a
 * one-sided normalisation, a wrap-naive coverage check, an uncaught promise, a dead host.
 *
 * ⭐⭐⭐ SO THE QUESTION IS NOT "WHY CAN'T WE FIX IT" BUT "WHY MUST EACH ONE BE FOUND BY EYE".
 * The answer is in `weather-simulation.spec.js:607`: the only test that checks whether the marine
 * field actually paints is `test.fixme` — it has never run and cannot red CI, exactly as its own
 * comment says. The repo's own index already records the consequence: "NO CI GREEN HAS EVER PROVEN
 * THE MARINE FIELD PAINTS."
 *
 * ## Why a SEPARATE oracle rather than un-fixme-ing that one
 *
 * That test bundles two assertions: "the field is non-blank" (cheap, reliable) and "+24h scrubbing
 * CHANGES the pixels" (depends on a slow commit against a shared 1-CPU box, and is the half its
 * comment says is "not yet reliably observed"). Bundling them means the flaky half has kept the
 * reliable half from ever running. ⭐ A GATE THAT CANNOT RUN PROTECTS NOTHING; splitting the
 * reliable assertion out is worth more than one more attempt at stabilising the flaky one.
 *
 * ## Why it samples WITHOUT settling
 *
 * The repo's hardest-won map lesson: a settled read cannot see a mid-gesture defect. Six
 * hypotheses died in one session because every read settled first — the field was rendering DURING
 * the zoom and being erased ON settle. The owner's words here are "when toggling", "zooming and
 * panning around": the defect lives inside the gesture, so this drives the real gesture and polls
 * throughout it.
 *
 * ## The oracle, and why it needs the stamp
 *
 * `WebGLMarineEngine` publishes `window.__RAW_GPU__.opacity` on every heatmap draw. Unstamped,
 * that object cannot answer this question: when the heatmap STOPS drawing, the last value simply
 * sits there, so "hidden at opacity 0" and "not drawing at all" read identically — and the second
 * is precisely the reported gap. The engine now stamps `t` (wall clock) and `n` (draw counter), so
 * a sampler can distinguish:
 *
 *   n advancing, heatmap > 0   -> painting            (healthy)
 *   n advancing, heatmap == 0  -> drawing, but hidden (a deliberate hold, e.g. the coarse bridge)
 *   n NOT advancing            -> not drawing at all  (the gap)
 *
 * ⚠️ WHAT THIS CANNOT DO. It does not read pixels, so it cannot catch a field that draws at full
 * opacity into a covered layer slot — the 2026-08-13 layer-order class, where the field painted and
 * the basemap ocean covered it. That needs the pixel oracle, and this is deliberately NOT sold as
 * a replacement for it. It catches the DISCONTINUITY class, which is what was reported.
 */
const { test, expect } = require('@playwright/test');
// Extracted so it can be unit-tested against known answers — see continuityOracle.test.js.
const { longestStall } = require('./continuityOracle');

// A gap budget, not zero. The engine legitimately pauses drawing across a model switch and during
// the documented coarse-bridge hold; the defect is a gap the user can SEE. 1200 ms is ~3x the
// longest deliberate hold measured in the 08-15 bridge work (350 ms lift) and well above a frame.
// Tune with RAW_E2E_GAP_BUDGET_MS while characterising a failure; do not raise it to go green.
const GAP_BUDGET_MS = Number(process.env.RAW_E2E_GAP_BUDGET_MS || 1200);
const POLL_MS = 100;

/** Start an in-page sampler that records draw-counter stalls until stopped. */
async function startSampler(page) {
  await page.evaluate((pollMs) => {
    const w = window;
    w.__RAW_CONTINUITY__ = { samples: [], started: Date.now() };
    w.__RAW_CONTINUITY_TIMER__ = setInterval(() => {
      const o = (w.__RAW_GPU__ && w.__RAW_GPU__.opacity) || null;
      w.__RAW_CONTINUITY__.samples.push({
        at: Date.now(),
        n: o ? o.n : null,            // draw counter — null means the engine never drew at all
        heatmap: o ? o.heatmap : null,
        label: w.__RAW_CONTINUITY_LABEL__ || null,
      });
    }, pollMs);
  }, POLL_MS);
}

async function stopSampler(page) {
  return page.evaluate(() => {
    clearInterval(window.__RAW_CONTINUITY_TIMER__);
    return window.__RAW_CONTINUITY__.samples;
  });
}

async function label(page, text) {
  await page.evaluate((t) => { window.__RAW_CONTINUITY_LABEL__ = t; }, text);
}

async function clickLayer(page, name) {
  const btn = page.locator('button').filter({ hasText: name }).filter({ visible: true }).first();
  await expect(btn).toBeVisible({ timeout: 30000 });
  await btn.evaluate((el) => el.click());
}

test.describe('Marine render continuity across real gestures', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/map', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="featured-photographers-btn"]'))
      .toBeVisible({ timeout: 65000 });
  });

  test('the marine field keeps drawing while toggling layers, models, zoom and pan', async ({ page }) => {
    // Page load + a cold marine miss + several model switches, each of which is a cold upstream
    // fetch measured live at 11-18 s. This is a slow test by nature, not by accident.
    test.setTimeout(300000);

    // ── PRECONDITIONS. These gate on the RUNNER, never on the SUBJECT. ⭐ The fixme'd pixel oracle
    // also skips when `structure < 0.02` and when `noise > 0.25` — both are measurements OF THE
    // FIELD, so a broken field talks the oracle into standing down. That inversion is why this
    // file has no such escape: if the field never draws, that is a FAILURE, not a skip.
    const hasWebGL = await page.evaluate(() => {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch (e) { return false; }
    });
    test.skip(!hasWebGL, 'no WebGL on this runner — this would measure the runner, not the app');
    const isMobile = await page.evaluate(() => window.innerWidth < 768);
    test.skip(isMobile, 'desktop layout only — the mobile bottom sheet adds motion this oracle misreads');

    await clickLayer(page, 'Waves');

    // Wait for the engine to be DRAWING before judging continuity. Without this the test would
    // measure startup, and "it had not started yet" would be indistinguishable from "it stopped".
    await page.waitForFunction(
      () => !!(window.__RAW_GPU__ && window.__RAW_GPU__.opacity && window.__RAW_GPU__.opacity.n > 0),
      null, { timeout: 90000 },
    );

    // POSITIVE CONTROL, before any gesture: the counter must advance while the map sits still. If
    // it does not, every stall measured below would be meaningless — the engine simply is not
    // running, and this test must say THAT rather than blaming the gestures.
    const n0 = await page.evaluate(() => window.__RAW_GPU__.opacity.n);
    await page.waitForTimeout(1500);
    const n1 = await page.evaluate(() => window.__RAW_GPU__.opacity.n);
    expect(n1, 'the engine must be drawing at rest before gesture continuity means anything')
      .toBeGreaterThan(n0);

    await startSampler(page);

    // ── The owner's reported sequence, driven for real ──────────────────────────────────────
    await label(page, 'rating-band-on');
    const ratingBtn = page.locator('button[title*="Surf Rating"], button[aria-label*="Surf Rating"]').first();
    if (await ratingBtn.count()) { await ratingBtn.evaluate((el) => el.click()); }
    await page.waitForTimeout(1200);

    for (const layer of ['Swell 2', 'Wind Waves', 'Swell', 'Waves']) {
      await label(page, `toggle:${layer}`);
      await clickLayer(page, layer);
      await page.waitForTimeout(2500);
    }

    await label(page, 'zoom-and-pan');
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(700);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 180, box.y + box.height / 2 + 120, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(900);
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(900);
    }

    for (const model of ['EURO', 'ICON', 'GFS']) {
      await label(page, `model:${model}`);
      const btn = page.locator('button').filter({ hasText: new RegExp(`^${model}$`) }).filter({ visible: true }).first();
      if (await btn.count()) {
        await btn.evaluate((el) => el.click());
        await page.waitForTimeout(4000);
      }
    }

    const samples = await stopSampler(page);
    const worst = longestStall(samples);

    // Attached unconditionally — a PASS with its margin is as informative as a failure, and this
    // is the first continuity series this program has ever produced.
    await test.info().attach('continuity-samples.json', {
      body: JSON.stringify({ budgetMs: GAP_BUDGET_MS, worst, count: samples.length, samples }, null, 2),
      contentType: 'application/json',
    });

    expect(samples.length, 'the sampler produced no samples at all').toBeGreaterThan(10);
    expect(
      worst.ms,
      `the marine field stopped drawing for ${worst.ms} ms during "${worst.label}" `
      + `(budget ${GAP_BUDGET_MS} ms). That is the owner-reported gap, captured. `
      + `The attached series and the retained video show which gesture produced it.`,
    ).toBeLessThanOrEqual(GAP_BUDGET_MS);
  });
});

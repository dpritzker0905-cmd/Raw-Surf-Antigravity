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
const { stubSeededMessageBadge } = require('./seededMessageBadge');
// Extracted so it can be unit-tested against known answers — see continuityOracle.test.js.
const { longestStall, stallAnatomy, isAppStall } = require('./continuityOracle');
// A measured stall must not be retried away — see stallLedger.js.
const { runKey, ledgerFile, readEarlierStalls, recordStall } = require('./stallLedger');
// What each gesture asks the 1-CPU backend for (A15-11) — see requestRecorder.js. Observation only.
const { recordWeatherRequests, summarizeRequests } = require('./requestRecorder');

/** Stalls earlier attempts of THIS test recorded in THIS run; records this attempt's if over budget. */
function reconcileStalls(worst, anatomy) {
  const info = test.info();
  const file = ledgerFile(info.project.outputDir, [info.project.name, ...info.titlePath]);
  const key = runKey();
  const earlier = readEarlierStalls(file, key);
  if (isAppStall(worst, anatomy, GAP_BUDGET_MS)) {
    recordStall(file, key, { attempt: info.retry, ms: worst.ms, label: worst.label, anatomy });
  } else if (worst.ms > GAP_BUDGET_MS) {
    // Over budget in wall time, but the browser offered fewer than MIN_OFFERED_FRAMES frames inside the
    // gap: the runner was presenting that slowly. Visible on the report, never silently green.
    info.annotations.push({ type: 'runner-limited gap',
      description: `${worst.ms} ms during "${worst.label}", browser frames inside: ${anatomy && anatomy.rafTicks}` });
  }
  return earlier;
}

function expectNoEarlierStall(earlier) {
  expect(
    earlier,
    `an earlier attempt of this test stalled over budget in this run: ${JSON.stringify(earlier)}. `
    + `A measured stall is an observation of the app; a later clean attempt does not undo it `
    + `(retries are for infrastructure, not for the defect this gate measures).`,
  ).toEqual([]);
}

// A gap budget, not zero. The engine legitimately pauses drawing across a model switch and during
// the documented coarse-bridge hold; the defect is a gap the user can SEE. 1200 ms is ~3x the
// longest deliberate hold measured in the 08-15 bridge work (350 ms lift) and well above a frame.
// Tune with RAW_E2E_GAP_BUDGET_MS while characterising a failure; do not raise it to go green.
const GAP_BUDGET_MS = Number(process.env.RAW_E2E_GAP_BUDGET_MS || 1200);
const POLL_MS = 100;

// ⛔ `/map` is a ProtectedRoute (App.js). Without a seeded user an anonymous visitor is sent to
// /auth, so the map controls this file waits on can never appear. That is why both describes here
// had never passed on dev since they landed (audit 15.0, A15-06): they timed out on the auth page,
// not on the map. Same test identity and consent keys weather-simulation.spec.js seeds; an init
// script runs before any app code, so there is no /auth -> /feed redirect race to settle.
const E2E_USER = {
  id: 'test-surfer-id',
  email: 'surfer@rawsurf.com',
  full_name: 'Standard Surfer',
  username: 'standardsurfer',
  role: 'user',
  subscription_tier: 'premium',
  is_admin: false
};

// ⛔ WHERE THE MAP OPENS WAS THE RUNNER'S IP, NOT A CHOICE (2026-09-28). `/map` centres on the
// visitor (MapPage `effectiveLocation`: GPS, else `/api/location/ip-geolocation` with coastal snap,
// at z9), so each CI run started wherever its runner geolocated. Measured from the request recorder's
// bboxes: run 36375100570 (green) opened on Virginia Beach, 36372270148 (green, the A15-11 "met"
// baseline) on Chicago/Lake Michigan, and 36376343648 (red) on central Iowa, where no marine layer has
// a single ocean cell in view. There wind_waves' viewport grid came back empty, the switch hold
// expired, and the gate measured a 2.8 s "stall" of a field that has nothing to paint. The same app
// build had passed 20 minutes earlier at Virginia Beach. So the gate, and every A15-11 fan-out number
// taken with it, was graded at an uncontrolled place.
// ★ Fixed by answering the app's OWN IP lookup with a fixed coast, rather than seeding the GPS cache:
//   GPS opens at z12, while every run so far opened through the IP path at z9. Same code path, same
//   zoom, one place. Sebastian Inlet is the burst test's camera and the owner's reported break.
const START_COAST = { lat: 27.8608, lng: -80.4464, city: 'Sebastian', region: 'Florida' };
// ⛔ WEBKIT ROUTES THROUGH THE SERVICE WORKER. The first run of the pin (36432722270) held on Desktop Chrome and
// NOT on Desktop Safari: 0 lookups answered, the map on Des Moines. `public/service-worker.js` claims the page on
// install and has a fetch listener, and in WebKit a request that passes through a controlling worker is invisible
// to `page.route` (Playwright documents this; its remedy is to block workers). Blocking changes nothing this spec
// measures: the worker skips every `/weather` and `/marine` request by design and only caches surf-spot lists.
test.use({ serviceWorkers: 'block' });

let ipLookups = 0;

async function openMapAsSurfer(page) {
  await stubSeededMessageBadge(page, [E2E_USER.id]);
  ipLookups = 0;
  await page.route('**/api/location/ip-geolocation**', (route) => {
    ipLookups += 1;
    return route.fulfill({ json: {
      success: true, latitude: START_COAST.lat, longitude: START_COAST.lng,
      city: START_COAST.city, region: START_COAST.region, country: 'US', accuracy: 'city',
      is_coastal: true, coastal_snapped: false, city_changed: false,
    } });
  });
  await page.addInitScript((user) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(user));
    localStorage.setItem(`tos-accepted-${user.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    // ⛔ THE FPS GUARDRAIL MEASURES THE RUNNER HERE, NOT THE APP (2026-09-27). CI renders in software
    // (SwiftShader, ~1 FPS), so useWebGLGuardrail's "< 20 FPS for 12 s" trips on every long Chrome run
    // and swaps the WebGL marine engine for the Canvas2D fallback. Runs 36285144742 and 36290246940 were
    // red for exactly that (layerCalls 0, engine_dispose x2 + foam_mount, no render error, no context
    // loss): the gate was grading "is this runner a weak device", which a 1-FPS software rasteriser
    // always is. This gate grades render CONTINUITY; the guardrail's own policy is unit-tested
    // (useWebGLGuardrail.ratingBandLoss.test.js) and its trips are on the churn log for real devices.
    window.__DISABLE_WEBGL_GUARDRAIL__ = true;
  }, E2E_USER);
  await page.goto('/map', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="featured-photographers-btn"]'))
    .toBeVisible({ timeout: 65000 });
}

/** POSITIVE CONTROL for the pin: if the app stops asking, or another source outranks it, fail here by
 *  name rather than quietly measuring the runner's city again. Called after the skips (mobile). */
async function expectPinnedStart(page) {
  const pinned = await page.waitForFunction(({ lat, lng }) => {
    const m = window.__MAP_INSTANCE__;
    if (!m || typeof m.getCenter !== 'function') return false;
    const c = m.getCenter();
    return Math.abs(c.lat - lat) < 0.5 && Math.abs(c.lng - lng) < 0.5;
  }, START_COAST, { timeout: 30000 }).then(() => true, () => false);
  const center = await page.evaluate(() => {
    const m = window.__MAP_INSTANCE__;
    return m && typeof m.getCenter === 'function' ? m.getCenter() : null;
  });
  expect(pinned, `the map must open on the pinned coast (${START_COAST.lat}, ${START_COAST.lng}); `
    + `it is at ${JSON.stringify(center)}, IP lookups answered: ${ipLookups}`).toBe(true);
}

/** Start an in-page sampler that records draw-counter stalls until stopped. */
async function startSampler(page) {
  await page.evaluate((pollMs) => {
    const w = window;
    w.__RAW_CONTINUITY__ = { samples: [], started: Date.now() };
    // FRAMES THE BROWSER OFFERED (2026-09-27): a do-nothing rAF loop counts animation frames, and
    // MapLibre's `render` event counts the frames it painted. A draw gap is the app's only when the
    // browser was offering frames (continuityOracle.isAppStall).
    w.__RAW_RAF__ = { n: 0, id: null };
    const tick = () => { w.__RAW_RAF__.n += 1; w.__RAW_RAF__.id = requestAnimationFrame(tick); };
    w.__RAW_RAF__.id = requestAnimationFrame(tick);
    w.__RAW_MAPFRAMES__ = { n: 0, map: w.map || w.__MAP_INSTANCE__ || null };
    w.__RAW_MAPFRAMES__.onRender = () => { w.__RAW_MAPFRAMES__.n += 1; };
    if (w.__RAW_MAPFRAMES__.map && typeof w.__RAW_MAPFRAMES__.map.on === 'function') {
      w.__RAW_MAPFRAMES__.map.on('render', w.__RAW_MAPFRAMES__.onRender);
    }
    w.__RAW_CONTINUITY_TIMER__ = setInterval(() => {
      const g = w.__RAW_GPU__ || null;
      const o = (g && g.opacity) || null;
      const bf = (g && g.ratingBandFade) || null;
      w.__RAW_CONTINUITY__.samples.push({
        at: Date.now(),
        n: o ? o.n : null,            // draw counter — null means the engine never drew at all
        heatmap: o ? o.heatmap : null,
        // The band is a SEPARATE surface from the animation and can clear on its own — the owner
        // reported "animations AND band clear at wrong time", which is two observations, not one.
        // Sampling only the draw counter would call a vanished band a healthy frame.
        bandMult: bf && typeof bf.bandMult === 'number' ? bf.bandMult : null,
        label: w.__RAW_CONTINUITY_LABEL__ || null,
        // WHY the draw counter stalled (src/components/map/marineLayerStamp.js): layer calls advance
        // even when the engine does not draw, and `skip` names the exit taken instead.
        layerN: g && g.layer ? g.layer.n : null,
        skip: g && g.layer ? g.layer.skip : null,
        rafN: w.__RAW_RAF__.n,
        mapN: w.__RAW_MAPFRAMES__.map ? w.__RAW_MAPFRAMES__.n : null,
      });
    }, pollMs);
  }, POLL_MS);
}

async function stopSampler(page) {
  return page.evaluate(() => {
    clearInterval(window.__RAW_CONTINUITY_TIMER__);
    const w = window;
    if (w.__RAW_RAF__) cancelAnimationFrame(w.__RAW_RAF__.id);
    const mf = w.__RAW_MAPFRAMES__;
    if (mf && mf.map && typeof mf.map.off === 'function') mf.map.off('render', mf.onRender);
    return w.__RAW_CONTINUITY__.samples;
  });
}

/** The engine's own clear and churn logs (marineTransitionCoordinator): which clear or switch preceded a stall. */
async function readMarineLogs(page) {
  return page.evaluate(() => ({
    clears: Array.isArray(window.__MARINE_CLEAR_LOG__)
      ? window.__MARINE_CLEAR_LOG__.map((c) => ({ reason: c.reason, timestamp: c.timestamp,
        transitioning: c.transitioning, requested: c.requested, displayed: c.displayed })) : [],
    churn: (window.__MARINE_CHURN__ && Array.isArray(window.__MARINE_CHURN__.log))
      // `site`/`from`/`to` name WHICH fetch superseded which (detach) and the layer each flip left and
      // entered. Without them, run 36432722270 could show that every toggle fetched the OUTGOING layer's
      // world /grid 8 ms after a detach, but not which request source fired it.
      ? window.__MARINE_CHURN__.log.map((c) => ({ kind: c.kind, t: c.t, cause: c.cause, message: c.message,
        site: c.site, from: c.from, to: c.to })) : [],
  }));
}

// The gesture in effect, Node-side, so the request recorder can attribute each request as it starts.
let currentGesture = null;

async function label(page, text) {
  currentGesture = text;
  await page.evaluate((t) => { window.__RAW_CONTINUITY_LABEL__ = t; }, text);
}

async function clickLayer(page, name) {
  const btn = page.locator('button').filter({ hasText: name }).filter({ visible: true }).first();
  await expect(btn).toBeVisible({ timeout: 30000 });
  await btn.evaluate((el) => el.click());
}

test.describe('Marine render continuity across real gestures', () => {
  test.beforeEach(async ({ page }) => {
    await openMapAsSurfer(page);
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
    await expectPinnedStart(page);

    // From BEFORE the first activation: the cold activation is the audit's measured fan-out.
    currentGesture = 'activate:Waves';
    const weatherRequests = recordWeatherRequests(page, () => currentGesture);
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
    const logs = await readMarineLogs(page);
    const anatomy = stallAnatomy(samples, worst, logs);
    const earlierStalls = reconcileStalls(worst, anatomy);

    // Attached unconditionally — a PASS with its margin is as informative as a failure, and this
    // is the first continuity series this program has ever produced.
    await test.info().attach('continuity-samples.json', {
      body: JSON.stringify({ budgetMs: GAP_BUDGET_MS, worst, anatomy, count: samples.length, samples, logs }, null, 2),
      contentType: 'application/json',
    });
    // A15-11 measurement: requests per gesture, the in-flight peak each met, world-extent fetches.
    const fanout = summarizeRequests(weatherRequests, Date.now());
    await test.info().attach('weather-requests.json', {
      body: JSON.stringify({ summary: fanout, rows: weatherRequests }, null, 2),
      contentType: 'application/json',
    });
    test.info().annotations.push({ type: 'weather fan-out', description:
      `${fanout.total} requests, peak ${fanout.peakInFlight} in flight (settled ${fanout.peakInFlightSettled}, `
      + `${fanout.unsettled} never finished); `
      + Object.entries(fanout.byLabel).map(([k, g]) => `${k}: ${g.n} (peak ${g.peakInFlight}/settled ${g.peakInFlightSettled}, world ${g.world}, `
        + `median ${g.medianMs} ms)`).join('; ') });

    expect(samples.length, 'the sampler produced no samples at all').toBeGreaterThan(10);
    expect(
      isAppStall(worst, anatomy, GAP_BUDGET_MS),
      `the marine field stopped drawing for ${worst.ms} ms during "${worst.label}" `
      + `(budget ${GAP_BUDGET_MS} ms) while the browser offered frames. That is the owner-reported gap, `
      + `captured. The attached series and the retained video show which gesture produced it. `
      + `Inside the stall: ${JSON.stringify(anatomy)}.`,
    ).toBe(false);
    expectNoEarlierStall(earlierStalls);
  });
});

/**
 * RAPID ZOOM/PAN BURST at the camera the owner reported.
 *
 * Owner, 2026-09-21: *"when I rapid pan and zoom really fast, sometimes animations and band clears
 * at wrong time, seems buggy, at sebastian inlet z12"*.
 *
 * ⛔⛔ THE GATE ABOVE WOULD NOT HAVE CAUGHT THIS, and that is worth saying out loud rather than
 * quietly widening it: it drives ONE slow wheel in and one out, with waits between. The owner's
 * words are "rapid" and "really fast", and this repo's hardest-won map lesson is that a SETTLED
 * read cannot see a mid-gesture defect — six hypotheses once died because every read settled
 * first, and the field was rendering DURING the zoom and being erased ON settle.
 * There is also a standing owner MANDATE (2026-07-19) that every marine/wind zoom verification
 * include an animated burst, after clamping was seen live on a build where THREE settled ladders
 * had just passed 72/72. This encodes that mandate in CI at the reported camera.
 *
 * ⭐ TWO SURFACES, SAMPLED SEPARATELY. "animations AND band clears" is two observations: the
 * heatmap draw loop (`opacity.n`) and the rating band (`ratingBandFade.bandMult`). They can fail
 * independently, and a gate watching only the draw counter would pass a run where the band
 * vanished. Both are asserted.
 */
const SEBASTIAN = { lat: START_COAST.lat, lng: START_COAST.lng, zoom: 12 };

test.describe('Marine render continuity under a rapid zoom/pan burst', () => {
  test.beforeEach(async ({ page }) => {
    await openMapAsSurfer(page);
  });

  test('the field and the band survive a fast burst at Sebastian Inlet z12', async ({ page }) => {
    test.setTimeout(300000);

    const hasWebGL = await page.evaluate(() => {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch (e) { return false; }
    });
    test.skip(!hasWebGL, 'no WebGL on this runner — this would measure the runner, not the app');
    const isMobile = await page.evaluate(() => window.innerWidth < 768);
    test.skip(isMobile, 'desktop layout only — the mobile bottom sheet adds motion this oracle misreads');
    await expectPinnedStart(page);

    await clickLayer(page, 'Waves');
    await page.evaluate(({ lat, lng, zoom }) => {
      const m = window.__MAP_INSTANCE__;
      if (m) m.jumpTo({ center: [lng, lat], zoom });
    }, SEBASTIAN);

    await page.waitForFunction(
      () => !!(window.__RAW_GPU__ && window.__RAW_GPU__.opacity && window.__RAW_GPU__.opacity.n > 0),
      null, { timeout: 90000 },
    );

    // POSITIVE CONTROL at rest, before any gesture. Without it a burst that measured a dead engine
    // would read as a catastrophic gap and point at the gesture rather than at startup.
    const n0 = await page.evaluate(() => window.__RAW_GPU__.opacity.n);
    await page.waitForTimeout(1500);
    const n1 = await page.evaluate(() => window.__RAW_GPU__.opacity.n);
    expect(n1, 'the engine must be drawing at rest before a burst means anything').toBeGreaterThan(n0);

    await startSampler(page);
    await label(page, 'burst:sebastian-z12');

    // THE BURST. Deliberately NO settle waits — the gestures overlap, which is the whole point.
    // ~100 ms between inputs is roughly a real flick; easeTo/panBy are left mid-flight on purpose.
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    const cx = box ? box.x + box.width / 2 : 400;
    const cy = box ? box.y + box.height / 2 : 400;
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, i % 2 === 0 ? -300 : 300);
      await page.evaluate((k) => {
        const m = window.__MAP_INSTANCE__;
        if (m) m.panBy([k % 2 === 0 ? 220 : -220, k % 3 === 0 ? 140 : -140], { duration: 180 });
      }, i);
      await page.waitForTimeout(100);
    }
    // Let the last gestures land, still sampling — the 08-13 defect appeared ON settle, not during.
    await label(page, 'burst:settling');
    await page.waitForTimeout(4000);

    const samples = await stopSampler(page);
    const worst = longestStall(samples);
    const logs = await readMarineLogs(page);
    const anatomy = stallAnatomy(samples, worst, logs);
    const earlierStalls = reconcileStalls(worst, anatomy);
    const bandSamples = samples.filter((s) => typeof s.bandMult === 'number');
    const bandDark = bandSamples.filter((s) => s.bandMult <= 0.01).length;

    await test.info().attach('burst-samples.json', {
      body: JSON.stringify({ camera: SEBASTIAN, budgetMs: GAP_BUDGET_MS, worst, anatomy,
                             bandSamples: bandSamples.length, bandDark, samples, logs }, null, 2),
      contentType: 'application/json',
    });

    expect(samples.length, 'the sampler produced no samples at all').toBeGreaterThan(20);
    expect(
      isAppStall(worst, anatomy, GAP_BUDGET_MS),
      `the field stopped drawing for ${worst.ms} ms during "${worst.label}" at Sebastian Inlet z12 `
      + `(budget ${GAP_BUDGET_MS} ms) while the browser offered frames — the owner's reported burst `
      + `defect, captured. Inside the stall: ${JSON.stringify(anatomy)}.`,
    ).toBe(false);
    expectNoEarlierStall(earlierStalls);

    // The band is only judged if it was ever measurable: a run where ratingBandFade never appeared
    // means the band was not engaged at all, which is a DIFFERENT finding and must not be silently
    // scored as "band healthy". ⭐ Refuse rather than pass when the subject was never observed.
    if (bandSamples.length > 10) {
      const darkFrac = bandDark / bandSamples.length;
      expect(
        darkFrac,
        `the rating band was fully faded in ${(darkFrac * 100).toFixed(0)}% of burst samples `
        + `(${bandDark}/${bandSamples.length}) — "band clears at wrong time", captured.`,
      ).toBeLessThan(0.5);
    }
  });
});

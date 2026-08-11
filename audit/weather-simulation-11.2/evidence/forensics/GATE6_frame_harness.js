/**
 * GATE 6 FRAME HARNESS — the corrective action 11.2 named.
 *
 * 11.2 RETRACTED every frame-rate reading it took: "frame behaviour is NOT measurable in this
 * harness (RAF delivered 1 frame in 5 s due to unfocused-pane throttling) — the earlier FPS
 * readings of 5/13/18/31 are WITHDRAWN". The corrective action was: "Measure frame behaviour in a
 * non-throttled harness (focused window or Playwright with visible viewport) before any full PASS."
 *
 * ⛔ THIS SCRIPT REFUSES TO REPORT APP NUMBERS UNTIL IT HAS PROVED IT CAN SEE FRAMES.
 * A frame harness that reports a plausible number without a control is exactly the defect class
 * this repo keeps rediscovering — an instrument that cannot fail. So the run order is:
 *
 *   1. CAPABILITY   — which GL renderer is actually backing WebGL, and is it hardware?
 *   2. CONTROL      — an idle page vs a page with 100 ms of deliberate jank injected every 5th
 *                     frame. If the harness cannot tell those apart, every later number is void
 *                     and the script exits non-zero WITHOUT measuring the app.
 *   3. TARGET       — only then, the real page.
 *
 * Usage:  node GATE6_frame_harness.js [targetUrl] [seconds]
 * Runnable from anywhere — it resolves Playwright out of frontend/node_modules itself.
 */
const path = require('path');
const { createRequire } = require('module');

// Node resolves from the SCRIPT's directory, and this script lives under audit/ which has no
// node_modules. Resolve against frontend/package.json instead of requiring a particular cwd.
function loadPlaywright() {
  try { return require('@playwright/test'); } catch (e) { /* fall through */ }
  const frontend = path.resolve(__dirname, '../../../../frontend/package.json');
  try { return createRequire(frontend)('@playwright/test'); } catch (e) {
    console.error('Cannot resolve @playwright/test. Looked in this script\'s tree and at:', frontend);
    console.error('Install/verify with: cd frontend && npx playwright --version');
    process.exit(1);
  }
}
const { chromium } = loadPlaywright();

const SECONDS = Number(process.argv[3] || 6);
const TARGET = process.argv[2] || null;

// Anti-throttling. Chromium backgrounds/throttles renderers it thinks nobody is watching, which is
// precisely what invalidated the 11.2 readings. --disable-frame-rate-limit removes the vsync cap so
// the measurement reports CAPACITY rather than a 60 Hz ceiling everything trivially hits.
// ⚠️ TWO DIFFERENT QUESTIONS, AND THEY NEED DIFFERENT FLAGS. Removing the vsync cap answers
// "how much headroom does a frame have" (per-frame COST). Leaving it on answers "what does a user
// see" (frames DELIVERED against a 60 Hz display). Reporting an unlocked number as though it were
// the second is how "1098 fps" would end up in a report about a 60 Hz screen.
// Default = vsync ON (user-facing). NOVSYNC=1 = headroom mode.
const NOVSYNC = process.env.NOVSYNC === '1';
const ARGS = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  ...(NOVSYNC ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])
];

const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * (arr.length - 1)))] : NaN);
// ★ ABSENT and ZERO must not print the same. Collapsing them is how a missing measurement becomes
// a confident "0" — the failure mode this whole harness exists to refuse.
const fmt = (v) => (v === undefined ? 'ABSENT' : v === null ? 'null' : String(v));

function summarise(deltas) {
  const d = deltas.slice().sort((a, b) => a - b);
  return {
    frames: d.length,
    p50: +pct(d, 0.5).toFixed(2),
    p95: +pct(d, 0.95).toFixed(2),
    p99: +pct(d, 0.99).toFixed(2),
    max: +pct(d, 1).toFixed(2),
    over50ms: deltas.filter((x) => x > 50).length,
    over100ms: deltas.filter((x) => x > 100).length
  };
}

/** Collect RAF inter-frame deltas for `seconds`. `jankMs` injects deliberate blocking. */
async function collect(page, seconds, jankMs = 0, jankEvery = 5) {
  return page.evaluate(
    ([secs, jank, every]) =>
      new Promise((resolve) => {
        const deltas = [];
        let last = performance.now();
        let n = 0;
        const stopAt = last + secs * 1000;
        const tick = (now) => {
          deltas.push(now - last);
          last = now;
          n++;
          if (jank > 0 && n % every === 0) {
            const until = performance.now() + jank;
            while (performance.now() < until) { /* deliberate block */ }
          }
          if (now < stopAt) requestAnimationFrame(tick);
          else resolve(deltas.slice(1)); // drop the first, it spans setup
        };
        requestAnimationFrame(tick);
      }),
    [seconds, jankMs, jankEvery]
  );
}

async function capability(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { webgl: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      webgl: true,
      version: gl.getParameter(gl.VERSION),
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      dpr: window.devicePixelRatio,
      hidden: document.hidden,
      visibility: document.visibilityState
    };
  });
}

(async () => {
  // HEADED=1 launches a real window. Headless Chromium falls back to SwiftShader (software GL) on
  // this host, which makes any WebGL frame number unrepresentative of a real user's GPU — a
  // DIFFERENT blindness from the Browser pane's RAF throttling, but blindness all the same.
  const headless = process.env.HEADED !== '1';
  console.log(`launch mode: ${headless ? 'headless' : 'HEADED'}`);
  const browser = await chromium.launch({ headless, args: ARGS });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('about:blank');
  await page.setContent('<html><body style="margin:0;background:#123"><canvas id=c width=800 height=600></canvas></body></html>');

  // ---- 1. CAPABILITY -------------------------------------------------------
  const cap = await capability(page);
  console.log('=== 1. CAPABILITY ===');
  console.log(JSON.stringify(cap, null, 1));
  const software = /swiftshader|llvmpipe|software|angle \(google, vulkan/i.test(String(cap.renderer || ''));
  if (software) {
    console.log('\n⚠️  SOFTWARE RASTERISER. WebGL is not hardware-backed in this harness, so any');
    console.log('   frame number below is a LOWER BOUND for a real user\'s GPU and must NOT be');
    console.log('   reported as the app\'s frame performance. Scheduling can still be measured.');
  }

  // ---- 2. CONTROL — DOSE-RESPONSE, not a single threshold ------------------
  // ⚠️ The first version of this control asserted `over100ms > 0` for a 100 ms injected block, and
  // FAILED on a harness that was working fine: a 100 ms block inside a RAF callback does not produce
  // a >100 ms INTER-FRAME DELTA — those are different quantities, and the assertion conflated them.
  // The fix is not to lower the threshold (that is how bounds get widened until they mean nothing).
  // It is to demand more: inject a LADDER of known stalls and require the measured p95 to track it
  // monotonically. An instrument that merely trips is weak evidence; one whose reading follows the
  // dose is measuring the thing it claims to measure.
  // The dose must exceed the instrument's resolution. With vsync ON, inter-frame deltas quantize to
  // ~16.7 ms multiples, so a 50 ms stall lands in the same p95 bucket as an idle hitch and the
  // ladder cannot separate them — observed: 33.5 -> 33.5 -> 133.4, a correct REFUSAL. This is not
  // relaxing the bar; it is matching the dose to the quantum, and the ladder still has to be
  // monotonic and still has to register >=60% of what it was given.
  const DOSES = NOVSYNC ? [0, 50, 150] : [0, 100, 300];
  console.log(`\n=== 2. POSITIVE CONTROL — dose-response ladder (${SECONDS}s per arm) ===`);
  const arms = [];
  for (const dose of DOSES) {
    const s = summarise(await collect(page, SECONDS, dose, 5));
    arms.push({ dose, ...s });
    console.log(`  inject ${String(dose).padStart(3)}ms every 5th frame -> ${JSON.stringify(s)}`);
  }
  const [idle, mid, hi] = arms;

  const sawFrames = idle.frames >= SECONDS * 5;   // vs the 0.2 fps that void'd 11.2
  const monotonic = hi.p95 > mid.p95 && mid.p95 > idle.p95;
  // Each arm must register the MAJORITY of the stall it was given — a harness that sees a 150 ms
  // block as a 20 ms blip is not measuring frames, it is smoothing them away.
  const tracksDose = mid.p95 >= mid.dose * 0.6 && hi.p95 >= hi.dose * 0.6;
  // NEGATIVE control: the idle arm must not look janky, or the instrument cries wolf.
  // ⚠️ This was `idle.over50ms === 0` and failed a working harness on 2 spikes in 294 frames
  // (max 199 ms) — real transient hitches on a busy host. Faithfully RECORDING a real hitch is
  // correct behaviour, not a false positive, so a zero-tolerance max was testing the machine's
  // quietness rather than the instrument's honesty. The check is now about the DISTRIBUTION being
  // separable from the smallest dose, plus a bounded outlier rate so a genuinely noisy instrument
  // still fails. Outliers are printed either way rather than swallowed.
  const idleOutlierRate = idle.frames ? idle.over50ms / idle.frames : 1;
  const noFalsePositive = idle.p95 < DOSES[1] * 0.5 && idleOutlierRate < 0.02;

  console.log('\n--- CONTROL VERDICT ---');
  console.log(`  frames observed (>= ${SECONDS * 5})        : ${idle.frames}  => ${sawFrames ? 'PASS' : 'FAIL'}`);
  console.log(`  p95 rises monotonically with dose      : ${idle.p95} -> ${mid.p95} -> ${hi.p95}  => ${monotonic ? 'PASS' : 'FAIL'}`);
  console.log(`  p95 registers >=60% of injected stall   : ${mid.p95}/${mid.dose}, ${hi.p95}/${hi.dose}  => ${tracksDose ? 'PASS' : 'FAIL'}`);
  console.log(`  NEGATIVE control: idle p95 < ${DOSES[1] * 0.5}ms & outliers <2%  : p95=${idle.p95} outliers=${idle.over50ms}/${idle.frames} (${(idleOutlierRate * 100).toFixed(1)}%)  => ${noFalsePositive ? 'PASS' : 'FAIL'}`);
  if (idle.over50ms > 0) console.log(`  (idle arm recorded ${idle.over50ms} spike(s), max ${idle.max}ms — host noise, reported not swallowed)`);

  if (!(sawFrames && monotonic && tracksDose && noFalsePositive)) {
    console.log('\n⛔ HARNESS VOID — it cannot demonstrate that it sees frames or detects jank.');
    console.log('   No app measurement will be taken. This is the correct outcome, not a failure to');
    console.log('   measure: an instrument that cannot fail must not be trusted when it passes.');
    await browser.close();
    process.exit(2);
  }
  console.log('\n✅ HARNESS CERTIFIED — it resolves frames and detects injected jank.');

  // ---- 3. TARGET -----------------------------------------------------------
  if (!TARGET) {
    console.log('\n=== 3. TARGET === (none given; pass a URL as argv[2] to measure a real page)');
    await browser.close();
    return;
  }
  console.log(`\n=== 3. TARGET: ${TARGET} ===`);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  // ProtectedRoute.js:46 hydrates synchronously from the 'raw-surf-user' key while AuthContext
  // resolves — that is the documented no-login path onto /map (rig notes, 11.2 handoff §6).
  // The first attempt seeded 'user' and landed on /auth; the readiness gate caught it.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('raw-surf-user', JSON.stringify({
        id: 'dev-mock-user-id', email: 'dev@rawsurf.com', full_name: 'Dev Mock',
        username: 'devmock', role: 'admin', subscription_tier: 'premium', is_admin: true
      }));
    } catch (e) {}
  });
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(20000); // let the map mount

  // ---- 3a. LAYER ACTIVATION -----------------------------------------------
  // Every weather layer ships OFF, so a bare /map load has vectorCount 0 and draws no field. Gate 6
  // asks about the sim under load, so the layer must be turned on the way a user turns it on: a
  // real click on the real control. The button's own `aria-pressed` is the activation CONTRACT --
  // if it does not flip, we did not activate anything and must not pretend we did.
  const LAYER = process.env.LAYER || null;
  if (LAYER) {
    console.log(`\n--- activating layer: ${LAYER} ---`);
    const btn = page.locator('button', { hasText: new RegExp(`^${LAYER}$`) }).first();
    if (!(await btn.count())) {
      console.log(`⛔ no control matching /^${LAYER}$/ — cannot activate. Refusing to measure.`);
      await browser.close(); process.exit(4);
    }
    const before = await btn.getAttribute('aria-pressed');
    await btn.click();
    await page.waitForTimeout(1500);
    const after = await btn.getAttribute('aria-pressed');
    console.log(`  aria-pressed: ${before} -> ${after}`);
    if (after !== 'true') {
      console.log('⛔ the control did not report itself pressed. Refusing to measure.');
      await browser.close(); process.exit(4);
    }
    // Pressed is not painted. Wait for actual vectors, and say so if they never arrive.
    //
    // ⛔ READ THE FIELD THAT IS WRITTEN, NOT THE ONE THAT IS DECLARED. This polled
    // `__WebGLMarineLayer_DIAG__.vectorCount ?? 0` and sat at 0 for 60 s while the grid served
    // 15,023 vectors. Cause: WebGLMarineLayerDiag.js seeds a DEFAULT object containing
    // `vectorCount`/`nonzeroCount`/`uploadCount`/`status`, then the live write REPLACES that object
    // with one that has none of them — the real fields are `backendGridVectorCount` and
    // `webglSourceVectorCount`. So a reader sees 0 before init and `undefined` after, forever.
    // And my `?? 0` turned that `undefined` into a confident "0 vectors" — absence encoded as a
    // measurement, in the instrument written to catch exactly that.
    // ★ Distinguish ABSENT from ZERO. They are different answers.
    let vc = null;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(5000);
      vc = await page.evaluate(() => {
        const d = window.__WebGLMarineLayer_DIAG__ || {};
        const p = window.__MARINE_PROJECTION_DIAG__ || {};
        return {
          backendGrid: d.backendGridVectorCount,
          webglSource: d.webglSourceVectorCount,
          waveDataPresent: d.waveDataPresent,
          proj: p.vectorCount,
          declaredButUnwritten: d.vectorCount   // expected: undefined once the live write lands
        };
      });
      const best = [vc.backendGrid, vc.webglSource, vc.proj].find((n) => typeof n === 'number' && n > 0);
      console.log(`  t+${(i + 1) * 5}s backendGrid=${fmt(vc.backendGrid)} webglSource=${fmt(vc.webglSource)}`
        + ` proj=${fmt(vc.proj)} waveData=${vc.waveDataPresent} | legacy .vectorCount=${fmt(vc.declaredButUnwritten)}`);
      if (best) { vc.best = best; break; }
    }
    if (!vc.best) {
      console.log('⛔ layer reports PRESSED but no vectors arrived in 60s. That gap is itself the');
      console.log('   finding — report it, do not measure frames and call it Gate 6.');
      await browser.close(); process.exit(5);
    }
  }

  // ⛔ READINESS GATE. Frame numbers for a page that never rendered the map are numbers about a
  // login screen. 11.2's whole verdict was that absence keeps getting encoded as success — so
  // establish that the thing under measurement is actually on screen before measuring it.
  const ready = await page.evaluate(() => ({
    url: location.href,
    hasMap: typeof window.__MAP_INSTANCE__ !== 'undefined' && !!window.__MAP_INSTANCE__,
    canvases: document.querySelectorAll('canvas').length,
    customLayers: (() => {
      try {
        return (window.__MAP_INSTANCE__?.style?._order || [])
          .filter((id) => window.__MAP_INSTANCE__.style._layers?.[id]?.type === 'custom');
      } catch (e) { return null; }
    })(),
    bodyText: (document.body.innerText || '').slice(0, 120).replace(/\s+/g, ' '),
    // ⛔ A REGISTERED LAYER IS NOT A RUNNING LAYER. 11.0 measured both custom layers registering at
    // boot with activeRef:false and returning early from render(). Measuring frames on a map whose
    // weather layers are registered-but-idle answers a different question than Gate 6 asks.
    gpu: (() => { try { const g = window.__RAW_GPU__; return g ? {
      textureCount: g.textureCount, textureUploadCount: g.textureUploadCount,
      encodeDupCount: g.encodeDupCount, drawCalls: g.drawCalls, rafLive: g.rafLive } : null;
    } catch (e) { return null; } })(),
    parity: (() => { try { return window.__MARINE_SOURCE_PARITY__?.status ?? null; } catch (e) { return null; } })(),
    // Written fields only — see the note at the activation poll. `vectorCount` is declared in the
    // default object and dropped by the live write, so it is carried here ONLY to show it is ABSENT.
    marineDiag: (() => { try { const d = window.__WebGLMarineLayer_DIAG__; return d ? {
      backendGridVectorCount: d.backendGridVectorCount, webglSourceVectorCount: d.webglSourceVectorCount,
      waveDataPresent: d.waveDataPresent, particleCount: d.particleCount,
      renderedParticleCount: d.renderedParticleCount,
      legacy_vectorCount_declaredButUnwritten: d.vectorCount === undefined ? 'ABSENT' : d.vectorCount
    } : null; } catch (e) { return null; } })(),
    // Attribution: WHICH field was on screen when the frames were counted. A frame number without
    // the product behind it cannot be compared to the next run.
    marineProj: (() => { try { const d = window.__MARINE_PROJECTION_DIAG__; return d ? {
      status: d.status, coverage_status: d.coverage_status, coverage_scope: d.coverage_scope,
      productId: d.productId ?? d.product_id ?? null } : null; } catch (e) { return null; } })()
  }));
  console.log('target readiness :', JSON.stringify(ready));
  // ⛔ MY FIRST VERSION OF THIS CHECK WAS ITSELF A FALSE POSITIVE. It reported "sim active: YES" off
  // `textureUploadCount > 0` while `marineDiag.vectorCount` was 0 — i.e. two boot-time textures and
  // no field. Uploading a texture is not rendering a forecast. The check now requires actual
  // VECTORS, because that is the quantity whose absence makes the measurement meaningless.
  const vectors = [ready.marineDiag?.backendGridVectorCount, ready.marineDiag?.webglSourceVectorCount,
    ready.marineProj?.vectorCount].find((n) => typeof n === 'number' && n > 0) || 0;
  const simRunning = vectors > 0 && ready.marineDiag?.waveDataPresent === true;
  console.log(`weather sim active: ${simRunning ? 'YES' : 'NO'} (vectors=${vectors}, waveDataPresent=${fmt(ready.marineDiag?.waveDataPresent)})  <- Gate 6 asks about the ACTIVE sim`);
  if (!simRunning) {
    console.log('  ⚠️  Frames below are the map AT REST. A registered custom layer with zero vectors');
    console.log('      draws nothing, so this is NOT a measurement of the weather simulation and');
    console.log('      must not be cited for Gate 6. Activate a weather layer, confirm vectorCount>0,');
    console.log('      then re-run. Reported anyway as a documented FLOOR, clearly labelled.');
  }

  const tcap = await capability(page);
  console.log('target capability:', JSON.stringify(tcap));
  const target = summarise(await collect(page, SECONDS, 0));
  console.log('target frames    :', JSON.stringify(target));
  // ⚠️ ANCHOR EVERY NUMBER TO THE SAME-RUN IDLE BASELINE. This harness's own idle p50 has been
  // observed at both 17.4 ms and 33.3 ms on the same host depending on what else was running, so an
  // absolute "N fps" from one run is not comparable to the next. The RATIO is.
  console.log(`target vs idle   : p50 ${target.p50}ms vs idle ${idle.p50}ms  = ${(target.p50 / idle.p50).toFixed(2)}x`
    + `  |  p95 ${target.p95}ms vs ${idle.p95}ms = ${(target.p95 / idle.p95).toFixed(2)}x`);
  if (errs.length) console.log('page errors      :', errs.slice(0, 5));

  if (!ready.hasMap || ready.canvases === 0) {
    console.log('\n⛔ TARGET NOT READY — no map instance and/or no canvas. The frame numbers above');
    console.log('   describe whatever page WAS showing, not the weather simulation. They must NOT');
    console.log('   be cited for Gate 6. Fix the route/auth/settle-time first, then re-run.');
    await browser.close();
    process.exit(3);
  }
  console.log('\n⚠️  Interpret against the CONTROL above, and against the renderer in section 1.');
  await browser.close();
})().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(1); });

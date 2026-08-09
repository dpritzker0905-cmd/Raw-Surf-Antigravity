/**
 * probe_wind_zoomburst.js — MID-GESTURE clamp catcher (2026-07-19, user report: clamping visible
 * in the preview pane DURING zoom in/out).
 *
 * The zoomclamp ladder jumps to a zoom and waits for settle — it can only see SETTLED states.
 * This probe drives ANIMATED zoom gestures (easeTo in/out cycles + a pan) while:
 *   1. recording VIDEO of the whole run (Playwright recordVideo — human-reviewable, catches
 *      everything between frames);
 *   2. rapid-firing screenshot+ENGINE-STATE pairs (~4/s): each frame carries the instantaneous
 *      viewport vs base/fine bounds, so a STRUCTURAL clamp (no resident grid covers the
 *      viewport) is detected from state truth, not just pixels;
 *   3. running a straight-seam detector on each frame inside the map crop — the clamp's pixel
 *      signature is a long axis-aligned boundary between washed and bare ocean.
 *
 * FAIL = any frame shows a PARTIAL-DATA structural clamp (a grid IS resident but nothing covers
 * the viewport — the visible box-edge state), or a vertical/horizontal seam persists at the same
 * position across >= 3 consecutive frames. COLD-EMPTY frames (no grid committed at all — the
 * bounded initial-load window) are reported separately and do not fail the run.
 *
 * Env: ZB_PREWAIT_MS (default 12000; 2000 = stress: gestures start mid-fetch-race).
 *      ZB_BLOCK_GLOBAL_MS (fault injection: abort world-bbox /grid requests for N ms after load —
 *      deterministically forces the fine-as-base state so the gesture-start base kick's recovery
 *      can be measured instead of waiting for a natural 429 storm).
 *      ZB_SEED / ZB_CYCLES — storm variation & length.
 *      ZB_LAYER — 'wind' (default) | 'waves' | 'both'. waves = the MARINE layer under the same
 *      storm (pixel/seam/video evidence; the wind structural sampler stays wind-only).
 *      ZB_WHEEL=1 — add REAL mouse-wheel zoom bursts (MapLibre scrollZoom is a different code
 *      path from easeTo: its own zoom-rate curve, inertia, and interrupt semantics).
 *
 * Usage: node probe_wind_zoomburst.js [baseUrl] [outdir] [theme]   (run from frontend/)
 */
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, ct = 6, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : 3;
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++];
    const line = raw.slice(rp, rp + stride); rp += stride;
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, data: out };
}

// ── WASH COVERAGE (2026-08-09) ──────────────────────────────────────────────────────────────
// ⛔ THE GAP THIS CLOSES: every existing marine detector looks for an EDGE. `findSeams` wants a
// ruler-straight boundary between washed and bare ocean; the structural detector wants a resident
// grid that fails to cover. A viewport where the wash is simply NOT DRAWN has neither — no edge,
// no coverage failure — so "the heatmap cleared" was invisible to the whole estate. User report
// 2026-08-09: "animations cleared the heatmap at mid-further out zooms, then returned as I zoomed
// even further out", against a resident 360-span grid, tileClamped:false, fade:1.
//
// The metric is CHROMA, not brightness: the marine wash is a saturated ramp (blues -> greens ->
// yellows -> reds) laid over a basemap whose ocean is near-neutral. max(rgb)-min(rgb) separates
// them without needing a water mask or a per-theme colour table.
// ⚠️ It is used RELATIVELY (collapse vs the run's own washed baseline), never as an absolute
// threshold — an absolute one would encode this theme, this region and this zoom, and would be a
// bound calibrated to a workload the moment either changed.
// ⭐ MEASURED, NOT CHOSEN. Calibrated 2026-08-09 from the run's own layer-off/layer-on control
// pair (wash_control_off.png vs burst_030.png), fraction of crop pixels above each chroma:
//     chroma>=   28(first guess)   50     90     150    190
//     basemap        0.931       0.003  0.003  0.002  0.002
//     wash on        0.995       0.933  0.932  0.880  0.000
//     ratio          1.07        306x   329x   364x     0
// ⛔ The first guess of 28 sat ON THE WRONG SIDE OF A CLIFF — the basemap collapses from 0.931 to
// 0.003 between 30 and 50 — so it measured "the map has colour" and separated the two states by
// 7%. The control caught it and REFUSED rather than reporting a number, which is the only reason
// this was calibrated instead of shipped. 90 sits mid-plateau: clear of the basemap edge (~40)
// and of the wash's own falloff (~150), so neither a theme tweak nor a palette change lands on it.
const WASH_CHROMA = 90;
function washFraction(png) {
  const { w, ch, data } = png;
  const x1 = Math.min(CROP.x1, w), y1 = Math.min(CROP.y1, png.h);
  let washed = 0, total = 0;
  for (let y = CROP.y0; y < y1; y += 2) {
    for (let x = CROP.x0; x < x1; x += 2) {
      const i = y * w * ch + x * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      total++;
      // chroma AND a brightness floor: near-black pixels have unstable hue and are basemap, not wash
      if (mx - mn > WASH_CHROMA && mx > 40) washed++;
    }
  }
  return total ? washed / total : null;
}

// Straight-seam detector inside the map crop. Returns candidate x positions (vertical seams)
// and y positions (horizontal) where the mean adjacent-line delta is an outlier sustained over
// most of the crop — coastlines are irregular, a data-box edge is ruler-straight.
const CROP = { x0: 220, x1: 1010, y0: 60, y1: 760 };
function findSeams(png) {
  const { w, ch, data } = png;
  const seams = { v: [], h: [] };
  const colDelta = [];
  for (let x = CROP.x0; x < CROP.x1 - 1; x++) {
    let sum = 0, hits = 0, rows = 0;
    for (let y = CROP.y0; y < CROP.y1; y += 2) {
      const i = (y * w + x) * ch, j = (y * w + x + 1) * ch;
      const d = Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
      sum += d; if (d > 24) hits++; rows++;
    }
    colDelta.push({ x, mean: sum / rows, frac: hits / rows });
  }
  const meanOfMeans = colDelta.reduce((a, c) => a + c.mean, 0) / colDelta.length;
  for (const c of colDelta) {
    // frac 0.40, not 0.55: the marine Gulf rectangle's vertical edge spanned ~53% of the crop
    // and sailed under the first threshold — a sub-viewport tile's edge rarely runs full height.
    if (c.frac > 0.40 && c.mean > Math.max(18, meanOfMeans * 3)) seams.v.push(c.x);
  }
  const rowDelta = [];
  for (let y = CROP.y0; y < CROP.y1 - 1; y++) {
    let sum = 0, hits = 0, cols = 0;
    for (let x = CROP.x0; x < CROP.x1; x += 2) {
      const i = (y * w + x) * ch, j = ((y + 1) * w + x) * ch;
      const d = Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
      sum += d; if (d > 24) hits++; cols++;
    }
    rowDelta.push({ y, mean: sum / cols, frac: hits / cols });
  }
  const meanOfRowMeans = rowDelta.reduce((a, c) => a + c.mean, 0) / rowDelta.length;
  for (const c of rowDelta) {
    if (c.frac > 0.40 && c.mean > Math.max(18, meanOfRowMeans * 3)) seams.h.push(c.y);
  }
  return seams;
}

// ⚠️ LAZY on purpose. Requiring Playwright at module load makes this file unimportable from Jest
// (its bundle is not transformable), and the wash metric below has to be unit-pinnable.
let chromium;
const loadChromium = () => {
  if (chromium) return chromium;
  try { ({ chromium } = require('@playwright/test')); }
  catch (e) { ({ chromium } = require(path.join('C:/Users/dprit/Raw-Surf/frontend', 'node_modules', '@playwright', 'test'))); }
  return chromium;
};

const CENTER = { lng: -89, lat: 24 };

// Exported so the CALIBRATED wash metric can be unit-pinned — it is a measured constant sitting on
// a cliff edge (see WASH_CHROMA), and an unpinned calibration is the rot this session spent its day
// removing. The `require.main` guard keeps importing this file from driving a browser.
// ⚠️ NOT a top-level `return` guard: Node's CommonJS wrapper allows it but Babel — which Jest uses
// to parse this file — rejects it as "'return' outside of function". Named entry point instead.
module.exports = { washFraction, WASH_CHROMA, CROP };

const runProbe = async () => {
  // ⚠️ argv parsing and mkdir live HERE, not at module scope. At module scope Jest's own argv wins:
  // `process.argv[3]` became a sibling TEST FILE path and `mkdirSync` died with EEXIST before a
  // single assertion ran. Module load must have no side effects if the module is to be importable.
  const BASE = process.argv[2] || 'http://localhost:3009';
  const OUT = process.argv[3] || path.join(__dirname, 'wind-zoomburst-out');
  const THEME = process.argv[4] || 'dark';
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await loadChromium().launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
  });
  const page = await ctx.newPage();
  // Fault injection: abort GLOBAL wind /grid requests for the first N ms — forces the
  // fine-lands-first, no-base state (run 1 caught it only because prod happened to 429).
  const blockGlobalMs = Number(process.env.ZB_BLOCK_GLOBAL_MS || 0);
  const t0 = Date.now();
  if (blockGlobalMs > 0) {
    await page.route(/\/api\/weather\/grid.*bbox=-180/, (route) => {
      if (Date.now() - t0 < blockGlobalMs) {
        console.log('[fault] aborted GLOBAL grid fetch at +' + (Date.now() - t0) + 'ms');
        return route.abort('failed');
      }
      return route.continue();
    });
  }
  await page.addInitScript((t) => { try {
    localStorage.setItem('raw-surf-theme', t);
    localStorage.setItem('__RAW_TUNER__', '0');
    localStorage.setItem('__RAW_DIAG__', '0');
  } catch (e) {} }, THEME);
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!(window.__RAW_MAP__ || window.map), null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const d = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Decline');
      if (d) d.click();
    }).catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.evaluate((c) => {
    const m = window.__RAW_MAP__ || window.map;
    m.jumpTo({ center: [c.lng, c.lat], zoom: 6.5 });
  }, CENTER);
  // enable the requested layer(s)
  const LAYER = process.env.ZB_LAYER || 'wind';
  const wantChips = LAYER === 'both' ? ['Wind', 'Waves'] : [LAYER === 'waves' ? 'Waves' : 'Wind'];
  await page.waitForFunction((first) => {
    const all = Array.from(document.querySelectorAll('button'));
    const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
    if (all.some((x) => label(x) === first)) return true;
    const exp = all.find((x) => /weather controls/i.test((x.getAttribute('aria-label') || '') + (x.title || '')));
    if (exp) exp.click();
    return false;
  }, wantChips[0], { timeout: 90000 }).catch(() => {});
  // ⭐ WASH CONTROL PAIR, captured BY CONSTRUCTION rather than hoped for. The wash-coverage
  // detector needs to know that its chroma metric actually responds to the wash being drawn; the
  // only guaranteed off-state in a run is the moment BEFORE the layer chip is pressed. Without
  // this the control has to borrow whatever contrast the run happens to produce — and the first
  // attempt borrowed `washEngaged`, which turned out to be the wrong flag entirely (it gates
  // blend-both, and `isRegionalBounds(bounds)` is one of its terms, so a world grid disengages it
  // BY DESIGN while the heatmap keeps drawing). A control that can be absent is not a control.
  const washOffShot = path.join(OUT, 'wash_control_off.png');
  await page.screenshot({ path: washOffShot }).catch(() => {});
  for (const chip of wantChips) {
    await page.evaluate((name) => {
      const all = Array.from(document.querySelectorAll('button'));
      const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
      const b = all.find((x) => label(x) === name);
      if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
    }, chip);
    await page.waitForTimeout(1200);
  }
  console.log(`layer(s): ${wantChips.join('+')}`);
  // Let the first commits land — but do NOT gate on a healthy two-texture state: the probe's
  // job is to capture whatever the user would see, including degraded states.
  // ZB_PREWAIT_MS=2000 is the STRESS variant: gestures start while the cold-enable fetch race
  // is still in flight — the exact window the gesture-start base kick exists for.
  await page.waitForTimeout(Number(process.env.ZB_PREWAIT_MS || 12000));

  // ── GESTURE STORM (round 2 — user: "you're not zooming in and out enough; various speeds and
  // distances, enough times to discover issues"). A seeded generator drives CYCLES of realistic
  // gesture families with NO recovery gaps between most of them:
  //   wheel  — chained short zoom steps (scroll-wheel reality: each tick interrupts the last)
  //   fast   — large-distance easeTo at 350-600 ms (fling zoom)
  //   slow   — large-distance easeTo at 1500-2200 ms
  //   jiggle — small +-0.4-0.8 zoom oscillations
  //   interrupt — start a long zoom, reverse it mid-flight
  //   pan    — panBy between zoom families, occasionally mid-zoom
  // Console commit-path logs are captured with timestamps for correlation.
  const SEED = Number(process.env.ZB_SEED || 1337);
  const CYCLES = Number(process.env.ZB_CYCLES || 5);
  let lcg = SEED >>> 0;
  const rnd = () => ((lcg = (lcg * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  console.log(`gesture storm: seed ${SEED}, cycles ${CYCLES}`);

  const consoleLog = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (/WeatherEngine|WebGLWind|CHOKE|GLOBAL|FINE|clamp/i.test(t)) {
      consoleLog.push({ t: Date.now(), text: t.slice(0, 220) });
    }
  });

  // Decoupled STATE SAMPLER (~10 Hz — page.evaluate is ~10-30 ms, far faster than screenshots):
  // the structural detector gets sub-gesture resolution; screenshots + video cover pixels.
  const samples = [];
  let stop = false;
  const sampler = (async () => {
    while (!stop) {
      const s = await page.evaluate(() => {
        const m = window.__RAW_MAP__ || window.map;
        const e = window.__WIND_ENGINE__;
        const vb = m.getBounds();
        const vp = { w: vb.getWest(), s: Math.max(-85, vb.getSouth()), e: vb.getEast(), n: Math.min(85, vb.getNorth()) };
        const gb = e && e._windData && e._windData.bounds;
        const fb = e && e._windFine && e._windFine.bounds;
        const span = (b) => b ? (b.west > b.east ? (b.east + 360) - b.west : b.east - b.west) : 0;
        const covers = (b) => {
          if (!b) return false;
          if (span(b) >= 350) return true;
          const eps = 0.05;
          return b.west <= vp.w + eps && b.east >= vp.e - eps && b.south <= vp.s + eps && b.north >= vp.n - eps;
        };
        var bWG = e && e._windData && e._windData.windGrid;
        var fWG = e && e._windFine && e._windFine.windGrid;
        return {
          zoom: +m.getZoom().toFixed(2),
          baseSpan: gb ? +span(gb).toFixed(1) : null,
          baseN: bWG && bWG.vectors ? bWG.vectors.length : null,
          baseCell: (gb && bWG && bWG.cols > 1) ? +(span(gb) / (bWG.cols - 1)).toFixed(2) : null,
          fine: fb ? [+fb.west.toFixed(1), +fb.east.toFixed(1)] : null,
          fineN: fWG && fWG.vectors ? fWG.vectors.length : null,
          fineCell: (fb && fWG && fWG.cols > 1) ? +(span(fb) / (fWG.cols - 1)).toFixed(2) : null,
          baseCovers: covers(gb), fineCovers: covers(fb),
          // ── MARINE structural truth (2026-08-09) ───────────────────────────────────────────
          // ⛔ Everything above reads `__WIND_ENGINE__._windData/_windFine`. Under ZB_LAYER=waves
          // nothing populates those, so `hasAnyGrid` was false on EVERY sample, `clamp` could not
          // fire, all 323 samples fell to `cold` — and cold does not fail. Measured 2026-08-09:
          // a full marine storm returned "clamp samples: 0 | cold samples: 323" and PASSED.
          // The marine layer keeps its own residency truth; sample it so waves mode has a
          // structural signal at all.
          // ⚠️ `__MARINE_SERVE_DIAG__.coversViewport` is a plain bounds comparison with NO
          // global-span shortcut, so a 360°-wide world grid can report coversViewport:false
          // (measured at z9: covers false, gridWidth 360). The wind `covers()` above guards this
          // with `span >= 350 => true`; apply the same rule here or this detector fires on
          // bookkeeping rather than on a clear. Same shape as the Florida-peninsula false positive
          // that cost the zoomlab two forensic arcs.
          // THREE-STATE, never two. `coversViewport` is null whenever the served payload carried no
          // grid bounds, and a first pass folded that null into "does not cover" — which counted
          // 27/27 UNKNOWN samples as a 14 s clamp window and would have shipped a false-positive
          // storm. ⭐ "not measured" is not "broken"; the caller must be able to tell them apart.
          marineCovers: ((window.__MARINE_SERVE_DIAG__ || {}).coversViewport === true)
            || (((window.__MARINE_SERVE_DIAG__ || {}).gridWidth || 0) >= 350),
          marineCoverKnown: (window.__MARINE_SERVE_DIAG__ || {}).gridWidth != null,
          // ── THE WASH ITSELF (2026-08-09) ──────────────────────────────────────────────────
          // `washEngaged` reaches the log only via [FORENSIC-SNAP], which emits at most once per
          // 15 s (WebGLMarineEngine.js `_forensicSnapT`). A 320-sample storm yielded TEN snaps —
          // useless for a mid-gesture transient. Read the same globals at 10 Hz instead.
          // blend-both requires a SAME-MODEL coarse base (marineCoarseBridgeModelSwitch.test.js,
          // 2026-07-15: a stale other-model base blocked its own replacement and the wash stayed
          // dead until a world-coarse commit landed on zoom-out), so capture the base identity
          // too — `washBase` mismatching `model` is the known silent-disengage signature.
          washEngaged: !!((window.__RAW_GPU__ || {}).blendBoth
            && window.__RAW_GPU__.blendBoth.engaged),
          washBase: ((window.__RAW_GPU__ || {}).blendBoth || {}).baseModel || null,
          washKnown: !!(window.__RAW_GPU__ || {}).blendBoth,
          tileClamped: !!((window.__RAW_GPU__ || {}).tileCover
            && window.__RAW_GPU__.tileCover.clamped),
          activeModel: (window.__WEBGL_MARINE_UPLOAD_DIAG__ || {}).activeModel || null,
          marineGridW: (window.__MARINE_SERVE_DIAG__ || {}).gridWidth ?? null,
          marineAccepted: (window.__WEBGL_MARINE_UPLOAD_DIAG__ || {}).renderAccepted ?? null,
          marineNonzero: (window.__WEBGL_MARINE_UPLOAD_DIAG__ || {}).nonzeroCount ?? null,
          marineUploads: (window.__WEBGL_MARINE_UPLOAD_DIAG__ || {}).uploadCount ?? null,
        };
      }).catch(() => null);
      if (s) samples.push({ t: Date.now(), ...s });
      await new Promise((r) => setTimeout(r, 100));
    }
  })();

  const frames = [];
  const shooter = (async () => {
    let n = 0;
    while (!stop) {
      const file = path.join(OUT, `burst_${String(n).padStart(3, '0')}.png`);
      try { await page.screenshot({ path: file, timeout: 5000 }); } catch (err) { break; }
      frames.push({ n, t: Date.now(), file });
      n++;
    }
  })();

  const ease = (zoom, duration) => page.evaluate((g) => {
    const m = window.__RAW_MAP__ || window.map;
    m.easeTo({ zoom: g.zoom, duration: g.duration });
  }, { zoom, duration });
  const panBy = (px, duration) => page.evaluate((g) => {
    const m = window.__RAW_MAP__ || window.map;
    m.panBy(g.px, { duration: g.duration });
  }, { px, duration });

  const ZMIN = 3.2, ZMAX = 10.5;
  const useRealWheel = process.env.ZB_WHEEL !== '0'; // default ON — scrollZoom is its own code path
  for (let c = 0; c < CYCLES; c++) {
    const family = ['wheel_out', 'wheel_in', 'fast', 'slow', 'jiggle', 'interrupt'];
    if (useRealWheel) family.push('wheel_real_out', 'wheel_real_in');
    for (const fam of family) {
      const zNow = await page.evaluate(() => (window.__RAW_MAP__ || window.map).getZoom());
      if (fam === 'wheel_out' || fam === 'wheel_in') {
        const dir = fam === 'wheel_out' ? -1 : 1;
        const ticks = 4 + Math.floor(rnd() * 5); // 4-8 chained ticks
        for (let i = 0; i < ticks; i++) {
          const step = 0.5 + rnd() * 0.6;
          const target = Math.max(ZMIN, Math.min(ZMAX, (await page.evaluate(() => (window.__RAW_MAP__ || window.map).getZoom())) + dir * step));
          await ease(target, 220 + Math.floor(rnd() * 120));
          await page.waitForTimeout(140 + Math.floor(rnd() * 140)); // next tick interrupts the last
        }
        await page.waitForTimeout(500);
      } else if (fam === 'fast' || fam === 'slow') {
        const far = pick([ZMIN, ZMIN + 0.6, ZMAX - 1.2, ZMAX]);
        const dur = fam === 'fast' ? 350 + Math.floor(rnd() * 250) : 1500 + Math.floor(rnd() * 700);
        await ease(far, dur);
        await page.waitForTimeout(dur + 250);
        const back = 5.0 + rnd() * 3.0;
        await ease(back, fam === 'fast' ? 400 : 1800);
        await page.waitForTimeout((fam === 'fast' ? 400 : 1800) + 250);
      } else if (fam === 'jiggle') {
        for (let i = 0; i < 4; i++) {
          const d = (rnd() - 0.5) * 1.6;
          await ease(Math.max(ZMIN, Math.min(ZMAX, zNow + d)), 300);
          await page.waitForTimeout(360);
        }
      } else if (fam === 'interrupt') {
        await ease(ZMIN + rnd(), 2000);
        await page.waitForTimeout(500 + Math.floor(rnd() * 500)); // interrupt mid-flight
        await ease(ZMAX - 1 - rnd() * 2, 700);
        await page.waitForTimeout(900);
      } else if (fam === 'wheel_real_out' || fam === 'wheel_real_in') {
        // REAL mouse-wheel over the canvas — MapLibre scrollZoom (its own rate curve, inertia,
        // and interrupt semantics; what a desktop user actually does).
        const dir = fam === 'wheel_real_out' ? 1 : -1; // wheel down (+deltaY) zooms OUT
        await page.mouse.move(620, 420);
        const ticks = 5 + Math.floor(rnd() * 6); // 5-10 rapid ticks
        for (let i = 0; i < ticks; i++) {
          await page.mouse.wheel(0, dir * (120 + Math.floor(rnd() * 240)));
          await page.waitForTimeout(60 + Math.floor(rnd() * 130)); // trackpad-fast cadence
        }
        await page.waitForTimeout(700);
      }
      if (rnd() < 0.5) {
        await panBy([Math.floor((rnd() - 0.5) * 900), Math.floor((rnd() - 0.5) * 400)], 500);
        await page.waitForTimeout(650);
      }
    }
  }
  await page.waitForTimeout(2500);
  stop = true;
  await Promise.all([sampler, shooter]);
  fs.writeFileSync(path.join(OUT, 'console_log.json'), JSON.stringify(consoleLog, null, 1));
  await ctx.close(); // flushes the video
  await browser.close();

  // ── Analysis ──
  // STRUCTURAL over the 10 Hz samples: count clamp samples AND measure the worst DWELL — a
  // 100 ms blip during an interrupted gesture reads differently than a 2 s hole.
  let clampSamples = 0, coldSamples = 0, unknownCoverage = 0;
  let worstDwellMs = 0, dwellStart = null;
  const clampWindows = [];
  // ⚠️ WHICH SUBJECT IS UNDER TEST decides which residency counts. Reading wind residency while
  // driving the marine layer made every sample "cold" and the run unfailable — see the sampler.
  const MARINE_UNDER_TEST = /waves|both/.test(LAYER);
  for (const s of samples) {
    const hasAnyGrid = MARINE_UNDER_TEST
      ? (s.marineUploads > 0 || !!s.baseSpan || !!s.fine)
      : !!(s.baseSpan || s.fine);
    const uncovered = MARINE_UNDER_TEST
      ? !(s.marineCovers || s.baseCovers || s.fineCovers)
      : (!s.baseCovers && !s.fineCovers);
    // ⛔ A marine sample whose serve carried no grid bounds is UNKNOWN, not uncovered. Counting the
    // unknowns as clamps produced a 14 s phantom window (27/27 of them bounds-less) on 2026-08-09.
    if (MARINE_UNDER_TEST && uncovered && !s.marineCoverKnown && !s.baseCovers && !s.fineCovers) {
      unknownCoverage++;
      continue;
    }
    const clamp = uncovered && hasAnyGrid;
    if (clamp) {
      clampSamples++;
      if (dwellStart === null) dwellStart = s.t;
      worstDwellMs = Math.max(worstDwellMs, s.t - dwellStart);
    } else {
      if (dwellStart !== null) clampWindows.push({ from: dwellStart, to: s.t });
      dwellStart = null;
      if (uncovered) coldSamples++;
    }
  }
  if (dwellStart !== null && samples.length) clampWindows.push({ from: dwellStart, to: samples[samples.length - 1].t });
  for (const w of clampWindows) {
    const logs = consoleLog.filter((l) => l.t >= w.from - 2000 && l.t <= w.to + 2000).map((l) => l.text);
    console.log(`CLAMP WINDOW ${new Date(w.from).toISOString().slice(11, 23)} -> ${new Date(w.to).toISOString().slice(11, 23)} (${w.to - w.from} ms)`);
    const inWin = samples.filter((s) => s.t >= w.from && s.t <= w.to);
    for (const s of inWin.slice(0, 6)) console.log(`   z${s.zoom} baseSpan ${s.baseSpan} fine ${JSON.stringify(s.fine)} covers b:${s.baseCovers} f:${s.fineCovers}`);
    for (const l of logs.slice(0, 8)) console.log(`   log: ${l}`);
  }
  // pixel seams over the screenshot stream (persistent >= 3 consecutive frames)
  // ── decode once, reuse for seams AND wash coverage ─────────────────────────────────────────
  const seamHistory = [];
  const washRows = [];
  const nearestSample = (t) => samples.reduce((best, s) =>
    (best === null || Math.abs(s.t - t) < Math.abs(best.t - t)) ? s : best, null);
  for (const f of frames) {
    let seams = { v: [], h: [] };
    let png = null;
    try { png = decodePNG(fs.readFileSync(f.file)); seams = findSeams(png); } catch (e) {}
    seamHistory.push({ n: f.n, seams });
    if (png) {
      const s = nearestSample(f.t) || {};
      washRows.push({
        n: f.n, t: f.t, frac: washFraction(png), zoom: s.zoom,
        engaged: s.washKnown ? s.washEngaged : null, base: s.washBase, model: s.activeModel,
        resident: MARINE_UNDER_TEST ? s.marineUploads > 0 : !!(s.baseSpan || s.fine),
        covered: !!(s.marineCovers || s.baseCovers || s.fineCovers),
      });
    }
  }
  let persistentSeams = 0;
  for (let i = 2; i < seamHistory.length; i++) {
    for (const x of seamHistory[i].seams.v) {
      const in1 = seamHistory[i - 1].seams.v.some((p) => Math.abs(p - x) <= 10);
      const in2 = seamHistory[i - 2].seams.v.some((p) => Math.abs(p - x) <= 10);
      if (in1 && in2) { persistentSeams++; console.log(`persistent vertical seam near x=${x} at frames ${i - 2}-${i}`); break; }
    }
  }
  // ISSUE A ("grid within a full heatmap"): a coarse grid filed as the FINE overlay while the base
  // covers — a blocky patch on top of good data. The coarse-overlay guard should make this ZERO.
  const coarseOverlay = samples.filter((s) => s.baseCovers && s.fineCell && s.baseCell && s.fineCell > s.baseCell * 1.3);
  // ISSUE B ("grid-square heatmap with cleared surroundings"): a COARSE grid resident but not
  // covering — a blocky box with the rest cleared (clip-primary on a coarse grid).
  const coarseClamp = samples.filter((s) => !s.baseCovers && !s.fineCovers && (s.baseCell >= 3.0 || s.fineCell >= 3.0));
  if (coarseOverlay.length) {
    console.log(`\nISSUE-A COARSE-OVERLAY samples: ${coarseOverlay.length}`);
    for (const s of coarseOverlay.slice(0, 8)) console.log(`   t${s.t} z${s.zoom} baseCell ${s.baseCell} fineCell ${s.fineCell} (fineN ${s.fineN})`);
  }
  if (coarseClamp.length) {
    console.log(`\nISSUE-B COARSE-CLIP-PRIMARY samples: ${coarseClamp.length}`);
    for (const s of coarseClamp.slice(0, 8)) console.log(`   t${s.t} z${s.zoom} baseCell ${s.baseCell} baseN ${s.baseN} covers b:${s.baseCovers} f:${s.fineCovers}`);
  }
  // ── WASH-COLLAPSE DETECTION ─────────────────────────────────────────────────────────────────
  // Only frames where a grid is RESIDENT AND COVERING are gradeable: if nothing covers the
  // viewport there is legitimately nothing to wash, and calling that a collapse would re-run
  // today's mistake of scoring the renderer on a sea that was never delivered.
  const gradeable = washRows.filter((r) => r.frac !== null && r.resident && r.covered);
  const med = (a) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const onFracs = gradeable.filter((r) => r.engaged === true).map((r) => r.frac);
  const offFracs = gradeable.filter((r) => r.engaged === false).map((r) => r.frac);
  const onMed = med(onFracs), offMed = med(offFracs);
  // ⭐ SELF-CALIBRATING CONTROL, not an absolute threshold. `washEngaged` is the engine's own claim
  // about whether it drew the wash; chroma is the pixel evidence. If the two do NOT separate, then
  // either the metric is blind (wrong crop/theme) or the flag does not mean what it says — and in
  // BOTH cases this detector must refuse rather than report a number. Same discipline as the
  // executed-GL oracle's noise control and this session's other two refusals.
  // ⛔ THE CONTROL IS THE LAYER-OFF FRAME, NOT `washEngaged`. Measured 2026-08-09: frames with
  // washEngaged=false scored 0.870/0.884 against an engaged range of 0.862-1.000 — no separation
  // at all, because that flag gates BLEND-BOTH (a coarse base drawn under a REGIONAL grid), not
  // whether the heatmap is painted. `isRegionalBounds(span < 359)` is one of its terms, so any
  // world grid disengages it by design. Controlling on it would have made this detector refuse
  // forever — a dead instrument dressed as a careful one.
  let washVerdict = 'NOT MEASURED', washCollapses = [];
  const baseline = med(gradeable.map((r) => r.frac));
  let offControl = null;
  try { offControl = washFraction(decodePNG(fs.readFileSync(path.join(OUT, 'wash_control_off.png')))); } catch (e) {}
  if (!gradeable.length) {
    washVerdict = 'NOT MEASURED (no gradeable frame: nothing resident+covering)';
  } else if (gradeable.length < 3) {
    washVerdict = `NOT MEASURED (only ${gradeable.length} gradeable frame(s) — no baseline)`;
  } else if (offControl === null) {
    washVerdict = 'REFUSE (no layer-off control frame — cannot show the metric responds to the wash)';
  } else if (offControl >= baseline * 0.7) {
    washVerdict = `REFUSE (control failed: layer-off chroma ${offControl.toFixed(3)} vs layer-on `
      + `baseline ${baseline.toFixed(3)} — the metric does not track the wash here, so a collapse `
      + `claim would be unfounded. Check CROP/theme before trusting any number below.)`;
  } else {
    // A collapse = a gradeable frame below 35% of the run's own layer-on baseline. Relative, so it
    // survives a theme/region/zoom change.
    // ⭐ THE MARGIN IS MEASURED, AND STATED, because a bound whose margin nobody wrote down is the
    // defect this session opened with (a census bound sitting exactly on its value, flipped by
    // drift). Observed 2026-08-09 over 52 gradeable frames: coverage holds 0.931 flat from z4 to
    // z10, and dips to 0.52-0.62 ONLY on the z2-z4.4 leg — geometry, not a defect: at world zoom
    // the crop carries more land and off-globe area and there is no ocean mask to normalise by.
    // So the legitimate floor is 56% of baseline and this gate sits at 35% — a 21-point margin.
    // ⚠️ THE COST OF HAVING NO OCEAN MASK: a PARTIAL clear at wide zoom could hide under that
    // geometric dip. Full clears are caught everywhere; partial ones only above ~z4.
    washCollapses = gradeable.filter((r) => r.frac < baseline * 0.35);
    washVerdict = washCollapses.length
      ? `COLLAPSE x${washCollapses.length} (baseline ${baseline.toFixed(3)})`
      : `OK (baseline ${baseline.toFixed(3)}, min ${Math.min(...gradeable.map((r) => r.frac)).toFixed(3)})`;
  }
  console.log(`\nWASH COVERAGE: ${washVerdict}`);
  console.log(`   control: layer-OFF ${offControl === null ? '-' : offControl.toFixed(3)}`
    + ` vs layer-ON baseline ${baseline === null ? '-' : baseline.toFixed(3)}`
    + ` (gradeable ${gradeable.length}/${washRows.length})`);
  // Reported for the record only — NOT a control. See the block above for why.
  console.log(`   blend-both (informational): engaged n=${onFracs.length} med=`
    + `${onMed === null ? '-' : onMed.toFixed(3)} | disengaged n=${offFracs.length} med=`
    + `${offMed === null ? '-' : offMed.toFixed(3)}  <- gates a coarse base under a REGIONAL grid, not visibility`);
  const washDisengaged = washRows.filter((r) => r.engaged === false);
  if (washDisengaged.length) {
    const zs = washDisengaged.map((r) => r.zoom).filter((z) => z != null);
    console.log(`   washEngaged FALSE on ${washDisengaged.length}/${washRows.length} frames`
      + (zs.length ? `, z${Math.min(...zs).toFixed(2)}-${Math.max(...zs).toFixed(2)}` : ''));
    for (const r of washDisengaged.slice(0, 6)) {
      console.log(`     frame ${r.n} z${r.zoom} frac ${r.frac === null ? '-' : r.frac.toFixed(3)}`
        + ` base=${r.base} model=${r.model} resident=${r.resident} covered=${r.covered}`);
    }
  }
  for (const r of washCollapses.slice(0, 8)) {
    console.log(`   COLLAPSE frame ${r.n} z${r.zoom} frac ${r.frac.toFixed(3)} `
      + `(baseline ${baseline.toFixed(3)}) engaged=${r.engaged} base=${r.base}`);
  }
  fs.writeFileSync(path.join(OUT, 'wash_coverage.json'), JSON.stringify({ washVerdict, onMed, offMed, baseline, rows: washRows }, null, 1));
  fs.writeFileSync(path.join(OUT, 'burst_state.json'), JSON.stringify({ seed: SEED, cycles: CYCLES, samples, frames: frames.map((f) => ({ n: f.n, t: f.t })) }, null, 1));
  console.log(`\nsamples: ${samples.length} (~10 Hz) | screenshots: ${frames.length} | clamp samples: ${clampSamples} (worst dwell ${worstDwellMs} ms across ${clampWindows.length} windows) | cold samples: ${coldSamples} | coverage-unknown: ${unknownCoverage} | persistent seams: ${persistentSeams} | coarse-overlay(A): ${coarseOverlay.length} | coarse-clip(B): ${coarseClamp.length}`);
  // ⛔⛔ REFUSE BEFORE PASSING. If the structural sampler never once saw a resident grid for the
  // layer under test, `clampSamples` is 0 BY CONSTRUCTION and "PASS" is a statement about nothing.
  // Measured 2026-08-09 under ZB_LAYER=waves: 323/323 cold, clamp 0, verdict PASS — while a user
  // was reporting the exact mid-gesture clear this probe exists to catch. Same class as the sim
  // parity probe's FAIL (INSTRUMENT) and the zoomlab verdict's REFUSE, both shipped today.
  const everResident = samples.some((s) => (MARINE_UNDER_TEST
    ? (s.marineUploads > 0 || s.baseSpan || s.fine) : (s.baseSpan || s.fine)));
  const structurallyBlind = samples.length > 0 && !everResident;
  if (structurallyBlind) {
    console.log(`\nZOOMBURST REFUSE — the structural sampler never observed a resident grid for `
      + `layer "${LAYER}" across ${samples.length} samples, so "no clamp" is unfalsifiable here. `
      + `Pixel/seam evidence still written to ${OUT}. ⚠️ A seam detector cannot see a FULLY cleared `
      + `viewport either — a blank frame has no boundary — so neither half covers "the wash `
      + `disappeared". Fix the sampler or the boot, then re-run; do not read this as a pass.`);
    process.exit(3);
  }
  const pass = clampSamples === 0 && persistentSeams === 0 && coarseOverlay.length === 0
    && washCollapses.length === 0;
  console.log(pass ? 'ZOOMBURST PASS — no mid-gesture clamp, coarse overlay, or seam across the storm.'
    : 'ZOOMBURST FAIL — see windows above + burst_state.json + console_log.json + video in ' + OUT);
  process.exit(pass ? 0 : 1);
};

if (require.main === module) runProbe();

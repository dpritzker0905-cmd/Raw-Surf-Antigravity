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

let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join('C:/Users/dprit/Raw-Surf/frontend', 'node_modules', '@playwright', 'test'))); }

const BASE = process.argv[2] || 'http://localhost:3009';
const OUT = process.argv[3] || path.join(__dirname, 'wind-zoomburst-out');
const THEME = process.argv[4] || 'dark';
fs.mkdirSync(OUT, { recursive: true });
const CENTER = { lng: -89, lat: 24 };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
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
  let clampSamples = 0, coldSamples = 0;
  let worstDwellMs = 0, dwellStart = null;
  const clampWindows = [];
  for (const s of samples) {
    const hasAnyGrid = !!(s.baseSpan || s.fine);
    const uncovered = !s.baseCovers && !s.fineCovers;
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
  const seamHistory = [];
  for (const f of frames) {
    let seams = { v: [], h: [] };
    try { seams = findSeams(decodePNG(fs.readFileSync(f.file))); } catch (e) {}
    seamHistory.push({ n: f.n, seams });
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
  fs.writeFileSync(path.join(OUT, 'burst_state.json'), JSON.stringify({ seed: SEED, cycles: CYCLES, samples, frames: frames.map((f) => ({ n: f.n, t: f.t })) }, null, 1));
  console.log(`\nsamples: ${samples.length} (~10 Hz) | screenshots: ${frames.length} | clamp samples: ${clampSamples} (worst dwell ${worstDwellMs} ms across ${clampWindows.length} windows) | cold samples: ${coldSamples} | persistent seams: ${persistentSeams} | coarse-overlay(A): ${coarseOverlay.length} | coarse-clip(B): ${coarseClamp.length}`);
  const pass = clampSamples === 0 && persistentSeams === 0 && coarseOverlay.length === 0;
  console.log(pass ? 'ZOOMBURST PASS — no mid-gesture clamp, coarse overlay, or seam across the storm.'
    : 'ZOOMBURST FAIL — see windows above + burst_state.json + console_log.json + video in ' + OUT);
  process.exit(pass ? 0 : 1);
})();

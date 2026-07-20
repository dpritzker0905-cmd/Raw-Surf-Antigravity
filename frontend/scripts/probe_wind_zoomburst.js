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
    if (c.frac > 0.55 && c.mean > Math.max(18, meanOfMeans * 3)) seams.v.push(c.x);
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
    if (c.frac > 0.55 && c.mean > Math.max(18, meanOfRowMeans * 3)) seams.h.push(c.y);
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
  // enable wind
  await page.waitForFunction(() => {
    const all = Array.from(document.querySelectorAll('button'));
    const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
    if (all.some((x) => label(x) === 'Wind')) return true;
    const exp = all.find((x) => /weather controls/i.test((x.getAttribute('aria-label') || '') + (x.title || '')));
    if (exp) exp.click();
    return false;
  }, null, { timeout: 90000 }).catch(() => {});
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button'));
    const label = (x) => ((x.title || x.getAttribute('aria-label') || x.textContent || '').trim());
    const b = all.find((x) => label(x) === 'Wind');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  // Let the first commits land — but do NOT gate on a healthy two-texture state: the probe's
  // job is to capture whatever the user would see, including degraded states.
  // ZB_PREWAIT_MS=2000 is the STRESS variant: gestures start while the cold-enable fetch race
  // is still in flight — the exact window the gesture-start base kick exists for.
  await page.waitForTimeout(Number(process.env.ZB_PREWAIT_MS || 12000));

  // The gesture script (ANIMATED — the ladder's jumpTo can't see mid-gesture states).
  const gestures = [
    { do: 'easeTo', zoom: 4.0, duration: 1600 },
    { do: 'easeTo', zoom: 9.0, duration: 2000 },
    { do: 'easeTo', zoom: 5.0, duration: 1600 },
    { do: 'panBy', px: [420, 0], duration: 1200 },
    { do: 'easeTo', zoom: 7.5, duration: 1600 },
    { do: 'easeTo', zoom: 3.5, duration: 2000 },
    { do: 'easeTo', zoom: 6.5, duration: 1600 },
  ];
  const frames = [];
  let stop = false;
  const burst = (async () => {
    let n = 0;
    while (!stop) {
      const file = path.join(OUT, `burst_${String(n).padStart(3, '0')}.png`);
      const state = await page.evaluate(() => {
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
        return {
          zoom: +m.getZoom().toFixed(2), vp,
          base: gb ? { w: gb.west, e: gb.east, s: gb.south, n: gb.north, span: +span(gb).toFixed(1) } : null,
          fine: fb ? { w: fb.west, e: fb.east, s: fb.south, n: fb.north } : null,
          baseCovers: covers(gb), fineCovers: covers(fb),
        };
      }).catch(() => null);
      try { await page.screenshot({ path: file, timeout: 5000 }); } catch (err) { break; }
      frames.push({ n, file, state });
      n++;
    }
  })();

  for (const g of gestures) {
    await page.evaluate((gg) => {
      const m = window.__RAW_MAP__ || window.map;
      if (gg.do === 'easeTo') m.easeTo({ zoom: gg.zoom, duration: gg.duration });
      else if (gg.do === 'panBy') m.panBy(gg.px, { duration: gg.duration });
    }, g);
    await page.waitForTimeout(g.duration + 900); // gesture + fetch/commit window
  }
  await page.waitForTimeout(2500);
  stop = true;
  await burst;
  await ctx.close(); // flushes the video
  await browser.close();

  // ── Analysis ──
  let structuralFails = 0;
  let coldFrames = 0;
  const seamHistory = [];
  for (const f of frames) {
    const st = f.state;
    const hasAnyGrid = !!(st && (st.base || st.fine));
    const uncovered = st && !st.baseCovers && !st.fineCovers;
    // PARTIAL-DATA clamp (a resident box not covering = the visible rectangle) fails the run;
    // COLD-EMPTY (nothing committed yet) is the bounded initial-load window — report, don't fail.
    const clampFrame = uncovered && hasAnyGrid;
    if (clampFrame) structuralFails++;
    else if (uncovered) coldFrames++;
    let seams = { v: [], h: [] };
    try { seams = findSeams(decodePNG(fs.readFileSync(f.file))); } catch (e) {}
    seamHistory.push({ n: f.n, seams });
    const flag = clampFrame ? '  << STRUCTURAL CLAMP (resident grid does not cover the viewport)'
      : (uncovered ? '  (cold: nothing committed yet)' : '');
    console.log(`frame ${String(f.n).padStart(3)} z${st ? st.zoom : '?'} base ${st && st.base ? st.base.span + 'deg' : 'none'}${st && st.fine ? ' fine[' + st.fine.w + '..' + st.fine.e + ']' : ''} covers b:${st ? st.baseCovers : '?'} f:${st ? st.fineCovers : '?'} seamsV:${seams.v.length} seamsH:${seams.h.length}${flag}`);
  }
  // persistent seams: same x (+-10 px) in >= 3 consecutive frames
  let persistentSeams = 0;
  for (let i = 2; i < seamHistory.length; i++) {
    for (const x of seamHistory[i].seams.v) {
      const in1 = seamHistory[i - 1].seams.v.some((p) => Math.abs(p - x) <= 10);
      const in2 = seamHistory[i - 2].seams.v.some((p) => Math.abs(p - x) <= 10);
      if (in1 && in2) { persistentSeams++; break; }
    }
  }
  fs.writeFileSync(path.join(OUT, 'burst_state.json'), JSON.stringify(frames.map((f) => ({ n: f.n, state: f.state })), null, 1));
  console.log(`\nframes: ${frames.length} | structural-clamp frames: ${structuralFails} | cold frames: ${coldFrames} | persistent vertical seams: ${persistentSeams}`);
  const pass = structuralFails === 0 && persistentSeams === 0;
  console.log(pass ? 'ZOOMBURST PASS — no mid-gesture clamp (structural or pixel).'
    : 'ZOOMBURST FAIL — mid-gesture clamp captured; see burst_state.json + video in ' + OUT);
  process.exit(pass ? 0 : 1);
})();

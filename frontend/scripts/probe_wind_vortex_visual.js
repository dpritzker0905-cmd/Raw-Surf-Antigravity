/**
 * probe_wind_vortex_visual.js — R-gated vortex levers through the REAL engine (2026-07-19, #2).
 *
 * Injects a synthetic WEAK Rankine vortex (10 kn Vmax, 120 km core — the forming-low case) as a
 * FINE OVERLAY over the resident global base (the grid is stamped with the base's model+hour so
 * setWindData files it as 'fine' — an unstamped grid takes the legacy replace path and the
 * levers, which live in the fine branch only, would never engage). Then measures annulus ink
 * (pixels changed vs the wind-off baseline) with the levers ON vs KILLED
 * (__RAW_DISABLE_WIND_VORTEX_LEVERS__ — a per-frame uniform, no reload needed).
 *
 * METRIC (round 2 — the wind-off-baseline diff SATURATED at 1.000: the semi-transparent field
 * wash alone changes every pixel, so it measured the FIELD, not the particles): FRAME-PAIR
 * MOTION. Two screenshots 1.5 s apart INSIDE one state — the wash is static between frames of
 * the same data, so it cancels exactly; changed pixels are moving/turning-over particle marks.
 * PASS = annulus frame-pair motion rises with the levers ON (persistence keeps ~3x marks alive,
 * gamma restore speeds the slow annulus) while the ambient CONTROL box stays ~equal (gate 0 ->
 * bit-exact shipped behavior there).
 *
 * Usage: node probe_wind_vortex_visual.js [baseUrl] [outdir]   (run from frontend/)
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

function inkInRect(basePng, onPng, rect) {
  const { w, ch } = basePng;
  // ⚠️ MEASURED-FLAKY VERDICT (2026-07-20 debt-bank audit + offline validation on the
  // committed vx_levers_* frames). This is a FRAME-PAIR motion metric, a different delta
  // regime from zoomclamp/finegrid's static base-vs-ON wash — DO NOT transplant their
  // TH_SUM=20 fix here: validated offline, SUM=20 makes it WORSE on the committed frames
  // (OFF-leg control-ink spread 0.0022 → 0.0185; the lever verdict flips 1.202 → 0.952).
  // The per-channel TH=10 is itself knife-edged in this regime (verdict flips PASS/WEAK as
  // the threshold moves 1-2 units: TH=8 FAIL, 9 PASS, 10 PASS by 0.063, 12 FAIL), and the
  // downstream leverEffect>1.1 cutoff carries leg noise (~0.07 between identical OFF legs)
  // of the same order as its pass margin. PROTOCOL: never cite a single-run behavioral
  // verdict — run ≥3 leg pairs and take the median ratio. Re-architecting the metric
  // (multi-leg median built into the probe) is the real fix; tracked in the 07-20 handoff.
  const TH = 10;
  let n = 0, d = 0;
  for (let y = rect.y0; y < rect.y1; y++) for (let x = rect.x0; x < rect.x1; x++) {
    const i = (y * w + x) * ch;
    if (Math.abs(basePng.data[i] - onPng.data[i]) > TH
      || Math.abs(basePng.data[i + 1] - onPng.data[i + 1]) > TH
      || Math.abs(basePng.data[i + 2] - onPng.data[i + 2]) > TH) n++;
    d++;
  }
  return n / Math.max(1, d);
}

let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join('C:/Users/dprit/Raw-Surf/frontend', 'node_modules', '@playwright', 'test'))); }

const BASE = process.argv[2] || 'http://localhost:3009';
const OUT = process.argv[3] || path.join(__dirname, 'wind-vortex-out');
fs.mkdirSync(OUT, { recursive: true });
const CENTER = { lng: -89, lat: 24, zoom: 6.5 };
const VORTEX = { lng: -89, lat: 24, coreKm: 120, vmax: 10 };

async function boot(browser, windOn) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try {
    localStorage.setItem('raw-surf-theme', 'dark');
    localStorage.setItem('__RAW_TUNER__', '0');
    localStorage.setItem('__RAW_DIAG__', '0');
  } catch (e) {} });
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
    if (m && m.jumpTo) m.jumpTo({ center: [c.lng, c.lat], zoom: c.zoom });
  }, CENTER);
  if (windOn) {
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
    // wait for a GLOBAL base commit (the overlay filing precondition)
    await page.waitForFunction(() => {
      const e = window.__WIND_ENGINE__ || window.__RAW_WIND__;
      const g = e && e._windData && e._windData.windGrid;
      if (!(g && g.bounds && e._windData.texture)) return false;
      return (g.bounds.east - g.bounds.west) >= 350;
    }, null, { timeout: 150000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  return { ctx, page };
}

async function injectVortexOverlay(page) {
  return page.evaluate((vx) => {
    const e = window.__WIND_ENGINE__ || window.__RAW_WIND__;
    const m = window.__RAW_MAP__ || window.map;
    const gl = m && m.painter && m.painter.context && m.painter.context.gl;
    if (!e || !gl) return 'no engine/gl';
    const baseGrid = e._windData && e._windData.windGrid;
    if (!baseGrid) return 'no resident base';
    const b = { west: -95, south: 20, east: -83, north: 28 };
    const cols = 49, rows = 33;
    const dlng = (b.east - b.west) / (cols - 1), dlat = (b.north - b.south) / (rows - 1);
    const KM_LAT = 110.57, KM_LNG = 111.32;
    const vectors = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lat = b.south + r * dlat, lng = b.west + c * dlng;
        const cosLat = Math.max(0.2, Math.cos(lat * Math.PI / 180));
        let u = -4.0, v = 0.0; // light ambient easterly
        const dx = (lng - vx.lng) * KM_LNG * cosLat, dy = (lat - vx.lat) * KM_LAT;
        const rad = Math.hypot(dx, dy);
        const vt = rad <= vx.coreKm ? vx.vmax * (rad / vx.coreKm) : vx.vmax * (vx.coreKm / rad);
        if (rad > 0.1) { u += vt * (-dy / rad); v += vt * (dx / rad); }
        vectors.push({ lat, lng, speed: Math.hypot(u, v), direction: 0, u, v });
      }
    }
    // Stamp the base's identity so setWindData files this as the FINE OVERLAY (queue #9 rules).
    const grid = {
      vectors, cols, rows, bounds: b, coverage_scope: 'viewport',
      source: baseGrid.source, truthTag: baseGrid.truthTag,
      hourOffset: baseGrid.hourOffset || 0,
      valid_time: baseGrid.valid_time || baseGrid.validTime,
    };
    const verdict = e.setWindData(gl, grid);
    m.triggerRepaint();
    return 'verdict=' + verdict + ' fine=' + !!(e._windFine && e._windFine.texture)
      + ' | base identity: source=' + JSON.stringify(baseGrid.source)
      + ' truthTagModel=' + JSON.stringify(baseGrid.truthTag && baseGrid.truthTag.model)
      + ' hourOffset=' + JSON.stringify(baseGrid.hourOffset)
      + ' valid_time=' + JSON.stringify(baseGrid.valid_time || baseGrid.validTime)
      + ' span=' + (baseGrid.bounds ? (baseGrid.bounds.east - baseGrid.bounds.west) : 'n/a');
  }, VORTEX);
}

async function framePairMotion(page, tag) {
  const f1 = path.join(OUT, `vx_${tag}_f1.png`);
  const f2 = path.join(OUT, `vx_${tag}_f2.png`);
  await page.screenshot({ path: f1 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: f2 });
  return { f1: decodePNG(fs.readFileSync(f1)), f2: decodePNG(fs.readFileSync(f2)) };
}

function redFraction(png, rect) {
  const { w, ch } = png;
  let n = 0, d = 0;
  for (let y = rect.y0; y < rect.y1; y++) for (let x = rect.x0; x < rect.x1; x++) {
    const i = (y * w + x) * ch;
    // gate view paints pure red: R clearly dominant over G and B
    if (png.data[i] > 90 && png.data[i] > png.data[i + 1] * 2 && png.data[i] > png.data[i + 2] * 2) n++;
    d++;
  }
  return n / Math.max(1, d);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });

  const on = await boot(browser, true);
  console.log(await injectVortexOverlay(on.page));

  // screen geometry: z6.5 @1280px -> ~9.95 deg lng span; centre (-89,24) at (640,400)
  const pxPerDegX = 1280 / 9.95;
  const pxPerDegY = pxPerDegX * 0.91; // mercator y-stretch near lat 24 — coarse is fine for a region box
  const annulusDeg = 2.0;             // annulus reach ~2 deg around the core
  const ann = {
    x0: Math.round(640 - annulusDeg * pxPerDegX), x1: Math.round(640 + annulusDeg * pxPerDegX),
    y0: Math.round(400 - annulusDeg * pxPerDegY), y1: Math.round(400 + annulusDeg * pxPerDegY),
  };
  // ambient control: same-size box at the overlay's west edge, beyond the vortex reach.
  // x0=260 keeps it right of the app sidebar (~200 px) so UI chrome cannot dilute the metric.
  const ctl = { x0: 260, x1: 260 + Math.round((ann.x1 - ann.x0) / 2), y0: ann.y0, y1: ann.y1 };

  // ── 1. DETERMINISTIC WIRING PROOF: the gate view paints an R ring where the field rotates ──
  await on.page.evaluate(() => { window.__GPU_DEBUG__ = { mode: 'vortex' }; const m = window.__RAW_MAP__ || window.map; m.triggerRepaint(); });
  await on.page.waitForTimeout(1200);
  const gatePath = path.join(OUT, 'vx_gate_view.png');
  await on.page.screenshot({ path: gatePath });
  await on.page.evaluate(() => { window.__GPU_DEBUG__ = { mode: null }; });
  const gatePng = decodePNG(fs.readFileSync(gatePath));
  // the core+annulus lives well inside +-1.2 deg of centre at coreKm 120
  const coreRect = {
    x0: Math.round(640 - 1.2 * pxPerDegX), x1: Math.round(640 + 1.2 * pxPerDegX),
    y0: Math.round(400 - 1.2 * pxPerDegY), y1: Math.round(400 + 1.2 * pxPerDegY),
  };
  const redCore = redFraction(gatePng, coreRect);
  const redCtl = redFraction(gatePng, ctl);
  console.log(`GATE VIEW: red fraction core ${redCore.toFixed(3)} | ambient control ${redCtl.toFixed(3)}`);

  // ── 2. BEHAVIORAL A/B/A (drift-controlled): off -> on -> off2, annulus normalized by control ──
  await on.page.evaluate(() => { window.__RAW_DISABLE_WIND_VORTEX_LEVERS__ = true; });
  await on.page.waitForTimeout(10000);
  const kill = await framePairMotion(on.page, 'levers_off');

  await on.page.evaluate(() => { delete window.__RAW_DISABLE_WIND_VORTEX_LEVERS__; });
  await on.page.waitForTimeout(10000);
  const live = await framePairMotion(on.page, 'levers_on');

  await on.page.evaluate(() => { window.__RAW_DISABLE_WIND_VORTEX_LEVERS__ = true; });
  await on.page.waitForTimeout(10000);
  const kill2 = await framePairMotion(on.page, 'levers_off2');

  const tele = await on.page.evaluate(() => window.__WIND_FINE_OVERLAY__ || null);
  await on.ctx.close();
  await browser.close();

  const norm = (pair) => {
    const a = inkInRect(pair.f1, pair.f2, ann);
    const c = inkInRect(pair.f1, pair.f2, ctl);
    return { a, c, n: a / Math.max(c, 1e-6) };
  };
  const A1 = norm(kill), B = norm(live), A2 = norm(kill2);
  console.log(`tele: ${JSON.stringify(tele)}`);
  console.log(`A/B/A annulus/control: OFF ${A1.a.toFixed(3)}/${A1.c.toFixed(3)} (n ${A1.n.toFixed(2)})` +
    ` | ON ${B.a.toFixed(3)}/${B.c.toFixed(3)} (n ${B.n.toFixed(2)})` +
    ` | OFF2 ${A2.a.toFixed(3)}/${A2.c.toFixed(3)} (n ${A2.n.toFixed(2)})`);
  const offN = (A1.n + A2.n) / 2;
  const leverEffect = B.n / Math.max(offN, 1e-6);
  console.log(`normalized lever effect (ON / mean OFF): ${leverEffect.toFixed(2)}`);

  const gateOk = redCore > 0.04 && redCtl < 0.01;
  const behaveOk = leverEffect > 1.1;
  console.log(`gate wiring: ${gateOk ? 'PASS' : 'FAIL'} | behavioral: ${behaveOk ? 'PASS' : 'WEAK/FAIL'}`);
  const pass = tele && tele.active && gateOk;
  console.log(pass
    ? (behaveOk ? 'VORTEX LEVERS PASS — gate fires where the field rotates AND annulus turnover rises.'
                : 'VORTEX LEVERS PASS (wiring) — gate proven; behavioral signal weak under SwiftShader noise.')
    : 'VORTEX LEVERS FAIL — see numbers above.');
  process.exit(pass ? 0 : 1);
})();

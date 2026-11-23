// GUST CUE A/B harness (offline). One browser session per (cue, theme, view). Synthetic backend on PORT; dev SPA on AB_BASE.
// Injects a CONTROLLED gust field: gust = wind speed (the engine's own resident wind, sampled on the CPU) x a known gust factor
// in four vertical bands across the view (G/W = 1.0, 1.4, 1.7, 2.3), so each cue is shown where gustiness is known.
// Captures: N frames read from the WebGL canvas inside MapLibre's 'render' event (premultiplied RGBA -> PNG later), a
// screenshot with the UI (legend key), and the band rectangles in device px.
//   node gustcue.js <outDir> <cue> <theme> <view> [mode]      mode: discover | run
const fs = require('fs');
const path = require('path');
const L = require(process.env.AB_LIB);

const [OUT, CUE, THEME, VIEW, MODE = 'run'] = process.argv.slice(2);
const PORT = +(process.env.PORT || 4100);
const PHONE = VIEW === 'phone';
const W = PHONE ? 375 : 1440, H = PHONE ? 812 : 900, DPR = PHONE ? 2 : 1;
const CENTER = (process.env.CENTER || '-40,38').split(',').map(Number);
const ZOOM = +(process.env.ZOOM || (PHONE ? 3.2 : 4.2));
const FACTORS = [1.0, 1.4, 1.7, 2.3];
const FRAMES = +(process.env.FRAMES || 150);   // 150 frames ~ 2.5 s at 60 fps; the flicker gets its own longer temporal run
const EVERY = +(process.env.EVERY || 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page, log } = await L.launch({ port: PORT, width: W, height: H, dpr: DPR,
    contextOptions: PHONE ? { isMobile: true, hasTouch: true } : {} });
  // read-only public frame CDN (Supabase storage public objects) is allowed through: the gust layer's own frames
  await page.route(/supabase\.co\/storage\/v1\/object\/public\//, (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
  await page.addInitScript(({ theme, cue }) => {
    localStorage.setItem('raw-surf-theme', theme);
    localStorage.removeItem('rawGustCue');
    window.__RAW_DISABLE_OWN_LAYER_AVAILABILITY__ = true;
    window.__RAW_GUST_CUE__ = cue;
    // React Scan: never loaded (ab_lib answers unpkg with an empty script); belt and braces
    window.__REACT_SCAN_STATUS__ = 'hidden';
  }, { theme: THEME, cue: CUE });
  const out = { cue: CUE, theme: THEME, view: VIEW, W, H, DPR, center: CENTER, zoom: ZOOM, factors: FACTORS };
  try {
    await L.openMap(page);
    await L.jump(page, CENTER[0], CENTER[1], ZOOM);
    await sleep(2500);
    if (PHONE) {
      await page.locator('[aria-label="Weather layers"]').filter({ visible: true }).first().click();
      await sleep(800);
      await page.locator('button').filter({ hasText: /^\s*Gusts\s*$/ }).filter({ visible: true }).first().click();
      await sleep(800);
      const close = page.locator('button[aria-label*="lose" i]').filter({ visible: true }).first();
      if (await close.count()) await close.click(); else await page.keyboard.press('Escape');
    } else {
      await page.locator('button').filter({ hasText: /^\s*Gusts\s*$/ }).filter({ visible: true }).first().click();
    }
    // wait for the wind engine's resident wind
    await page.waitForFunction(() => { const e = window.__WIND_ENGINE__; return !!(e && e._windData && e._windData.windGrid); }, null, { timeout: 60000 });
    await sleep(3000);
    if (MODE === 'discover') {
      out.discover = await page.evaluate(() => {
        const e = window.__WIND_ENGINE__; const g = e._windData.windGrid; const f = e._windFine && e._windFine.windGrid;
        const m = window.map;
        return { keys: Object.keys(g), v0: g.vectors[0], v1: g.vectors[1], vLast: g.vectors[g.vectors.length - 1], cols: g.cols, rows: g.rows,
          bounds: g.bounds, fine: f ? { cols: f.cols, rows: f.rows, bounds: f.bounds, v0: f.vectors && f.vectors[0] } : null,
          gust: e._gust ? { cols: e._gust.cols, rows: e._gust.rows, bounds: e._gust.bounds, maxKn: e._gust.maxKn } : null,
          gustMode: e._gustMode, ownGusts: !!m.getLayer('own-raster-gusts'), drawn: window.__RAW_RASTER_DRAWN__ || null,
          mapBounds: m.getBounds().toArray() };
      });
      await page.screenshot({ path: path.join(OUT, 'discover.png') });
      return;
    }
    // ---- controlled gust field over the view ----
    const inj = await page.evaluate(({ factors }) => {
      const e = window.__WIND_ENGINE__; const m = window.map;
      const grids = [e._windFine && e._windFine.windGrid, e._windData.windGrid].filter(Boolean);
      const speedAt = (lng, lat) => {
        for (const g of grids) {
          const b = g.bounds; const east = b.east < b.west ? b.east + 360 : b.east;
          let x = lng; while (x < b.west) x += 360; while (x > b.west + 360) x -= 360;
          if (x > east || lat < b.south || lat > b.north) continue;
          const fx = (x - b.west) / (east - b.west) * (g.cols - 1), fy = (lat - b.south) / (b.north - b.south) * (g.rows - 1);
          const southFirst = !(g.vectors[0].lat > g.vectors[g.vectors.length - 1].lat);
          const at = (c, r) => { const v = g.vectors[(southFirst ? r : (g.rows - 1 - r)) * g.cols + c]; return v ? Math.hypot(v.u, v.v) : NaN; };
          const c0 = Math.min(g.cols - 2, Math.floor(fx)), r0 = Math.min(g.rows - 2, Math.floor(fy)); const tx = fx - c0, ty = fy - r0;
          const sp = (at(c0, r0) * (1 - tx) + at(c0 + 1, r0) * tx) * (1 - ty) + (at(c0, r0 + 1) * (1 - tx) + at(c0 + 1, r0 + 1) * tx) * ty;
          if (!Number.isFinite(sp)) continue;
          return sp;
        }
        return NaN;
      };
      const [[w, s], [ea, n]] = m.getBounds().toArray();
      const pad = 2; const west = w - pad, east = ea + pad, south = Math.max(-85, s - pad), north = Math.min(85, n + pad);
      const cols = 360, rows = 240; const values = new Float32Array(cols * rows);
      const band = (lng) => Math.min(3, Math.max(0, Math.floor((lng - w) / (ea - w) * 4)));
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const lng = west + (east - west) * c / (cols - 1), lat = south + (north - south) * r / (rows - 1);
        const sp = speedAt(lng, lat);
        values[r * cols + c] = Number.isFinite(sp) ? Math.max(sp, 2) * factors[band(lng)] : NaN;
      }
      const field = { cols, rows, bounds: { west, south, east, north }, values, validMs: Date.now() };
      const lyr = m.getLayer('own-raster-gusts'); const impl = lyr && lyr.implementation;
      if (!impl || !impl.offerField) return { error: 'no own-raster-gusts layer', layers: m.getStyle().layers.filter((l) => l.type === 'custom').map((l) => l.id) };
      impl.offerField('ab-gust', field); impl.want('ab-gust');
      window.__AB_GUST__ = { field: { cols, rows, bounds: field.bounds } };
      // band rectangles in device px
      const dpr = window.devicePixelRatio || 1; const cv = m.getCanvas();
      const bands = factors.map((f, i) => {
        const l0 = w + (ea - w) * i / 4, l1 = w + (ea - w) * (i + 1) / 4;
        const a = m.project([l0, n]), b = m.project([l1, s]);
        return { f, x0: Math.round(a.x * dpr), x1: Math.round(b.x * dpr), y0: 0, y1: cv.height };
      });
      window.__AB_BANDS__ = bands;
      return { bands, canvas: [cv.width, cv.height], dpr };
    }, { factors: FACTORS });
    out.inject = inj;
    if (inj.error) throw Error(JSON.stringify(inj));
    await sleep(4000);
    // was it taken? the engine's gust texture should now be our field's size
    out.engineGust = await page.evaluate(() => { const g = window.__WIND_ENGINE__._gust; return g ? { cols: g.cols, rows: g.rows, bounds: g.bounds } : null; });
    // hide the UI chrome for the clean canvas strip; screenshot WITH UI first (legend key)
    await page.evaluate(() => { for (const el of document.querySelectorAll('[role="alert"],[role="status"],li[data-sonner-toast],[data-sonner-toaster]')) {
      if (/Couldn't load|unavailable/i.test(el.textContent || '')) el.style.display = 'none'; } });
    await page.screenshot({ path: path.join(OUT, 'ui.png') });
    out.key = await page.evaluate(() => { const k = document.querySelector('[data-gust-cue]'); return k ? { cue: k.getAttribute('data-gust-cue'), label: k.getAttribute('aria-label'), text: k.textContent } : null; });
    // frames from the WebGL canvas inside the render event
    const frames = await page.evaluate(({ N, every }) => new Promise((resolve) => {
      const m = window.map; const cv = m.getCanvas(); const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      const w = cv.width, h = cv.height; const bands = window.__AB_BANDS__;
      const CW = Math.min(240, Math.min(...bands.map((b) => b.x1 - b.x0)) - 16), CH = Math.min(400, Math.round(h * 0.5));
      const crops = bands.map((b) => ({ x: Math.round((b.x0 + b.x1 - CW) / 2), y: Math.round((h - CH) / 2) }));
      window.__AB_CROPS__ = { CW, CH, crops };
      const got = []; let k = 0; const t0 = performance.now();
      const failT = setTimeout(() => { m.off('render', onRender); resolve({ w, h, frames: got, err: 'timeout after ' + got.length }); }, 120000);
      const onRender = () => { try { onRender0(); } catch (e) { clearTimeout(failT); m.off('render', onRender); resolve({ w, h, frames: got, err: String(e && e.stack || e) }); } };
      const onRender0 = () => {
        k++;
        if (k % every === 0) {
          const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          // relative luminance (WCAG: sRGB -> linear, Rec.709 weights), 8-bit, rows flipped to top-down
          const lut = window.__AB_LIN__ || (window.__AB_LIN__ = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }));
          // per-band central crops only (CW x CH device px each), rows top-down
          const y = new Uint8Array(crops.length * CW * CH); let o = 0;
          for (const cr of crops) for (let r = 0; r < CH; r++) { const src = (h - 1 - (cr.y + r)) * w * 4; for (let c = 0; c < CW; c++) { const i = src + (cr.x + c) * 4;
            y[o++] = Math.round(255 * (0.2126 * lut[px[i]] + 0.7152 * lut[px[i + 1]] + 0.0722 * lut[px[i + 2]])); } }
          let bin = ''; const CHUNK = 0x8000; for (let i = 0; i < y.length; i += CHUNK) bin += String.fromCharCode.apply(null, y.subarray(i, i + CHUNK));
          got.push({ t: performance.now() - t0, b64: btoa(bin) });
        }
        if (got.length >= N) { clearTimeout(failT); m.off('render', onRender); resolve({ w, h, frames: got }); } else m.triggerRepaint();
      };
      m.on('render', onRender); m.triggerRepaint();
    }), { N: FRAMES, every: EVERY });
    out.crops = await page.evaluate(() => window.__AB_CROPS__); out.frameErr = frames.err || null;
    out.frameW = frames.w; out.frameH = frames.h; out.nFrames = frames.frames.length; out.times = frames.frames.map((f) => +f.t.toFixed(1));
    const bin = Buffer.concat(frames.frames.map((f) => Buffer.from(f.b64, 'base64')));
    fs.writeFileSync(path.join(OUT, 'frames.y8'), bin);
    await page.screenshot({ path: path.join(OUT, 'shot.png') });
    out.errors = log.errors.slice(0, 5); out.console = log.console.filter((c) => /gust|shader|GL|link/i.test(c.text)).slice(0, 10);
  } catch (e) {
    out.fail = String(e && e.stack || e).slice(0, 800);
    try { await page.screenshot({ path: path.join(OUT, 'fail.png') }); } catch (x) { /* */ }
  } finally {
    fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(out, null, 1));
    await browser.close();
  }
})();

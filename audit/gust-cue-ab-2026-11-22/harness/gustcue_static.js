// GUST HATCH CONTRAST harness (offline): every background the hatch can sit on, with no marks in the way.
// Marks are suppressed (the particle draw call is skipped, harness only), the hatch is forced on everywhere (its
// threshold uniform is overridden, harness only), and the gust field is a RAMP 0 -> 75 kn across the view, so the
// whole gust palette lies under the hatch, over land and sea. One still, full canvas, RGBA.
//   node gustcue_static.js <outDir> <cue: none|hatch> <theme> <view>
const fs = require('fs');
const path = require('path');
const L = require(process.env.AB_LIB);
const [OUT, CUE, THEME, VIEW] = process.argv.slice(2);
const PORT = +(process.env.PORT || 4100);
const PHONE = VIEW === 'phone';
const W = PHONE ? 375 : 1440, H = PHONE ? 812 : 900, DPR = PHONE ? 2 : 1;
const CENTER = (process.env.CENTER || '-30,25').split(',').map(Number);
const ZOOM = +(process.env.ZOOM || (PHONE ? 1.6 : 2.4));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page, log } = await L.launch({ port: PORT, width: W, height: H, dpr: DPR, contextOptions: PHONE ? { isMobile: true, hasTouch: true } : {} });
  await page.route(/supabase\.co\/storage\/v1\/object\/public\//, (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
  await page.addInitScript(({ theme, cue }) => {
    localStorage.setItem('raw-surf-theme', theme); localStorage.removeItem('rawGustCue');
    window.__RAW_DISABLE_OWN_LAYER_AVAILABILITY__ = true; window.__RAW_GUST_CUE__ = cue;
    for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext].filter(Boolean).map((c) => c.prototype)) {
      const da = P.drawArrays;
      P.drawArrays = function (...a) {   // harness only: no marks, so the hatch meets the bare field
        const e = window.__WIND_ENGINE__;
        if (window.__AB_NO_MARKS__ && e && this.getParameter(this.CURRENT_PROGRAM) === e.drawProgram) return undefined;
        return da.apply(this, a);
      };
      const gul = P.getUniformLocation;
      P.getUniformLocation = function (prog, name) {
        const loc = gul.call(this, prog, name);
        const e = window.__WIND_ENGINE__;
        if (loc && name === 'u_thresh' && e && e._gustHatch && e._gustHatch.prog === prog) loc.__abHatch = true;
        return loc;
      };
      const u4 = P.uniform4f;
      P.uniform4f = function (loc, a, b, c, d) {   // harness only: hatch (single and cross) everywhere
        if (loc && loc.__abHatch && window.__AB_FORCE_HATCH__) return u4.call(this, loc, -1, -1, 0.01, d);   // .w is the halo width: kept
        return u4.call(this, loc, a, b, c, d);
      };
    }
  }, { theme: THEME, cue: CUE });
  const out = { cue: CUE, theme: THEME, view: VIEW, W, H, DPR };
  try {
    await L.openMap(page);
    await L.jump(page, CENTER[0], CENTER[1], ZOOM);
    await sleep(2500);
    if (PHONE) {
      await page.locator('[aria-label="Weather layers"]').filter({ visible: true }).first().click(); await sleep(800);
      await page.locator('button').filter({ hasText: /^\s*Gusts\s*$/ }).filter({ visible: true }).first().click(); await sleep(800);
      const close = page.locator('button[aria-label*="lose" i]').filter({ visible: true }).first();
      if (await close.count()) await close.click(); else await page.keyboard.press('Escape');
    } else {
      await page.locator('button').filter({ hasText: /^\s*Gusts\s*$/ }).filter({ visible: true }).first().click();
    }
    await page.waitForFunction(() => { const e = window.__WIND_ENGINE__; return !!(e && e._windData && e._windData.windGrid); }, null, { timeout: 60000 });
    await sleep(3000);
    out.inject = await page.evaluate(() => {
      const m = window.map; const [[w, s], [ea, n]] = m.getBounds().toArray();
      const west = w - 2, east = ea + 2, south = Math.max(-85, s - 2), north = Math.min(85, n + 2);
      const cols = 400, rows = 200; const values = new Float32Array(cols * rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) values[r * cols + c] = 75 * c / (cols - 1);   // 0 -> 75 kn west to east
      const impl = m.getLayer('own-raster-gusts').implementation;
      impl.offerField('ab-ramp', { cols, rows, bounds: { west, south, east, north }, values, validMs: Date.now() }); impl.want('ab-ramp');
      window.__AB_NO_MARKS__ = true; window.__AB_FORCE_HATCH__ = true;
      return { west, east, south, north };
    });
    await sleep(5000);
    await page.evaluate(() => { for (const el of document.querySelectorAll('[role="alert"],[role="status"],li[data-sonner-toast]')) if (/Couldn't load|unavailable/i.test(el.textContent || '')) el.style.display = 'none'; });
    const px = await page.evaluate(() => new Promise((resolve) => {
      const m = window.map; const cv = m.getCanvas(); const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      let k = 0;
      const on = () => { if (++k < 6) { m.triggerRepaint(); return; } m.off('render', on);
        const w = cv.width, h = cv.height; const p = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, p);
        let bin = ''; const CHUNK = 0x8000; for (let i = 0; i < p.length; i += CHUNK) bin += String.fromCharCode.apply(null, p.subarray(i, i + CHUNK));
        resolve({ w, h, b64: btoa(bin) }); };
      m.on('render', on); m.triggerRepaint();
    }));
    out.w = px.w; out.h = px.h;
    fs.writeFileSync(path.join(OUT, 'canvas.rgba'), Buffer.from(px.b64, 'base64'));   // bottom-up rows
    await page.screenshot({ path: path.join(OUT, 'shot.png') });
    out.errors = log.errors.slice(0, 3);
  } catch (e) {
    out.fail = String(e && e.stack || e).slice(0, 800);
  } finally {
    fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(out, null, 1));
    await browser.close();
  }
})();

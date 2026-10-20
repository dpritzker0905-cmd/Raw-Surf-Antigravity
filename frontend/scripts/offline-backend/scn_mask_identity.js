// Is the land mask the app DRAWS identical between two builds? (offline only, 2026-10-20)
// At a fixed sequence of views, after the mask settles (no new basemap-water paint for SETTLE_MS and the map idle), reads
// the engine's resident textures back from the GPU (FBO + readPixels): the base mask (_cachedMaskTex) and the viewport
// overlay (_overlayMaskTex), with their dims and bounds, and prints an FNV-1a hash of every byte. Run it on two bundles
// (AB_BASE) per theme and compare the JSON; run the same bundle twice for the null control (timing-dependent paints).
//   PORT=4140 AB_BASE=http://127.0.0.1:3140 THEME=dark OUT=id-base-dark.json node scripts/offline-backend/scn_mask_identity.js
// NO10M=1 blocks the 10 m land file (the 50 m fallback control).
// LAB_KILLS (comma list of window.__RAW_DISABLE_*__ names) arms a kill switch before boot.
const fs = require('fs');
const L = require('./ab_lib.js');
if (process.env.AB_LIVE === '1') throw Error('offline only');
const PORT = +(process.env.PORT || 4140);
const THEME = process.env.THEME || 'dark';
const SETTLE_MS = +(process.env.SETTLE_MS || 3000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWS = [['FL z6', -80, 26, 6], ['FL z8', -80, 26, 8], ['FL pan z8', -77, 26, 8], ['FL z9.5', -80.1, 26.6, 9.5],
  ['FL z8 north', -80.5, 28, 8], ['SoCal z8', -118.3, 33.7, 8], ['SoCal z10', -118.2, 33.75, 10]];

(async () => {
  const { browser, page } = await L.launch({ port: PORT });
  await page.addInitScript((theme) => { localStorage.setItem('raw-surf-theme', theme); }, THEME);
  // NO10M=1: the 10 m land fetch fails (local copy and CDN), as when the CDN is unreachable: the control for a run whose
  // regional masks fall back to the 50 m polygons.
  if (process.env.NO10M === '1') await page.route(/ne_10m_land\.json/, (r) => r.abort());
  if (process.env.LAB_KILLS) await page.addInitScript((ks) => { ks.forEach((k) => { window[k] = true; }); }, process.env.LAB_KILLS.split(','));
  // Sliced paints (__RAW_SLICED_LAND_MASK__) count when scheduled, and a job still in flight is not settled.
  const paints = () => page.evaluate(() => { const g = window.__RAW_GPU__ || {}; const b = (g.cpuPhaseTiming || {}).buckets; return (b ? b.maskWaterPaint.calls + b.maskUpload.calls : 0) + ((g.maskSlicing || {}).scheduled || 0); });
  const read = () => page.evaluate(() => {
    const e = window.__MARINE_ENGINE__; const m = window.__MAP_INSTANCE__ || window.map;
    const gl = m && m.painter && m.painter.context && m.painter.context.gl;
    const fnv = (d) => { let h = 0x811c9dc5; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };
    const tex = (t, dims, b) => {
      if (!t || !dims || !gl) return null;
      const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING); const fbo = gl.createFramebuffer();
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return { error: 'fbo' };
        const px = new Uint8Array(dims.w * dims.h * 4); gl.readPixels(0, 0, dims.w, dims.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let water = 0; for (let i = 0; i < px.length; i += 4) if (px[i] >= 128) water++;
        return { dims: `${dims.w}x${dims.h}`, bounds: b ? [b.west, b.south, b.east, b.north].map((v) => +(+v).toFixed(5)).join(',') : null, hash: fnv(px), waterFrac: +(water / (dims.w * dims.h)).toFixed(5) };
      } finally { gl.bindFramebuffer(gl.FRAMEBUFFER, prev); gl.deleteFramebuffer(fbo); }
    };
    const geoTag = (g) => (!g ? 'none' : (g === window.__LAND_GEOJSON_HIRES_CACHE__ ? '10m' : `other:${(g.features || []).length}`));
    return { zoom: +m.getZoom().toFixed(2), maskMode: e._lastMaskEncodeMode || null, repatch: e._lastMaskRepatchReason || null,
      geo: geoTag(e._cachedMaskGeoJSON), hires10m: !!window.__LAND_GEOJSON_HIRES_CACHE__,
      tilesLoaded: !!(m.areTilesLoaded && m.areTilesLoaded()), basemapWater: (window.__RAW_GPU__ || {}).basemapWaterMask || null,
      base: tex(e._cachedMaskTex, e._cachedMaskTexDims, e._cachedMaskBounds), overlay: tex(e._overlayMaskTex, e._overlayMaskTexDims, e._overlayMaskBounds) };
  });
  try {
    await L.openMap(page); await L.jump(page, -80, 25, 3.5);
    const loc = page.locator('button').filter({ hasText: /^\s*Waves\s*$/ }).filter({ visible: true }).first();
    await loc.waitFor({ state: 'visible', timeout: 15000 }); await loc.evaluate((el) => el.click());
    await sleep(10000);
    const out = { theme: THEME, base: process.env.AB_BASE, kills: process.env.LAB_KILLS || null, views: [] };
    for (const [name, lng, lat, z] of VIEWS) {
      await L.jump(page, lng, lat, z);
      const t0 = Date.now(); let last = await paints(), stableSince = Date.now();
      while (Date.now() - t0 < 25000) {
        await sleep(250);
        const n = await paints(); const idle = await page.evaluate(() => { const m = window.__MAP_INSTANCE__ || window.map; const e = window.__MARINE_ENGINE__; return !!(m && m.loaded() && m.areTilesLoaded() && !(e && e._maskJob)); });
        if (n !== last || !idle) { last = n; stableSince = Date.now(); }
        if (Date.now() - stableSince >= SETTLE_MS) break;
      }
      const r = { view: name, settledMs: Date.now() - t0, ...(await read()) };
      out.views.push(r); console.log(JSON.stringify(r));
    }
    fs.writeFileSync(process.env.OUT || `mask-identity-${THEME}.json`, JSON.stringify(out, null, 1));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });

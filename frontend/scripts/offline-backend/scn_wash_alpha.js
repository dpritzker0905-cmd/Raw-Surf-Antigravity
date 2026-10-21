// WASH ALPHA (2026-10-20): how opaque the REAL engine draws the light/beach wave-height wash, per view, against what the colour
// checkers assume (../wind-color/wave-lib.mjs ALPHAS, heatmapZoomOpacity). Offline only: serve_synthetic.py + serve_spa.js.
//
//   python serve_synthetic.py --dir <fresh dir> --port 4141 --dynamic 1 --vortex-peak 11
//   node serve_spa.js <build dir> 3141
//   AB_BASE=http://127.0.0.1:3141 PORT=4141 OUT=<dir> node scn_wash_alpha.js      then: python wash_alpha.py <dir> <lut.json>
// Env: THEMES=light,beach  VARIANTS=v2,v1,nb  VIEWS=world,regional,r55,coastal,close  FRAMES=4
// Per theme (first variant only), before Waves is on: the bare basemap at every view (bare-<theme>-<view>.png), the ground the
// wash composites over. Then per variant and view, FRAMES paired shots at ONE forecast hour (the wash is static; crests move):
// clip-... (as drawn) and clipw-... (the same instant with the crest pass off: _fboSupported = false, the engine's own
// heatmap-only fallback, which skips only PHASE 2; the wash passes are untouched). With each pair, the opacities the engine
// handed its wash passes this frame (window.__RAW_GPU__: blendBoth.engaged, washEff = the coarse base wash's alpha, opacity.heatmap
// = the main pass's u_opacity) and what it held (grid bounds/shape, valid time, the coarse base).
// Variants: v2 = the defaults; v1 = window.__RAW_DISABLE_WAVE_PALETTE_V2__ (the 2026-10-14 tables: palette independence);
// nb = window.__RAW_DISABLE_BLEND_BOTH__ (the causal control: no coarse base under the regional, no height alpha on it).
const fs = require('fs');
const path = require('path');
const L = require('./ab_lib.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = +(process.env.PORT || 4141);
const OUT = process.env.OUT || path.join(process.cwd(), 'wash-alpha');
const LEVERS = { v2: {}, v1: { __RAW_DISABLE_WAVE_PALETTE_V2__: true }, nb: { __RAW_DISABLE_BLEND_BOTH__: true }, bw0: { __RAW_BLEND_BASE_WASH__: 0 } };
// The harness's views (scn_wave_palette_ab.js) plus the zooms wave-lib's ALPHAS name: regional z 5.5 (r55) and coastal z 10 (close).
const VIEWS = { world: [-118, 10, 2.2], regional: [-106.5, 15.5, 4.6], r55: [-106.5, 15.5, 5.5], coastal: [-105.2, 18.4, 7.4], close: [-105.2, 18.4, 10] };
// The same cameras reached by ZOOMING OUT from a close view (VIEWS=close,coastal,r55Out,regionalOut,worldOut): the regional tile
// committed up close is still resident, so BLEND BOTH lays it over the coarse base (scn_wave_palette_ab.js's clips ran in this state).
Object.assign(VIEWS, { r55Out: VIEWS.r55, regionalOut: VIEWS.regional, worldOut: VIEWS.world });
// CALM open ocean far from the storm, where the synthetic swell (serve_synthetic.py field(): 1.1 + 0.6 sin(2 lng) cos(lat)) is
// ~0.5 / 0.8 / 1.0 / 1.2 / 1.4 m: BLEND BOTH fades the regional pass below 1.4 m (smoothstep(0.05, 1.4, h)), so the coarse base
// carries calm water. At z 7.4 and z 10 (the base is damped to 35% above z 9.5).
Object.assign(VIEWS, { calm05: [-40, 2, 7.4], calm08: [-15, 2, 7.4], calm10: [-5, 0, 7.4], calm12: [-175, 0, 7.4], calm14: [-165, 0, 7.4],
  calm05c: [-40, 2, 10], calm10c: [-5, 0, 10], calm14c: [-165, 0, 10] });
const list = (env, dflt) => (process.env[env] || dflt).split(',');
const themes = list('THEMES', 'light,beach'), variants = list('VARIANTS', 'v2,v1,nb'), views = list('VIEWS', 'world,regional,r55,coastal,close');
const FRAMES = +(process.env.FRAMES || 4);

const telemetry = () => {
  const e = window.__MARINE_ENGINE__, g = window.__RAW_GPU__ || {}, d = e && e._waveData, cb = e && e._coarseBaseData, m = window.__MAP_INSTANCE__ || window.map;
  const grid = d && (d.waveGrid || d.grid || d);
  return {
    z: m.getZoom(), bounds: d && d.bounds, cols: grid && grid.cols, rows: grid && grid.rows, valid: d && d.truthTag && d.truthTag.valid_time,
    base: cb ? { bounds: cb.bounds, cols: cb.waveGrid && cb.waveGrid.cols, model: cb.__sourceModel } : null,
    blend: g.blendBoth ? g.blendBoth.engaged : null, washPre: g.washPreDamp, washEff: g.washEff, heat: g.opacity ? g.opacity.heatmap : null,
    mult: g.opacity ? g.opacity.mult : null, coarseFade: g.coarseFade, haloDamp: g.haloDamp, noTruthDamp: g.washNoTruthDamp,
    tiny: g.tinyTileFade || null, soften: g.clampSoften || null, ease: g.opacityEase || null, veil: g.coldVeil || null,
    palette: window.__RAW_DISABLE_WAVE_PALETTE_V2__ ? 'v1' : 'v2', blendKilled: window.__RAW_DISABLE_BLEND_BOTH__ === true,
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const record = { at: new Date().toISOString(), port: PORT, base: L.BASE, views: VIEWS, shots: [], bare: {}, log: {}, gpu: {} };
  // The GPU the map's own WebGL context runs on (ab_lib launches system Chrome with --use-angle=d3d11): name it with every number.
  const gpuOf = (page) => page.evaluate(() => {
    const c = document.querySelector('canvas.maplibregl-canvas');
    const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { vendor: gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR), renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
      version: gl.getParameter(gl.VERSION), ua: navigator.userAgent };
  });
  const clipOf = (page) => page.evaluate(() => {
    const r = (window.__MAP_INSTANCE__ || window.map).getContainer().getBoundingClientRect();
    return { x: Math.round(r.x + r.width * 0.2), y: Math.round(r.y + r.height * 0.15), width: Math.round(r.width * 0.6), height: Math.round(r.height * 0.7) };
  });
  for (const theme of themes) {
    {   // the bare ground at every view, Waves never on (its own session: touring the views first kept Waves from coming up)
      const { browser, page } = await L.launch({ port: PORT });
      try {
        await page.addInitScript((theme) => { localStorage.setItem('raw-surf-theme', theme); }, theme);
        await L.openMap(page);
        const clip = await clipOf(page);
        for (const view of views) {
          await L.jump(page, ...VIEWS[view]); await sleep(6000);
          const file = `bare-${theme}-${view}.png`;
          await page.screenshot({ path: path.join(OUT, file), clip });
          record.bare[`${theme}/${view}`] = file;
        }
      } finally { await browser.close(); }
    }
    for (const v of variants) {
      const { browser, page, log } = await L.launch({ port: PORT });
      try {
        // Never pre-seed window.__RAW_GPU__: the engine builds it (with frameTimeHistogram etc.) only when it is absent, and a bare {}
        // makes its render throw, the layer fail and the engine dispose (seen here 2026-10-20: no engine at world zoom).
        await page.addInitScript(({ theme, levers }) => { localStorage.setItem('raw-surf-theme', theme); Object.assign(window, levers); }, { theme, levers: LEVERS[v] });
        await L.openMap(page);
        const clip = await clipOf(page);
        // Waves on at the regional view (where scn_wave_palette_ab.js switches it on), then wait for the engine to hold a grid.
        await L.jump(page, ...VIEWS.regional); await sleep(4000);
        await L.clickText(page, 'Waves'); await sleep(9000);
        const engineUp = () => page.waitForFunction(() => !!(window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData), null, { timeout: 90000 });
        await engineUp();
        record.gpu[`${theme}/${v}`] = await gpuOf(page);
        if (v === variants[0]) console.log('gpu', theme, JSON.stringify(record.gpu[`${theme}/${v}`]));
        for (const view of views) {
          await L.jump(page, ...VIEWS[view]); await sleep(view === 'world' ? 10000 : 12000);
          await engineUp();
          for (let k = 0; k < FRAMES; k++) {
            const tag = `${theme}-${v}-${view}-${String(k).padStart(2, '0')}`;
            await page.screenshot({ path: path.join(OUT, `clip-${tag}.png`), clip });
            await page.evaluate(() => new Promise((r) => {
              window.__MARINE_ENGINE__._fboSupported = false; (window.__MAP_INSTANCE__ || window.map).triggerRepaint();
              requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)));
            }));
            await page.screenshot({ path: path.join(OUT, `clipw-${tag}.png`), clip });
            const t = await page.evaluate(telemetry);
            await page.evaluate(() => { window.__MARINE_ENGINE__._fboSupported = true; (window.__MAP_INSTANCE__ || window.map).triggerRepaint(); });
            record.shots.push({ theme, variant: v, view, k, file: `clipw-${tag}.png`, engine: t });
            if (k === 0) console.log(theme, v, view, JSON.stringify({ z: +t.z.toFixed(2), blend: t.blend, heat: t.heat, washEff: t.washEff, washPre: t.washPre, halo: t.haloDamp, noTruth: t.noTruthDamp, cols: t.cols, valid: t.valid, base: t.base && t.base.cols }));
            await sleep(400);
          }
        }
        record.log[`${theme}/${v}`] = { errors: log.errors.slice(0, 5), blockedWs: log.blockedWs.length, hosts: log.hosts, weatherRequests: log.requests.length };
      } finally { await browser.close(); }
    }
  }
  fs.writeFileSync(path.join(OUT, 'record.json'), JSON.stringify(record, null, 1));
  console.log('wrote', OUT);
})();

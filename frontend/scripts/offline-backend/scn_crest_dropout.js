// CREST DROP-OUT CAPTURE (2026-11-12, offline only): is the crest/particle pass skipped for 0.4-0.7 s while the map zooms through z4.6-6.2?
// Read-only probe: it changes no app code. Per animation frame it reads the engine's own telemetry (window.__RAW_GPU__.particlePassExecuted,
// drawCallsPerFrame, opacity.heatmap) plus the map zoom and the resident grid's dims, over repeated zoom sweeps, and reports every
// episode where the particle (crest) pass did NOT run while a marine grid was resident, with the zoom span, the resident dims and
// which commits/holds happened inside it.
//
//   python frontend/scripts/offline-backend/serve_synthetic.py --dir <fresh store> --port 4142 --models GFS,ICON --layers waves,wind_waves \
//       --regions florida_east_coast --dynamic 1 --horizon 48
//   node frontend/scripts/offline-backend/serve_spa.js frontend/build 3142
//   AB_BASE=http://127.0.0.1:3142 PORT=4142 OUT=crest.json node frontend/scripts/offline-backend/scn_crest_dropout.js
// Env: SWEEPS (6), Z_LO (4.0), Z_HI (6.6), SWEEP_MS (2500; ms per leg), CENTER ("-79.5,28.6"), MIN_MS (150; shortest episode reported),
//      LAYER ("Waves"), VIEW ("desktop" 1280x800 | "phone" 390x844 dpr 2).
// Exit 0 = no episode >= MIN_MS, 1 = at least one, 2 = error. Offline only: no request leaves the machine but basemap tiles and fonts.
const fs = require('fs');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_crest_dropout is offline only');
const PORT = +(process.env.PORT || 4142);
const SWEEPS = +(process.env.SWEEPS || 6);
const Z_LO = +(process.env.Z_LO || 4.0);
const Z_HI = +(process.env.Z_HI || 6.6);
const SWEEP_MS = +(process.env.SWEEP_MS || 2500);
const MIN_MS = +(process.env.MIN_MS || 150);
const LAYER = process.env.LAYER || 'Waves';
const [CLNG, CLAT] = (process.env.CENTER || '-79.5,28.6').split(',').map(Number);
const OUT = process.env.OUT || null;
const PHONE = process.env.VIEW === 'phone';

function installSampler() {
  window.__CREST_FRAMES__ = [];
  const t0 = performance.now();
  const map = window.__MAP_INSTANCE__ || window.map;
  const dims = () => {
    const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._waveData && window.__MARINE_ENGINE__._waveData.waveGrid;
    return g ? `${g.cols || (g.grid && g.grid.cols) || '?'}x${g.rows || (g.grid && g.grid.rows) || '?'}` : 'none';
  };
  (function tick() {
    const G = window.__RAW_GPU__ || {};
    window.__CREST_FRAMES__.push({ t: Math.round(performance.now() - t0), z: +map.getZoom().toFixed(2), pp: G.particlePassExecuted === true ? 1 : 0,
      dc: G.drawCallsPerFrame == null ? null : G.drawCallsPerFrame, hm: G.opacity && G.opacity.heatmap != null ? +(+G.opacity.heatmap).toFixed(3) : null, dims: dims() });
    window.requestAnimationFrame(tick);
  })();
}

(async () => {
  const { browser, page, log } = await L.launch(PHONE ? { port: PORT, width: 390, height: 844, dpr: 2 } : { port: PORT });
  let out;
  try {
    await L.openMap(page);
    await L.jump(page, CLNG, CLAT, Z_LO);
    await page.waitForTimeout(1500);
    await L.clickText(page, LAYER);
    await page.waitForTimeout(9000);
    await page.evaluate(installSampler);
    const legs = [];
    for (let i = 0; i < SWEEPS; i++) {
      for (const z of [Z_HI, Z_LO]) {
        const t = await page.evaluate(() => Math.round(performance.now() - 0));
        await page.evaluate(({ z, ms }) => (window.__MAP_INSTANCE__ || window.map).easeTo({ zoom: z, duration: ms }), { z, ms: SWEEP_MS });
        await page.waitForTimeout(SWEEP_MS + 900);
        legs.push({ to: z, at: t });
      }
    }
    const frames = await page.evaluate(() => window.__CREST_FRAMES__);
    const heldEvents = await page.evaluate(() => ({ finerHeld: window.__MARINE_FINER_HELD__ && window.__MARINE_FINER_HELD__.count, wor: window.__MARINE_WORLD_OVER_REGIONAL__ || null }));
    // episodes: consecutive frames with the particle pass NOT run while a grid is resident
    const eps = [];
    let cur = null;
    for (const f of frames) {
      const dropped = f.pp === 0 && f.dims !== 'none';
      if (dropped) { if (!cur) cur = { t0: f.t, z0: f.z, zmin: f.z, zmax: f.z, dims: new Set(), n: 0, hm: [] }; cur.t1 = f.t; cur.z1 = f.z; cur.zmin = Math.min(cur.zmin, f.z); cur.zmax = Math.max(cur.zmax, f.z); cur.dims.add(f.dims); cur.n++; if (f.hm != null) cur.hm.push(f.hm); }
      else if (cur) { eps.push(cur); cur = null; }
    }
    if (cur) eps.push(cur);
    const episodes = eps.map((e) => ({ ms: e.t1 - e.t0, t0: e.t0, z: [e.zmin, e.zmax], frames: e.n, dims: [...e.dims], heatmapOpacity: e.hm.length ? [Math.min(...e.hm), Math.max(...e.hm)] : null }))
      .filter((e) => e.ms >= MIN_MS);
    const gaps = frames.slice(1).map((f, i) => ({ ms: f.t - frames[i].t, t: frames[i].t, z: frames[i].z, dims: frames[i].dims })).sort((a, b) => b.ms - a.ms).slice(0, 5);
    const dts = frames.slice(1).map((f, i) => f.t - frames[i].t);
    out = { base: L.BASE, port: PORT, view: PHONE ? 'phone' : 'desktop', sweeps: SWEEPS, zoomRange: [Z_LO, Z_HI], frames: frames.length,
      frameDtMs: { median: dts.sort((a, b) => a - b)[Math.floor(dts.length / 2)], p99: dts[Math.floor(dts.length * 0.99)], max: dts[dts.length - 1] },
      longestFrameGaps: gaps, particlePassOffFrames: frames.filter((f) => f.pp === 0 && f.dims !== 'none').length, episodesGE_MIN_MS: episodes, minMs: MIN_MS,
      dimsSeen: [...new Set(frames.map((f) => f.dims))], ...heldEvents, pageErrors: log.errors.slice(0, 5) };
  } finally { await browser.close(); }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
  process.exit(out.episodesGE_MIN_MS.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

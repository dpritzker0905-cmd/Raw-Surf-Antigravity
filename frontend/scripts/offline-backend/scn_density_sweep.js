// CREST DENSITY SWEEP (2026-10-21): crest coverage against the big-surf seed cut, per theme and zoom, for the per-theme "as the eye
// sees it" fit (the owner: "Ship #428's density cut as the eye sees it (coverage-calibrated), fitted per theme"). It steps
// window.__RAW_CREST_DENSITY_SEED_CUT__ (marineCrestDensity.js, read live each frame) inside ONE browser session per theme, so every
// cut at a zoom shares the same data, view and forecast hour; the only thing that moves between cuts is the particles.
// Frames: clip-<theme>-s<cut x 100>@z<zoom x 10>-NNN.png and the PAIRED crest-free clipw-... (the engine's heatmap-only fallback),
// read by crest_coverage.py. Each step also reads u_densityCut back from the GPU (the cut the shader actually received).
//
//   python serve_synthetic.py --dir <dir> --port 4127 --dynamic 1 --vortex-peak 11   and   node serve_spa.js <build> 3117
//   PORT=4127 AB_BASE=http://127.0.0.1:3117 OUT=<dir> node scn_density_sweep.js
// Env: THEMES=light,beach,dark  CUTS=0,0.15,0.3,0.45,0.6  FRAMES=8  CENTER=-105.2,18.4 (the synthetic storm's big seas)
//      a cut of `table` deletes the knob, so the shipped per-theme row applies (tag `tbl`): CUTS=0,table,0,table,0 checks the shipped
//      values BRACKETED in one session. A cut repeated at a zoom gets its own tag (s0, s0r1, s0r2 ...), so the no-cut frames before and
//      after each cut measure the drift (crests still filling in after the jump, the storm moving) that a one-pass sweep folds into
//      the cut. SETTLE (ms after each zoom jump, default 20000); each step records its seconds since the jump.
//      ZOOMS_light / ZOOMS_beach / ZOOMS_dark (defaults below: zooms where each theme's ramp is full and the view is big surf)
//      FLAGS='{"__RAW_DISABLE_LIGHT_CREST_V2__":true}': window levers set before the app loads (e.g. another crest style)
const fs = require('fs');
const path = require('path');
const L = require('./ab_lib.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = +(process.env.PORT || 4127);
const OUT = process.env.OUT || path.join(process.cwd(), 'density-sweep');
const themes = (process.env.THEMES || 'light,beach,dark').split(',');
const CUTS = (process.env.CUTS || '0,0.15,0.3,0.45,0.6').split(',').map((c) => (c === 'table' ? c : Number(c)));
const FRAMES = +(process.env.FRAMES || 8);
const SETTLE = +(process.env.SETTLE || 20000);
const FLAGS = JSON.parse(process.env.FLAGS || '{}');
const [LNG, LAT] = (process.env.CENTER || '-105.2,18.4').split(',').map(Number);
const ZOOMS = { light: '7.4,9,10.5', beach: '7.4,9,10.5', dark: '8.25,9,10.5' };
const zoomsFor = (t) => (process.env[`ZOOMS_${t}`] || ZOOMS[t]).split(',').map(Number);

const readCut = () => {   // the u_densityCut the DRAW program holds right now
  const e = window.__MARINE_ENGINE__, c = document.querySelector('canvas.maplibregl-canvas');
  const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
  if (!gl || !e || !e.drawProgram) return null;
  const loc = gl.getUniformLocation(e.drawProgram, 'u_densityCut');
  return loc ? gl.getUniform(e.drawProgram, loc) : null;
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const record = { at: new Date().toISOString(), center: [LNG, LAT], cuts: CUTS, frames: FRAMES, flags: FLAGS, steps: [] };
  for (const theme of themes) {
    const { browser, page } = await L.launch({ port: PORT });
    try {
      await page.addInitScript((t) => localStorage.setItem('raw-surf-theme', t), theme);
      await page.addInitScript((f) => Object.assign(window, f), FLAGS);
      await L.openMap(page);
      await L.clickText(page, 'Waves'); await sleep(9000);
      const box = await page.evaluate(() => { const r = (window.__MAP_INSTANCE__ || window.map).getContainer().getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
      const clip = { x: Math.round(box.x + box.w * 0.2), y: Math.round(box.y + box.h * 0.15), width: Math.round(box.w * 0.6), height: Math.round(box.h * 0.7) };
      for (const z of zoomsFor(theme)) {
        await L.jump(page, LNG, LAT, z); await sleep(SETTLE);
        const t0 = Date.now(), seen = {};
        for (const cut of CUTS) {
          await page.evaluate((v) => { if (v === 'table') delete window.__RAW_CREST_DENSITY_SEED_CUT__; else window.__RAW_CREST_DENSITY_SEED_CUT__ = v; }, cut);
          await sleep(1200);
          const got = await page.evaluate(readCut);
          const pd = await page.evaluate(() => (window.__RAW_GPU__ && window.__RAW_GPU__.particleDensity) || null);   // the engine's seed base
          const valid = await page.evaluate(() => { const e = window.__MARINE_ENGINE__; return (e && e._lastGridMeta && e._lastGridMeta.valid_time) || null; });
          const rep = (seen[cut] = (seen[cut] === undefined ? 0 : seen[cut] + 1));
          const tag = `${cut === 'table' ? 'tbl' : `s${Math.round(cut * 100)}`}${rep ? `r${rep}` : ''}@z${Math.round(z * 10)}`;
          const atS = +((Date.now() - t0) / 1000).toFixed(1);
          for (let k = 0; k < FRAMES; k++) {
            const n = String(k).padStart(3, '0');
            await page.screenshot({ path: path.join(OUT, `clip-${theme}-${tag}-${n}.png`), clip });
            await page.evaluate(() => new Promise((r) => {
              window.__MARINE_ENGINE__._fboSupported = false; (window.__MAP_INSTANCE__ || window.map).triggerRepaint();
              requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)));
            }));
            await page.screenshot({ path: path.join(OUT, `clipw-${theme}-${tag}-${n}.png`), clip });
            await page.evaluate(() => { window.__MARINE_ENGINE__._fboSupported = true; (window.__MAP_INSTANCE__ || window.map).triggerRepaint(); });
            await sleep(150);
          }
          record.steps.push({ theme, zoom: z, cut, tag, atS, uDensityCut: got, particleDensity: pd, valid });
          console.log(theme, z, tag, 'at', atS, 's u_densityCut', got);
        }
      }
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(OUT, 'sweep.json'), JSON.stringify(record, null, 1));
  console.log('wrote', OUT);
})();

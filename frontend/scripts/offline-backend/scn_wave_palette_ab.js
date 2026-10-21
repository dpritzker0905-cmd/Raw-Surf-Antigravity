// WAVE PALETTE A/B (2026-10-20): the light and beach wave-height wash as the REAL engine draws it, offline, for v1 (the 2026-10-14
// table, what window.__RAW_DISABLE_WAVE_PALETTE_V2__ restores) and v2 (the default; DECISIONS D-033 picked light A + beach B from
// the first run's candidates A/B), at world, regional and coastal zoom, plus frames for a moving clip. One build serves both: the
// kill is set before load. A future candidate is one more entry in LEVERS (and a lever in marineWavePalette.js).
//
//   python serve_synthetic.py --dir <fresh dir> --port 4120 --dynamic 1 --vortex-peak 11   (the eye crosses 10 m: the above-cap state)
//   node serve_spa.js <build dir> 3100
//   PORT=4120 OUT=<dir> node scn_wave_palette_ab.js        then: python compose_wave_ab.py <dir>
// Env: VARIANTS=v1,v2  THEMES=light,beach  VIEWS=world,regional,coastal  CLIP=1 (frames for the clip)  CLIP_FRAMES=40
//      CLIP_VIEWS=regional,coastal (default regional; a non-regional clip's frames are named clip-<theme>-<variant>@<view>-NNN)
//      PAIRED=1: each clip frame is followed by the same view with the crest pass off (the engine's own heatmap-only fallback,
//      _fboSupported = false, restored after), saved as clipw-...: the exact wash under that frame, for crest_contrast.py
// Light crest V2 (2026-10-20): l1 is the v2 wash under TODAY's light crests (window.__RAW_DISABLE_LIGHT_CREST_V2__), v2 draws light
// crest V2 (the default); lk is V2 with the engine's crest self-contrast on at every zoom and height (window.__RAW_CREST_CONTRAST__ = 1:
// a dark skirt round a lighter centre, the cased-crest probe) and l1k today's crests the same way. Each shot reads back light's four
// crest lines from the DRAW program's own compiled GLSL.
// Per shot it records what the engine held (grid shape, bounds, valid time, the drawn grid's height range) so the panes can be
// shown to be the same data; and, before Waves is switched on, the bare water's colour (the checker's basemap model).
// THE 16 m ENCODING (2026-10-20): VARIANTS=v2@10,v2,v2@10b  THEMES=light,beach,dark  --vortex-peak 14 (the eye passes 10 m, under 16).
// v2@10 is the 16 m kill (window.__RAW_DISABLE_WAVE_HEIGHT_16M__, #411 exactly); v2@10b the same lever again and v2b the default
// again: the null controls (crest coverage breathes with the wave sets, so a run-to-run spread is the only fair yardstick).
// Each shot also records the scale the resident and coarse uploads carry and the FNV hash of the resident wave texture's bytes;
// WASH=1 adds a crest-free shot of each view (the engine's own heatmap-only fallback, _fboSupported = false, set from the page);
// CRESTS=1 adds a burst at the regional view (one crest-free frame, then CREST_FRAMES with crests) for wave_crest_stats.py.
// THE FLOAT HEIGHT (2026-10-20): VARIANTS=v2@u8,v2,v2@u8b,v2b THEMES=light,beach,dark WASH=1 over serve_synthetic.py --calm-patch
// 27,-111,8 (a calm bowl in the Gulf of California, the 'calm' view). v2@u8 is the float kill (window.__RAW_DISABLE_WAVE_HEIGHT_FLOAT__,
// #415 exactly), v2@u8b the same again (the null control). Each shot also records the float texture's upload hash and the context's
// pending GL error; TIMING=1 times every setWaveData and every R16F (RED) upload in the page. wave_float_stats.py compares the washes.
const fs = require('fs');
const path = require('path');
const L = require('./ab_lib.js');
const { decodePng } = require(path.join(__dirname, '../../e2e/pngPixels.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = +(process.env.PORT || 4120);
const OUT = process.env.OUT || path.join(process.cwd(), 'wave-ab');
const LEVERS = { v1: { __RAW_DISABLE_WAVE_PALETTE_V2__: true }, v2: {}, 'v2@10': { __RAW_DISABLE_WAVE_HEIGHT_16M__: true }, 'v2@10b': { __RAW_DISABLE_WAVE_HEIGHT_16M__: true }, v2b: {},
  'v2@u8': { __RAW_DISABLE_WAVE_HEIGHT_FLOAT__: true }, 'v2@u8b': { __RAW_DISABLE_WAVE_HEIGHT_FLOAT__: true },
  l1: { __RAW_DISABLE_LIGHT_CREST_V2__: true }, lk: { __RAW_CREST_CONTRAST__: 1 }, l1k: { __RAW_DISABLE_LIGHT_CREST_V2__: true, __RAW_CREST_CONTRAST__: 1 } };
// The synthetic storm's eye starts at 14N 106W and drifts north-west (serve_synthetic.py vortex_center); the coast is Jalisco/Colima.
// calm: the --calm-patch bowl in the Gulf of California at a zoom whose span (~14 deg) takes the dynamic lane's own grid.
const VIEWS = { world: [-118, 10, 2.2], regional: [-106.5, 15.5, 4.6], coastal: [-105.2, 18.4, 7.4], calm: [-111.3, 27.2, 7.0] };
const pick = (env, all) => (process.env[env] ? process.env[env].split(',') : Object.keys(all));
const variants = pick('VARIANTS', LEVERS), themes = process.env.THEMES ? process.env.THEMES.split(',') : ['light', 'beach'], views = pick('VIEWS', VIEWS);
const CLIP_FRAMES = +(process.env.CLIP_FRAMES || 40), CREST_FRAMES = +(process.env.CREST_FRAMES || 24), CLIP_VIEWS = (process.env.CLIP_VIEWS || 'regional').split(',');

const drawn = () => {   // what the engine holds (not the layer's parity record: see the harness README)
  const e = window.__MARINE_ENGINE__, d = e && e._waveData, g = d && (d.waveGrid || d.grid || d);   // the engine keeps it as waveGrid
  let lo = Infinity, hi = -Infinity, over10 = 0;
  for (const v of (g && g.vectors) || []) { const s = v.speed; if (typeof s === 'number' && v.is_valid !== false) { if (s < lo) lo = s; if (s > hi) hi = s; if (s >= 10) over10++; } }
  // The crest colours the GPU compiled: the DRAW program's attached fragment shader, read back (shaders stay attached until dispose).
  const canvas = document.querySelector('canvas.maplibregl-canvas'), gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
  const glsl = gl && e && e.drawProgram ? (gl.getAttachedShaders(e.drawProgram) || []).map((s) => gl.getShaderSource(s)).join('\n') : '';
  const lightCrest = (/else if \(u_theme > 0\.5\) \{[^}]*?calmColor = ([^;]*);[^}]*?activeColor = ([^;]*);[^}]*?stormColor = ([^;]*);[^}]*?foamHighlight = ([^;]*);/.exec(glsl) || []).slice(1);
  return { cols: g && g.cols, rows: g && g.rows, bounds: g && g.bounds, valid: d && d.truthTag && d.truthTag.valid_time, model: g && g.__sourceModel,
    hMin: lo, hMax: hi, cellsAt10m: over10, palette: window.__RAW_DISABLE_WAVE_PALETTE_V2__ ? 'v1' : 'v2', lightCrest, crestContrast: window.__RAW_CREST_CONTRAST__,
    heightScale: d && d.u_heightScale, baseScale: e && e._coarseBaseData ? e._coarseBaseData.u_heightScale : null,
    waveTexHash: (d && window.__TEX__ && window.__TEX__.uploads.get(d.u_waveTexture) || {}).hash || null,
    heightFloatHash: (d && d.u_heightFloatTexture && window.__TEX__ && window.__TEX__.uploads.get(d.u_heightFloatTexture) || {}).hash || null,
    baseHeightFloat: !!(e && e._coarseBaseData && e._coarseBaseData.u_heightFloatTexture),
    glError: (() => { const m = window.__MAP_INSTANCE__ || window.map, gl = m && m.painter && m.painter.context && m.painter.context.gl; return gl ? gl.getError() : null; })() };
};
// TIMING=1 (measurement only): every setWaveData (the whole commit: encode, uploads, mask) and every RED-format upload (the R16F
// height) timed in the page, so the float path's added cost reads against the kill's commits.
const TIMING = () => {
  const T = (window.__HF_TIMING__ = { setWaveData: [], red: [] });
  const P = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
  if (P) for (const k of ['texImage2D', 'texSubImage2D']) {
    const orig = P[k];
    P[k] = function (...a) { if (a[6] !== this.RED) return orig.apply(this, a); const t = performance.now(); try { return orig.apply(this, a); } finally { T.red.push([k, a[k === 'texImage2D' ? 3 : 4], a[k === 'texImage2D' ? 4 : 5], +(performance.now() - t).toFixed(3)]); } };
  }
  setInterval(() => {
    const e = window.__MARINE_ENGINE__;
    if (!e || e.__hfTimed) return;
    const orig = e.setWaveData.bind(e);
    e.setWaveData = function (...a) { const t = performance.now(); try { return orig(...a); } finally { T.setWaveData.push(+(performance.now() - t).toFixed(2)); } };
    e.__hfTimed = true;
  }, 200);
};
const particles = (page, on) => page.evaluate((on) => { window.__MARINE_ENGINE__._fboSupported = on; }, on);   // instrument only

async function legendBox(page) {
  return page.evaluate(() => {
    const label = [...document.querySelectorAll('div,span')].find((n) => /^Combined Waves/.test(n.textContent || '') && n.children.length === 0);
    if (!label) return null;
    const r = label.parentElement.getBoundingClientRect();
    return { x: Math.max(0, Math.floor(r.x) - 4), y: Math.max(0, Math.floor(r.y) - 4), width: Math.ceil(r.width) + 8, height: Math.ceil(r.height) + 8 };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const record = { at: new Date().toISOString(), port: PORT, views: VIEWS, shots: [], water: {} };
  for (const theme of themes) {
    for (const v of variants) {
      const { browser, page, log } = await L.launch({ port: PORT, hashTextureUploads: true });
      try {
        await page.addInitScript(({ theme, levers }) => { localStorage.setItem('raw-surf-theme', theme); Object.assign(window, levers); }, { theme, levers: LEVERS[v] });
        if (process.env.TIMING === '1') await page.addInitScript(TIMING);
        await L.openMap(page);
        // The bare water before Waves is on: the colour the checker composites over (wave-lib.mjs BASEMAP).
        await L.jump(page, ...VIEWS.regional); await sleep(5000);
        const box = await page.evaluate(() => { const r = (window.__MAP_INSTANCE__ || window.map).getContainer().getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
        const bare = decodePng(await page.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h } }));
        const px = (x, y) => { const p = (y * bare.width + x) * bare.bpp; return [bare.data[p], bare.data[p + 1], bare.data[p + 2]]; };
        record.water[`${theme}/${v}`] = [[0.2, 0.75], [0.5, 0.8], [0.3, 0.9]].map(([fx, fy]) => px(Math.round(box.w * fx), Math.round(box.h * fy)));
        await L.clickText(page, 'Waves'); await sleep(9000);
        for (const view of views) {
          await L.jump(page, ...VIEWS[view]); await sleep(view === 'world' ? 9000 : 11000);
          const file = `${theme}-${view}-${v}.png`;
          await page.screenshot({ path: path.join(OUT, file) });
          const lb = await legendBox(page);
          if (lb) await page.screenshot({ path: path.join(OUT, `${theme}-${view}-${v}-legend.png`), clip: lb });
          record.shots.push({ theme, variant: v, view, file, legend: lb ? `${theme}-${view}-${v}-legend.png` : null, engine: await page.evaluate(drawn) });
          console.log(theme, v, view, JSON.stringify(record.shots[record.shots.length - 1].engine));
          if (process.env.WASH === '1') {   // the same camera and hour, crests off: the wash alone, for a pixel-for-pixel comparison
            await particles(page, false); await sleep(1500);
            await page.screenshot({ path: path.join(OUT, `${theme}-${view}-${v}-wash.png`) });
            await particles(page, true); await sleep(500);
          }
        }
        if (process.env.CRESTS === '1') {   // crest statistics at a fixed hour: one crest-free frame, then a burst with crests
          await L.jump(page, ...VIEWS.regional); await sleep(9000);
          await particles(page, false); await sleep(1500);
          await page.screenshot({ path: path.join(OUT, `crest-${theme}-${v}-wash.png`) });
          await particles(page, true); await sleep(2500);
          for (let k = 0; k < CREST_FRAMES; k++) { await page.screenshot({ path: path.join(OUT, `crest-${theme}-${v}-${String(k).padStart(3, '0')}.png`) }); await sleep(150); }
          record.shots.push({ theme, variant: v, view: 'crest-burst', engine: await page.evaluate(drawn) });
        }
        if (process.env.CLIP === '1') for (const cv of CLIP_VIEWS) {   // the moving clip: the forecast stepped +1 h every 5 frames while the crests run
          await L.jump(page, ...VIEWS[cv]); await sleep(cv === 'regional' ? 9000 : 11000);
          await page.evaluate(() => document.querySelector('[role="slider"][aria-label*="Forecast timeline"]').focus());
          const clip = { x: Math.round(box.x + box.w * 0.2), y: Math.round(box.y + box.h * 0.15), width: Math.round(box.w * 0.6), height: Math.round(box.h * 0.7) };
          const tag = cv === 'regional' ? v : `${v}@${cv}`;
          for (let k = 0; k < CLIP_FRAMES; k++) {
            if (k && k % 5 === 0) await page.keyboard.press('ArrowRight');
            await page.screenshot({ path: path.join(OUT, `clip-${theme}-${tag}-${String(k).padStart(3, '0')}.png`), clip });
            if (process.env.PAIRED === '1') {   // the same instant without crests: three frames drawn with the crest pass off
              await page.evaluate(() => new Promise((r) => {
                window.__MARINE_ENGINE__._fboSupported = false; (window.__MAP_INSTANCE__ || window.map).triggerRepaint();
                requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)));
              }));
              await page.screenshot({ path: path.join(OUT, `clipw-${theme}-${tag}-${String(k).padStart(3, '0')}.png`), clip });
              await page.evaluate(() => { window.__MARINE_ENGINE__._fboSupported = true; (window.__MAP_INSTANCE__ || window.map).triggerRepaint(); });
            }
            await sleep(120);
          }
        }
        if (process.env.TIMING === '1') record[`timing/${theme}/${v}`] = await page.evaluate(() => window.__HF_TIMING__);
        record[`log/${theme}/${v}`] = { errors: log.errors.slice(0, 5), blockedWs: log.blockedWs.length, hosts: log.hosts, weatherRequests: log.requests.length };
      } finally { await browser.close(); }
    }
  }
  fs.writeFileSync(path.join(OUT, 'record.json'), JSON.stringify(record, null, 1));
  console.log('wrote', OUT);
})();

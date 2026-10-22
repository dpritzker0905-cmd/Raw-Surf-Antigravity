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
// Light crest restore (2026-10-21, D-041): the original light crest is the default again, so v2 and l1 now draw the same light crests;
// lv2 asks for light crest V2 (window.__RAW_LIGHT_CREST_V2__) for an A/B against it; lt draws the original with the luminance-only
// two-tone (window.__RAW_LIGHT_CREST_STYLE__ = 'twotone', marineLightCrestStyle.js).
// Per shot it records what the engine held (grid shape, bounds, valid time, the drawn grid's height range) so the panes can be
// shown to be the same data; and, before Waves is switched on, the bare water's colour (the checker's basemap model).
// THE 16 m ENCODING (2026-10-20): VARIANTS=v2@10,v2,v2@10b  THEMES=light,beach,dark  --vortex-peak 14 (the eye passes 10 m, under 16).
// v2@10 is the 16 m kill (window.__RAW_DISABLE_WAVE_HEIGHT_16M__, #411 exactly); v2@10b the same lever again and v2b the default
// again: the null controls (crest coverage breathes with the wave sets, so a run-to-run spread is the only fair yardstick).
// Each shot also records the scale the resident and coarse uploads carry and the FNV hash of the resident wave texture's bytes;
// WASH=1 adds a crest-free shot of each view (the engine's own heatmap-only fallback, _fboSupported = false, set from the page);
// CRESTS=1 adds a burst at the regional view (one crest-free frame, then CREST_FRAMES with crests) for wave_crest_stats.py.
const fs = require('fs');
const path = require('path');
const L = require('./ab_lib.js');
const { decodePng } = require(path.join(__dirname, '../../e2e/pngPixels.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = +(process.env.PORT || 4120);
const OUT = process.env.OUT || path.join(process.cwd(), 'wave-ab');
const LEVERS = { v1: { __RAW_DISABLE_WAVE_PALETTE_V2__: true }, v2: {}, 'v2@10': { __RAW_DISABLE_WAVE_HEIGHT_16M__: true }, 'v2@10b': { __RAW_DISABLE_WAVE_HEIGHT_16M__: true }, v2b: {},
  l1: { __RAW_DISABLE_LIGHT_CREST_V2__: true }, lv2: { __RAW_LIGHT_CREST_V2__: true }, lt: { __RAW_LIGHT_CREST_STYLE__: 'twotone' }, lk: { __RAW_CREST_CONTRAST__: 1 }, l1k: { __RAW_DISABLE_LIGHT_CREST_V2__: true, __RAW_CREST_CONTRAST__: 1 },
  dk: { __RAW_DISABLE_CREST_DENSITY_ZOOM__: true } };   // dk: the crest-density kill (marineCrestDensity.js), against v2 (on)
// The synthetic storm's eye starts at 14N 106W and drifts north-west (serve_synthetic.py vortex_center); the coast is Jalisco/Colima.
const VIEWS = { world: [-118, 10, 2.2], regional: [-106.5, 15.5, 4.6], coastal: [-105.2, 18.4, 7.4],
  mid: [-106.0, 16.5, 5.5], close: [-105.2, 18.4, 9.0], closer: [-105.2, 18.4, 10.5] };   // mid: light's density ramp is full (z5); close: dark's (z8)
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
  const crestStyle = { shapeEdge: (/float shape = 1\.0 - smoothstep\(([^,]*?(?:\?[^,]*?)?), 1\.0, ellipseDist\)/.exec(glsl) || [])[1] || null,
    contrastHead: (/float crestContrastEff = ([^\n]*?)max\(u_crestContrast/.exec(glsl) || [])[1] || '',
    linked: gl && e && e.drawProgram ? gl.getProgramParameter(e.drawProgram, gl.LINK_STATUS) : null };
  const lightCrest = (/else if \(u_theme > 0\.5\) \{[^}]*?calmColor = ([^;]*);[^}]*?activeColor = ([^;]*);[^}]*?stormColor = ([^;]*);[^}]*?foamHighlight = ([^;]*);/.exec(glsl) || []).slice(1);
  return { cols: g && g.cols, rows: g && g.rows, bounds: g && g.bounds, valid: d && d.truthTag && d.truthTag.valid_time, model: g && g.__sourceModel,
    hMin: lo, hMax: hi, cellsAt10m: over10, palette: window.__RAW_DISABLE_WAVE_PALETTE_V2__ ? 'v1' : 'v2', lightCrest, crestContrast: window.__RAW_CREST_CONTRAST__, crestStyle,
    densityCut: /u_densityCut \* smoothstep/.test(glsl), particleDensity: window.__RAW_GPU__ && window.__RAW_GPU__.particleDensity,
    heightScale: d && d.u_heightScale, baseScale: e && e._coarseBaseData ? e._coarseBaseData.u_heightScale : null,
    waveTexHash: (d && window.__TEX__ && window.__TEX__.uploads.get(d.u_waveTexture) || {}).hash || null };
};
const particles = (page, on) => page.evaluate((on) => { window.__MARINE_ENGINE__._fboSupported = on; }, on);   // instrument only
// Dark storm crest (2026-10-20): THEMES=dark VARIANTS=d1,v2 VIEWS=world,regional,eye,coastal CLIP=1 PAIRED=1
// CLIP_VIEWS=regional,eye,coastal over serve_synthetic.py --dynamic 1 --vortex-peak 11. d1 is today's dark crest
// (window.__RAW_DISABLE_DARK_STORM_CREST__), v2 the shipped 8 m+ cased orange (D-039; earlier runs: electric blue, then dc = cased). `eye` is a z 6 view on the storm's eye
// (>= 8 m out to ~3 deg); d1 and eye run only when named. Views shot after a zoom-in keep its regional tile (BLEND BOTH). Each shot's engine
// record carries darkStorm, dark's stormColor line read back from the DRAW program's compiled GLSL. crest_by_height.py reads the clips.
Object.assign(LEVERS, { d1: { __RAW_DISABLE_DARK_STORM_CREST__: true } });
VIEWS.eye = [-108, 15, 6.0];
const darkStorm = () => {
  const e = window.__MARINE_ENGINE__, canvas = document.querySelector('canvas.maplibregl-canvas'), gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
  const glsl = gl && e && e.drawProgram ? (gl.getAttachedShaders(e.drawProgram) || []).map((s) => gl.getShaderSource(s)).join('\n') : '';
  const storm = (/\/\/ Dark Mode[^}]*?stormColor = ([^;]*);/.exec(glsl) || [])[1] || null;
  const casing = (/crestContrastEff = max\(u_crestContrast,\s*([^;]*);/.exec(glsl) || [])[1] || null;   // the cased alternative's term
  return casing && casing.includes('u_theme') ? `${storm} | cased: ${casing}` : storm;
};

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
      const videoDir = process.env.VIDEO === '1' ? path.join(OUT, `video-${theme}-${v}`) : null;
      const { browser, page, log } = await L.launch({ port: PORT, hashTextureUploads: true, video: videoDir });
      // The recording starts with the page (inside launch), not with the browser launch: time the flow from here.
      const t0 = Date.now(), marks = [], mark = (what) => marks.push({ what, t: (Date.now() - t0) / 1000 });
      try {
        await page.addInitScript(({ theme, levers }) => { localStorage.setItem('raw-surf-theme', theme); Object.assign(window, levers); }, { theme, levers: LEVERS[v] });
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
          record.shots.push({ theme, variant: v, view, file, legend: lb ? `${theme}-${view}-${v}-legend.png` : null, engine: { ...await page.evaluate(drawn), darkStorm: await page.evaluate(darkStorm) } });
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
        if (videoDir) {   // the owner's flow, in real time: world, regional, coastal, then the forecast stepped at the coast
          for (const [view, hold] of [['world', 7000], ['regional', 9000], ['coastal', 9000]]) {
            await L.jump(page, ...VIEWS[view]); await sleep(2500); mark(`${view} start`); await sleep(hold); mark(`${view} end`);
          }
          await page.evaluate(() => document.querySelector('[role="slider"][aria-label*="Forecast timeline"]').focus());
          mark('steps start');
          for (let k = 0; k < 4; k++) { await page.keyboard.press('ArrowRight'); await sleep(2500); }
          mark('steps end');
          record[`video/${theme}/${v}`] = { marks, file: path.relative(OUT, (await page.video().path())) };
        }
        record[`log/${theme}/${v}`] = { errors: log.errors.slice(0, 5), blockedWs: log.blockedWs.length, hosts: log.hosts, weatherRequests: log.requests.length };
      } finally { await browser.close(); }
    }
  }
  fs.writeFileSync(path.join(OUT, 'record.json'), JSON.stringify(record, null, 1));
  console.log('wrote', OUT);
})();

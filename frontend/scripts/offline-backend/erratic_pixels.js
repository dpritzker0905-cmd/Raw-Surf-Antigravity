// RENDERED PIXELS for scn_erratic_fuzz.js (2026-10-27): does the colour the marine engine actually drew at a sea point match the
// legend colour for the grid value the engine holds there? Reads the run-s*.json files the fuzzer wrote (pixel windows: a readPixels
// right BEFORE and right AFTER the engine's render at 24 screen points, with the resident grid's bilinear height under each point).
//
// The model (HEATMAP_FS, WebGLMarineShaders.js; marineWavePalette.js is the table, read here from the source the app ships):
//   light (spectrum, D-037): colour = W(h) + lighting, alpha = spectrumAlpha(u_opacity, h)
//   beach (v1, D-035):       colour = mix(depthFloor, W(h), smoothstep(0, 0.18, h)) + lighting, alpha = u_opacity
//   post = colour * alpha + pre * (1 - alpha)   (premultiplied, blendFunc ONE, ONE_MINUS_SRC_ALPHA); lighting = (0.03, 0.05, 0.08)
//   x dir x smoothstep(0.1, 3, h) with the swell's facing dir unknown in 0..1 (the error is taken at the best dir).
// u_opacity is the engine's own __RAW_GPU__.opacity.heatmap at that frame. Dark draws the shader's own ramp (no JS table): judged
// only for "the wash drew nothing" (post == pre at every open-sea point while the engine held a frame).
// Points: open sea only (all four grid neighbours ocean, neighbour spread < 0.6 m, h >= 0.2 m) and the window's resident must be
// the grid the heights were read from. Crests cross a point now and then, so a window is judged by its MEDIAN point.
// Verdict per window: colour error (max channel, 0-255) at the grid height, and the height that would explain the pixel best.
//   node erratic_pixels.js <run dir> [out.json]
const fs = require('fs');
const path = require('path');

const PALETTE_SRC = path.join(__dirname, '..', '..', 'src', 'components', 'map', 'marineWavePalette.js');
function loadPalettes() {
  const src = fs.readFileSync(PALETTE_SRC, 'utf8').replace(/^import [^\n]*$/gm, '').replace(/^export /gm, '');
  // eslint-disable-next-line no-new-func
  return new Function('M_TO_FT', `${src}; return { WAVE_PALETTES, spectrumAlpha };`)(3.28084);
}
const { WAVE_PALETTES, spectrumAlpha } = loadPalettes();
const PAL = { light: WAVE_PALETTES.spectrum, beach: WAVE_PALETTES.v1 };
const FLOOR = { light: [0.12, 0.35, 0.68], beach: [0.015, 0.24, 0.22] };
// basemapFallback.js FALLBACK_PALETTES ocean (the build has no Mapbox token, so the local fallback style draws the basemap)
const OCEAN = { dark: [0x0b, 0x1d, 0x2e], light: [0xcf, 0xe3, 0xf2], beach: [0x9f, 0xd8, 0xe6] };
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function washAt(P, theme, h) {
  const Hs = P.heights; const C = P[theme];
  if (P.over && h >= P.cap) return P.over[theme].map((v) => v / 255);
  const x = Math.max(0, Math.min(P.cap, h));
  for (let i = 0; i < Hs.length - 1; i++) if (x <= Hs[i + 1]) return mix(C[i], C[i + 1], (x - Hs[i]) / (Hs[i + 1] - Hs[i])).map((v) => v / 255);
  return C[C.length - 1].map((v) => v / 255);
}
function predict(theme, h, op, pre, dir) {
  const P = PAL[theme];
  const W = P.spectrum ? washAt(P, theme, h) : mix(FLOOR[theme], washAt(P, theme, h), ss(0, 0.18, h));
  const lit = W.map((v, i) => Math.min(1, v + [0.03, 0.05, 0.08][i] * dir * ss(0.1, 3.0, h)));
  const a = P.spectrum ? spectrumAlpha(op, h) : op;
  return lit.map((v, i) => Math.round((v * a + (pre[i] / 255) * (1 - a)) * 255));
}
const err = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const bestErr = (theme, h, op, pre, post) => Math.min(...[0, 0.5, 1].map((d) => err(predict(theme, h, op, pre, d), post)));
function explain(theme, op, pre, post) {   // the height whose colour explains the pixel best
  let best = { h: null, e: 1e9 };
  for (let h = 0; h <= 16; h += 0.05) { const e = bestErr(theme, h, op, pre, post); if (e < best.e) best = { h: +h.toFixed(2), e }; }
  return best;
}
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

function judgeRun(o) {
  const out = [];
  const byTag = {};
  for (const p of o.pixel || []) (byTag[p.tag] = byTag[p.tag] || []).push(p);
  for (const [tag, frames] of Object.entries(byTag)) {
    const meta = (o.pixelMeta || {})[tag];
    if (!meta) continue;
    for (const f of frames) {
      if (!f.pre || !f.post) continue;
      const sameGrid = meta.gridPid && f.pid === meta.gridPid;
      // a SEA pixel: what lay under the marine pass is the fallback basemap's ocean colour (land is drawn in MapLibre's opaque pass,
      // before the custom layer, so a land pixel's `pre` is the land colour) AND the grid holds an open-sea value there
      const ocean = OCEAN[f.theme];
      const pts = meta.meta.map((m, k) => ({ m, pre: f.pre[k], post: f.post[k] })).filter((x) => x.m.s && Number.isFinite(x.m.s.h) && x.m.s.spread < 0.6 && x.m.s.h >= 0.2
        && ocean && x.pre && err(x.pre, ocean) <= 6);
      const row = { seed: o.seed, tag, t: f.t, theme: f.theme, band: f.band, layer: f.layer, model: f.model, op: f.opacity, sameGrid, blendBoth: meta.blendBoth, zoom: +(meta.zoom || 0).toFixed(2), n: pts.length };
      if (/^b/.test(tag) && meta.bandOffAt != null) row.sinceBandOff = f.t - meta.bandOffAt;
      if (!pts.length) { out.push({ ...row, verdict: 'no_open_sea_points' }); continue; }
      const moved = pts.filter((x) => err(x.pre, x.post) > 3).length;
      row.washDrawnShare = +(moved / pts.length).toFixed(2);
      if (f.theme === 'light' || f.theme === 'beach') {
        // THE OPACITY IS FITTED, not read: the main pass's u_opacity is not the only pass that lays the wash (after a band OFF the
        // honest wash showed at ~0.68 while __RAW_GPU__.opacity.heatmap read 0), so the check judges the COLOUR (height) at the
        // window's best single opacity; the engine's own value is kept beside it (`op`).
        let fit = { a: null, e: 1e9 };
        for (let a = 0.2; a <= 1.0001; a += 0.02) { const e = med(pts.map((x) => bestErr(f.theme, x.m.s.h, a, x.pre, x.post))); if (e < fit.e) fit = { a: +a.toFixed(2), e }; }
        row.fitOpacity = fit.a;
        const A = fit.a;
        const es = pts.map((x) => bestErr(f.theme, x.m.s.h, A, x.pre, x.post));
        const ex = pts.map((x) => explain(f.theme, A, x.pre, x.post));
        row.errMed = med(es); row.errP90 = med(es.slice().sort((a, b) => a - b).slice(Math.floor(es.length * 0.5)));
        // POSITIVE CONTROL: the same pixels judged against a WRONG height (the grid value + 1.5 m, as another hour or model would
        // read) must read far off, or the check has no teeth at this opacity
        row.errWrongMed = med(pts.map((x) => bestErr(f.theme, x.m.s.h + 1.5, A, x.pre, x.post)));
        row.dhMed = +med(pts.map((x, k) => Math.abs(ex[k].h - x.m.s.h))).toFixed(2);
        row.sample = pts.slice(0, 3).map((x, k) => ({ h: x.m.s.h, pre: x.pre, post: x.post, pred: predict(f.theme, x.m.s.h, A, x.pre, 0.5), explainH: ex[k].h }));
        // Judged only where the one-pass model holds: the main pass drawing (op > 0), no BLEND BOTH composite (base wash + regional
        // pass), and z <= 7.5 (closer in, every sample sits near a coast where the shader's shelf / depth terms tint the wash)
        row.verdict = !sameGrid ? 'grid_changed' : (row.washDrawnShare === 0 ? 'wash_drew_nothing' : (f.band ? 'band_on'
          : (f.opacity === 0 ? 'main_pass_hidden' : (row.blendBoth ? 'blend_both_unjudged' : (row.zoom > 7.5 ? 'coastal_zoom_unjudged'
            : (row.errMed <= 12 ? 'ok' : (row.dhMed > 0.5 ? 'colour_mismatch' : 'colour_off_small_dh')))))));
      } else {
        row.verdict = !sameGrid ? 'grid_changed' : (row.washDrawnShare === 0 ? 'dark_wash_drew_nothing' : 'dark_drawn');
      }
      out.push(row);
    }
  }
  return out;
}

if (require.main === module) {
  const dir = process.argv[2];
  const files = fs.readdirSync(dir).filter((f) => /^(run|replay)-s\d+.*\.json$/.test(f));
  const rows = [];
  for (const f of files) { const o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); rows.push(...judgeRun(o).map((r) => ({ file: f, ...r }))); }
  const tally = {}; for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
  console.log(JSON.stringify({ windows: rows.length, tally }, null, 1));
  for (const r of rows.filter((x) => /mismatch|nothing|off_small/.test(x.verdict)).slice(0, 30)) console.log(JSON.stringify(r).slice(0, 600));
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify({ tally, rows }, null, 1));
}
module.exports = { judgeRun, predict, explain };

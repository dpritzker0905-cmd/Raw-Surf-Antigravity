// WAVE-HEIGHT WASH MODEL: what the marine engine DRAWS for the light and beach wave-height wash, as numbers, so the wave
// checker (wave-check.mjs) and the candidate solver (wave-solve.mjs) read the same picture.
//
// The engine (keep in sync):
//  - HEATMAP_FS (WebGLMarineShaders.js): finalColor = mix(depthFloor, W(h), smoothstep(0, 0.18, h)) + vec3(0.03, 0.05, 0.08) *
//    directional * smoothstep(0.1, 3.0, h), where W is marineWaveHeightColor (marineWavePalette.js, the table this file reads)
//    and directional (0..1) is the swell's facing toward a north-west light. Output premultiplied: vec4(finalColor * a, a).
//  - WebGLMarineEngine.js: blendFunc(ONE, ONE_MINUS_SRC_ALPHA); a = heatmapZoomOpacity(z) (marineEngineDecisions.js): 0.65 at
//    z <= 3, 0.75 at z 8, 0.80 at z 13 (times coarseFade 0.7-1 on a coarse world grid).
//  - The marine rasters sit on the style's `water` layer and UNDER `land` (basemapFallback.js, findMarineInsertionLayer): the
//    wash only ever composites over the water colour; the land is drawn over it, so land vs sea = land colour vs the composite.
//  - Crests (WebGLMarineParticleShaders.js DRAW_FS): base = mix(calm, active, 2e) / mix(active, storm, 2e - 1) with
//    e = smoothstep(0, 6, h), white mixed in by whitecapRoll * 0.45, laid premultiplied at min(alpha * mix(1.2, 1.8, e), 0.85).
//
// Basemap colours: READ from the real Mapbox styles as the app draws them (navigation-day for light, outdoors for beach), by the
// offline A/B harness (scn_wave_palette_ab.js) with Waves still off, at regional zoom (4.6), 2026-10-20. Unmuted: the wind's
// basemap mute (windBasemapMute.js) runs only while the WIND layer is on, and the heatmap layers are exclusive. NOT the
// windFieldLut.test.js SURFACES ([168, 214, 222] / [150, 190, 200] water): the first cut of this model used those and the water
// on screen was (144, 223, 254) / (117, 207, 240), so its candidates were solved over the wrong ground (re-solved the same day).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dec, enc, labOf, lchOf, de2000, simLab, KINDS } from './light-path-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PALETTE_SRC = path.join(HERE, '..', '..', 'src', 'components', 'map', 'marineWavePalette.js');

export const BASEMAP = {
  light: { water: [144, 223, 254], land: [255, 255, 255], panel: [255, 255, 255] },   // panel: MapWeatherControls bgClass bg-white/95
  beach: { water: [117, 207, 240], land: [237, 232, 226], panel: [13, 13, 13] },      // panel: bg-black/90 (the map shows 10% through)
};
/** Wash alpha by view: heatmapZoomOpacity at world (z 2-3), regional (z 5.5) and coastal (z 10) zoom. */
export const ALPHAS = { world: 0.65, regional: 0.70, coastal: 0.77 };
const LIGHTING = [0.03, 0.05, 0.08];
/** The shader's depth floor under the first 0.18 m (deep ocean, no chlorophyll): what flat water shows instead of the table. */
export const DEPTH_FLOOR = { light: [0.12, 0.35, 0.68], beach: [0.015, 0.24, 0.22] };
const CREST = {   // calm, active, storm, foam (DRAW_FS)
  light: [[0.05, 0.15, 0.45], [0.85, 0.50, 0.00], [0.75, 0.10, 0.05], [1, 1, 1]],
  beach: [[1.00, 0.45, 0.65], [0.00, 0.92, 0.85], [0.80, 0.20, 0.90], [0.95, 0.95, 1.00]],
};

export const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (c) => c.map((v) => Math.min(1, Math.max(0, v)));

/** The palette module's tables, read from the source the app ships (export keywords stripped; its one import, heightUnits.js's
 *  M_TO_FT, handed in). Evaluated with no window, so it resolves the default palette. */
export function loadPalettes(file = PALETTE_SRC) {
  const src = fs.readFileSync(file, 'utf8').replace(/^import [^\n]*$/gm, '').replace(/^export /gm, '');
  return new Function('M_TO_FT', `${src}; return { WAVE_PALETTES, widenWavePalette, resolveWavePalette, sampleMarineWavePalette, marineWavePaletteGlsl, MARINE_WAVE_PALETTE_GLSL, marineWaveLegend };`)(3.28084);
}

/** The wash table's colour at height h (0-1, unrounded): the same law as the GLSL table (linear in encoded sRGB per segment). */
export function washAt(P, theme, h) {
  const H = P.heights, C = P[theme];
  if (P.over && h > P.cap) return P.over[theme].map((v) => v / 255);
  const x = Math.max(0, Math.min(P.cap, h));
  for (let i = 0; i < H.length - 1; i++) if (x <= H[i + 1]) return mix(C[i], C[i + 1], (x - H[i]) / (H[i + 1] - H[i])).map((v) => v / 255);
  return C[C.length - 1].map((v) => v / 255);
}

/** What one wash pixel looks like on screen over the water: alpha a, swell lighting `dir` (0..1). Under 0.18 m the shader blends from
 *  its depth floor; `floor: false` reads the table's own colour there instead (a LEGEND STOP as composited: the 0 m stop is the
 *  table's calm, not the flat-water floor, which is the shader's and is reported on its own line). */
export function composite(P, theme, h, a, dir = 0.5, floor = true, waterRGB = null) {   // waterRGB (0-255): another ground (wave-jacobian.mjs)
  const W = floor ? mix(DEPTH_FLOOR[theme], washAt(P, theme, h), ss(0, 0.18, h)) : washAt(P, theme, h);
  const lit = W.map((v, i) => v + LIGHTING[i] * dir * ss(0.1, 3.0, h));
  const water = (waterRGB || BASEMAP[theme].water).map((v) => v / 255);
  return clamp01(clamp01(lit).map((v, i) => v * a + water[i] * (1 - a)));
}

/** A crest's core over the wash composite (DRAW_FS colours; laid at 0.85, the alpha cap a crest's core reaches). `whitecap` 0..1 is
 *  the share of the whitecap the shader ALLOWS at this height (DRAW_VS v_whitecap = smoothstep(0.5, 3.0, h), its roll mixed in at 0.45). */
export function crestOver(theme, h, under, whitecap = 0) {
  const [calm, active, storm, foam] = CREST[theme], e = ss(0, 6, h);
  const base = e < 0.5 ? mix(calm, active, e * 2) : mix(active, storm, (e - 0.5) * 2);
  const c = mix(base, foam, whitecap * ss(0.5, 3.0, h) * 0.45), a = 0.85;
  return clamp01(c.map((v, i) => v * a + under[i] * (1 - a)));
}

// OKLab (Ottosson 2020) lightness and chroma of an encoded sRGB colour.
export function oklab(rgb) {
  const [r, g, b] = rgb.map(dec);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
}

/** APCA-W3 0.0.98G-4g Lc of `txt` over `bg` (encoded sRGB 0-1); the same formula Leonardo's wcag3 contrast reports. */
export function apcaLc(txt, bg) {
  const Y = (c) => { const [r, g, b] = c.map((v) => Math.pow(v, 2.4)); const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b; return y > 0.022 ? y : y + Math.pow(0.022 - y, 1.414); };
  const yt = Y(txt), yb = Y(bg);
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) { const s = (Math.pow(yb, 0.56) - Math.pow(yt, 0.57)) * 1.14; return s < 0.1 ? 0 : (s - 0.027) * 100; }
  const s = (Math.pow(yb, 0.65) - Math.pow(yt, 0.62)) * 1.14; return s > -0.1 ? 0 : (s + 0.027) * 100;
}

export const dE = (a, b) => de2000(labOf(a), labOf(b));
/** Normal vision and the three dichromats (coloraide's models, ported in light-path-lib.mjs): the weakest of the four. */
export function allDE(a, b) {
  let w = { de: dE(a, b), kind: 'normal' };
  for (const kind of KINDS) { const d = de2000(simLab(a, kind), simLab(b, kind)); if (d < w.de) w = { de: d, kind }; }
  return w;
}
export const chromaStar = (rgb) => lchOf(rgb).C;
export { enc, dec, labOf, lchOf };

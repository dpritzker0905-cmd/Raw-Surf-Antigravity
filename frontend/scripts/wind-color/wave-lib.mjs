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
//    Light's colours (and its foam) are READ from marineCrestPalette.js (LIGHT_CRESTS, the table the shader is built from); beach's
//    are the shader's literals, copied below (BEACH_V1). Below 1.05 m (any zoom) and in the z 3-4.9 band the engine adds SELF-CONTRAST (u_lowHCrestContrast, u_crestContrast):
//    the colour x mix(0.55, 1.30, core) plus the foam x core x 0.18 (`sc` in crestOver).
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
export const CREST_SRC = path.join(HERE, '..', '..', 'src', 'components', 'map', 'marineCrestPalette.js');

export const BASEMAP = {
  light: { water: [144, 223, 254], land: [255, 255, 255], panel: [255, 255, 255] },   // panel: MapWeatherControls bgClass bg-white/95
  beach: { water: [117, 207, 240], land: [237, 232, 226], panel: [13, 13, 13] },      // panel: bg-black/90 (the map shows 10% through)
};
/** Wash alpha by view: heatmapZoomOpacity at world (z 2-3), regional (z 5.5) and coastal (z 10) zoom. */
export const ALPHAS = { world: 0.65, regional: 0.70, coastal: 0.77 };
const LIGHTING = [0.03, 0.05, 0.08];
/** The shader's depth floor under the first 0.18 m (deep ocean, no chlorophyll): what flat water shows instead of the table. */
export const DEPTH_FLOOR = { light: [0.12, 0.35, 0.68], beach: [0.015, 0.24, 0.22] };
/** The beach crest tables the app ships (marineCrestPalette.js, export keywords and its one import stripped). */
export function loadCrests(file = CREST_SRC) {
  const src = fs.readFileSync(file, 'utf8').replace(/^import [^\n]*$/gm, '').replace(/^export /gm, '');
  return new Function('MARINE_WAVE_PALETTE_ENABLED', 'MARINE_WAVE_PALETTE_IDS',
    `${src}; return { LIGHT_CRESTS, resolveLightCrest, lightCrestGlsl };`)(true, { light: 'v2', beach: 'v1' });
}
const BEACH_FOAM = [0.95, 0.95, 1.00], LIGHT_FOAM = [1.00, 1.00, 1.00];   // DRAW_FS foamHighlight per theme
/** One crest table [calm, active, storm, foam, polarity] (DRAW_FS order) from a BEACH_CRESTS / LIGHT_CRESTS entry ({ calm: { rgb,
 *  above }, ... }). polarity (optional): { h, calm, active, foam? }, the colours a crest takes at and above h metres (DRAW_FS
 *  `mix(below, above, step(h, v_wave_height))`); below h it takes calm.rgb, active.rgb and the foam. */
// A table's own `foam` ({ rgb, above? }) replaces the theme's foamHighlight; with `above`, the foam switches with the crest.
const crestTable = (t, foam) => [t.calm.rgb, t.active.rgb, t.storm.rgb, t.foam ? t.foam.rgb : foam,
  t.switchHeight ? { h: t.switchHeight, calm: t.calm.above, active: t.active.above, foam: t.foam && t.foam.above } : undefined];
export const beachCrest = (t) => crestTable(t, BEACH_FOAM);
export const lightCrest = (t) => crestTable(t, LIGHT_FOAM);
const TABLES = loadCrests();
// Beach's crest is DRAW_FS's literals (beach's colours are the owner's to change, D-035): orchid-pink, electric turquoise, sunset magenta.
const BEACH_V1 = { calm: { rgb: [1.00, 0.45, 0.65] }, active: { rgb: [0.00, 0.92, 0.85] }, storm: { rgb: [0.80, 0.20, 0.90] } };
export const CRESTS = { v1: beachCrest(BEACH_V1) };
export const LIGHT_CRESTS = Object.fromEntries(Object.entries(TABLES.LIGHT_CRESTS).map(([id, t]) => [id, lightCrest(t)]));
/** Each theme's crest tables by id ({ beach: CRESTS, light: LIGHT_CRESTS }). */
export const CRESTS_BY_THEME = { beach: CRESTS, light: LIGHT_CRESTS };
/** Which crests the app draws over a wash palette: v1 over the v1 wash (V2 stands down there), V2 over v2 (when the theme has one). */
export const crestFor = (paletteId, theme = 'beach') => (paletteId === 'v1' || !CRESTS_BY_THEME[theme].v2 ? 'v1'
  : paletteId === 'spectrum' && CRESTS_BY_THEME[theme].v2s ? 'v2s' : 'v2');   // light's spectrum draws V2's colours switching at 2.35 m (D-037)
const CREST = { light: LIGHT_CRESTS[crestFor('v2', 'light')], beach: CRESTS.v1 };   // what each theme draws over its wash

export const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (c) => c.map((v) => Math.min(1, Math.max(0, v)));

/** The palette module's tables, read from the source the app ships (export keywords stripped; its one import, heightUnits.js's
 *  M_TO_FT, handed in). Evaluated with no window, so it resolves the default palette. */
export function loadPalettes(file = PALETTE_SRC) {
  const src = fs.readFileSync(file, 'utf8').replace(/^import [^\n]*$/gm, '').replace(/^export /gm, '');
  return new Function('M_TO_FT', `${src}; return { WAVE_PALETTES, widenWavePalette, resolveWavePalette, sampleMarineWavePalette, marineWavePaletteGlsl, MARINE_WAVE_PALETTE_GLSL, marineWaveLegend, spectrumAlpha };`)(3.28084);
}

const SPECTRUM_ALPHA = loadPalettes().spectrumAlpha;   // the spectrum's opacity law, read from the module the shader is built from

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
  if (P.spectrum) {   // the light spectrum (D-037): no sea-floor blend; opacity rises with height and fades out under 0.5 m (marineWavePalette.js)
    const As = SPECTRUM_ALPHA(a, h), Ws = washAt(P, theme, h), wat = (waterRGB || BASEMAP[theme].water).map((v) => v / 255);
    return clamp01(clamp01(Ws.map((v, i) => v + LIGHTING[i] * dir * ss(0.1, 3.0, h))).map((v, i) => v * As + wat[i] * (1 - As)));
  }
  const W = floor ? mix(DEPTH_FLOOR[theme], washAt(P, theme, h), ss(0, 0.18, h)) : washAt(P, theme, h);
  const lit = W.map((v, i) => v + LIGHTING[i] * dir * ss(0.1, 3.0, h));
  const water = (waterRGB || BASEMAP[theme].water).map((v) => v / 255);
  return clamp01(clamp01(lit).map((v, i) => v * a + water[i] * (1 - a)));
}

/** A crest's core over the wash composite (DRAW_FS colours; laid at 0.85, the alpha cap a crest's core reaches). `whitecap` 0..1 is
 *  the share of the whitecap the shader ALLOWS at this height (DRAW_VS v_whitecap = smoothstep(0.5, 3.0, h), its roll mixed in at 0.45).
 *  `sc` (optional): the engine's self-contrast { eff 0..1, core 0..1 }: core 1 is the ribbon's centre (colour x 1.30 + foam x 0.18),
 *  core 0 its skirt (colour x 0.55); `selfContrast(h, zoomBand)` gives the eff the engine uses. Without it: none (eff 0). */
export function crestOver(theme, h, under, whitecap = 0, crest = CREST[theme], sc = null) {   // crest: another [calm, active, storm, foam, polarity?]
  const [c0, a0, storm, f0, pol] = crest, e = ss(0, 6, h), up = pol && h >= pol.h;
  const calm = up ? pol.calm : c0, active = up ? pol.active : a0, foam = up && pol.foam ? pol.foam : f0;
  const base = e < 0.5 ? mix(calm, active, e * 2) : mix(active, storm, (e - 0.5) * 2);
  let c = mix(base, foam, whitecap * ss(0.5, 3.0, h) * 0.45);
  if (sc && sc.eff > 0.001) { const lum = 0.55 + (1.30 - 0.55) * sc.core; c = mix(c, c.map((v, i) => v * lum + foam[i] * sc.core * 0.18), Math.min(1, sc.eff)); }
  const a = 0.85;   // premultiplied: the fragment (colour x alpha) is clamped to [0, 1] before the ONE, ONE_MINUS_SRC_ALPHA blend
  return clamp01(clamp01(c.map((v) => v * a)).map((v, i) => v + under[i] * (1 - a)));
}
/** The self-contrast strength DRAW_FS applies at height h: max(u_crestContrast, u_lowHCrestContrast x (1 - smoothstep(0.75, 1.05, h)))
 *  with the low-height term at its default 1 and the zoom band (WebGLMarineEngine.js, z 3.0-4.9, full at z 3.5-4.4) as `zoomBand`. */
export const selfContrast = (h, zoomBand = 0) => Math.max(zoomBand, 1 - ss(0.75, 1.05, h));

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

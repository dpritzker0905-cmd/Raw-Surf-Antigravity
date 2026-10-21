// LIGHT crest colours: the colours DRAW_FS (WebGLMarineParticleShaders.js) mixes by energy = smoothstep(0, 6, h), calm -> active
// (3 m) -> storm (6 m and up), and the whitecap's foam. Dark's and beach's crests keep their literals in the shader, untouched (beach's
// colours are the owner's to change, D-035).
// v1 (deep navy, amber-gold, crimson red) grows lighter from calm to 3 m while light's v2 wash (D-033, at 16 m by D-034) grows
// darker, so the two pass each other's luminance near 3 m and, at the worst zoom and lighting, stay there to 16 m and on the red
// above-cap flag: core vs wash 16.8 dE00, colour-blind 13.4, APCA |Lc| 0. Solved by frontend/scripts/wind-color/crest-solve.mjs
// --theme light and judged by wave-check.mjs (both read this table).
// Kill, set before page load: window.__RAW_DISABLE_LIGHT_CREST_V2__ = true draws v1 exactly (DRAW_FS hash-pinned in the test).
// V2 also stands down wherever light's wash is neither V2 nor the spectrum (either wash kill): it was solved for those washes.
// Over the spectrum (D-037) the same colours switch at 2.35 m (`v2s`), where the spectrum (re-solved apart from dark, 2026-10-21)
// crosses mid-lightness: the weakest crest-vs-wash APCA |Lc| is 41.7 there (33.0 at v2's 3.05 m; over v2 at 3.05 m: 40.0). Scanned
// every 0.05 m by frontend/scripts/wind-color/crest-switch.mjs (every view, lighting and whitecap). (The first spectrum crossed at 1.55.)
import { MARINE_WAVE_PALETTE_ENABLED, MARINE_WAVE_PALETTE_IDS } from './marineWavePalette';

const WIN = typeof window === 'undefined' ? {} : window;
// Encoded sRGB 0-1, two decimals as the shader writes them; `name` is the shader line's comment. With `switchHeight`, a colour's
// `rgb` draws below that height and its `above` at and above it (DRAW_FS: mix(rgb, above, step(switchHeight, v_wave_height))).
export const LIGHT_CRESTS = {
  v1: {
    calm: { rgb: [0.05, 0.15, 0.45], name: 'deep navy' },
    active: { rgb: [0.85, 0.50, 0.00], name: 'amber-gold' },
    storm: { rgb: [0.75, 0.10, 0.05], name: 'crimson red' },
    foam: { rgb: [1.00, 1.00, 1.00] },
  },
  // V2, warm polarity (the owner's direction for every theme, 2026-10-20; beach's #416 lever): a dark ink where the wash is light and
  // a light one where it is dark, so a crest never meets its wash's luminance: direction of motion is lost at isoluminance (Lindsey &
  // Teller 1990) and a crest is a moving mark. Light's wash passes APCA Y 0.352 at 2.6-3.3 m by zoom and swell lighting; the switch
  // sits at 3.05 m (the best worst case, scanned every 0.01 m). Amber's own family: a deep umber below (hue 50; brown keeps the
  // blue-yellow difference from the blue wash that colour-blind eyes keep, where navy or plum lose it under a whitecap, and stays clear
  // of the red above-cap flag that oxblood would match), cream from 3.05 m, gold storms. The foam switches too: a white whitecap on the
  // dark ink meets the wash's luminance near 3 m (|Lc| 0 on its front), so below the switch the roll front deepens the crest.
  // Over v2 and v2@16, all zooms and lightings, whitecap off and on: |Lc| >= 40.0 (v1 0), colour-blind >= 24.3 (v1 13.4).
  v2: {
    switchHeight: 3.05,
    calm: { rgb: [0.27, 0.10, 0.00], above: [1.00, 1.00, 0.82], name: 'deep umber, cream from 3.05 m' },
    active: { rgb: [0.27, 0.10, 0.00], above: [1.00, 1.00, 0.82], name: 'deep umber, cream from 3.05 m' },
    storm: { rgb: [1.00, 0.96, 0.00], name: 'gold' },
    foam: { rgb: [0.05, 0.02, 0.00], above: [1.00, 1.00, 1.00], name: 'umber-black foam, white from 3.05 m' },
  },
  // V2's colours over the spectrum (D-037): only the switch moves, to where the spectrum crosses mid-lightness.
  v2s: {
    switchHeight: 2.35,
    calm: { rgb: [0.27, 0.10, 0.00], above: [1.00, 1.00, 0.82], name: 'deep umber, cream from 2.35 m' },
    active: { rgb: [0.27, 0.10, 0.00], above: [1.00, 1.00, 0.82], name: 'deep umber, cream from 2.35 m' },
    storm: { rgb: [1.00, 0.96, 0.00], name: 'gold' },
    foam: { rgb: [0.05, 0.02, 0.00], above: [1.00, 1.00, 1.00], name: 'umber-black foam, white from 2.35 m' },
  },
};

export function resolveLightCrest(win = WIN, washOn = MARINE_WAVE_PALETTE_ENABLED, washId = MARINE_WAVE_PALETTE_IDS.light) {
  if (win.__RAW_DISABLE_LIGHT_CREST_V2__ === true || !washOn) return 'v1';
  return washId === 'v2' ? 'v2' : washId === 'spectrum' ? 'v2s' : 'v1';
}
export const LIGHT_CREST_ID = resolveLightCrest();

// One DRAW_FS statement tail per colour, padded to the shader's comment column: v1's are the shader's lines from before V2 byte for
// byte (its foam line has no comment).
const vec = (rgb) => `vec3(${rgb.map((v) => v.toFixed(2)).join(', ')})`;
const line = (key, { rgb, above, name }, sw) => {
  const code = above ? `mix(${vec(rgb)}, ${vec(above)}, step(${sw.toFixed(2)}, v_wave_height));` : `${vec(rgb)};`;
  if (!name) return code;
  const lead = key.length + 8;   // the statement's head before the value: key, "Color", space, equals sign, space
  return `${code}${' '.repeat(Math.max(2, 39 - lead - code.length))}// ${name}`;
};
export const lightCrestGlsl = (id = LIGHT_CREST_ID) => {
  const c = LIGHT_CRESTS[id], sw = c.switchHeight;
  return { calm: line('calm', c.calm, sw), active: line('active', c.active, sw), storm: line('storm', c.storm), foam: line('foam', c.foam, sw) };
};
export const LIGHT_CREST_GLSL = lightCrestGlsl();

// SPECTRUM CREST LIFT (D-037, 2026-10-21; owner: "Make sure the crest zooms are still visible"). DRAW_VS scales every crest's alpha by
// mix(0.45, 1.0, smoothstep(3, 9, zoom)): at world zoom a crest is drawn at about half its close-zoom opacity. Over v2's pale cyan that
// read (engine p99 APCA |Lc| 35.0 at world zoom); over the spectrum's mid-lightness 1.5-3 m blue a half-opaque crest has little room in
// either polarity (23.9). Where light draws V2's crests over the spectrum (`v2s`), the factor starts at `far` instead of 0.45 and
// returns to today's curve by zoom `end`: x mix(far / 0.45, 1, smoothstep(3, end, zoom)). Dark and beach keep today's factor.
// Picked on the engine's zoom ladder (open sea, z 1.6-9, paired exact wash, p99 |Lc| today -> spectrum alone -> with this lift):
// z 2.2 37.1 -> 24.8 -> 41.4, z 3.8 26.0 -> 27.0 -> 49.1, z 4.6 27.5 -> 23.4 -> 40.9, z 6 36.5 -> 22.3 -> 31.9, z 9 52.9 -> 37.9 -> 38.0.
// Far and mid zoom read at least as well as today; close in, the crest is near full opacity and the mid-lightness wash sets the
// limit, and no zoom falls below today's own weakest (26.0 at z 3.8). Far 0.60 / 0.70 and end 5 / 7 measured lower.
// Kill: window.__RAW_DISABLE_SPECTRUM_CREST_LIFT__ = true (DRAW_VS exactly as dev, hash-pinned). A/B levers, numbers, set before load:
// window.__RAW_SPECTRUM_CREST_FAR__ (0.45-1), window.__RAW_SPECTRUM_CREST_END__ (3.5-9).
export const SPECTRUM_CREST_LIFT = { far: 0.80, end: 9.0 };
const num = (v, lo, hi, d) => (typeof v === 'number' && v >= lo && v <= hi ? v : d);
export function resolveSpectrumCrestLift(win = WIN, crestId = LIGHT_CREST_ID) {
  if (crestId !== 'v2s' || win.__RAW_DISABLE_SPECTRUM_CREST_LIFT__ === true) return null;
  return { far: num(win.__RAW_SPECTRUM_CREST_FAR__, 0.45, 1, SPECTRUM_CREST_LIFT.far), end: num(win.__RAW_SPECTRUM_CREST_END__, 3.5, 9, SPECTRUM_CREST_LIFT.end) };
}
const ZOOM_ALPHA = '  float zoomAlphaScale = mix(0.45, 1.0, smoothstep(3.0, 9.0, u_zoom));\n';
export function withSpectrumCrestLift(src, lift = resolveSpectrumCrestLift()) {
  if (src.split(ZOOM_ALPHA).length !== 2 || src.split('void main()').length !== 2) throw new Error('withSpectrumCrestLift: expected one far-zoom alpha line and one main()');
  if (!lift) return src;
  const k = (lift.far / 0.45).toFixed(4);
  return src.replace(ZOOM_ALPHA, `${ZOOM_ALPHA}  if (u_theme > 0.5 && u_theme < 1.5) zoomAlphaScale *= mix(${k}, 1.0, smoothstep(3.0, ${lift.end.toFixed(2)}, u_zoom));   // light over the spectrum (D-037)\n`)
    .replace('void main()', 'uniform mediump float u_theme;   // DRAW_FS\'s (mediump there: a shared uniform keeps one precision)\nvoid main()');
}

// LIGHT and BEACH crest colours: the colours DRAW_FS (WebGLMarineParticleShaders.js) mixes by energy = smoothstep(0, 6, h), calm ->
// active (3 m) -> storm (6 m and up), and the whitecap's foam. Dark's crests keep their literals in the shader, untouched.
// Kills, set before page load: window.__RAW_DISABLE_LIGHT_CREST_V2__ / __RAW_DISABLE_BEACH_CREST_V2__ = true draw that theme's v1
// exactly (DRAW_FS hash-pinned in the tests). Each V2 stands down wherever its theme's wash is not the one it was solved for.
import { MARINE_WAVE_PALETTE_ENABLED, MARINE_WAVE_PALETTE_IDS } from './marineWavePalette';

const WIN = typeof window === 'undefined' ? {} : window;
// Encoded sRGB 0-1, two decimals as the shader writes them; `name` is the shader line's comment. With `switchHeight`, a colour's
// `rgb` draws below that height and its `above` at and above it (DRAW_FS: mix(rgb, above, step(switchHeight, v_wave_height))).

// LIGHT. v1 (deep navy, amber-gold, crimson red) grows lighter from calm to 3 m while light's v2 wash (D-033, at 16 m by D-034) grows
// darker, so the two pass each other's luminance near 3 m and, at the worst zoom and lighting, stay there to 16 m and on the red
// above-cap flag: core vs wash 16.8 dE00, colour-blind 13.4, APCA |Lc| 0. Solved by frontend/scripts/wind-color/crest-solve.mjs
// --theme light and judged by wave-check.mjs (both read this table).
export const LIGHT_CRESTS = {
  v1: {
    calm: { rgb: [0.05, 0.15, 0.45], name: 'deep navy' },
    active: { rgb: [0.85, 0.50, 0.00], name: 'amber-gold' },
    storm: { rgb: [0.75, 0.10, 0.05], name: 'crimson red' },
    foam: { rgb: [1.00, 1.00, 1.00] },
  },
  // V2, warm polarity (the owner's direction for every theme, 2026-10-20; D-036): a dark ink where the wash is light and a light one
  // where it is dark, so a crest never meets its wash's luminance: direction of motion is lost at isoluminance (Lindsey & Teller
  // 1990) and a crest is a moving mark. Light's wash passes APCA Y 0.352 at 2.6-3.3 m by zoom and swell lighting; the switch sits at
  // 3.05 m (the best worst case, scanned every 0.01 m). Amber's own family: a deep umber below (hue 50; brown keeps the blue-yellow
  // difference from the blue wash that colour-blind eyes keep, where navy or plum lose it under a whitecap, and stays clear of the red
  // above-cap flag that oxblood would match), cream from 3.05 m, gold storms. The foam switches too: a white whitecap on the dark ink
  // meets the wash's luminance near 3 m (|Lc| 0 on its front), so below the switch the roll front deepens the crest.
  // Over v2 and v2@16, all zooms and lightings, whitecap off and on: |Lc| >= 40.0 (v1 0), colour-blind >= 24.3 (v1 13.4).
  v2: {
    switchHeight: 3.05,
    calm: { rgb: [0.27, 0.10, 0.00], above: [1.00, 1.00, 0.82], name: 'deep umber, cream from 3.05 m' },
    active: { rgb: [0.27, 0.10, 0.00], above: [1.00, 1.00, 0.82], name: 'deep umber, cream from 3.05 m' },
    storm: { rgb: [1.00, 0.96, 0.00], name: 'gold' },
    foam: { rgb: [0.05, 0.02, 0.00], above: [1.00, 1.00, 1.00], name: 'umber-black foam, white from 3.05 m' },
  },
};

// BEACH. v1 (orchid-pink, electric turquoise, sunset magenta) is what beach draws over its v1 sea (D-035), and stays the default.
// V2 is the warm-polarity crest solved for the sunset candidate sea (marineWavePalette.js WAVE_PALETTES.sunset) by crest-solve.mjs
// and judged by wave-check.mjs; it draws only where beach draws that sea, which only its A/B lever selects
// (window.__RAW_BEACH_WASH__ = 'sunset', owner A/B of PR #416).
export const BEACH_CRESTS = {
  v1: {
    calm: { rgb: [1.00, 0.45, 0.65], name: 'orchid-pink' },
    active: { rgb: [0.00, 0.92, 0.85], name: 'electric turquoise' },
    storm: { rgb: [0.80, 0.20, 0.90], name: 'sunset magenta' },
  },
  // V2, warm polarity: a dark warm ink where the sea is light, a light warm ink where it is dark, switched at 2.1 m, past where the
  // sunset sea's APCA luminance falls through 0.352 (1.5-1.7 m by zoom). Over the sunset sea, every 0.1 m 0.2-10 m, all zooms and
  // swell lightings, whitecap off and on: see marineCrestPalette.test.js and the log for the numbers.
  v2: {
    switchHeight: 2.1,
    calm: { rgb: [0.39, 0.02, 0.02], above: [1.00, 1.00, 0.48], name: 'oxblood, pale lemon from 2.1 m' },
    active: { rgb: [0.33, 0.00, 0.00], above: [0.97, 1.00, 0.09], name: 'oxblood, lemon from 2.1 m' },
    storm: { rgb: [1.00, 0.83, 0.52], name: 'peach' },
  },
};

export function resolveLightCrest(win = WIN, washOn = MARINE_WAVE_PALETTE_ENABLED, washId = MARINE_WAVE_PALETTE_IDS.light) {
  return win.__RAW_DISABLE_LIGHT_CREST_V2__ === true || !washOn || washId !== 'v2' ? 'v1' : 'v2';
}
export const LIGHT_CREST_ID = resolveLightCrest();
/** Beach's V2 only where beach draws the sea it was solved for (the sunset candidate), the wash is on and its kill is not set. */
export function resolveBeachCrest(win = WIN, washOn = MARINE_WAVE_PALETTE_ENABLED, beachSea = MARINE_WAVE_PALETTE_IDS.beach) {
  return win.__RAW_DISABLE_BEACH_CREST_V2__ !== true && washOn && beachSea === 'sunset' ? 'v2' : 'v1';
}
export const BEACH_CREST_ID = resolveBeachCrest();

// One DRAW_FS statement tail per colour, padded to the shader's comment column: each v1 is the shader's lines from before V2 byte
// for byte (light v1's foam line has no comment).
const vec = (rgb) => `vec3(${rgb.map((v) => v.toFixed(2)).join(', ')})`;
const line = (key, { rgb, above, name }, sw) => {
  const code = above ? `mix(${vec(rgb)}, ${vec(above)}, step(${sw.toFixed(2)}, v_wave_height));` : `${vec(rgb)};`;
  if (!name) return code;
  const lead = key.length + 8;   // the statement's head before the value: key, "Color", space, equals sign, space
  return `${code}${' '.repeat(Math.max(2, 39 - lead - code.length))}// ${name}`;
};
const crestGlsl = (c) => {
  const sw = c.switchHeight, out = { calm: line('calm', c.calm, sw), active: line('active', c.active, sw), storm: line('storm', c.storm) };
  if (c.foam) out.foam = line('foam', c.foam, sw);
  return out;
};
export const lightCrestGlsl = (id = LIGHT_CREST_ID) => crestGlsl(LIGHT_CRESTS[id]);
export const beachCrestGlsl = (id = BEACH_CREST_ID) => crestGlsl(BEACH_CRESTS[id]);
export const LIGHT_CREST_GLSL = lightCrestGlsl();
export const BEACH_CREST_GLSL = beachCrestGlsl();

// BEACH crest colours: the colours DRAW_FS (WebGLMarineParticleShaders.js) mixes by energy = smoothstep(0, 6, h),
// calm -> active (3 m) -> storm (6 m and up). Dark's and light's crests keep their literals in the shader, untouched.
// v1 (orchid-pink, electric turquoise, sunset magenta) is what beach draws over its v1 sea (D-035), and stays the default.
// V2 is the warm-polarity crest solved for the sunset candidate sea (marineWavePalette.js WAVE_PALETTES.sunset) by
// frontend/scripts/wind-color/crest-solve.mjs and judged by wave-check.mjs; it draws only where beach draws that sea, which only
// its A/B lever selects (window.__RAW_BEACH_WASH__ = 'sunset', owner A/B of PR #416).
// Kill, set before page load: window.__RAW_DISABLE_BEACH_CREST_V2__ = true draws v1 exactly (DRAW_FS hash-pinned in the test).
import { MARINE_WAVE_PALETTE_ENABLED, MARINE_WAVE_PALETTE_IDS } from './marineWavePalette';

const WIN = typeof window === 'undefined' ? {} : window;
// Encoded sRGB 0-1, two decimals as the shader writes them; `name` is the shader line's comment. With `switchHeight`, calm and
// active take `rgb` below that height and `above` at and above it (DRAW_FS: mix(rgb, above, step(switchHeight, v_wave_height))).
export const BEACH_CRESTS = {
  v1: {
    calm: { rgb: [1.00, 0.45, 0.65], name: 'orchid-pink' },
    active: { rgb: [0.00, 0.92, 0.85], name: 'electric turquoise' },
    storm: { rgb: [0.80, 0.20, 0.90], name: 'sunset magenta' },
  },
  // V2, warm polarity (owner 2026-10-20: polarity's rule in warm colours): a dark warm ink where the sea is light, a light warm
  // ink where it is dark, switched at 2.1 m, past where the sunset sea's APCA luminance falls through 0.352 (1.5-1.7 m by zoom).
  // A crest never matches its sea's brightness: direction of motion is lost at isoluminance (Lindsey & Teller 1990), and a crest
  // is a moving mark. Over the sunset sea, every 0.1 m 0.2-10 m, all zooms and swell lightings, whitecap off and on: see
  // marineCrestPalette.test.js and the log for the numbers.
  v2: {
    switchHeight: 2.1,
    calm: { rgb: [0.39, 0.02, 0.02], above: [1.00, 1.00, 0.48], name: 'oxblood, pale lemon from 2.1 m' },
    active: { rgb: [0.33, 0.00, 0.00], above: [0.97, 1.00, 0.09], name: 'oxblood, lemon from 2.1 m' },
    storm: { rgb: [1.00, 0.83, 0.52], name: 'peach' },
  },
};

/** V2 only where beach draws the sea it was solved for (the sunset candidate), the wash is on and its kill is not set. */
export function resolveBeachCrest(win = WIN, washOn = MARINE_WAVE_PALETTE_ENABLED, beachSea = MARINE_WAVE_PALETTE_IDS.beach) {
  return win.__RAW_DISABLE_BEACH_CREST_V2__ !== true && washOn && beachSea === 'sunset' ? 'v2' : 'v1';
}
export const BEACH_CREST_ID = resolveBeachCrest();

// One DRAW_FS statement tail per colour, padded to the shader's comment column: v1's are the pre-V2 lines byte for byte.
const vec = (rgb) => `vec3(${rgb.map((v) => v.toFixed(2)).join(', ')})`;
const line = (key, { rgb, above, name }, sw) => {
  const code = above ? `mix(${vec(rgb)}, ${vec(above)}, step(${sw.toFixed(2)}, v_wave_height));` : `${vec(rgb)};`;
  const lead = key.length + 8;   // the statement's head before the value: key, "Color", space, equals sign, space
  return `${code}${' '.repeat(Math.max(2, 39 - lead - code.length))}// ${name}`;
};
export const beachCrestGlsl = (id = BEACH_CREST_ID) => {
  const c = BEACH_CRESTS[id];
  return { calm: line('calm', c.calm, c.switchHeight), active: line('active', c.active, c.switchHeight), storm: line('storm', c.storm) };
};
export const BEACH_CREST_GLSL = beachCrestGlsl();

// BEACH crest colours: the colours DRAW_FS (WebGLMarineParticleShaders.js) mixes by energy = smoothstep(0, 6, h),
// calm -> active (3 m) -> storm (6 m and up). Dark's and light's crests keep their literals in the shader, untouched.
// v1 (orchid-pink, electric turquoise, sunset magenta) was laid over the v1 beach wash; on D-033's beach B it greys to a cyan at
// the wash's own brightness (core vs wash 8.6 dE00, colour-blind 1.6, APCA |Lc| 0). V2 is solved for the beach wash it ships
// with (marineWavePalette.js BEACH_WASHES.mid) by frontend/scripts/wind-color/crest-solve.mjs and judged by wave-check.mjs.
// Kill, set before page load: window.__RAW_DISABLE_BEACH_CREST_V2__ = true draws v1 exactly (DRAW_FS hash-pinned in the test).
// V2 also stands down wherever the beach wash is not the one it was solved for (either wash kill, or the B lever of the A/B).
import { MARINE_WAVE_PALETTE_ENABLED, MARINE_WAVE_PALETTE_ID, BEACH_WASH_ID } from './marineWavePalette';

const WIN = typeof window === 'undefined' ? {} : window;
// Encoded sRGB 0-1, two decimals as the shader writes them; `name` is the shader line's comment. With `switchHeight`, calm and
// active take `rgb` below that height and `above` at and above it (DRAW_FS: mix(rgb, above, step(switchHeight, v_wave_height))).
export const BEACH_CRESTS = {
  v1: {
    calm: { rgb: [1.00, 0.45, 0.65], name: 'orchid-pink' },
    active: { rgb: [0.00, 0.92, 0.85], name: 'electric turquoise' },
    storm: { rgb: [0.80, 0.20, 0.90], name: 'sunset magenta' },
  },
  // V2, warm polarity (owner 2026-10-20: polarity's rule in warm colours): a dark warm ink where the wash is light, a light warm
  // ink where it is dark, switched at 2.5 m, past where the mid wash's APCA luminance falls through 0.352. A crest never matches
  // its wash's brightness: direction of motion is lost at isoluminance (Lindsey & Teller 1990), and a crest is a moving mark.
  // Over the mid wash, every 0.1 m 0.2-10 m and above the cap, all zooms and swell lightings, whitecap off and on: see
  // marineCrestPalette.test.js and the log for the numbers.
  v2: {
    switchHeight: 2.5,
    calm: { rgb: [0.40, 0.02, 0.01], above: [0.98, 1.00, 0.30], name: 'oxblood, pale lemon from 2.5 m' },
    active: { rgb: [0.35, 0.01, 0.01], above: [0.97, 1.00, 0.09], name: 'oxblood, lemon from 2.5 m' },
    storm: { rgb: [1.00, 0.83, 0.52], name: 'peach' },
  },
};

export function resolveBeachCrest(win = WIN, washOn = MARINE_WAVE_PALETTE_ENABLED, washId = MARINE_WAVE_PALETTE_ID, beachWash = BEACH_WASH_ID) {
  return win.__RAW_DISABLE_BEACH_CREST_V2__ === true || !washOn || washId === 'v1' || beachWash !== 'mid' ? 'v1' : 'v2';
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

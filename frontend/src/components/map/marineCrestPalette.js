// BEACH crest colours: the colours DRAW_FS (WebGLMarineParticleShaders.js) mixes by energy = smoothstep(0, 6, h),
// calm -> active (3 m) -> storm (6 m and up). Dark's and light's crests keep their literals in the shader, untouched.
// v1 (orchid-pink, electric turquoise, sunset magenta) was laid over the v1 beach wash, warm sand to maroon at 1.2-5 m. The
// wave-palette V2 wash (marineWavePalette.js v2, D-033) is cool there, and v1's crest mix greys to a cyan at the wash's own
// lightness: core vs wash 8.8 dE00, colour-blind 3.4, APCA |Lc| 0. Solved by frontend/scripts/wind-color/crest-solve.mjs and
// judged by wave-check.mjs (both read this table).
// Kill, set before page load: window.__RAW_DISABLE_BEACH_CREST_V2__ = true draws v1 exactly (DRAW_FS hash-pinned in the test).
// V2 also stands down wherever the wash is not V2 (either wash kill): it was solved for that wash.
// Owner A/B (2026-10-20, until a pick): window.__RAW_BEACH_CREST_V2__ = 'warm' draws the warm ramp; the polarity crest is the default.
import { MARINE_WAVE_PALETTE_ENABLED, MARINE_WAVE_PALETTE_ID } from './marineWavePalette';

const WIN = typeof window === 'undefined' ? {} : window;
// Encoded sRGB 0-1, two decimals as the shader writes them; `name` is the shader line's comment. With `switchHeight`, calm and
// active take `rgb` below that height and `above` at and above it (DRAW_FS: mix(rgb, above, step(switchHeight, v_wave_height))).
export const BEACH_CRESTS = {
  v1: {
    calm: { rgb: [1.00, 0.45, 0.65], name: 'orchid-pink' },
    active: { rgb: [0.00, 0.92, 0.85], name: 'electric turquoise' },
    storm: { rgb: [0.80, 0.20, 0.90], name: 'sunset magenta' },
  },
  // V2, polarity (the default): a dark ink where the wash is light, a light one where it is dark. The switch sits where the
  // wash's APCA luminance passes 0.352 (1.8-2.4 m by zoom and swell lighting), so a crest never matches its wash's luminance:
  // direction of motion is lost at isoluminance (Lindsey & Teller 1990) and a crest is a moving mark. Over v2, every 0.05 m
  // 0.2-10 m and above the cap, all zooms and swell lightings, whitecap off and on: core vs wash >= 27.1 dE00 (v1 8.8),
  // colour-blind >= 22.8 (v1 3.4), APCA |Lc| >= 36 (v1 0; 29 on a whitecap's front). Plum is orchid's dark relative; the top
  // reads as foam.
  v2: {
    switchHeight: 2.0,
    calm: { rgb: [0.30, 0.00, 0.26], above: [1.00, 1.00, 0.84], name: 'deep plum, cream from 2 m' },
    active: { rgb: [0.30, 0.00, 0.26], above: [0.95, 1.00, 0.10], name: 'deep plum, lemon from 2 m' },
    storm: { rgb: [1.00, 0.98, 0.92], name: 'foam white' },
  },
  // V2, warm (the A/B's other candidate): warm against the wash's cool middle and lighter as it darkens (CIELAB L* 60 -> 73 -> 97).
  // core vs wash >= 40.3 dE00, colour-blind >= 23.1, but APCA |Lc| 0 near 2 m, the commonest sea: told apart by hue alone there.
  warm: {
    calm: { rgb: [1.00, 0.32, 0.41], name: 'coral-pink' },
    active: { rgb: [1.00, 0.62, 0.00], name: 'tangerine' },
    storm: { rgb: [1.00, 1.00, 0.00], name: 'lemon' },
  },
};

export function resolveBeachCrest(win = WIN, washOn = MARINE_WAVE_PALETTE_ENABLED, washId = MARINE_WAVE_PALETTE_ID) {
  if (win.__RAW_DISABLE_BEACH_CREST_V2__ === true || !washOn || washId === 'v1') return 'v1';
  return win.__RAW_BEACH_CREST_V2__ === 'warm' ? 'warm' : 'v2';
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

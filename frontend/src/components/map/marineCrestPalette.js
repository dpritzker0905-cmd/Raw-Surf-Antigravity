// LIGHT crest colours: the colours DRAW_FS (WebGLMarineParticleShaders.js) mixes by energy = smoothstep(0, 6, h), calm -> active
// (3 m) -> storm (6 m and up), and the whitecap's foam. Beach's crests keep their literals in the shader, untouched (beach's colours
// are the owner's to change, D-035), and so do dark's except its 8 m+ storm ink (DARK_STORM_CRESTS, at the foot of this file).
// v1 (deep navy, amber-gold, crimson red) grows lighter from calm to 3 m while light's v2 wash (D-033, at 16 m by D-034) grows
// darker, so the two pass each other's luminance near 3 m and, at the worst zoom and lighting, stay there to 16 m and on the red
// above-cap flag: core vs wash 16.8 dE00, colour-blind 13.4, APCA |Lc| 0. Solved by frontend/scripts/wind-color/crest-solve.mjs
// --theme light and judged by wave-check.mjs (both read this table).
// Kill, set before page load: window.__RAW_DISABLE_LIGHT_CREST_V2__ = true draws v1 exactly (DRAW_FS hash-pinned in the test).
// V2 also stands down wherever light's wash is not V2 (either wash kill): it was solved for that wash.
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
};

export function resolveLightCrest(win = WIN, washOn = MARINE_WAVE_PALETTE_ENABLED, washId = MARINE_WAVE_PALETTE_IDS.light) {
  return win.__RAW_DISABLE_LIGHT_CREST_V2__ === true || !washOn || washId !== 'v2' ? 'v1' : 'v2';
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

// DARK storm crest (2026-10-20; owner: "fix that one weak point only on the extreme 8m", dark otherwise untouched). DRAW_FS
// (WebGLMarineParticleShaders.js) mixes a crest's colour by energy = smoothstep(0, 6, h), calm -> active (3 m) -> storm (6 m and up).
// Dark's wash runs neon magenta (5 m) to white (10 m+) while its storm crest stays fiery orange, a mid-luminance colour the wash passes
// on the way up: over dark's basemap water (93, 117, 126, measured) the orange core's APCA |Lc| is 0 at every height 8-10 m in the
// weakest view, its whitecap front too, colour-blind 11.2 dE00 (frontend/scripts/wind-color/dark-storm-crest.mjs). Motion needs
// luminance contrast (Lindsey & Teller 1990), so from 8 m the storm crest must sit well below the wash's luminance (DRAW_FS:
// mix(orange, ink, step(8.00, v_wave_height))). The ink is ELECTRIC BLUE, not a dark warm ink: warm hues at that luminance read as
// soot or bruise on the white-pink eye (the owner, 2026-10-21, of ember-black and ember red: "I dont like the darker middle crests in
// the storm animations, improve those"). Blue is the one hue that is fully saturated at low luminance (pure blue's Y is 0.07, and
// saturated colours look brighter than their luminance, Helmholtz-Kohlrausch), so it reads as neon light, in dark's own family (the
// wash's 3 m anchor is electric blue-violet). Body |Lc| 30 (8 m, the z 3.5-4.4 core lift) to 52, colour-blind 31.9 (violet-leaning
// blues fall under |Lc| 30). Below 8 m every dark crest is today's, byte for byte, and so are dark's calm, active and foam lines.
// Read in the real engine by offline-backend/crest_by_height.py.
// Kill, set before page load: window.__RAW_DISABLE_DARK_STORM_CREST__ = true draws today's lines exactly (DRAW_FS hash-pinned in
// marineDarkStormCrest.test.js).
// Owner A/B alternative, window.__RAW_DARK_STORM_CREST__ = 'cased' (2026-10-21, after the owner turned down light's dark crests mixed
// among yellow ones: "not pleasing to the eye as a good representation of waves moving"): no colour switch at all. The storm crest stays
// today's orange and, for dark from 8 m, takes the engine's own crest self-contrast (the z 3.5-4.4 treatment: a rim at 0.55 x the
// colour round a core at 1.30 x plus a little white). The rim gives the luminance step on the white eye; the brighter core does it on
// the darker pink at 8-9 m. One crest family, one look; the switch is in brightness only.
const PLAIN_CASING = 'u_lowHCrestContrast * (1.0 - smoothstep(0.75, 1.05, v_wave_height)));';
export const DARK_STORM_CRESTS = {
  v1: { storm: { rgb: [1.00, 0.40, 0.10], name: 'fiery orange' } },
  v2: { switchHeight: 8.0, storm: { rgb: [1.00, 0.40, 0.10], above: [0.00, 0.00, 1.00], name: 'fiery orange, electric blue from 8 m' } },
  cased: { switchHeight: 8.0, casing: true, storm: { rgb: [1.00, 0.40, 0.10], name: 'fiery orange' } },
};

export function resolveDarkStormCrest(win = WIN) {
  if (win.__RAW_DISABLE_DARK_STORM_CREST__ === true) return 'v1';
  return win.__RAW_DARK_STORM_CREST__ === 'cased' ? 'cased' : 'v2';
}
export const DARK_STORM_CREST_ID = resolveDarkStormCrest();

/** DRAW_FS's dark `stormColor = ...` statement tail, and the tail of the crest self-contrast line (`crestContrastEff`): v1's are today's
 *  lines byte for byte. The casing term is dark-only (u_theme < 0.5) and from switchHeight up. Same line() helper as light's. */
export const darkStormCrestGlsl = (id = DARK_STORM_CREST_ID) => {
  const t = DARK_STORM_CRESTS[id];
  return {
    storm: line('storm', t.storm, t.switchHeight),
    casing: t.casing ? `max(${PLAIN_CASING.slice(0, -2)}, (1.0 - step(0.5, u_theme)) * step(${t.switchHeight.toFixed(2)}, v_wave_height)));` : PLAIN_CASING,
  };
};
export const DARK_STORM_CREST_GLSL = darkStormCrestGlsl();

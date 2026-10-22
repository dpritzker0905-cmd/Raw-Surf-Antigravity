// LIGHT crest colours: the colours DRAW_FS (WebGLMarineParticleShaders.js) mixes by energy = smoothstep(0, 6, h), calm -> active
// (3 m) -> storm (6 m and up), and the whitecap's foam. Beach's crests keep their literals in the shader, untouched (beach's colours
// are the owner's to change, D-035), and so do dark's except its 8 m+ storm ink (DARK_STORM_CRESTS, at the foot of this file).
// v1 (deep navy, amber-gold, crimson red) grows lighter from calm to 3 m while light's v2 wash (D-033, at 16 m by D-034) grows
// darker, so the two pass each other's luminance near 3 m and, at the worst zoom and lighting, stay there to 16 m and on the red
// above-cap flag: core vs wash 16.8 dE00, colour-blind 13.4, APCA |Lc| 0. Solved by frontend/scripts/wind-color/crest-solve.mjs
// --theme light and judged by wave-check.mjs (both read this table).
// RESTORED (owner 2026-10-21 08:02 EDT, on the live dev site: "I do not like the animation colors of light mode, with dark animations
// mixed with yellow ones, its not pleasing to the eye as a good representation of waves moving. The original was better."): v1, the
// original, is the default again, DRAW_FS byte for byte as at dev f6b80f724 (hash-pinned in the test). V2 is drawn only when asked
// for, set before page load: window.__RAW_LIGHT_CREST_V2__ = true (the A/B), or window.__RAW_DISABLE_LIGHT_CREST_RESTORE__ = true
// (the restore's kill: today's V2 default back). window.__RAW_DISABLE_LIGHT_CREST_V2__ = true still forces v1 either way, and V2
// still stands down wherever light's wash is not V2 (either wash kill): it was solved for that wash.
// Over the spectrum (D-037) V2 stays opt-in too: asked for, it switches at 2.35 m (`v2s`), where the spectrum (re-solved apart from
// dark, 2026-10-21) crosses mid-lightness (weakest crest-vs-wash APCA |Lc| 41.7; 33.0 at v2's 3.05 m). By default the spectrum draws
// the original crests, as every light wash does since D-041.
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
  // CROSSES between the original and V2 (owner 2026-10-22, 00:29 EDT: "Light mode I if we acn do a cross between no two-tone and v2 ,
  // would maybe be best?"; his standing rules: subtle, looks like real waves, no hue flip, no two-tone). Each is ONE continuous family:
  // a smooth ramp over `ramp` metres (DRAW_FS smoothstep, never a step), the original's deep navy in small seas, crests that lighten
  // where the wash darkens (V2's lightness: dark ink on light water, light ink on dark water), the whitecap foam dark below the ramp
  // and white above (a white roll front lifts a dark crest to the wash's brightness near 2 m), and #431's far-zoom crest lift (`lift`).
  // A crest that is dark on the calm sea and light on the storm must pass the wash's brightness once; each cross passes it fast, near
  // 2.3-2.7 m, where the wash is blue and the crest warm. Worst APCA |Lc| of the crest's best part, every 0.1 m to 14 m, every zoom,
  // lighting and whitecap, over the spectrum (frontend/scripts/wind-color/light-crest-cross.mjs): heights under 15, colour-blind floor,
  // CIEDE2000 from the original / from V2 (means), largest 0.1 m colour step (V2: 80 at its switch; the original: 4.9):
  //   x1  2.3-2.7 m, 22.5, 30.8 / 31.2, 5.6   the original's warm hues at V2's lightness: amber to light gold, crimson to light coral
  //   x2  2.3-2.8 m, 22.1, 41.2 / 19.0, 4.9   closer to V2: amber to cream, cream-gold storms, the widest ramp
  //   x3  2.0-2.7 m, 13.2, 32.3 / 32.1, 5.1   the lighter anchors alone, no colour ramp
  // The original: 1.2-14 m, 6.8; V2 over the spectrum: none, 11.8, 80 at 2.35 m. Over v2's aqua wash the crosses read alike.
  x1: {
    ramp: [2.0, 2.9], lift: true,
    calm: { rgb: [0.05, 0.15, 0.45], name: 'deep navy' },
    active: { rgb: [0.85, 0.50, 0.00], above: [1.00, 0.82, 0.45], name: 'amber-gold to light gold, 2-2.9 m' },
    storm: { rgb: [1.00, 0.76, 0.66], name: 'light coral' },
    foam: { rgb: [0.10, 0.12, 0.25], above: [1.00, 1.00, 1.00], name: 'navy foam to white, 2-2.9 m' },
  },
  x2: {
    ramp: [1.8, 3.4], lift: true,
    calm: { rgb: [0.05, 0.15, 0.45], name: 'deep navy' },
    active: { rgb: [0.85, 0.50, 0.00], above: [1.00, 0.95, 0.78], name: 'amber-gold to cream, 1.8-3.4 m' },
    storm: { rgb: [1.00, 0.92, 0.70], name: 'cream-gold' },
    foam: { rgb: [0.10, 0.12, 0.25], above: [1.00, 1.00, 1.00], name: 'navy foam to white, 1.8-3.4 m' },
  },
  x3: {
    ramp: [1.6, 2.6], lift: true,
    calm: { rgb: [0.05, 0.15, 0.45], name: 'deep navy' },
    active: { rgb: [1.00, 0.82, 0.45], name: 'light gold' },
    storm: { rgb: [1.00, 0.76, 0.66], name: 'light coral' },
    foam: { rgb: [0.10, 0.12, 0.25], above: [1.00, 1.00, 1.00], name: 'navy foam to white, 1.6-2.6 m' },
  },
};
// The cross light draws by default (the owner's A/B, 2026-10-22; nothing merges before he looks). Others, set before page load:
// window.__RAW_LIGHT_CREST_CROSS__ = 'x2' | 'x3'. Kill: window.__RAW_DISABLE_LIGHT_CREST_CROSS__ = true draws today's light crests
// exactly (the original, D-041; DRAW_FS and DRAW_VS hash-pinned in marineCrestCross.test.js).
export const LIGHT_CREST_CROSS = 'x1';
export const LIGHT_CREST_CROSSES = ['x1', 'x2', 'x3'];

export function resolveLightCrest(win = WIN, washOn = MARINE_WAVE_PALETTE_ENABLED, washId = MARINE_WAVE_PALETTE_IDS.light) {
  const v2Asked = win.__RAW_LIGHT_CREST_V2__ === true || win.__RAW_DISABLE_LIGHT_CREST_RESTORE__ === true;
  if (win.__RAW_DISABLE_LIGHT_CREST_V2__ === true || !washOn || (washId !== 'v2' && washId !== 'spectrum')) return 'v1';
  if (v2Asked) return washId === 'v2' ? 'v2' : 'v2s';   // V2 on request only (D-041); over the spectrum at 2.35 m
  if (win.__RAW_DISABLE_LIGHT_CREST_CROSS__ === true) return 'v1';   // today: the original (D-041)
  const x = win.__RAW_LIGHT_CREST_CROSS__;
  return LIGHT_CREST_CROSSES.includes(x) ? x : LIGHT_CREST_CROSS;
}
export const LIGHT_CREST_ID = resolveLightCrest();

// One DRAW_FS statement tail per colour, padded to the shader's comment column: v1's are the shader's lines from before V2 byte for
// byte (its foam line has no comment).
const vec = (rgb) => `vec3(${rgb.map((v) => v.toFixed(2)).join(', ')})`;
// A colour with `above` mixes into it by a step at the table's `switchHeight` (V2), or smoothly over its `ramp` (the crosses).
const line = (key, { rgb, above, name }, sw, ramp) => {
  const by = ramp ? `smoothstep(${ramp[0].toFixed(2)}, ${ramp[1].toFixed(2)}, v_wave_height)` : above ? `step(${sw.toFixed(2)}, v_wave_height)` : '';
  const code = above ? `mix(${vec(rgb)}, ${vec(above)}, ${by});` : `${vec(rgb)};`;
  if (!name) return code;
  const lead = key.length + 8;   // the statement's head before the value: key, "Color", space, equals sign, space
  return `${code}${' '.repeat(Math.max(2, 39 - lead - code.length))}// ${name}`;
};
export const lightCrestGlsl = (id = LIGHT_CREST_ID) => {
  const c = LIGHT_CRESTS[id], sw = c.switchHeight, r = c.ramp;
  return { calm: line('calm', c.calm, sw, r), active: line('active', c.active, sw, r), storm: line('storm', c.storm), foam: line('foam', c.foam, sw, r) };
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
// Since D-041 (the original crests are light's default again) the lift rides only the V2 opt-in over the spectrum (`v2s`); the default
// draws DRAW_VS exactly as dev. Kill: window.__RAW_DISABLE_SPECTRUM_CREST_LIFT__ = true (DRAW_VS exactly as dev, hash-pinned). A/B levers, numbers, set before load:
// window.__RAW_SPECTRUM_CREST_FAR__ (0.45-1), window.__RAW_SPECTRUM_CREST_END__ (3.5-9).
export const SPECTRUM_CREST_LIFT = { far: 0.80, end: 9.0 };
const num = (v, lo, hi, d) => (typeof v === 'number' && v >= lo && v <= hi ? v : d);
export function resolveSpectrumCrestLift(win = WIN, crestId = LIGHT_CREST_ID) {
  const lifted = crestId === 'v2s' || Boolean(LIGHT_CRESTS[crestId] && LIGHT_CRESTS[crestId].lift);   // V2 over the spectrum, and the crosses
  if (!lifted || win.__RAW_DISABLE_SPECTRUM_CREST_LIFT__ === true) return null;
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

// DARK storm crest (2026-10-20; owner: "fix that one weak point only on the extreme 8m", dark otherwise untouched). DRAW_FS
// (WebGLMarineParticleShaders.js) mixes a crest's colour by energy = smoothstep(0, 6, h), calm -> active (3 m) -> storm (6 m and up).
// Dark's wash runs neon magenta (5 m) to white (10 m+) while its storm crest stays fiery orange, a mid-luminance colour the wash passes
// on the way up: over dark's basemap water (93, 117, 126, measured) the orange core's APCA |Lc| is 0 at every height 8-10 m in the
// weakest view, colour-blind 15.5 dE00 (frontend/scripts/wind-color/dark-storm-crest.mjs). Motion needs luminance contrast (Lindsey &
// Teller 1990). SHIPPED, the owner's pick (DECISIONS D-039, 2026-10-21: "Ship the cased orange from 8 m for dark's storm crests instead
// of electric blue"): CASED ORANGE. The storm crest keeps today's orange (no colour switch, one crest family: the owner had turned down
// light's dark crests mixed among yellow ones, "not pleasing to the eye as a good representation of waves moving"), and for dark from
// 8 m it takes the engine's own crest self-contrast, the z 3.5-4.4 treatment: a rim at 0.55-0.64 x the colour round a core at 1.30 x
// plus a little white. The rim carries the luminance step on the white eye (model |Lc| 20-38 from 8 m; real engine at the eye, p90
// 20-35 against today's 11-27). Turned down on the way: ember-black / ember red (soot on the eye) and electric blue (a colour switch).
// Below 8 m every dark crest is today's, byte for byte; light and beach never take the term (u_theme >= 0.5).
// Kill, set before page load: window.__RAW_DISABLE_DARK_STORM_CREST__ = true draws today's lines exactly (DRAW_FS hash-pinned in
// marineDarkStormCrest.test.js).
const PLAIN_CASING = 'u_lowHCrestContrast * (1.0 - smoothstep(0.75, 1.05, v_wave_height)));';
export const DARK_STORM_CRESTS = {
  v1: { storm: { rgb: [1.00, 0.40, 0.10], name: 'fiery orange' } },
  v2: { switchHeight: 8.0, casing: true, storm: { rgb: [1.00, 0.40, 0.10], name: 'fiery orange' } },
};

export function resolveDarkStormCrest(win = WIN) {
  return win.__RAW_DISABLE_DARK_STORM_CREST__ === true ? 'v1' : 'v2';
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

/**
 * DARK'S WIND LOOK FOR LIGHT GROUNDS. GLOW IS THE DEFAULT IN BEACH (owner, 2026-10-10, after the A/B of today, glow and ink:
 * "I like glow better"; seen live: "Beach mode look a lot better"). LIGHT CAME OFF IT THE SAME DAY: it was light's default for
 * one build, and seen live "light mode washes out from the glow" (owner). A mark that is only ever lighter, on a ground that is
 * already pale, lifts the whole picture and has no dark edge left to bite with; the bench crops did not show that as the app
 * does. Light draws the marks before glow until its own mark is designed. Ink stays a lever.
 * Kill: window.__RAW_DISABLE_WIND_GLOW__ (the marks as they were, in beach too).
 * 20:28Z, the owner again: "I think beach mode too, needs it off glow. Beach mode needs dark mode's science too". BEACH IS OFF IT
 * AS WELL: no theme draws glow by default. Both themes draw the marks before it until dark's look is rebuilt for each theme's
 * own ground and colours (a cloud session, default off, the owner's A/B). The levers below still draw it for a session.
 *
 * Owner: "I like the way dark theme does the animations of the wind, the color, everything. We need the light theme and
 * beach theme's to reflect similarly of this style, but with their own color schemes that fit with their theme colors and
 * map colors properly."
 *
 * WHAT DARK DOES, MEASURED (wind bench map mode, the style columns; Mobile Bay z8, over land):
 *   - every mark pixel is LIGHTER than the field under it (100%), by +10.5 L* at the median and +19.5 at the 90th percentile;
 *   - the marks keep the field's colour: chroma 20.0 -> 20.5, hue within 4 degrees.
 *   A streak is one polarity: a brighter shade of the colour it rides on. Three mechanisms make that: the trail buffer
 *   holds LIGHT and fades to black; a black rim around each mark carves it out of its neighbours (black is "no light");
 *   the composite takes alpha from brightness, so the tail fades to nothing.
 * WHAT LIGHT AND BEACH DO: marks split between lighter and darker than their ground (82-91% lighter), +4.5 / +3.5 L* at
 *   the median, 1% / 0% of mark pixels 15 L* off the ground (dark: 27%), and PALER than the field (chroma 22.5 -> 16.0,
 *   41.0 -> 36.5). A black rim, a white ring and a dark colour core share two or three pixels: thin pale hatching.
 *
 * CANDIDATE 1, INK: the mirror. On a light ground the long way is down, so dark's three mechanisms run in reverse:
 *   - the trail buffer holds INK on white paper and fades toward white (FADE_FS: dark's fade applied to 1 - colour);
 *   - a WHITE rim carves each mark out of its neighbours (white is "no ink"; DRAW_FS);
 *   - the composite MULTIPLIES the map by the buffer (SCREEN_FS + blendFuncSeparate(DST_COLOR, ZERO, ZERO, ONE)): a faded
 *     tail is the untouched map, a mark can only darken (one polarity, always), and the map's own lines keep their
 *     contrast ratio under it, as they do under the field tint.
 *   The ink is the LEGEND's own colour (the particle ramp, unchanged). Calm is cloud white in both ramps, so calm air lays
 *   almost no ink. Where it is strong: land, and every hue that is vivid when dark (violet, blue, green, red, plum). Where
 *   it fails: a darkened yellow is brown, so where marks carpet the water at wide zoom the 27-40 kn band goes olive.
 * CANDIDATE 2, GLOW: dark's own pipeline, unchanged, on the light ground (the field tint leaves 15-35 L* of headroom):
 *   - the premultiplied composite stands down for the theme (WebGLWindUtils.v2SpeedPremul), so the buffer, the fade, the
 *     black carving rim and the white inner ring are dark's;
 *   - the mark's body is the legend colour at full brightness, mixed toward white (a light tint of the same hue);
 *   - ONE change to dark's composite, needed only on a light ground: the buffer's colour is renormalised before it is
 *     laid, and laid at alpha = brightness^2, so a fading tail loses strength by dark's own law and never changes colour.
 *     Dark's own composite lays the faded (darker) colour at alpha = brightness, which a dark map hides and a light map
 *     shows as a grey ghost. (Alpha = brightness, tried first, whited the whole map out: the tails ran twice as long.)
 *   Where it is strong: water, and every hue that is vivid when light (green, yellow, orange). Where it is weak: pale
 *   land under slow wind, where a light mark has little room above the ground.
 *
 * Nothing about the particles' motion changes in either: positions, count, size, lifetime and fade rate are the engine's.
 *
 * Default: glow in no theme. window.__RAW_WIND_GLOW__ = true draws it in light and beach for a session, 'beach' in beach only.
 * Levers: window.__RAW_WIND_INK__  = true (light and beach) | 'light' | 'beach' | 'light,beach';
 *           __RAW_WIND_INK_OPACITY__ (0.1-1), __RAW_WIND_INK_SPINE__ (0-1: a darker inner ring; 0 = pure colour),
 *           __RAW_WIND_INK_PURITY__ (0-1) and __RAW_WIND_INK_DENSITY__ (0.5-4): the ink's colour, see inkOf;
 *         window.__RAW_WIND_GLOW__ = the same forms;
 *           __RAW_WIND_GLOW_OPACITY__ (0.1-1), __RAW_WIND_GLOW_WHITE__ (0-1: how far the body is mixed toward white),
 *           __RAW_WIND_GLOW_RING__ (0-1: the white inner ring; 1 = dark's own).
 *         Ink wins when both are set.
 * Kills:  window.__RAW_DISABLE_WIND_INK__, window.__RAW_DISABLE_WIND_GLOW__. Read at every frame; a change of model
 *         clears the trail buffers once.
 *
 * LIGHT'S LOOK, AN A/B (window.__RAW_WIND_LIGHT_LOOK__, default off; WindColorRamp.js holds the colours and the full comment). Light
 * only, and it wins over the glow and ink levers there. 'moderate' and 'deep' (A) draw dark's streak method over a deeper field, with
 * the streak colours already at full brightness (white 0: the field's own hue, lifted); 'ink' (B) draws ink over today's field with a
 * strength CAP where the marks cover most of the ground: SCREEN_FS reads how much of a ~11 device-px neighbourhood holds ink and eases
 * the ink's strength to `cap` times itself from 40% to 85% cover (GLSL_INK_COVER). Isolated streaks keep their full strength. The cap
 * eases a carpet of them, it does not stop it: at storm strength (z6) the sea ends at L* 42 where the earlier ink took it to 29, and
 * where the marks cover most of the water it still reads as one flat dark sea (log 2026-10-10-light-look-ab). Sub-levers as above (opacity, ring, white, spine) and
 * __RAW_WIND_INK_CAP__ (0.1-1). Kill: window.__RAW_DISABLE_WIND_LIGHT_LOOK__.
 */
import { windLightLook } from './WindColorRamp';

const OFF = Object.freeze({ mode: 0, on: false, glow: false, opacity: 0, spine: 0, purity: 0, density: 1, white: 0 });

// The marks of each light look (bench-tuned, log 2026-10-10-light-look-ab). A: dark's streak method (mode 2) over the deeper field. Map
// bench, offline basemap, z6, served strength, over land: moderate at opacity 1.0 sat on the wash line (the picture ended at L* 71.1 with
// no darker pixel; WASH_BAR, scripts/wind-bench/style.js), at 0.8 it ends at 69.9 with streaks +10.5 L* over the field (dark's band is
// +9.5 to +14.5); deep at 1.0 ends at 65.0 with +13.0. A ring of 0.25 (dark's is 1, beach's 0.35) keeps more of the streak's colour.
export const WIND_LIGHT_LOOK = Object.freeze({
  moderate: Object.freeze({ mode: 2, opacity: 0.8, ring: 0.25, white: 0 }),
  deep: Object.freeze({ mode: 2, opacity: 1.0, ring: 0.25, white: 0 }),
  ink: Object.freeze({ mode: 1, opacity: 0.9, spine: 0, cap: 0.5 }),
});

export const WIND_INK = Object.freeze({
  themes: Object.freeze([]),                                  // default off: the owner picks from the A/B first
  opacity: Object.freeze({ light: 0.9, beach: 0.9 }),
  spine: 0,
  purity: 0,      // 0 = the legend colour as it is; 1 = scaled to a full-transmission ink (its strongest channel passes untouched)
  density: 1,     // Beer-Lambert exponent on that ink: > 1 lays it thicker (deeper and more saturated)
});

export const WIND_GLOW = Object.freeze({
  themes: Object.freeze([]),   // default off again (D-019, amended twice 2026-10-10): light washed out live, and the owner took beach off too
  opacity: Object.freeze({ light: 1.0, beach: 0.9 }),   // calibrated on the bench against dark (log 2026-10-10-dark-style-light-beach)
  // STREAK COLOUR, PER THEME (owner, 2026-10-10: "the wind animations in beach mode could be improved ... perhaps they should have
  // color"; "In dark mode, the wind animations themselves seem like they change color, whereas in light and beach modes, they do
  // not"). White inside a 2-3 px mark is averaged into it by the eye (colour is seen at about a third of the sharpness of
  // lightness), so the white share and the white ring are what a streak's colour pays for its lightness. Bench, z6 over land
  // (step over the field, share of mark pixels lighter, chroma field -> mark):
  //   beach  20% white, ring 0.5: +10.5 L*, 1.00, 40.5 -> 41.5 | no white, ring 0.5: +9.5, 1.00, -> 45.5 | ring 0.25: +8.5, 1.00, -> 50.0
  //   light  20% white, ring 0.5:  +6.0 L*, 0.99, 20.5 -> 23.0 | no white, ring 0.5: +4.0, 0.83, -> 26.0 | ring 0.25: +2.0, 0.76, -> 29.0
  // Beach's hues are vivid when light (seafoam, green, lime, gold), so its streaks drop the white and stay one polarity. Light's
  // low band is lilac, which sRGB cannot make both light and vivid: without the white its marks fall on both sides of the ground
  // and cancel, so light keeps it (log 2026-10-10-dark-style-light-beach, "Streak colour").
  white: Object.freeze({ light: 0.2, beach: 0 }),      // share of white mixed into the full-brightness legend colour
  ring: Object.freeze({ light: 0.5, beach: 0.35 }),    // strength of dark's white inner ring (1 = dark's own, 0 = a pure colour body)
});

// true = both themes, false = none (a session's off switch), a string = that list; anything else is not a setting: the default stands.
const themesOf = (lever, fallback) => (lever === true ? ['light', 'beach'] : (lever === false ? [] : (typeof lever === 'string' ? lever.split(',') : fallback)));
const perTheme = (table, theme) => (theme in table ? table[theme] : table.light);   // a theme the lever names without numbers of its own draws with light's
const inRange = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;

/**
 * Which model draws this theme's marks: { mode: 0 none | 1 ink | 2 glow, on (ink), glow, opacity, spine, purity, density, white }.
 * Never on for dark (dark IS the look), nor while the neutral-body theme (v2) owns the composite.
 */
export function windInk(theme, v2, win = (typeof window !== 'undefined' ? window : null)) {
  const w = win || {};
  if (!v2 || v2.theme || theme === 'dark') return OFF;
  const look = theme === 'light' ? windLightLook(w) : null;
  if (look) return lookMarks(WIND_LIGHT_LOOK[look], w);
  if (w.__RAW_DISABLE_WIND_INK__ !== true && themesOf(w.__RAW_WIND_INK__, WIND_INK.themes).includes(theme)) {
    const op = w.__RAW_WIND_INK_OPACITY__, sp = w.__RAW_WIND_INK_SPINE__, pu = w.__RAW_WIND_INK_PURITY__, de = w.__RAW_WIND_INK_DENSITY__;
    return { mode: 1, on: true, glow: false, white: 0,
      opacity: inRange(op, 0.1, 1) ? op : (WIND_INK.opacity[theme] || 0.9), spine: inRange(sp, 0, 1) ? sp : WIND_INK.spine,
      purity: inRange(pu, 0, 1) ? pu : WIND_INK.purity, density: inRange(de, 0.5, 4) ? de : WIND_INK.density };
  }
  if (w.__RAW_DISABLE_WIND_GLOW__ !== true && themesOf(w.__RAW_WIND_GLOW__, WIND_GLOW.themes).includes(theme)) {
    const op = w.__RAW_WIND_GLOW_OPACITY__, wh = w.__RAW_WIND_GLOW_WHITE__, ri = w.__RAW_WIND_GLOW_RING__;
    return { mode: 2, on: false, glow: true, spine: inRange(ri, 0, 1) ? ri : perTheme(WIND_GLOW.ring, theme), purity: 0, density: 1,
      opacity: inRange(op, 0.1, 1) ? op : (WIND_GLOW.opacity[theme] || 0.6), white: inRange(wh, 0, 1) ? wh : perTheme(WIND_GLOW.white, theme) };
  }
  return OFF;
}

/** A light look's marks, with the glow / ink sub-levers honoured (the bench tunes through them). */
function lookMarks(k, w) {
  if (k.mode === 1) {
    const op = w.__RAW_WIND_INK_OPACITY__, sp = w.__RAW_WIND_INK_SPINE__, cap = w.__RAW_WIND_INK_CAP__;
    return { mode: 1, on: true, glow: false, white: 0, purity: 0, density: 1, opacity: inRange(op, 0.1, 1) ? op : k.opacity,
      spine: inRange(sp, 0, 1) ? sp : k.spine, cap: inRange(cap, 0.1, 1) ? cap : k.cap };
  }
  const op = w.__RAW_WIND_GLOW_OPACITY__, wh = w.__RAW_WIND_GLOW_WHITE__, ri = w.__RAW_WIND_GLOW_RING__;
  return { mode: 2, on: false, glow: true, purity: 0, density: 1, opacity: inRange(op, 0.1, 1) ? op : k.opacity,
    spine: inRange(ri, 0, 1) ? ri : k.ring, white: inRange(wh, 0, 1) ? wh : k.white };
}

/** Clear both trail buffers to "nothing drawn": white paper for ink, transparent black for light (dark, glow, premultiplied). */
export function clearTrails(gl, engine, ink) {
  if (!engine || !engine.screenA || !engine.screenB) return;
  const k = ink ? 1 : 0;
  for (const s of [engine.screenA, engine.screenB]) { gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo); gl.clearColor(k, k, k, k); gl.clear(gl.COLOR_BUFFER_BIT); }
}

/** Tell the program in use which model its trail buffer is in (u_ink: the ink branches and what an empty texel is; u_glow: the composite's). */
export function bindInk(gl, prog, mode) {
  gl.uniform1f(gl.getUniformLocation(prog, 'u_ink'), mode === 1 ? 1 : 0);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_glow'), mode === 2 ? 1 : 0);
}

/**
 * The mark's colour, for DRAW_FS.
 * inkOf: a legend colour used as a filter darkens everything by its own darkness; a CLEAN ink passes its strongest channel
 *   untouched (purity: colour / its largest channel) and is laid thicker by a power (density, Beer-Lambert), so only what
 *   the ink absorbs deepens. Purity costs the green and yellow inks their lightness step (their pass band IS the
 *   luminance), so the default keeps the legend colour as it is.
 * glowOf: the legend colour at full brightness (its strongest channel 1), mixed toward white by u_ink_k.z - 1.
 */
export const GLSL_INK_MARK = `uniform float u_ink;   // 1 = ink marks: a white rim, the legend colour as ink (windInk.js)
uniform vec3 u_ink_k;  // ink: x purity 0-1, y density. z > 0.5: GLOW marks, z - 1 = the share of white in the body
vec3 inkOf(vec3 c) {
  return pow(mix(c, c / max(max(c.r, c.g), max(c.b, 0.001)), u_ink_k.x), vec3(u_ink_k.y));
}
vec3 glowOf(vec3 c) {
  return mix(c / max(max(c.r, c.g), max(c.b, 0.001)), vec3(1.0), u_ink_k.z - 1.0);
}`;

/**
 * Ink's strength cap where its marks cover most of the ground, for SCREEN_FS (after GLSL_TRAIL_UV, whose v_uv and u_trail_d it reads).
 * 16 taps on two rings (5 and 11 device px) round the pixel, through the trail buffer's camera: the share that holds ink (1 - its
 * darkest channel, the one the ink absorbs most, > 0.12; a tap outside the buffer is blank paper, as trailTexel reads it) eases the
 * strength from 1 to u_ink_cap between 40% and 85% cover. u_ink_cap >= 1 (every other model, and the buffer copy) returns 1 before any
 * fetch.
 */
export const GLSL_INK_COVER = `uniform float u_ink_cap;   // < 1: ink's strength where its marks cover most of the ground (windInk.js); 1 = no cap
uniform vec2 u_ink_px;     // one trail-buffer pixel, in uv
float inkCapOf(sampler2D tex) {
  if (u_ink_cap > 0.999) return 1.0;
  TRAIL_HP vec3 q = vec3(v_uv, 1.0) + u_trail_d * vec3(v_uv, 1.0);
  TRAIL_HP vec2 p = q.xy / q.z;
  float n = 0.0;
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 0.3927, r = mod(float(i), 2.0) < 0.5 ? 5.0 : 11.0;
    vec2 o = p + vec2(cos(a), sin(a)) * r * u_ink_px;
    vec3 c = texture2D(tex, o).rgb;
    n += step(0.12, 1.0 - min(c.r, min(c.g, c.b))) * step(0.0, o.x) * step(o.x, 1.0) * step(0.0, o.y) * step(o.y, 1.0);
  }
  return mix(1.0, u_ink_cap, smoothstep(0.4, 0.85, n / 16.0));
}`;

/** GLSL_INK_COVER's ease, for the tests: the strength factor at a cover share (0-1). */
export function inkCapAt(cover, cap) {
  if (!(cap < 0.999)) return 1;
  const t = Math.min(1, Math.max(0, (cover - 0.4) / 0.45)), e = t * t * (3 - 2 * t);
  return 1 + (cap - 1) * e;
}

/** GLSL_INK_MARK's inkOf, for the tests and the lab: [r, g, b] 0-1. */
export function inkOf(c, purity, density) {
  const m = Math.max(c[0], c[1], c[2], 0.001);
  return c.map((v) => Math.pow(v + (v / m - v) * purity, density));
}

/** GLSL_INK_MARK's glowOf: [r, g, b] 0-1, `white` = the share of white. */
export function glowOf(c, white) {
  const m = Math.max(c[0], c[1], c[2], 0.001);
  return c.map((v) => v / m + (1 - v / m) * white);
}

/** FADE_FS's ink branch on one 8-bit level: the ink (255 - level) is faded as dark fades its light, so paper is reached exactly. */
export function inkFadeStep(level, fade) {
  return 255 - Math.floor((255 - level) * fade);
}

/** SCREEN_FS's ink branch plus the multiply blend, per channel (0-1): ground x mix(1, ink, opacity). */
export function inkComposite(ground, ink, opacity) {
  return ground.map((g, i) => g * (1 - opacity * (1 - ink[i])));
}

/**
 * SCREEN_FS's glow branch plus the alpha blend: the buffer's colour at full brightness, laid at alpha = brightness^2 x opacity.
 * The square is dark's own law: dark lays (level x colour) at alpha (level x opacity), so the light it adds falls with level^2.
 */
export function glowComposite(ground, buf, opacity) {
  const b = Math.max(buf[0], buf[1], buf[2]), a = b * b * opacity, n = Math.max(b, 0.004);
  return ground.map((g, i) => g * (1 - a) + (buf[i] / n) * a);
}

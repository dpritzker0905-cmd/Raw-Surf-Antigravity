/**
 * windTrailVeil.js: DARK'S VEIL UNDER LIGHT'S AND BEACH'S TRAILS (2026-10-12; DECISIONS D-028). ON BY DEFAULT wherever the white
 * streak is laid ground by ground. The owner, 2026-10-12 20:13Z, as it was being built behind a default-off lever: "levers to turn on
 * new updates need to be on by default". Kill: window.__RAW_DISABLE_WIND_TRAIL_VEIL__ = true (the picture before it, to the byte).
 * Log: docs/weather-program/log/2026-10-12-wind-trails-linger.md. Bench: scripts/wind-bench/truth-run.js.
 *
 * WHAT WAS MEASURED. With every colour and strength of 2026-10-12 on dev, light's and beach's streak CORES stood as high over the
 * colour field as dark's, and what differed was between the cores: dark's pixels come back to the field after a streak has passed
 * and sit a little UNDER it (the darkest moment of a pixel: 2 L* under the field over the sea from 6 to 18 kn; a fifth of all
 * pixel-instants 1.5 L* or more under), while light's and beach's never went under and, from about 12 kn up, never came back (1.2
 * to 11.4 L* OVER the field at their darkest; three quarters of the picture lit at an instant where dark lights 57%).
 *
 * WHY. The three themes did not lay their trails by the same arithmetic. SCREEN_FS has two branches, and with c the trail buffer's
 * colour, b its strongest channel and g the ground under it, a channel at a time, they are two members of one family:
 *
 *     screen - g  =  p x (b c - b^2 g)  -  q x b (1 - b) g
 *
 *   dark's branch lays the buffer's colour at alpha b x opacity:                       p = q = opacity (0.505 at zoom 6)
 *   the glow branch (light and beach since dark's rules, D-020, rule 1 "light only
 *   adds") lays the colour at full brightness at alpha b^2 x opacity:                  p = opacity (1), q = 0
 *
 * The first term is LIGHT. The second is a VEIL: a black of alpha q b (1 - b), nothing at an empty texel, nothing at a full one,
 * strongest at half strength. A fading tail passes through half strength, so under dark's branch every tail dims the ground on its
 * way out (most at b = g / 2, by opacity x g^2 / 4) and under the glow branch no tail ever does. Read off the screen and the
 * trail buffer together (truth-run.js --law, the sea): dark p 0.505, q 0.505; light and beach p 0.999, q 0.000; each to 0.3 of an
 * 8-bit level. Swapping the branch ALONE on the real engine moved the behaviour with it, both ways; the mark's ring, its light
 * level, the fade, the number of trails and the ground's lightness did not.
 *
 * Rule 1 dropped the veil because a veil's dimming grows with the ground's lightness (g^2), and light's and beach's grounds were
 * pale then (L* 75 and over): a grey ghost behind every streak. Since D-021 and D-026 both draw the wind on grounds near the depth
 * of dark's sea (L* 34 to 57 from 3 to 50 kn, where dark's sea is 32 to 46), which is the ground dark's veil was seen on.
 *
 * WHAT IS DRAWN: the glow branch's light, unchanged, plus dark's veil, measured against the level a streak's CORE is laid at:
 *
 *     screen - g  =  opacity x (b c - b^2 g)  -  veil x b' (1 - b') g          b' = min(1, b / level)
 *
 * `level` is the buffer level of a core (the square root of the white's strength, D-022: 0.742), so the veil is nothing at a full
 * core; `veil` is dark's own opacity at this zoom times the theme's close-zoom factor (and the steer's number, below).
 * No particle is removed, moved or shortened: positions, count, size, lifetime and the buffer's fade are the engine's.
 * WHAT IT COSTS, measured (the log's tables): the veil takes in proportion to the ground, so where light's and beach's ground is
 * lighter than dark's it dips further than dark does (6 to 9 kn over the sea: 2.4 to 3.3 L* under the field where dark is 2.2 to
 * 2.3 under; over land from 6 to 18 kn, 0.5 to 3.2 under where dark, on its near-black land, is 0.2 to 1.2 under); and a streak
 * that has not been laid to its full level is veiled a little at its own core (a typical pixel's lightest moment falls 0.1 to 1.9
 * L* in light and 0.1 to 2.8 in beach, most at 6 to 9 kn; the highest tenth of cores by 0.5 at most).
 *
 * Over LAND the same veil takes more than dark's does from dark's near-black land, so there the streaks add less light than dark's
 * up to 18 kn (light 0.62 to 0.79 of it, beach 0.62 to 0.95, where both added about dark's before): light and beach have ONE
 * ground depth, dark has two, and one strength sits on dark's sea (1, the default) or on dark's land (0.5), not both.
 *
 * Kill: window.__RAW_DISABLE_WIND_TRAIL_VEIL__ = true. Steer (bench and A/B): window.__RAW_WIND_TRAIL_VEIL__ = a number over 0 up
 * to 2 (that multiple of dark's own strength) or false (off for the session). Both are read each frame.
 * IT STANDS DOWN wherever what it rests on is not drawn, so every older kill still draws its old picture:
 *   - where the white streak is not laid ground by ground (D-021, D-022): every kill, hold and bench lever that stands dark's rules
 *     or the white streak down, and D-022's own kill;
 *   - under the land's depth kill (D-026, __RAW_DISABLE_WIND_LAND_DEPTH__): the land is pale again there, and a veil's dimming grows
 *     with the ground squared (the grey ghost rule 1 was written against);
 *   - under the opaque canvas's kill (D-027, __RAW_DISABLE_WIND_OPAQUE_CANVAS__): that kill blends the canvas's ALPHA by the
 *     colour's factors, so a veil's alpha would let light's near-white page through and LIGHTEN the trail it is meant to dim
 *     (the independent review measured +5 to +10 levels where the built blend gives -6 to -15).
 * Dark never reads either (dark IS the law). The kills of light's and beach's paths (D-024, D-025) leave it drawn: they move the
 * field's colours, not the composite, the grounds' depth or the canvas.
 */
import { windWhiteStreakOn, windWhiteStrength } from './WindColorRamp';
import { windKeepsCanvasOpaque } from './windCanvasAlpha';
import { windCloseLandFactor } from './WebGLWindUtils';

export const TRAIL_VEIL = Object.freeze({ kill: '__RAW_DISABLE_WIND_TRAIL_VEIL__', steer: '__RAW_WIND_TRAIL_VEIL__', strength: 1, max: 2 });

/** The veil's strength for this theme as a multiple of dark's own: 1 where the white streak is laid ground by ground, 0 elsewhere and under its kill. */
export function windTrailVeil(theme, win = (typeof window !== 'undefined' ? window : null)) {
  const w = win || {}, v = w[TRAIL_VEIL.steer];
  if (w[TRAIL_VEIL.kill] === true || v === false || !windWhiteStreakOn(theme, w)) return 0;
  // The grounds and the canvas the veil rests on (STANDS DOWN, above): D-022's strengths, the land at the sea's depth, an opaque canvas.
  if (w.__RAW_DISABLE_WIND_DARK_WHITE__ === true || w.__RAW_DISABLE_WIND_LAND_DEPTH__ === true || !windKeepsCanvasOpaque(w)) return 0;
  return typeof v === 'number' && v > 0 && v <= TRAIL_VEIL.max ? v : TRAIL_VEIL.strength;
}

/**
 * SCREEN_FS's u_trail_veil for this frame: [the veil's strength (0 = the glow branch alone), 1 / the buffer level of a core].
 * `glow`: whether this theme's composite runs the glow branch at all; `darkOpacity`: dark's own composite opacity at this zoom.
 * The theme's close-zoom factor (WebGLWindUtils.js windCloseLandFactor) is applied here: the veil eases with the streak it belongs to.
 */
export function trailVeilUniform(theme, glow, darkOpacity, zoom, win = (typeof window !== 'undefined' ? window : null)) {
  const k = glow ? windTrailVeil(theme, win) : 0;
  if (!k) return [0, 1];
  const s = windWhiteStrength(theme, win);
  return [k * darkOpacity * windCloseLandFactor(theme, zoom, win || {}), 1 / Math.sqrt(Math.max(0.01, Math.min(s.land, s.sea)))];
}

/** SCREEN_FS's declarations and the veiled composite. The colour is scaled so the light added is the glow branch's own, to the byte at a core. */
export const GLSL_TRAIL_VEIL = `uniform vec2 u_trail_veil;   // x > 0: the glow branch also lays dark's veil (windTrailVeil.js): x its strength, y 1 / the buffer level of a streak's core
vec4 trailVeilOf(vec3 c, float b, float op) {
  float bn = min(1.0, b * u_trail_veil.y), light = b * b * op, a = light + u_trail_veil.x * bn * (1.0 - bn);
  return vec4(c / max(b, 0.004) * (light / max(a, 0.0001)), a);
}`;

/**
 * trailVeilOf plus the alpha blend, a channel at a time (0 to 1): what the screen shows over `ground` for a buffer texel `buf`.
 * With veil 0 it is windInk.js glowComposite; with veil = opacity and invLevel 1 it is dark's branch (the buffer's colour at alpha
 * b x opacity) for a trail of any colour and strength.
 */
export function trailVeilComposite(ground, buf, opacity, veil, invLevel) {
  const b = Math.max(buf[0], buf[1], buf[2]), bn = Math.min(1, b * invLevel), light = b * b * opacity, a = light + veil * bn * (1 - bn);
  const k = light / Math.max(a, 0.0001), n = Math.max(b, 0.004);
  return ground.map((g, i) => g * (1 - a) + (buf[i] / n) * k * a);
}

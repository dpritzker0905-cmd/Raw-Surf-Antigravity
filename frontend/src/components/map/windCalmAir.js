/**
 * windCalmAir.js: NEAR-CALM AIR IS NEARLY STILL AND NEARLY CLEAR IN LIGHT AND BEACH, AS IT IS IN DARK (2026-10-12; DECISIONS D-030).
 * ON BY DEFAULT wherever dark's veil is laid under the trails (windTrailVeil.js) on a land drawn a step above the sea
 * (windBasemapMute.js WIND_LAND_STEP). Kill: window.__RAW_DISABLE_WIND_CALM_AIR__ = true (the picture before it, to the byte).
 *
 * The owner, 2026-10-12 20:02Z, on films of the three themes side by side: "lighter moving air/wind in dark mode is almost
 * transparent, or even smaller animations than in beach or light mode", and 21:51Z: "The almost still wind needs to be almost still
 * and almost transparent on beach and light modes, as that is how it looks on dark mode. Make sure you're not overlooking that part."
 *
 * WHAT WAS MEASURED (scripts/wind-bench/anatomy-run.js on a ramp from 0.4 to 9 kn, zoom 6, every other change of the day on: a MARK
 * is a pixel more than 4 dE76 off the colour field, a BODY one at half its band's core lift or more). From 1 to 3 kn light's and
 * beach's streaks were met 1.5 to 4 times as often as dark's, their bodies covered 1.7 to 2.2 times the share of the picture, and a
 * typical mark pixel stood 6 to 15 L* over the field where dark's stands 4 to 6 over its land and 1 to 2 UNDER its sea. By 4.3 kn
 * the three agree (0.8 to 1.3). By that gauge the excess is the same at zoom 8 (1.5 to 1.9 times at 1 kn) and nearly gone by
 * zoom 10, where the count is already dark's (0.8 to 1.1) and only the bodies are longer.
 * WHY. Dark draws its streak on a ground near black, where in air that barely moves a mark hardly leaves the ground it is on. Light
 * and beach draw dark's WHITE streak (D-021) at one strength for every speed (D-022), and a mark that hardly moves keeps laying
 * that white on the same texels until the trail buffer is full of it. Fading the mark's ALPHA in the table does little for that
 * reason (tried: a mark that sits still saturates the buffer whatever its alpha). What sets how bright a full buffer is, is the
 * mark's LIGHT LEVEL: the number D-022 already carries ground by ground (u_white).
 *
 * WHAT IS DRAWN. In DRAW_FS the mark's light level is multiplied by
 *
 *     1 - dim x (1 - smoothstep(from, full, speed in kn))            dim = 1 - the level at calm, land and sea apart
 *
 * so below `from` a streak is laid at the calm level, by `full` at the level it always had, and above it nothing moves. Only the
 * LIGHT falls: no particle is removed, moved, shortened or slowed, and the cover (alpha) the trail buffer keeps is the engine's.
 * THE LEVEL IS SET BY THE EYE, ON THE VISIBLE SIDE, AND EASES AT CLOSE ZOOM. The gauge's count and body share match dark's at a
 * level near 0.70 at zoom 6, and a few hundredths under that the marks go OUT (measured: at zoom 6 beach's sea reads 0.96 of dark's
 * body share at 0.69 and 0.38 at 0.66; at zoom 8 light's sea reads 1.0 at 0.75 and 0.1 at 0.67). But that gauge counts a mark by a
 * threshold: dark's near-calm marks are specks 1.3 px long with a core 29 to 37 L* over a near-black ground, and a white mark dimmed
 * to 0.70 stands 4 to 6 L* over a ground of L* 60 to 70. On films beside dark (zooms 4, 6 and 8, the hurricane at 0.3 of its
 * strength) 0.70 and 0.75 read FAINTER than dark's stipple, 0.80 reads as it does at zoom 6, and at zoom 8 even 0.80 loses the land's
 * marks where dark's specks are plain. So: 0.80 over land and 0.78 over sea to zoom 6, the dim eased to half of itself by zoom 8
 * (0.90 and 0.89 from there in), where the close-zoom rules already lay a mark more faintly. The standing rule is that no change
 * takes the animation away: where the gauge and the eye disagree, the level sits on the visible side (LESSONS L-V74, L-V83).
 * With dim 0 the factor is exactly 1.0 in the shader's arithmetic (1.0 - 0.0 x anything): dark, the kill and every stand-down draw
 * the bytes they drew before.
 *
 * IT STANDS DOWN wherever what it was solved on is not drawn: no veil under the trails (its kill or steer, and everything the veil
 * itself stands down for: the white streak's kills and holds, D-022's, the land depth's, the opaque canvas's), and a land that the
 * last sync did not draw a step above the sea (the step's kill, the depth's lever, imagery under the wind, a style with no land to
 * restyle; read from the sync's read-back, never the flag: LESSONS L-V82). Dark never reads it.
 * Until the land mask is ready every mark reads as land (windLandMask.js), so the sea's marks take the land's calm level until then.
 *
 * Read-back: window.__WIND_CALM_AIR__ = { on, theme, land, sea, from, full, at }: the levels as laid to zoom 6, set when they change (never per frame).
 * Lever (bench and A/B): window.__RAW_WIND_CALM_LEVEL__ = [land level, sea level, from kn, full kn] (levels 0.2 to 1; 0 <= from < full <= 15).
 */
import { windTrailVeil } from './windTrailVeil';
import { windLandStepOn } from './windBasemapMute';

export const WIND_CALM_AIR = Object.freeze({
  kill: '__RAW_DISABLE_WIND_CALM_AIR__', lever: '__RAW_WIND_CALM_LEVEL__',
  themes: Object.freeze(['light', 'beach']), level: Object.freeze({ land: 0.8, sea: 0.78 }), from: 2.5, full: 5.5,
  zoom: Object.freeze({ from: 6, to: 8, keep: 0.5 }),   // the share of the dim kept: 1 to zoom 6, easing to 0.5 at zoom 8 and closer
});
const OFF = Object.freeze([0, 0, 0, 1]);   // dim 0 on both grounds: the factor is exactly 1.0

const lever = (v) => (Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
  && v[0] >= 0.2 && v[0] <= 1 && v[1] >= 0.2 && v[1] <= 1 && v[2] >= 0 && v[2] < v[3] && v[3] <= 15 ? v : null);

/** Does this theme lay its streaks at the calm level in near-calm air, here and now? */
export function windCalmAirOn(theme, win = (typeof window !== 'undefined' ? window : null)) {
  const w = win || {};
  return w[WIND_CALM_AIR.kill] !== true && WIND_CALM_AIR.themes.includes(theme) && windTrailVeil(theme, w) > 0 && windLandStepOn(theme, w);
}

/** The share of the dim kept at this zoom: 1 to zoom 6 (and with no zoom given), easing to 0.5 at zoom 8 and closer. */
export function calmZoomShare(zoom) {
  const k = WIND_CALM_AIR.zoom, t = typeof zoom === 'number' && Number.isFinite(zoom) ? Math.max(0, Math.min(1, (zoom - k.from) / (k.to - k.from))) : 0;
  return 1 - (1 - k.keep) * t;
}

/**
 * DRAW_FS's u_calm_air for this frame: [dim over land, dim over sea, from kn, full kn]; [0, 0, 0, 1] wherever it does not draw.
 * The lever's four numbers are laid as given at every zoom (a bench's: it reads one level at one zoom).
 */
export function windCalmAir(theme, win = (typeof window !== 'undefined' ? window : null), zoom) {
  if (!windCalmAirOn(theme, win)) return OFF;
  const v = lever((win || {})[WIND_CALM_AIR.lever]);
  if (v) return [1 - v[0], 1 - v[1], v[2], v[3]];
  const k = calmZoomShare(zoom), own = WIND_CALM_AIR.level;
  return [(1 - own.land) * k, (1 - own.sea) * k, WIND_CALM_AIR.from, WIND_CALM_AIR.full];
}

let SAID = '';
/** Set u_calm_air on the draw program (every frame, beside the land mask's bind), and say what is laid when that changes. */
export function bindCalmAir(gl, prog, theme, zoom, win) {
  if (!gl || !prog) return;
  const w = win || (typeof window !== 'undefined' ? window : null), u = windCalmAir(theme, w, zoom);
  gl.uniform4f(gl.getUniformLocation(prog, 'u_calm_air'), u[0], u[1], u[2], u[3]);
  const at6 = windCalmAir(theme, w), key = `${theme}|${at6.join(',')}`;   // the read-back says the levels to zoom 6: a zoom gesture must not write an object a frame
  if (w && key !== SAID) { SAID = key; w.__WIND_CALM_AIR__ = { on: at6 !== OFF, theme, land: +(1 - at6[0]).toFixed(4), sea: +(1 - at6[1]).toFixed(4), from: at6[2], full: at6[3], at: Date.now() }; }
}

/** The factor DRAW_FS multiplies a mark's light level by (plain JS, the shader's own arithmetic). `land`: 0 to 1 from the mask. */
export function calmAirFactor(u, land, speedKn) {
  const t = Math.max(0, Math.min(1, (speedKn - u[2]) / (u[3] - u[2]))), s = t * t * (3 - 2 * t);
  return 1 - (u[1] + (u[0] - u[1]) * land) * (1 - s);
}

// BEACH crest LIFT (2026-10-22; owner: "No two-tone, they don't look like real waves in my opinion", then "It needs to be a subtle
// improvement"): beach's crests keep their colours (orchid-pink -> electric turquoise, the blue big-wave crests he likes -> sunset
// magenta, white foam) and draw exactly as today everywhere except the two bands where they share the v1 sea's brightness (APCA |Lc|
// near 0; frontend/scripts/wind-color/beach-crest-lift.mjs). Each band moves the crest's brightness AWAY from the sea under it, the way
// a real wave reads:
//   sand (about 1-2 m): the sea is LIGHT (sand, Y 0.35-0.57) and the crest a little darker (Y 0.34-0.47), so the crest goes a little
//     deeper (its colour x (1 - SAND)), like a wave face in shadow. Lifting it toward white here would carry it through the sand's
//     brightness and make it vanish (the model's first run: |Lc| 0 at every zoom for any white lift up to 0.6).
//   grey-mauve (about 4.4-6.8 m): the sea is DARK (Y 0.06-0.29), so the crest goes a little whiter (mixed toward white by MAUVE), like
//     a little more foam on it.
// Far out (DRAW_VS draws crests at 45% of their alpha below z 3) the alpha inside the bands is lifted a little (x ALPHA, tapering to
// x 1 by z 7). Each band's weight is 1 inside it and 0 outside, with smooth ramps, so no switch is visible as the sea height changes.
// No rim, outline, centre line or hue change (the colour is scaled or mixed toward white, never swapped).
// Levels, set before page load: window.__RAW_BEACH_CREST_LIFT__ = 'subtle' (the default) | 'more'.
// Kill: window.__RAW_DISABLE_BEACH_CREST_LIFT__ = true draws today's crest exactly (DRAW_FS hash-pinned in the test).
const WIN = typeof window === 'undefined' ? {} : window;
// Bands, by sea height (m): weight 1 from `from` to `to`, ramping in over `ramp` below and out over `ramp` above.
export const BEACH_LIFT_BANDS = {
  sand: { from: 1.0, to: 2.0, ramp: 0.3 },
  mauve: { from: 4.4, to: 6.8, ramp: 0.4 },
};
// sand: how much deeper (colour x (1 - sand)); mauve: how far toward white; alpha: the far-out alpha lift inside the bands.
export const BEACH_CREST_LIFT = {
  subtle: { sand: 0.30, mauve: 0.35, alpha: 1.5 },
  more: { sand: 0.45, mauve: 0.50, alpha: 1.5 },
};
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
/** A band's weight at sea height h (m), as DRAW_FS computes it (for the checker and the tests). */
export function bandWeight(id, h) {
  const { from, to, ramp } = BEACH_LIFT_BANDS[id];
  return ss(from - ramp, from, h) * (1 - ss(to, to + ramp, h));
}

export function resolveBeachCrestLift(win = WIN) {
  if (win.__RAW_DISABLE_BEACH_CREST_LIFT__ === true) return 'today';
  const s = win.__RAW_BEACH_CREST_LIFT__;
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(BEACH_CREST_LIFT, s) ? s : 'subtle';
}
export const BEACH_CREST_LIFT_LEVEL = resolveBeachCrestLift();

const BEACH = 'u_theme > 1.5';
const f = (x) => x.toFixed(2);
const weightGlsl = (id) => {
  const { from, to, ramp } = BEACH_LIFT_BANDS[id];
  return `smoothstep(${f(from - ramp)}, ${f(from)}, v_wave_height) * (1.0 - smoothstep(${f(to)}, ${f(to + ramp)}, v_wave_height))`;
};
/** The DRAW_FS text pieces a level sets; for 'today' each is empty, so DRAW_FS is byte for byte today's. Every piece is gated on the
 *  beach theme (u_theme > 1.5): dark and light draw exactly as before. `decl` is DRAW_VS's own map zoom, read in DRAW_FS for the
 *  far-out taper (the shader declares it once, whichever piece needs it). */
export function beachCrestLiftGlsl(level = BEACH_CREST_LIFT_LEVEL) {
  const t = BEACH_CREST_LIFT[level];
  if (!t) return { decl: '', tone: '', alphaHead: '' };
  return {
    decl: ' uniform highp float u_zoom;',
    tone: ` float beachSand = ${BEACH} ? ${weightGlsl('sand')} : 0.0; float beachMauve = ${BEACH} ? ${weightGlsl('mauve')} : 0.0;`
      + ` finalColor = mix(finalColor, vec3(1.0), ${f(t.mauve)} * beachMauve) * (1.0 - ${f(t.sand)} * beachSand);`,
    alphaHead: `(1.0 + ${f(t.alpha - 1)} * (beachSand + beachMauve) * (1.0 - smoothstep(3.0, 7.0, u_zoom))) * `,
  };
}
export const BEACH_CREST_LIFT_GLSL = beachCrestLiftGlsl();

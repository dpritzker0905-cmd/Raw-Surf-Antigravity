/**
 * CALM WASH HOLD (2026-10-21; an owner A/B candidate, log docs/weather-program/log/2026-10-21-claude-calm-wash-hold.md).
 *
 * BLEND BOTH (WebGLMarineEngine.js `blendEngaged`: a regional tile resident over a retained coarse base) paints the coarse
 * world wash first, then the regional tile over it with a HEIGHT alpha, smoothstep(0.05 m, 1.4 m, h)
 * (WebGLMarineShaders.js `u_heightAlphaEnabled`). That fade was built for DARK: low surf drew near-black on dark's basemap
 * and read as "the heatmap cleared", so near-flat regional cells let the vivid coarse base through. On light and beach the
 * base it lets through is itself damped to 35% above z 9.5 (the Long Beach land-bleed fix), so calm water fades OUT
 * instead. Measured (PR #425, dev 448deb35c): a 0.5 m sea is drawn at alpha 0.34 at z 10 where the zoom opacity is 0.77,
 * and the legend's 0 and 0.6 m stops land 0.7 dE00 apart in light v2: calm seas near the coast read as bare map.
 *
 * Candidate: the height alpha for DARK only. Light and beach draw calm regional cells at the zoom opacity, over the same
 * coarse base, so every height composes to 1 - (1 - a_zoom)(1 - washEff). Rating-band frames (surfMode, whose height
 * channel holds a 0-100 score) keep today's fade in every theme. Dark is never touched: 1.0 whenever the blend engages.
 * Kill: window.__RAW_DISABLE_CALM_WASH_HOLD__ = true -> today's uniform in every theme (the uniform is all that changes).
 * Telemetry: window.__RAW_GPU__.calmWashHold, written only when the engine has built __RAW_GPU__ (never created here:
 * the engine builds it, with its histograms, only when it is absent).
 */
export const CALM_WASH_HOLD_KILL = '__RAW_DISABLE_CALM_WASH_HOLD__';

// themeVal: 0 dark, 1 light, 2 beach (the engine's u_theme). surfModeVal: 1 when the shader paints the rating band.
// Returns the regional pass's u_heightAlphaEnabled.
export function blendHeightAlpha(blendEngaged, themeVal, surfModeVal, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  const killed = !!(w && w[CALM_WASH_HOLD_KILL] === true);
  const held = !!blendEngaged && !killed && themeVal > 0.5 && !(surfModeVal > 0.5);
  if (w && w.__RAW_GPU__) w.__RAW_GPU__.calmWashHold = { on: !killed, held };
  return (blendEngaged && !held) ? 1.0 : 0.0;
}

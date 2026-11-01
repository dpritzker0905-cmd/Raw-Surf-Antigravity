/**
 * windSpeedRef.js — the speed reference the wind advection's gamma term normalizes by (u_speed_max).
 *
 * Jacobian lens (2026-10-19): screen motion per knot must depend on the LOCAL wind only. The legacy reference was hypot of
 * the frame's SIGNED u/v maxima, so it moved with wind DIRECTION elsewhere in the frame (one-direction wind: ~1.5, gamma off;
 * mixed: ~35, gamma on) and with every hour step. The fixed reference is the engine's declared typical range.
 * Kill: window.__RAW_DISABLE_WIND_FIXED_SPEED_REF__ = true restores the legacy value.
 */
export const WIND_SPEED_REF_KN = 50;

export function resolveWindSpeedRef(uMax, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_DISABLE_WIND_FIXED_SPEED_REF__ === true) {
    return Math.max(1, Math.hypot((uMax && uMax[0]) || 0, (uMax && uMax[1]) || 0));
  }
  return WIND_SPEED_REF_KN;
}

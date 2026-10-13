/**
 * drawnGridResolution — how coarse is the grid the marine field is DRAWN from, right now?
 * (2026-10-01, the far-zoom legend; owner: "legend fix" with the max-thinning decision.)
 *
 * THE DEFECT. The legend's "~N km grid (D°)" notice read `__MARINE_PROJECTION_DIAG__`, which is written by the
 * FETCH paths, not by the frame that was committed to the screen. Replayed live on the deployed frontend, scrubbing
 * to Wed 15Z at far zoom committed a thinned world frame (`series_GFS_waves_h147`, 46 x 20, an 8° lattice) while:
 *   - at first the diag still described the regional 0.25° tile (17 x 17), so the notice was SILENT (0.25° is native), and
 *   - once the exact 2° frame had been fetched (and not drawn) the notice read "~223 km grid (2°)".
 * Neither is the grid under the colours. A surfer cannot tell a 3.2 m swell that the lattice dropped from a calm sea.
 *
 * THE FIX is to ask the one thing that cannot be stale: the grid the engine is drawing. `waveGrid` carries the
 * DELIVERED cols/rows/bounds (46 x 20 over the world for the thinned frame, 181 x 82 for the exact one), and the
 * resolution comes from the same `deriveResolutionDeg` the diag uses (ONE quantity, one expression). The diag stays the
 * fallback for a moment when nothing is drawn yet.
 *
 * `window.__MARINE_ENGINE__` is a debug handle the app already exposes; every read here is guarded so a missing or
 * half-built engine means "unknown" (null), never an exception and never a guess.
 */
import React from 'react';
import { deriveResolutionDeg } from './backendWeatherServiceClientDiag';

/** The drawn wave grid's coarser-axis degrees per cell, or null when nothing readable is drawn. */
export function drawnGridResolutionDeg() {
  if (typeof window === 'undefined') return null;
  try {
    const engine = window.__MARINE_ENGINE__;
    const g = engine && engine._waveData && engine._waveData.waveGrid;
    if (!g || !g.bounds || !(g.cols > 1 || g.rows > 1)) return null;
    const deg = deriveResolutionDeg(g.bounds, g.cols, g.rows);
    return typeof deg === 'number' && isFinite(deg) && deg > 0 ? deg : null;
  } catch (e) {
    return null;
  }
}

/**
 * The drawn grid's resolution as React state. A commit does not re-render the legend, and the engine has no
 * "committed" event (WebGLMarineEngine.js is grandfathered over the 800-LOC ratchet and may only SHRINK), so this
 * re-reads on a light timer. Reading three numbers every 600 ms costs nothing; `enabled` is false for every legend that
 * does not show the notice, so those never start the timer.
 */
export function useDrawnGridResolution(enabled = true) {
  const [deg, setDeg] = React.useState(() => (enabled ? drawnGridResolutionDeg() : null));
  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setDeg(null);
      return undefined;
    }
    const tick = () => setDeg((prev) => {
      const next = drawnGridResolutionDeg();
      return next === prev ? prev : next;
    });
    tick();
    const id = window.setInterval(tick, 600);
    return () => window.clearInterval(id);
  }, [enabled]);
  return deg;
}

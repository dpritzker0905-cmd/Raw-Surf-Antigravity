/**
 * marineFallbackNotice — say so when the wave layer is no longer this app's own forecast.
 *
 * THE DEFECT (root-caused 2026-08-16 from the owner's report, *"the rating band is being layered
 * underneath the marine heatmap"*). `useWebGLGuardrail` drops the WebGL marine layer to Open-Meteo
 * RASTER TILES after 12 consecutive seconds under 20 FPS. Two things change and neither was
 * disclosed:
 *
 *   1. the surf-RATING coastal band disappears — it is drawn by the renderer that was just switched
 *      off, and the raster product has no rating in it at all;
 *   2. the colours stop being this codebase's forecast. Open-Meteo tiles are raw wave HEIGHT, not
 *      `resolve_surf_geometry` + `estimate_surf_at` + `compute_surf_rating`.
 *
 * Meanwhile the legend kept advertising "Surf Rating (coastal band)" and the Poor→Epic ramp. A user
 * looking at a height raster was being told they were looking at surf quality. That is the same
 * one-bit lie `servedResolutionNotice` exists to remove, and this is its sibling.
 *
 * ★★★ IT FOLLOWS THAT RULE'S COROLLARY TOO: a warning that is always on carries as little
 * information as a pass that is always on. This is SILENT in the normal case and speaks only while
 * the fallback is actually engaged.
 *
 * Kill switch: `window.__RAW_LEGEND_FALLBACK_NOTICE__ = false`.
 */
import React from 'react';

/**
 * @param {boolean} marineFailed  is the raster fallback engaged for the marine layer
 * @param {boolean} ratingOn      is the Surf Rating toggle on (changes what was actually lost)
 * @returns {{label: string, title: string}|null} null = say nothing
 */
export function marineFallbackNotice(marineFailed, ratingOn) {
  if (typeof window !== 'undefined' && window.__RAW_LEGEND_FALLBACK_NOTICE__ === false) return null;
  if (!marineFailed) return null;
  // Name the consequence the user can SEE first, then the cause. "Reduced graphics mode" alone
  // would not explain a missing band, and "band unavailable" alone would not explain why.
  const label = ratingOn
    ? '⚠ Simplified wave layer — surf-rating band unavailable'
    : '⚠ Simplified wave layer — reduced graphics mode';
  const title = 'This device could not keep up with the animated wave layer, so the map switched to '
    + 'a simplified wave-height layer from a third-party source. It shows wave HEIGHT only: the '
    + 'surf-rating coastal band and the animated crests are not drawn, and the colours are not this '
    + 'app\'s own surf-quality forecast. The map retries on its own; reloading also restores it.';
  return { label, title };
}

/**
 * Live fallback state, without a prop drilled through three layouts.
 *
 * MapWebGL already publishes the flag on `window.__WEBGL_GUARDRAIL_FALLBACK__` and re-publishes it
 * whenever it changes, and it now dispatches `rawsurf:marine-fallback` on the same edge. Reading the
 * global gives the value at mount; the event gives the updates. (A prop would have been cleaner, but
 * MapWebGL.js is grandfathered over the 800-LOC ratchet and may only SHRINK — the same constraint
 * that put ServedResolutionRow in its own module.)
 */
export function useMarineFallbackState() {
  const read = () => {
    if (typeof window === 'undefined') return false;
    const g = window.__WEBGL_GUARDRAIL_FALLBACK__;
    return !!(g && g.webglMarineFailed);
  };
  const [failed, setFailed] = React.useState(read);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onChange = (e) => setFailed(!!(e && e.detail && e.detail.marineFailed));
    window.addEventListener('rawsurf:marine-fallback', onChange);
    // Re-read on mount: the fallback may already have engaged before this legend rendered.
    setFailed(read());
    return () => window.removeEventListener('rawsurf:marine-fallback', onChange);
  }, []);
  return failed;
}

/**
 * The legend row. One line per call site, so MapWeatherControls' three layouts do not grow.
 *
 * ACCESSIBILITY (CLAUDE.md mandate): a real text label, never colour alone — the glyph is decorative
 * and the sentence carries the meaning. `role="status"` so a screen reader announces the downgrade
 * when it happens rather than leaving it to be discovered. THEME: colour comes from the caller's
 * theme-aware className, exactly as ServedResolutionRow does, so light/dark/beach all work.
 */
export function MarineFallbackRow({ notice, className = '', size = '8' }) {
  if (!notice) return null;
  return (
    <div
      className={`text-[${size}px] ${className} mt-0.5 px-0.5 font-semibold`}
      title={notice.title}
      role="status"
    >
      {notice.label}
    </div>
  );
}

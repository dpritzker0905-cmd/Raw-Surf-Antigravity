/**
 * marineFallbackNotice — say so when the wave layer is no longer the full animated layer.
 *
 * THE DEFECT (root-caused 2026-08-16 from the owner's report, *"the rating band is being layered
 * underneath the marine heatmap"*). `useWebGLGuardrail` drops the WebGL marine layer to a simplified
 * picture after 12 consecutive seconds under 20 FPS. Things change and none of it was disclosed:
 * the surf-RATING coastal band disappears (it is drawn by the renderer that was just switched off)
 * and so do the animated crests. Meanwhile the legend kept advertising "Surf Rating (coastal band)"
 * and the Poor→Epic ramp. That is the same one-bit lie `servedResolutionNotice` exists to remove,
 * and this is its sibling.
 *
 * WHAT THE SIMPLIFIED PICTURE IS (2026-11-18, Open-Meteo exit row 12). It used to be a third party's
 * raster tiles, and this notice said so. It is now THIS APP'S OWN wave-height grid for the hour,
 * painted flat in the theme's own colours (marineFallbackField). When there is nothing of ours to
 * paint (no grid for the hour, a surf-rating grid, the kill, a failed draw) NOTHING is drawn and the
 * row says the layer is unavailable. No state falls back to a third party.
 *
 * ★★★ IT FOLLOWS THAT RULE'S COROLLARY TOO: a warning that is always on carries as little
 * information as a pass that is always on. This is SILENT in the normal case and speaks only while
 * the fallback is actually engaged.
 *
 * Kill switch: `window.__RAW_LEGEND_FALLBACK_NOTICE__ = false`.
 */
import React from 'react';

/**
 * @param {boolean} marineFailed  is the simplified fallback engaged for the marine layer
 * @param {boolean} ratingOn      is the Surf Rating toggle on (changes what was actually lost)
 * @param {{drawn?: boolean, reason?: string}|null} [field]  the own-field state (MarineFallbackFieldLayer); unknown = drawn
 * @returns {{label: string, title: string, unavailable?: boolean}|null} null = say nothing
 */
export function marineFallbackNotice(marineFailed, ratingOn, field = null) {
  if (typeof window !== 'undefined' && window.__RAW_LEGEND_FALLBACK_NOTICE__ === false) return null;
  if (!marineFailed) return null;
  if (field && field.drawn === false && field.reason !== 'inactive') {
    return {
      unavailable: true,
      label: '⚠ Wave layer unavailable on this device',
      title: 'This device could not draw the animated wave layer, and there is no simplified wave picture to show '
        + 'in its place right now, so nothing is drawn. The surf-rating coastal band and the animated crests are not '
        + 'drawn on this device. The map retries on its own; reloading also restores it.',
    };
  }
  // Name the consequence the user can SEE first, then the cause. "Reduced graphics mode" alone
  // would not explain a missing band, and "band unavailable" alone would not explain why.
  const label = ratingOn
    ? '⚠ Simplified wave layer — surf-rating band unavailable, crests not drawn on this device'
    : '⚠ Simplified wave layer — crests not drawn on this device';
  const title = 'This device could not keep up with the animated wave layer, so the map switched to a simplified '
    + 'picture of this app\'s own wave HEIGHT forecast. It shows wave height only: the surf-rating coastal band '
    + 'and the animated crests are not drawn on this device, so the colours are wave height, not surf quality. '
    + 'At world zoom the picture is drawn once and is not repeated across the date line. '
    + 'The map retries on its own; reloading also restores it.';
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
 * Whether our own simplified field is on the map: { drawn, reason } or null while unknown. Published by
 * MarineFallbackFieldLayer on `window.__RAW_OWN_MARINE_FALLBACK__` and announced with `rawsurf:marine-fallback-field`,
 * read the same way as the flag above (the global at mount, the event for updates).
 */
export function useMarineFallbackFieldState() {
  const read = () => {
    const s = typeof window !== 'undefined' ? window.__RAW_OWN_MARINE_FALLBACK__ : null;
    return s ? { drawn: !!s.drawn, reason: s.reason || null } : null;
  };
  const [field, setField] = React.useState(read);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onChange = (e) => setField(e && e.detail ? { drawn: !!e.detail.drawn, reason: e.detail.reason || null } : read());
    window.addEventListener('rawsurf:marine-fallback-field', onChange);
    setField(read());
    return () => window.removeEventListener('rawsurf:marine-fallback-field', onChange);
  }, []);
  return field;
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

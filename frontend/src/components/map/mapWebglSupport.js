/**
 * Classify a map startup failure, and say something useful about it.
 *
 * 2026-09-22 — the owner reported the map "frozen with blank map area" after login. It
 * reproduced by disabling WebGL: app shell intact, map area empty, ZERO errors surfaced.
 *
 * The mechanism is in the library, verified by reading it:
 * `@vis.gl/react-maplibre/dist/components/map.js` (v8.1.1, lines 42-55) catches the init
 * promise rejection and calls `props.onError` IF PRESENT — otherwise a bare `console.error`.
 * `setMapInstance` never runs, the children never mount, nothing throws, no ErrorBoundary
 * fires. An empty rectangle inside a working page reads as a freeze, so the user waits
 * instead of acting.
 *
 * ⛔⛔ THIS MODULE USED TO PROBE FOR WEBGL BY CREATING A CONTEXT AND THEN CALLING
 * `WEBGL_lose_context.loseContext()` TO RELEASE IT. THAT CAUSED A WORSE BUG THAN THE ONE IT
 * FIXED, AND IT SHIPPED TO A PREVIEW. Chrome counts deliberate context losses against the
 * PAGE: enough of them and it refuses all further contexts with
 *
 *     webglcontextcreationerror: "Web page caused context loss and was blocked"
 *
 * Observed live on deploy-preview-63: the map drew for about a minute, froze, and after a
 * reload could not start at all — on a machine where WebGL was demonstrably fine
 * (`ANGLE (Intel UHD Graphics, Direct3D11)` created a context in the same tab, at the same
 * moment, from the console). A grep confirmed the probe was the ONLY `loseContext()` caller
 * in the frontend, so the page-level block was self-inflicted.
 *
 * ★ The lesson is narrow and worth keeping: `loseContext()` is not a polite way to free a
 * probe, it is the same signal a crash-looping page emits, and the browser cannot tell the
 * difference. **Do not create a WebGL context just to ask whether you could.**
 *
 * So there is no probe. The map simply tries, and `onError` reports what actually happened —
 * which is strictly better information anyway: the real event carries a `statusMessage` naming
 * the true cause, where a probe could only ever say "no".
 */

/** Stable reason codes. UI copy is keyed off these, so they are part of the contract. */
export const WEBGL_UNSUPPORTED_REASONS = {
  CONTEXT_BLOCKED: 'context-blocked',
  CONTEXT_UNAVAILABLE: 'context-unavailable',
  INIT_FAILED: 'init-failed',
};

/**
 * Is this `onError` event a STARTUP failure, or an ordinary runtime map error?
 *
 * ⚠️ This distinction is the whole safety of the feature. @vis.gl/react-maplibre maps the
 * map's ongoing `error` event onto the SAME `onError` prop it uses for init rejection
 * (`dist/maplibre/maplibre.js` line 60, `error: 'onError'`). A failed tile, style or source
 * request therefore arrives at the same handler. Raising the full-surface startup panel on
 * one of those would blank a map that is drawing perfectly well.
 *
 * Two independent signals, either of which proves the map is already alive:
 *   - `event.target` — the init catch constructs its event with `target: null`
 *     (`dist/components/map.js` line 47); a runtime maplibre ErrorEvent carries the map.
 *   - `mapMounted` — the caller's own view of whether the map ref has been populated.
 *     Independent of library internals, so a future version that starts setting `target`
 *     on the init event cannot silently turn every tile error into a full-screen panel.
 */
export const isMapStartupFailure = (event, mapMounted) => {
  if (mapMounted) return false;
  if (event && event.target) return false;
  return true;
};

/**
 * Pull the most specific text the failure carries.
 *
 * maplibre's `webglcontextcreationerror` puts the browser's real explanation in
 * `statusMessage` — "Web page caused context loss and was blocked" is a completely different
 * problem from "WebGL is disabled", and only that field distinguishes them.
 */
const failureText = (err) => {
  if (!err) return '';
  const parts = [];
  try {
    if (typeof err === 'string') parts.push(err);
    if (err.statusMessage) parts.push(String(err.statusMessage));
    if (err.message) parts.push(String(err.message));
    if (err.type) parts.push(String(err.type));
  } catch {
    // An error whose own fields throw is still an error; classify it as unknown.
  }
  return parts.join(' ');
};

/**
 * Map a startup failure onto a reason code.
 * Unknown shapes fall through to INIT_FAILED rather than guessing at WebGL.
 */
export const classifyMapInitError = (err) => {
  const text = failureText(err).toLowerCase();
  if (!text) return WEBGL_UNSUPPORTED_REASONS.INIT_FAILED;
  if (text.includes('caused context loss') || text.includes('was blocked')) {
    return WEBGL_UNSUPPORTED_REASONS.CONTEXT_BLOCKED;
  }
  if (text.includes('webgl') || text.includes('context')) {
    return WEBGL_UNSUPPORTED_REASONS.CONTEXT_UNAVAILABLE;
  }
  return WEBGL_UNSUPPORTED_REASONS.INIT_FAILED;
};

/**
 * Human-readable copy for a reason code.
 *
 * ★ Every branch names a NEXT ACTION. "WebGL is unavailable" tells a surfer nothing; what
 * actually gets someone moving again is the specific switch or the specific recovery step.
 */
export const describeWebglFailure = (reason) => {
  switch (reason) {
    case WEBGL_UNSUPPORTED_REASONS.CONTEXT_BLOCKED:
      return 'Your browser stopped this tab from using the graphics hardware after repeated '
        + 'errors. Close this tab and open the map in a new one. If it keeps happening, '
        + 'restart the browser.';
    case WEBGL_UNSUPPORTED_REASONS.CONTEXT_UNAVAILABLE:
      return 'Your browser blocked WebGL, which the map needs in order to draw. Turn on '
        + '"Use graphics acceleration when available" in your browser settings and reload. '
        + 'An extension that blocks canvas or WebGL can also cause this.';
    default:
      return 'The map could not start. Reload the page, and if it keeps happening check that '
        + 'graphics acceleration is enabled in your browser settings.';
  }
};

/**
 * WebGL capability probe for the map surface.
 *
 * 2026-09-22 — the owner reported the map "frozen with blank map area" after login. It
 * reproduced EXACTLY by disabling WebGL in a working session: app shell intact, map area
 * empty, and ZERO errors surfaced.
 *
 * The mechanism is in the library, verified by reading it rather than inferred:
 * `@vis.gl/react-maplibre/dist/components/map.js` (v8.1.1, lines 42-55) catches the init
 * promise rejection and calls `props.onError` IF PRESENT — otherwise it falls through to a
 * bare `console.error(error)`. `setMapInstance` never runs, so the map's children never
 * mount, nothing throws, and the route's ErrorBoundary never fires. The user gets an empty
 * rectangle inside a working page, which reads as a freeze rather than a failure.
 *
 * ⚠️ This probe runs BEFORE maplibre is asked to initialise so the surface can NAME the
 * problem instead of rendering nothing. Passing `onError` (see MapWebGL.js) is the other
 * half: the probe catches the case we can predict, `onError` catches the rest.
 *
 * ⛔ This module must NEVER throw. A probe that can break the map it exists to protect is
 * worse than no probe, so every branch is wrapped and the unknown case resolves to
 * "supported" — we degrade toward letting maplibre try, never toward blocking it.
 */

/** Stable reason codes. UI copy is keyed off these, so they are part of the contract. */
export const WEBGL_UNSUPPORTED_REASONS = {
  NO_DOCUMENT: 'no-document',
  NO_CANVAS: 'no-canvas',
  CONTEXT_THREW: 'context-threw',
  CONTEXT_UNAVAILABLE: 'context-unavailable',
};

/**
 * Release a probe context immediately.
 *
 * Browsers cap live WebGL contexts (commonly ~16) and evict the OLDEST when the cap is hit.
 * A probe that leaks its context would therefore cost the map a context slot — and on a
 * remount loop could evict the map's own. `WEBGL_lose_context` is the only portable way to
 * hand it back; when the extension is absent we drop the reference and let GC handle it.
 */
const releaseProbeContext = (gl) => {
  try {
    const lose = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context');
    if (lose && typeof lose.loseContext === 'function') lose.loseContext();
  } catch {
    // A failure to release is not a failure to detect — the caller's answer still stands.
  }
};

/**
 * Read the unmasked renderer string when the debug extension allows it.
 * Returns null rather than throwing; this is diagnostic colour, never a gate.
 */
const readRenderer = (gl) => {
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) return gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || null;
    return gl.getParameter(gl.RENDERER) || null;
  } catch {
    return null;
  }
};

/**
 * Probe whether this browser can give maplibre a WebGL context.
 *
 * @param {Document} [doc] injectable for tests; defaults to the ambient document.
 * @returns {{supported: boolean, reason: string|null, renderer: string|null}}
 */
export const detectWebglSupport = (doc) => {
  const targetDoc = doc || (typeof document !== 'undefined' ? document : null);

  if (!targetDoc || typeof targetDoc.createElement !== 'function') {
    return { supported: false, reason: WEBGL_UNSUPPORTED_REASONS.NO_DOCUMENT, renderer: null };
  }

  let canvas;
  try {
    canvas = targetDoc.createElement('canvas');
  } catch {
    return { supported: false, reason: WEBGL_UNSUPPORTED_REASONS.NO_CANVAS, renderer: null };
  }

  if (!canvas || typeof canvas.getContext !== 'function') {
    return { supported: false, reason: WEBGL_UNSUPPORTED_REASONS.NO_CANVAS, renderer: null };
  }

  // maplibre-gl asks for webgl2 first and falls back to webgl, so the probe must accept
  // EITHER. Checking only webgl2 would refuse a browser the map would actually have run on.
  let gl = null;
  try {
    gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  } catch {
    // Some hardened/privacy configurations throw here rather than returning null.
    return { supported: false, reason: WEBGL_UNSUPPORTED_REASONS.CONTEXT_THREW, renderer: null };
  }

  if (!gl) {
    return { supported: false, reason: WEBGL_UNSUPPORTED_REASONS.CONTEXT_UNAVAILABLE, renderer: null };
  }

  const renderer = readRenderer(gl);
  releaseProbeContext(gl);

  return { supported: true, reason: null, renderer };
};

/**
 * Is this `onError` event a STARTUP failure, or an ordinary runtime map error?
 *
 * ⚠️ This distinction is the whole safety of the feature. @vis.gl/react-maplibre maps the
 * map's ongoing `error` event onto the SAME `onError` prop it uses for init rejection
 * (`dist/maplibre/maplibre.js` line 60, `error: 'onError'`). A failed tile, style or source
 * request therefore arrives at the same handler. Raising the full-surface startup panel on
 * one of those would blank a map that is drawing perfectly well — strictly worse than the
 * silence this feature replaces.
 *
 * Two independent signals, either of which proves the map is already alive:
 *   - `event.target` — the init catch constructs its event with `target: null`
 *     (`dist/components/map.js` line 47); a runtime maplibre ErrorEvent carries the map.
 *   - `mapMounted` — the caller's own view of whether the map ref has been populated.
 *     Independent of library internals, so a future version that starts setting `target`
 *     on the init event cannot silently turn every tile error into a full-screen panel.
 *
 * @param {{target?: unknown}|null|undefined} event
 * @param {boolean} mapMounted
 * @returns {boolean} true only when the map never came up
 */
export const isMapStartupFailure = (event, mapMounted) => {
  if (mapMounted) return false;
  if (event && event.target) return false;
  return true;
};

/**
 * Human-readable copy for a reason code.
 *
 * ★ Every branch names a NEXT ACTION. "WebGL is unavailable" tells a surfer nothing; the
 * thing that actually fixes this in the field is Chrome's hardware-acceleration switch,
 * so that is what the message says.
 */
export const describeWebglFailure = (reason) => {
  switch (reason) {
    case WEBGL_UNSUPPORTED_REASONS.CONTEXT_THREW:
    case WEBGL_UNSUPPORTED_REASONS.CONTEXT_UNAVAILABLE:
      return 'Your browser blocked WebGL, which the map needs in order to draw. Turn on '
        + '"Use graphics acceleration when available" in your browser settings and reload. '
        + 'An extension that blocks canvas or WebGL can also cause this.';
    case WEBGL_UNSUPPORTED_REASONS.NO_CANVAS:
    case WEBGL_UNSUPPORTED_REASONS.NO_DOCUMENT:
      return 'This browser does not provide the canvas support the map needs. Try a recent '
        + 'version of Chrome, Edge, Firefox or Safari.';
    default:
      return 'The map could not start. Reload the page, and if it keeps happening check that '
        + 'graphics acceleration is enabled in your browser settings.';
  }
};

/**
 * GUST PARTICLES (2026-11-18, David: "Wind gusts layers need to replicate wind layers with their color schemes for all three
 * theme modes, light, dark, beach, and the animation settings. The only thing that will be different is what the user sees as
 * the faster wind that would show on a gusts readout").
 *
 * Design (option A; Reflection Beam and SubQ Snap both chose it, SubQ 0.60 vs 0.33 for a "surge" variant): with Gusts picked,
 * the WIND particle engine runs exactly as it does for Wind (same advection, density, dash, trails, per-theme rules), moving
 * along the mean wind. Only the particle COLOUR reads the gust speed of the frame on screen. A gust is a speed with no
 * direction, so motion stays the wind's: moving marks at gust speed would turn a peak into sustained transport.
 * The heatmap under the particles is the gust raster itself (ownRasterFrames), which already draws the wind heatmap's colour
 * for the same knot in each theme; the wind engine's own heatmap pass is skipped in gust mode so the two never stack.
 * Where the wind has no field (ICON wind ends at 120 h, its gusts at 180 h) no particles are drawn: direction is never invented.
 *
 * This module is the hand-off: useOwnRasterFrames publishes the gust field it has ON SCREEN, WebGLWindLayer reads it.
 * Kill: window.__RAW_DISABLE_GUST_PARTICLES__ = true (Gusts back to the static heatmap alone).
 */

export const gustParticlesOn = () => !(typeof window !== 'undefined' && window.__RAW_DISABLE_GUST_PARTICLES__ === true);

/** The particle layer runs for Wind, and for Gusts unless gust particles are killed. */
export function windParticlesWanted(activeLayers) {
  const a = Array.isArray(activeLayers) ? activeLayers : [];
  return a.includes('wind') || (a.includes('gusts') && gustParticlesOn());
}

/** True when the particles should take their colour from the gust field (Gusts picked, not Wind). */
export function gustColourMode(activeLayers) {
  const a = Array.isArray(activeLayers) ? activeLayers : [];
  return !a.includes('wind') && a.includes('gusts') && gustParticlesOn();
}

/**
 * GUST FIELD TINT (2026-11-18, David chose "tune light" after the three-theme screenshots): on light and beach the WIND field is
 * not laid over the basemap, it TINTS it (multiply, WebGLWindUtils.v2FieldTint), which is why its colours run deeper and its
 * white streaks read stronger. Measured on the same view: the gust field's luminance 0.387 vs the wind's 0.300, streak
 * contrast 29.7e-3 vs 32.9e-3. The gust raster now tints the same way, with the strength scaled so that (gust alpha x tint)
 * equals (wind field alpha x tint) at every zoom: the same ink as the wind field for the same knot. Dark is not tinted; its
 * parity (the wind's dark field lands at alpha squared) is gustPalette.js DARK FIELD PARITY (2026-11-22). Kills: window.__RAW_DISABLE_GUST_FIELD_TINT__ (Gusts back to alpha-over), and the
 * wind's own __RAW_DISABLE_WIND_FIELD_TINT__ (v2FieldTint returns 0) turns both off together.
 */
export const WIND_FIELD_OPACITY = Object.freeze({ dark: 0.48, light: 0.65, beach: 0.55 });   // WebGLWindEngine's heatmapOpacity
export function gustFieldTint(theme, zoom, gustOpacityAt, windTint, win = (typeof window !== 'undefined' ? window : null)) {
  if (win && win.__RAW_DISABLE_GUST_FIELD_TINT__ === true) return 0;
  const s = Number(windTint) || 0;
  if (!(s > 0)) return 0;
  const g = Number(gustOpacityAt(zoom)) || 0;
  return g > 0 ? s * (WIND_FIELD_OPACITY[theme] || g) / g : 0;
}

let shown = null;
const subs = new Set();

/** The gust field on screen ({cols, rows, bounds, values (kn, NaN = no data), validMs}) or null. */
export function getShownGustField() { return shown; }

export function setShownGustField(field) {
  const next = field && field.values && field.cols > 1 && field.rows > 1 && field.bounds ? field : null;
  if (next === shown) return;
  shown = next;
  subs.forEach((fn) => { try { fn(shown); } catch (e) { /* a subscriber's own failure */ } });
}

export function subscribeGustField(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/**
 * Encode a gust field as one byte per cell for the GPU (WebGL1-safe LUMINANCE, so the same path runs on every phone):
 * byte = round(kn / maxKn * 254) + 1, and 0 for no data (the shader then falls back to the wind's own speed).
 * Rows stay as decoded: frames are SOUTH-first (ownRasterDecode.js: "south-first rows, west-first columns"), which is already
 * the wind texture's orientation (tex_v = (lat - south) / (north - south)), so texture row 0 is the south edge.
 * Returns { bytes, cols, rows, maxKn, bounds } or null.
 */
export function encodeGustTexture(field, maxKn) {
  if (!field || !field.values) return null;
  const { cols, rows, values } = field;
  const top = Math.max(1, Number(maxKn) || 1);
  const n = cols * rows;
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const v = values[i];
    bytes[i] = Number.isFinite(v) && v >= 0 ? 1 + Math.round(Math.min(v, top) / top * 254) : 0;
  }
  return { bytes, cols, rows, maxKn: top, bounds: field.bounds };
}

/** Knots back from a texel byte (the shader's decode, kept here so the tests pin the same arithmetic). */
export function decodeGustByte(b, maxKn) {
  return b > 0 ? (b - 1) / 254 * maxKn : NaN;
}

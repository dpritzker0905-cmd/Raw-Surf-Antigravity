/**
 * windWorldCopies.js — which world copies the wind heatmap and wind particles draw this frame (2026-11-13).
 *
 * The wind engine draws both passes once per world offset (degrees: ... -360, 0, 360 ...). The layer used to pick the offsets
 * from the map centre, an estimated visible span and a padding:
 *   - below zoom 3.5 the padding was 180 degrees on each side ("pre-render adjacent worlds"), which gives three copies for
 *     ANY view, also one with both world edges far off screen;
 *   - the span was `canvas.width * 360 / (256 * 2^zoom)`: device pixels against 256-pixel tiles, where the map uses CSS pixels
 *     and 512-pixel tiles. That is 2x too wide at devicePixelRatio 1 and 6x at 3, so above zoom 3.5 extra copies were drawn
 *     well before an edge came into view.
 * A copy that is not on screen is a whole pass of wasted work (measurements: docs/weather-program/log/
 * 2026-11-13-fable-wind-world-copies.md).
 *
 * NOW: from the map's own bounds of this frame ([west, south, east, north], unwrapped: they run past +-180 when the view
 * does). Copy k covers longitudes [-180 + 360k, 180 + 360k]; draw every copy that the view, widened by MARGIN_DEG on each
 * side, touches. Nothing is pre-rendered: the offsets are recomputed every frame from that frame's bounds, so a copy is drawn
 * in the same frame its edge comes within the margin.
 * WITHOUT readable bounds the layer's old offsets are used unchanged.
 * Kill: window.__RAW_DISABLE_WIND_COPY_CULL__ = true (the old offsets, as before).
 */
const W = () => (typeof window !== 'undefined' ? window : {});
export const MARGIN_DEG = 10;
export const MAX_COPIES = 5;   // a guard, not a design limit: bounds wider than this are not trusted

export const windCopyCullOn = () => W().__RAW_DISABLE_WIND_COPY_CULL__ !== true;

/** World offsets in degrees for a view [west, ..., east], or null when the bounds cannot be read. */
export function offsetsForBounds(viewportBounds) {
  if (!Array.isArray(viewportBounds)) return null;
  const west = viewportBounds[0]; const east = viewportBounds[2];
  if (typeof west !== 'number' || typeof east !== 'number' || !Number.isFinite(west) || !Number.isFinite(east) || east < west) return null;
  const first = Math.floor((west - MARGIN_DEG + 180) / 360);
  const last = Math.ceil((east + MARGIN_DEG - 180) / 360);
  if (last - first + 1 > MAX_COPIES) return null;
  const out = [];
  for (let k = first; k <= last; k += 1) out.push(k * 360);
  return out;
}

/**
 * The offsets to draw: from the bounds when the cull is on and they are readable, else `legacyOffsets` (what the layer
 * computed the old way). Telemetry: window.__RAW_GPU__.windCopies = { offsets, legacy, by }.
 */
export function windWorldOffsets(legacyOffsets, viewportBounds) {
  const fromBounds = windCopyCullOn() ? offsetsForBounds(viewportBounds) : null;
  const offsets = fromBounds || legacyOffsets;
  const w = W();
  if (w.__RAW_GPU__) w.__RAW_GPU__.windCopies = { offsets, legacy: legacyOffsets, by: fromBounds ? 'bounds' : (windCopyCullOn() ? 'legacy-no-bounds' : 'kill') };
  return offsets;
}

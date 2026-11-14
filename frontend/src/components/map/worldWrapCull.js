/**
 * worldWrapCull.js — which world copies the marine heatmap and crest particles must draw this frame.
 *
 * The engine can draw both passes three times, at world offsets {0, -1, +1}, so the field continues across the
 * antimeridian. A copy that cannot be on screen is a whole pass of wasted work: at the world view the two extra particle
 * draws measured 0.25-0.29 ms each against 0.33-0.37 ms for the visible one (docs/weather-program/log/
 * 2026-11-13-fable-world-wrap-cull.md).
 *
 * THE RULE (bounds = the map's own getBounds() of this frame, [west, south, east, north], unwrapped: they run past +-180
 * when the view does). Draw all three copies when ANY of:
 *   - the kill window.__RAW_DISABLE_WRAP_CULL__ is set (always wrap);
 *   - the bounds or the zoom are unknown (safe);
 *   - east < west (the view crosses the antimeridian in wrapped form);
 *   - west < -170 or east > 170 (the view reaches a world edge, with a 10 degree margin for crests drawn past their centre);
 *   - the view is at least 300 degrees wide (most of a world: an edge is in view whatever the centre).
 * Otherwise only the main copy.
 *
 * WHAT CHANGED 2026-11-13. The rule used to end "... or zoom < 4", which drew three copies for EVERY low-zoom view, also
 * one centred on an ocean with the world edges far off screen. That clause dated from when the bounds clauses were dead code
 * (the 2026-07-23 type bug: bounds are an ARRAY and were read as .west/.east), and `zoom < 4` was the only thing that ever
 * wrapped. With the bounds read correctly it is redundant wherever an edge is in view.
 * Kill for this change alone: window.__RAW_DISABLE_WRAP_CULL_LOWZOOM__ = true (zoom < 4 wraps again, as before).
 */
const W = () => (typeof window !== 'undefined' ? window : {});
export const EDGE_MARGIN_DEG = 170;
export const WIDE_VIEW_DEG = 300;

/** { needWrap, vbWest, vbEast, boundsKnown, why } for this frame. `why` names the clause that decided. */
export function worldWrapDecision(viewportBounds, zoom) {
  const w = W();
  const vbWest = Array.isArray(viewportBounds) ? viewportBounds[0] : (viewportBounds ? viewportBounds.west : undefined);
  const vbEast = Array.isArray(viewportBounds) ? viewportBounds[2] : (viewportBounds ? viewportBounds.east : undefined);
  const boundsKnown = typeof vbWest === 'number' && typeof vbEast === 'number' && Number.isFinite(vbWest) && Number.isFinite(vbEast);
  let why = null;
  if (w.__RAW_DISABLE_WRAP_CULL__ === true) why = 'kill';
  else if (!viewportBounds || !boundsKnown) why = 'bounds-unknown';
  else if (typeof zoom !== 'number' || !Number.isFinite(zoom)) why = 'zoom-unknown';
  else if (vbEast < vbWest) why = 'crosses';
  else if (vbWest < -EDGE_MARGIN_DEG || vbEast > EDGE_MARGIN_DEG) why = 'near-edge';
  else if (vbEast - vbWest >= WIDE_VIEW_DEG) why = 'wide';
  else if (zoom < 4 && w.__RAW_DISABLE_WRAP_CULL_LOWZOOM__ === true) why = 'lowzoom-kill';
  return { needWrap: why !== null, vbWest, vbEast, boundsKnown, why };
}

/**
 * Test-only helpers shared by marineBridgeGateInvariant.{test,wiring.test,sequence.test}.js (F-22, 2026-10-02): the layer's zoom-out gate
 * transcribed ONCE, with its own constants, and the grid fixtures. Not production code and not a test file (jest runs *.test.js only).
 *
 * `gateHides` is the coverage-aligned zoom-out reject of WebGLMarineCustomLayer.js for a REGIONAL resident of a global-supported model at
 * default levers: hidden = the view is wide (z <= MARINE_ZOOMED_OUT_MAX_ZOOM, or either axis > 15 deg) AND the resident covers less than
 * DEFAULT_COVER_FRAC of it. It omits what the real layer adds and the engine's coverage arithmetic lacks: longitude wrap, the 340/350 deg
 * grid classes, __RAW_DISABLE_ZOOMOUT_REGIONAL_COVER__ and the live cover lever. marineBridgeGateInvariant.wiring.test.js checks this
 * transcription against the REAL layer over the whole grid, so a layer-only drift in the gate (the `|| 0.6`, an axis test) is caught there.
 */
import { MARINE_ZOOMED_OUT_MAX_ZOOM } from './marineZoomThresholds';
import { DEFAULT_COVER_FRAC } from './marineZoomOutGate';
import { isCoarseGlobalGrid } from './marineEngineDecisions';

export const WORLD = { west: -180, south: -80, east: 180, north: 85 };

/** A viewport `w` deg wide and `h` deg tall centred on the Florida coast: [west, south, east, north]. */
export const viewport = (w, h) => [-80 - w / 2, 28 - h / 2, -80 + w / 2, 28 + h / 2];

/** A regional clip covering fraction `c` of `vb` (it shares the view's SW corner, so the overlap is exactly c x area). */
export const clipFor = (vb, c, over = {}) => {
  const s = Math.sqrt(c);
  const west = vb[0], south = vb[1];
  const east = west + (vb[2] - vb[0]) * s, north = south + (vb[3] - vb[1]) * s;
  return {
    bounds: { west, south, east, north },
    cols: Math.max(2, Math.round((east - west) / 0.25)), rows: Math.max(2, Math.round((north - south) / 0.25)),
    vectors: [{ lat: 27, lng: -80, u: 0.1, v: 0.1, speed: 1 }],
    __sourceModel: 'GFS', __componentLayer: 'waves', hourOffset: 0, ratingMode: false, valid_time: '2026-10-01T12:00:00Z', ...over,
  };
};

/** The layer's gate: does it hide `grid` (a regional resident) in this view? Global grids are never hidden by it. */
export function gateHides(zoom, vb, grid) {
  if (!grid || !grid.bounds || isCoarseGlobalGrid(grid)) return false;
  const vpW = vb[2] - vb[0], vpH = vb[3] - vb[1];
  const wide = zoom <= MARINE_ZOOMED_OUT_MAX_ZOOM || vpW > 15.0 || vpH > 15.0;
  const b = grid.bounds;
  const ix = Math.max(0, Math.min(b.east, vb[2]) - Math.max(b.west, vb[0]));
  const iy = Math.max(0, Math.min(b.north, vb[3]) - Math.max(b.south, vb[1]));
  return wide && (ix * iy) / (vpW * vpH) < DEFAULT_COVER_FRAC;
}

/** The grid of cases the predicate and layer sweeps run over: zooms x viewport spans (deg) x resident coverage. */
export const SPANS = [[4, 3], [8, 6], [14, 9], [20, 12], [28, 17], [39, 24], [41, 25], [90, 50]];
export const ZOOMS = [8.4, 7.4, 7.0, 6.2, 5.4, 4.6, 3.1];
export const COVERS = [0.01, 0.05, 0.3, 0.55, 0.59, 0.61, 0.8, 1.0];   // 0.01 not 0: a zero-size clip is not a regional grid

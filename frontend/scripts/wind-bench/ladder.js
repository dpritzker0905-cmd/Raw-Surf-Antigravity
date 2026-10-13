/**
 * Wind bench, LADDER mode: which wind grids the map is handed at each stop of a zoom, in order. Pure, no DOM, no GL.
 *
 * Three rules are mirrored here, each pinned to its source by src/components/map/windBenchLadder.test.js:
 *   requestBox   the box the client asks for (backendWeatherServiceClientCoverage.clampViewportBbox, wind branch);
 *   serverStep   the spacing the server answers a box with (route_helpers.choose_adaptive_resolution, 400 points);
 *   clipWindow   the 2-deg world clip a cold box is answered with first (mid_res_tier: the box plus half its span).
 * `plan` then walks the zoom stops with the client's own cache rule (windController.fetchWindData: the exact box, else
 * the FIRST cached box that contains the view and is fine enough), so a stop is answered either by the cache or by the
 * server's two answers in turn: the 2-deg clip (stale, sharpen pending), then the box itself.
 */
const { makeCamera } = require('./camera');

const FINE_MAX_VIEWPORT_SPAN = 13;

/**
 * The wind request box for a view [w, s, e, n]; null when the client asks for the world instead, and for a view that
 * leaves +-180 (the app normalises those across the dateline first; the bench does not model it).
 */
function requestBox(view) {
  const [west, south, east, north] = view, spanLng = east - west, spanLat = Math.abs(north - south), span = Math.max(spanLng, spanLat);
  if (!(spanLng > 0 && spanLat > 0) || span > 180 || west < -180 || east > 180) return null;
  const pad = span <= FINE_MAX_VIEWPORT_SPAN ? Math.max(0, Math.min(1, (FINE_MAX_VIEWPORT_SPAN - span) / 2))
    : (span <= 20 ? 1 : Math.min(4, Math.ceil(span * 0.08)));
  return {
    west: Math.max(-180, Math.floor(west - pad)), south: Math.max(-80, Math.floor(south - pad)),
    east: Math.min(180, Math.ceil(east + pad)), north: Math.min(85, Math.ceil(north + pad)),
  };
}

/** Node spacing (deg) the server picks for a box: sqrt(area / 400) rounded up to its tier. */
function serverStep(box) {
  const est = Math.sqrt(((box.east - box.west) * (box.north - box.south)) / 400);
  return [0.25, 0.5, 1, 2, 2.5, 5, 10, 15, 20, 30].find((t) => est <= t) || 40;
}

/** The window the 2-deg world grid is clipped to for a box: the box plus min(12, max(2, half its larger span)) a side. */
function clipWindow(box) {
  const pad = Math.min(12, Math.max(2, 0.5 * Math.max(box.east - box.west, box.north - box.south)));
  return { west: Math.max(-180, box.west - pad), south: Math.max(-80, box.south - pad), east: Math.min(180, box.east + pad), north: Math.min(85, box.north + pad) };
}

const sameBox = (a, b) => a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north;
const contains = (box, view) => box.west <= view[0] && box.south <= view[1] && box.east >= view[2] && box.north >= view[3];

/**
 * The stops of a zoom path. Each stop: { z, view, box, step, served: [{ kind, box, step }] } where `served` is what
 * reaches the engine there, in order; kind is 'clip' (the 2-deg world clip of clipWindow(box)), 'box' (the dynamic box
 * at its tier), or 'cache' (a box the client already holds: the same grid again).
 * `reuse: false` drops the containment rule (every new box goes to the server), as after a pan or a cache expiry.
 */
function plan(zooms, centre, pane, { reuse = true } = {}) {
  const cache = [];                                             // insertion order, as the client's Map
  return zooms.map((z) => {
    const view = makeCamera(centre.lng, centre.lat, z, pane.w, pane.h).viewBounds;
    const box = requestBox(view), step = serverStep(box);
    const exact = cache.find((c) => sameBox(c.box, box));
    const held = exact || (reuse ? cache.find((c) => contains(c.box, view) && c.step <= 1.1 * step) : null);
    if (held) return { z, view, box, step, served: [{ kind: 'cache', box: held.box, step: held.step }] };
    cache.push({ box, step });
    return { z, view, box, step, served: [{ kind: 'clip', box: clipWindow(box), step: 2 }, { kind: 'box', box, step }] };
  });
}

module.exports = { requestBox, serverStep, clipWindow, plan };

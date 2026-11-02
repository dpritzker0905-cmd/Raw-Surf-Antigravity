/**
 * staticRegionalPrewarm.js — the boot warm-up, extended to the regional z7-9 bundle of the first regional view (D3, 2026-11-01).
 *
 * WHY. A cold Waves activation at z7-9 paints the instant 2-deg world CDN frame first, and the cold veil (marineColdVeil.js) holds it
 * invisible at a coastal view until the detailed resident lands. Inside the 19 pilot boxes that detail is the regional bundle on the
 * CDN (staticRegional.js, ON since D-051), but its waterfall (latest.json, the regional index, the whole bundle, one slice's sha12 and
 * inflate, the vectors) only started after the click. The world prewarm (staticFrames.prewarmStaticFrames) already runs that
 * waterfall for the world set at MapPage mount; this does the same for the regional set of the view the map settles on.
 *
 * WHAT. Once per page load: on the first settled camera (the map loaded and not moving; re-checked at each moveend for up to
 * WATCH_MS, since the map opens at Florida z7 and then flies to the visitor's location at z9) whose view lies inside a pilot box,
 * for a GFS selection: pin that box's `GFS/marine/waves/<box>` index and, in idle time at 'low' priority, load the frame for the
 * app's hour 0 (the bundle download, the slice check and inflate, the vectors into the shared LRU). Nothing is drawn; seam A then
 * finds the pin, the bundle bytes and the vectors in place. A view outside every pilot box, a wide view, ICON/EURO, Save-Data / 2g,
 * an unlisted or explicit-empty set: nothing is fetched. One bundle at most (florida_east_coast was 324 KB live, 2026-10-23).
 * Speed only: the bundle is the stored tile /grid serves for those boxes (D-051), so no served number moves.
 * Kill: window.__RAW_DISABLE_REGIONAL_PREWARM__ = true (or the world prewarm's __RAW_DISABLE_STATIC_FRAMES_PREWARM__, or the
 * bundles' __RAW_DISABLE_REGIONAL_BUNDLES__).
 * Telemetry: window.__RAW_STATIC_REGIONAL__.prewarm = { startedAt, box, set, indexMs, frameMs, frame, skipped }.
 */
import { getPinnedIndex, loadFrameVectors, staticFramesBase, staticFramesEnabled, staticSetEnabled } from './staticFrames';
import { pickIndexFrame } from './staticFrameCodec';
import { PILOT_BOXES, REGIONAL_MODELS, regionalBundlesOn, regionalCapable, regionalSetKey, regionalTelemetry } from './staticRegional';

export const WATCH_MS = 120000;     // look for a regional first view this long after mount
const MAP_WAIT_MS = 30000;          // the map itself may take this long to load
const H = 3600000;
const W = () => (typeof window !== 'undefined' ? window : {});

let _run = null;
export function regionalPrewarmOff(win) {
  const w = win || W();
  return w.__RAW_DISABLE_REGIONAL_PREWARM__ === true || w.__RAW_DISABLE_STATIC_FRAMES_PREWARM__ === true;
}

/** The pilot box id holding this whole view, or null. `b` = { west, south, east, north }. */
export function pilotBoxForView(b) {
  if (!b || !(b.west < b.east) || !(b.south < b.north)) return null;
  const box = PILOT_BOXES.find(([, w, s, e, n]) => b.west >= w && b.east <= e && b.south >= s && b.north <= n);
  return box ? box[0] : null;
}

const boundsOf = (m) => {
  try {
    const b = m.getBounds();
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  } catch (e) { return null; }
};

/** Warm one regional set for this view: pin its index, then (idle, low priority) the hour-0 frame's vectors. Resolves to the
 *  frame's valid time, or null with `rec.skipped` saying why. */
export async function warmRegionalView({ model, layer, bounds, rec, idle }) {
  const id = pilotBoxForView(bounds);
  if (!id) { rec.skipped = 'outside_pilot_boxes'; return null; }
  const key = regionalSetKey(model, layer, id);
  rec.box = id; rec.set = key;
  if (!staticSetEnabled(key)) { rec.skipped = 'set_disabled'; return null; }
  const t0 = Date.now();
  const index = await getPinnedIndex(key).catch(() => null);
  rec.indexMs = Date.now() - t0;
  if (!index) { rec.skipped = 'no_index'; return null; }
  const base = W().__MOCK_DATE_NOW__ || Date.now();
  const frame = pickIndexFrame(index, Math.round(base / H) * H);   // the app's hour 0 (getSeriesAnchorMs)
  if (!frame || !frame.path) { rec.skipped = 'no_frame'; return null; }
  const vectors = await new Promise((resolve) => { idle(() => resolve(loadFrameVectors(key, frame, undefined, { priority: 'low' }))); });
  rec.frameMs = Date.now() - t0;
  rec.frame = vectors ? frame.valid_time : null;
  if (!vectors) rec.skipped = 'frame_failed';
  return rec.frame;
}

/**
 * MapPage calls this at mount with a getter for its map. Once per page load (later calls return the first one's promise).
 * Returns null when it cannot run at all.
 */
export function prewarmRegionalForCamera({ model = 'GFS', layer = 'waves', getMap } = {}) {
  if (_run) return _run;
  const w = W();
  if (typeof window === 'undefined' || regionalPrewarmOff(w) || !regionalBundlesOn() || !regionalCapable()) return null;
  if (!staticFramesEnabled() || !staticFramesBase() || typeof getMap !== 'function') return null;
  const conn = typeof navigator !== 'undefined' ? navigator.connection : null;
  if (conn && (conn.saveData === true || conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g')) return null;
  const m0 = String(model || 'GFS').toUpperCase();
  const rec = { model: m0, layer, startedAt: Date.now(), box: null, set: null, indexMs: null, frameMs: null, frame: null, skipped: null };
  regionalTelemetry().prewarm = rec;
  if (!REGIONAL_MODELS.includes(m0)) { rec.skipped = 'model'; _run = Promise.resolve(null); return _run; }
  const idle = (fn) => (typeof w.requestIdleCallback === 'function' ? w.requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 0));
  const t0 = Date.now();
  _run = new Promise((resolve) => {
    let map = null; let done = false; let busy = false;
    const finish = (v) => { if (done) return; done = true; if (map) { try { map.off('moveend', onSettle); } catch (e) { /* gone */ } } resolve(v); };
    const onSettle = () => {
      if (done) return;
      if (Date.now() - t0 > WATCH_MS) { rec.skipped = rec.skipped || 'no_regional_view'; finish(null); return; }
      const b = boundsOf(map);
      if (busy) return;
      if (!pilotBoxForView(b)) { rec.skipped = 'outside_pilot_boxes'; return; }   // keep watching: the camera may still fly there
      rec.skipped = null; busy = true;
      warmRegionalView({ model: m0, layer, bounds: b, rec, idle }).then(finish, () => { rec.skipped = 'error'; finish(null); });
    };
    const waitMap = () => {
      let m = null;
      try { m = getMap(); if (m && typeof m.getMap === 'function') m = m.getMap(); } catch (e) { m = null; }
      if (!m || typeof m.on !== 'function' || !(typeof m.loaded !== 'function' || m.loaded())) {
        if (Date.now() - t0 > MAP_WAIT_MS) { rec.skipped = 'no_map'; finish(null); return; }
        setTimeout(waitMap, 250);
        return;
      }
      map = m;
      map.on('moveend', onSettle);
      if (!(typeof map.isMoving === 'function' && map.isMoving())) onSettle();
    };
    waitMap();
    setTimeout(() => { if (!done && !busy) { rec.skipped = rec.skipped || 'no_regional_view'; finish(null); } }, WATCH_MS);
  });
  return _run;
}

export function _resetRegionalPrewarmForTest() { _run = null; }

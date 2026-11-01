/**
 * radarFrameHold.js: radar keeps one MapLibre source + layer per frame (now +-2 preloaded) and shows a frame by opacity
 * (MapWebGL's radar frame-layer manager). Measured before (raster lab, 2026-10-22): each step CROSS-FADED for 250 ms (5-11
 * frames with two radar times lit), tiles faded in one by one over 180 ms, and a frame was shown before its tiles had loaded,
 * so the toggle and the first step after it showed 147 (desktop) / 159 (phone) blank frames over the matrix.
 * Now:
 *  - HARD CUT: raster-opacity-transition 0 and raster-fade-duration 0 (an explicit __RAW_RADAR_FADE_MS__ still wins);
 *  - HOLD: the frame on screen stays until the requested frame's source has its tiles loaded, then the swap happens in one
 *    frame. A requested frame with nothing to hold (the first one) is shown as it loads.
 * Kill (both): window.__RAW_DISABLE_RADAR_FRAME_HOLD__ = true (the 250 ms cross-fade and immediate show, as before).
 * Telemetry: window.__RAW_RADAR_FRAME_HOLD__.
 */
import { sourceReady } from './rasterFrameSwap';
import { publishRasterDrawn, getRasterDrawn } from './rasterDrawnFrame';

const W = () => (typeof window !== 'undefined' ? window : {});
export const radarHoldOn = () => W().__RAW_DISABLE_RADAR_FRAME_HOLD__ !== true;
let shown = null;   // the frame layer id on screen (one map)

function tel() {
  const w = W();
  if (!w.__RAW_RADAR_FRAME_HOLD__) w.__RAW_RADAR_FRAME_HOLD__ = { holds: 0, swaps: 0, immediate: 0, shown: null };
  return w.__RAW_RADAR_FRAME_HOLD__;
}

/** Paint for a new frame layer. */
export function radarFrameTiming(fadeMs) {
  if (!radarHoldOn()) return { 'raster-opacity-transition': { duration: 250 }, 'raster-fade-duration': fadeMs };
  const explicit = typeof W().__RAW_RADAR_FADE_MS__ === 'number';
  return { 'raster-opacity-transition': { duration: 0, delay: 0 }, 'raster-fade-duration': explicit ? fadeMs : 0 };
}

export function forgetShownRadarFrame() {
  shown = null;
  const cur = getRasterDrawn();
  if (cur && cur.layer === 'radar') publishRasterDrawn(null);
}

// The status line's pair for radar (rasterDrawnFrame): the frame on screen and the frame asked for, by their times.
function publishPair(shownId, wantId, timeOf) {
  if (typeof timeOf !== 'function') return;
  const end = (id) => (id ? { url: id, dataMs: timeOf(id), model: null, nearestMaxHours: 0 } : null);
  publishRasterDrawn({ layer: 'radar', shown: end(shownId), want: end(wantId) });
}

/**
 * After the manager set the requested frame `wantId` to `opacity` and every other frame to 0: if `wantId` is not loaded yet
 * and another frame was on screen, put that one back and swap when `wantId` is ready. Returns a cleanup for the listener.
 */
export function holdRadarFrame(map, wantId, opacity, timeOf) {
  if (!radarHoldOn() || !map || !wantId) { shown = wantId || null; publishPair(shown, wantId, timeOf); return undefined; }
  const t = tel();
  const prev = shown;
  if (sourceReady(map, wantId) || !prev || prev === wantId || !map.getLayer(prev)) {
    shown = wantId; t.immediate += 1; t.shown = shown;
    // Nothing to hold (the first frame): shown as it loads; the pair says "Loading" until its tiles are in.
    publishPair(sourceReady(map, wantId) || prev === wantId ? wantId : null, wantId, timeOf);
    if (!sourceReady(map, wantId) && prev !== wantId) {
      const onFirst = () => { if (!sourceReady(map, wantId)) return; publishPair(wantId, wantId, timeOf); map.off('sourcedata', onFirst); map.off('idle', onFirst); };
      map.on('sourcedata', onFirst); map.on('idle', onFirst);
      return () => { map.off('sourcedata', onFirst); map.off('idle', onFirst); };
    }
    return undefined;
  }
  try { map.setPaintProperty(wantId, 'raster-opacity', 0); map.setPaintProperty(prev, 'raster-opacity', opacity); } catch (e) { return undefined; }
  t.holds += 1;
  publishPair(prev, wantId, timeOf);
  const onData = () => {
    if (!sourceReady(map, wantId)) return;
    try { map.setPaintProperty(wantId, 'raster-opacity', opacity); if (map.getLayer(prev)) map.setPaintProperty(prev, 'raster-opacity', 0); } catch (e) { /* style changing */ }
    shown = wantId; t.swaps += 1; t.shown = shown;
    publishPair(wantId, wantId, timeOf);
    map.off('sourcedata', onData); map.off('idle', onData);
  };
  map.on('sourcedata', onData); map.on('idle', onData);
  return () => { map.off('sourcedata', onData); map.off('idle', onData); };
}

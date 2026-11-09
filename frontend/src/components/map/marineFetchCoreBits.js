/**
 * marineFetchCoreBits.js - small pure helpers lifted out of useMarineDataFetcherCore.js (2026-11-08), which is LOC-capped
 * (.github/loc-baseline.json): the phantom-detach test, the per-column cell size, and the lane-switch regional-first commit.
 */
import { pickLaneSwitchRegionalFrame } from './marineLaneSwitchFrame';

// A fetch that already LANDED has no live registry entry (its finally completed it): nothing was abandoned, so the caller logs
// nothing. The preStart site used to log 'detach' for every fetch start after a finished one (97 phantoms in the owner's pan capture).
export function isAbandonedLive(inFlight, controller) {
  if (!inFlight || typeof inFlight.find !== 'function') return true;
  const live = inFlight.find(controller.__intent);
  return !!live && live.controller === controller;
}

export function cellDegOf(g) {
  const b = g && g.bounds;
  if (!b || !g.cols || g.cols < 2) return null;
  const w = (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west;
  return w / g.cols;
}

// LANE-SWITCH REGIONAL-FIRST (marineLaneSwitchFrame.js): a switch asks for the WORLD box; draw the cached regional window first.
// Best-effort: the normal fetch that follows stays the truth path. Kill: window.__RAW_DISABLE_LANE_SWITCH_REGIONAL_FIRST__ = true.
export function commitLaneSwitchRegionalFirst({ mapInstance, resident, model, layer, hour, wantSurf, getFrame, record, commit }) {
  try {
    const vb = mapInstance.getBounds();
    const viewport = { west: vb.getWest(), south: vb.getSouth(), east: vb.getEast(), north: vb.getNorth() };
    const w = typeof window !== 'undefined' ? window : {};
    const frame = pickLaneSwitchRegionalFrame({
      disabled: w.__RAW_DISABLE_LANE_SWITCH_REGIONAL_FIRST__ === true || !!w.isScrubbingTimeline,
      resident, model, layer, hour, wantSurf, getFrame, viewport,
    });
    if (!frame) return false;
    record('lane_switch_regional_first', { dims: `${frame.grid.cols}x${frame.grid.rows}`, hour });
    commit(frame, viewport, 'lane_switch_regional_first');
    return true;
  } catch (e) { return false; }
}

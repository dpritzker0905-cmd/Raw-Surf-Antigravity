/**
 * marineLaneSwitchFrame.js - on a lane (model / layer) switch, draw the cached REGIONAL window before the 2 deg world frame (2026-11-08).
 *
 * THE SCENE (live on dev, FL east coast, measured from __MARINE_RENDER_SOURCE_DIAG__): every lane switch committed the 2 deg world frame
 * (181 x 83 = 15023 vectors) and/or a 2 deg clip (72/81/30/36) before the finer regional window (169-525 vectors) landed seconds later.
 * Cause: a switch is an ACTIVATION source, whose fetch asks for the WORLD box (handleRegionalGridClearing), and the only cache fast path
 * (flavor_cache_fastpath) looks up the series with THAT world box, so the regional window the series cache already holds for the target
 * lane is never offered first.
 *
 * THE RULE: when the resident is another lane's frame and the series cache holds a REGIONAL frame for the target lane/hour/flavour that
 * COVERS the real viewport at a regional zoom, return it for an immediate commit (the network fetch proceeds unchanged for freshness).
 * Pure; the caller supplies the lookup. Kill: window.__RAW_DISABLE_LANE_SWITCH_REGIONAL_FIRST__ = true. Ring: lane_switch_regional_first.
 */
import { coversViewport, boundsWidth } from './marineScrubHold';

const WORLD_SPAN_DEG = 340;
const REGIONAL_VIEW_MAX_SPAN_DEG = 15;

export function pickLaneSwitchRegionalFrame({ disabled, resident, viewport, model, layer, hour, wantSurf, getFrame }) {
  if (disabled || !viewport || typeof getFrame !== 'function') return null;
  const rg = resident && resident.grid;
  if (!rg || !rg.vectors || !rg.vectors.length) return null;
  const laneChanged = rg.__sourceModel !== model || (rg.__componentLayer || 'waves') !== layer;
  if (!laneChanged) return null;
  if (boundsWidth(viewport) >= REGIONAL_VIEW_MAX_SPAN_DEG || (viewport.north - viewport.south) >= REGIONAL_VIEW_MAX_SPAN_DEG) return null;
  let frame = null;
  try { frame = getFrame(model, layer, viewport, hour); } catch (e) { return null; }
  const g = frame && frame.grid;
  if (!g || !Array.isArray(g.vectors) || !g.vectors.length || g.__renderable === false || g.renderable === false) return null;
  if (!g.bounds || boundsWidth(g.bounds) >= WORLD_SPAN_DEG || !coversViewport(g.bounds, viewport)) return null;
  if (!!g.ratingMode !== !!wantSurf) return null;
  return frame;
}

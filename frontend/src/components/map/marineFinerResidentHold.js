/**
 * marineFinerResidentHold.js - never swap a FINER resident grid for a COARSER one of the same frame (2026-11-08).
 *
 * THE SCENE (owner, live on dev, ICON Wind Waves, zoomed in off Florida's east coast): the heatmap "bounces", flashes a coarse blocky
 * look, then resharpens, on every ordinary pan. Instrumentation showed each pan's moveend fetch followed 0.2-1.0 s later by a
 * clamp_resharpen fetch. The decode (useMarineDataFetcherCore.js, marineFinerResidentHold.test.js):
 *   1. the pan's moveend fetch asks for a snapped, viewport-padded box (marineController.getSnapConfig) and the resolver answers it with
 *      the clipped MID product (2 deg cells, a handful of columns) - not the 0.25 deg tile (21 x 25 = 525 vectors) already drawn;
 *   2. commitMarineData offers that to React state with no resolution test (the short-circuit needs the SAME productId, and the mid
 *      product and the fine tile have different ids; the engine's no-downgrade guard only refuses WORLD grids), so the coarse grid
 *      replaces the fine one although the fine one still covers the whole viewport: the "clamped" look, plus a texture re-allocation and
 *      a particle reset (the "bounce");
 *   3. detectClamp then reads regional_too_coarse (cells > 0.3 deg, < 8 across) and the settle backstop runs clamp_resharpen (a TIGHT
 *      fetch), which brings the fine tile back. The fetch the owner's console logged as "detach" at updateMarineGrid_preStart was NOT
 *      an abandoned fetch: the dispatch slot is single, a clamp_resharpen asked while a pan fetch is in flight is skipped by the
 *      same-target dedup, so by preStart the pan fetch had already landed and its registry entry was gone (the log is now silent then).
 *
 * THE RULE: hold the resident when the incoming REGIONAL grid is the same frame (model, layer, hour, valid time, run time, flavour,
 * fresh) and is not finer per cell (coarser, or the same-cell clip: the 2 deg clip <-> clip ping-pong after pans), while the resident still contains the viewport the request was made for. Nothing is lost: the
 * resident draws every pixel the incoming one would, finer. NOT held (commits as before): a resident that does not contain the
 * viewport (a pan off the tile - the coarse grid is then the covering fallback and the clamp lane sharpens it), a different run or
 * hour, a finer or similar incoming grid, a stale or non-renderable resident, a world grid on either side.
 * Pure. Kill: window.__RAW_DISABLE_FINER_RESIDENT_HOLD__ = true. Telemetry: __MARINE_FINER_HELD__ {count, last}.
 */
import { coversViewport, boundsWidth } from './marineScrubHold';

export const SAME_CELL_FLOOR = 0.95;   // incoming cell >= 95% of the resident's = not finer: nothing to gain, hold
const WORLD_SPAN_DEG = 340;

const readRunTime = (d) => d?.run_time ?? d?.runTime ?? d?.grid?.run_time ?? d?.grid?.runTime ?? null;
const readHour = (d) => { const h = d?.hourOffset ?? d?.grid?.hourOffset; return typeof h === 'number' ? h : null; };

// Cell size (deg) on the coarser axis, the same measure as detectClamp's cellDeg; NaN when the grid has none.
export function gridCellDeg(g) {
  if (!g || !g.bounds || !(g.cols > 0) || !(g.rows > 0)) return NaN;
  return Math.max(boundsWidth(g.bounds) / g.cols, (g.bounds.north - g.bounds.south) / g.rows);
}

/**
 * @returns {false | object} false = commit normally; object = hold detail (telemetry).
 * `viewport` = { west, south, east, north } the request was made for.
 */
export function shouldHoldFinerResident({ disabled, prev, incoming, viewport }) {
  if (disabled || !viewport) return false;
  const pg = prev && prev.grid, ng = incoming && incoming.grid;
  if (!pg || !ng || !pg.vectors || !pg.vectors.length || !ng.vectors || !ng.vectors.length) return false;
  if (ng.renderable === false || pg.renderable === false || prev.__renderable === false) return false;
  if (prev.stale || pg.stale || incoming.stale || ng.stale) return false;
  if (pg.__sourceModel !== ng.__sourceModel || pg.__componentLayer !== ng.__componentLayer) return false;
  const ph = readHour(prev), nh = readHour(incoming);
  if (ph === null || nh === null || ph !== nh) return false;
  if (!!pg.ratingMode !== !!ng.ratingMode) return false;
  const pvt = pg.validTime ?? prev.validTime ?? pg.valid_time ?? prev.valid_time ?? null;
  const nvt = ng.validTime ?? incoming.validTime ?? ng.valid_time ?? incoming.valid_time ?? null;
  if (pvt && nvt && pvt !== nvt) return false;
  const prt = readRunTime(prev), nrt = readRunTime(incoming);
  if (prt && nrt && prt !== nrt) return false;   // a new run is fresher data, however coarse
  // The frame must be PROVABLY the same one: a known run or a known valid time on both sides (never hold across an unlabelled refresh).
  if (!((prt && nrt) || (pvt && nvt))) return false;
  if (!pg.bounds || !ng.bounds) return false;
  if (boundsWidth(pg.bounds) >= WORLD_SPAN_DEG || boundsWidth(ng.bounds) >= WORLD_SPAN_DEG) return false;
  if (!coversViewport(pg.bounds, viewport)) return false;
  const pc = gridCellDeg(pg), nc = gridCellDeg(ng);
  // Not meaningfully FINER (5% jitter): a coarser grid, or a same-cell clip of the same product (the post-pan 2 deg clip <-> clip
  // ping-pong adds no information while the resident still covers the viewport). A meaningfully finer grid always commits.
  if (!Number.isFinite(pc) || !Number.isFinite(nc) || !(nc >= pc * SAME_CELL_FLOOR)) return false;
  return { hour: nh, residentDims: `${pg.cols}x${pg.rows}`, incomingDims: `${ng.cols}x${ng.rows}`,
    residentCell: +pc.toFixed(3), incomingCell: +nc.toFixed(3) };
}

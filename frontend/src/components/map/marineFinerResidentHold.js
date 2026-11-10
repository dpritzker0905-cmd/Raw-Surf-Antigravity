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
import { marineFrameInstant } from './marineFrameInstant';

// WORLD OVER REGIONAL (2026-11-08, live: ICON wind_waves at z9, a 13x17 regional drew at t=0.1 s, the 181x83 world frame replaced it at
// t=1.6 s and stayed ~17 s until a pan). Verified in the engine: setWaveData only refuses a world grid via the no-downgrade guard, whose
// "same frame" test needs served_valid_time on BOTH frames (an unlabelled one fails open), and a refused world grid is stashed BEFORE the
// coarse-base capture, so holding it here feeds the base wash exactly as the guard does. Only at a regional viewport (< 15 deg span); a
// zoom-out leaves the viewport uncovered by the resident, which releases the hold. Kill: __RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__.
function worldOverRegionalHeld(disabledWorld, viewport) {
  if (disabledWorld) return false;
  return boundsWidth(viewport) < REGIONAL_VIEW_MAX_SPAN_DEG && (viewport.north - viewport.south) < REGIONAL_VIEW_MAX_SPAN_DEG;
}
const REGIONAL_VIEW_MAX_SPAN_DEG = 15;

export const SAME_CELL_FLOOR = 0.95;   // incoming cell >= 95% of the resident's = not finer: nothing to gain, hold
const WORLD_SPAN_DEG = 340;

const readRunTime = (d) => d?.run_time ?? d?.runTime ?? d?.grid?.run_time ?? d?.grid?.runTime ?? null;
// THE MODEL CYCLE, NOT THE INGEST STAMP (2026-11-09, measured live): `run_time` on a served grid is when OUR ingest minted the product,
// so two ingests of one cycle carry two stamps (ICON wind_waves: world 12:11:11Z vs regional 13:23:19Z, both model_run_time 00Z, valid
// 18Z) and the hold released them as "a new run". When BOTH frames name a zoned model cycle, that decides; else the old run_time check.
const CYCLE_KEYS = ['model_run_time', 'modelRunTime', '__readoutModelRun'];
// THE /grid COMMIT PATH (2026-11-09, offline scn_ingest_skew_hold.js): the marine /grid conform (backendWeatherServiceClientHelpers.js)
// rebuilds the grid field by field and carries the cycle ONLY in its diagnostic frameReceipt (modelRunTime + modelRunTimeStatus), so a
// /grid-committed regional had no cycle here, the rule fell back to the ingest stamps and released the world frame as "run". The receipt's
// cycle counts only when it is VERIFIED ('known'); the conform itself is untouched (its run-identity fields feed other modules).
const receiptCycle = (r) => (r && r.modelRunTimeStatus === 'known' && instantOf(r.modelRunTime) !== null ? r.modelRunTime : null);
function readModelCycle(d) {
  for (const o of [d?.grid, d, d?.grid?.truthTag, d?.truthTag]) {
    if (!o) continue;
    for (const k of CYCLE_KEYS) if (instantOf(o[k]) !== null) return o[k];
  }
  return receiptCycle(d?.grid?.frameReceipt) || receiptCycle(d?.frameReceipt);
}
const readHour = (d) => { const h = d?.hourOffset ?? d?.grid?.hourOffset; return typeof h === 'number' ? h : null; };
// SAME CLOCK, ANY SPELLING (2026-11-09): /grid serialises its times through pydantic, /grid_series through strftime, and a world frame can
// reach the commit through either. Equal strings, or two zoned ISO strings that name the same instant; never a guess across zones.
const instantOf = (s) => (typeof s === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(s) && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null);
function sameTime(a, b) { if (a === b) return true; const x = instantOf(a), y = instantOf(b); return x !== null && x === y; }
// The frame the backend actually SERVED (marineFrameInstant: the strict served_valid_time), on the grid or its wrapper; null when unknown.
const readServed = (d) => { const g = marineFrameInstant(d && d.grid); return g !== null ? g : marineFrameInstant(d); };

// Cell size (deg) on the coarser axis, the same measure as detectClamp's cellDeg; NaN when the grid has none.
export function gridCellDeg(g) {
  if (!g || !g.bounds || !(g.cols > 0) || !(g.rows > 0)) return NaN;
  return Math.max(boundsWidth(g.bounds) / g.cols, (g.bounds.north - g.bounds.south) / g.rows);
}

/**
 * @returns {false | object} false = commit normally; object = hold detail (telemetry).
 * `viewport` = { west, south, east, north } the request was made for.
 */
export function shouldHoldFinerResident(args) {
  const d = finerResidentHoldDecision(args);
  return d.hold ? d.detail : false;
}

/**
 * The same rule with its REASON (2026-11-09; the commit choke, marineCommitChoke.js, reads it so a live release names its guard):
 * { hold: true, detail } or { hold: false, reason }.
 * SAME FRAME, PROVABLY: model, layer, flavour and run (compared as instants) equal, and EITHER the same served instant on both sides (the
 * physical frame; hour labels and ask echoes can differ at 3-hourly range, marineFrameInstant.js) OR the same hour label and valid time.
 * Two known served instants that differ are two frames, whatever the labels say.
 */
export function finerResidentHoldDecision({ disabled, prev, incoming, viewport, liveViewport, disabledWorld }) {
  const no = (reason) => ({ hold: false, reason });
  if (disabled) return no('disabled');
  if (!viewport) return no('no_viewport');
  const pg = prev && prev.grid, ng = incoming && incoming.grid;
  if (!pg || !ng || !pg.vectors || !pg.vectors.length || !ng.vectors || !ng.vectors.length) return no('no_vectors');
  if (ng.renderable === false || pg.renderable === false || prev.__renderable === false) return no('not_renderable');
  if (prev.stale || pg.stale || incoming.stale || ng.stale) return no('stale');
  if (pg.__sourceModel !== ng.__sourceModel || pg.__componentLayer !== ng.__componentLayer) return no('model_or_layer');
  const ps = readServed(prev), ns = readServed(incoming);
  if (ps !== null && ns !== null && ps !== ns) return no('served_instant');
  const sameServed = ps !== null && ps === ns;
  const ph = readHour(prev), nh = readHour(incoming);
  if (!sameServed && (ph === null || nh === null || ph !== nh)) return no('hour');
  if (!!pg.ratingMode !== !!ng.ratingMode) return no('flavour');
  const pvt = pg.validTime ?? prev.validTime ?? pg.valid_time ?? prev.valid_time ?? null;
  const nvt = ng.validTime ?? incoming.validTime ?? ng.valid_time ?? incoming.valid_time ?? null;
  if (!sameServed && pvt && nvt && !sameTime(pvt, nvt)) return no('valid_time');
  const pcy = readModelCycle(prev), ncy = readModelCycle(incoming);
  const byCycle = pcy !== null && ncy !== null;
  const prt = byCycle ? pcy : readRunTime(prev), nrt = byCycle ? ncy : readRunTime(incoming);
  if (prt && nrt && !sameTime(prt, nrt)) return no('run');   // a new run is fresher data, however coarse
  // The frame must be PROVABLY the same one: a known run, valid time or served instant on both sides (never hold across an unlabelled
  // refresh).
  if (!((prt && nrt) || (pvt && nvt) || sameServed)) return no('unlabelled');
  if (!pg.bounds || !ng.bounds) return no('no_bounds');
  if (boundsWidth(pg.bounds) >= WORLD_SPAN_DEG) return no('world_resident');
  // A switch / activation asks for the WORLD box, so the request box is no evidence of what the user sees: judge a world incoming
  // against the live map viewport (the caller reads it), never against the request.
  const worldIn = boundsWidth(ng.bounds) >= WORLD_SPAN_DEG;
  const vp = worldIn ? (liveViewport || viewport) : viewport;
  if (worldIn && !worldOverRegionalHeld(disabledWorld, vp)) return no(disabledWorld ? 'world_disabled' : 'wide_view');
  if (!coversViewport(pg.bounds, vp)) return no('resident_not_covering');
  const pc = gridCellDeg(pg), nc = gridCellDeg(ng);
  // Not meaningfully FINER (5% jitter): a coarser grid, or a same-cell clip of the same product (the post-pan 2 deg clip <-> clip
  // ping-pong adds no information while the resident still covers the viewport). A meaningfully finer grid always commits.
  if (!Number.isFinite(pc) || !Number.isFinite(nc) || !(nc >= pc * SAME_CELL_FLOOR)) return no('incoming_finer');
  return { hold: true, detail: { hour: nh !== null ? nh : ph, residentDims: `${pg.cols}x${pg.rows}`, incomingDims: `${ng.cols}x${ng.rows}`,
    residentCell: +pc.toFixed(3), incomingCell: +nc.toFixed(3), ...(worldIn ? { world: true } : {}),
    ...(sameServed && ph !== nh ? { byServedInstant: true } : {}) } };
}

// The live map viewport for the world-over-regional judgement; null when no map is reachable (the hold then falls back to the request box).
export function readLiveViewport(win) {
  try {
    const w = win || (typeof window !== 'undefined' ? window : null);
    const b = w && w.map && typeof w.map.getBounds === 'function' ? w.map.getBounds() : null;
    return b ? { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() } : null;
  } catch (e) { return null; }
}

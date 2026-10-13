/**
 * marineStaleHour.js — which hour a world frame was made for, against the hour that is selected
 * (2026-10-01; owner: "keep it on, defer the flip, now fix the wrong-hour frame"; audit finding F-21).
 * PURE on purpose: the engine imports it, and the engine's module graph must not grow a dependency on the backend client (the
 * manifest-reading half lives in marineStaleHourLayer.js, which only the custom layer imports). Its one import, the arbiter's
 * classifier of a 2-degree world base (marineCommitArbiter: isFineWorldBase and FINE_BASE_MAX_CELL_DEG), is itself pure and imports nothing.
 *
 * THE DEFECT. Select Wednesday at a regional zoom, zoom out: for 3 to 9 s live (3.2 to 3.8 s on the offline mock) the field on
 * screen is the world frame the page loaded with, the "now" hour (swell 0.78 m where Wednesday reads 2.33 m), at FULL strength
 * with its crest animation, while the readout says "Wed 11 AM". The engine keeps ONE coarse base per model|layer|flavor for the zoom-out bridge
 * (`_coarseBaseData`), refreshed only when a world frame COMMITS, and the bridge promotes it whatever hour it is for. The
 * prewarm that stages a right-hour seed was refused whenever a base for the same model and layer existed (the hour was never
 * asked), and the engine discarded the seed for the same reason: the base only ever followed the last world commit. The
 * frame was not wrong because of a race: nothing in the client held an hour on the base at all.
 *
 * THE FIX IS FOUR SMALL RULES, each with a kill switch, none of them in the engine's paint code:
 *   1. A right-hour seed REPLACES a base made for another hour (`coarseBaseStaleForSeed`: the engine's seed-consume test and
 *      the prewarm's staging gate both read it). Where the client holds right-hour world data (a warmed series frame, a cached
 *      world grid) the bridge promotes THAT and no wrong hour is drawn. Kill: __RAW_DISABLE_BASE_HOUR_SYNC__.
 *   2. Where it holds none (a page that has never been zoomed out for this hour: the first seconds of a session, and every far
 *      hour not yet visited) the zoom-out still needs SOMETHING on screen: a blank is the defect class the bridge exists to
 *      prevent ("dim reads as loading; blank reads as a bug", engine comments). A WORLD frame more than a 3-hourly step and
 *      a half from the selected instant is drawn at a fraction of its strength until the right hour arrives
 *      (`resolveStaleWorldDim`): provisional, not presented as the selected hour. Only after the hour has held still for
 *      STALE_HOLD_MS (a scrub moves the hour every few hundred ms and must not flicker), never for a regional frame.
 *      Kill: __RAW_DISABLE_STALE_HOUR_DIM__. Tune: __RAW_STALE_HOUR_DIM__ (default 0.4).
 *   3. (marineWorldWarmOnSettle.js, marineGlobalPrewarm.js) once the hour has held still at a regional zoom, the existing prewarm is
 *      asked for that hour's world grid FIRST, not behind the world series page, which holds the background lane's single slot while
 *      it loads, so the grid can seed the base before a zoom-out. Where the fetch path's own prewarm call already owns the grid (a page
 *      that has just opened) it cannot go first, and rule 2 covers that window. Kill: __RAW_DISABLE_HOUR_WORLD_WARM__,
 *      __RAW_DISABLE_WORLD_GRID_FIRST__.
 *   4. A seed that lands AFTER the zoom-out replaces the base, but not the frame already drawn (the old promotion of the old base):
 *      `staleResidentSwapWanted` lets the engine's per-frame bridge promote the base over a stale world resident, in the frame the
 *      layer judged it stale. Kill: __RAW_DISABLE_STALE_RESIDENT_SWAP__.
 *
 * "The hour a frame is for" is its VALID TIME (served first, then the ask's echo, then the truth tag), never its hourOffset
 * label: at 3-hourly range the frames serving one hour carry different labels (marineExactUpgrade.js, L-F10). An unknown valid
 * time on either side fails OPEN (nothing replaced, nothing dimmed): the old behaviour, never a guess.
 *
 * TWO MORE RULES (2026-10-02; owner: "keep the 2 degree frame for the selected hour at every zoom in that range"; the follow-up to the F-22
 * base-aware bridge, which only promotes a held 2-degree base for the selected hour, so WHAT THE ENGINE HOLDS decides whether it acts). The
 * base was whatever coarse-global grid committed last (per model | layer | flavor slot), so on the F-22 build a thin 8-degree series frame
 * (the backend's `decimated_stride`, 46 x 20) committed at a world view replaced the exact frame held for the same data, and once it was held
 * the exact frame could not come back through the seed path. Both are judged on the DATA, never the label: the valid time within the snapped
 * step (SAME_STEP_TOL_MS), the same model run when both name one, the same rating flavor; an unknown time fails open (the old behaviour).
 *   5. `heldBaseKeeps`: an EXACT base (marineCommitArbiter.isFineWorldBase) is not replaced by a COARSER world frame of the same data (the
 *      engine's `_captureCoarseBase` asks first). A frame of another step, of an equal or finer lattice, or of another model run replaces it.
 *   6. `coarseBaseOutdatedBy` (so `coarseBaseStaleForSeed` and the prewarm's `_coarseBaseMatches`): a 2-degree seed REPLACES a coarser base of
 *      the same data, so the world warm's landing, or the cached world grid, restores the exact base over a thin one.
 * Kill (both): __RAW_DISABLE_BASE_HOLD__. Telemetry: window.__MARINE_BASE_HOLD__ { kept }. The world warm's band half is in marineGlobalPrewarm.js.
 * (__RAW_DISABLE_BASE_HOUR_SYNC__ alone no longer restores the pre-F-21 identity-only seed gate: rule 6 still replaces a coarser base; set both to get it back.)
 * KNOWN LIMITS: the grids the engine holds often name their run on one side only (the commit path's conform carries no `model_run_time`), and then the data time
 * alone decides; a late frame for ANOTHER step still replaces an exact base for the selected hour (the F-21 rule, unchanged: `engine.__selectedMs` could veto it).
 */
import { isFineWorldBase, FINE_BASE_MAX_CELL_DEG } from './marineCommitArbiter';

export const HOUR_MS = 3600000;
/** Two frames of the same model step (or one step and the nearest-step snap of it) differ by less than this. */
export const SAME_STEP_TOL_MS = 1.5 * HOUR_MS + 60000;
/** A world frame this far from the selected instant is a different hour, not a snap: more than a 3-hourly step and a half. */
export const STALE_DIM_MIN_MS = 3.5 * HOUR_MS;
/** The strength of a stale world frame, against 1 (the engine's own provisional floors are 0.3 to 0.7). */
export const STALE_WORLD_DIM = 0.4;
/** The selected hour must have held still this long before a stale world frame is dimmed (a scrub never flickers). */
export const STALE_HOLD_MS = 600;
export const WORLD_MIN_SPAN_DEG = 340;

function lngSpan(b) {
  return b.east < b.west ? (b.east + 360) - b.west : b.east - b.west;
}

/** Valid time of a grid, a held base (`.waveGrid`) or a marineData wrapper (`.grid`), in ms: served first, then the ask's echo, then the truth tag; null if unknown. */
export function gridValidMs(x) {
  if (!x) return null;
  const g = x.waveGrid || x.grid || x;
  const t = x.served_valid_time || x.valid_time || g.served_valid_time || g.valid_time
    || (g.truthTag && g.truthTag.valid_time) || (x.truthTag && x.truthTag.valid_time) || null;
  const ms = t ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

const gridOf = (x) => (x ? (x.waveGrid || x.grid || x) : null);

/** The longitude cell of a grid that spans the world (359 degrees or more, the engine's coarse-global width), else null. */
function worldCellDeg(g) {
  if (!g || !g.bounds || !(g.cols > 0)) return null;
  const span = lngSpan(g.bounds);
  return span >= 359.0 ? span / g.cols : null;
}

/**
 * The model run a grid (or a wrapper) names, as the best identity it carries: the VERIFIED cycle (`model_run_time` with `model_run_time_status` 'known', a
 * series frame's provenance) and the INGEST clock (`run_time`, on the grid or its wrapper). Either may be null.
 */
function runOf(x) {
  const g = gridOf(x);
  const cycle = g && g.model_run_time && g.model_run_time_status === 'known' ? g.model_run_time : null;
  const ingest = (x && x.run_time) || (g && g.run_time) || null;
  return { cycle, ingest };
}

/**
 * An instant in whole seconds since the epoch, fractions dropped: /grid serves the ingest clock with microseconds ("2026-09-30T23:34:21.292482Z"), /grid_series
 * truncates it to whole seconds ("...:21Z", backend grid_series_viewport._frame_provenance), and both name ONE run. Null when it does not parse.
 */
function wholeSeconds(s) {
  const ms = Date.parse(String(s).replace(/(\d\d:\d\d:\d\d)\.\d+/, '$1'));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
function sameInstant(s, t) {
  const a = wholeSeconds(s), b = wholeSeconds(t);
  return a !== null && b !== null ? a === b : String(s) === String(t);
}

/**
 * The same data: valid times known and within a snapped step, and the same model run: the verified cycle when BOTH name one, else the ingest clock when both
 * name that (whole seconds), else (a run unnamed on one side, which the grids the engine holds often are) the data time alone decides. Another run may be the
 * fresher data, so two named runs that differ are not the same data.
 */
function sameData(a, b) {
  const ma = gridValidMs(a), mb = gridValidMs(b);
  if (ma === null || mb === null || Math.abs(ma - mb) > SAME_STEP_TOL_MS) return false;
  const ra = runOf(a), rb = runOf(b);
  if (ra.cycle && rb.cycle) return sameInstant(ra.cycle, rb.cycle);
  if (ra.ingest && rb.ingest) return sameInstant(ra.ingest, rb.ingest);
  return true;
}

/** The same slot of the engine's base LRU: model, layer and rating flavor (the engine's coarseBaseLruKey; the finer coarseBaseKey also holds dims, bounds and the hour label). */
function sameSlot(a, b) {
  return (a.__sourceModel || 'GFS') === (b.__sourceModel || 'GFS') &&
    (a.__componentLayer || 'waves') === (b.__componentLayer || 'waves') &&
    !!a.ratingMode === !!b.ratingMode;
}

/** Rule 6: a 2-degree seed against a coarser base of the same data (a thin or 10-degree placeholder). */
function seedUpgradesBase(base, seed, w) {
  if (w && w.__RAW_DISABLE_BASE_HOLD__ === true) return false;
  const bg = gridOf(base), sg = gridOf(seed);
  if (!bg || !sg || !(worldCellDeg(bg) > FINE_BASE_MAX_CELL_DEG) || !isFineWorldBase(sg)) return false;
  return sameSlot(bg, sg) && sameData(bg, sg);
}

/**
 * True when the seed should REPLACE the held base: they are made for different hours (both valid times known and further apart than a snap), or the
 * seed is a 2-degree frame of the same data as a coarser base (rule 6, 2026-10-02).
 */
export function coarseBaseOutdatedBy(base, seed, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  const a = gridValidMs(base), b = gridValidMs(seed);
  if (!(w && w.__RAW_DISABLE_BASE_HOUR_SYNC__ === true) && a !== null && b !== null && Math.abs(a - b) > SAME_STEP_TOL_MS) return true;
  return seedUpgradesBase(base, seed, w);
}

/**
 * Rule 5, the engine's capture question (`_captureCoarseBase`): is a held EXACT base for this very data, so the incoming COARSER world frame must
 * not replace it? `lru` is the engine's per-slot map of base sets (or null when the LRU is off), `pointer` the displayed base, `incoming` the
 * grid about to be captured (a coarse-global grid: the only kind the engine ever holds as a base). Counted in window.__MARINE_BASE_HOLD__.kept.
 */
export function heldBaseKeeps(lru, pointer, incoming, win) {
  try {
    const w = win || (typeof window !== 'undefined' ? window : null);
    if (w && w.__RAW_DISABLE_BASE_HOLD__ === true) return false;
    const ig = gridOf(incoming);
    if (!(worldCellDeg(ig) > FINE_BASE_MAX_CELL_DEG)) return false;      // only a coarser world lattice can be kept out
    const held = [pointer];
    if (lru && typeof lru.values === 'function') for (const b of lru.values()) held.push(b);
    for (const b of held) {
      const bg = gridOf(b);
      if (bg && isFineWorldBase(bg) && sameSlot(bg, ig) && sameData(bg, ig)) {
        if (w) { const t = w.__MARINE_BASE_HOLD__ = w.__MARINE_BASE_HOLD__ || { kept: 0 }; t.kept++; }
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;                                                          // best effort: the old behaviour (the frame replaces the base)
  }
}

/**
 * The engine's seed-consume question: should this staged seed REPLACE the held base? The old test was identity only (no
 * base, another model, another layer); the hour is now part of it. `base` is the engine's `_coarseBaseData` (with
 * `.waveGrid`), `seed` the staged grid.
 */
export function coarseBaseStaleForSeed(base, seed, win) {
  return !base ||
    (base.__sourceModel || 'GFS') !== (seed.__sourceModel || 'GFS') ||
    (base.__componentLayer || 'waves') !== (seed.__componentLayer || 'waves') ||
    coarseBaseOutdatedBy(base, seed, win);
}

/** True for a WORLD-width grid. */
export function isWorldGrid(grid) {
  return !!(grid && grid.bounds && lngSpan(grid.bounds) >= WORLD_MIN_SPAN_DEG);
}

/** True when `resident` is a WORLD frame made for a different hour than `selectedMs` (both times known; unknown fails open). */
export function isStaleWorldGrid(resident, selectedMs) {
  if (!isWorldGrid(resident)) return false;
  const rMs = gridValidMs(resident);
  return rMs !== null && Number.isFinite(selectedMs) && Math.abs(rMs - selectedMs) >= STALE_DIM_MIN_MS;
}

/**
 * True when `grid` is a WORLD frame made for the selected hour: its valid time known and within a snapped step (SAME_STEP_TOL_MS) of `selectedMs`.
 * Unknown on either side is FALSE (fails CLOSED): the base-aware bridge (marineCommitGate, audit F-22) promotes a held base only when this says yes,
 * because a promotion is a new action and an unknown hour must keep the old rule. (isStaleWorldGrid above fails open, for the dim and the swap.)
 */
export function isWorldGridForSelectedHour(grid, selectedMs) {
  if (!isWorldGrid(grid) || !Number.isFinite(selectedMs)) return false;
  const ms = gridValidMs(grid);
  return ms !== null && Math.abs(ms - selectedMs) <= SAME_STEP_TOL_MS;
}

/**
 * The engine's per-frame bridge question when the RESIDENT is itself a world frame (the half the seed rule cannot reach): a right-hour
 * seed that lands after the zoom-out replaces the held base, but the frame already DRAWN is the old promotion of the old base, and the
 * pipeline's own commit is a network round trip away. Promote the base over it when the resident is a world frame at least a step and a
 * half from the selected instant, the held base is a world frame for the selected hour, and both are the same model, layer and
 * surf-rating flavor. `selectedMs` is the layer's: it is passed only in the frame the layer judged the resident stale and the hour held
 * still. Kill: __RAW_DISABLE_STALE_RESIDENT_SWAP__.
 */
export function staleResidentSwapWanted(resident, base, selectedMs, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (w && w.__RAW_DISABLE_STALE_RESIDENT_SWAP__ === true) return false;
  if (!resident || !base || !Number.isFinite(selectedMs)) return false;
  if ((resident.__sourceModel || 'GFS') !== (base.__sourceModel || 'GFS')) return false;
  if ((resident.__componentLayer || 'waves') !== (base.__componentLayer || 'waves')) return false;
  if (!!resident.ratingMode !== !!base.ratingMode) return false;
  if (!isStaleWorldGrid(resident, selectedMs)) return false;
  const bMs = gridValidMs(base);
  return isWorldGrid(base) && bMs !== null && Math.abs(bMs - selectedMs) <= SAME_STEP_TOL_MS;
}

/**
 * The judgment, pure, with no kill switch (each consumer, the dim and the resident swap, has its own): is the drawn frame a WORLD frame
 * for another hour than the selected one, and has the hour held still? ctx: { resident (the drawn grid), selectedMs, hourHeldMs, win }.
 * Returns { stale, why }; `why` is 'stale_world' only when the consumer may act.
 */
export function judgeStaleWorld(ctx) {
  const { resident, selectedMs, hourHeldMs, win } = ctx || {};
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!isWorldGrid(resident)) return { stale: false, why: 'not_world' };
  if (gridValidMs(resident) === null || !Number.isFinite(selectedMs)) return { stale: false, why: 'unknown_time' };   // fail open
  if (!isStaleWorldGrid(resident, selectedMs)) return { stale: false, why: 'same_step' };
  if (w && w.isScrubbingTimeline) return { stale: true, why: 'scrubbing' };
  if (!(hourHeldMs >= STALE_HOLD_MS)) return { stale: true, why: 'hour_moving' };
  return { stale: true, why: 'stale_world' };
}

/**
 * The dim, pure. ctx as `judgeStaleWorld`. Returns { mult, stale, why }: `mult` is what the layer's opacity is multiplied by (1 = untouched).
 */
export function resolveStaleWorldDim(ctx) {
  const w = (ctx && ctx.win) || (typeof window !== 'undefined' ? window : null);
  if (w && w.__RAW_DISABLE_STALE_HOUR_DIM__ === true) return { mult: 1, stale: false, why: 'killed' };
  const j = judgeStaleWorld(ctx);
  if (j.why !== 'stale_world') return { mult: 1, stale: j.stale, why: j.why };
  const tuned = w ? Number(w.__RAW_STALE_HOUR_DIM__) : NaN;
  return { mult: tuned > 0 && tuned <= 1 ? tuned : STALE_WORLD_DIM, stale: true, why: 'stale_world' };
}

/** Tracker of how long the selected hour has held still (a closure inside the custom layer: one per layer instance). */
export function createStaleHourTracker() {
  let lastHour = null; let since = 0;
  return {
    heldMs(hour, nowMs) {
      const now = typeof nowMs === 'number' ? nowMs : Date.now();
      if (hour !== lastHour) { lastHour = hour; since = now; }
      return now - since;
    },
  };
}

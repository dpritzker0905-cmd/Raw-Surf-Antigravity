/**
 * marineStaleHour.js — which hour a world frame was made for, against the hour that is selected
 * (2026-10-01; owner: "keep it on, defer the flip, now fix the wrong-hour frame"; audit finding F-21).
 * PURE and import-free on purpose: the engine imports it, and the engine's module graph must not grow a dependency on
 * the backend client (the manifest-reading half lives in marineStaleHourLayer.js, which only the custom layer imports).
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
 */
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

/** True when a held base and a seed are made for different hours (both valid times known and further apart than a snap). */
export function coarseBaseOutdatedBy(base, seed, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (w && w.__RAW_DISABLE_BASE_HOUR_SYNC__ === true) return false;
  const a = gridValidMs(base), b = gridValidMs(seed);
  return a !== null && b !== null && Math.abs(a - b) > SAME_STEP_TOL_MS;
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

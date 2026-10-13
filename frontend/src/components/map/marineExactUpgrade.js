/**
 * marineExactUpgrade.js — draw the EXACT world frame at far zoom once the timeline settles
 * (2026-10-01; owner: "build the exact-frame fix for far zoom").
 *
 * THE DEFECT (audit finding F-19, reproduced on the deployed frontend and again offline in this session). At world
 * zoom the scrub-settle safety net commits the warmed SERIES frame instantly and SKIPS the per-hour /grid fetch
 * ("SERIES-FIRST", useMarineScrubSettle.js) — the right call while scrubbing, since a world /grid is 2.3 MB and
 * 3-9 s on the 1-CPU backend. But the world series page is thinned by the backend's vector budget: 48 frames of the
 * 181 x 83 field come back as 46 x 21, an 8-degree lattice (`decimated_stride: 4`). A swell narrower than the lattice
 * falls between its cells: Wed 2026-10-07 15Z the exact frame reads 2.33 m at the Florida points and the thinned frame
 * 1.34 m (-42%). The placeholder was FINAL: nothing ever replaced it, so the far-zoom picture stayed on the thin
 * frame while a zoom in (a regional tile) showed the full swell.
 *
 * THREE MISTAKES MADE ONE DEFECT, and this module is where they are fixed:
 *   1. A thinned frame carries the SAME product id and valid time as the exact frame it is a view of, so every
 *      identity check in the client reads "already showing this". The backend stamps the difference per frame
 *      (`decimated_stride`); `frameToMarineData` now keeps it as `grid.__decimatedStride`, and this module is the one
 *      place that reads it.
 *   2. The global prewarm reused a series frame as the world grid for an hour ("zero network, identical pixels",
 *      marineGlobalPrewarm.js), which is only true for an unthinned frame. It now refuses a thinned one.
 *   3. The settle check read the hour LABEL as the identity of the data (found by an offline A/B of the erratic zoom, the
 *      same day: the unfixed client handed the engine a thinned world frame 100 times in 25 trials of 25 s, and the frames
 *      showing under 75% of the exact swell were 11.1% of all frames, 0.7% once fixed). Far-horizon data is 3-hourly, so frames that
 *      carry the same valid time wear different hourOffset labels, "label != selected hour" read as stale, and the
 *      warmed series frame (the thin one, at world zoom) was committed over an EXACT frame of the same data.
 *      `keepExactResident` now stops that; the valid time is the identity of the data, the label of the request.
 *
 * THE FIX is the standard scrub-fast, sharpen-on-settle: keep committing the thin frame instantly (scrubbing stays
 * snappy), and once the timeline has settled on a world-width viewport fetch the exact world frame for that hour
 * through the NORMAL fetch path (so the arbiter, the dedupe ledger and the truth tags all see an ordinary commit)
 * and let it replace the placeholder. The arbiter already accepts it: the incoming frame is finer, so
 * `tier_downgrade` does not fire and `fresh_same_target` commits.
 *
 * Bounded: at most MAX_ATTEMPTS triggers per {model, layer, hour}, at least MIN_GAP_MS apart (and GLOBAL_GAP_MS apart across
 * hours), so a backend that cannot serve the exact frame (a terminal 404, an outage) leaves the placeholder drawn without a
 * refetch storm; an exact world frame landing gives every hour its budget back.
 * Kill switch: window.__RAW_DISABLE_EXACT_UPGRADE__ = true (both halves).  Telemetry: window.__MARINE_EXACT_UPGRADE__
 * { triggers, kept, last }.
 */
import { useEffect } from 'react';
import { MARINE_ZOOMED_OUT_MAX_ZOOM } from './marineZoomThresholds';

/** A grid at least this many degrees wide is a WORLD frame (matches every other `>= 340` test in the marine client). */
export const WORLD_MIN_SPAN_DEG = 340;
/**
 * How long after a thinned frame lands the settle check is re-driven, and how long the selected hour must then have held still
 * (offline replay of a click burst: with 900 ms the first fetch went out for an hour the next click replaced, and a second followed).
 */
export const EXACT_UPGRADE_DELAY_MS = 1500;
/** One fallback re-drive, in case the first found a fetch pending or the map still moving. Never a loop: see the hook. */
export const EXACT_UPGRADE_RETRY_MS = 4500;
export const EXACT_UPGRADE_MAX_ATTEMPTS = 3;
export const EXACT_UPGRADE_MIN_GAP_MS = 2500;
/** Across ALL hours: stepping through hours one after another must not fire an exact world fetch per step. */
export const EXACT_UPGRADE_GLOBAL_GAP_MS = 1500;
/** An attempt record older than this no longer counts (a long dwell may retry after the backend has recovered). */
export const EXACT_UPGRADE_FORGET_MS = 120000;
export const EXACT_UPGRADE_SOURCE = 'exact_upgrade';
/**
 * A series frame is "the nearest warmed frame within ±1.5 h" of the selected hour (marineGridSeries.nearestFrameInEntry), so a
 * placeholder for Wed 15Z at offset 147 is the h146 frame, valid 15:00Z. The same tolerance decides "the frame for this hour".
 */
export const EXACT_UPGRADE_HOUR_TOLERANCE = 1.5;

function lngSpan(b) {
  return b.east < b.west ? (b.east + 360) - b.west : b.east - b.west;
}

/** A WORLD-width grid the backend thinned to fit its vector budget (`decimated_stride` > 1), i.e. a placeholder. */
export function isThinnedWorldGrid(grid) {
  if (!grid || !grid.bounds || !(Number(grid.__decimatedStride) > 1)) return false;
  return lngSpan(grid.bounds) >= WORLD_MIN_SPAN_DEG;
}

export function exactUpgradeKey(model, layer, hour) {
  return `${model || 'GFS'}|${layer || 'waves'}|${hour}`;
}

/**
 * The decision, pure. Returns { upgrade: boolean, reason: string }.
 * ctx: { marineData, currentHour, scrubbing, wideView, fetchPendingForHour, attempts: {count,lastAt}|null, nowMs, disabled }
 */
export function planExactUpgrade(ctx) {
  const { marineData, currentHour, scrubbing, wideView, fetchPendingForHour, attempts, nowMs, disabled } = ctx;
  if (disabled) return { upgrade: false, reason: 'disabled' };
  const grid = marineData && marineData.grid;
  if (!isThinnedWorldGrid(grid)) return { upgrade: false, reason: 'resident_not_thinned_world' };
  if (scrubbing) return { upgrade: false, reason: 'scrubbing' };
  const rendered = grid.hourOffset ?? marineData.hourOffset;
  if (!(Math.abs(rendered - currentHour) <= EXACT_UPGRADE_HOUR_TOLERANCE)) return { upgrade: false, reason: 'hour_mismatch' };   // that branch owns it
  if (!wideView) return { upgrade: false, reason: 'not_wide_view' };                   // zoomed in: the gate hides a world frame
  if (fetchPendingForHour) return { upgrade: false, reason: 'fetch_pending' };
  if (attempts && (nowMs - attempts.lastAt) < EXACT_UPGRADE_FORGET_MS) {
    if (attempts.count >= EXACT_UPGRADE_MAX_ATTEMPTS) return { upgrade: false, reason: 'attempts_exhausted' };
    if (nowMs - attempts.lastAt < EXACT_UPGRADE_MIN_GAP_MS) return { upgrade: false, reason: 'too_soon' };
  }
  return { upgrade: true, reason: 'thinned_world_frame_settled' };
}

function servedMs(x) {
  const g = x && x.grid;
  const t = (x && (x.served_valid_time || x.valid_time)) || (g && (g.served_valid_time || g.valid_time)) || null;
  const ms = t ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * True when `frame` is a THINNED world frame and the resident is an EXACT world grid of the same data: the same served valid
 * time (and the same model run when both name one), and at least as fine a lattice. Committing the thin frame over it would be
 * a pure downgrade, and the scrub-settle check was doing exactly that.
 *
 * WHY THE HOUR LABEL CANNOT DECIDE THIS. Far-horizon model data is 3-hourly, so the selected hour is usually between two
 * frames and every frame that serves it is labelled with a different hourOffset: a series frame carries the page's own hour
 * (146), an exact /grid result the hour that was selected when it was first fetched (144 or 147), all valid 15Z. The settle
 * check reads "rendered label != selected hour" as a stale frame and re-commits the warmed series frame, which at world zoom
 * is the thin one: the heat map of an erratic zoom lost its swell for a second, again and again (offline A/B, 2026-10-01: 100
 * thin commits in 25 trials of 25 s on the unfixed build, and the first upgrade-only build fought the same check). The valid
 * time is the identity of the data; the label is the identity of the request.
 */
export function exactResidentSupersedes(marineData, frame) {
  const rg = marineData && marineData.grid;
  const fg = frame && frame.grid;
  if (!isThinnedWorldGrid(fg)) return false;
  if (!rg || !rg.bounds || rg.__renderable === false || !(rg.vectors && rg.vectors.length) || !(rg.cols > 0)) return false;
  if (Number(rg.__decimatedStride) > 1 || lngSpan(rg.bounds) < WORLD_MIN_SPAN_DEG) return false;
  if (!!rg.ratingMode !== !!fg.ratingMode) return false;                  // a surf-rating transition is the arbiter's flavor rules' to settle, not ours
  const rCell = lngSpan(rg.bounds) / rg.cols;
  const fCell = lngSpan(fg.bounds) / fg.cols;
  if (!(rCell > 0 && fCell > 0 && rCell <= fCell)) return false;           // a coarser world tier (10°) is no better than the thin frame
  const a = servedMs(marineData), b = servedMs(frame);
  if (a === null || b === null || a !== b) return false;
  const ra = marineData.run_time || rg.run_time, rb = frame.run_time || fg.run_time;
  if (!ra || !rb) return true;                                           // one side names no run: the same data time decides
  const ta = Date.parse(ra), tb = Date.parse(rb);                         // the two paths may spell one run differently ("Z" against "+00:00")
  return Number.isFinite(ta) && Number.isFinite(tb) ? ta === tb : ra === rb;   // another model run may be the fresher data
}

/** The settle check's call: `exactResidentSupersedes`, honouring the kill switch, counted in window.__MARINE_EXACT_UPGRADE__.kept. */
export function keepExactResident(marineData, frame) {
  try {
    const w = typeof window !== 'undefined' ? window : null;
    if (w && w.__RAW_DISABLE_EXACT_UPGRADE__ === true) return false;
    if (!exactResidentSupersedes(marineData, frame)) return false;
    if (w) { const t = w.__MARINE_EXACT_UPGRADE__ = w.__MARINE_EXACT_UPGRADE__ || { triggers: 0 }; t.kept = (t.kept || 0) + 1; }
    return true;
  } catch (e) {
    return false;                      // best effort: the settle check keeps its old behaviour
  }
}

const _attempts = new Map();           // key -> { count, lastAt }; tiny: one entry per {model, layer, hour} visited
let _lastTriggerAt = 0;                // the last trigger for ANY key (the global spacing above)

/** Test seam: the attempt ledger outlives a Jest module registry reset of its consumers. */
export function _resetExactUpgradeForTest() {
  _attempts.clear();
  _lastTriggerAt = 0;
  if (typeof window !== 'undefined') delete window.__MARINE_EXACT_UPGRADE__;
}

function isWideView(mapInstance) {
  try {
    const b = mapInstance.getBounds();
    const w = lngSpan({ west: b.getWest(), east: b.getEast() });
    const h = Math.abs(b.getNorth() - b.getSouth());
    if (w > 15 || h > 15) return true;
    return mapInstance.getZoom() <= MARINE_ZOOMED_OUT_MAX_ZOOM;
  } catch (e) {
    return false;                      // an unreadable map is not a reason to fetch
  }
}

/**
 * Called from runScrubSettleCheck. If the resident is a settled, thinned world frame for the selected hour, start the
 * exact fetch through the normal path and return true (the caller then skips the rest of its checks); otherwise false.
 * `ctx` is runScrubSettleCheck's own context: marineData, mapInstance, timeOffsetRef, activeModelRef,
 * activeMarineLayerRef, marineFetchLocksRef, updateMarineGridRef.
 */
export function tryExactUpgrade(ctx) {
  try {
    const { marineData, mapInstance, timeOffsetRef, activeModelRef, activeMarineLayerRef, marineFetchLocksRef, updateMarineGridRef } = ctx;
    const w = typeof window !== 'undefined' ? window : null;
    const currentHour = timeOffsetRef && timeOffsetRef.current;
    const model = activeModelRef && activeModelRef.current;
    const layer = (activeMarineLayerRef && activeMarineLayerRef.current) || 'waves';
    const key = exactUpgradeKey(model, layer, currentHour);
    if (marineData && marineData.grid && !isThinnedWorldGrid(marineData.grid)) _attempts.delete(key);   // upgraded: forget
    if (Date.now() - _lastTriggerAt < EXACT_UPGRADE_GLOBAL_GAP_MS) return false;
    const pending = w && w.__MARINE_FETCH_PENDING__;
    const plan = planExactUpgrade({
      marineData, currentHour,
      scrubbing: !!(w && w.isScrubbingTimeline),
      wideView: isWideView(mapInstance),
      fetchPendingForHour: !!(pending && pending.hour === currentHour && pending.model === model && pending.layer === layer),
      attempts: _attempts.get(key) || null,
      nowMs: Date.now(),
      disabled: !!(w && w.__RAW_DISABLE_EXACT_UPGRADE__ === true),
    });
    if (!plan.upgrade || !updateMarineGridRef || typeof updateMarineGridRef.current !== 'function') return false;
    const prev = _attempts.get(key);
    _lastTriggerAt = Date.now();
    _attempts.set(key, { count: (prev && (Date.now() - prev.lastAt) < EXACT_UPGRADE_FORGET_MS ? prev.count : 0) + 1, lastAt: Date.now() });
    if (w) {
      const t = w.__MARINE_EXACT_UPGRADE__ = w.__MARINE_EXACT_UPGRADE__ || { triggers: 0 };
      t.triggers++;
      t.last = { key, stride: marineData.grid.__decimatedStride, at: new Date().toISOString() };
    }
    // The dedup-bypassing idiom the settle safety net already uses: a nulled hash defeats the same-viewport 5-minute
    // skip and resets the 1.2 s rate limiter, so this ordinary fetch is not mistaken for a repeat of the thin commit.
    if (marineFetchLocksRef && marineFetchLocksRef.current) marineFetchLocksRef.current.lastHash = null;
    updateMarineGridRef.current(EXACT_UPGRADE_SOURCE);
    return true;
  } catch (e) {
    return false;                      // best effort: the thin frame is already drawn
  }
}

/**
 * Re-drive the settle check shortly after a thinned world frame lands (and once more as a fallback). `checkRef.current` is
 * useMarineScrubSettle's own checkScrubSettle, which is a no-op while the timeline is moving and fires again at scrub end, so
 * the upgrade waits for the settle without a second timer of its own.
 *
 * ⚠️ KEYED ON THE GRID, NOT ON marineData. The settle check re-commits the SAME cached series frame whenever the selected
 * offset differs from the warmed frame's (147 against h146): `stampSeriesCommit` hands back a fresh wrapper around the SAME
 * grid object each time. Keyed on marineData, every re-commit re-armed this effect, which re-drove the check, which re-committed
 * the frame: a loop at about 1 per second (caught in the offline replay, 2026-10-01). A grid is replaced only when the data is.
 */
export function useMarineExactUpgrade(marineData, checkRef, timeOffsetRef) {
  const g = marineData && marineData.grid;
  useEffect(() => {
    // An EXACT world frame just landed: the exact path works, so every hour's upgrade budget is whole again. Without this an
    // erratic zoom (thin placeholder, upgrade, zoom in, zoom out, thin again, ...) spent the budget of an hour whose exact
    // frame was already in hand, and the last thin placeholder then stayed drawn.
    if (g && g.bounds && !(Number(g.__decimatedStride) > 1) && lngSpan(g.bounds) >= WORLD_MIN_SPAN_DEG) _attempts.clear();
    if (!isThinnedWorldGrid(g)) return undefined;
    const timers = [];
    const hourNow = () => (timeOffsetRef ? timeOffsetRef.current : undefined);
    let armedHour = hourNow();
    let stableSince = Date.now();
    const drive = () => {
      // Button steps (+1h, +1d) neither replace this frame (one warmed frame serves several hours) nor set isScrubbingTimeline, so
      // the hour can move under a pending drive: wait for it to hold still for a whole delay, so a click burst starts one fetch.
      const h = hourNow();
      if (h !== armedHour) { armedHour = h; stableSince = Date.now(); timers.push(setTimeout(drive, EXACT_UPGRADE_DELAY_MS)); return; }
      if (Date.now() - stableSince < EXACT_UPGRADE_DELAY_MS) return;      // a drive that just saw the hour move has re-armed: that one checks
      if (checkRef && checkRef.current) checkRef.current();
    };
    timers.push(setTimeout(drive, EXACT_UPGRADE_DELAY_MS), setTimeout(drive, EXACT_UPGRADE_RETRY_MS));
    return () => { timers.forEach(clearTimeout); };
  }, [g, checkRef, timeOffsetRef]);
}

/**
 * marineSeriesWhilePending.js — SERIES_PAINT_WHILE_PENDING (request diet 2026-10-20, marineRequestDiet.js).
 *
 * THE HOLD. runScrubSettleCheck (useMarineScrubSettle.js) returned at once when a /grid for the selected hour was already in flight
 * ("Fetch already in-flight for this hour. Bypassing redundant fetch."), before its SERIES-FIRST branch could commit the warmed frame.
 * So a series frame that had LANDED for that hour (the hour-0 "mini" page at load, a layer's first page after a switch) stayed off
 * screen until the /grid landed too. Measured offline (visual lab, open_waves, /products 6 s): the mini landed ~6 s before the first
 * draw, which waited for the /grid; with live-like latency the gap was 1.5 s on the erratic flow's load.
 *
 * THE FIX keeps the in-flight fetch (nothing is aborted, nothing new is asked for) and draws the landed frame meanwhile, exactly as the
 * SERIES-FIRST branch would have with no fetch pending: the same frame lookup, the same thin-over-exact refusal (keepExactResident),
 * the same stamped commit. When the /grid lands it commits through the normal path: it is a different product (an exact frame over a
 * series frame), so the duplicate-commit test lets it through and the engine's arbiter takes the finer frame.
 * Only when the display is EMPTY or shows ANOTHER hour (the caller's noData || hourMismatch gate): a frame of the right hour is never
 * replaced by a series frame here. Kill: window.__RAW_DISABLE_SERIES_PAINT_WHILE_PENDING__ = true.
 */
import { useEffect } from 'react';
import { getMarineSeriesFrame } from './marineGridSeries';
import { keepExactResident } from './marineExactUpgrade';
import { noteRequestDiet, requestDietOn } from './marineRequestDiet';

// The frame last painted here, so the two listeners that can re-run the settle check for one landing (this module's and the settle
// effect's own) commit it once: a second call still holds the pre-commit marineData in its closure.
let _lastPainted = { grid: null, at: 0 };
export function _resetSeriesPaintForTest() { _lastPainted = { grid: null, at: 0 }; }

/**
 * `ctx`: runScrubSettleCheck's own context plus `currentHour` and `commit(frame, layer)` (the caller's stamped-commit idiom).
 * Returns true when it committed a frame (the caller then returns; the pending fetch still lands and upgrades it).
 */
export function paintSeriesWhilePending(ctx) {
  try {
    if (!requestDietOn('SERIES_PAINT_WHILE_PENDING')) return false;
    const { marineData, activeModelRef, activeMarineLayerRef, currentHour, commit } = ctx;
    // useMarineScrubSettle's checkScrubSettle is memoised on marineData alone, so until the FIRST commit it still holds the
    // mapInstance of the render before the map existed (null): exactly the load this path exists for (offline trace 2026-10-20:
    // the check ran at the mini's landing and saw no map). The map the app publishes for its fetch paths (useMapInitialization) is the
    // same object once it exists.
    const mapInstance = ctx.mapInstance || (typeof window !== 'undefined' ? (window.map || window.__MAP_INSTANCE__) : null);
    if (!mapInstance || typeof commit !== 'function' || !activeModelRef || !activeMarineLayerRef) return false;
    const layer = activeMarineLayerRef.current || 'waves';
    const b = mapInstance.getBounds();
    const vp = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    const sf = getMarineSeriesFrame(activeModelRef.current, layer, vp, currentHour);
    const miss = (reason) => { noteRequestDiet('series_paint_miss', { reason, hour: currentHour, model: activeModelRef.current, layer }); return false; };
    if (!sf || !sf.grid || !sf.grid.vectors || !sf.grid.vectors.length) return miss('no_series_frame');
    if (marineData && marineData.grid === sf.grid) return miss('already_shown');                 // already showing this very frame
    if (_lastPainted.grid === sf.grid && Date.now() - _lastPainted.at < 2000) return true;   // just committed it: nothing more to do
    if (keepExactResident(marineData, sf)) return miss('exact_resident');                   // never a thin frame over an exact one of the same data
    _lastPainted = { grid: sf.grid, at: Date.now() };
    commit(sf, layer);
    noteRequestDiet('series_painted_while_pending', { hour: currentHour, model: activeModelRef.current, layer, cols: sf.grid.cols });
    return true;
  } catch (e) {
    noteRequestDiet('series_paint_error', { message: String((e && e.message) || e).slice(0, 120) });
    return false;                       // best effort: the pending fetch still lands
  }
}

/**
 * THE TRIGGER. A series landing fires `marine_series_revalidated`, but at a layer's FIRST load nothing ran the settle check for it:
 * the settle hook registers its own listener in an effect that bails while marineData is still null (and re-runs only on a commit),
 * and the blank-heatmap backstop stands down while a fetch is pending. Measured offline (open_waves, /products 6 s): no settle-check
 * line at all between the mini landing and the /grid landing. So listen here, and while a marine fetch is pending re-run the settle
 * check (`checkRef.current`, useMarineScrubSettle's live checkScrubSettle), whose pending branch then calls paintSeriesWhilePending.
 * With nothing pending this does nothing: the existing listeners own every other state. Same kill switch.
 */
export function useSeriesPaintWhilePending(checkRef, activeMarineLayerRef) {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let timer = null;
    const onLanded = () => {
      if (!requestDietOn('SERIES_PAINT_WHILE_PENDING') || window.isScrubbingTimeline) return;
      if (!(activeMarineLayerRef && activeMarineLayerRef.current) || !window.__MARINE_FETCH_PENDING__) return;
      clearTimeout(timer);
      timer = setTimeout(() => { if (checkRef && checkRef.current) checkRef.current(); }, 0);
    };
    window.addEventListener('marine_series_revalidated', onLanded);
    return () => { clearTimeout(timer); window.removeEventListener('marine_series_revalidated', onLanded); };
  }, [checkRef, activeMarineLayerRef]);
}

/**
 * marineEnqueueSlot.js — the capability-aware dispatch slot of enqueueMarineUpdate (2026-10-01; owner: "go, build the scheduler
 * fix"; audit F-23, REPORT section 8.12; the diagnosis is in docs/weather-program/log/2026-10-01-far-zoom-max-thinning.md).
 *
 * THE DEFECT. enqueueMarineUpdate (useMarineDataFetcherCore.js) has ONE dispatch slot. Every enqueue that got past its gates either
 * replaced the run already pending or was dropped, whatever it could DO. 'series_upgrade' is a CACHE-ONLY lane (it commits a landed
 * series page from the cache and returns before any network fetch), yet two orderings let it displace a real fetch:
 *   1. a fetch-capable run is PENDING (its dispatch armed the 300 ms stable-delay timer) and a series page lands: the lane's
 *      dispatch clears that timer and runs cache-only in its place. After a zoom-out the pending run is 'moveend', so the zoom-out's
 *      world /grid was never requested (nothing re-arms it: moveend already fired and the camera hash is unchanged) and the map kept
 *      whatever frame it had until the next gesture. Offline, with the fetcher's own events recorded: a landing inside the 300 ms lost
 *      the grid 6 of 6 times, a landing outside it 0 of 12. Present since the lane was added (2026-07-17, f74214fd).
 *   2. the lane is SCHEDULED but not yet dispatched (the slot is taken until the next frame) and a fetch-capable enqueue arrives:
 *      it was dropped at the slot check. Not seen naturally (the window is one frame); injected, it lost the grid 2 of 2.
 * The lane's own comment promised it "never displaces a real fetch", but only a fetch IN FLIGHT was guarded (locks.isFetching).
 *
 * THE RULES (slotVerdict):
 *   - a cache-only enqueue never displaces a pending run: it is SKIPPED when the slot is taken or a stable-delay timer is armed. A skip
 *     costs nothing: the next landing re-fires the event, and a run that executes after the page landed reads it from the cache.
 *   - a fetch-capable enqueue that finds the slot taken by a cache-only enqueue SUPERSEDES it (the cache-only dispatch becomes a
 *     no-op); one that finds it taken by another fetch-capable enqueue is dropped as before (the first one's run does the work).
 *   - anything else schedules. A fetch-capable enqueue that finds a timer armed already replaced the pending run, and still does.
 *
 * Kill: window.__RAW_DISABLE_SU_NO_CANCEL__ = true restores the previous slot exactly (a taken slot drops whatever arrives).
 * Telemetry: __RAW_FORENSIC__ events 'series_upgrade_skipped_pending' { slotted } and 'cache_only_slot_superseded' { by }. Without
 * the fix the telltale is 'flavor_fastpath_miss' with src 'series_upgrade' about 1.3 s after a zoom-out and no fetch for 'moveend'.
 * Keep CACHE_ONLY_SOURCES in step with updateMarineGrid's early return for the lane (the line that returns before the network fetch).
 */
import { recordMarineEvent } from './marineForensics';

/** Sources that never fetch: updateMarineGrid returns for them before any network request. */
const CACHE_ONLY_SOURCES = ['series_upgrade'];

export function isCacheOnlySource(source) {
  return CACHE_ONLY_SOURCES.includes(source);
}

/**
 * One enqueue against the slot. `held` is the slot of a scheduled, not yet dispatched enqueue (false when free), `timerArmed` is
 * whether a dispatched run is waiting out its stable delay. Returns 'schedule' | 'supersede' | 'drop' | 'skip'.
 */
export function slotVerdict(source, held, timerArmed, disabled = false) {
  if (disabled) return held ? 'drop' : 'schedule';
  if (isCacheOnlySource(source)) return (held || timerArmed) ? 'skip' : 'schedule';
  if (held) return held.cacheOnly ? 'supersede' : 'drop';
  return 'schedule';
}

/**
 * Take the slot for `source`, or report why not. Returns the new slot (also stored in scheduledRef.current, which is false while the
 * slot is free) or null when the enqueue is skipped or dropped. The dispatch the slot belongs to must run only while
 * scheduledRef.current is still ITS slot: a superseded dispatch finds another slot there and does nothing.
 */
export function claimEnqueueSlot(source, scheduledRef, timeoutIdRef) {
  const disabled = typeof window !== 'undefined' && window.__RAW_DISABLE_SU_NO_CANCEL__ === true;
  const verdict = slotVerdict(source, scheduledRef.current, !!timeoutIdRef.current, disabled);
  if (verdict === 'skip') recordMarineEvent('series_upgrade_skipped_pending', { slotted: !!scheduledRef.current });
  if (verdict === 'supersede') recordMarineEvent('cache_only_slot_superseded', { by: source });
  if (verdict === 'drop' || verdict === 'skip') return null;
  scheduledRef.current = { cacheOnly: isCacheOnlySource(source) };
  return scheduledRef.current;
}

/**
 * marineFinePrefetch.js: the NEXT hour's fine grid, fetched while the user dwells (2026-11-15; the director's option 2 for the
 * first-visit coarse-then-fine finding, log docs/weather-program/log/2026-11-15-opus-first-visit-fine.md).
 *
 * WHY. On a first visit to an hour the engine draws a coarse frame (a thinned world frame, or a coarse regional series frame) and
 * the fine /grid is only asked once the hour has held still for 1500 ms (marineExactUpgrade.EXACT_UPGRADE_DELAY_MS, kept: it stops
 * a click burst sending one /grid per hour passed). A repeat visit is sharp at once because the fine grid is in the client cache.
 *
 * WHAT. Only after the session's first hour step (plain browsing, pans and zooms with no hour change, never prefetches; the direction
 * is the last step's). Once the selected hour has held still for FINE_PREFETCH_DWELL_MS (the same 1500 ms), ask the fine grid of the NEXT hour in
 * the last step's direction through fetchMarineData's cache-only path (isPrefetch, noSideWarm: it caches that one /grid and draws
 * nothing; no sibling or world warms). At most one prefetch per dwell; never while the timeline moves, a fetch is pending, the tab
 * is hidden, or in surf mode (a surf /grid runs the rating chain per node on the 1-CPU box); never for an hour already cached or
 * already prefetched for this view. The next step then finds the fine grid exactly as a repeat visit does.
 * Kill: window.__RAW_DISABLE_FINE_PREFETCH_NEXT__ = true. Telemetry: window.__RAW_FINE_PREFETCH__ { asked, skipped: {reason: n} }.
 */
import { useEffect, useRef } from 'react';
import { fetchMarineData, isContainedInMarineCache } from './marineController';
import { getSurfModeFlag } from './backendWeatherServiceClient';

export const FINE_PREFETCH_DWELL_MS = 1500;
export const FINE_PREFETCH_FORGET_MS = 5 * 60 * 1000;
const _asked = new Map();   // key -> when asked

export const finePrefetchOn = () => !(typeof window !== 'undefined' && window.__RAW_DISABLE_FINE_PREFETCH_NEXT__ === true);

function note(field, reason) {
  if (typeof window === 'undefined') return;
  const t = window.__RAW_FINE_PREFETCH__ = window.__RAW_FINE_PREFETCH__ || { asked: 0, skipped: {} };
  if (field === 'asked') t.asked += 1; else t.skipped[reason] = (t.skipped[reason] || 0) + 1;
}

const viewKey = (b) => [b.west, b.south, b.east, b.north].map((v) => Number(v).toFixed(2)).join(',');

/** The decision, pure: should the dwell at `hour` prefetch `hour + dir`, and if not, why. */
export function planFinePrefetch({ on, hour, dir, scrubbing, pending, hidden, surf, cached, asked }) {
  if (!on) return { go: false, reason: 'disabled' };
  if (!Number.isFinite(hour)) return { go: false, reason: 'no_hour' };
  const next = hour + (dir < 0 ? -1 : 1);
  if (next < 0) return { go: false, reason: 'before_start' };
  if (scrubbing) return { go: false, reason: 'scrubbing' };
  if (pending) return { go: false, reason: 'fetch_pending' };
  if (hidden) return { go: false, reason: 'hidden' };
  if (surf) return { go: false, reason: 'surf' };
  if (cached) return { go: false, reason: 'cached' };
  if (asked) return { go: false, reason: 'asked' };
  return { go: true, next, reason: 'dwelt' };
}

/**
 * Mount once beside the scrub-settle check. Re-arms a FINE_PREFETCH_DWELL_MS timer on every hour change; when it fires with the
 * hour unchanged, plans and (at most once) asks the next hour.
 */
export function useFineDwellPrefetch({ mapInstance, timeOffsetRef, activeModelRef, activeMarineLayerRef, activeMarineLayersRef, hour }) {
  const lastHourRef = useRef(hour);
  const dirRef = useRef(1);
  const steppedRef = useRef(false);   // ARMED ONLY AFTER A STEP (the advisor's review): no hour step yet = plain browsing, no prefetch
  useEffect(() => {
    if (Number.isFinite(lastHourRef.current) && Number.isFinite(hour) && hour !== lastHourRef.current) {
      dirRef.current = hour < lastHourRef.current ? -1 : 1; steppedRef.current = true;
    }
    lastHourRef.current = hour;
    if (!mapInstance || !finePrefetchOn() || !steppedRef.current) return undefined;
    const armed = hour;
    const timer = setTimeout(() => {
      try {
        const w = typeof window !== 'undefined' ? window : null;
        const now = timeOffsetRef ? timeOffsetRef.current : armed;
        if (now !== armed || !activeMarineLayersRef || !activeMarineLayersRef.current) return;
        const model = (activeModelRef && activeModelRef.current) || 'GFS';
        const layer = (activeMarineLayerRef && activeMarineLayerRef.current) || 'waves';
        const b = mapInstance.getBounds();
        const bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
        const next = armed + (dirRef.current < 0 ? -1 : 1);
        const key = `${model}|${layer}|${next}|${viewKey(bounds)}`;
        const at = _asked.get(key);
        let cached = false;
        try { cached = !!isContainedInMarineCache(bounds, model, next, layer); } catch (e) { cached = false; }
        const pend = w && w.__MARINE_FETCH_PENDING__;
        const plan = planFinePrefetch({
          on: finePrefetchOn(), hour: armed, dir: dirRef.current, scrubbing: !!(w && w.isScrubbingTimeline), pending: !!pend,
          hidden: typeof document !== 'undefined' && document.hidden, surf: getSurfModeFlag(), cached,
          asked: !!(at && Date.now() - at < FINE_PREFETCH_FORGET_MS),
        });
        if (!plan.go) { note('skipped', plan.reason); return; }
        _asked.set(key, Date.now());
        note('asked');
        Promise.resolve(fetchMarineData(bounds, mapInstance.getZoom(), undefined, plan.next, false, model, layer, true, { noSideWarm: true }))
          .catch(() => { /* best effort: the settle path still fetches on arrival */ });
      } catch (e) { /* best effort */ }
    }, FINE_PREFETCH_DWELL_MS);
    return () => clearTimeout(timer);
  }, [hour, mapInstance]);
}

export function _resetFinePrefetchForTest() {
  _asked.clear();
  if (typeof window !== 'undefined') delete window.__RAW_FINE_PREFETCH__;
}

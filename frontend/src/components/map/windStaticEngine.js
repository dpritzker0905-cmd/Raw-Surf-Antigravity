/**
 * windStaticEngine.js — the wind engine's (WeatherEngine.js) side of the static wind frames (2026-10-22, the wind instant scrub).
 * Lifted out of WeatherEngine.js, which may only shrink (scripts/loc_ratchet.py).
 *
 *   staticWindBase(model, hour)    the hour's 2-degree WORLD field from static bytes already here (windStaticFrames.js), or null:
 *                                  the base the engine keeps under any fine overlay. Synchronous, no I/O.
 *   instantWindStep(...)           a timeline step whose grid is ALREADY HERE (the per-hour cache, or that static base) is
 *                                  committed on the press, without the 150 ms debounce the network path needs.
 *   useWindStaticPrefetch(...)     streams the GFS wind run from the CDN in idle time, also while ANOTHER layer is shown
 *                                  (windFramePrefetch.js: the desktop policy; phones, Save-Data and 2g on demand).
 * Kills: window.__RAW_DISABLE_WIND_STATIC_FRAMES__ (everything), __RAW_DISABLE_WIND_INSTANT_STEP__ (the press commit),
 * __RAW_DISABLE_WIND_PREFETCH__ (the idle fetch).
 */
import { useEffect } from 'react';
import { getStaticWindDataSync, prebuildStaticWindAround } from './backendWindServiceClient';
import { getSharedValidTime } from './backendWeatherServiceClient';
import { windViewportNeedsGrid } from './windStaticFrames';
import { startWindPrefetch, noteWind } from './windFramePrefetch';

export const staticWindBase = (model, hour) => getStaticWindDataSync(model, hour, null, { world: true });

const viewportOf = (map) => {
  const b = map.getBounds();
  return { west: b.getWest(), south: Math.max(-85, b.getSouth()), east: b.getEast(), north: Math.min(85, b.getNorth()) };
};

/**
 * Commit `hour` now when its grid is already here. `commit(grid)` is the engine's commit (WeatherEngine.commitWindData plus its
 * bookkeeping); `backfill(grid)` asks for the world base under a cached clip, as the debounced cache hit did.
 * Returns 'done' (nothing more to ask), 'grid' (a static base is up; the view still needs /grid's sharpened overlay) or null
 * (nothing here: the debounced path runs as before).
 */
export function instantWindStep({ mapInstance, model, hour, getModelSafeWind, commit, backfill }) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_INSTANT_STEP__ === true) return null;
  try {
    const vb = viewportOf(mapInstance);
    const cached = getModelSafeWind(model, hour, vb);
    const hit = cached || staticWindBase(model, hour);
    if (!hit) return null;
    commit(hit);
    if (typeof window !== 'undefined') window.__WIND_INSTANT_STEP__ = (window.__WIND_INSTANT_STEP__ || 0) + 1;
    prebuildStaticWindAround(model, hour);
    if (cached) { backfill(cached); return 'done'; }
    return windViewportNeedsGrid(model, vb) ? 'grid' : 'done';
  } catch (e) {
    return null;
  }
}

/** The idle prefetch for this map, told about the wind layer and the timeline cursor. GFS only (the static set). */
export function useWindStaticPrefetch({ mapInstance, isWindActive, activeModel, timeOffsetHours }) {
  useEffect(() => (mapInstance ? startWindPrefetch() : undefined), [mapInstance]);
  useEffect(() => {
    try {
      noteWind({ windActive: isWindActive && String(activeModel).toUpperCase() === 'GFS',
        cursorMs: Date.parse(getSharedValidTime(timeOffsetHours, 'wind', 'GFS', { readOnly: true })) });
    } catch (e) { /* the prefetch is best-effort */ }
  }, [isWindActive, activeModel, timeOffsetHours]);
}

/**
 * WeatherEngine's STALE-COVERING UPGRADE rule (2026-07-20), moved here unchanged: during an upstream rate-limit window the backend
 * serves a STALE dynamic product that COVERS the viewport; coverage outranks freshness, so accept a stale REAL regional grid that
 * covers the viewport when no fresh covering fine overlay is resident, unless a finer resident box still covers most of the view
 * (the RESOLUTION GUARD: >= 70% area, centre inside, the stale grid > 1.5x coarser). Safe-zero / empty fallbacks never upgrade.
 * World-span stale never upgrades. Kill: __RAW_DISABLE_WIND_STALE_COVERING__.
 */
export function staleCoveringUpgrade(data, bounds) {
  try {
    if (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_STALE_COVERING__ === true) return false;
    if (!data || data.stale !== true || data.renderable === false) return false;
    if (data.__failureReason) return false;
    if (!Array.isArray(data.vectors) || data.vectors.length < 4) return false;
    const db = data.bounds;
    if (!db) return false;
    const dSpan = db.east >= db.west ? db.east - db.west : (db.east + 360.0) - db.west;
    if (dSpan >= 350.0) return false;
    const eps = 0.05;
    const vpS = Math.max(-85, bounds.south), vpN = Math.min(85, bounds.north);
    const covers = db.west <= bounds.west + eps && db.east >= bounds.east - eps
      && db.south <= vpS + eps && db.north >= vpN - eps;
    if (!covers) return false;
    const f = typeof window !== 'undefined' ? window.__WIND_FINE_OVERLAY__ : null;
    const fineCovers = !!(f && f.active && f.bounds
      && f.bounds.west <= bounds.west + eps && f.bounds.east >= bounds.east - eps
      && f.bounds.south <= vpS + eps && f.bounds.north >= vpN - eps);
    if (fineCovers) return false;
    if (f && f.active && f.bounds && f.cols > 0) {
      const fCell = (f.bounds.east - f.bounds.west) / Math.max(1, f.cols - 1);
      const dCell = (db.east - db.west) / Math.max(1, (data.cols || 2) - 1);
      const cx = (bounds.west + bounds.east) / 2, cy = (vpS + vpN) / 2;
      const centerInFine = f.bounds.west <= cx && f.bounds.east >= cx
        && f.bounds.south <= cy && f.bounds.north >= cy;
      const ovW = Math.max(0, Math.min(f.bounds.east, bounds.east) - Math.max(f.bounds.west, bounds.west));
      const ovH = Math.max(0, Math.min(f.bounds.north, vpN) - Math.max(f.bounds.south, vpS));
      const vpArea = Math.max(1e-6, (bounds.east - bounds.west) * (vpN - vpS));
      const fineCoverFrac = (ovW * ovH) / vpArea;
      if (centerInFine && dCell > fCell * 1.5 && fineCoverFrac >= 0.7) return false;
    }
    return true;
  } catch (e) { return false; }
}

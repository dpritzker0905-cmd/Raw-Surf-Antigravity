import { useEffect, useRef } from 'react';
import { getModelSafeMarine } from './marineController';
import { getSurfModeFlag } from './backendWeatherServiceClient';
import { bboxContains } from './marineBboxGeometry';
import { MARINE_REGIONAL_READY } from './marineRegionalReady';
import { recordMarineEvent } from './marineForensics';

const width = b => b.east < b.west ? b.east + 360 - b.west : b.east - b.west;
const validBox = b => b && ['west', 'east', 'south', 'north'].every(k => Number.isFinite(b[k])) && b.north > b.south && width(b) > 0;

// The normal fetch dedup keys the viewport, not newly arrived cache contents.
// Reuse the commit choke directly for this cache-only coverage repair. Never own,
// release or abort a foreground fetch; wait for motion/commit/fetch to settle.
export function useMarineRegionalReady(options) {
  const live = useRef(options); live.current = options;
  const { mapInstance } = options;
  useEffect(() => {
    if (!mapInstance || typeof window === 'undefined') return;
    let timer = null, pending = null;
    const matches = (intent, o) => intent && o.activeMarineLayersRef.current &&
      intent.model === o.activeModelRef.current && intent.layer === (o.activeMarineLayerRef.current || 'waves') &&
      intent.hour === o.timeOffsetRef.current && intent.surf === getSurfModeFlag();
    const flush = () => {
      timer = null;
      const o = live.current, intent = pending?.intent;
      if (!matches(intent, o) || Date.now() >= pending.expires) { pending = null; return; }
      if (window.isScrubbingTimeline || window.__MARINE_TRANSITIONING__ || o.isCommittingDataRef.current ||
          o.marineFetchLocksRef.current.isFetching || mapInstance.isMoving() || mapInstance.isZooming()) {
        timer = setTimeout(flush, 100); return;
      }
      pending = null;
      try {
        const b = mapInstance.getBounds(), bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
        const resident = o.marineDataRef.current?.grid;
        if (!validBox(bounds) || !resident || !validBox(resident.bounds)) return;
        // Only repair a partial REGIONAL state. Refeeding while state is global
        // but the engine holds a covering fine field can cancel its pending seed
        // and create a blank on the next zoom. Leave that coordination untouched.
        if (width(resident.bounds) >= 340 || bboxContains(resident.bounds, bounds)) return;
        const data = getModelSafeMarine(intent.model, intent.hour, intent.layer, bounds), g = data?.grid;
        if (!g?.vectors?.length || data.__staleHour || data.stale || g.stale ||
            g.renderable === false || g.__renderable === false || !validBox(g.bounds) || width(g.bounds) >= 340 ||
            !bboxContains(g.bounds, bounds) || g.hourOffset !== intent.hour ||
            g.__sourceModel !== intent.model || g.__componentLayer !== intent.layer || !!g.ratingMode !== intent.surf ||
            g.vectors === resident.vectors) return;
        o.commit(data, bounds, intent.model, intent.layer, intent.hour);
        recordMarineEvent('regional_ready_submitted', { model: intent.model, layer: intent.layer, hour: intent.hour });
      } catch (e) { recordMarineEvent('regional_ready_error', { message: String(e?.message || e).slice(0, 120) }); }
    };
    const arrive = event => {
      if (!matches(event.detail, live.current)) return;
      pending = { intent: event.detail, expires: Date.now() + 30000 };
      if (timer === null) timer = setTimeout(flush, 50);
    };
    window.addEventListener(MARINE_REGIONAL_READY, arrive);
    return () => { window.removeEventListener(MARINE_REGIONAL_READY, arrive); clearTimeout(timer); pending = null; };
  }, [mapInstance]);
}

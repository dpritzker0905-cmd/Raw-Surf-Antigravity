import { useEffect, useRef } from 'react';
import { ensureMarineSeries, prewarmMarineSeries, marineSeriesViewportIdentity } from './marineGridSeries';
import { createMarineViewportIntent, marineSeriesWorkBoundsEnabled } from './marineSeriesWorkPolicy';

const boundsOf = map => {
  const b = map.getBounds();
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
};

export function useMarineSeriesWarm({ mapInstance, activeModel, activeMarineLayer, activeModelRef,
  activeMarineLayerRef, timeOffsetRef }) {
  const intentRef = useRef(null);
  const prevModelRef = useRef(null);
  useEffect(() => {
    if (!mapInstance || !activeMarineLayer) return;
    let cancelled = false;
    const intent = createMarineViewportIntent(); intentRef.current = intent;
    const signalFor = bounds => intent.signalFor(marineSeriesViewportIdentity(
      activeModelRef.current, activeMarineLayerRef.current, bounds));
    const kick = () => {
      if (cancelled) return;
      try {
        const bounds = boundsOf(mapInstance), signal = signalFor(bounds);
        ensureMarineSeries(activeModelRef.current, activeMarineLayerRef.current, bounds, timeOffsetRef.current, signal);
        prewarmMarineSeries(activeModelRef.current, activeMarineLayerRef.current, bounds, signal);
      } catch { /* map not ready */ }
    };
    const onScrubStart = () => {
      if (cancelled) return;
      try {
        const bounds = boundsOf(mapInstance);
        prewarmMarineSeries(activeModelRef.current, activeMarineLayerRef.current, bounds, signalFor(bounds));
      } catch { /* map not ready */ }
    };
    const timer = setTimeout(kick, 600);
    mapInstance.on('moveend', kick);
    window.addEventListener('timeline_scrub_start', onScrubStart);
    return () => {
      cancelled = true; clearTimeout(timer); intent.abort();
      try { mapInstance.off('moveend', kick); } catch { /* map destroyed */ }
      window.removeEventListener('timeline_scrub_start', onScrubStart);
      if (intentRef.current === intent) intentRef.current = null;
    };
    // Timeline page/hour changes retain reusable work; model/layer/map exits cancel it.
  }, [mapInstance, activeModel, activeMarineLayer, activeModelRef, activeMarineLayerRef, timeOffsetRef]);

  // Preserve immediate model-switch warm, sharing the main intent under qualification.
  useEffect(() => {
    if (!mapInstance || !activeMarineLayer || prevModelRef.current === activeModel) return;
    prevModelRef.current = activeModel;
    const controller = new AbortController();
    try {
      const bounds = boundsOf(mapInstance);
      const signal = marineSeriesWorkBoundsEnabled() && intentRef.current
        ? intentRef.current.signalFor(marineSeriesViewportIdentity(activeModelRef.current, activeMarineLayerRef.current, bounds))
        : controller.signal;
      prewarmMarineSeries(activeModelRef.current, activeMarineLayerRef.current, bounds, signal);
    } catch { /* map not ready */ }
    return () => controller.abort();
  }, [mapInstance, activeModel, activeMarineLayer, activeModelRef, activeMarineLayerRef]);
}

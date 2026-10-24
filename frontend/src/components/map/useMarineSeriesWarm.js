import { useEffect, useRef } from 'react';
import { ensureMarineSeries, prewarmMarineSeries, marineSeriesViewportIdentity } from './marineGridSeries';
import { createMarineViewportIntent, marineSeriesSupersedeOn, marineSeriesWorkBoundsEnabled } from './marineSeriesWorkPolicy';
import { seriesPanSettleMs } from './marineSeriesPanGuard';
import { prewarmSiblingMarineSeries } from './marineController';

// The sibling-layer warm (marineSiblingWarm.js) also follows the VISIBLE series, not only a /grid commit (2026-10-23): with a
// static source the visible frame can come from the series before any /grid is asked, and then the /grid hook never fires (offline
// z9 Florida with regional bundles: 1 of 2 sessions warmed no sibling). Repeat calls are cheap: the warm dedups and keeps ready
// frames. Kill: window.__RAW_DISABLE_SIBLING_WARM_ON_SERIES__ = true.
function warmSiblingsAfter(p, model, layer, bounds, hour, signal) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_SIBLING_WARM_ON_SERIES__ === true) return;
  Promise.resolve(p).then(() => { if (!(signal && signal.aborted)) prewarmSiblingMarineSeries(model, hour, bounds, layer, signal); }).catch(() => {});
}

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
        const model = activeModelRef.current, layer = activeMarineLayerRef.current, hour = timeOffsetRef.current;
        warmSiblingsAfter(ensureMarineSeries(model, layer, bounds, hour, signal), model, layer, bounds, hour, signal);
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
    // A pan's series waits until the map has been still SERIES_PAN_SETTLE_MS (marineSeriesPanGuard.js); a new move cancels it.
    let settle = null;
    const onMoveStart = () => { clearTimeout(settle); settle = null; };
    const onMoveEnd = () => { onMoveStart(); const ms = seriesPanSettleMs(); if (ms) settle = setTimeout(kick, ms); else kick(); };
    mapInstance.on('moveend', onMoveEnd); mapInstance.on('movestart', onMoveStart);
    window.addEventListener('timeline_scrub_start', onScrubStart);
    return () => {
      cancelled = true; clearTimeout(timer); clearTimeout(settle); intent.abort();
      try { mapInstance.off('moveend', onMoveEnd); mapInstance.off('movestart', onMoveStart); } catch { /* map destroyed */ }
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
      // It shares the viewport intent whenever supersede is on (#501's default), not only under the build flag: with its own controller
      // it kept warming the FIRST view's pages after a pan, on the box while the user scrubbed the new view (offline z8 ICON surf: three
      // old-box pages during six day steps, each step's /grid 0.6-2.7 s). Kill: __RAW_DISABLE_MODEL_WARM_SUPERSEDE__.
      const share = marineSeriesWorkBoundsEnabled()
        || (marineSeriesSupersedeOn() && !(typeof window !== 'undefined' && window.__RAW_DISABLE_MODEL_WARM_SUPERSEDE__ === true));
      const signal = share && intentRef.current
        ? intentRef.current.signalFor(marineSeriesViewportIdentity(activeModelRef.current, activeMarineLayerRef.current, bounds))
        : controller.signal;
      prewarmMarineSeries(activeModelRef.current, activeMarineLayerRef.current, bounds, signal);
    } catch { /* map not ready */ }
    return () => controller.abort();
  }, [mapInstance, activeModel, activeMarineLayer, activeModelRef, activeMarineLayerRef]);
}

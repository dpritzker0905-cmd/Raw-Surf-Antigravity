import { beginMarineCpuPhase, endMarineCpuPhase, measureMarineCpuPhase } from './marineCpuPhaseTiming';

// Only fixed labels reach the receipt. Never retain a source id, event, feature or map.
export function marineMaskRefreshPhase(event, map) {
  try {
    if (!event) return 'maskRefreshInitial';
    if (event.type === 'idle') return 'maskRefreshIdle';
    if (event.type === 'moveend') return 'maskRefreshMoveEnd';
    if (event.type === 'zoomend') return 'maskRefreshZoomEnd';
    if (event.type !== 'sourcedata') return 'maskRefreshOther';
    if (typeof event.sourceId !== 'string' || !event.sourceId) return 'maskRefreshSourceUnknown';
    const layers = map?.getStyle()?.layers;
    if (!Array.isArray(layers)) return 'maskRefreshSourceUnknown';
    // Same source selection as prepareBasemapWaterOverlay, including its default.
    const source = layers.find(layer => layer.id === 'water')?.source || 'composite';
    return event.sourceId === source ? 'maskRefreshSourceWater' : 'maskRefreshSourceOther';
  } catch (e) { return 'maskRefreshSourceUnknown'; }
}

export function measureMarineMaskRefresh(event, map, operation) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_MARINE_PHASE_TIMING__ === true) return operation();
  return measureMarineCpuPhase(marineMaskRefreshPhase(event, map), operation);
}

// Preserve the existing gates, throttle and event order. Attribution must not filter events.
export function createMarineMaskSourceRedrive(refresh) {
  let lastCheck = 0;
  return event => {
    if (typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_SOURCEDATA_REDRIVE__ === true) return;
    if (!event || !event.isSourceLoaded) return;
    const now = Date.now();
    if (now - lastCheck < 250) return;
    lastCheck = now;
    refresh(event);
  };
}

// This is nested inside maskWaterPaint: durations overlap and must not be summed.
export function measureMarineMaskPaint(water, operation) {
  const token = beginMarineCpuPhase('maskPaintUnknown');
  try {
    const result = operation();
    if (token) {
      try {
        token.phase = !result ? 'maskPaintEmpty'
          : water?.usedSourceFallback === true ? 'maskPaintSourceFallback'
          : water?.usedSourceFallback === false && result.degraded === true ? 'maskPaintRenderedDamage'
          : water?.usedSourceFallback === false && result.degraded === false ? 'maskPaintRenderedClean'
          : 'maskPaintUnknown';
      } catch (e) { /* An unreadable verdict remains unknown; preserve the returned identity. */ }
    }
    return result;
  } catch (error) {
    if (token) token.phase = 'maskPaintFailed';
    throw error;
  } finally { endMarineCpuPhase(token); }
}

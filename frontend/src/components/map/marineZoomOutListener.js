// Existing one-shot anticipation listener, shared so the real event wiring can
// be exercised independently of WebGL/mask setup. Request policy lives in the controller.
export function attachMarineZoomOutListener(map, current, prewarm) {
  let startZoom = null, fired = false;
  const start = () => { try { startZoom = map.getZoom(); fired = false; } catch (_) {} };
  const zoom = () => {
    if (fired || startZoom == null) return;
    const target = current();
    if (!target.active) return;
    let z; try { z = map.getZoom(); } catch (_) { return; }
    if (startZoom - z > 0.4) {
      fired = true;
      try {
        const b = map.getBounds();
        const bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
        const layer = target.layers?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
        prewarm(target.model, target.hour, bounds, layer);
      } catch (_) { /* anticipation is best-effort */ }
    }
  };
  map.on('zoomstart', start); map.on('zoom', zoom);
  return () => { map.off('zoomstart', start); map.off('zoom', zoom); };
}

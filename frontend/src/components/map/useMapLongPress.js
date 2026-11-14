import { useEffect, useRef } from 'react';

export function useMapLongPress({ mapInstance, onMapLongPress, enabled = true }) {
  const longPressRef = useRef(onMapLongPress);

  // Avoid stale closures in listeners
  useEffect(() => {
    longPressRef.current = onMapLongPress;
  }, [onMapLongPress]);

  useEffect(() => {
    if (!mapInstance || !enabled) return;

    // Desktop: Context menu right click
    const handleContextMenu = (e) => {
      // MapLibre suppresses the browser menu before some delayed contextmenu events.
      // Feature pins stop DOM propagation in capture; native defaultPrevented is not a mode gate.
      e.preventDefault();
      if (e && e.lngLat) {
        let lat = undefined;
        let lng = undefined;
        if (Array.isArray(e.lngLat)) {
          lng = e.lngLat[0];
          lat = e.lngLat[1];
        } else if (typeof e.lngLat === 'object') {
          lng = e.lngLat.lng !== undefined ? e.lngLat.lng : e.lngLat.lon;
          lat = e.lngLat.lat;
        }
        if (longPressRef.current && typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
          longPressRef.current({ lat, lng });
        }
      }
    };

    mapInstance.on('contextmenu', handleContextMenu);

    // Mobile: Touch gesture hold timer (500ms)
    let touchTimer = null;
    let touchStartPos = null;

    const handleTouchStart = (e) => {
      clearTimeout(touchTimer);
      touchStartPos = null;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      touchStartPos = { x: t.clientX, y: t.clientY };
      touchTimer = setTimeout(() => {
        if (!touchStartPos) return;
        const rect = mapInstance.getCanvas().getBoundingClientRect();
        const point = mapInstance.unproject([touchStartPos.x - rect.left, touchStartPos.y - rect.top]);
        if (longPressRef.current) longPressRef.current({ lat: point.lat, lng: point.lng });
        touchStartPos = null;
      }, 500);
    };

    const handleTouchMove = () => {
      clearTimeout(touchTimer);
      touchStartPos = null;
    };

    const handleTouchEnd = () => {
      clearTimeout(touchTimer);
    };

    const canvas = mapInstance.getCanvas();
    canvas.addEventListener('touchstart', handleTouchStart, { passive: true });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: true });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: true });
    canvas.addEventListener('touchcancel', handleTouchMove, { passive: true });

    return () => {
      clearTimeout(touchTimer);
      touchStartPos = null;
      mapInstance.off('contextmenu', handleContextMenu);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('touchcancel', handleTouchMove);
    };
  }, [mapInstance, enabled]);
}

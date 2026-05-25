import { useEffect, useRef } from 'react';

export function useMapLongPress({ mapInstance, onMapLongPress }) {
  const longPressRef = useRef(onMapLongPress);

  // Avoid stale closures in listeners
  useEffect(() => {
    longPressRef.current = onMapLongPress;
  }, [onMapLongPress]);

  useEffect(() => {
    if (!mapInstance) return;

    // Desktop: Context menu right click
    const handleContextMenu = (e) => {
      e.preventDefault();
      if (longPressRef.current) longPressRef.current(e.lngLat);
    };

    mapInstance.on('contextmenu', handleContextMenu);

    // Mobile: Touch gesture hold timer (500ms)
    let touchTimer = null;
    let touchStartPos = null;

    const handleTouchStart = (e) => {
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

    return () => {
      mapInstance.off('contextmenu', handleContextMenu);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, [mapInstance]);
}

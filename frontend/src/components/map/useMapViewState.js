import { useState, useCallback, useEffect, useRef } from 'react';
import { FLORIDA_CENTER } from './mapUtils';

export function useMapViewState({ effectiveLocation, onMapMoveEnd, innerMapRef }) {
  const [viewState, setViewState] = useState(() => {
    if (effectiveLocation && typeof effectiveLocation.lng === 'number' && typeof effectiveLocation.lat === 'number') {
      const zoom = effectiveLocation.source === 'gps' ? 12 : 9;
      return {
        longitude: effectiveLocation.lng,
        latitude: effectiveLocation.lat,
        zoom, pitch: 0, bearing: 0
      };
    }
    return {
      longitude: FLORIDA_CENTER.lng,
      latitude: FLORIDA_CENTER.lat,
      zoom: 7, pitch: 0, bearing: 0
    };
  });

  const onMove = useCallback(evt => {
    const nextViewState = { ...evt.viewState };
    if (nextViewState.zoom < 2.0) {
      nextViewState.zoom = 2.0;
    }
    setViewState(nextViewState);
  }, []);

  const moveEndTimerRef = useRef(null);
  const onMoveEnd = useCallback(evt => {
    if (!onMapMoveEnd) return;
    clearTimeout(moveEndTimerRef.current);
    moveEndTimerRef.current = setTimeout(() => {
      onMapMoveEnd({ lat: evt.viewState.latitude, lng: evt.viewState.longitude });
    }, 800);
  }, [onMapMoveEnd]);

  // Sync to effectiveLocation (GPS or Search results)
  useEffect(() => {
    if (effectiveLocation && innerMapRef.current) {
      const targetZoom = effectiveLocation.source === 'gps' ? 12 : 9;
      const map = innerMapRef.current.getMap ? innerMapRef.current.getMap() : innerMapRef.current;
      if (map) {
        try {
          const center = map.getCenter ? map.getCenter() : null;
          const currentZoom = map.getZoom ? map.getZoom() : null;
          if (center && typeof currentZoom === 'number') {
            const latDiff = Math.abs(center.lat - effectiveLocation.lat);
            const lngDiff = Math.abs(center.lng - effectiveLocation.lng);
            const zoomDiff = Math.abs(currentZoom - targetZoom);
            if (latDiff < 0.0001 && lngDiff < 0.0001 && zoomDiff < 0.01) {
              return; // Already centered, skip flyTo to prevent entering moving/zooming state
            }
          }
        } catch (e) {
          // Ignore position/zoom query errors if map is not yet fully initialized/styled
        }
      }
      innerMapRef.current.flyTo({
        center: [effectiveLocation.lng, effectiveLocation.lat],
        zoom: targetZoom
      });
    }
  }, [effectiveLocation, innerMapRef]);

  return { viewState, onMove, onMoveEnd };
}

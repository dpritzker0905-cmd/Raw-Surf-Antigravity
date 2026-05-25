import { useState, useCallback, useEffect, useRef } from 'react';
import { FLORIDA_CENTER } from './mapUtils';

export function useMapViewState({ effectiveLocation, onMapMoveEnd, innerMapRef }) {
  const [viewState, setViewState] = useState({
    longitude: FLORIDA_CENTER.lng, latitude: FLORIDA_CENTER.lat,
    zoom: 7, pitch: 0, bearing: 0
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
      const zoom = effectiveLocation.source === 'gps' ? 12 : 9;
      innerMapRef.current.flyTo({
        center: [effectiveLocation.lng, effectiveLocation.lat],
        zoom
      });
    }
  }, [effectiveLocation, innerMapRef]);

  return { viewState, onMove, onMoveEnd };
}

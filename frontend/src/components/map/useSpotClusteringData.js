import { useEffect, useMemo, useState } from 'react';
import { useMarkerClustering } from '../../hooks/useMarkerClustering';

export function useSpotClusteringData({ surfSpots, filter, mapInstance, viewState, surfMode = false }) {
  const clusteringOptions = useMemo(() => ({ radius: 60, maxZoom: 14 }), []);

  // 2026-09-23: `viewState` comes from react-maplibre's onMove, i.e. the camera the map is ABOUT to take. The
  // memo below runs in this render — before the map applies that camera — so getBounds() read the PREVIOUS
  // camera. Small drags hid the one-step lag; one large jump (z9 Miami -> z2 world) left clustering on the old
  // 1° box and every spot vanished until the next pan (live: 1,773 spots in, 0 clusters out). 'moveend' fires
  // after the camera is applied, so re-reading on it guarantees the settled view is correct — the same
  // pattern useSpotRatings uses for its fetch trigger.
  const [moveNonce, setMoveNonce] = useState(0);
  useEffect(() => {
    if (!mapInstance) return undefined;
    const onSettled = () => setMoveNonce((n) => (n + 1) % 1000000);
    mapInstance.on('moveend', onSettled);
    mapInstance.on('resize', onSettled);
    return () => {
      try { mapInstance.off('moveend', onSettled); mapInstance.off('resize', onSettled); } catch (e) { /* map gone */ }
    };
  }, [mapInstance]);

  // In Rating mode the spots ARE the overlay (each becomes a quality glyph), so surface them even when the
  // marker filter would otherwise hide them — otherwise the headline "rating at the surf spots" is invisible.
  const spotsToCluster = useMemo(() =>
    (surfMode || filter === 'all' || filter === 'spots') ? surfSpots : [],
  [filter, surfSpots, surfMode]);

  const currentBounds = useMemo(() => {
    if (!mapInstance) return { west: -180, south: -85, east: 180, north: 85 };
    const b = mapInstance.getBounds();
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  }, [mapInstance, viewState.longitude, viewState.latitude, viewState.zoom, moveNonce]);

  const { clusters: spotClusters, supercluster } = useMarkerClustering(
    spotsToCluster, currentBounds, viewState.zoom, clusteringOptions
  );

  const spotGeoJSON = useMemo(() => {
    return {
      type: 'FeatureCollection',
      features: spotsToCluster.map(spot => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [spot.longitude, spot.latitude] },
        properties: {
          id: spot.id,
          geofence_radius: spot.geofence_radius || 200
        }
      }))
    };
  }, [spotsToCluster]);

  return { spotClusters, spotGeoJSON, supercluster };
}

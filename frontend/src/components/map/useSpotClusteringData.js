import { useMemo } from 'react';
import { useMarkerClustering } from '../../hooks/useMarkerClustering';

export function useSpotClusteringData({ surfSpots, filter, mapInstance, viewState, surfMode = false }) {
  const clusteringOptions = useMemo(() => ({ radius: 60, maxZoom: 14 }), []);

  // In Rating mode the spots ARE the overlay (each becomes a quality glyph), so surface them even when the
  // marker filter would otherwise hide them — otherwise the headline "rating at the surf spots" is invisible.
  const spotsToCluster = useMemo(() =>
    (surfMode || filter === 'all' || filter === 'spots') ? surfSpots : [],
  [filter, surfSpots, surfMode]);

  const currentBounds = useMemo(() => {
    if (!mapInstance) return { west: -180, south: -85, east: 180, north: 85 };
    const b = mapInstance.getBounds();
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  }, [mapInstance, viewState.longitude, viewState.latitude, viewState.zoom]);

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

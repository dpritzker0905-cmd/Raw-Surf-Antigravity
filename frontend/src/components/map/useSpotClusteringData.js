import { useMemo } from 'react';
import { useMarkerClustering } from '../../hooks/useMarkerClustering';

export function useSpotClusteringData({ surfSpots, filter, mapInstance, viewState }) {
  const clusteringOptions = useMemo(() => ({ radius: 60, maxZoom: 14 }), []);
  
  const spotsToCluster = useMemo(() => 
    (filter === 'all' || filter === 'spots') ? surfSpots : [], 
  [filter, surfSpots]);

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

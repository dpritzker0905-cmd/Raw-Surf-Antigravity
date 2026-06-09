/**
 * useMarkerClustering - Supercluster integration for 60FPS map rendering
 * Groups markers when zoomed out, expands on zoom in
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Supercluster from 'supercluster';

/**
 * Custom hook for marker clustering
 * @param {Array} spots - Array of spot objects with lat/lng
 * @param {Object} bounds - Map bounds { north, south, east, west }
 * @param {number} zoom - Current map zoom level
 * @param {Object} options - Supercluster options (should be memoized by caller)
 */
export const useMarkerClustering = (spots, bounds, zoom, options = {}) => {
  const [clusters, setClusters] = useState([]);
  const superclusterRef = useRef(null);
  
  // Extract option values to avoid object reference comparison issues
  const radius = options.radius || 60;
  const maxZoom = options.maxZoom || 16;
  const minZoom = options.minZoom || 0;
  
  // Create supercluster index - use stable dependency values
  const supercluster = useMemo(() => {
    const index = new Supercluster({
      radius,
      maxZoom,
      minZoom
    });
    
    // Convert spots to GeoJSON features
    const points = (spots || [])
      .filter(spot => spot.latitude && spot.longitude)
      .map(spot => ({
        type: 'Feature',
        properties: {
          cluster: false,
          spotId: spot.id,
          name: spot.name,
          region: spot.region,
          country: spot.country,
          active_photographers_count: spot.active_photographers_count || 0,
          is_within_geofence: spot.is_within_geofence !== false,
          distance_miles: spot.distance_miles,
          is_verified_peak: spot.is_verified_peak,
          accuracy_flag: spot.accuracy_flag,
          wave_type: spot.wave_type,
          // Store full spot data for marker clicks
          spot: spot
        },
        geometry: {
          type: 'Point',
          coordinates: [spot.longitude, spot.latitude]
        }
      }));
    
    index.load(points);
    superclusterRef.current = index;
    return index;
  }, [spots, radius, maxZoom, minZoom]);
  
  // Get clusters for current viewport
  useEffect(() => {
    if (!bounds || !supercluster) {
      setClusters([]);
      return;
    }
    
    let clusterData = [];
    const south = Math.max(-85, Math.min(85, bounds.south));
    const north = Math.max(-85, Math.min(85, bounds.north));
    
    if (bounds.east - bounds.west >= 360) {
      // Entire world
      clusterData = supercluster.getClusters([-180, south, 180, north], Math.floor(zoom));
    } else {
      // Wrap longitudes to standard range [-180, 180]
      const wrap = (lng) => {
        const w = ((lng + 180) % 360 + 360) % 360 - 180;
        return w === -180 ? 180 : w; // avoid -180 vs 180 boundary issues
      };
      const w = wrap(bounds.west);
      const e = wrap(bounds.east);
      
      if (w > e) {
        // Crossed antimeridian: split query
        clusterData = [
          ...supercluster.getClusters([w, south, 180, north], Math.floor(zoom)),
          ...supercluster.getClusters([-180, south, e, north], Math.floor(zoom))
        ];
      } else {
        clusterData = supercluster.getClusters([w, south, e, north], Math.floor(zoom));
      }
    }
    
    // Transform clusters to usable format
    const transformedClusters = clusterData.map(feature => {
      const [lng, lat] = feature.geometry.coordinates;
      
      if (feature.properties.cluster) {
        // It's a cluster
        return {
          id: `cluster-${feature.id}`,
          isCluster: true,
          latitude: lat,
          longitude: lng,
          pointCount: feature.properties.point_count,
          pointCountAbbreviated: feature.properties.point_count_abbreviated,
          clusterId: feature.id,
          // Get expansion zoom level
          expansionZoom: supercluster.getClusterExpansionZoom(feature.id)
        };
      } else {
        // It's a single point
        return {
          id: feature.properties.spotId,
          isCluster: false,
          latitude: lat,
          longitude: lng,
          ...feature.properties
        };
      }
    });
    
    setClusters(transformedClusters);
  }, [bounds, zoom, supercluster]);
  
  // Get cluster children (for expanding clusters)
  const getClusterChildren = useCallback((clusterId) => {
    if (!supercluster) return [];
    try {
      return supercluster.getLeaves(clusterId, Infinity);
    } catch (e) {
      return [];
    }
  }, [supercluster]);
  
  return {
    clusters,
    getClusterChildren,
    supercluster
  };
};

export default useMarkerClustering;

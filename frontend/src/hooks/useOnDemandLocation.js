import { useState, useEffect } from 'react';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

export const useOnDemandLocation = (step, userLocation, photographer, user) => {
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [customLocationName, setCustomLocationName] = useState('');
  const [customLocationAddress, setCustomLocationAddress] = useState('');
  const [nearbySpots, setNearbySpots] = useState([]);
  const [loadingSpots, setLoadingSpots] = useState(false);
  const [spotSearchQuery, setSpotSearchQuery] = useState('');
  const [useCustomLocation, setUseCustomLocation] = useState(false);
  const [recentSpots, setRecentSpots] = useState([]);
  const [customLocationCoords, setCustomLocationCoords] = useState(null);
  const [geocodingAddress, setGeocodingAddress] = useState(false);

  // Load recently visited spots from localStorage
  useEffect(() => {
    if (step === 'location') {
      try {
        const stored = localStorage.getItem('rawsurf_recent_spots');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) setRecentSpots(parsed.slice(0, 5));
        }
      } catch (e) { /* silent */ }
    }
  }, [step]);

  // Geocode custom address when user finishes typing
  useEffect(() => {
    if (!useCustomLocation || !customLocationAddress || customLocationAddress.trim().length < 5) {
      setCustomLocationCoords(null);
      return;
    }
    const timeoutId = setTimeout(async () => {
      setGeocodingAddress(true);
      try {
        const encoded = encodeURIComponent(customLocationAddress.trim());
        const refLat = userLocation?.latitude || photographer?.on_demand_latitude || 28.3667;
        const refLng = userLocation?.longitude || photographer?.on_demand_longitude || -80.6067;
        const boxDelta = 0.5;
        const viewbox = `${refLng - boxDelta},${refLat + boxDelta},${refLng + boxDelta},${refLat - boxDelta}`;
        
        const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=5&viewbox=${viewbox}&bounded=1`;
        let res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        let data = await res.json();
        
        if (!data || data.length === 0) {
          const fallbackUrl = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=5&viewbox=${viewbox}&bounded=0`;
          res = await fetch(fallbackUrl, { headers: { 'Accept': 'application/json' } });
          data = await res.json();
        }
        
        if (data && data.length > 0) {
          let bestResult = data[0];
          let bestDist = Infinity;
          for (const item of data) {
            const dLat = parseFloat(item.lat) - refLat;
            const dLng = parseFloat(item.lon) - refLng;
            const dist = dLat * dLat + dLng * dLng;
            if (dist < bestDist) {
              bestDist = dist;
              bestResult = item;
            }
          }
          
          const coords = { latitude: parseFloat(bestResult.lat), longitude: parseFloat(bestResult.lon) };
          setCustomLocationCoords(coords);
          logger.info('[OnDemandLocation] Geocoded address:', customLocationAddress, '->', coords, `(${bestResult.display_name})`);
        } else {
          setCustomLocationCoords(null);
          logger.warn('[OnDemandLocation] Geocoding returned no results for:', customLocationAddress);
        }
      } catch (e) {
        logger.error('[OnDemandLocation] Geocoding failed:', e);
        setCustomLocationCoords(null);
      } finally {
        setGeocodingAddress(false);
      }
    }, 800);
    return () => clearTimeout(timeoutId);
  }, [customLocationAddress, useCustomLocation, userLocation?.latitude, userLocation?.longitude, photographer?.on_demand_latitude, photographer?.on_demand_longitude]);

  // Save a spot to recently visited
  const saveRecentSpot = (spot) => {
    if (!spot) return;
    try {
      const stored = localStorage.getItem('rawsurf_recent_spots');
      let existing = stored ? JSON.parse(stored) : [];
      if (!Array.isArray(existing)) existing = [];
      const key = spot.id || spot.name;
      existing = existing.filter(s => (s.id || s.name) !== key);
      existing.unshift({
        id: spot.id || null,
        name: spot.name,
        region: spot.region || null,
        latitude: spot.latitude || null,
        longitude: spot.longitude || null,
        image_url: spot.image_url || null,
        is_custom: !!spot.is_custom,
        saved_at: Date.now()
      });
      localStorage.setItem('rawsurf_recent_spots', JSON.stringify(existing.slice(0, 5)));
    } catch (e) { /* silent */ }
  };

  // Fetch nearby spots
  useEffect(() => {
    const fetchNearbySpots = async () => {
      if (step !== 'location') return;
      setLoadingSpots(true);
      try {
        const lat = userLocation?.latitude || photographer?.on_demand_latitude || 28.3667;
        const lng = userLocation?.longitude || photographer?.on_demand_longitude || -80.6067;
        const response = await apiClient.get(`/surf-spots/nearby?latitude=${lat}&longitude=${lng}&radius_miles=15${user?.id ? `` : ''}`);
        setNearbySpots(response.data || []);
      } catch (e) {
        logger.error('[OnDemandLocation] Failed to fetch nearby spots:', e);
        setNearbySpots([]);
      } finally {
        setLoadingSpots(false);
      }
    };
    fetchNearbySpots();
  }, [step, userLocation?.latitude, userLocation?.longitude, photographer?.on_demand_latitude, photographer?.on_demand_longitude, user?.id]);

  return {
    selectedSpot, setSelectedSpot,
    customLocationName, setCustomLocationName,
    customLocationAddress, setCustomLocationAddress,
    nearbySpots, setNearbySpots,
    loadingSpots, setLoadingSpots,
    spotSearchQuery, setSpotSearchQuery,
    useCustomLocation, setUseCustomLocation,
    recentSpots, setRecentSpots,
    customLocationCoords, setCustomLocationCoords,
    geocodingAddress, setGeocodingAddress,
    saveRecentSpot
  };
};

export default useOnDemandLocation;

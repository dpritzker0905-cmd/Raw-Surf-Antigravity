import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Viewport-scoped wind vector data hook.
 * Fetches wind speed/direction ONLY for the current map bbox.
 * Returns GeoJSON with:
 *   - LineString features for directional flow lines
 *   - Point features at endpoints for arrowhead symbols
 * All MapLibre-native rendering — no deck.gl.
 */
export function useWindVectorData({ active, mapBounds }) {
  const [windData, setWindData] = useState(null);
  const fetchingRef = useRef(false);
  const revisionRef = useRef(0);

  const fetchWind = useCallback(async (bounds) => {
    if (!bounds || fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      const { west, south, east, north } = bounds;
      const latStep = Math.max(1, (north - south) / 6);
      const lngStep = Math.max(1, (east - west) / 6);

      const points = [];
      for (let lat = south; lat <= north; lat += latStep) {
        for (let lng = west; lng <= east; lng += lngStep) {
          let n = lng;
          while (n > 180) n -= 360;
          while (n < -180) n += 360;
          points.push({ lat: +lat.toFixed(2), lng: +n.toFixed(2) });
        }
      }

      const safe = points.slice(0, 80);
      const lats = safe.map(p => p.lat).join(',');
      const lons = safe.map(p => p.lng).join(',');

      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&forecast_days=1`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const results = Array.isArray(json) ? json : [json];

      const features = [];
      safe.forEach((pt, i) => {
        const r = results[i];
        if (!r?.current) return;
        const speed = r.current.wind_speed_10m;
        const dir = r.current.wind_direction_10m;
        if (speed == null || dir == null || isNaN(speed) || isNaN(dir)) return;

        // Wind direction in meteorology = where wind comes FROM
        // Arrow should point in the direction wind is GOING
        const rad = (dir) * (Math.PI / 180);
        const length = Math.max(0.03, speed * 0.05);
        const endLng = pt.lng + Math.sin(rad) * length;
        const endLat = pt.lat - Math.cos(rad) * length;

        // Flow line (animated via dash-array in MapLibre)
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [[pt.lng, pt.lat], [endLng, endLat]]
          },
          properties: { speed, direction: dir, type: 'line' }
        });

        // Arrowhead point at the tip
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [endLng, endLat] },
          properties: { speed, direction: dir, type: 'arrow' }
        });
      });

      if (features.length > 0) {
        revisionRef.current += 1;
        setWindData({ type: 'FeatureCollection', features });
      }
    } catch (err) {
      console.warn('[WindVectors] Viewport fetch failed:', err);
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active || !mapBounds) { setWindData(null); return; }
    const timer = setTimeout(() => fetchWind(mapBounds), 1200);
    return () => clearTimeout(timer);
  }, [active, mapBounds, fetchWind]);

  return { windData, windRevision: revisionRef };
}

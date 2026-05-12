import { useState, useEffect, useMemo, useRef } from 'react';
import { TripsLayer } from '@deck.gl/geo-layers';

/**
 * Viewport-scoped wind vector layer.
 * Fetches u/v wind data ONLY for the current map bbox — no global cache, no backend dependency.
 * Renders animated directional particles via GPU-accelerated TripsLayer.
 */
export function useGPUWindLayer({ active, mapBounds }) {
  const [trips, setTrips] = useState([]);
  const [time, setTime] = useState(0);
  const fetchingRef = useRef(false);

  // Fetch wind vectors for current viewport only
  useEffect(() => {
    if (!active || !mapBounds) { setTrips([]); return; }
    if (fetchingRef.current) return;

    const timer = setTimeout(async () => {
      fetchingRef.current = true;
      try {
        const { west, south, east, north } = mapBounds;
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

        const arrows = [];
        safe.forEach((pt, i) => {
          const r = results[i];
          if (!r?.current) return;
          const speed = r.current.wind_speed_10m;
          const dir = r.current.wind_direction_10m;
          if (speed == null || dir == null || isNaN(speed) || isNaN(dir)) return;

          const rad = (dir - 180) * (Math.PI / 180);
          const length = Math.max(0.02, speed * 0.04);

          arrows.push({
            path: [
              [pt.lng, pt.lat],
              [pt.lng + Math.sin(rad) * length, pt.lat + Math.cos(rad) * length]
            ],
            timestamps: [0, 100],
            speed
          });
        });

        setTrips(arrows);
      } catch (err) {
        console.warn('[GPUWindLayer] Viewport fetch failed:', err);
      } finally {
        fetchingRef.current = false;
      }
    }, 1200); // Debounce to prevent rate limits

    return () => clearTimeout(timer);
  }, [active, mapBounds]);

  // Animation loop — GPU-driven, zero CPU math
  useEffect(() => {
    if (!active || !trips.length) return;
    let frame;
    const animate = () => {
      setTime(t => (t + 1) % 100);
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, [active, trips]);

  return useMemo(() => {
    if (!active || !trips.length) return null;
    return new TripsLayer({
      id: 'gpu-wind-trips',
      data: trips,
      getPath: d => d.path,
      getTimestamps: d => d.timestamps,
      getColor: d => {
        const s = d.speed;
        if (s < 5) return [100, 200, 255, 180];
        if (s < 15) return [50, 255, 150, 210];
        if (s < 25) return [255, 200, 0, 230];
        return [255, 50, 50, 255];
      },
      getWidth: d => Math.max(1, d.speed / 4),
      currentTime: time,
      trailLength: 40,
      widthMinPixels: 1,
      widthMaxPixels: 5,
      capRounded: true,
    });
  }, [active, trips, time]);
}

import { useState, useEffect, useMemo, useRef } from 'react';

// Lazy-load LineLayer to avoid Webpack TDZ (Temporal Dead Zone) crash.
// deck.gl sub-packages have circular dependencies that break static imports
// when bundled with create-react-app / craco.
let _LineLayer = null;
const getLineLayer = async () => {
  if (!_LineLayer) {
    const mod = await import('@deck.gl/layers');
    _LineLayer = mod.LineLayer;
  }
  return _LineLayer;
};

/**
 * Viewport-scoped wind vector layer.
 * Fetches wind data ONLY for the current map bbox — no global cache, no backend dependency.
 * Renders animated directional lines via GPU-accelerated LineLayer.
 */
export function useGPUWindLayer({ active, mapBounds }) {
  const [arrows, setArrows] = useState([]);
  const [phase, setPhase] = useState(0);
  const [LayerClass, setLayerClass] = useState(null);
  const fetchingRef = useRef(false);

  // Lazy-load the LineLayer class once
  useEffect(() => {
    if (active && !LayerClass) {
      getLineLayer().then(LC => setLayerClass(() => LC));
    }
  }, [active, LayerClass]);

  // Fetch wind vectors for current viewport only
  useEffect(() => {
    if (!active || !mapBounds) { setArrows([]); return; }
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

        const data = [];
        safe.forEach((pt, i) => {
          const r = results[i];
          if (!r?.current) return;
          const speed = r.current.wind_speed_10m;
          const dir = r.current.wind_direction_10m;
          if (speed == null || dir == null || isNaN(speed) || isNaN(dir)) return;

          const rad = (dir - 180) * (Math.PI / 180);
          const length = Math.max(0.02, speed * 0.04);

          data.push({
            from: [pt.lng, pt.lat],
            to: [pt.lng + Math.sin(rad) * length, pt.lat + Math.cos(rad) * length],
            speed
          });
        });

        setArrows(data);
      } catch (err) {
        console.warn('[GPUWindLayer] Viewport fetch failed:', err);
      } finally {
        fetchingRef.current = false;
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [active, mapBounds]);

  // Animation phase loop — pulsing opacity for flow effect
  useEffect(() => {
    if (!active || !arrows.length) return;
    let frame;
    const animate = () => {
      setPhase(t => (t + 2) % 360);
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, [active, arrows]);

  return useMemo(() => {
    if (!active || !arrows.length || !LayerClass) return null;
    const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI / 180);
    return new LayerClass({
      id: 'gpu-wind-lines',
      data: arrows,
      getSourcePosition: d => d.from,
      getTargetPosition: d => d.to,
      getColor: d => {
        const s = d.speed;
        const a = Math.round(120 + 135 * pulse);
        if (s < 5) return [100, 200, 255, a];
        if (s < 15) return [50, 255, 150, a];
        if (s < 25) return [255, 200, 0, a];
        return [255, 50, 50, a];
      },
      getWidth: d => Math.max(1.5, d.speed / 3),
      widthUnits: 'pixels',
      widthMinPixels: 1,
      widthMaxPixels: 6,
      updateTriggers: {
        getColor: [phase]
      }
    });
  }, [active, arrows, phase, LayerClass]);
}

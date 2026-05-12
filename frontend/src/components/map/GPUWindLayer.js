import React, { useState, useEffect, useMemo } from 'react';
import { TripsLayer } from '@deck.gl/geo-layers';
import { API_BASE } from '../../lib/apiClient';

export function useGPUWindLayer({ active, timeOffsetHours = 0, isLight = true }) {
  const [data, setData] = useState([]);
  const [time, setTime] = useState(0);

  useEffect(() => {
    if (!active) return;
    fetch(`${API_BASE}/tiles/wind`)
      .then(res => res.json())
      .then(json => {
        if (!json.error) setData(json);
      })
      .catch(err => console.error('[GPUWindLayer]', err));
  }, [active]);

  // Animation Loop (60fps but zero CPU math)
  useEffect(() => {
    if (!active || !data.length) return;
    let frame;
    const animate = () => {
      setTime(t => (t + 1) % 100);
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, [active, data]);

  const layer = useMemo(() => {
    if (!active || !data.length) return null;

    const targetIdx = Math.max(0, Math.min(47, timeOffsetHours));
    const trips = [];

    data.forEach(item => {
      if (!item.hourly || !item.hourly.wind_speed_10m) return;
      const speed = item.hourly.wind_speed_10m[targetIdx];
      const dir = item.hourly.wind_direction_10m[targetIdx];
      
      if (speed == null || dir == null) return;

      const rad = (dir - 180) * (Math.PI / 180);
      const length = speed * 0.08; 
      
      trips.push({
        path: [
          [item.longitude, item.latitude],
          [item.longitude + Math.sin(rad) * length, item.latitude + Math.cos(rad) * length]
        ],
        timestamps: [0, 100],
        speed: speed
      });
    });

    return new TripsLayer({
      id: 'gpu-wind-trips-layer',
      data: trips,
      getPath: d => d.path,
      getTimestamps: d => d.timestamps,
      getColor: d => {
        if (d.speed < 5) return [0, 200, 255, 255];
        if (d.speed < 15) return [0, 255, 100, 255];
        if (d.speed < 30) return [255, 200, 0, 255];
        return [255, 50, 50, 255];
      },
      opacity: 0.8,
      widthMinPixels: 2,
      trailLength: 50,
      currentTime: time
    });
  }, [active, data, timeOffsetHours, time]);

  return layer;
}

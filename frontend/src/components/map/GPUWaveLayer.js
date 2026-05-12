import React, { useState, useEffect, useMemo } from 'react';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';

export function useGPUWaveLayer({ active, activeLayer, timeOffsetHours = 0, isLight = true }) {
  const [data, setData] = useState([]);

  useEffect(() => {
    if (!active) return;
    fetch('/api/tiles/marine')
      .then(res => res.json())
      .then(json => {
        if (!json.error) setData(json);
      })
      .catch(err => console.error('[GPUWaveLayer]', err));
  }, [active]);

  const layer = useMemo(() => {
    if (!active || !data.length) return null;

    const targetIdx = Math.max(0, Math.min(47, timeOffsetHours));
    const varMap = {
      'waves': 'wave_height',
      'swell_1': 'swell_wave_height',
      'swell_2': 'swell_wave_height',
      'wind_waves': 'wave_height'
    };
    const v = varMap[activeLayer] || 'wave_height';

    const heatPoints = [];

    data.forEach(item => {
      if (!item.hourly || !item.hourly[v]) return;
      const height = item.hourly[v][targetIdx];
      if (height == null || height === 0) return;

      heatPoints.push({
        position: [item.longitude, item.latitude],
        weight: height
      });
    });

    return new HeatmapLayer({
      id: 'gpu-wave-heatmap',
      data: heatPoints,
      getPosition: d => d.position,
      getWeight: d => d.weight,
      radiusPixels: 45,
      intensity: 1.5,
      threshold: 0.1,
      colorRange: [
        [0, 10, 50, 20],      // Deep navy/clear
        [0, 100, 150, 100],   // Cyan
        [0, 200, 150, 200],   // Bright Cyan/Green
        [200, 255, 50, 255],  // Yellow
        [255, 100, 0, 255],   // Orange
        [255, 0, 50, 255]     // Red (massive waves)
      ]
    });
  }, [active, activeLayer, data, timeOffsetHours]);

  return layer;
}

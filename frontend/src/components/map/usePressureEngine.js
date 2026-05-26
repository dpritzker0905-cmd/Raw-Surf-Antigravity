import { useState, useEffect, useRef } from 'react';
import { fetchPressureData } from './marineController';

// Helper to compute geodesic distance between coordinates using the Haversine formula
function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function usePressureEngine({ mapInstance, activeLayers, timeOffsetHours, activeModel }) {
  const [lowSystems, setLowSystems] = useState([]);
  const [highSystems, setHighSystems] = useState([]);
  const lastComputedVersionRef = useRef('');

  useEffect(() => {
    if (!mapInstance || !activeLayers.includes('pressure')) {
      return;
    }

    let isSubscribed = true;

    const handleUpdate = async () => {
      if (!isSubscribed) return;

      const b = mapInstance.getBounds();
      const bounds = {
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth()
      };

      // Version tag to prevent redundant calculations if view state or time or model has not changed
      const version = `${activeModel}-${timeOffsetHours}-${bounds.west.toFixed(3)}-${bounds.east.toFixed(3)}-${bounds.south.toFixed(3)}-${bounds.north.toFixed(3)}`;
      if (version === lastComputedVersionRef.current) {
        return;
      }

      try {
        const data = await fetchPressureData(bounds, null, timeOffsetHours, false, 3, activeModel);
        if (!data || !data.pressures || data.pressures.length === 0 || !isSubscribed) {
          return;
        }

        const coarseRows = data.rows;
        const coarseCols = data.cols;
        const pressures = data.pressures;

        // Step 1: Reshape 1D flat array into 2D coarse grid
        const coarseMatrix = [];
        for (let y = 0; y < coarseRows; y++) {
          coarseMatrix[y] = [];
          for (let x = 0; x < coarseCols; x++) {
            coarseMatrix[y][x] = pressures[y * coarseCols + x].pressure;
          }
        }

        // Step 2: Bilinearly interpolate from 15x15 coarse grid to 45x45 high-density dense grid
        const denseRows = 45;
        const denseCols = 45;
        const P = [];
        for (let dy = 0; dy < denseRows; dy++) {
          P[dy] = [];
          const cy = (dy / (denseRows - 1)) * (coarseRows - 1);
          const y0 = Math.floor(cy);
          const y1 = Math.min(coarseRows - 1, y0 + 1);
          const ty = cy - y0;

          for (let dx = 0; dx < denseCols; dx++) {
            const cx = (dx / (denseCols - 1)) * (coarseCols - 1);
            const x0 = Math.floor(cx);
            const x1 = Math.min(coarseCols - 1, x0 + 1);
            const tx = cx - x0;

            const v00 = coarseMatrix[y0][x0];
            const v10 = coarseMatrix[y1][x0];
            const v01 = coarseMatrix[y0][x1];
            const v11 = coarseMatrix[y1][x1];

            P[dy][dx] = (1 - tx) * (1 - ty) * v00 +
                        tx * (1 - ty) * v01 +
                        (1 - tx) * ty * v10 +
                        tx * ty * v11;
          }
        }

        // Step 3: Apply 3x3 mean filter to smooth isobar patterns
        const smoothedP = [];
        for (let y = 0; y < denseRows; y++) {
          smoothedP[y] = [];
          for (let x = 0; x < denseCols; x++) {
            let sum = 0;
            let count = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const ny = y + dy;
                const nx = x + dx;
                if (ny >= 0 && ny < denseRows && nx >= 0 && nx < denseCols) {
                  sum += P[ny][nx];
                  count++;
                }
              }
            }
            smoothedP[y][x] = sum / count;
          }
        }

        // Step 4: Find local extrema in Moore neighborhood (8 neighbors)
        const extrema = [];
        for (let y = 1; y < denseRows - 1; y++) {
          for (let x = 1; x < denseCols - 1; x++) {
            const val = smoothedP[y][x];
            let isMax = true;
            let isMin = true;

            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue;
                const neighborVal = smoothedP[y + dy][x + dx];
                if (neighborVal >= val) isMax = false;
                if (neighborVal <= val) isMin = false;
              }
            }

            if (isMax) {
              extrema.push({ y, x, val, type: 'H' });
            } else if (isMin) {
              extrema.push({ y, x, val, type: 'L' });
            }
          }
        }

        // Step 5: Apply Percentile and Absolute Thresholds
        const flatPressures = smoothedP.flat().sort((a, b) => a - b);
        const p10 = flatPressures[Math.floor(flatPressures.length * 0.1)];
        const p90 = flatPressures[Math.floor(flatPressures.length * 0.9)];

        const filteredExtrema = extrema.filter(ext => {
          if (ext.type === 'H') {
            return ext.val >= p90 && ext.val >= 1013;
          } else {
            return ext.val <= p10 && ext.val <= 1013;
          }
        });

        // Step 6: Map to lat/lon and cluster (within 200km radius, keep strongest)
        const south = data.bounds.south;
        const north = data.bounds.north;
        const west = data.bounds.west;
        const east = data.bounds.east;

        // Cluster Highs
        const candidateHighs = filteredExtrema
          .filter(e => e.type === 'H')
          .map(e => {
            const lat = south + (e.y / (denseRows - 1)) * (north - south);
            const lng = west + (e.x / (denseCols - 1)) * (east - west);
            let normLng = lng;
            while (normLng > 180) normLng -= 360;
            while (normLng < -180) normLng += 360;
            return {
              lat,
              lng: normLng,
              pressure: Math.round(e.val),
              type: 'H'
            };
          })
          .sort((a, b) => b.pressure - a.pressure); // highest first

        const selectedHighs = [];
        candidateHighs.forEach(h => {
          const isNear = selectedHighs.some(sh => getHaversineDistance(h.lat, h.lng, sh.lat, sh.lng) < 200);
          if (!isNear) {
            selectedHighs.push(h);
          }
        });

        // Cluster Lows
        const candidateLows = filteredExtrema
          .filter(e => e.type === 'L')
          .map(e => {
            const lat = south + (e.y / (denseRows - 1)) * (north - south);
            const lng = west + (e.x / (denseCols - 1)) * (east - west);
            let normLng = lng;
            while (normLng > 180) normLng -= 360;
            while (normLng < -180) normLng += 360;
            return {
              lat,
              lng: normLng,
              pressure: Math.round(e.val),
              type: 'L'
            };
          })
          .sort((a, b) => a.pressure - b.pressure); // lowest first

        const selectedLows = [];
        candidateLows.forEach(l => {
          const isNear = selectedLows.some(sl => getHaversineDistance(l.lat, l.lng, sl.lat, sl.lng) < 200);
          if (!isNear) {
            selectedLows.push(l);
          }
        });

        if (isSubscribed) {
          setHighSystems(selectedHighs);
          setLowSystems(selectedLows);
          lastComputedVersionRef.current = version;
        }

      } catch (err) {
        console.error('[PressureEngine] Calculations error:', err);
      }
    };

    // Register event listener on map movement/zoom boundaries
    mapInstance.on('moveend', handleUpdate);
    handleUpdate();

    return () => {
      isSubscribed = false;
      mapInstance.off('moveend', handleUpdate);
    };
  }, [mapInstance, activeLayers, timeOffsetHours, activeModel]);

  return { lowSystems, highSystems };
}

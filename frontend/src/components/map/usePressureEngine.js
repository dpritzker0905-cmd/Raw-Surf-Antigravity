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

// Ocean basin classifier mapping coordinate spaces to unique meteorological basins
function getBasin(lat, lng) {
  let normLng = lng;
  while (normLng > 180) normLng -= 360;
  while (normLng < -180) normLng += 360;

  if (lat > 0) {
    if (normLng >= -100 && normLng <= 20) {
      return 'North Atlantic';
    } else if (normLng > 20 && normLng < 120) {
      return 'Indian Ocean';
    } else {
      return 'North Pacific';
    }
  } else {
    if (normLng >= -70 && normLng <= 20) {
      return 'South Atlantic';
    } else if (normLng > 20 && normLng <= 140) {
      return 'Indian Ocean';
    } else {
      return 'South Pacific';
    }
  }
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

      // Version tag to prevent redundant calculations
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

        // Step 2: Bilinearly interpolate to high-density dense grid (45x45)
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

        // Step 4: Basin-Aware Normalization (Full scan before emission)
        const south = data.bounds.south;
        const north = data.bounds.north;
        const west = data.bounds.west;
        const east = data.bounds.east;

        const basinPressures = {
          'North Atlantic': [],
          'South Atlantic': [],
          'North Pacific': [],
          'South Pacific': [],
          'Indian Ocean': []
        };

        for (let y = 0; y < denseRows; y++) {
          for (let x = 0; x < denseCols; x++) {
            const lat = south + (y / (denseRows - 1)) * (north - south);
            const lng = west + (x / (denseCols - 1)) * (east - west);
            const val = smoothedP[y][x];
            const basin = getBasin(lat, lng);
            basinPressures[basin].push(val);
          }
        }

        const basinStats = {};
        for (const [basin, vals] of Object.entries(basinPressures)) {
          if (vals.length === 0) {
            basinStats[basin] = { lowThresh: 1011, highThresh: 1015, mean: 1013 };
            continue;
          }
          const sorted = [...vals].sort((a, b) => a - b);
          const mean = vals.reduce((sum, v) => sum + v, 0) / vals.length;
          const p15 = sorted[Math.floor(sorted.length * 0.15)];
          const p85 = sorted[Math.floor(sorted.length * 0.85)];
          
          basinStats[basin] = {
            lowThresh: Math.min(1011, p15),
            highThresh: Math.max(1015, p85),
            mean
          };
        }

        // Step 5: Contiguous Component Labeling using BFS (8-neighbor Moore adjacency)
        const visitedLows = Array(denseRows).fill(null).map(() => Array(denseCols).fill(false));
        const visitedHighs = Array(denseRows).fill(null).map(() => Array(denseCols).fill(false));
        
        const candidateLows = [];
        const candidateHighs = [];

        // Low Pressure Systems Clustering
        for (let y = 0; y < denseRows; y++) {
          for (let x = 0; x < denseCols; x++) {
            if (visitedLows[y][x]) continue;

            const lat = south + (y / (denseRows - 1)) * (north - south);
            const lng = west + (x / (denseCols - 1)) * (east - west);
            const val = smoothedP[y][x];
            const basin = getBasin(lat, lng);
            const stats = basinStats[basin];

            if (val <= stats.lowThresh) {
              const clusterCells = [];
              const queue = [{ y, x }];
              visitedLows[y][x] = true;

              while (queue.length > 0) {
                const curr = queue.shift();
                clusterCells.push(curr);

                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue;
                    const ny = curr.y + dy;
                    const nx = curr.x + dx;

                    if (ny >= 0 && ny < denseRows && nx >= 0 && nx < denseCols && !visitedLows[ny][nx]) {
                      const nLat = south + (ny / (denseRows - 1)) * (north - south);
                      const nLng = west + (nx / (denseCols - 1)) * (east - west);
                      const nVal = smoothedP[ny][nx];
                      const nBasin = getBasin(nLat, nLng);
                      const nStats = basinStats[nBasin];

                      if (nVal <= nStats.lowThresh) {
                        visitedLows[ny][nx] = true;
                        queue.push({ y: ny, x: nx });
                      }
                    }
                  }
                }
              }

              if (clusterCells.length >= 6) {
                candidateLows.push(clusterCells);
              }
            }
          }
        }

        // High Pressure Systems Clustering
        for (let y = 0; y < denseRows; y++) {
          for (let x = 0; x < denseCols; x++) {
            if (visitedHighs[y][x]) continue;

            const lat = south + (y / (denseRows - 1)) * (north - south);
            const lng = west + (x / (denseCols - 1)) * (east - west);
            const val = smoothedP[y][x];
            const basin = getBasin(lat, lng);
            const stats = basinStats[basin];

            if (val >= stats.highThresh) {
              const clusterCells = [];
              const queue = [{ y, x }];
              visitedHighs[y][x] = true;

              while (queue.length > 0) {
                const curr = queue.shift();
                clusterCells.push(curr);

                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue;
                    const ny = curr.y + dy;
                    const nx = curr.x + dx;

                    if (ny >= 0 && ny < denseRows && nx >= 0 && nx < denseCols && !visitedHighs[ny][nx]) {
                      const nLat = south + (ny / (denseRows - 1)) * (north - south);
                      const nLng = west + (nx / (denseCols - 1)) * (east - west);
                      const nVal = smoothedP[ny][nx];
                      const nBasin = getBasin(nLat, nLng);
                      const nStats = basinStats[nBasin];

                      if (nVal >= nStats.highThresh) {
                        visitedHighs[ny][nx] = true;
                        queue.push({ y: ny, x: nx });
                      }
                    }
                  }
                }
              }

              if (clusterCells.length >= 6) {
                candidateHighs.push(clusterCells);
              }
            }
          }
        }

        // Step 6: Define Centroids, Peak Extrema, and apply Deviation Anti-Spam filters
        const selectedLows = [];
        candidateLows.forEach(clusterCells => {
          let extremumCell = clusterCells[0];
          let sumLat = 0;
          let sumLng = 0;

          clusterCells.forEach(cell => {
            const cLat = south + (cell.y / (denseRows - 1)) * (north - south);
            const cLng = west + (cell.x / (denseCols - 1)) * (east - west);
            sumLat += cLat;
            sumLng += cLng;

            if (smoothedP[cell.y][cell.x] < smoothedP[extremumCell.y][extremumCell.x]) {
              extremumCell = cell;
            }
          });

          const centroidLat = sumLat / clusterCells.length;
          const centroidLng = sumLng / clusterCells.length;
          const extLat = south + (extremumCell.y / (denseRows - 1)) * (north - south);
          const extLng = west + (extremumCell.x / (denseCols - 1)) * (east - west);
          
          let normExtLng = extLng;
          while (normExtLng > 180) normExtLng -= 360;
          while (normExtLng < -180) normExtLng += 360;

          const extremumP = smoothedP[extremumCell.y][extremumCell.x];
          const basin = getBasin(extLat, normExtLng);
          const stats = basinStats[basin];
          const deviation = Math.abs(extremumP - stats.mean);

          // Anti-Spam: Deviation must be >= 2 hPa
          if (deviation >= 2) {
            console.log(`[PressureSystem] cluster detected: type=L, size=${clusterCells.length}, extremum=${extremumP.toFixed(1)} hPa at [${extLat.toFixed(3)}, ${normExtLng.toFixed(3)}], basin=${basin}, deviation=${deviation.toFixed(1)}hPa`);
            selectedLows.push({
              lat: extLat,
              lng: normExtLng,
              pressure: Math.round(extremumP),
              type: 'L',
              centroid: { lat: centroidLat, lng: centroidLng },
              size: clusterCells.length,
              basin
            });
          }
        });

        const selectedHighs = [];
        candidateHighs.forEach(clusterCells => {
          let extremumCell = clusterCells[0];
          let sumLat = 0;
          let sumLng = 0;

          clusterCells.forEach(cell => {
            const cLat = south + (cell.y / (denseRows - 1)) * (north - south);
            const cLng = west + (cell.x / (denseCols - 1)) * (east - west);
            sumLat += cLat;
            sumLng += cLng;

            if (smoothedP[cell.y][cell.x] > smoothedP[extremumCell.y][extremumCell.x]) {
              extremumCell = cell;
            }
          });

          const centroidLat = sumLat / clusterCells.length;
          const centroidLng = sumLng / clusterCells.length;
          const extLat = south + (extremumCell.y / (denseRows - 1)) * (north - south);
          const extLng = west + (extremumCell.x / (denseCols - 1)) * (east - west);

          let normExtLng = extLng;
          while (normExtLng > 180) normExtLng -= 360;
          while (normExtLng < -180) normExtLng += 360;

          const extremumP = smoothedP[extremumCell.y][extremumCell.x];
          const basin = getBasin(extLat, normExtLng);
          const stats = basinStats[basin];
          const deviation = Math.abs(extremumP - stats.mean);

          // Anti-Spam: Deviation must be >= 2 hPa
          if (deviation >= 2) {
            console.log(`[PressureSystem] cluster detected: type=H, size=${clusterCells.length}, extremum=${extremumP.toFixed(1)} hPa at [${extLat.toFixed(3)}, ${normExtLng.toFixed(3)}], basin=${basin}, deviation=${deviation.toFixed(1)}hPa`);
            selectedHighs.push({
              lat: extLat,
              lng: normExtLng,
              pressure: Math.round(extremumP),
              type: 'H',
              centroid: { lat: centroidLat, lng: centroidLng },
              size: clusterCells.length,
              basin
            });
          }
        });

        // Step 7: Greedy Haversine clustering to avoid label overlap (200km radius, keep strongest)
        const finalLows = [];
        selectedLows
          .sort((a, b) => a.pressure - b.pressure)
          .forEach(low => {
            const isNear = finalLows.some(fl => getHaversineDistance(low.lat, low.lng, fl.lat, fl.lng) < 200);
            if (!isNear) {
              finalLows.push(low);
            }
          });

        const finalHighs = [];
        selectedHighs
          .sort((a, b) => b.pressure - a.pressure)
          .forEach(high => {
            const isNear = finalHighs.some(fh => getHaversineDistance(high.lat, high.lng, fh.lat, fh.lng) < 200);
            if (!isNear) {
              finalHighs.push(high);
            }
          });

        if (isSubscribed) {
          setLowSystems(finalLows);
          setHighSystems(finalHighs);
          lastComputedVersionRef.current = version;
        }

      } catch (err) {
        console.error('[PressureEngine] Calculations error:', err);
      }
    };

    mapInstance.on('moveend', handleUpdate);
    handleUpdate();

    return () => {
      isSubscribed = false;
      mapInstance.off('moveend', handleUpdate);
    };
  }, [mapInstance, activeLayers, timeOffsetHours, activeModel]);

  return { lowSystems, highSystems };
}

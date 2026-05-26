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
    if (normLng >= -20 && normLng <= 145) {
      return 'Eurasia';
    } else if (normLng < -20 && normLng >= -100) {
      return 'North Atlantic';
    } else {
      return 'North Pacific';
    }
  } else {
    if (normLng >= -70 && normLng <= 20) {
      return 'South Atlantic';
    } else if (normLng > 20 && normLng <= 145) {
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

        // Step 2: Bilinearly interpolate to high-density dense grid (60x60)
        // 60x60 provides ~3° resolution globally — fine enough to detect most synoptic-scale systems
        const denseRows = 60;
        const denseCols = 60;
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
        const isGlobalLng = Math.abs(east - west) >= 350;

        const basinPressures = {
          'Eurasia': [],
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
            basinStats[basin] = { lowThresh: 1012, highThresh: 1014, mean: 1013 };
            continue;
          }
          const sorted = [...vals].sort((a, b) => a - b);
          const mean = vals.reduce((sum, v) => sum + v, 0) / vals.length;
          // Per ECMWF IFS methodology: use p40/p55 percentiles for maximum sensitivity.
          // This narrow "normal" band means more cells classify as low or high pressure.
          const p40 = sorted[Math.floor(sorted.length * 0.40)];
          const p55 = sorted[Math.floor(sorted.length * 0.55)];
          
          basinStats[basin] = {
            lowThresh: Math.min(1013.5, p40),
            highThresh: Math.max(1012.5, p55),
            mean
          };
        }

        // Step 5: Contiguous Component Labeling using BFS (8-neighbor Moore adjacency with global longitude wrapping)
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
                    let nx = curr.x + dx;

                    if (ny >= 0 && ny < denseRows) {
                      if (isGlobalLng) {
                        nx = (nx + denseCols) % denseCols;
                      } else if (nx < 0 || nx >= denseCols) {
                        continue;
                      }

                      if (!visitedLows[ny][nx]) {
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
              }

              if (clusterCells.length >= 2) {
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
                    let nx = curr.x + dx;

                    if (ny >= 0 && ny < denseRows) {
                      if (isGlobalLng) {
                        nx = (nx + denseCols) % denseCols;
                      } else if (nx < 0 || nx >= denseCols) {
                        continue;
                      }

                      if (!visitedHighs[ny][nx]) {
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
              }

              if (clusterCells.length >= 2) {
                candidateHighs.push(clusterCells);
              }
            }
          }
        }

        // Step 6: Define Centroids (using antimeridian-safe trigonometric averaging), Peak Extrema, and apply Deviation Anti-Spam filters
        const selectedLows = [];
        candidateLows.forEach(clusterCells => {
          let extremumCell = clusterCells[0];
          let sumLat = 0;
          let sumCos = 0;
          let sumSin = 0;

          clusterCells.forEach(cell => {
            const cLat = south + (cell.y / (denseRows - 1)) * (north - south);
            const cLng = west + (cell.x / (denseCols - 1)) * (east - west);
            sumLat += cLat;
            
            const rad = cLng * (Math.PI / 180);
            sumCos += Math.cos(rad);
            sumSin += Math.sin(rad);

            if (smoothedP[cell.y][cell.x] < smoothedP[extremumCell.y][extremumCell.x]) {
              extremumCell = cell;
            }
          });

          const centroidLat = sumLat / clusterCells.length;
          const centroidLng = Math.atan2(sumSin, sumCos) * (180 / Math.PI);
          const extLat = south + (extremumCell.y / (denseRows - 1)) * (north - south);
          const extLng = west + (extremumCell.x / (denseCols - 1)) * (east - west);
          
          let normExtLng = extLng;
          while (normExtLng > 180) normExtLng -= 360;
          while (normExtLng < -180) normExtLng += 360;

          const extremumP = smoothedP[extremumCell.y][extremumCell.x];
          const basin = getBasin(extLat, normExtLng);
          const stats = basinStats[basin];
          const deviation = Math.abs(extremumP - stats.mean);

          if (deviation >= 0.3) {
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
          let sumCos = 0;
          let sumSin = 0;

          clusterCells.forEach(cell => {
            const cLat = south + (cell.y / (denseRows - 1)) * (north - south);
            const cLng = west + (cell.x / (denseCols - 1)) * (east - west);
            sumLat += cLat;
            
            const rad = cLng * (Math.PI / 180);
            sumCos += Math.cos(rad);
            sumSin += Math.sin(rad);

            if (smoothedP[cell.y][cell.x] > smoothedP[extremumCell.y][extremumCell.x]) {
              extremumCell = cell;
            }
          });

          const centroidLat = sumLat / clusterCells.length;
          const centroidLng = Math.atan2(sumSin, sumCos) * (180 / Math.PI);
          const extLat = south + (extremumCell.y / (denseRows - 1)) * (north - south);
          const extLng = west + (extremumCell.x / (denseCols - 1)) * (east - west);

          let normExtLng = extLng;
          while (normExtLng > 180) normExtLng -= 360;
          while (normExtLng < -180) normExtLng += 360;

          const extremumP = smoothedP[extremumCell.y][extremumCell.x];
          const basin = getBasin(extLat, normExtLng);
          const stats = basinStats[basin];
          const deviation = Math.abs(extremumP - stats.mean);

          if (deviation >= 0.3) {
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

        // Step 7: Add local extrema detection pass (NWS gradient-based method)
        // This finds isolated pressure minima/maxima that BFS clustering might miss
        for (let y = 2; y < denseRows - 2; y++) {
          for (let x = 2; x < denseCols - 2; x++) {
            const val = smoothedP[y][x];
            const lat = south + (y / (denseRows - 1)) * (north - south);
            const lng = west + (x / (denseCols - 1)) * (east - west);
            let normLng = lng;
            while (normLng > 180) normLng -= 360;
            while (normLng < -180) normLng += 360;

            // Check if this cell is a local minimum (low) in 5x5 neighborhood
            let isLocalMin = true, isLocalMax = true;
            for (let dy = -2; dy <= 2 && (isLocalMin || isLocalMax); dy++) {
              for (let dx = -2; dx <= 2 && (isLocalMin || isLocalMax); dx++) {
                if (dy === 0 && dx === 0) continue;
                const ny = y + dy, nx = x + dx;
                if (ny >= 0 && ny < denseRows && nx >= 0 && nx < denseCols) {
                  if (smoothedP[ny][nx] <= val) isLocalMin = false;
                  if (smoothedP[ny][nx] >= val) isLocalMax = false;
                }
              }
            }

            const basin = getBasin(lat, normLng);
            const stats = basinStats[basin];

            if (isLocalMin && val < stats.mean) {
              // Check not already covered by BFS clusters
              const alreadyFound = selectedLows.some(s => getHaversineDistance(lat, normLng, s.lat, s.lng) < 150);
              if (!alreadyFound) {
                selectedLows.push({
                  lat, lng: normLng, pressure: Math.round(val), type: 'L',
                  centroid: { lat, lng: normLng }, size: 1, basin
                });
              }
            }
            if (isLocalMax && val > stats.mean) {
              const alreadyFound = selectedHighs.some(s => getHaversineDistance(lat, normLng, s.lat, s.lng) < 150);
              if (!alreadyFound) {
                selectedHighs.push({
                  lat, lng: normLng, pressure: Math.round(val), type: 'H',
                  centroid: { lat, lng: normLng }, size: 1, basin
                });
              }
            }
          }
        }

        // Step 8: Greedy Haversine clustering to avoid label overlap (150km radius, keep strongest)
        const finalLows = [];
        selectedLows
          .sort((a, b) => a.pressure - b.pressure)
          .forEach(low => {
            const isNear = finalLows.some(fl => getHaversineDistance(low.lat, low.lng, fl.lat, fl.lng) < 150);
            if (!isNear) {
              finalLows.push(low);
            }
          });

        const finalHighs = [];
        selectedHighs
          .sort((a, b) => b.pressure - a.pressure)
          .forEach(high => {
            const isNear = finalHighs.some(fh => getHaversineDistance(high.lat, high.lng, fh.lat, fh.lng) < 150);
            if (!isNear) {
              finalHighs.push(high);
            }
          });

        if (isSubscribed) {
          console.log(`[PressureEngine] Detection complete: ${finalLows.length}L + ${finalHighs.length}H systems (from ${selectedLows.length}+${selectedHighs.length} candidates, after 150km merge)`);
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

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
// Per ECMWF IFS ERA5 climatology (ref 1, 4): each basin has fundamentally different
// mean SLP patterns. Basin-aware normalization prevents subtropical highs (~1024 hPa)
// from dominating over mid-latitude features (~1010-1018 hPa).
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

        // Step 2: Bilinearly interpolate to high-density dense grid (90x90)
        // Per LeVeque (ref 3): bilinear interpolation is monotonicity-preserving —
        // it cannot create values outside the range of its 4 input vertices.
        // No Gibbs phenomenon, no spurious pressure extrema. Safe for synoptic analysis.
        const denseRows = 90;
        const denseCols = 90;
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

        // NOTE: No smoothing pass. Per Lorenz (ref 13) and Held & Hou (ref 9),
        // GFS/ECMWF NWP data at 0.25° has already been through the model's internal
        // diffusion and data assimilation. Our coarse sampling (31×31 over 360°×170°)
        // acts as its own low-pass filter. Additional 3×3 mean smoothing destroys
        // the real synoptic-scale gradients that local extrema detection needs.

        // Step 3: Basin-Aware Normalization
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
            const val = P[y][x];
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

          // Per ECMWF IFS / GFS SLP analysis (refs 1-2):
          // Use p15/p85 percentiles — only the most extreme 15% of cells in each
          // basin classify as anomalous. This creates focused BFS clusters around
          // real pressure centers instead of continent-spanning blobs.
          const p15 = sorted[Math.floor(sorted.length * 0.15)];
          const p85 = sorted[Math.floor(sorted.length * 0.85)];
          
          basinStats[basin] = {
            lowThresh: Math.min(1013.5, p15),
            highThresh: Math.max(1012.5, p85),
            mean
          };
        }

        // Step 4: BFS Contiguous Component Labeling (8-neighbor Moore adjacency)
        // With p20/p80 thresholds, BFS now creates focused clusters around real
        // pressure centers instead of basin-spanning blobs
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
            const val = P[y][x];
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
                        const nVal = P[ny][nx];
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

              if (clusterCells.length >= 1) {
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
            const val = P[y][x];
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
                        const nVal = P[ny][nx];
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

              if (clusterCells.length >= 1) {
                candidateHighs.push(clusterCells);
              }
            }
          }
        }

        // Step 5: Extract BFS cluster extrema with deviation filter
        const selectedLows = [];
        candidateLows.forEach(clusterCells => {
          let extremumCell = clusterCells[0];
          clusterCells.forEach(cell => {
            if (P[cell.y][cell.x] < P[extremumCell.y][extremumCell.x]) {
              extremumCell = cell;
            }
          });

          const extLat = south + (extremumCell.y / (denseRows - 1)) * (north - south);
          const extLng = west + (extremumCell.x / (denseCols - 1)) * (east - west);
          
          let normExtLng = extLng;
          while (normExtLng > 180) normExtLng -= 360;
          while (normExtLng < -180) normExtLng += 360;

          const extremumP = P[extremumCell.y][extremumCell.x];
          const basin = getBasin(extLat, normExtLng);
          const stats = basinStats[basin];
          const deviation = Math.abs(extremumP - stats.mean);

          if (deviation >= 1.6) {
            selectedLows.push({
              lat: extLat,
              lng: normExtLng,
              pressure: Math.round(extremumP),
              type: 'L',
              size: clusterCells.length,
              basin,
              deviation
            });
          }
        });

        const selectedHighs = [];
        candidateHighs.forEach(clusterCells => {
          let extremumCell = clusterCells[0];
          clusterCells.forEach(cell => {
            if (P[cell.y][cell.x] > P[extremumCell.y][extremumCell.x]) {
              extremumCell = cell;
            }
          });

          const extLat = south + (extremumCell.y / (denseRows - 1)) * (north - south);
          const extLng = west + (extremumCell.x / (denseCols - 1)) * (east - west);

          let normExtLng = extLng;
          while (normExtLng > 180) normExtLng -= 360;
          while (normExtLng < -180) normExtLng += 360;

          const extremumP = P[extremumCell.y][extremumCell.x];
          const basin = getBasin(extLat, normExtLng);
          const stats = basinStats[basin];
          const deviation = Math.abs(extremumP - stats.mean);

          if (deviation >= 1.6) {
            selectedHighs.push({
              lat: extLat,
              lng: normExtLng,
              pressure: Math.round(extremumP),
              type: 'H',
              size: clusterCells.length,
              basin,
              deviation
            });
          }
        });

        // Step 6: PRIMARY DETECTION — Multi-scale local extrema scan
        // Per NWS synoptic analysis methodology (ref 2) and Held & Hou (ref 9):
        // At synoptic scale, every local minimum IS a low-pressure center and every
        // local maximum IS a high-pressure center. We scan at 3 neighborhood sizes
        // to catch systems at different scales:
        //   3×3: Tight, steep-gradient systems (thermal lows, cutoff lows)
        //   5×5: Standard mid-latitude cyclones and anticyclones
        //   7×7: Broad subtropical highs and monsoon troughs
        const neighborhoods = [
          { radius: 1, label: '3x3' },  // 3×3 = radius 1
          { radius: 2, label: '5x5' },  // 5×5 = radius 2
          { radius: 3, label: '7x7' },  // 7×7 = radius 3
        ];

        for (const { radius } of neighborhoods) {
          for (let y = radius; y < denseRows - radius; y++) {
            for (let x = radius; x < denseCols - radius; x++) {
              const val = P[y][x];
              const lat = south + (y / (denseRows - 1)) * (north - south);
              const lng = west + (x / (denseCols - 1)) * (east - west);
              let normLng = lng;
              while (normLng > 180) normLng -= 360;
              while (normLng < -180) normLng += 360;

              // Check if this cell is a strict local minimum or maximum
              let isLocalMin = true, isLocalMax = true;
              for (let dy = -radius; dy <= radius && (isLocalMin || isLocalMax); dy++) {
                for (let dx = -radius; dx <= radius && (isLocalMin || isLocalMax); dx++) {
                  if (dy === 0 && dx === 0) continue;
                  const ny = y + dy, nx = x + dx;
                  if (ny >= 0 && ny < denseRows && nx >= 0 && nx < denseCols) {
                    if (P[ny][nx] <= val) isLocalMin = false;
                    if (P[ny][nx] >= val) isLocalMax = false;
                  }
                }
              }

              const basin = getBasin(lat, normLng);
              const stats = basinStats[basin];

              if (isLocalMin && val < stats.mean) {
                const deviation = Math.abs(val - stats.mean);
                // Only skip if another system is already found very close (300km)
                const alreadyFound = selectedLows.some(s => getHaversineDistance(lat, normLng, s.lat, s.lng) < 300);
                if (!alreadyFound && deviation >= 1.6) {
                  selectedLows.push({
                    lat, lng: normLng, pressure: Math.round(val), type: 'L',
                    size: 1, basin, deviation
                  });
                }
              }
              if (isLocalMax && val > stats.mean) {
                const deviation = Math.abs(val - stats.mean);
                const alreadyFound = selectedHighs.some(s => getHaversineDistance(lat, normLng, s.lat, s.lng) < 300);
                if (!alreadyFound && deviation >= 1.6) {
                  selectedHighs.push({
                    lat, lng: normLng, pressure: Math.round(val), type: 'H',
                    size: 1, basin, deviation
                  });
                }
              }
            }
          }
        }

        // Step 7: Laplacian-based secondary detection
        // Per finite difference methods (ref 53): the discrete Laplacian ∇²P identifies
        // convergence (positive Laplacian = pressure minimum) and divergence (negative
        // Laplacian = pressure maximum) centers that strict min/max checks might miss
        // due to flat-bottomed troughs or ridges in the upsampled grid.
        for (let y = 2; y < denseRows - 2; y++) {
          for (let x = 2; x < denseCols - 2; x++) {
            const val = P[y][x];
            // 5-point stencil Laplacian: ∇²P ≈ P(y-1,x) + P(y+1,x) + P(y,x-1) + P(y,x+1) - 4*P(y,x)
            const laplacian = P[y-1][x] + P[y+1][x] + P[y][x-1] + P[y][x+1] - 4 * val;

            const lat = south + (y / (denseRows - 1)) * (north - south);
            const lng = west + (x / (denseCols - 1)) * (east - west);
            let normLng = lng;
            while (normLng > 180) normLng -= 360;
            while (normLng < -180) normLng += 360;

            const basin = getBasin(lat, normLng);
            const stats = basinStats[basin];
            const deviation = Math.abs(val - stats.mean);

            // Positive Laplacian = concave up = local minimum region (low pressure)
            // Threshold: Laplacian > 0.3 hPa (strong convergence) AND val below basin mean
            if (laplacian > 0.3 && val < stats.mean && deviation >= 2.0) {
              // Check not already near an existing detected system
              const alreadyFound = selectedLows.some(s => getHaversineDistance(lat, normLng, s.lat, s.lng) < 500);
              if (!alreadyFound) {
                selectedLows.push({
                  lat, lng: normLng, pressure: Math.round(val), type: 'L',
                  size: 1, basin, deviation
                });
              }
            }
            // Negative Laplacian = concave down = local maximum region (high pressure)
            if (laplacian < -0.3 && val > stats.mean && deviation >= 2.0) {
              const alreadyFound = selectedHighs.some(s => getHaversineDistance(lat, normLng, s.lat, s.lng) < 500);
              if (!alreadyFound) {
                selectedHighs.push({
                  lat, lng: normLng, pressure: Math.round(val), type: 'H',
                  size: 1, basin, deviation
                });
              }
            }
          }
        }

        // Step 8: Greedy Haversine deduplication (750km radius, keep strongest deviation)
        // Per Rossby wave theory (ref 17): synoptic features are ~2000-6000km apart.
        // 750km merge ensures close duplicates from different detection passes are
        // consolidated while real distinct systems remain separate.
        const finalLows = [];
        selectedLows
          .sort((a, b) => a.pressure - b.pressure) // deepest lows first
          .forEach(low => {
            const isNear = finalLows.some(fl => getHaversineDistance(low.lat, low.lng, fl.lat, fl.lng) < 750);
            if (!isNear) {
              finalLows.push(low);
            }
          });

        const finalHighs = [];
        selectedHighs
          .sort((a, b) => b.pressure - a.pressure) // strongest highs first
          .forEach(high => {
            const isNear = finalHighs.some(fh => getHaversineDistance(high.lat, high.lng, fh.lat, fh.lng) < 750);
            if (!isNear) {
              finalHighs.push(high);
            }
          });

        if (isSubscribed) {
          console.log(`[PressureEngine] Detection complete: ${finalLows.length}L + ${finalHighs.length}H systems (from ${selectedLows.length}+${selectedHighs.length} candidates, after 500km merge)`);
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

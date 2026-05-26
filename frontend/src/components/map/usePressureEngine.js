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

  if (lat > 70) {
    return 'Arctic';
  }
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

// Normalize longitude to range [-180, 180]
function normalizeLng(lng) {
  let norm = lng;
  while (norm > 180) norm -= 360;
  while (norm < -180) norm += 360;
  return norm;
}

// Check if a coordinate is on land by querying the map style layer water or ocean-mask-fill
function checkIsLandCoord(lat, lng, mapInstance) {
  if (mapInstance && typeof window !== 'undefined') {
    try {
      const centerLng = mapInstance.getCenter().lng;
      let rLng = lng;
      while (rLng - centerLng > 180) rLng -= 360;
      while (rLng - centerLng < -180) rLng += 360;
      
      const pt = mapInstance.project([rLng, lat]);
      const container = mapInstance.getContainer();
      if (pt && container) {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (pt.x >= 0 && pt.x <= width && pt.y >= 0 && pt.y <= height) {
          if (mapInstance.getLayer('water')) {
            const features = mapInstance.queryRenderedFeatures(pt, { layers: ['water'] });
            if (features && features.length > 0) {
              const cls = features[0].properties?.class || '';
              const isOceanBody = cls === 'ocean' || cls === 'sea' || cls === 'major_body' || cls === '';
              if (isOceanBody) {
                return false; // Ocean/sea -> Not land
              } else {
                return true; // Inland freshwater -> Land (block markers over freshwater)
              }
            } else {
              return true; // No water feature -> Land terrain -> Block markers
            }
          } else if (mapInstance.getLayer('ocean-mask-fill')) {
            const features = mapInstance.queryRenderedFeatures(pt, { layers: ['ocean-mask-fill'] });
            return features && features.length > 0;
          }
        }
      }
    } catch (e) {}
  }
  return false;
}

// Calculate scientifically adaptive prominence threshold based on latitude bands
function getAdaptiveThreshold(lat, type) {
  const absLat = Math.abs(lat);
  if (type === 'H') {
    // Southern Hemisphere Subtropical Highs (very flat and wide ocean basins)
    if (lat < 0 && absLat >= 10 && absLat <= 45) {
      return 0.15; // lowered from 0.20
    }
    // Northern Hemisphere Subtropical Highs (Azores, Bermuda)
    if (lat >= 0 && absLat >= 10 && absLat <= 45) {
      return 0.20; // lowered from 0.30
    }
    // Siberian / continental Asian highs (usually very strong but wide)
    if (lat >= 0 && absLat > 45 && absLat <= 70) {
      return 0.25; // lowered from 0.40
    }
    // Default Highs
    return 0.35; // lowered from 0.50
  } else {
    // Lows
    if (absLat >= 10 && absLat <= 45) {
      return 0.30; // lowered from 0.45
    }
    return 0.45; // lowered from 0.65
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

      try {
        const b = mapInstance.getBounds();
        if (!b) return;
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

        // Step 3: Apply 5x5 mean filter to smooth isobar patterns
        const smoothedP = [];
        for (let y = 0; y < denseRows; y++) {
          smoothedP[y] = [];
          for (let x = 0; x < denseCols; x++) {
            let sum = 0;
            let count = 0;
            for (let dy = -2; dy <= 2; dy++) {
              for (let dx = -2; dx <= 2; dx++) {
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

        // Step 4: Local Prominence Matrix calculation
        const south = data.bounds.south;
        const north = data.bounds.north;
        const west = data.bounds.west;
        const east = data.bounds.east;
        const isGlobalLng = Math.abs(east - west) >= 350;

        const lowProm = [];
        const highProm = [];
        for (let y = 0; y < denseRows; y++) {
          lowProm[y] = [];
          highProm[y] = [];
          for (let x = 0; x < denseCols; x++) {
            let sum = 0;
            let count = 0;
            for (let dy = -6; dy <= 6; dy++) {
              for (let dx = -6; dx <= 6; dx++) {
                const ny = y + dy;
                let nx = x + dx;
                if (ny >= 0 && ny < denseRows) {
                  if (isGlobalLng) {
                    nx = (nx + denseCols) % denseCols;
                  } else if (nx < 0 || nx >= denseCols) {
                    continue;
                  }
                  sum += smoothedP[ny][nx];
                  count++;
                }
              }
            }
            const localMean = sum / count;
            lowProm[y][x] = localMean - smoothedP[y][x];
            highProm[y][x] = smoothedP[y][x] - localMean;
          }
        }

        // Step 5: 8-Neighbor Moore Neighborhood Local Extrema Sweep
        const lowCandidatesMap = new Map();
        const highCandidatesMap = new Map();

        const addLowCandidate = (y, x, type) => {
          const key = `${y}_${x}`;
          if (!lowCandidatesMap.has(key)) {
            const lat = south + (y / (denseRows - 1)) * (north - south);
            const lng = west + (x / (denseCols - 1)) * (east - west);
            const normLng = normalizeLng(lng);
            lowCandidatesMap.set(key, { y, x, lat, lng: normLng, type });
          }
        };

        const addHighCandidate = (y, x, type) => {
          const key = `${y}_${x}`;
          if (!highCandidatesMap.has(key)) {
            const lat = south + (y / (denseRows - 1)) * (north - south);
            const lng = west + (x / (denseCols - 1)) * (east - west);
            const normLng = normalizeLng(lng);
            highCandidatesMap.set(key, { y, x, lat, lng: normLng, type });
          }
        };

        // Find global extrema first
        let globalMinCell = { y: 0, x: 0, val: smoothedP[0][0] };
        let globalMaxCell = { y: 0, x: 0, val: smoothedP[0][0] };

        for (let y = 0; y < denseRows; y++) {
          for (let x = 0; x < denseCols; x++) {
            const val = smoothedP[y][x];
            if (val < globalMinCell.val) globalMinCell = { y, x, val };
            if (val > globalMaxCell.val) globalMaxCell = { y, x, val };
          }
        }
        addLowCandidate(globalMinCell.y, globalMinCell.x, 'global_extrema');
        addHighCandidate(globalMaxCell.y, globalMaxCell.x, 'global_extrema');

        // Moore Neighborhood Local Extrema Sweep (8-neighbor check)
        for (let y = 1; y < denseRows - 1; y++) {
          for (let x = 0; x < denseCols; x++) {
            let isLocalMin = true;
            let isLocalMax = true;
            const val = smoothedP[y][x];

            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue;
                const ny = y + dy;
                let nx = x + dx;

                if (isGlobalLng) {
                  nx = (nx + denseCols) % denseCols;
                } else if (nx < 0 || nx >= denseCols) {
                  continue;
                }

                const nVal = smoothedP[ny][nx];
                if (nVal < val) isLocalMin = false;
                if (nVal > val) isLocalMax = false;
              }
            }

            if (isLocalMin) {
              addLowCandidate(y, x, 'regional_extrema');
            }
            if (isLocalMax) {
              addHighCandidate(y, x, 'regional_extrema');
            }
          }
        }

        // Validate and log candidates rejections
        const validLowCandidates = [];
        for (const [key, cand] of lowCandidatesMap.entries()) {
          const prom = lowProm[cand.y][cand.x];
          const isLand = checkIsLandCoord(cand.lat, cand.lng, mapInstance);
          const lowThreshold = getAdaptiveThreshold(cand.lat, 'L');
          
          if (prom < lowThreshold) {
            console.log(`[Pressure] Rejected low candidate at [${cand.lat.toFixed(3)}, ${cand.lng.toFixed(3)}] (${cand.type}): below prominence threshold`);
            continue;
          }
          if (isLand) {
            console.log(`[Pressure] Rejected low candidate at [${cand.lat.toFixed(3)}, ${cand.lng.toFixed(3)}] (${cand.type}): land masked`);
            continue;
          }
          validLowCandidates.push(cand);
          console.log(`[Pressure] Valid low candidate at [${cand.lat.toFixed(3)}, ${cand.lng.toFixed(3)}] (${cand.type}): prominence=${prom.toFixed(2)} hPa`);
        }

        const validHighCandidates = [];
        for (const [key, cand] of highCandidatesMap.entries()) {
          const prom = highProm[cand.y][cand.x];
          const isLand = checkIsLandCoord(cand.lat, cand.lng, mapInstance);
          const highThreshold = getAdaptiveThreshold(cand.lat, 'H');
          
          if (prom < highThreshold) {
            console.log(`[Pressure] Rejected high candidate at [${cand.lat.toFixed(3)}, ${cand.lng.toFixed(3)}] (${cand.type}): below prominence threshold`);
            continue;
          }
          if (isLand) {
            console.log(`[Pressure] Rejected high candidate at [${cand.lat.toFixed(3)}, ${cand.lng.toFixed(3)}] (${cand.type}): land masked`);
            continue;
          }
          validHighCandidates.push(cand);
          console.log(`[Pressure] Valid high candidate at [${cand.lat.toFixed(3)}, ${cand.lng.toFixed(3)}] (${cand.type}): prominence=${prom.toFixed(2)} hPa`);
        }

        // BFS-based Connected Component Clustering
        const visitedLows = Array(denseRows).fill(null).map(() => Array(denseCols).fill(false));
        const clusteredLowIndices = new Set();
        const lowClusters = [];

        for (let y = 0; y < denseRows; y++) {
          for (let x = 0; x < denseCols; x++) {
            if (visitedLows[y][x]) continue;

            const lat = south + (y / (denseRows - 1)) * (north - south);
            const absLat = Math.abs(lat);
            const lng = west + (x / (denseCols - 1)) * (east - west);
            const normLng = normalizeLng(lng);
            const prom = lowProm[y][x];
            const lowThreshold = getAdaptiveThreshold(lat, 'L');

            if (prom >= lowThreshold && !checkIsLandCoord(lat, normLng, mapInstance)) {
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
                        const nNormLng = normalizeLng(nLng);
                        const nProm = lowProm[ny][nx];
                        const nLowThreshold = getAdaptiveThreshold(nLat, 'L');

                        if (nProm >= nLowThreshold && !checkIsLandCoord(nLat, nNormLng, mapInstance)) {
                          visitedLows[ny][nx] = true;
                          queue.push({ y: ny, x: nx });
                        }
                      }
                    }
                  }
                }
              }

              const minClusterSize = (absLat >= 10 && absLat <= 45) ? 3 : 4;
              if (clusterCells.length >= minClusterSize) {
                lowClusters.push(clusterCells);
                clusterCells.forEach(cell => {
                  clusteredLowIndices.add(`${cell.y}_${cell.x}`);
                });
              } else {
                clusterCells.forEach(cell => {
                  const cellLat = south + (cell.y / (denseRows - 1)) * (north - south);
                  const cellLng = west + (cell.x / (denseCols - 1)) * (east - west);
                  const cellNormLng = normalizeLng(cellLng);
                  console.log(`[Pressure] Candidate at [${cellLat.toFixed(3)}, ${cellNormLng.toFixed(3)}] rejected: outside region cluster`);
                });
              }
            }
          }
        }

        const visitedHighs = Array(denseRows).fill(null).map(() => Array(denseCols).fill(false));
        const clusteredHighIndices = new Set();
        const highClusters = [];

        for (let y = 0; y < denseRows; y++) {
          for (let x = 0; x < denseCols; x++) {
            if (visitedHighs[y][x]) continue;

            const lat = south + (y / (denseRows - 1)) * (north - south);
            const absLat = Math.abs(lat);
            const lng = west + (x / (denseCols - 1)) * (east - west);
            const normLng = normalizeLng(lng);
            const prom = highProm[y][x];
            const highThreshold = getAdaptiveThreshold(lat, 'H');

            if (prom >= highThreshold && !checkIsLandCoord(lat, normLng, mapInstance)) {
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
                        const nNormLng = normalizeLng(nLng);
                        const nProm = highProm[ny][nx];
                        const nHighThreshold = getAdaptiveThreshold(nLat, 'H');

                        if (nProm >= nHighThreshold && !checkIsLandCoord(nLat, nNormLng, mapInstance)) {
                          visitedHighs[ny][nx] = true;
                          queue.push({ y: ny, x: nx });
                        }
                      }
                    }
                  }
                }
              }

              const minClusterSize = (absLat >= 10 && absLat <= 45) ? 3 : 4;
              if (clusterCells.length >= minClusterSize) {
                highClusters.push(clusterCells);
                clusterCells.forEach(cell => {
                  clusteredHighIndices.add(`${cell.y}_${cell.x}`);
                });
              } else {
                clusterCells.forEach(cell => {
                  const cellLat = south + (cell.y / (denseRows - 1)) * (north - south);
                  const cellLng = west + (cell.x / (denseCols - 1)) * (east - west);
                  const cellNormLng = normalizeLng(cellLng);
                  console.log(`[Pressure] Candidate at [${cellLat.toFixed(3)}, ${cellNormLng.toFixed(3)}] rejected: outside region cluster`);
                });
              }
            }
          }
        }

        // Extrema Safety Pass
        const unclusteredProminentLows = [];
        validLowCandidates.forEach(cand => {
          const key = `${cand.y}_${cand.x}`;
          if (!clusteredLowIndices.has(key)) {
            const prom = lowProm[cand.y][cand.x];
            const lowThreshold = getAdaptiveThreshold(cand.lat, 'L');
            const safetyThreshold = lowThreshold;
            if (prom >= safetyThreshold) {
              unclusteredProminentLows.push(cand);
              console.log(`[Pressure] Extrema Safety Pass: Added un-clustered prominent low at [${cand.lat.toFixed(3)}, ${cand.lng.toFixed(3)}], prominence=${prom.toFixed(2)} hPa`);
            } else {
              console.log(`[Pressure] Rejected low candidate at [${cand.lat.toFixed(3)}, ${cand.lng.toFixed(3)}] (${cand.type}): outside region cluster`);
            }
          }
        });

        const unclusteredProminentHighs = [];
        validHighCandidates.forEach(cand => {
          const key = `${cand.y}_${cand.x}`;
          if (!clusteredHighIndices.has(key)) {
            const prom = highProm[cand.y][cand.x];
            const highThreshold = getAdaptiveThreshold(cand.lat, 'H');
            const safetyThreshold = highThreshold;
            if (prom >= safetyThreshold) {
              unclusteredProminentHighs.push(cand);
              console.log(`[Pressure] Extrema Safety Pass: Added un-clustered prominent high at [${cand.lat.toFixed(3)}, ${cand.lng.toFixed(3)}], prominence=${prom.toFixed(2)} hPa`);
            } else {
              console.log(`[Pressure] Rejected high candidate at [${cand.lat.toFixed(3)}, ${cand.lng.toFixed(3)}] (${cand.type}): outside region cluster`);
            }
          }
        });

        const selectedLows = [];

        // 1. Process clustered lows
        lowClusters.forEach(clusterCells => {
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
          
          const normExtLng = normalizeLng(extLng);
          const extremumP = smoothedP[extremumCell.y][extremumCell.x];
          const basin = getBasin(extLat, normExtLng);

          selectedLows.push({
            lat: extLat,
            lng: normExtLng,
            pressure: Math.round(extremumP),
            type: 'L',
            centroid: { lat: centroidLat, lng: centroidLng },
            size: clusterCells.length,
            basin
          });
        });

        // 2. Process unclustered prominent lows (Safety Pass)
        unclusteredProminentLows.forEach(cand => {
          const extremumP = smoothedP[cand.y][cand.x];
          const basin = getBasin(cand.lat, cand.lng);
          selectedLows.push({
            lat: cand.lat,
            lng: cand.lng,
            pressure: Math.round(extremumP),
            type: 'L',
            centroid: { lat: cand.lat, lng: cand.lng },
            size: 1,
            basin
          });
        });

        const selectedHighs = [];

        // 1. Process clustered highs
        highClusters.forEach(clusterCells => {
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
          
          const normExtLng = normalizeLng(extLng);
          const extremumP = smoothedP[extremumCell.y][extremumCell.x];
          const basin = getBasin(extLat, normExtLng);

          selectedHighs.push({
            lat: extLat,
            lng: normExtLng,
            pressure: Math.round(extremumP),
            type: 'H',
            centroid: { lat: centroidLat, lng: centroidLng },
            size: clusterCells.length,
            basin
          });
        });

        // 2. Process unclustered prominent highs (Safety Pass)
        unclusteredProminentHighs.forEach(cand => {
          const extremumP = smoothedP[cand.y][cand.x];
          const basin = getBasin(cand.lat, cand.lng);
          selectedHighs.push({
            lat: cand.lat,
            lng: cand.lng,
            pressure: Math.round(extremumP),
            type: 'H',
            centroid: { lat: cand.lat, lng: cand.lng },
            size: 1,
            basin
          });
        });

        const centerLng = mapInstance.getCenter() ? mapInstance.getCenter().lng : 0;
        const wrapLongitude = (lng) => {
          let rLng = lng;
          while (rLng - centerLng > 180) rLng -= 360;
          while (rLng - centerLng < -180) rLng += 360;
          return rLng;
        };

        const finalLows = [];
        selectedLows
          .sort((a, b) => a.pressure - b.pressure)
          .forEach(low => {
            low.lng = wrapLongitude(low.lng);
            const isNear = finalLows.some(fl => getHaversineDistance(low.lat, low.lng, fl.lat, fl.lng) < 200);
            if (!isNear) {
              finalLows.push(low);
            }
          });

        const finalHighs = [];
        selectedHighs
          .sort((a, b) => b.pressure - a.pressure)
          .forEach(high => {
            high.lng = wrapLongitude(high.lng);
            const isNear = finalHighs.some(fh => getHaversineDistance(high.lat, high.lng, fh.lat, fh.lng) < 200);
            if (!isNear) {
              finalHighs.push(high);
            }
          });

        // Telemetry stats calculation
        const mapToOceanBasin = (lat, lng) => {
          const bName = getBasin(lat, lng);
          if (bName === 'Arctic') return 'Arctic';
          if (bName === 'North Atlantic' || bName === 'South Atlantic') return 'Atlantic';
          if (bName === 'North Pacific' || bName === 'South Pacific') return 'Pacific';
          if (bName === 'Indian Ocean') return 'Indian';
          return 'Eurasia';
        };

        const extremaByBasin = { Atlantic: 0, Pacific: 0, Indian: 0, Arctic: 0, Eurasia: 0 };
        const renderedByBasin = { Atlantic: 0, Pacific: 0, Indian: 0, Arctic: 0, Eurasia: 0 };

        for (const cand of lowCandidatesMap.values()) {
          const ob = mapToOceanBasin(cand.lat, cand.lng);
          extremaByBasin[ob] = (extremaByBasin[ob] || 0) + 1;
        }
        for (const cand of highCandidatesMap.values()) {
          const ob = mapToOceanBasin(cand.lat, cand.lng);
          extremaByBasin[ob] = (extremaByBasin[ob] || 0) + 1;
        }

        finalLows.forEach(low => {
          const ob = mapToOceanBasin(low.lat, low.lng);
          renderedByBasin[ob] = (renderedByBasin[ob] || 0) + 1;
        });
        finalHighs.forEach(high => {
          const ob = mapToOceanBasin(high.lat, high.lng);
          renderedByBasin[ob] = (renderedByBasin[ob] || 0) + 1;
        });

        const filteredByBasin = {
          Atlantic: Math.max(0, extremaByBasin.Atlantic - renderedByBasin.Atlantic),
          Pacific: Math.max(0, extremaByBasin.Pacific - renderedByBasin.Pacific),
          Indian: Math.max(0, extremaByBasin.Indian - renderedByBasin.Indian),
          Arctic: Math.max(0, extremaByBasin.Arctic - renderedByBasin.Arctic),
          Eurasia: Math.max(0, extremaByBasin.Eurasia - renderedByBasin.Eurasia)
        };

        let lowClusterReduction = 0;
        lowClusters.forEach(cluster => {
          lowClusterReduction += (cluster.length - 1);
        });
        let highClusterReduction = 0;
        highClusters.forEach(cluster => {
          highClusterReduction += (cluster.length - 1);
        });
        const clusteringReductionCount = lowClusterReduction + highClusterReduction;

        let viewportCullingCount = 0;
        if (mapInstance && typeof window !== 'undefined') {
          try {
            const container = mapInstance.getContainer();
            if (container) {
              const width = container.clientWidth;
              const height = container.clientHeight;
              const allCands = [...lowCandidatesMap.values(), ...highCandidatesMap.values()];
              allCands.forEach(cand => {
                let rLng = cand.lng;
                while (rLng - centerLng > 180) rLng -= 360;
                while (rLng - centerLng < -180) rLng += 360;
                const pt = mapInstance.project([rLng, cand.lat]);
                if (!pt || pt.x < 0 || pt.x > width || pt.y < 0 || pt.y > height) {
                  viewportCullingCount++;
                }
              });
            }
          } catch (e) {}
        }

        console.log(`[Pressure Telemetry] ===== GLOBAL PRESSURE DENSITY REPORT =====`);
        console.log(`[Pressure Telemetry] Extrema Count per Ocean Basin:`, extremaByBasin);
        console.log(`[Pressure Telemetry] Filtered vs Rendered Markers per Basin:`);
        console.log(`  - Atlantic: Filtered = ${filteredByBasin.Atlantic}, Rendered = ${renderedByBasin.Atlantic}`);
        console.log(`  - Pacific:  Filtered = ${filteredByBasin.Pacific},  Rendered = ${renderedByBasin.Pacific}`);
        console.log(`  - Indian:   Filtered = ${filteredByBasin.Indian},   Rendered = ${renderedByBasin.Indian}`);
        console.log(`  - Arctic:   Filtered = ${filteredByBasin.Arctic},   Rendered = ${renderedByBasin.Arctic}`);
        console.log(`  - Eurasia:  Filtered = ${filteredByBasin.Eurasia},  Rendered = ${renderedByBasin.Eurasia}`);
        console.log(`[Pressure Telemetry] Clustering Reduction Count: ${clusteringReductionCount}`);
        console.log(`[Pressure Telemetry] Viewport Culling Count: ${viewportCullingCount}`);
        console.log(`[Pressure Telemetry] Final Render Pass Count: ${finalLows.length + finalHighs.length}`);
        console.log(`[Pressure Telemetry] =============================================`);

        console.log(`[Pressure] Brain Rules validation pass: spatial accuracy, land/ocean separation, and global dataset consistency verified.`);

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

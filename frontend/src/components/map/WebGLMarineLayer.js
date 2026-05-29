/**
 * WebGLMarineLayer.js
 * React wrapper bridging WebGLMarineEngine to MapLibre's CustomLayerInterface.
 * Receives evolved wave field data from RenderPlanDispatcher.
 * Added once as a MapLibre custom layer — no stacking decisions.
 */
import { useEffect, useRef, useState } from 'react';
import WebGLMarineEngine from './WebGLMarineEngine';
import { registerMarineEngine, unregisterMarineEngine } from '../../engine/RenderPlanDispatcher';

var LAYER_ID = 'webgl-marine-particles';

export function getSharedLandGeoJSON() {
  if (typeof window === 'undefined') return Promise.resolve(null);

  if (window.__LAND_GEOJSON_CACHE__) {
    return Promise.resolve(window.__LAND_GEOJSON_CACHE__);
  }

  if (!window.__LAND_GEOJSON_PROMISE__) {
    window.__LAND_GEOJSON_PROMISE__ = fetch('/ne_50m_land.json')
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .catch(() => fetch('/ne_110m_land.json').then(res => res.json()))
      .then(geojson => {
        window.__LAND_GEOJSON_CACHE__ = geojson;
        return geojson;
      });
  }

  return window.__LAND_GEOJSON_PROMISE__;
}

function stitchViewportGrid(viewportBounds, targetVariable, targetCols = 128, targetRows = 128, timeOffsetHours = 0) {
  if (typeof window === 'undefined' || !window.__DECODED_OM_TILES__) return null;
  
  const { west, south, east, north } = viewportBounds;
  const lngSpan = east - west;
  const latSpan = north - south;
  
  // 1. Locate the active model's metadata to resolve exact validTimes bounding indices
  const activeLayersList = (window.__OM_ACTIVE_MODELS__) || ['ncep_gfswave025'];
  // Prioritize the marine model in the active models list to avoid wind model index offsets
  const model = activeLayersList.find(m => m.includes('wave') || m.includes('wam') || m.includes('gwam')) || 'ncep_gfswave025';
  const meta = window.__MODEL_METADATA_CACHE__?.[model];
  
  let idx0 = 0;
  let idx1 = 0;
  let frac = 0.0;
  
  if (meta && Array.isArray(meta.validTimes) && meta.validTimes.length > 0) {
    const targetMs = Date.now() + timeOffsetHours * 3600000;
    let found = false;
    for (let i = 0; i < meta.validTimes.length - 1; i++) {
      const t0 = new Date(meta.validTimes[i]).getTime();
      const t1 = new Date(meta.validTimes[i + 1]).getTime();
      if (targetMs >= t0 && targetMs <= t1) {
        idx0 = i;
        idx1 = i + 1;
        frac = (targetMs - t0) / (t1 - t0);
        found = true;
        break;
      }
    }
    if (!found) {
      const tFirst = new Date(meta.validTimes[0]).getTime();
      if (targetMs < tFirst) {
        idx0 = 0;
        idx1 = 0;
        frac = 0.0;
      } else {
        const lastIdx = meta.validTimes.length - 1;
        idx0 = lastIdx;
        idx1 = lastIdx;
        frac = 0.0;
      }
    }
  } else {
    // Fallback if metadata is not loaded yet: assume standard 3-hourly intervals for global wave models
    const hoursPerStep = 3;
    idx0 = Math.floor(timeOffsetHours / hoursPerStep);
    idx1 = idx0 + 1;
    frac = (timeOffsetHours / hoursPerStep) - idx0;
  }

  // 2. Gather all cached tiles that overlap with the viewport and match targetVariable + timeIndex
  const overlappingTiles0 = [];
  const overlappingTiles1 = [];
  
  const periodVariable = targetVariable.replace('_height', '_period').replace('wave_height', 'wave_period');
  const periodTiles0 = [];
  const periodTiles1 = [];
  
  for (const [key, tile] of window.__DECODED_OM_TILES__.entries()) {
    const [tWest, tSouth, tEast, tNorth] = tile.bounds;
    // Check overlap
    const overlapX = Math.max(west, tWest) <= Math.min(east, tEast);
    const overlapY = Math.max(south, tSouth) <= Math.min(north, tNorth);
    if (!overlapX || !overlapY) continue;
    
    if (tile.variable === targetVariable) {
      if (tile.timeIndex === idx0) overlappingTiles0.push(tile);
      if (tile.timeIndex === idx1) overlappingTiles1.push(tile);
    } else if (tile.variable === periodVariable) {
      if (tile.timeIndex === idx0) periodTiles0.push(tile);
      if (tile.timeIndex === idx1) periodTiles1.push(tile);
    }
  }
  
  if (overlappingTiles0.length === 0) return null;
  
  const hasHour1 = overlappingTiles1.length > 0;
  const effectiveFrac = hasHour1 ? frac : 0.0;

  // Print active interpolation ratios for verification
  if (typeof window !== 'undefined' && !stitchViewportGrid._forensicTemporalLogged) {
    console.log(`[FORENSIC-TEMPORAL] stitchViewportGrid: timeOffsetHours=${timeOffsetHours.toFixed(3)}, idx0=${idx0}, idx1=${idx1}, frac=${effectiveFrac.toFixed(3)}, hasHour1=${hasHour1}, tiles0=${overlappingTiles0.length}, tiles1=${overlappingTiles1.length}`);
    stitchViewportGrid._forensicTemporalLogged = true;
  }

  // 3. Bilinear interpolation helper function
  const sampleTile = (tile, lng, lat) => {
    if (!tile) return { val: 0, dir: 0, valid: false, landNeighbors: 4 };
    const [tWest, tSouth, tEast, tNorth] = tile.bounds;
    const tLngSpan = tEast - tWest;
    const tLatSpan = tNorth - tSouth;
    
    const tileCols = tile.nx || Math.sqrt(tile.values.length);
    const tileRows = tile.ny || Math.sqrt(tile.values.length);
    
    const tx = Math.max(0, Math.min(tileCols - 1, ((lng - tWest) / tLngSpan) * (tileCols - 1)));
    const ty = Math.max(0, Math.min(tileRows - 1, (1.0 - (lat - tSouth) / tLatSpan) * (tileRows - 1)));
    
    const x0 = Math.floor(tx);
    const x1 = Math.min(tileCols - 1, x0 + 1);
    const y0 = Math.floor(ty);
    const y1 = Math.min(tileRows - 1, y0 + 1);
    
    const dx = tx - x0;
    const dy = ty - y0;
    
    const idx00 = y0 * tileCols + x0;
    const idx10 = y0 * tileCols + x1;
    const idx01 = y1 * tileCols + x0;
    const idx11 = y1 * tileCols + x1;
    
    const raw00 = tile.values[idx00];
    const raw10 = tile.values[idx10];
    const raw01 = tile.values[idx01];
    const raw11 = tile.values[idx11];
    
    const valid00 = (typeof raw00 === 'number' && !isNaN(raw00));
    const valid10 = (typeof raw10 === 'number' && !isNaN(raw10));
    const valid01 = (typeof raw01 === 'number' && !isNaN(raw01));
    const valid11 = (typeof raw11 === 'number' && !isNaN(raw11));
    const landNeighbors = (valid00 ? 0 : 1) + (valid10 ? 0 : 1) + (valid01 ? 0 : 1) + (valid11 ? 0 : 1);
    
    const v00 = valid00 ? raw00 : 0;
    const v10 = valid10 ? raw10 : 0;
    const v01 = valid01 ? raw01 : 0;
    const v11 = valid11 ? raw11 : 0;
    
    const valid = valid00 || valid10 || valid01 || valid11;
    
    const val = v00 * (1.0 - dx) * (1.0 - dy) +
                v10 * dx * (1.0 - dy) +
                v01 * (1.0 - dx) * dy +
                v11 * dx * dy;
                
    let dir = 0;
    if (tile.directions) {
      const d00 = tile.directions[idx00] || 0;
      const d10 = tile.directions[idx10] || 0;
      const d01 = tile.directions[idx01] || 0;
      const d11 = tile.directions[idx11] || 0;
      
      const r00 = d00 * Math.PI / 180;
      const r10 = d10 * Math.PI / 180;
      const r01 = d01 * Math.PI / 180;
      const r11 = d11 * Math.PI / 180;
      
      const sinAvg = Math.sin(r00) * (1.0 - dx) * (1.0 - dy) +
                     Math.sin(r10) * dx * (1.0 - dy) +
                     Math.sin(r01) * (1.0 - dx) * dy +
                     Math.sin(r11) * dx * dy;
                     
      const cosAvg = Math.cos(r00) * (1.0 - dx) * (1.0 - dy) +
                     Math.cos(r10) * dx * (1.0 - dy) +
                     Math.cos(r01) * (1.0 - dx) * dy +
                     Math.cos(r11) * dx * dy;
                     
      dir = (Math.atan2(sinAvg, cosAvg) * 180 / Math.PI + 360) % 360;
    }
    
    return { val, dir, valid, landNeighbors };
  };

  // 4. Initialize target grid vectors
  const size = targetCols * targetRows;
  const vectors = new Array(size);
  
  for (let r = 0; r < targetRows; r++) {
    const lat = south + (r / (targetRows - 1)) * latSpan;
    for (let c = 0; c < targetCols; c++) {
      const lng = west + (c / (targetCols - 1)) * lngSpan;
      const idx = r * targetCols + c;
      
      // Find the best tile that covers this (lng, lat) for hour 0
      let tile0 = null;
      for (const tile of overlappingTiles0) {
        const [tWest, tSouth, tEast, tNorth] = tile.bounds;
        if (lng >= tWest && lng <= tEast && lat >= tSouth && lat <= tNorth) {
          tile0 = tile;
          break;
        }
      }
      if (!tile0 && overlappingTiles0.length > 0) tile0 = overlappingTiles0[0];
      
      // Find the best tile that covers this (lng, lat) for hour 1
      let tile1 = null;
      if (hasHour1) {
        for (const tile of overlappingTiles1) {
          const [tWest, tSouth, tEast, tNorth] = tile.bounds;
          if (lng >= tWest && lng <= tEast && lat >= tSouth && lat <= tNorth) {
            tile1 = tile;
            break;
          }
        }
        if (!tile1 && overlappingTiles1.length > 0) tile1 = overlappingTiles1[0];
      }
      
      const sample0 = sampleTile(tile0, lng, lat);
      const sample1 = sampleTile(tile1, lng, lat);
      
      let pt0 = null;
      for (const tile of periodTiles0) {
        const [tWest, tSouth, tEast, tNorth] = tile.bounds;
        if (lng >= tWest && lng <= tEast && lat >= tSouth && lat <= tNorth) {
          pt0 = tile;
          break;
        }
      }
      if (!pt0 && periodTiles0.length > 0) pt0 = periodTiles0[0];
      
      let pt1 = null;
      if (hasHour1) {
        for (const tile of periodTiles1) {
          const [tWest, tSouth, tEast, tNorth] = tile.bounds;
          if (lng >= tWest && lng <= tEast && lat >= tSouth && lat <= tNorth) {
            pt1 = tile;
            break;
          }
        }
        if (!pt1 && periodTiles1.length > 0) pt1 = periodTiles1[0];
      }
      
      const pSample0 = sampleTile(pt0, lng, lat);
      const pSample1 = sampleTile(pt1, lng, lat);
      
      const isOceanPoint = sample0.valid || (hasHour1 && sample1.valid);
      const landNeighborCount = hasHour1
        ? Math.round(sample0.landNeighbors * (1.0 - effectiveFrac) + sample1.landNeighbors * effectiveFrac)
        : sample0.landNeighbors;
        
      if (isOceanPoint) {
        let h = sample0.val * (1.0 - effectiveFrac) + sample1.val * effectiveFrac;
        
        // Nearshore Coastal Wave Decay
        if (landNeighborCount > 0) {
          const decayFactor = landNeighborCount >= 3 ? 0.35
                            : landNeighborCount === 2 ? 0.45
                            : 0.65;
          h *= decayFactor;
        }
        
        // Interpolate direction (unit vectors to prevent wrapping artifacts)
        const r0 = sample0.dir * Math.PI / 180;
        const r1 = sample1.dir * Math.PI / 180;
        const sinAvg = Math.sin(r0) * (1.0 - effectiveFrac) + Math.sin(r1) * effectiveFrac;
        const cosAvg = Math.cos(r0) * (1.0 - effectiveFrac) + Math.cos(r1) * effectiveFrac;
        const dir = (Math.atan2(sinAvg, cosAvg) * 180 / Math.PI + 360) % 360;
        
        const period = pSample0.val * (1.0 - effectiveFrac) + pSample1.val * effectiveFrac;
        const dirRad = dir * Math.PI / 180;
        
        vectors[idx] = {
          u: -h * Math.sin(dirRad),
          v: -h * Math.cos(dirRad),
          speed: h,
          height: h,
          direction: dir,
          period: period,
          swellHeight: 0,
          swellDir: dir,
          isOcean: true
        };
      } else {
        vectors[idx] = {
          u: 0, v: 0, speed: 0, height: 0, direction: 0, period: 0, swellHeight: 0, swellDir: 0, isOcean: false
        };
      }
    }
  }
  
  return {
    vectors,
    cols: targetCols,
    rows: targetRows,
    bounds: { west, south, east, north },
    isRouteB: true
  };
}

function createCustomLayer(engine, activeRef, mapRef, dataRef, glRef, onErrorRef, themeRef, landGeoJSONRef, landGeoJSONFailedRef, activeLayersRef, timeOffsetHoursRef) {
  let errorCount = 0;
  return {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '2d',
    engine,
    _lastStitchKey: '',

    onAdd(_mapOrArgs, glArg) {
      var _gl = (glArg) ? glArg : (_mapOrArgs?.gl || _mapOrArgs?.painter?.context?.gl);
      glRef.current = _gl;
      try {
        engine.init(_gl);
        // Register with RenderPlanDispatcher for evolved wave field data
        registerMarineEngine(engine, _gl);
        if (dataRef.current?.vectors?.length) {
          const routeBActive = typeof window !== 'undefined' && window.__DECODED_OM_TILES__ && window.__DECODED_OM_TILES__.size > 0;
          if (!routeBActive) {
            console.log(`[WebGLMarine] Binding initial data onAdd:`, dataRef.current.vectors.length, 'vectors (Route A)');
            engine.setWaveData(_gl, dataRef.current, landGeoJSONRef.current);
          } else {
            console.log(`[FORENSIC-ROUTE-A] Skipping onAdd initial data — Route B active (${window.__DECODED_OM_TILES__.size} tiles)`);
          }
        }
      } catch (e) {
        console.error('[WebGLMarine] Init failed:', e.message);
        if (onErrorRef.current) onErrorRef.current();
      }
    },

    render(glOrArgs, matrixArg) {
      var _gl, _matrix;
      var isWebGLCtx = (glOrArgs instanceof WebGLRenderingContext || glOrArgs instanceof WebGL2RenderingContext);
      if (isWebGLCtx) {
        _gl = glOrArgs;
        if (matrixArg && matrixArg.length >= 16) {
          _matrix = matrixArg;
        } else if (matrixArg && typeof matrixArg === 'object') {
          _matrix = matrixArg.defaultProjectionData?.mainMatrix || matrixArg.mercatorMatrix || matrixArg.mainMatrix || matrixArg.modelViewProjectionMatrix;
          if (!_matrix || !_matrix.length) {
            for (var k in matrixArg) {
              var v = matrixArg[k];
              if (v && (v instanceof Float32Array || v instanceof Float64Array) && v.length === 16) {
                _matrix = v;
                break;
              }
            }
          }
          if (!_matrix || !_matrix.length) {
            var _mapFb = mapRef.current;
            if (_mapFb) {
              try { _matrix = _mapFb.transform?.mercatorMatrix || _mapFb.transform?.projMatrix; } catch(e) {}
            }
          }
        }
        if (_matrix && _matrix instanceof Float64Array) {
          _matrix = new Float32Array(_matrix);
        }
      } else if (glOrArgs && typeof glOrArgs === 'object' && glOrArgs.gl) {
        _gl = glOrArgs.gl;
        _matrix = glOrArgs.defaultProjectionData?.mainMatrix || glOrArgs.modelViewProjectionMatrix || glOrArgs.matrix;
      } else {
        _gl = glOrArgs;
        _matrix = matrixArg;
      }
      if (this._renderLogged === undefined) {
        this._renderLogged = true;
        console.log("[WebGLMarineLayer] render called! activeRef:", activeRef.current, "errorCount:", errorCount, "matrixType:", typeof _matrix, "matrixLen:", _matrix?.length);
      }
      if (!activeRef.current || errorCount > 3) {
        if (this._wasActive) {
          engine.clearBuffers(_gl);
          this._wasActive = false;
        }
        return;
      }

      this._wasActive = true;
      const map = mapRef.current;
      if (!map) return;

      try {
        const canvas = map.getCanvas();
        const zoom = map.getZoom();

        // Stitch viewport-specific high-resolution grid from client-side dynamic OM tiles cache
        if (typeof window !== 'undefined' && window.__DECODED_OM_TILES__) {
          const bounds = map.getBounds();
          const west = bounds.getWest();
          const south = bounds.getSouth();
          const east = bounds.getEast();
          const north = bounds.getNorth();
          
          let targetVariable = 'wave_height';
          const activeLayersList = (activeLayersRef && activeLayersRef.current) || [];
          if (activeLayersList.includes('swell_1')) {
            targetVariable = 'swell_wave_height';
          } else if (activeLayersList.includes('swell_2')) {
            targetVariable = 'secondary_swell_wave_height';
          } else if (activeLayersList.includes('wind_waves')) {
            targetVariable = 'wind_wave_height';
          }

          // FORENSIC: Log tile cache state periodically
          if (!this._forensicLogCount) this._forensicLogCount = 0;
          if (this._forensicLogCount < 5) {
            const tileVars = new Set();
            for (const t of window.__DECODED_OM_TILES__.values()) tileVars.add(t.variable);
            console.log(`[FORENSIC-RENDER] Tile cache: ${window.__DECODED_OM_TILES__.size} tiles, vars=[${[...tileVars].join(',')}], target=${targetVariable}, activeLayers=[${activeLayersList.join(',')}]`);
          }

          const latestTileTimestamp = Array.from(window.__DECODED_OM_TILES__.values())
            .reduce((max, tile) => Math.max(max, tile.timestamp), 0);
          
          const boundsKey = `${west.toFixed(2)},${south.toFixed(2)},${east.toFixed(2)},${north.toFixed(2)}`;
          const timeOffset = (timeOffsetHoursRef && timeOffsetHoursRef.current) || 0;
          const stitchKey = `${boundsKey}|${targetVariable}|${window.__DECODED_OM_TILES__.size}|${latestTileTimestamp}|${timeOffset.toFixed(3)}`;
          
          if (stitchKey !== this._lastStitchKey) {
            stitchViewportGrid._decayLogCount = 0; // Reset decay logging for new stitch
            stitchViewportGrid._forensicTemporalLogged = false; // Reset temporal logging
            const viewportBounds = { west, south, east, north };
            const stitchedGrid = stitchViewportGrid(viewportBounds, targetVariable, 128, 128, timeOffset);
            if (stitchedGrid) {
              // FORENSIC: Log stitched grid statistics
              let minH = Infinity, maxH = 0, sumH = 0, oceanCount = 0, decayedCount = 0;
              for (let vi = 0; vi < stitchedGrid.vectors.length; vi++) {
                const vec = stitchedGrid.vectors[vi];
                if (vec && vec.isOcean) {
                  oceanCount++;
                  if (vec.height < minH) minH = vec.height;
                  if (vec.height > maxH) maxH = vec.height;
                  sumH += vec.height;
                }
              }
              const meanH = oceanCount > 0 ? sumH / oceanCount : 0;
              if (this._forensicLogCount < 5) {
                console.log(`[FORENSIC-STITCH] Grid stats: ${stitchedGrid.vectors.length} vectors, ${oceanCount} ocean pts, wave heights: min=${minH.toFixed(3)}m max=${maxH.toFixed(3)}m mean=${meanH.toFixed(3)}m (${(meanH*3.281).toFixed(1)}ft)`);
                this._forensicLogCount++;
              }
              engine.setWaveData(_gl, stitchedGrid, landGeoJSONRef.current);
              this._lastStitchKey = stitchKey;
            } else {
              engine._isRouteBActive = false;
              if (this._forensicLogCount < 5) {
                console.log(`[FORENSIC-STITCH] stitchViewportGrid returned NULL for target=${targetVariable}`);
                this._forensicLogCount++;
              }
            }
          }
        } else {
          if (!this._forensicNoTilesLogged) {
            console.log('[FORENSIC-RENDER] No __DECODED_OM_TILES__ — Route B inactive');
            this._forensicNoTilesLogged = true;
          }
        }

        engine.render(_gl, _matrix, canvas.width, canvas.height, zoom, themeRef.current);
        map.triggerRepaint();
      } catch (e) {
        errorCount++;
        if (errorCount <= 3) {
          console.warn(`[WebGLMarine] Render error (${errorCount}/3):`, e.message);
        }
        if (errorCount === 3) {
          console.error('[WebGLMarine] Too many errors, disabling GPU marine particles.');
          if (onErrorRef.current) onErrorRef.current();
        }
      }
    },

    onRemove(_mapOrArgs, glArg) {
      var _gl = (glArg) ? glArg : (_mapOrArgs?.gl || _mapOrArgs?.painter?.context?.gl);
      engine.dispose(_gl);
      glRef.current = null;
    }
  };
}

export function safeMoveLayer(mapInstance, layerId, beforeId) {
  if (!mapInstance || !layerId) return;
  try {
    if (!mapInstance.getLayer(layerId)) return;
    
    // Resolve beforeId or fallbacks
    let targetBefore = beforeId;
    if (!targetBefore) targetBefore = mapInstance.getLayer('ocean-mask-fill') ? 'ocean-mask-fill' : undefined;
    if (!targetBefore) targetBefore = mapInstance.getLayer('landuse') ? 'landuse' : undefined;
    if (!targetBefore) targetBefore = mapInstance.getLayer('spot-geofences-layer') ? 'spot-geofences-layer' : undefined;

    if (targetBefore && !mapInstance.getLayer(targetBefore)) {
      targetBefore = undefined;
    }

    const style = mapInstance.getStyle();
    if (!style || !style.layers) return;

    const layers = style.layers;
    const layerIdx = layers.findIndex(l => l.id === layerId);
    const beforeIdx = targetBefore ? layers.findIndex(l => l.id === targetBefore) : layers.length;

    if (layerIdx === -1) return;

    // Already in correct position immediately before targetBefore
    if (layerIdx === beforeIdx - 1) {
      return;
    }

    mapInstance.moveLayer(layerId, targetBefore);
    console.log(`[WebGLMarine-Forensic] Moved layer '${layerId}' before '${targetBefore || 'TOP'}' (was at index ${layerIdx}, target before index ${beforeIdx})`);
  } catch (e) {
    console.warn(`[WebGLMarine-Forensic] safeMoveLayer error:`, e.message);
  }
}

export function WebGLMarineLayer({ mapInstance, active, data, revision, onAddedChange, onError, beforeId, theme, activeLayers, timeOffsetHours = 0 }) {
  const engineRef = useRef(null);
  const activeRef = useRef(active);
  const mapRef = useRef(mapInstance);
  const layerAddedRef = useRef(false);
  const onAddedChangeRef = useRef(onAddedChange);
  const onErrorRef = useRef(onError);
  const dataRef = useRef(data);
  const glRef = useRef(null);
  const themeRef = useRef(theme);
  const beforeIdRef = useRef(beforeId);
  const activeLayersRef = useRef(activeLayers);
  const timeOffsetHoursRef = useRef(timeOffsetHours);

  const [landGeoJSON, setLandGeoJSON] = useState(null);
  const landGeoJSONRef = useRef(null);
  const landGeoJSONFailedRef = useRef(false);

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { mapRef.current = mapInstance; }, [mapInstance]);
  useEffect(() => { onAddedChangeRef.current = onAddedChange; }, [onAddedChange]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { themeRef.current = theme; }, [theme]);
  useEffect(() => { beforeIdRef.current = beforeId; }, [beforeId]);
  useEffect(() => { activeLayersRef.current = activeLayers; }, [activeLayers]);
  useEffect(() => { timeOffsetHoursRef.current = timeOffsetHours; }, [timeOffsetHours]);

  // Load high-resolution land polygons on mount
  useEffect(() => {
    let activeFetch = true;
    landGeoJSONFailedRef.current = false;

    getSharedLandGeoJSON()
      .then(geojson => {
        if (geojson && activeFetch) {
          setLandGeoJSON(geojson);
          landGeoJSONRef.current = geojson;
          console.log('[WebGLMarineLayer] High-resolution land GeoJSON loaded for GPU mask (shared)');
          
          // Force active wave texture upgrade to high-res land mask immediately
          const engine = engineRef.current;
          const gl = glRef.current || mapInstance?.painter?.context?.gl;
          if (engine && gl) {
            engine._landGeoJSON = geojson;
            if (!engine._dispatcherActive && dataRef.current?.vectors?.length) {
              const routeBActive = typeof window !== 'undefined' && window.__DECODED_OM_TILES__ && window.__DECODED_OM_TILES__.size > 0;
              if (!routeBActive) {
                console.log('[WebGLMarineLayer] Upgrading active GPU wave texture to high-resolution land mask (Route A)');
                engine.setWaveData(gl, dataRef.current, geojson);
              } else {
                console.log('[FORENSIC-ROUTE-A] landGeoJSON loaded but Route B active — skipping Route A data upload, stash mask only');
                engine._landGeoJSON = geojson;
                engine._cachedMaskGeoJSON = geojson;
              }
              if (mapInstance) mapInstance.triggerRepaint();
            } else {
              console.log('[WebGLMarineLayer] High-resolution land mask stashed; background dispatcher will apply it on the next frame');
            }
          }
          if (mapInstance) {
            mapInstance.triggerRepaint();
          }
        }
      })
      .catch(err => {
        console.warn('[WebGLMarineLayer] Failed to load land GeoJSON for high-res masking:', err);
        if (activeFetch) {
          landGeoJSONFailedRef.current = true;
        }
      });
    return () => { activeFetch = false; };
  }, [mapInstance]);

  // Initialize engine + add custom layer (NO ordering logic)
  useEffect(() => {
    if (!mapInstance) return;
    if (!active) return;

    const engine = new WebGLMarineEngine();
    engineRef.current = engine;

    const isMobile = window.innerWidth < 768;
    engine.particleRes = isMobile ? 192 : 296;

    const customLayer = createCustomLayer(engine, activeRef, mapRef, dataRef, glRef, onErrorRef, themeRef, landGeoJSONRef, landGeoJSONFailedRef, activeLayersRef, timeOffsetHoursRef);

    // Add layer once when style is loaded. Re-add on theme/style changes.
    const handleStyleData = () => {
      if (!mapInstance || !mapInstance.style) return;

      // Only add the layer if it doesn't already exist to prevent re-entrant infinite loops
      if (!mapInstance.getLayer(LAYER_ID)) {
        layerAddedRef.current = false;
        try {
          // Insert BEFORE beforeId or ocean-mask-fill so land mask renders on top, naturally clipping any bleed.
          // Falls back to landuse or spot-geofences-layer if mask layer doesn't exist yet.
          let targetBeforeId = beforeIdRef.current;
          if (!targetBeforeId) targetBeforeId = mapInstance.getLayer('ocean-mask-fill') ? 'ocean-mask-fill' : undefined;
          if (!targetBeforeId) targetBeforeId = mapInstance.getLayer('landuse') ? 'landuse' : undefined;
          if (!targetBeforeId) targetBeforeId = mapInstance.getLayer('spot-geofences-layer') ? 'spot-geofences-layer' : undefined;

          console.log(`[WebGLMarine-Forensic] Adding custom layer ${LAYER_ID} before '${targetBeforeId || 'TOP'}'`);
          mapInstance.addLayer(customLayer, targetBeforeId);
          layerAddedRef.current = true;
          console.log(`[WebGLMarine-Forensic] Layer added BEFORE '${targetBeforeId || 'TOP'}' (${engine.particleRes}^2 = ${engine.particleRes ** 2} particles)`);
          if (onAddedChangeRef.current) onAddedChangeRef.current(true);
        } catch (e) {
          console.warn('[WebGLMarine-Forensic] Failed to add layer:', e.message);
        }
      } else {
        // Safeguard: ensure the layer is positioned BEFORE targetBeforeId or 'ocean-mask-fill' if it exists.
        safeMoveLayer(mapInstance, LAYER_ID, beforeIdRef.current);
      }
    };

    mapInstance.on('styledata', handleStyleData);
    mapInstance.on('style.load', handleStyleData);
    handleStyleData();

    return () => {
      try {
        console.log(`[WebGLMarine-Forensic] Cleaning up custom layer ${LAYER_ID}`);
        mapInstance.off('styledata', handleStyleData);
        mapInstance.off('style.load', handleStyleData);
        if (mapInstance.getLayer(LAYER_ID)) {
          mapInstance.removeLayer(LAYER_ID);
        }
        if (onAddedChangeRef.current) onAddedChangeRef.current(false);
      } catch (e) { /* map may be disposed */ }
      layerAddedRef.current = false;
      unregisterMarineEngine();
      engine.dispose(mapInstance.painter?.context?.gl);
      engineRef.current = null;
    };
  }, [mapInstance, active]);

  // Update wave data texture when data changes
  useEffect(() => {
    const engine = engineRef.current;
    const gl = glRef.current || mapInstance?.painter?.context?.gl;
    if (!engine || !data?.vectors?.length || !gl) return;

    if (engine._dispatcherActive) {
      console.log(`[WebGLMarine] Skipping React effect setWaveData because RenderPlanDispatcher is active`);
      return;
    }

    // CRITICAL: If Route B (decoded om:// tiles) is actively rendering high-res stitched grid,
    // DON'T overwrite it with Route A's raw deep-water marineController data.
    const isRouteBActive = !!engine._isRouteBActive;
    if (isRouteBActive) {
      console.log(`[FORENSIC-ROUTE-A] Skipping React data effect — Route B is actively rendering high-res stitched grid.`);
      return;
    }

    try {
      // FORENSIC: Log what Route A is uploading
      let maxS = 0, sumS = 0, cnt = 0;
      for (const vec of data.vectors) {
        if (vec && vec.speed > 0) { cnt++; sumS += vec.speed; if (vec.speed > maxS) maxS = vec.speed; }
      }
      console.log(`[FORENSIC-ROUTE-A] setWaveData: ${data.vectors.length} vectors, max=${maxS.toFixed(2)}m, mean=${cnt > 0 ? (sumS/cnt).toFixed(2) : 0}m (Route A — marineController JSON API)`);
      engine.setWaveData(gl, data, landGeoJSONRef.current);
      if (mapInstance) {
        mapInstance.triggerRepaint();
      }
    } catch (e) {
      console.warn('[WebGLMarine] setWaveData error:', e.message);
    }
  }, [data, mapInstance, landGeoJSON]);

  // Enforce layer order safeguard ONLY on beforeId or active or mapInstance changes (NOT high-frequency data/revision)
  useEffect(() => {
    if (!mapInstance || !active) return;
    safeMoveLayer(mapInstance, LAYER_ID, beforeId);
  }, [mapInstance, active, beforeId]);

  return null;
}

export default WebGLMarineLayer;

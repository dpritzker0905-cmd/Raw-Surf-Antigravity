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

function stitchViewportGrid(viewportBounds, targetVariable, targetCols = 128, targetRows = 128) {
  if (typeof window === 'undefined' || !window.__DECODED_OM_TILES__) return null;
  
  const { west, south, east, north } = viewportBounds;
  const lngSpan = east - west;
  const latSpan = north - south;
  
  // 1. Gather all cached tiles that overlap with the viewport and match targetVariable
  const overlappingTiles = [];
  for (const [key, tile] of window.__DECODED_OM_TILES__.entries()) {
    if (tile.variable !== targetVariable) continue;
    
    const [tWest, tSouth, tEast, tNorth] = tile.bounds;
    // Check overlap
    const overlapX = Math.max(west, tWest) <= Math.min(east, tEast);
    const overlapY = Math.max(south, tSouth) <= Math.min(north, tNorth);
    if (overlapX && overlapY) {
      overlappingTiles.push(tile);
    }
  }
  
  if (overlappingTiles.length === 0) return null;
  
  // 2. Initialize target grid vectors
  const size = targetCols * targetRows;
  const vectors = new Array(size);
  
  for (let r = 0; r < targetRows; r++) {
    const lat = south + (r / (targetRows - 1)) * latSpan;
    for (let c = 0; c < targetCols; c++) {
      const lng = west + (c / (targetCols - 1)) * lngSpan;
      const idx = r * targetCols + c;
      
      // Find the best tile that covers this (lng, lat)
      let bestTile = null;
      for (const tile of overlappingTiles) {
        const [tWest, tSouth, tEast, tNorth] = tile.bounds;
        if (lng >= tWest && lng <= tEast && lat >= tSouth && lat <= tNorth) {
          bestTile = tile;
          break;
        }
      }
      
      // If no perfect tile, find the closest one
      if (!bestTile && overlappingTiles.length > 0) {
        bestTile = overlappingTiles[0];
      }
      
      if (bestTile) {
        const [tWest, tSouth, tEast, tNorth] = bestTile.bounds;
        const tLngSpan = tEast - tWest;
        const tLatSpan = tNorth - tSouth;
        
        const tileDim = Math.sqrt(bestTile.values.length);
        
        const tx = Math.max(0, Math.min(tileDim - 1, ((lng - tWest) / tLngSpan) * (tileDim - 1)));
        const ty = Math.max(0, Math.min(tileDim - 1, (1.0 - (lat - tSouth) / tLatSpan) * (tileDim - 1)));
        
        // Bilinear interpolation
        const x0 = Math.floor(tx);
        const x1 = Math.min(tileDim - 1, x0 + 1);
        const y0 = Math.floor(ty);
        const y1 = Math.min(tileDim - 1, y0 + 1);
        
        const dx = tx - x0;
        const dy = ty - y0;
        
        const idx00 = y0 * tileDim + x0;
        const idx10 = y0 * tileDim + x1;
        const idx01 = y1 * tileDim + x0;
        const idx11 = y1 * tileDim + x1;
        
        const raw00 = bestTile.values[idx00];
        const raw10 = bestTile.values[idx10];
        const raw01 = bestTile.values[idx01];
        const raw11 = bestTile.values[idx11];
        
        const v00 = (typeof raw00 === 'number' && !isNaN(raw00)) ? raw00 : 0;
        const v10 = (typeof raw10 === 'number' && !isNaN(raw10)) ? raw10 : 0;
        const v01 = (typeof raw01 === 'number' && !isNaN(raw01)) ? raw01 : 0;
        const v11 = (typeof raw11 === 'number' && !isNaN(raw11)) ? raw11 : 0;
        
        const isOceanPoint = (typeof raw00 === 'number' && !isNaN(raw00)) ||
                             (typeof raw10 === 'number' && !isNaN(raw10)) ||
                             (typeof raw01 === 'number' && !isNaN(raw01)) ||
                             (typeof raw11 === 'number' && !isNaN(raw11));
        
        const h = v00 * (1 - dx) * (1 - dy) +
                  v10 * dx * (1 - dy) +
                  v01 * (1 - dx) * dy +
                  v11 * dx * dy;
                  
        let dir = 0;
        if (bestTile.directions) {
          const d00 = bestTile.directions[idx00] || 0;
          const d10 = bestTile.directions[idx10] || 0;
          const d01 = bestTile.directions[idx01] || 0;
          const d11 = bestTile.directions[idx11] || 0;
          
          const r00 = d00 * Math.PI / 180;
          const r10 = d10 * Math.PI / 180;
          const r01 = d01 * Math.PI / 180;
          const r11 = d11 * Math.PI / 180;
          
          const sinAvg = Math.sin(r00) * (1 - dx) * (1 - dy) +
                         Math.sin(r10) * dx * (1 - dy) +
                         Math.sin(r01) * (1 - dx) * dy +
                         Math.sin(r11) * dx * dy;
                         
          const cosAvg = Math.cos(r00) * (1 - dx) * (1 - dy) +
                         Math.cos(r10) * dx * (1 - dy) +
                         Math.cos(r01) * (1 - dx) * dy +
                         Math.cos(r11) * dx * dy;
                         
          dir = (Math.atan2(sinAvg, cosAvg) * 180 / Math.PI + 360) % 360;
        }
        
        const dirRad = dir * Math.PI / 180;
        
        vectors[idx] = {
          u: -h * Math.sin(dirRad),
          v: -h * Math.cos(dirRad),
          speed: h,
          height: h,
          direction: dir,
          period: 8.0,
          swellHeight: h * 0.8,
          swellDir: dir,
          isOcean: isOceanPoint
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
    bounds: { west, south, east, north }
  };
}

function createCustomLayer(engine, activeRef, mapRef, dataRef, glRef, onErrorRef, themeRef, landGeoJSONRef, landGeoJSONFailedRef, activeLayersRef) {
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
          console.log(`[WebGLMarine] Binding initial data onAdd:`, dataRef.current.vectors.length, 'vectors');
          engine.setWaveData(_gl, dataRef.current, landGeoJSONRef.current);
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

      // Prevent rendering the heatmap/particles over land before the high-res mask is loaded and active in the WebGL engine
      const isHighResActive = !!landGeoJSONRef.current;
      if (!isHighResActive && !landGeoJSONFailedRef.current) {
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

          const latestTileTimestamp = Array.from(window.__DECODED_OM_TILES__.values())
            .reduce((max, tile) => Math.max(max, tile.timestamp), 0);
          
          const boundsKey = `${west.toFixed(2)},${south.toFixed(2)},${east.toFixed(2)},${north.toFixed(2)}`;
          const stitchKey = `${boundsKey}|${targetVariable}|${window.__DECODED_OM_TILES__.size}|${latestTileTimestamp}`;
          
          if (stitchKey !== this._lastStitchKey) {
            const viewportBounds = { west, south, east, north };
            const stitchedGrid = stitchViewportGrid(viewportBounds, targetVariable, 128, 128);
            if (stitchedGrid) {
              engine.setWaveData(_gl, stitchedGrid, landGeoJSONRef.current);
              this._lastStitchKey = stitchKey;
            }
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

export function WebGLMarineLayer({ mapInstance, active, data, revision, onAddedChange, onError, beforeId, theme, activeLayers }) {
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
              console.log('[WebGLMarineLayer] Upgrading active GPU wave texture to high-resolution land mask');
              engine.setWaveData(gl, dataRef.current, geojson);
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

    const customLayer = createCustomLayer(engine, activeRef, mapRef, dataRef, glRef, onErrorRef, themeRef, landGeoJSONRef, landGeoJSONFailedRef, activeLayersRef);

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

    try {
      console.log(`[WebGLMarine] setWaveData triggered by effect:`, data.vectors.length, 'vectors');
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

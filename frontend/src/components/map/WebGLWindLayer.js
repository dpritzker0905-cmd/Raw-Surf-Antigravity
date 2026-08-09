/**
 * WebGLWindLayer MapLibre custom layer integration for GPU wind particles
 *
 * v3.8: React component wrapping WebGLWindEngine as a MapLibre CustomLayerInterface.
 * Replaces Canvas2D GPUWindLayer when wind data is available.
 *
 * Props:
 *   - mapInstance: MapLibre map ref
 *   - active: boolean - whether wind layer is toggled on
 *   - data: wind grid object { vectors, cols, rows, bounds }
 *   - revision: cache-bust revision ID
 */
import { memo, useEffect, useRef } from 'react';
import WebGLWindEngine from './WebGLWindEngine';
import { getWindParticleRes } from './deviceTier';
import { registerWindEngine, unregisterWindEngine } from '../../engine/RenderPlanDispatcher';

var LAYER_ID = 'webgl-wind-particles';

/**
 * Creates a MapLibre CustomLayerInterface that delegates rendering
 * to the WebGLWindEngine.
 */
function createCustomLayer(engine, activeRef, mapRef, glRef, onErrorRef, themeRef) {
  let errorCount = 0;
  let lastErrorTime = 0; // v3.15: Track error time for recovery
  return {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '2d',

    onAdd(_mapOrArgs, glArg) {
      // v5 compat: MapLibre v5 may pass args object
      var _gl = (glArg) ? glArg : (_mapOrArgs?.gl || _mapOrArgs?.painter?.context?.gl);
      glRef.current = _gl;
      try {
        engine.init(_gl);
        // Register with RenderPlanDispatcher for evolved field data
        registerWindEngine(engine, _gl);
      } catch (e) {
        console.error('[WebGLWind] Init failed:', e.message);
        if (onErrorRef.current) onErrorRef.current();
      }
    },

    render(glOrArgs, matrixArg) {
      // v5 compat: MapLibre v5 passes (gl, matrixObj) where matrixObj is a wrapper
      // v4 API was (gl, Float32Array)
      var _gl, _matrix;
      var isWebGLCtx = (glOrArgs instanceof WebGLRenderingContext || glOrArgs instanceof WebGL2RenderingContext);
      if (isWebGLCtx) {
        // v4 or v5 with positional args — gl is a real WebGL context
        _gl = glOrArgs;
        // In v5, matrix may be a wrapper object instead of Float32Array
        if (matrixArg && matrixArg.length >= 16) {
          _matrix = matrixArg; // v4 style: Float32Array(16)
        } else if (matrixArg && typeof matrixArg === 'object') {
          // v5 style: Object with matrix properties
          // Our shader expects mercator [0,1] coords → clip space, which is defaultProjectionData.mainMatrix (= mercatorMatrix)
          // v3.15: NEVER use modelViewProjectionMatrix — it's in a different coordinate space and causes projection glitches
          _matrix = matrixArg.defaultProjectionData?.mainMatrix || matrixArg.mercatorMatrix || matrixArg.mainMatrix;
          if (!_matrix || !_matrix.length) {
            // Fallback: search all values for a Float32Array/Float64Array of length 16
            // but EXCLUDE modelViewProjectionMatrix which is in a different coordinate space
            for (var k in matrixArg) {
              if (k === 'modelViewProjectionMatrix') continue; // v3.15: Skip — wrong coord space
              var v = matrixArg[k];
              if (v && (v instanceof Float32Array || v instanceof Float64Array) && v.length === 16) {
                _matrix = v;
                break;
              }
            }
          }
          // Ultimate fallback: build matrix from map transform
          if (!_matrix || !_matrix.length) {
            var _mapFb = mapRef.current;
            if (_mapFb) {
              try {
                _matrix = _mapFb.transform?.mercatorMatrix || _mapFb.transform?.projMatrix;
              } catch(e) { /* ignore */ }
            }
          }
        }
        // Convert Float64Array → Float32Array for gl.uniformMatrix4fv compatibility
        if (_matrix && _matrix instanceof Float64Array) {
          _matrix = new Float32Array(_matrix);
        }
      } else if (glOrArgs && typeof glOrArgs === 'object' && glOrArgs.gl) {
        // Pure v5 args-object style
        _gl = glOrArgs.gl;
        // v3.15: Never use modelViewProjectionMatrix — wrong coordinate space
        _matrix = glOrArgs.defaultProjectionData?.mainMatrix || glOrArgs.mercatorMatrix || glOrArgs.matrix;
      } else {
        _gl = glOrArgs;
        _matrix = matrixArg;
      }
      if (this._renderLogged === undefined) {
        this._renderLogged = true;
        console.log("[WebGLWindLayer] render init: matrix", _matrix?.constructor?.name, "len:", _matrix?.length, "active:", activeRef.current);
      }

      // v3.15: Error recovery — reset count after 10s of no errors
      if (errorCount > 0 && (Date.now() - lastErrorTime) > 10000) {
        errorCount = 0;
      }

      if (!activeRef.current || errorCount > 5) {
        // v3.11.2r1 → conditional (instant toggle): do NOT wipe the trail FBOs on deactivation.
        // Keeping them means toggling wind back on shows the resident field INSTANTLY instead of
        // rebuilding trails over ~1s. Stale trails are still handled where it matters: a viewport
        // change on reactivation triggers reinitParticles() (which clears) via the data effect's
        // boundsChanged path, and a genuine zoom change clears in render(). A same-viewport
        // hour change just re-advects the kept trails with the new field (same as scrubbing —
        // smooth, geographically correct), so no clear is needed.
        this._wasActive = false;
        return;
      }
      this._wasActive = true;
      const map = mapRef.current;
      if (!map) return;

      try {
        const canvas = map.getCanvas();
        const zoom = map.getZoom();

        // Calculate visible world offsets to handle wrapping across all zoom levels and pans
        let worldOffsets = [0.0];
        try {
          const center = map.getCenter();
          if (center && typeof center.lng === 'number') {
            const centerLng = center.lng;
            // Calculate visible longitude span using the viewport width and zoom level
            const span = (canvas.width * 360.0) / (256.0 * Math.pow(2.0, zoom));
            
            // Add padding: 180 degrees at low zoom to pre-render adjacent worlds; 10 degrees at high zoom
            const padding = zoom < 3.5 ? 180.0 : 10.0;
            const west = centerLng - (span / 2.0) - padding;
            const east = centerLng + (span / 2.0) + padding;
            
            const minOffset = Math.floor((west + 180.0) / 360.0) * 360.0;
            const maxOffset = Math.ceil((east - 180.0) / 360.0) * 360.0;
            const computedOffsets = [];
            for (let offset = minOffset; offset <= maxOffset; offset += 360.0) {
              computedOffsets.push(offset);
            }
            if (computedOffsets.length > 0) {
              worldOffsets = computedOffsets;
            }
          }
        } catch (boundsErr) {
          console.warn('[WebGLWindLayer] Failed to calculate dynamic offsets:', boundsErr);
        }

        // v3.16: Compute viewport bounds for viewport-biased particle respawning
        let viewportBounds = null;
        try {
          const mapBounds = map.getBounds();
          if (mapBounds) {
            viewportBounds = [
              mapBounds.getWest(),
              mapBounds.getSouth(),
              mapBounds.getEast(),
              mapBounds.getNorth()
            ];
          }
        } catch (vbErr) {
          // Fallback: global bounds
        }

        engine.render(_gl, _matrix, canvas.width, canvas.height, zoom, themeRef.current, worldOffsets, viewportBounds);
        // Request continuous repainting while active
        map.triggerRepaint();
      } catch (e) {
        errorCount++;
        lastErrorTime = Date.now();
        if (errorCount <= 5) {
          console.warn(`[WebGLWind] Render error (${errorCount}/5):`, e.message);
        }
        if (errorCount === 5) {
          console.error('[WebGLWind] Too many errors, temporarily disabling GPU particles (will retry in 10s).');
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

// memo (2026-07-07, chip task_c5366c79 slice 3): MapWebGL re-renders per radar frame step;
// all props here are primitives or stable refs once the caller hoists onError. Skipping
// renders on equal props is behavior-identical (effects key on the same prop values).
function WebGLWindLayerInner({ mapInstance, active, data, deliveryQueue, revision, onError, theme }) {
  const engineRef = useRef(null);
  const activeRef = useRef(active);
  const mapRef = useRef(mapInstance);
  const layerAddedRef = useRef(false);
  const onErrorRef = useRef(onError);
  const glRef = useRef(null);
  const pendingDataRef = useRef(null); // Stash data that arrives before GL is ready
  const themeRef = useRef(theme);
  const dataRef = useRef(data);
  const deliveryQueueRef = useRef(deliveryQueue); // #14: the WeatherEngine choke's commit-order queue

  // Keep refs in sync
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { mapRef.current = mapInstance; }, [mapInstance]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { themeRef.current = theme; }, [theme]);
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { deliveryQueueRef.current = deliveryQueue; }, [deliveryQueue]);

  // Initialize engine + add custom layer
  useEffect(() => {
    if (!mapInstance) return;

    const engine = new WebGLWindEngine();
    engineRef.current = engine;

    // R11-09 (2026-08-09): device-capability tier, NOT window width — the one-shot
    // `window.innerWidth < 768` here was the exact marine bug deviceTier.js was built to kill
    // (live-caught 2026-07-02), never mirrored to wind: a desktop mounted with a narrow window
    // kept the 4× sparser pool (36,864 vs 147,456) for the engine's lifetime.
    engine.particleRes = getWindParticleRes();

    const customLayer = createCustomLayer(engine, activeRef, mapRef, glRef, onErrorRef, themeRef);

    // v3.13: After GL is ready, apply any pending wind data that arrived before onAdd
    const origOnAdd = customLayer.onAdd.bind(customLayer);
    customLayer.onAdd = function(_mapOrArgs, glArg) {
      origOnAdd(_mapOrArgs, glArg);
      // Apply pending data now that GL is available
      const gl = glRef.current;
      const dataToApply = pendingDataRef.current || dataRef.current;
      if (gl && dataToApply?.vectors?.length) {
        try {
          engine.setWindData(gl, dataToApply);
          if (typeof engine.reinitParticles === 'function') {
            engine.reinitParticles(gl);
          }
          pendingDataRef.current = null;
          mapInstance.triggerRepaint();
        } catch (e) {
          console.warn('[WebGLWind] Deferred setWindData error:', e.message);
        }
      }
    };

    // Dynamic layer style data sync: add layer and keep it present across style/theme reloads
    const handleStyleData = () => {
      if (!mapInstance || !mapInstance.style) return;

      if (!mapInstance.getLayer(LAYER_ID)) {
        layerAddedRef.current = false;
        try {
          mapInstance.addLayer(customLayer);
          layerAddedRef.current = true;
          console.log(`[WebGLWind] Layer added (${engine.particleRes}^2 = ${engine.particleRes ** 2} particles)`);
        } catch (e) {
          console.warn('[WebGLWind] Failed to add layer:', e.message);
        }
      }
    };

    mapInstance.on('styledata', handleStyleData);
    mapInstance.on('style.load', handleStyleData);
    handleStyleData();

    return () => {
      try {
        mapInstance.off('styledata', handleStyleData);
        mapInstance.off('style.load', handleStyleData);
        if (layerAddedRef.current && mapInstance.getLayer(LAYER_ID)) {
          mapInstance.removeLayer(LAYER_ID);
        }
      } catch (e) { /* map may be disposed */ }
      layerAddedRef.current = false;
      unregisterWindEngine();
      engine.dispose(mapInstance.painter?.context?.gl);
      engineRef.current = null;
    };
  }, [mapInstance]);

  // Update wind data texture when data changes
  useEffect(() => {
    // #14 DELIVERY TRIPWIRE (permanent, bounded log 80): counts every effect invocation, the branch
    // taken, and — inside applyWindUpdate — the data span (world>=350 vs clip), source, and the
    // engine filing verdict + resident-slot state before/after. worldApplied vs the choke's
    // __WIND_STATE_COMMITS__ is the regression detector: a world committed to state but not applied
    // here means the batching-collapse drop is back. Read: window.__WIND_LAYER_DELIVERY__.
    const _dl = (typeof window !== 'undefined')
      ? (window.__WIND_LAYER_DELIVERY__ = window.__WIND_LAYER_DELIVERY__
          || { runs: 0, noEngine: 0, inactive: 0, clear: 0, noGl: 0, applied: 0, worldApplied: 0, clipApplied: 0, verdicts: {}, log: [] })
      : null;
    const _spanOf = (b) => b ? (b.west > b.east ? (b.east + 360) - b.west : b.east - b.west) : 0;
    if (_dl) _dl.runs += 1;

    const engine = engineRef.current;
    const gl = glRef.current || mapInstance?.painter?.context?.gl;
    if (!engine || !mapInstance) { if (_dl) _dl.noEngine += 1; return; }

    if (!active) {
      if (_dl) _dl.inactive += 1;
      return;
    }

    if (!data?.vectors?.length || data.renderable === false) {
      if (_dl) _dl.clear += 1;
      if (gl) {
        // queue #9: clearWindData frees BOTH the base and the fine-overlay textures.
        if (typeof engine.clearWindData === 'function') {
          engine.clearWindData(gl);
        } else {
          if (engine._windData?.texture) {
            gl.deleteTexture(engine._windData.texture);
          }
          engine._windData = null;
        }
        engine.clearBuffers(gl);
        mapInstance.triggerRepaint();
      }
      return;
    }

    // v3.13: If GL isn't ready yet (onAdd hasn't fired), stash data for deferred application
    if (!gl) {
      if (_dl) _dl.noGl += 1;
      pendingDataRef.current = data;
      return;
    }

    if (engine._scrubTimeout) {
      clearTimeout(engine._scrubTimeout);
      engine._scrubTimeout = null;
    }

    try {
      const applyWindUpdate = () => {
        // #14 DELIVERY DRAIN (2026-07-21): React batching collapses several same-flush commits
        // into ONE effect run whose `data` is only the last-in-batch — a world base committed
        // earlier is invisible here (measured: world committed to state x2, delivered to engine
        // x0 → engine ends clip-primary, a same-model pan shows a hole). Deliver EVERY grid the
        // choke queued, in commit order; the engine's base/fine/promote filing is order-independent.
        const scrubbing = typeof window !== 'undefined' && window.isScrubbingTimeline;
        const queueOn = typeof window === 'undefined' || window.__RAW_DISABLE_WIND_DELIVERY_QUEUE__ !== true;
        const q = deliveryQueueRef.current && deliveryQueueRef.current.current;
        let grids;
        if (queueOn && !scrubbing && q && q.length) {
          // renderable grids in commit order, guaranteed to end with the current `data`
          grids = q.filter(g => g && g.vectors?.length && g.renderable !== false);
          if (!grids.length || grids[grids.length - 1] !== data) grids.push(data);
        } else {
          // scrub stays single-delivery so frames scrubbed past are never GPU-uploaded
          grids = [data];
        }
        if (q) q.length = 0; // drained (scrub drops intermediates by design)

        console.log(`[WebGLWind] setWindData triggered by effect: delivering ${grids.length} grid(s), last ${data.vectors.length} vectors`);

        const getLongitudeSpan = (b) => {
          const crosses = b.west > b.east;
          return crosses ? (b.east + 360.0) - b.west : b.east - b.west;
        };
        const preModel = engine.__lastWindSource;
        const preBounds = engine._windData?.bounds;

        let lastVerdict = 'skipped';
        for (let gi = 0; gi < grids.length; gi++) {
          const grid = grids[gi];
          if (!grid || !grid.vectors?.length) continue;
          const _preBaseGlobal = !!(engine._windData && _spanOf(engine._windData.bounds) >= 350);
          const _preFine = !!engine._windFine;
          const v = engine.setWindData(gl, grid);
          lastVerdict = v;
          // #14 DELIVERY TRIPWIRE: record what the engine did with THIS grid.
          if (_dl) {
            const sp = _spanOf(grid.bounds);
            _dl.applied += 1;
            if (sp >= 350) _dl.worldApplied += 1; else _dl.clipApplied += 1;
            _dl.verdicts[v] = (_dl.verdicts[v] || 0) + 1;
            if (_dl.log.length < 80) _dl.log.push({
              t: Date.now(), span: Math.round(sp), src: grid.source || null, hr: grid.hourOffset || 0,
              vt: grid.valid_time || grid.validTime || null, verdict: v, drained: grids.length,
              preBaseGlobal: _preBaseGlobal, preFine: _preFine,
              postBaseGlobal: !!(engine._windData && _spanOf(engine._windData.bounds) >= 350),
              postFine: !!engine._windFine
            });
          }
        }
        engine.__lastWindSource = data.source || null;

        // NET particle reseed (2026-07-19 keepTrails contract, evaluated on the ENGINE's actual
        // BASE bounds before/after the drain — the field particles advect on). A grid the engine
        // NO-OP'd (an identical re-commit, or a coarse SWR preview dropped by the coarse-overlay
        // guard) leaves the base unchanged → NO reseed. A FINE overlay leaves the base unchanged
        // too. A MODEL switch full-clears via modelChanged below (old-air trails must not linger).
        // A same-model base swap to a materially different box crossfades (keepTrails). A cold
        // engine seeds once. Kill: __RAW_WIND_TRAIL_CLEAR_LEGACY__ restores the legacy always-clear.
        const postBounds = engine._windData?.bounds;
        let netBoundsChanged = false;
        if (!preBounds && postBounds) {
          netBoundsChanged = true;
        } else if (preBounds && postBounds) {
          const oldSpan = getLongitudeSpan(preBounds);
          const newSpan = getLongitudeSpan(postBounds);
          let dx = Math.abs(postBounds.west - preBounds.west);
          if (dx > 180.0) dx = 360.0 - dx;
          if (Math.abs(newSpan - oldSpan) > 2.0
              || Math.abs((postBounds.north - postBounds.south) - (preBounds.north - preBounds.south)) > 2.0
              || dx > 2.0
              || Math.abs(postBounds.south - preBounds.south) > 2.0) {
            netBoundsChanged = true;
          }
        }
        const engineWasEmpty = !preBounds;
        const modelChanged = !!preModel && preModel !== (data.source || null);
        if (typeof engine.reinitParticles === 'function'
            && (engineWasEmpty
                || modelChanged
                || (netBoundsChanged && lastVerdict !== 'fine' && lastVerdict !== 'base_promote'))) {
          engine.reinitParticles(gl, { keepTrails: !modelChanged && !engineWasEmpty });
        }

        pendingDataRef.current = null;
        mapInstance.triggerRepaint();
      };

      if (typeof window !== 'undefined' && window.isScrubbingTimeline) {
        // Debounce the GPU upload + particle reinit so frames scrubbed past are skipped.
        engine._scrubTimeout = setTimeout(applyWindUpdate, 60);
      } else {
        applyWindUpdate();
      }
    } catch (e) {
      console.warn('[WebGLWind] setWindData error:', e.message);
    }

    return () => {
      if (engine._scrubTimeout) {
        clearTimeout(engine._scrubTimeout);
        engine._scrubTimeout = null;
      }
    };
  }, [data, mapInstance, active]);

  // Trigger repaints when activated
  useEffect(() => {
    if (active && mapInstance) {
      mapInstance.triggerRepaint();
    }
  }, [active, mapInstance]);

 // No DOM element this renders directly into MapLibre's WebGL context
  return null;
}

export const WebGLWindLayer = memo(WebGLWindLayerInner);

export default WebGLWindLayer;

import { registerMarineEngine } from '../../engine/RenderPlanDispatcher';
import { MARINE_ZOOMED_OUT_MAX_ZOOM } from './marineZoomThresholds';
import { shouldHoldClearOnDeactivate, noteMarineActive } from './marineTransitionCoordinator';

export const LAYER_ID = 'webgl-marine-particles';

function getLongitudinalOverlap(w1, e1, w2, e2) {
  const vpWidth = (e1 < w1) ? (e1 + 360) - w1 : e1 - w1;
  if (vpWidth >= 360.0 - 1e-5) {
    return (e2 < w2) ? (e2 + 360) - w2 : e2 - w2;
  }
  const norm = lng => ((lng % 360) + 360) % 360;
  const nw1 = norm(w1), ne1 = norm(e1);
  const nw2 = norm(w2), ne2 = norm(e2);
  const getSegments = (s, e) => s <= e ? [[s, e]] : [[s, 360], [0, e]];
  const segs1 = getSegments(nw1, ne1);
  const segs2 = getSegments(nw2, ne2);
  let overlap = 0;
  for (const seg1 of segs1) {
    for (const seg2 of segs2) {
      const start = Math.max(seg1[0], seg2[0]);
      const end = Math.min(seg1[1], seg2[1]);
      if (start < end) overlap += (end - start);
    }
  }
  return overlap;
}

// #11 RE-FEED COVERAGE GUARD (2026-07-21). The retained frame is the grid last on screen. After a
// toggle-off → pan → toggle-on (past the hold TTL), re-feeding a REGIONAL grid that no longer covers
// the current viewport paints a floating rectangle at the OLD location — the render's regional cull
// only fires when zoomed OUT, so a partial overlap at a zoomed-in view still draws. Only re-feed a
// grid that COVERS the viewport, or a GLOBAL grid (covers everything). Pure + exported for the gate
// test. Fail-open (returns true) on any missing input so it can never suppress a legitimate feed.
// Kill: __RAW_DISABLE_MARINE_REFEED_COVER_GUARD__ -> legacy always-feed.
export function marineRefeedCovers(grid, vb, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (w && w.__RAW_DISABLE_MARINE_REFEED_COVER_GUARD__ === true) return true;
  if (!grid) return false;
  const gb = grid.grid?.bounds || grid.bounds;
  if (!gb) return true; // no bounds to test -> legacy behaviour
  const cs = grid.coverage_scope || grid.coverageMode || grid.grid?.coverage_scope || grid.grid?.coverageMode;
  const span = gb.west > gb.east ? (gb.east + 360) - gb.west : gb.east - gb.west;
  if (span >= 340 || cs === 'global' || cs === 'global_coarse') return true; // global covers everything
  if (!vb) return true; // no viewport -> fail-open
  const eps = 0.05;
  return gb.west <= vb.west + eps && gb.east >= vb.east - eps && gb.south <= vb.south + eps && gb.north >= vb.north - eps;
}

// Viewport bounds ({west,south,east,north}) from a maplibre map, or null.
export function marineViewportBounds(map) {
  try {
    const b = map && map.getBounds && map.getBounds();
    return b ? { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() } : null;
  } catch (e) { return null; }
}

export function createCustomLayer(engine, activeRef, mapRef, dataRef, glRef, onErrorRef, themeRef, landGeoJSONRef, landGeoJSONFailedRef, activeLayersRef, timeOffsetHoursRef, safeUploadRef, activeModelRef) {
  let errorCount = 0;
  return {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '2d',
    engine,

    onAdd(_mapOrArgs, glArg) {
      var _gl = (glArg) ? glArg : (_mapOrArgs?.gl || _mapOrArgs?.painter?.context?.gl);
      glRef.current = _gl;
      try {
        engine.init(_gl);
        registerMarineEngine(engine, _gl);
        if (dataRef.current?.vectors?.length && marineRefeedCovers(dataRef.current, marineViewportBounds(mapRef?.current))) {
          console.log(`[WebGLMarine] Binding initial data onAdd:`, dataRef.current.vectors.length, 'vectors (forecast-authoritative)');
          if (safeUploadRef?.current) {
            safeUploadRef.current('initial_onAdd', _gl, dataRef.current, landGeoJSONRef.current);
          } else {
            try {
              window.__WEBGL_MARINE_UPLOAD_REASON__ = 'initial_onAdd';
              engine.setWaveData(_gl, dataRef.current, landGeoJSONRef.current);
            } catch (err) {
              console.error('[WebGLMarine] Texture encoding failed:', err.message);
              if (window.__WEATHER_TELEMETRY__) {
                const gridModel = dataRef.current?.__sourceModel || 'GFS';
                const activeMarineLayer = 'waves';
                window.__WEATHER_TELEMETRY__.trackTextureEncodingError(gridModel, activeMarineLayer, 0, err.message);
              }
            }
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
          // TRANSITION HOLD (2026-07-06): a model/layer switch blinks activeRef false for a
          // beat — keep the resident textures through it (see shouldHoldClearOnDeactivate);
          // _wasActive stays true so a deactivation that OUTLIVES the transition still clears
          // on the next frame once the flags drop.
          if (!shouldHoldClearOnDeactivate()) {
            engine.clearBuffers(_gl);
            this._wasActive = false;
          }
        }
        return;
      }

      this._wasActive = true;
      noteMarineActive(); // reset the #27 cross-family deactivation clock (no-op when not ticking)
      // COARSE-BASE BRIDGE flag — reset every frame; set true only in the regional-rejected-zoomed-out
      // branch below when a retained coarse base exists (bridges the z<7 zoom-out clear).
      if (engine) engine.__coarseBridgeActive = false;
      const map = mapRef.current;
      if (!map) return;

      let viewportBounds = null;
      let opacityMultiplier = 1.0;
      try {
        const mb = map.getBounds();
        const ew = mb.getWest(), ee = mb.getEast(), es = mb.getSouth(), en = mb.getNorth();
        viewportBounds = [ew, es, ee, en];
      } catch (e) {
        // ignore bounds retrieval errors for viewportBounds, we will use zoom-based fallback below if needed
      }

      if (engine && engine._waveData && engine._waveData.waveGrid?.bounds) {
        const bounds = engine._waveData.waveGrid.bounds;
        const isGlobalGrid = Math.abs(bounds.east - bounds.west) >= 350;
        if (!isGlobalGrid) {
          const gw = bounds.west, ge = bounds.east, gs = bounds.south, gn = bounds.north;
          const gridWidth = (ge < gw) ? (ge + 360) - gw : ge - gw;
          const activeModel = activeModelRef ? activeModelRef.current : 'GFS';
          const activeLayers = activeLayersRef.current || [];
          const activeMarineLayer = activeLayers.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
          // EURO has a global (estimated) product for ALL marine components, so reject a
          // regional EURO grid when zoomed out instead of rendering a clamped rectangle.
          const isGlobalSupported = (activeModel === 'GFS' || activeModel === 'ICON' || activeModel === 'EURO');
          
          if (viewportBounds) {
            const ew = viewportBounds[0], ee = viewportBounds[2], es = viewportBounds[1], en = viewportBounds[3];
            const overlapWidth = getLongitudinalOverlap(ew, ee, gw, ge);
            const intSouth = Math.max(es, gs);
            const intNorth = Math.min(en, gn);
            
            let overlapRatio = 0;
            if (overlapWidth > 0 && intSouth < intNorth) {
              const intersectionArea = overlapWidth * (intNorth - intSouth);
              const vpWidth = (ee < ew) ? (ee + 360) - ew : ee - ew;
              const viewportArea = vpWidth * (en - es);
              if (viewportArea > 0) {
                overlapRatio = intersectionArea / viewportArea;
              }
            }
            const vpWidth = (ee < ew) ? (ee + 360) - ew : ee - ew;
            const vpHeight = en - es;

            const currentZoom = map.getZoom();
            const isViewportZoomedOut = (currentZoom <= MARINE_ZOOMED_OUT_MAX_ZOOM) || (vpWidth > 15.0 || vpHeight > 15.0);

            const isGridRegional = gridWidth < 340.0;
            let isContained = true;
            if (isGridRegional) {
              let vWest = ew;
              let vEast = ee;
              if (vEast < vWest) vEast += 360;

              let gWest = gw;
              let gEast = ge;
              if (gEast < gWest) gEast += 360;

              isContained = es >= gs && en <= gn && vWest >= gWest && vEast <= gEast;
            }

            let shouldReject = false;
            if (isGridRegional) {
              // COVERAGE-ALIGNED GATE (2026-07-05, CA-coast z7.14↔6.99 report): a regional that COVERS the
              // viewport (overlapRatio ≥ __RAW_DOWNGRADE_COVER_FRAC__, the SAME lever the engine no-downgrade
              // guard uses to KEEP it resident) must RENDER even below z7 — else the gate hides a 100%-
              // covering regional the guard deliberately kept, so crossing z7.0 flips the SAME fine grid from
              // shown (fine heatmap + crests) to a faded coarse wash with no crests (the two subsystems
              // disagreed: guard=coverage, gate=zoom). Only a NON-covering regional (a sub-viewport clamped
              // tile / genuine zoom-out) is rejected → the coarse bridge/global takes over. The uncovered ≤20%
              // ring shows the blend coarse wash either way. Kill (revert to the old zoom-based hide):
              // window.__RAW_DISABLE_ZOOMOUT_REGIONAL_COVER__ = true.
              // DEFAULT 0.6 = the engine guard's own value (2026-07-16 re-apply of fdc54a7f, this time
              // BUNDLED with the data-bridge motion promotion): guard keeps ≥0.6, gate shows ≥0.6, bridge
              // promotes <0.6 — no coverage band is resident-but-hidden (the settled mid-band dead-band).
              // The 07-16 solo attempt was reverted (b21cf29d) because WITHOUT the promotion the 0.6-0.8
              // band rendered a partial regional over a blank/damped background mid-gesture (the "motion
              // rectangle"); with the coarse promoted under it the partial regional sits over a full
              // coarse field (cross-fade, not a floating rectangle). Live-tune: __RAW_DOWNGRADE_COVER_FRAC__.
              const _coverFrac = (typeof window !== 'undefined' && Number(window.__RAW_DOWNGRADE_COVER_FRAC__)) || 0.6;
              const _coverAlignOff = (typeof window !== 'undefined' && window.__RAW_DISABLE_ZOOMOUT_REGIONAL_COVER__ === true);
              const _zoomedOutRegionalReject = _coverAlignOff
                ? (!isContained || gridWidth < 340.0 || overlapRatio < 0.15)
                : (overlapRatio < _coverFrac);
              shouldReject = isGlobalSupported
                ? (isViewportZoomedOut ? _zoomedOutRegionalReject : (overlapWidth <= 0 || intSouth >= intNorth))
                : (overlapWidth <= 0 || intSouth >= intNorth);

              const g = engine._waveData?.waveGrid;
              const canBypassRegionalRejection = !isViewportZoomedOut || !isGlobalSupported;
              if (g && (g.__isAcceptableRegional || gridWidth < 340.0) && canBypassRegionalRejection) {
                // If it is NOT global supported, we don't require containment to avoid culling the regional grid when zoomed out.
                shouldReject = isGlobalSupported
                  ? (isViewportZoomedOut ? (!isContained || overlapWidth <= 0 || intSouth >= intNorth) : (overlapWidth <= 0 || intSouth >= intNorth))
                  : (overlapWidth <= 0 || intSouth >= intNorth);
              }
            } else {
              shouldReject = (overlapWidth <= 0 || intSouth >= intNorth);
            }

            if (shouldReject) {
              const isTransitioning = typeof window !== 'undefined' && (!!window.__MARINE_TRANSITIONING__ || !!window.__MARINE_FETCH_PENDING__ || !!window.__MARINE_FETCH_DEBOUNCING__);
              const isZoomingOrMoving = map.isZooming() || map.isMoving() || window.isScrubbingTimeline || isTransitioning;
              // COARSE-BASE BRIDGE (2026-07-04, the z8.84↔z6.32 zoom-out clear): a resident REGIONAL grid is
              // hidden at z<7 (op 0) while the global-coarse commits at moveend — a ~1s blank. When the retained
              // coarse-global base (BLEND BOTH) is still held, keep rendering so the engine paints that base wash
              // under the hidden regional instead of blanking. The regional heatmap + crests stay dark (mult 0),
              // so no clamped-rectangle regression — the viewport degrades gracefully to the coarse global field
              // until the real global commits and supersedes it. Kill: __RAW_DISABLE_COARSE_BRIDGE__.
              const hasCoarseBridge = !!(engine._coarseBaseData && engine._coarseBaseData.u_waveTexture) &&
                (typeof window === 'undefined' || window.__RAW_DISABLE_COARSE_BRIDGE__ !== true);
              if (isViewportZoomedOut && isGridRegional && hasCoarseBridge) {
                opacityMultiplier = 0.0;
                engine.__coarseBridgeActive = true;
              } else if (!isZoomingOrMoving) {
                this._wasActive = false;
                return;
              } else if (isViewportZoomedOut && isGridRegional) {
                opacityMultiplier = 0.0;
              } else {
                // Calculate fade out during zoom transition or low overlap
                let zoomFade = 1.0;
                if (currentZoom <= 6.5) {
                  zoomFade = Math.max(0.0, Math.min(1.0, (currentZoom - 5.5) / (6.5 - 5.5)));
                }
                let overlapFade = 1.0;
                if (overlapRatio < 0.15) {
                  overlapFade = Math.max(0.0, Math.min(1.0, (overlapRatio - 0.05) / (0.15 - 0.05)));
                }
                opacityMultiplier = Math.min(zoomFade, overlapFade);
              }
            }
          } else {
            const currentZoom = map.getZoom();
            const isTransitioning = typeof window !== 'undefined' && (!!window.__MARINE_TRANSITIONING__ || !!window.__MARINE_FETCH_PENDING__ || !!window.__MARINE_FETCH_DEBOUNCING__);
            const isZoomingOrMoving = map.isZooming() || map.isMoving() || window.isScrubbingTimeline || isTransitioning;
            if (currentZoom <= MARINE_ZOOMED_OUT_MAX_ZOOM && isGlobalSupported && gridWidth < 340.0) {
              if (!isZoomingOrMoving) {
                this._wasActive = false;
                return;
              }
              opacityMultiplier = Math.max(0.0, Math.min(1.0, (currentZoom - 5.5) / (6.5 - 5.5)));
            }
          }
        }
      }

      try {
        const canvas = map.getCanvas();
        const zoom = map.getZoom();

        engine.render(_gl, _matrix, canvas.width, canvas.height, zoom, themeRef.current, viewportBounds, opacityMultiplier);
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

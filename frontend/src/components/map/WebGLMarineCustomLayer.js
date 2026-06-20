import { registerMarineEngine } from '../../engine/RenderPlanDispatcher';

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
        if (dataRef.current?.vectors?.length) {
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
          engine.clearBuffers(_gl);
          this._wasActive = false;
        }
        return;
      }

      this._wasActive = true;
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
            const isViewportZoomedOut = (currentZoom <= 6.5) || (vpWidth > 15.0 || vpHeight > 15.0);

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
              shouldReject = isGlobalSupported
                ? (isViewportZoomedOut ? (!isContained || gridWidth < 340.0 || overlapRatio < 0.15) : (overlapWidth <= 0 || intSouth >= intNorth))
                : (overlapWidth <= 0 || intSouth >= intNorth);

              const g = engine._waveData?.waveGrid;
              const canBypassRegionalRejection = !isViewportZoomedOut || !isGlobalSupported;
              if (g && (g.__isAcceptableRegional || gridWidth < 340.0) && canBypassRegionalRejection) {
                // If it is NOT global supported, we don't require containment to avoid culling the regional grid when zoomed out.
                shouldReject = isGlobalSupported
                  ? (!isContained || (overlapWidth <= 0 || intSouth >= intNorth))
                  : (overlapWidth <= 0 || intSouth >= intNorth);
              }
            } else {
              shouldReject = (overlapWidth <= 0 || intSouth >= intNorth);
            }

            if (shouldReject) {
              const isTransitioning = typeof window !== 'undefined' && (!!window.__MARINE_TRANSITIONING__ || !!window.__MARINE_FETCH_PENDING__ || !!window.__MARINE_FETCH_DEBOUNCING__);
              const isZoomingOrMoving = map.isZooming() || map.isMoving() || window.isScrubbingTimeline || isTransitioning;
              if (!isZoomingOrMoving) {
                this._wasActive = false;
                return;
              }
              if (isViewportZoomedOut && isGridRegional) {
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
            if (currentZoom <= 6.5 && isGlobalSupported && gridWidth < 340.0) {
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

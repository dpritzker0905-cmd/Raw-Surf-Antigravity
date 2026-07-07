/**
 * WebGLMarineLayer.js
 * React wrapper bridging WebGLMarineEngine to MapLibre's CustomLayerInterface.
 * Receives evolved wave field data from RenderPlanDispatcher.
 * Added once as a MapLibre custom layer — no stacking decisions.
 */
import { memo, useEffect, useRef, useState } from 'react';
import WebGLMarineEngine from './WebGLMarineEngine';
import { registerMarineEngine, unregisterMarineEngine, updateMarineTruthTrace } from '../../engine/RenderPlanDispatcher';
import { isInCooldown, findClosestHourIndex } from './marineControllerUtils';
import { MARINE_ZOOMED_OUT_MAX_ZOOM } from './marineZoomThresholds';
import { getMarineParticleRes } from './deviceTier';
import { getMarineHourlyCache, getBackendWeatherFlag, getBackendCopernicusFlag, getBackendIconMarineFlag, getModelSafeMarine, prewarmZoomOutMarineGrid } from './marineController';
import { getSharedLandGeoJSON, getSharedLandGeoJSONHiRes, safeMoveLayer } from './mapUtils';
import { recordClear, shouldHoldClearOnDeactivate } from './marineTransitionCoordinator';
import { updateWebGLMarineLayerDiag, computeVectorDiffAndLog } from './WebGLMarineLayerDiag';
import { isBasemapWaterSourceReady } from './WebGLMarineMaskRenderer';
import { desiredMaskRes, HIRES_MASK_EXIT_ZOOM } from './maskSmoothing';
import { createCustomLayer, LAYER_ID } from './WebGLMarineCustomLayer';

// createCustomLayer and getLongitudinalOverlap helper functions are imported from WebGLMarineCustomLayer.js

// memo (2026-07-07, chip task_c5366c79 slice 2): re-rendered on every radar frame step with
// unchanged props (MapWebGL re-renders on radarFrameIndex). All props are primitives or stable
// memo outputs once the caller hoists onError (MapWebGL useCallback); ref syncs inside only
// carry prop VALUES, so skipping renders with equal props is behavior-identical.
function WebGLMarineLayerInner({ mapInstance, active, data, revision, onAddedChange, onError, beforeId, theme, activeLayers, activeModel = 'GFS', timeOffsetHours = 0 }) {
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
  const activeModelRef = useRef(activeModel);
  const timeOffsetHoursRef = useRef(timeOffsetHours);
  const safeUploadRef = useRef(null);
  const lastUploadedSignatureRef = useRef('');
  const lastUploadedGridRef = useRef({
    activeModel: '',
    activeMarineLayer: '',
    gridProvider: '',
    componentLayer: '',
    boundsStr: '',
    cols: 0,
    rows: 0,
    vectorsLength: 0,
    nonzeroCount: 0,
    contentHash: 0,
    timestamp: 0,
    renderedDataHour: null
  });
  const scrubUploadTimeoutRef = useRef(null);

  const [landGeoJSON, setLandGeoJSON] = useState(null);
  const landGeoJSONRef = useRef(null);
  const landGeoJSONFailedRef = useRef(false);
  // High-zoom land-mask refinement state: which mask resolution the engine currently reflects
  // ('standard' = 50m default, 'hires' = 10m), and a stable handle to the evaluator.
  const maskResRef = useRef('standard');
  const evaluateMaskRef = useRef(null);

  useEffect(() => {
    activeRef.current = active;
    mapRef.current = mapInstance;
    onAddedChangeRef.current = onAddedChange;
    onErrorRef.current = onError;
    dataRef.current = data;
    themeRef.current = theme;
    beforeIdRef.current = beforeId;
    activeLayersRef.current = activeLayers;
    activeModelRef.current = activeModel;
    timeOffsetHoursRef.current = timeOffsetHours;
  }, [active, mapInstance, onAddedChange, onError, data, theme, beforeId, activeLayers, activeModel, timeOffsetHours]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const requestedHour = timeOffsetHours;
    const lastSig = lastUploadedGridRef.current;
    
    const renderedDataHour = lastSig.vectorsLength > 0 ? lastSig.renderedDataHour : null;
    const parity = active && renderedDataHour !== null && requestedHour === renderedDataHour;
    
    let reason = 'parity_match';
    if (!active) {
      reason = 'layer_inactive';
    } else if (renderedDataHour === null) {
      reason = 'no_data_rendered';
    } else if (!parity) {
      let coverageMissing = false;
      const isGfsBackend = getBackendWeatherFlag() && (activeModel === 'GFS' || !activeModel);
      const isIconBackend = getBackendIconMarineFlag() && activeModel === 'ICON';
      const isCopernicusBackend = getBackendCopernicusFlag() && activeModel === 'EURO';
      const isBackendActive = isGfsBackend || isIconBackend || isCopernicusBackend;

      if (isBackendActive) {
        const curLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
        let vpBounds = null;
        if (mapInstance) {
          try {
            const b = mapInstance.getBounds();
            vpBounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
          } catch (e) {
            vpBounds = null;
          }
        }
        const cached = getModelSafeMarine(activeModel, requestedHour, curLayer, vpBounds);
        if (!cached || cached.__staleHour || cached.__failureReason || cached.grid?.__failureReason) {
          coverageMissing = true;
        }
      } else {
        const cache = getMarineHourlyCache ? getMarineHourlyCache() : null;
        if (cache?.results?.length) {
          const timeArray = cache.results[0]?.hourly?.time;
          const targetMs = Date.now() + requestedHour * 3600000;
          const idx = timeArray ? findClosestHourIndex(timeArray, targetMs) : 0;
          if (timeArray?.[idx]) {
            const cachedMs = new Date(timeArray[idx].endsWith('Z') ? timeArray[idx] : timeArray[idx] + 'Z').getTime();
            if (Math.abs(cachedMs - targetMs) > 3 * 3600000) {
              coverageMissing = true;
            }
          } else {
            coverageMissing = true;
          }
        } else {
          coverageMissing = true;
        }
      }

      if (coverageMissing) {
        reason = 'coverageMissing';
      } else if (isInCooldown('marine')) {
        reason = 'cooldownActive';
      } else {
        reason = 'retained_previous';
      }
    }
    
    window.__MARINE_RENDER_HOUR_PARITY__ = {
      requestedHour,
      renderedDataHour,
      parity,
      reason
    };

    if (active && !parity) {
      let statusValue = 'retained_previous_hour';
      if (reason === 'cooldownActive') {
        statusValue = 'rate_limited_cached';
      } else if (reason === 'coverageMissing') {
        statusValue = activeModel === 'EURO' ? 'no_copernicus_coverage' : 'no_backend_coverage';
      }
      window.__MARINE_HEATMAP_STATUS__ = {
        status: statusValue,
        model: activeModel,
        layer: activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves',
        hour: requestedHour,
        renderedHour: renderedDataHour,
        retainedPrevious: true
      };
    } else if (active && parity) {
      if (window.__MARINE_HEATMAP_STATUS__?.status === 'retained_previous_hour' ||
          window.__MARINE_HEATMAP_STATUS__?.status === 'no_copernicus_coverage' ||
          window.__MARINE_HEATMAP_STATUS__?.status === 'no_backend_coverage') {
        window.__MARINE_HEATMAP_STATUS__ = null;
      }
    }
  }, [timeOffsetHours, revision, active, activeModel]);

  const runDiagnosticsUpdate = (rejectionOrClearReason = null) => {
    updateWebGLMarineLayerDiag(
      engineRef.current,
      activeModelRef.current,
      activeLayersRef.current,
      timeOffsetHoursRef.current,
      lastUploadedGridRef.current
    );
  };

  const safeUploadWaveData = (reason, gl, grid, geojson) => {
    if (!engineRef.current || !gl || !grid || !grid.vectors?.length) return;
    const engine = engineRef.current;

    if (typeof window !== 'undefined') {
      window.__WEBGL_MARINE_THEME__ = themeRef.current || 'default';
      const z = mapRef.current ? mapRef.current.getZoom() : 6;
      let opacity = 0.65;
      if (z <= 2) opacity = 0.55;
      else if (z <= 5) opacity = 0.55 + (z - 2) / 3 * 0.10;
      else if (z <= 8) opacity = 0.65 + (z - 5) / 3 * 0.10;
      else if (z <= 12) opacity = 0.75 + (z - 8) / 4 * 0.05;
      else opacity = 0.85;
      window.__WEBGL_MARINE_OPACITY__ = opacity;
    }

    const gridModel = grid.__sourceModel || activeModelRef.current;
    const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
    const gridProvider = grid.grid?.__gridProvider || grid.__gridProvider || 'none';
    const componentLayer = grid.grid?.__componentLayer || grid.__componentLayer || 'none';
    const actualBounds = grid.grid?.bounds || grid.bounds;
    const boundsStr = actualBounds ? `${actualBounds.west.toFixed(2)}:${actualBounds.south.toFixed(2)}:${actualBounds.east.toFixed(2)}:${actualBounds.north.toFixed(2)}` : 'none';


    const geojsonSig = geojson ? `land_${geojson.features?.length || 0}` : 'no_land';
    const themeSig = themeRef.current || 'default_style';
    const uploadSigResidency = `${gridModel}_${componentLayer}_${gridProvider}_${grid.vectors.length}_geo_${geojsonSig}_thm_${themeSig}`;
    const alreadyResident = !!engine._waveData;

    const requestedHour = timeOffsetHoursRef.current;
    const renderedDataHour = grid.hourOffset !== undefined ? grid.hourOffset : (grid.grid?.hourOffset !== undefined ? grid.grid.hourOffset : null);

    const diffResult = computeVectorDiffAndLog({
      grid,
      prev: lastUploadedGridRef.current,
      activeModel: gridModel,
      activeLayers: activeLayersRef.current,
      timeOffsetHours: requestedHour,
      gridProvider,
      componentLayer,
      boundsStr,
      geojsonSig,
      themeSig,
      uploadSigResidency,
      alreadyResident,
      activeML: activeMarineLayer
    });

    if (diffResult.shouldSkip) {
      if (diffResult.skipReason === 'skipped_identical_content_across_hours') {
        console.log(`[WebGLMarine] Skip upload for hour +${requestedHour}h: content is mathematically identical to hour +${lastUploadedGridRef.current.renderedDataHour}h`);
      }
      if (!window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__) window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__ = 0;
      window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__++;
      if (window.__MARINE_PIPELINE_TRUTH__?.counters) {
        window.__MARINE_PIPELINE_TRUTH__.counters.duplicateUploadSkipped = window.__WEBGL_MARINE_DUP_UPLOAD_SKIP__;
      }
      window.__WEBGL_MARINE_UPLOAD_REASON__ = diffResult.skipReason;
      runDiagnosticsUpdate(diffResult.skipReason);
      return;
    }

    window.__WEBGL_MARINE_UPLOAD_REASON__ = reason;

    if (grid.__maxHeight === undefined) {
      let maxS = 0, sumS = 0, cnt = 0;
      for (const vec of grid.vectors) {
        if (vec && vec.speed > 0) { cnt++; sumS += vec.speed; if (vec.speed > maxS) maxS = vec.speed; }
      }
      grid.__maxHeight = maxS;
      grid.__meanHeight = cnt > 0 ? sumS / cnt : 0;
    }
    const maxS = grid.__maxHeight;
    const meanHeight = grid.__meanHeight;
    console.log(`[WebGLMarine] setWaveData (${reason}): ${grid.vectors.length} vectors, max=${maxS.toFixed(2)}m (forecast-authoritative)`);

    const uploadStart = Date.now();
    // ITEM ① RETAIN-PATCHED stamp (2026-07-05, live-confirmed glitch: {result:false,
    // branch:'source_not_ready', maskMode:'rebuild'} @z7.66): tell the encoder whether the
    // basemap-water source is queryable RIGHT NOW and whether the current viewport sits fully
    // inside the resident patched mask's bounds. When a mask REBUILD would land while the source
    // is mid-load, the trailing re-patch is guaranteed to no-op and one PATCH-LESS frame renders
    // (the Long Beach idle glitch-cycle) — the encoder instead retains the patched texture for
    // that commit (see WebGLMarineTextureEncoder). Stamped fresh EVERY commit; undefined fails
    // open to the old rebuild path (other setWaveData callers).
    try {
      const _srcReady = isBasemapWaterSourceReady(mapInstance);
      engine._maskSourceReady = _srcReady;
      let _retainOk = false;
      if (!_srcReady && engine._cachedMaskTex && engine._cachedMaskBounds && mapInstance) {
        const _mb = mapInstance.getBounds();
        const _cb = engine._cachedMaskBounds;
        _retainOk = _mb.getWest() >= _cb.west - 0.05 && _mb.getEast() <= _cb.east + 0.05 &&
                    _mb.getSouth() >= _cb.south - 0.05 && _mb.getNorth() <= _cb.north + 0.05;
      }
      engine._maskRetainPatchedOk = _retainOk;
    } catch (e) {
      engine._maskSourceReady = true; // fail open — old behavior
      engine._maskRetainPatchedOk = false;
    }
    engine._dispatcherActive = false;
    try {
      engine.setWaveData(gl, grid, geojson);
    } catch (err) {
      console.error('[WebGLMarine] Texture encoding failed:', err.message);
      if (window.__WEATHER_TELEMETRY__) {
        window.__WEATHER_TELEMETRY__.trackTextureEncodingError(gridModel, activeMarineLayer, requestedHour, err.message);
      }
      lastUploadedSignatureRef.current = '';
      runDiagnosticsUpdate('upload_failed');
      return;
    }
    const uploadElapsed = Date.now() - uploadStart;

    updateMarineTruthTrace('upload', grid, activeModelRef.current, activeMarineLayer, timeOffsetHoursRef.current, 'forecast_direct', null, true);

    lastUploadedSignatureRef.current = uploadSigResidency;
    lastUploadedGridRef.current = {
      activeModel: gridModel,
      activeMarineLayer: activeMarineLayer,
      gridProvider: gridProvider,
      componentLayer: componentLayer,
      boundsStr: boundsStr,
      cols: grid.cols,
      rows: grid.rows,
      vectorsLength: grid.vectors.length,
      nonzeroCount: diffResult.nonzeroCount,
      contentHash: diffResult.contentHash,
      timestamp: grid.timestamp || revision || 0,
      renderedDataHour: renderedDataHour,
      geojsonSig: geojsonSig,
      themeSig: themeSig,
      uploadSig: uploadSigResidency,
      samples: diffResult.currSamples
    };

    if (!window.__WEBGL_MARINE_UPLOAD_COUNT__) window.__WEBGL_MARINE_UPLOAD_COUNT__ = 0;
    window.__WEBGL_MARINE_UPLOAD_COUNT__++;

    if (window.__MARINE_PIPELINE_TRUTH__) {
      window.__MARINE_PIPELINE_TRUTH__.webglUploads = window.__WEBGL_MARINE_UPLOAD_COUNT__;
      if (window.__MARINE_PIPELINE_TRUTH__.counters) {
        window.__MARINE_PIPELINE_TRUTH__.counters.webglUploads = window.__WEBGL_MARINE_UPLOAD_COUNT__;
      }
    }

    window.__WEBGL_MARINE_UPLOAD_DIAG__ = {
      uploadCount: window.__WEBGL_MARINE_UPLOAD_COUNT__,
      uploadSignature: uploadSigResidency,
      activeModel: activeModelRef.current, activeLayer: activeMarineLayer,
      timeOffsetHours: timeOffsetHoursRef.current, provider: grid?.__provider || 'none',
      gridProvider, sourceModel: gridModel, componentLayer,
      vectorCount: grid.vectors.length, nonzeroCount: diffResult.nonzeroCount, renderAccepted: true,
      rejectionReason: null, elapsedMs: uploadElapsed,
      timestamp: new Date().toISOString()
    };

    window.__MARINE_RENDER_SOURCE_DIAG__ = {
      sourcePath: 'direct_mapwebgl',
      heatmapProvider: gridProvider,
      gridProvider,
      sourceModel: gridModel,
      componentLayer,
      activeModel: activeModelRef.current,
      activeLayer: activeMarineLayer,
      timeOffsetHours: timeOffsetHoursRef.current,
      bounds: actualBounds ? { ...actualBounds } : null,
      cols: grid.cols,
      rows: grid.rows,
      vectorCount: grid.vectors.length,
      nonzeroCount: diffResult.nonzeroCount,
      maxHeight: maxS,
      meanHeight: meanHeight,
      timestamp: new Date().toISOString()
    };

    runDiagnosticsUpdate('upload_success');

    // BASEMAP-WATER TRUTH re-apply (2026-07-04, the Venice regression of the Gull-Park fix): a
    // commit re-encodes the mask WITHOUT the basemap overlay, and backstop/sharpen commits arrive
    // with NO map event and NO React revision bump — so the idle/zoomend/revision triggers never
    // re-applied it and the NE-only mask (which lacks Venice/Lido entirely) stayed resident.
    // safeUploadWaveData is the one wrapper EVERY upload path funnels through, so re-apply here.
    try {
      let _z;
      try { _z = mapInstance.getZoom(); } catch (e) { _z = 0; }
      const _engine = engineRef.current;
      // Gate 7→6 (2026-07-07, "heatmap moves into the intracoastal at z6-7 until it heals"):
      // between z6 and z7 the resident mask is the NE-only mid tier (no lagoon/bay detail) and
      // NOTHING carved it — the patch was z≥7-gated on both call sites, so the flood persisted
      // until a threshold crossing. Basemap water truth at z6 is coarser but strictly better
      // than NE-only. SPAN GATE (same-day: "very choppy and slow to zoom"): repainting basemap
      // water onto a WIDE mask canvas is 100-250ms of main thread per commit — during zoom
      // transitions the resident mask can be mid/world-span, where the repaint is both heavy
      // and visually useless. Only patch masks that can hold the detail (span ≤ 16°).
      const _ms = _engine && _engine._cachedMaskBounds
        ? ((_engine._cachedMaskBounds.east < _engine._cachedMaskBounds.west ? _engine._cachedMaskBounds.east + 360 : _engine._cachedMaskBounds.east) - _engine._cachedMaskBounds.west)
        : 999;
      if (_z >= 6 && _ms <= 16 && _engine && _engine.refreshMaskWithBasemapWater) {
        const _repatched = _engine.refreshMaskWithBasemapWater(gl, mapInstance);
        if (_repatched) mapInstance.triggerRepaint();
        // DIAG (item ① Long Beach idle glitch-cycle, 2026-07-04): every recommit re-encodes the
        // mask patch-less in setWaveData, then re-patches here. If this re-patch NO-OPs, the
        // patch-less mask renders (piers/canals animate) until the idle listener re-drives. Record
        // reason+branch so an idle sit reveals WHICH branch no-ops. Read window.__RAW_MASK_REPATCH_LOG__.
        if (typeof window !== 'undefined') {
          try {
            const _log = (window.__RAW_MASK_REPATCH_LOG__ = window.__RAW_MASK_REPATCH_LOG__ || []);
            // maskMode distinguishes the HARMLESS no-op (reuse: patched tex retained) from the GLITCH
            // (rebuild: patch-less tex bound). A confirmed item-① firing = {result:false,
            // branch:'source_not_ready', maskMode:'rebuild'}.
            const _maskMode = _engine._lastMaskEncodeMode || null;
            _log.push({ reason, z: +Number(_z).toFixed(2), result: _repatched,
              branch: _engine._lastMaskRepatchReason || null, maskMode: _maskMode, t: new Date().toISOString() });
            if (_log.length > 80) _log.shift();
            if (!_repatched) {
              window.__RAW_MASK_REPATCH_NOOP_COUNT__ = (window.__RAW_MASK_REPATCH_NOOP_COUNT__ || 0) + 1;
              if (_maskMode === 'rebuild') {
                window.__RAW_MASK_GLITCH_COUNT__ = (window.__RAW_MASK_GLITCH_COUNT__ || 0) + 1;
              }
            }
          } catch (_e) { /* diag only */ }
        }
      }
    } catch (e) { /* mask overlay is an enhancement — never fail an upload over it */ }
  };

  safeUploadRef.current = safeUploadWaveData;

  useEffect(() => {
    let activeFetch = true;
    landGeoJSONFailedRef.current = false;

    getSharedLandGeoJSON()
      .then(geojson => {
        if (geojson && activeFetch) {
          setLandGeoJSON(geojson);
          landGeoJSONRef.current = geojson;
          
          const engine = engineRef.current;
          const gl = glRef.current || mapInstance?.painter?.context?.gl;
          if (engine && gl) {
            engine._landGeoJSON = geojson;
            if (dataRef.current?.vectors?.length) {
              if (safeUploadRef.current) {
                safeUploadRef.current('land_mask_upgrade', gl, dataRef.current, geojson);
              } else {
                try {
                  window.__WEBGL_MARINE_UPLOAD_REASON__ = 'land_mask_upgrade';
                  engine._dispatcherActive = false;
                  engine.setWaveData(gl, dataRef.current, geojson);
                } catch (err) {
                  console.error('[WebGLMarine] Texture encoding failed:', err.message);
                  if (window.__WEATHER_TELEMETRY__) {
                    const gridModel = dataRef.current?.__sourceModel || activeModelRef.current;
                    const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
                    const requestedHour = timeOffsetHoursRef.current;
                    window.__WEATHER_TELEMETRY__.trackTextureEncodingError(gridModel, activeMarineLayer, requestedHour, err.message);
                  }
                }
              }
              if (mapInstance) mapInstance.triggerRepaint();
            }
          }
          if (mapInstance) {
            mapInstance.triggerRepaint();
          }
        }
      })
      .catch(err => {
        console.warn('[WebGLMarineLayer] Failed to load land GeoJSON:', err);
      });
    return () => { activeFetch = false; };
  }, [mapInstance]);

  // ── High-zoom land-mask refinement ──────────────────────────────────────────────
  // Bug: the wave heatmap bleeds over land at z12+ because the engine masks land with the 50m
  // GeoJSON, which is too coarse to follow barrier islands / thin coastline. When a marine layer is
  // zoomed past the threshold we lazily swap in the 10m mask and re-encode; below the threshold we
  // revert to 50m so the global mask render stays cheap (it iterates ALL land features). The 10m
  // swap re-uploads because geojsonSig (land_<featureCount>) differs → no duplicate-upload skip.
  // Isolated from the fetch/commit pipeline — worst case is a coarser mask, never a wedge.
  // Kill switch: window.__MARINE_HIRES_MASK__ === false.
  // Lowered 11→9 (2026-06-29): waves bled over barrier islands/thin coast at "somewhat close" zooms (z9-z11)
  // where the coarse 50m mask still simplifies the coastline. Lowered 9→8 (2026-07-02): the user reported crests
  // "partially over land, in a grid" at z8.39 — below the old threshold the 50m mask still simplified the FL
  // barrier islands while the regional 13×13 tile was (correctly) resident. The regional mask canvas is now
  // 2048×1024 (WebGLMarineMaskRenderer), fine enough for the 10m polygons to pay off from z8. Kill switch
  // unchanged: window.__MARINE_HIRES_MASK__=false.
  // HYSTERESIS (2026-07-06, rapid-zoom churn): enter hires at z≥8, exit below z7.3 — a single
  // threshold fired a full land_mask_res_swap re-upload per gesture when zoom cycling straddled
  // z8 (see desiredMaskRes in maskSmoothing.js).
  useEffect(() => {
    if (!mapInstance) return;

    const reuploadMask = (geojson) => {
      const engine = engineRef.current;
      const gl = glRef.current || mapInstance?.painter?.context?.gl;
      if (!engine || !gl || !geojson) return;
      landGeoJSONRef.current = geojson;
      engine._landGeoJSON = geojson;
      if (dataRef.current?.vectors?.length && safeUploadRef.current) {
        safeUploadRef.current('land_mask_res_swap', gl, dataRef.current, geojson);
        mapInstance.triggerRepaint();
      }
    };

    const evaluate = () => {
      // Only meaningful when a marine layer is active and there is data to re-encode.
      if (!activeRef.current || !dataRef.current?.vectors?.length) return;
      const hiresAllowed = typeof window === 'undefined' || window.__MARINE_HIRES_MASK__ !== false;
      let z;
      try { z = mapInstance.getZoom(); } catch (e) { return; }
      const desired = desiredMaskRes(z, maskResRef.current, hiresAllowed);
      if (desired === maskResRef.current) return;

      if (desired === 'hires') {
        getSharedLandGeoJSONHiRes()
          .then(geojson => {
            if (!geojson) return;
            // The 10m fetch can be slow (~18 MB on first load) — re-check the user is still zoomed in
            // (EXIT threshold: while the fetch ran we were logically in hires; only a real exit reverts).
            let zNow;
            try { zNow = mapInstance.getZoom(); } catch (e) { return; }
            if (window.__MARINE_HIRES_MASK__ === false || zNow < HIRES_MASK_EXIT_ZOOM) return;
            if (!activeRef.current) return;
            maskResRef.current = 'hires';
            reuploadMask(geojson);
          })
          .catch(() => { /* CDN unavailable → keep the 50m mask (still functional) */ });
      } else {
        getSharedLandGeoJSON()
          .then(geojson => {
            if (!geojson || maskResRef.current === 'standard') return;
            maskResRef.current = 'standard';
            reuploadMask(geojson);
          })
          .catch(() => { /* no-op: 50m already resident */ });
      }
    };

    evaluateMaskRef.current = evaluate;
    mapInstance.on('zoomend', evaluate);
    return () => {
      evaluateMaskRef.current = null;
      try { mapInstance.off('zoomend', evaluate); } catch (e) { /* map gone */ }
    };
  }, [mapInstance]);

  // Re-evaluate the mask resolution when the layer activates or new data commits while already
  // zoomed in (a pure zoom event would otherwise be the only trigger). Idempotent + cheap: a no-op
  // when the resolution already matches the zoom, so scrub-rate revision changes don't thrash.
  useEffect(() => {
    if (evaluateMaskRef.current) evaluateMaskRef.current();
  }, [active, revision, mapInstance]);

  // BASEMAP-WATER TRUTH refresh (2026-07-04): at z>=9 repaint the resident mask from the basemap's
  // own water polygons inside the viewport (port landfill / piers / canals — detail no Natural
  // Earth dataset carries; the "Gull Park under water" class). Throttled on moveend/zoomend and
  // re-applied after commits (a fresh commit re-encodes the mask WITHOUT the overlay).
  const basemapMaskThrottleRef = useRef(0);
  useEffect(() => {
    if (!mapInstance) return;
    // PATH-AWARE zoom gate (2026-07-07, the z5 "halo keeps trying to heal / only zooming back
    // in heals it" + "heatmap on islands"): the WIDE-mask path (span ≥30 → viewport overlay,
    // fixed screen-res paint) must refresh down to the texel-visibility floor z≥4.4 — the
    // world-grid regime lives BELOW the old z≥7 gate, so its only crisp-truth mechanism never
    // ran exactly where it was needed. The narrow path (base-mask repaint, span-dependent cost)
    // keeps z≥6 (aligned with the commit-time sites).
    const refresh = () => {
      if (!activeRef.current) return;
      let z;
      try { z = mapInstance.getZoom(); } catch (e) { return; }
      const engine = engineRef.current;
      const gl = glRef.current || mapInstance?.painter?.context?.gl;
      const _rmb = engine && engine._cachedMaskBounds;
      const _rms = _rmb ? ((_rmb.east < _rmb.west ? _rmb.east + 360 : _rmb.east) - _rmb.west) : 0;
      if (z < (_rms >= 30 ? 4.4 : 6)) return;
      const now = Date.now();
      if (now - basemapMaskThrottleRef.current < 700) return;
      if (engine && gl && engine.refreshMaskWithBasemapWater) {
        // Consume the throttle ONLY when a paint actually happened (2026-07-04, "rectangle
        // holes"): a moveend attempt that the tile-readiness gate (or hysteresis) skipped used to
        // eat the window and starve the `idle` refresh that would have painted real truth —
        // missing-tile rectangles then persisted until the next gesture. Skipped attempts are
        // cheap (bounds math only), so leaving the window open costs nothing.
        if (engine.refreshMaskWithBasemapWater(gl, mapInstance)) {
          basemapMaskThrottleRef.current = now;
          mapInstance.triggerRepaint();
        }
      }
    };
    // idle fires after moveend AND after tile loads settle — the water tiles we sample from are
    // guaranteed queryable there. moveend added too (2026-07-04): during a zoom-out sequence idle
    // can lag seconds behind each gesture, leaving the viewport OVERLAY mask pinned to the old
    // (smaller) view — land showed the world wash "for a while". The 700 ms throttle above keeps
    // repaint cost sane; a moveend that races tile parsing just paints the best truth available
    // and the following idle repaints it right.
    mapInstance.on('idle', refresh);
    mapInstance.on('zoomend', refresh);
    mapInstance.on('moveend', refresh);
    // SOURCEDATA re-drive (2026-07-05, the Florida "heatmap fills intracoastal/lakes initially"
    // report): the FIRST paint after a commit uses the NE-resolution mask (no lagoon/lake detail —
    // heatmap floods them) and `idle` can lag seconds during continuous interaction before the
    // basemap patch carves them out. Water tiles becoming queryable fire `sourcedata` immediately —
    // re-drive the SAME gated+throttled refresh there so the carve lands the moment truth exists,
    // not at the next idle. Skipped attempts stay cheap (the readiness gate runs before any canvas
    // work). Kill: __RAW_DISABLE_MASK_SOURCEDATA_REDRIVE__.
    // Pre-throttled to 250ms (the 5290f1e9 precedent: sourcedata fires at high frequency, and even
    // the "cheap" gate checks — getStyle().layers.find per event — add up during tile churn).
    let _lastSrcDataCheck = 0;
    const onSourceData = (e) => {
      if (typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_SOURCEDATA_REDRIVE__ === true) return;
      if (!e || !e.isSourceLoaded) return;
      const now = Date.now();
      if (now - _lastSrcDataCheck < 250) return;
      _lastSrcDataCheck = now;
      refresh();
    };
    mapInstance.on('sourcedata', onSourceData);
    // ZOOM-OUT ANTICIPATION (2026-07-05, the "~1s unclamp on fast zoom-out"): the moveend fetch only
    // starts AFTER the gesture — warm the ~2.5×-span grid the moment the gesture is clearly a
    // zoom-OUT (>0.4 drop from gesture start, one-shot per gesture), so the post-gesture lookup
    // serves it from cache via the containment fallback and the crest field expands near-instantly.
    let _zoStartZoom = null, _zoFired = false;
    const onZoomStart = () => { try { _zoStartZoom = mapInstance.getZoom(); _zoFired = false; } catch (e) {} };
    const onZoom = () => {
      if (_zoFired || _zoStartZoom == null || !activeRef.current) return;
      let z; try { z = mapInstance.getZoom(); } catch (e) { return; }
      if (_zoStartZoom - z > 0.4) {
        _zoFired = true;
        try {
          const b = mapInstance.getBounds();
          const vb = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
          const lyr = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
          prewarmZoomOutMarineGrid(activeModelRef.current, timeOffsetHoursRef.current, vb, lyr);
        } catch (e) { /* anticipation is best-effort */ }
      }
    };
    mapInstance.on('zoomstart', onZoomStart);
    mapInstance.on('zoom', onZoom);
    refresh();
    return () => {
      try { mapInstance.off('idle', refresh); mapInstance.off('zoomend', refresh); mapInstance.off('moveend', refresh); mapInstance.off('sourcedata', onSourceData); mapInstance.off('zoomstart', onZoomStart); mapInstance.off('zoom', onZoom); } catch (e) {}
    };
  }, [mapInstance]);

  // A fresh data commit re-encodes the mask without the basemap overlay — re-apply it.
  useEffect(() => {
    if (!mapInstance) return;
    basemapMaskThrottleRef.current = 0; // commits bypass the throttle
    const engine = engineRef.current;
    const gl = glRef.current || mapInstance?.painter?.context?.gl;
    let z;
    try { z = mapInstance.getZoom(); } catch (e) { return; }
    // Gate 7→6 + span ≤16° — see the safeUploadWaveData re-apply site for both notes.
    const _mb2 = engine && engine._cachedMaskBounds;
    const _ms2 = _mb2 ? ((_mb2.east < _mb2.west ? _mb2.east + 360 : _mb2.east) - _mb2.west) : 999;
    if (z >= 6 && _ms2 <= 16 && engine && gl && engine.refreshMaskWithBasemapWater) {
      if (engine.refreshMaskWithBasemapWater(gl, mapInstance)) mapInstance.triggerRepaint();
    }
  }, [revision, mapInstance]);

  useEffect(() => {
    if (!mapInstance) return;

    const engine = new WebGLMarineEngine();
    engineRef.current = engine;

    // Device-capability tier, NOT window width: a desktop with a momentarily narrow window used to
    // get the halved mobile pool here and keep it for the engine's lifetime (see deviceTier.js).
    engine.particleRes = getMarineParticleRes();

    const customLayer = createCustomLayer(engine, activeRef, mapRef, dataRef, glRef, onErrorRef, themeRef, landGeoJSONRef, landGeoJSONFailedRef, activeLayersRef, timeOffsetHoursRef, safeUploadRef, activeModelRef);

    const handleStyleData = () => {
      if (!mapInstance || !mapInstance.style) return;

      if (!mapInstance.getLayer(LAYER_ID)) {
        layerAddedRef.current = false;
        try {
          let targetBeforeId = beforeIdRef.current;
          if (!targetBeforeId) targetBeforeId = mapInstance.getLayer('ocean-mask-fill') ? 'ocean-mask-fill' : undefined;
          if (!targetBeforeId) targetBeforeId = mapInstance.getLayer('landuse') ? 'landuse' : undefined;

          mapInstance.addLayer(customLayer, targetBeforeId);
          layerAddedRef.current = true;
          if (onAddedChangeRef.current) onAddedChangeRef.current(true);
        } catch (e) {
          console.warn('[WebGLMarine-Forensic] Failed to add layer:', e.message);
        }
      } else {
        safeMoveLayer(mapInstance, LAYER_ID, beforeIdRef.current);
      }
    };

    mapInstance.on('styledata', handleStyleData);
    mapInstance.on('style.load', handleStyleData);
    handleStyleData();

    return () => {
      try {
        mapInstance.off('styledata', handleStyleData);
        mapInstance.off('style.load', handleStyleData);
        if (mapInstance.getLayer(LAYER_ID)) {
          mapInstance.removeLayer(LAYER_ID);
        }
        if (onAddedChangeRef.current) onAddedChangeRef.current(false);
      } catch (e) { /* map disposed */ }
      layerAddedRef.current = false;
      unregisterMarineEngine();
      const gl = glRef.current || mapInstance?.painter?.context?.gl;
      if (gl) {
        engine.dispose(gl);
      }
      engineRef.current = null;
    };
  }, [mapInstance]);

  useEffect(() => {
    const engine = engineRef.current;
    const gl = glRef.current || mapInstance?.painter?.context?.gl;
    if (!engine || !gl) return;

    if (!active) {
      // TRANSITION HOLD (2026-07-06): a model/layer switch blinks `active` false during the
      // style transition — keep the resident textures AND the upload signature through it so
      // the reactivation refeed dup-skips instead of paying a full re-encode + particle reset
      // (see shouldHoldClearOnDeactivate). A real toggle-off still clears here.
      if (engine._waveData && !shouldHoldClearOnDeactivate()) {
        engine.clearBuffers(gl);
        lastUploadedSignatureRef.current = '';
        lastUploadedGridRef.current = {
          activeModel: '', activeMarineLayer: '', gridProvider: '', componentLayer: '',
          boundsStr: '', cols: 0, rows: 0, vectorsLength: 0, nonzeroCount: 0,
          sampleSum: 0, timestamp: 0, timeOffsetHours: 0, renderedDataHour: null
        };
        if (mapInstance) mapInstance.triggerRepaint();
      }
      return;
    }

    const currentData = dataRef.current;
    const isRenderable = currentData && currentData.vectors?.length > 0 && currentData.__renderable !== false;

    if (!isRenderable) {
      if (currentData?.__unsupportedLayer === true) {
        if (engine._waveData) {
          recordClear('unsupported_layer');
          engine.clearBuffers(gl);
          lastUploadedSignatureRef.current = '';
          lastUploadedGridRef.current = {
            activeModel: '', activeMarineLayer: '', gridProvider: '', componentLayer: '',
            boundsStr: '', cols: 0, rows: 0, vectorsLength: 0, nonzeroCount: 0,
            sampleSum: 0, timestamp: 0, timeOffsetHours: 0, renderedDataHour: null
          };
          if (mapInstance) mapInstance.triggerRepaint();
        }
        runDiagnosticsUpdate('unsupported_layer');
        return;
      }

      const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
      const lastSig = lastUploadedGridRef.current;
      const modelOrLayerChanged = lastSig.activeModel !== activeModelRef.current ||
                                   lastSig.activeMarineLayer !== activeMarineLayer;
      const hourChanged = lastSig.timeOffsetHours !== timeOffsetHoursRef.current;

      const isScrubbing = window.isScrubbingTimeline || (window.lastScrubTime && (Date.now() - window.lastScrubTime < 1500));
      if (isScrubbing) {
        return;
      }

      const isFallbackSafeZero = currentData?.__provider === 'fallback_safe_zero' || currentData?.grid?.__provider === 'fallback_safe_zero';

      if (isFallbackSafeZero && !modelOrLayerChanged && !hourChanged) {
        runDiagnosticsUpdate('held_rate_limit');
        return;
      }

      // v8.0: During model/layer transitions, skip clearing and retain existing heatmap
      // until the new data arrives. This prevents the visual flash-clear that occurs
      // when the orchestrator is fetching new data and temporarily sets __renderable=false.
      const isTransitionGuard = typeof window !== 'undefined' && (
        !!window.__MARINE_TRANSITIONING__ ||
        !!window.__MARINE_FETCH_PENDING__ ||
        !!window.__MARINE_FETCH_DEBOUNCING__
      );
      // v8.1: Also hold for a TRANSIENT non-renderable commit on the SAME model/layer we're
      // already displaying (e.g. a settled-scrub refetch or aborted refetch that briefly
      // returns __renderable=false while the transition flags happen to be unset). Clearing
      // in that no-flags window is what caused the intermittent blank after scrubbing.
      // Truth-safe: same model/layer, so the held frame is NOT mislabeled — this is the
      // existing stale-good-frame retention intent. A real model/LAYER switch
      // (modelOrLayerChanged) still falls through and clears, so we never hold one layer's
      // frame under another. The next renderable commit always replaces the held frame.
      const sameTargetTransient = !modelOrLayerChanged && !!engine._waveData;

      // Zoom-out clamp guard: if the engine is HOLDING a regional texture but the viewport is now
      // zoomed out to ~global, holding renders that regional grid as a clamped rectangle (the brief
      // post-scrub/zoom-out clamp). The render gate already returns null for this case
      // (isZoomedOutRegionalReject in useMarineWindData.js) — honour it by CLEARING instead of
      // holding, so we show blank until the global grid loads. Self-selecting: a stable zoomed-IN
      // viewport is residentRegional but !zoomedOut, and a stable zoomed-OUT viewport has a global
      // (non-regional) resident — so this trips ONLY on an actual regional->global zoom-out, never
      // on the same-target scrub/toggle/abort holds those cases depend on (all-zero is a full-shape
      // global grid; cross-model switch is modelOrLayerChanged and clears already). Mirrors the
      // gate's zoomed-out math for parity.
      let isResidentRegionalAtGlobalViewport = false;
      try {
        const residentBounds = engine._waveData?.waveGrid?.bounds;
        if (residentBounds && mapInstance && typeof mapInstance.getZoom === 'function') {
          const rWidth = (residentBounds.east < residentBounds.west)
            ? (residentBounds.east + 360) - residentBounds.west
            : residentBounds.east - residentBounds.west;
          const residentRegional = rWidth < 340.0;
          const vb = mapInstance.getBounds();
          const ew = vb.getWest(), ee = vb.getEast();
          const vWidth = (ee < ew) ? (ee + 360) - ew : ee - ew;
          const vHeight = vb.getNorth() - vb.getSouth();
          const viewportZoomedOut = (mapInstance.getZoom() <= MARINE_ZOOMED_OUT_MAX_ZOOM) || (vWidth > 15.0 || vHeight > 15.0);
          isResidentRegionalAtGlobalViewport = residentRegional && viewportZoomedOut;
        }
      } catch (e) { /* getBounds/getZoom can throw mid-style-load — fall back to holding */ }

      if ((isTransitionGuard || sameTargetTransient) && lastUploadedSignatureRef.current && !isResidentRegionalAtGlobalViewport) {
        runDiagnosticsUpdate('transition_hold');
        return;
      }

      if (engine._waveData) {
        recordClear('non_renderable_terminal');
        engine.clearBuffers(gl);
        lastUploadedSignatureRef.current = '';
        lastUploadedGridRef.current = {
          activeModel: '', activeMarineLayer: '', gridProvider: '', componentLayer: '',
          boundsStr: '', cols: 0, rows: 0, vectorsLength: 0, nonzeroCount: 0,
          sampleSum: 0, timestamp: 0, timeOffsetHours: 0, renderedDataHour: null
        };

        if (!window.__WEBGL_MARINE_CLEAR_COUNT__) window.__WEBGL_MARINE_CLEAR_COUNT__ = 0;
        window.__WEBGL_MARINE_CLEAR_COUNT__++;
        if (window.__MARINE_PIPELINE_TRUTH__) {
          window.__MARINE_PIPELINE_TRUTH__.webglClears = window.__WEBGL_MARINE_CLEAR_COUNT__;
          if (window.__MARINE_PIPELINE_TRUTH__.counters) {
            window.__MARINE_PIPELINE_TRUTH__.counters.webglClears = window.__WEBGL_MARINE_CLEAR_COUNT__;
          }
        }

        window.__WEBGL_MARINE_UPLOAD_REASON__ = 'forced_clear';
        if (mapInstance) mapInstance.triggerRepaint();
      }
      runDiagnosticsUpdate('forced_clear');
      return;
    }

    if (window.isScrubbingTimeline) {
      window.lastScrubTime = Date.now();
    }

    const gridModel = currentData.__sourceModel || activeModel;
    const activeMarineLayer = activeLayersRef.current?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves';
    const gridProvider = currentData.grid?.__gridProvider || currentData.__gridProvider || 'none';
    const componentLayer = currentData.grid?.__componentLayer || currentData.__componentLayer || 'none';

    const isEuro = activeModelRef.current === 'EURO';
    const isGfsOrIcon = activeModelRef.current === 'GFS' || activeModelRef.current === 'ICON';
    const isWaves = activeMarineLayer === 'waves';

    let isValid = true;
    let invalidReason = null;
    if (gridModel !== activeModelRef.current) { isValid = false; invalidReason = 'model_mismatch'; }
    if (isValid) {
      if (isGfsOrIcon) {
        // 'gfs_euro_blend' is the ICON synthesized-layer provider: swell_2 (no native gwam
        // secondary swell) and the >240h extended-range grids are built as a GFS/EURO weighted
        // blend in backendWeatherServiceClient*.js. It was missing from this whitelist, so the
        // blended grid failed validation and was silently dropped (return below) — leaving the
        // engine showing the PREVIOUS layer's texture. That is the "ICON swell_2 just renders a
        // copy of swell_1" bug: verified live — engine._waveData.waveGrid.__componentLayer was
        // 'swell_1' (629 vec, max 7.12) while the render gate held the swell_2 blend (171 vec,
        // max 3.15). The componentLayer===activeMarineLayer guard below keeps it truth-safe.
        if (gridProvider !== 'open-meteo' && gridProvider !== 'backend-weather-service' && gridProvider !== 'estimated' && gridProvider !== 'test-fixture' && gridProvider !== 'gfs_euro_blend') {
          isValid = false; invalidReason = 'provider_not_whitelisted';
        } else if ((gridProvider === 'backend-weather-service' || gridProvider === 'estimated' || gridProvider === 'test-fixture' || gridProvider === 'gfs_euro_blend') && componentLayer !== activeMarineLayer) {
          isValid = false; invalidReason = 'component_layer_mismatch';
        }
      } else if (isEuro) {
        const isFallbackProvider = ['gfs_estimated_fallback', 'gfs_estimated_backdrop', 'open-meteo', 'estimated', 'test-fixture'].includes(gridProvider);
        if (isWaves) {
          if (gridProvider !== 'copernicus' && gridProvider !== 'backend-weather-service' && !isFallbackProvider) {
            isValid = false; invalidReason = 'provider_not_whitelisted';
          } else if (componentLayer !== activeMarineLayer) {
            isValid = false; invalidReason = 'component_layer_mismatch';
          }
        } else {
          const validEuroComponentProviders = ['copernicus', 'backend-weather-service', 'gfs_estimated_fallback', 'gfs_estimated_backdrop', 'open-meteo', 'estimated', 'test-fixture'];
          if (!validEuroComponentProviders.includes(gridProvider)) {
            isValid = false; invalidReason = 'provider_not_whitelisted';
          } else if (componentLayer !== activeMarineLayer) {
            isValid = false; invalidReason = 'component_layer_mismatch';
          }
        }
      }
    }

    if (!isValid) {
      // FORENSIC PROBE (swell_2 intermittent-load investigation): the drop below is otherwise SILENT,
      // so the heatmap "won't load / shows the wrong layer" with zero console trace. Stash the
      // discriminating fields (and console.warn for the swell_2 case) so a live repro on a VISIBLE
      // tab pins WHICH case fired — provider_not_whitelisted vs component_layer_mismatch vs
      // model_mismatch — without touching the truth-safe guard. Read window.__SWELL2_LAST_DROP__
      // in the console after a repro. No behavior change.
      try {
        const drop = {
          gridModel, activeModel: activeModelRef.current, gridProvider, componentLayer,
          activeMarineLayer, reason: invalidReason, renderable: currentData?.__renderable,
          t: new Date().toISOString()
        };
        if (typeof window !== 'undefined') {
          window.__SWELL2_LAST_DROP__ = drop;
          if (activeMarineLayer === 'swell_2') console.warn('[SWELL2_DROP]', drop);
        }
      } catch (_) { /* probe must never affect rendering */ }
      // Retain the current WebGL buffers during transition and mismatch
      // until new valid data for the active model/layer is successfully loaded and committed.
      return;
    }

    if (currentData.__renderable === false) {
      runDiagnosticsUpdate(`render_blocked: ${currentData.__renderBlockedReason || 'not_renderable'}`);
      return;
    }

    const doUpload = () => {
      const reason = window.isScrubbingTimeline ? 'scrub_settle' : 'data_commit';
      safeUploadWaveData(reason, gl, currentData, landGeoJSONRef.current);
    };

    // Upload synchronously on every committed frame — for BOTH scrub and non-scrub. There is no
    // need for a scrub-only debounce here: (1) the timeline slider already rAF-coalesces its input
    // (MapWeatherControls.handleSliderChange fires the latest hour at most once per animation frame),
    // so commits arrive at <=60fps, and (2) safeUploadWaveData content-diffs each frame
    // (computeVectorDiffAndLog → skipped_identical_content_across_hours), so a redundant same-frame
    // upload is already a cheap no-op. The old scrub setTimeout debounce therefore only ADDED latency
    // (heatmap lagging the scrubber) without preventing any real flood. Synchronous = the heatmap
    // repaints on the same frame the new hour commits, tracking the scrubber.
    if (scrubUploadTimeoutRef.current) { clearTimeout(scrubUploadTimeoutRef.current); scrubUploadTimeoutRef.current = null; }
    doUpload();

    return () => {
      if (scrubUploadTimeoutRef.current) clearTimeout(scrubUploadTimeoutRef.current);
    };
  }, [revision, activeModel, timeOffsetHours, mapInstance, landGeoJSON, active]);

  // Self-heal re-feed: the main upload effect above keys on [revision, activeModel,
  // timeOffsetHours, active] and reads dataRef — it does NOT depend on `data`. When the marine
  // layer is toggled off→on, the !active branch calls clearBuffers() and empties the engine
  // (_waveData=null); on toggle-on the reactivation reuses the RETAINED stale frame (cache MISS
  // → "retaining stale view", no new commit ⇒ revision/hour/model unchanged), so the main effect
  // never re-fires and the renderable frame is never re-uploaded — the heatmap stays blank even
  // though useMarineWindData reports renderable (verified live: engine._waveData=false while
  // __MARINE_WIND_DATA__.__renderable=true, vectors=171). This effect DOES depend on `data`, so
  // it fires when the frame settles after reactivation and re-feeds the emptied engine. It is
  // purely additive — it can only UPLOAD when the engine is active+emptied with a renderable
  // frame; it never clears or holds. The `engine._waveData` guard makes it a no-op once resident,
  // so it cannot loop or double-upload.
  useEffect(() => {
    const engine = engineRef.current;
    const gl = glRef.current || mapInstance?.painter?.context?.gl;
    if (!engine || !gl || !active || engine._waveData) return;
    const cur = dataRef.current;
    if (cur && cur.vectors?.length > 0 && cur.__renderable !== false) {
      safeUploadWaveData('reactivate_refeed', gl, cur, landGeoJSONRef.current);
    }
  }, [data, active, revision]);

  useEffect(() => {
    if (!mapInstance || !active) return;
    safeMoveLayer(mapInstance, LAYER_ID, beforeId);
  }, [mapInstance, active, beforeId]);

  return null;
}

export const WebGLMarineLayer = memo(WebGLMarineLayerInner);

export default WebGLMarineLayer;

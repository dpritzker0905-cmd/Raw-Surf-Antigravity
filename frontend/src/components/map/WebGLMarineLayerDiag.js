/**
 * WebGLMarineLayerDiag.js
 * 
 * Helper for logging WebGL upload differences, parity, and diagnostics.
 */

import { computeGridContentHash } from './marineGridHash';

// Initialize defaults at module load so diagnostics are never null.
//
// ⛔ THIS DEFAULT MUST DECLARE ONLY WHAT `updateWebGLMarineLayerDiag` ACTUALLY WRITES.
// The live write REPLACES this object wholesale (it does not merge), so any key declared here that
// the write does not provide is `0`/`null` before the first write and `undefined` forever after —
// while the real value sits under a different name. Measured 2026-08-11 on production build
// `23743f63`: a reader polling `.vectorCount` saw 0 for 60 s while the grid served 15,023 vectors,
// because the written names are `backendGridVectorCount` / `webglSourceVectorCount` and
// `.vectorCount` existed only in this list. Eleven such phantom keys were removed
// (validTime, productId, provider, bounds, vectorCount, nonzeroCount, uploadCount, uploadReason,
// renderDecision, coverage_status, staleClearStatus) — none was read by any production consumer;
// they existed only to mislead whoever opened the object in a console.
// ★ This is the orphaned-read defect (`516a7200`) in schema form: the earlier one was a NAME
//   nothing wrote, this was a WHOLE FIELD SET nothing wrote.
// `WebGLMarineLayerDiag.schema.test.js` pins default keys === written keys. Add a field to one and
// the test tells you to add it to the other.
if (typeof window !== 'undefined') {
  window.__WebGLMarineLayer_DIAG__ = window.__WebGLMarineLayer_DIAG__ || {
    status: 'not_initialized',
    activeModel: null,
    activeMarineLayer: null,
    renderedProvider: null,
    componentLayer: null,
    backendGridVectorCount: 0,
    webglSourceVectorCount: 0,
    particleCount: 0,
    renderedParticleCount: 0,
    lastUploadedGridSignature: 'none',
    waveDataPresent: false,
    timeOffsetHours: null,
    lastUploadClearRejectionReason: 'none',
    infoboxHeatmapParity: false,
    timestamp: null
  };

  window.__WEBGL_MARINE_UPLOAD_DIAG__ = window.__WEBGL_MARINE_UPLOAD_DIAG__ || {
    status: 'not_initialized',
    activeModel: null,
    activeLayer: null,
    validTime: null,
    productId: null,
    provider: null,
    bounds: null,
    vectorCount: 0,
    nonzeroCount: 0,
    uploadCount: 0,
    uploadReason: 'none',
    renderDecision: 'not_initialized',
    coverage_status: 'not_initialized',
    staleClearStatus: 'none',
    timeOffsetHours: null,
    gridProvider: null,
    sourceModel: null,
    componentLayer: null,
    renderAccepted: false,
    rejectionReason: null,
    elapsedMs: 0,
    timestamp: null
  };

  window.__MARINE_RENDER_SOURCE_DIAG__ = window.__MARINE_RENDER_SOURCE_DIAG__ || {
    status: 'not_initialized',
    activeModel: null,
    activeLayer: null,
    validTime: null,
    productId: null,
    provider: null,
    bounds: null,
    vectorCount: 0,
    nonzeroCount: 0,
    uploadCount: 0,
    uploadReason: 'none',
    renderDecision: 'not_initialized',
    coverage_status: 'not_initialized',
    staleClearStatus: 'none',
    sourcePath: null,
    heatmapProvider: null,
    gridProvider: null,
    sourceModel: null,
    componentLayer: null,
    cols: 0,
    rows: 0,
    maxHeight: 0,
    meanHeight: 0,
    timeOffsetHours: null,
    timestamp: null
  };
}

export function updateWebGLMarineLayerDiag(engine, activeModel, activeLayers, timeOffsetHours, lastSig) {
  if (typeof window === 'undefined') return;

  const activeMarineLayer = activeLayers?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'unknown';

  const infoboxModel = window.__MARINE_POINT_DIAG__?.activeModel || 'unknown';
  const infoboxLayer = window.__MARINE_POINT_DIAG__?.activeLayer || 'unknown';
  const infoboxHour = window.__MARINE_POINT_DIAG__?.timeOffsetHours !== undefined ? window.__MARINE_POINT_DIAG__?.timeOffsetHours : -999;
  const infoboxProvider = window.__MARINE_POINT_DIAG__?.provider || 'none';

  const heatmapModel = activeModel;
  const heatmapLayer = activeMarineLayer;
  const heatmapHour = timeOffsetHours;
  const heatmapProvider = lastSig.gridProvider || 'none';

  const matches = infoboxModel === heatmapModel &&
                  infoboxLayer === heatmapLayer &&
                  infoboxHour === heatmapHour &&
                  infoboxProvider === heatmapProvider;

  const backendGridVectorCount = lastSig.vectorsLength || 0;
  const webglSourceVectorCount = lastSig.vectorsLength || 0;
  const particleCount = engine ? (engine.particleRes ** 2) : 0;
  const renderedParticleCount = (engine && engine._waveData) ? (engine.particleRes ** 2) : 0;
  const lastUploadedGridSignature = lastSig.uploadSig || 'none';

  const diag = {
    // The write now declares its own status instead of letting the default's 'not_initialized'
    // simply vanish. `isDiagUninitialised` still discriminates on `timestamp` (see its note in
    // forecastDiagnostics.js) — this makes the object honest to a human reading it in a console,
    // which is the only kind of reader this whole object exists for.
    status: 'active',
    activeModel: heatmapModel,
    activeMarineLayer: heatmapLayer,
    renderedProvider: heatmapProvider,
    componentLayer: lastSig.componentLayer || 'none',
    backendGridVectorCount,
    webglSourceVectorCount,
    particleCount,
    renderedParticleCount,
    lastUploadedGridSignature,
    waveDataPresent: !!engine?._waveData,
    timeOffsetHours: heatmapHour,
    lastUploadClearRejectionReason: window.__WEBGL_MARINE_UPLOAD_REASON__ || 'none',
    infoboxHeatmapParity: matches,
    timestamp: new Date().toISOString()
  };

  window.__WebGLMarineLayer_DIAG__ = diag;
}

export function computeVectorDiffAndLog({ grid, prev, activeModel, activeLayers, timeOffsetHours, gridProvider, componentLayer, boundsStr, geojsonSig, themeSig, uploadSigResidency, alreadyResident, activeML }) {
  if (typeof window === 'undefined') return;

  let nonzeroCount = 0;
  let contentHash = 0;
  if (grid.vectors) {
    if (!grid.__nonzeroCounts) {
      grid.__nonzeroCounts = {};
    }
    if (grid.__nonzeroCounts[activeML] !== undefined) {
      nonzeroCount = grid.__nonzeroCounts[activeML];
    } else {
      const len = grid.vectors.length;
      for (let i = 0; i < len; i++) {
        const v = grid.vectors[i];
        const comp = v?.[activeML] || v;
        if (comp && comp.speed > 0) nonzeroCount++;
      }
      grid.__nonzeroCounts[activeML] = nonzeroCount;
    }
    contentHash = computeGridContentHash(grid, activeML);
  }

  const requestedHour = timeOffsetHours;
  const renderedDataHour = grid.hourOffset !== undefined ? grid.hourOffset : (grid.grid?.hourOffset !== undefined ? grid.grid.hourOffset : null);

  const hourChanged = prev.renderedDataHour !== renderedDataHour;
  const contentHashChanged = prev.contentHash !== contentHash;

  let shouldSkip = false;
  let skipReason = 'none';

  const activeMarineLayer = activeLayers?.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'unknown';

  if (alreadyResident) {
    if (prev.activeModel === activeModel &&
        prev.activeMarineLayer === activeMarineLayer &&
        prev.gridProvider === gridProvider &&
        prev.boundsStr === boundsStr &&
        prev.geojsonSig === geojsonSig &&
        prev.themeSig === themeSig &&
        prev.contentHash === contentHash) {
      
      // Only skip if we're re-uploading data for the SAME hour with identical content.
      // NEVER skip when the hour has changed — even if the ocean data is numerically
      // identical, the user explicitly requested a different forecast time.
      // This was the root cause of the "heatmap freezes after scrubbing" bug:
      // adjacent GFS marine hours often have identical wave vectors, causing
      // shouldSkip=true and permanently freezing the heatmap at the first uploaded hour.
      if (!hourChanged) {
        shouldSkip = true;
        skipReason = 'duplicate_skipped';
      }
    }
  }

  const diff = {
    model: `${prev.activeModel || 'none'} -> ${activeModel}`,
    layer: `${prev.activeMarineLayer || 'none'} -> ${activeMarineLayer}`,
    hour: `${prev.renderedDataHour !== undefined ? prev.renderedDataHour : 'none'} -> ${requestedHour}`,
    provider: `${prev.gridProvider || 'none'} -> ${gridProvider}`,
    bounds: `${prev.boundsStr || 'none'} -> ${boundsStr}`,
    vectorCount: `${prev.vectorsLength || 0} -> ${grid.vectors ? grid.vectors.length : 0}`,
    nonzeroCount: `${prev.nonzeroCount || 0} -> ${nonzeroCount}`,
    contentHash: `${prev.contentHash !== undefined ? prev.contentHash : 'none'} -> ${contentHash}`,
    landMask: `${prev.geojsonSig || 'none'} -> ${geojsonSig}`,
    theme: `${prev.themeSig || 'none'} -> ${themeSig}`,
    modelChanged: prev.activeModel !== activeModel,
    layerChanged: prev.activeMarineLayer !== activeMarineLayer,
    hourChanged: hourChanged,
    providerChanged: prev.gridProvider !== gridProvider,
    boundsChanged: prev.boundsStr !== boundsStr,
    vectorCountChanged: prev.vectorsLength !== (grid.vectors ? grid.vectors.length : 0),
    nonzeroCountChanged: prev.nonzeroCount !== nonzeroCount,
    contentHashChanged: contentHashChanged,
    landMaskChanged: prev.geojsonSig !== geojsonSig,
    themeChanged: prev.themeSig !== themeSig,
    alreadyResident: alreadyResident,
    shouldSkip: shouldSkip,
    skipReason: skipReason,
    prevSig: prev.uploadSig || 'none',
    currSig: uploadSigResidency,
    timestamp: new Date().toISOString()
  };

  const sampleIndices = [0, 5, 10, 20, 50, 100, 200, 300, 400, 500];
  const prevSamples = prev.samples || [];
  const currSamples = sampleIndices.map(idx => {
    const v = grid.vectors?.[idx];
    const comp = v?.[activeML] || v;
    return comp ? { idx, speed: comp.speed || 0, u: comp.u || 0, v: comp.v || 0, period: comp.period || 0 } : { idx, speed: 0, u: 0, v: 0, period: 0 };
  });

  const diffs = sampleIndices.map((idx, sIdx) => {
    const p = prevSamples[sIdx] || { speed: -1, u: 0, v: 0, period: -1 };
    const c = currSamples[sIdx];
    return {
      index: idx,
      prev: p,
      curr: c,
      identical: p.speed === c.speed && p.u === c.u && p.v === c.v && p.period === c.period
    };
  });

  window.__MARINE_FORECAST_VECTOR_DIFF__ = {
    prevHour: prev.renderedDataHour,
    currHour: requestedHour,
    activeModel: activeModel,
    activeLayer: activeMarineLayer,
    samples: diffs,
    allIdentical: diffs.every(d => d.identical),
    timestamp: new Date().toISOString()
  };

  window.__WEBGL_MARINE_UPLOAD_SIG_DIFF__ = diff;

  return {
    shouldSkip,
    skipReason,
    nonzeroCount,
    contentHash,
    currSamples
  };
}

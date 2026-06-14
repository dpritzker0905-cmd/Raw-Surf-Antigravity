// weatherTruthTracker.js

function fnv1a_32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    h = h ^ (code & 0xff);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function computeJsDataHash(vectors, layer = 'waves') {
  if (!vectors || !vectors.length) return fnv1a_32("");
  const parts = vectors.map(v => {
    const hasFlat = v.speed !== undefined;
    const layerObj = !hasFlat && layer ? v[layer] : null;

    const speed = hasFlat ? v.speed : (layerObj?.speed !== undefined ? layerObj.speed : 0.0);
    const u = hasFlat ? v.u : (layerObj?.u !== undefined ? layerObj.u : 0.0);
    const vVal = hasFlat ? v.v : (layerObj?.v !== undefined ? layerObj.v : 0.0);
    const period = hasFlat ? (v.period != null ? v.period : 0.0) : (layerObj?.period != null ? layerObj.period : 0.0);
    const isValid = (v.is_valid === undefined || v.is_valid) ? 1 : 0;

    return `${Number(v.lat).toFixed(4)},${Number(v.lng).toFixed(4)},${Number(speed).toFixed(4)},${Number(u).toFixed(4)},${Number(vVal).toFixed(4)},${Number(period).toFixed(4)},${isValid}`;
  });
  return fnv1a_32(parts.join('\n'));
}

export function computeJsBoundsHash(servedBbox) {
  return fnv1a_32(servedBbox || "");
}

export function computeJsTraceId(model, domain, layer, validTime, servedBbox, dataHash) {
  let dateStr = "none";
  if (validTime) {
    try {
      const d = new Date(validTime);
      if (!isNaN(d.getTime())) {
        dateStr = d.toISOString().replace(/\.\d{3}/, '');
      }
    } catch (e) {}
  }
  const traceKey = `${model.toUpperCase()}:${domain.toLowerCase()}:${layer.toLowerCase()}:${dateStr}:${servedBbox || ""}:${dataHash}`;
  return fnv1a_32(traceKey);
}

export function initializeTruthTracker() {
  if (!window.__WEATHER_TRUTH_TRACE__) {
    window.__WEATHER_TRUTH_TRACE__ = {
      activeTraceId: null,
      stages: [],
      verdict: {
        status: "PASS",
        firstMismatchStage: null,
        failReasons: [],
        nextPatchTarget: null
      }
    };
  }
}

export function recordTruthStage(stageName, data, file, functionName) {
  initializeTruthTracker();
  
  const trace = window.__WEATHER_TRUTH_TRACE__;
  const timestamp = new Date().toISOString();
  
  let truthTag = data ? data.truthTag : null;
  
  // If truthTag is missing (e.g. at mappedGrid, cacheRead, etc.), let's construct/preserve it
  if (!truthTag && data && data.grid && data.model && data.domain && data.layer) {
    const model = data.model;
    const domain = data.domain;
    const layer = data.layer;
    const validTime = data.valid_time || data.validTime;
    const servedBbox = data.served_bbox || data.servedBbox || (data.grid.bounds ? `${data.grid.bounds.west.toFixed(2)},${data.grid.bounds.south.toFixed(2)},${data.grid.bounds.east.toFixed(2)},${data.grid.bounds.north.toFixed(2)}` : "");
    const dataHash = computeJsDataHash(data.grid.vectors, layer);
    const boundsHash = computeJsBoundsHash(servedBbox);
    const traceId = computeJsTraceId(model, domain, layer, validTime, servedBbox, dataHash);
    
    const runTime = data.run_time || data.runTime || new Date().toISOString();
    let timeOffsetHours = 0;
    try {
      const vTime = new Date(validTime);
      const rTime = new Date(runTime);
      if (!isNaN(vTime.getTime()) && !isNaN(rTime.getTime())) {
        timeOffsetHours = Math.round((vTime - rTime) / 3600000);
      }
    } catch (e) {}
    
    truthTag = {
      traceId,
      model,
      domain,
      layer,
      valid_time: (() => {
        if (validTime) {
          try {
            const d = new Date(validTime);
            if (!isNaN(d.getTime())) return d.toISOString().replace(/\.\d{3}/, '');
          } catch (e) {}
        }
        return new Date().toISOString().replace(/\.\d{3}/, '');
      })(),
      timeOffsetHours,
      product_id: data.product_id || data.productId,
      grid_product_id: data.product_id || data.productId,
      provider: data.provider || "open-meteo",
      upstream_model: data.upstream_model || data.upstreamModel,
      is_dynamic_viewport_product: !!data.is_dynamic_viewport_product,
      coverage_scope: data.coverage_scope,
      requested_bbox: data.requested_bbox,
      served_bbox: servedBbox,
      cols: data.grid.cols,
      rows: data.grid.rows,
      vectorCount: data.grid.vectors.length,
      nonzeroCount: data.grid.vectors.filter(v => v.speed > 0).length,
      minSpeed: Math.min(...data.grid.vectors.map(v => v.speed)),
      maxSpeed: Math.max(...data.grid.vectors.map(v => v.speed)),
      dataHash,
      boundsHash,
      createdAt: timestamp,
      sourceStage: stageName
    };
  }

  // Preserve truthTag if present on data
  if (data && data.truthTag) {
    truthTag = data.truthTag;
  }

  if (!truthTag) {
    if (window.__WEATHER_TRUTH_DEBUG__) {
      console.warn(`[WEATHER_TRUTH] Stage ${stageName} recorded with no truthTag.`);
    }
    return;
  }

  const productId = truthTag.product_id || truthTag.grid_product_id;
  const dataHash = truthTag.dataHash;
  const boundsHash = truthTag.boundsHash;
  const traceId = truthTag.traceId;

  // Auto-set activeTraceId for GFS waves live or any wind model layer
  const isGfsWaves = truthTag.model === "GFS" && truthTag.layer === "waves";
  const isWindLayer = truthTag.layer === "wind";
  if (isGfsWaves || isWindLayer) {
    if (!trace.activeTraceId || stageName === "backendResponse" || stageName === "orchestratorCommit") {
      trace.activeTraceId = traceId;
    }
  }

  // Deduplicate frequent stages (like render / animation frame)
  const identicalStage = trace.stages.findLast(s => s.stage === stageName);
  if (identicalStage && identicalStage.truthTag.traceId === traceId && identicalStage.truthTag.dataHash === dataHash) {
    return;
  }

  // Check mismatch from previous stages
  let mismatchFromPrevious = false;
  let mismatchReason = null;

  if ((isGfsWaves || isWindLayer) && stageName !== 'pointRequest' && stageName !== 'pointResponse') {
    const previousStages = trace.stages.filter(s => 
      s.truthTag && 
      s.truthTag.model === truthTag.model && 
      s.truthTag.layer === truthTag.layer &&
      s.truthTag.valid_time === truthTag.valid_time &&
      s.stage !== 'pointRequest' &&
      s.stage !== 'pointResponse'
    );
    if (previousStages.length > 0) {
      const prev = previousStages[previousStages.length - 1];
      const isStartStage = stageName === "backendResponse" || stageName === "cacheRead";
      if (!isStartStage) {
        if (prev.truthTag.traceId !== traceId) {
          mismatchFromPrevious = true;
          mismatchReason = `traceId mismatch from stage ${prev.stage}: expected ${prev.truthTag.traceId}, got ${traceId}`;
        } else if (prev.truthTag.product_id !== productId) {
          mismatchFromPrevious = true;
          mismatchReason = `productId mismatch from stage ${prev.stage}: expected ${prev.truthTag.product_id}, got ${productId}`;
        } else if (prev.truthTag.dataHash !== dataHash) {
          mismatchFromPrevious = true;
          mismatchReason = `dataHash mismatch from stage ${prev.stage}: expected ${prev.truthTag.dataHash}, got ${dataHash}`;
        } else if (prev.truthTag.boundsHash !== boundsHash) {
          mismatchFromPrevious = true;
          mismatchReason = `boundsHash mismatch from stage ${prev.stage}: expected ${prev.truthTag.boundsHash}, got ${boundsHash}`;
        }
      }
    }
  }

  const stageObj = {
    stage: stageName,
    timestamp,
    truthTag,
    productId,
    dataHash,
    boundsHash,
    status: mismatchFromPrevious ? "MISMATCH" : "OK",
    mismatchFromPrevious,
    mismatchReason,
    file,
    functionName
  };

  trace.stages.push(stageObj);

  if (mismatchFromPrevious && trace.verdict.status === "PASS") {
    trace.verdict.status = "BLOCKED";
    trace.verdict.firstMismatchStage = stageName;
    trace.verdict.failReasons.push(mismatchReason);
    trace.verdict.nextPatchTarget = file;
  }

  const logMsg = JSON.stringify({
    logType: "WEATHER_TRUTH",
    stage: stageName,
    status: stageObj.status,
    traceId,
    productId,
    dataHash,
    boundsHash,
    mismatchReason,
    file,
    functionName
  });

  if (mismatchFromPrevious) {
    console.error(`[WEATHER_TRUTH] ${logMsg}`);
  } else if (window.__WEATHER_TRUTH_DEBUG__) {
    console.log(`[WEATHER_TRUTH] ${logMsg}`);
  } else {
    console.log(`[WEATHER_TRUTH] Stage: ${stageName} | TraceID: ${traceId} | Product: ${productId} | Status: OK`);
  }
}

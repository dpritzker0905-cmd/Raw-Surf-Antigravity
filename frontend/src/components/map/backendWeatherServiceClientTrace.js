/**
 * backendWeatherServiceClientTrace.js
 * 
 * Trace verification diagnostics helper for the single-slice GFS waves verification pipeline.
 */

if (typeof window !== 'undefined') {
  window.__GFS_WAVES_SINGLE_SLICE_TRACE__ = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
  
  window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__ = function() {
    const trace = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
    const reasons = [];
    let failedStage = "none";
    let nextPatchTarget = "none";

    // 1. Check backendResponse
    if (!trace.backendResponse) {
      failedStage = "backendResponse";
      reasons.push("Missing backendResponse trace data");
      nextPatchTarget = "fetchBackendMarineGrid";
    } else {
      const br = trace.backendResponse;
      if (br.product_id && br.product_id.includes("florida_east_coast")) {
        failedStage = "backendResponse";
        reasons.push("Backend product ID contains 'florida_east_coast': " + br.product_id);
        nextPatchTarget = "backend/routes/weather.py (route selector)";
      }
      if (br.is_dynamic_viewport_product !== true) {
        failedStage = "backendResponse";
        reasons.push("Backend is_dynamic_viewport_product is not true");
        nextPatchTarget = "backend/routes/weather.py";
      }
      if (br.coverage_scope !== "viewport" && br.coverage_scope !== "global_coarse") {
        failedStage = "backendResponse";
        reasons.push("Backend coverage_scope is '" + br.coverage_scope + "', expected 'viewport' or 'global_coarse'");
        nextPatchTarget = "backend/routes/weather.py";
      }
      if (br.nonzeroSpeedCount === 0) {
        failedStage = "backendResponse";
        reasons.push("Backend nonzero speed count is 0");
        nextPatchTarget = "backend weather ingestion / Open-Meteo API";
      }
    }

    // 2. Check mappedGrid
    if (failedStage === "none") {
      if (!trace.mappedGrid) {
        failedStage = "mappedGrid";
        reasons.push("Missing mappedGrid trace data");
        nextPatchTarget = "mapNormalizedGridToWebGL";
      } else {
        const mg = trace.mappedGrid;
        if (mg.rootFlatSpeedNonzeroCount === 0) {
          failedStage = "mappedGrid";
          reasons.push("Mapped root flat speed nonzero count is 0");
          nextPatchTarget = "mapNormalizedGridToWebGL";
        }
        if (mg.nestedWavesSpeedNonzeroCount === 0) {
          failedStage = "mappedGrid";
          reasons.push("Mapped nested waves speed nonzero count is 0");
          nextPatchTarget = "mapNormalizedGridToWebGL";
        }
      }
    }

    // 3. Check cacheCommit
    if (failedStage === "none") {
      if (!trace.cacheCommit) {
        failedStage = "cacheCommit";
        reasons.push("Missing cacheCommit trace data");
        nextPatchTarget = "useMarineOrchestrator.js";
      } else {
        const cc = trace.cacheCommit;
        const brProductId = trace.backendResponse?.product_id;
        if (cc.committedProductId !== brProductId) {
          failedStage = "cacheCommit";
          reasons.push("Committed product ID (" + cc.committedProductId + ") differs from backend product ID (" + brProductId + ")");
          nextPatchTarget = "useMarineOrchestrator.js / marineController.js";
        }
      }
    }

    // 4. Check webglTextureUpload
    if (failedStage === "none") {
      if (!trace.webglTextureUpload) {
        failedStage = "webglTextureUpload";
        reasons.push("Missing webglTextureUpload trace data");
        nextPatchTarget = "WebGLMarineLayer.js / WebGLMarineTextureEncoder.js";
      } else {
        const tu = trace.webglTextureUpload;
        const ccProductId = trace.cacheCommit?.committedProductId;
        if (tu.uploadProductId !== ccProductId) {
          failedStage = "webglTextureUpload";
          reasons.push("Uploaded product ID (" + tu.uploadProductId + ") differs from committed product ID (" + ccProductId + ")");
          nextPatchTarget = "WebGLMarineLayer.js";
        }
        if (tu.encodedTextureMax <= tu.encodedTextureMin) {
          failedStage = "webglTextureUpload";
          reasons.push("Encoded texture max (" + tu.encodedTextureMax + ") is <= min (" + tu.encodedTextureMin + ")");
          nextPatchTarget = "WebGLMarineTextureEncoder.js";
        }
        if (tu.encodedNonzeroPixelCount === 0) {
          failedStage = "webglTextureUpload";
          reasons.push("Encoded nonzero pixel count is 0");
          nextPatchTarget = "WebGLMarineTextureEncoder.js";
        }
        if (tu.maskValidOceanCount === 0) {
          failedStage = "webglTextureUpload";
          reasons.push("Mask valid ocean count is 0");
          nextPatchTarget = "WebGLMarineTextureEncoder.js / renderMaskToCanvas";
        }
        if (tu.renderDecision !== "render") {
          failedStage = "webglTextureUpload";
          reasons.push("Render decision is '" + tu.renderDecision + "', expected 'render'");
          nextPatchTarget = "WebGLMarineLayer.js";
        }
      }
    }

    // 6. Check exactPoint
    if (failedStage === "none") {
      if (trace.exactPoint) {
        const ep = trace.exactPoint;
        const tuProductId = trace.webglTextureUpload?.uploadProductId;
        if (!ep.pointRequestUrl || !ep.pointRequestUrl.includes("grid_product_id=")) {
          failedStage = "exactPoint";
          reasons.push("Exact point request URL lacks 'grid_product_id': " + ep.pointRequestUrl);
          nextPatchTarget = "backendWeatherServiceClient.js (fetchBackendExactPoint)";
        }
        if (ep.pointProductId !== tuProductId) {
          failedStage = "exactPoint";
          reasons.push("Point product ID (" + ep.pointProductId + ") differs from uploaded product ID (" + tuProductId + ")");
          nextPatchTarget = "backend/services/weather_pipeline/point_resolution.py";
        }
        let epTime = "";
        let ccTime = "";
        if (ep.pointValidTime) {
          try {
            const d = new Date(ep.pointValidTime);
            if (!isNaN(d.getTime())) {
              epTime = d.toISOString();
            }
          } catch (e) {}
        }
        if (trace.cacheCommit?.committedValidTime) {
          try {
            const d = new Date(trace.cacheCommit.committedValidTime);
            if (!isNaN(d.getTime())) {
              ccTime = d.toISOString();
            }
          } catch (e) {}
        }
        if (epTime !== ccTime) {
          failedStage = "exactPoint";
          reasons.push("Point valid_time (" + epTime + ") differs from grid valid_time (" + ccTime + ")");
          nextPatchTarget = "backend/services/weather_pipeline/point_resolution.py / backendWeatherServiceClient.js";
        }
      }
    }

    trace.verdict = {
      status: reasons.length === 0 ? "PASS" : "BLOCKED",
      failedStage,
      failReasons: reasons,
      nextPatchTarget
    };
  };
}

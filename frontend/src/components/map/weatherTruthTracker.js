// weatherTruthTracker.js

// RELEASE IDENTITY (2026-08-09, Report 11.0 R11-03): every truth chain is stamped with the
// running bundle's BUILD_VERSION. Without it a truth event read in isolation (or a
// client-diagnostics record on the backend) cannot distinguish "HEAD defect" from "stale
// deployment" — the exact confound that invalidated a whole live session on 2026-07-12 and
// that marineForensics already solves for ITS ring. 'dev' means a local un-stamped build.
import { BUILD_VERSION } from '../../buildVersion';
import { verifiedCycleTime } from './verifiedCycleTime';

function fnv1a_32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    h = h ^ (code & 0xff);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * CONTENT-ADDRESSED DATA HASH (2026-10-24, wind toggle first draw). computeJsDataHash string-formats every vector (~15k on a
 * world wind frame: 11-15 ms on the toggle's critical path, profiled). A caller whose vectors are a pure function of a
 * content-addressed object (a static frame's sha256, plus its crop window) seeds the cache with a hash of that identity
 * instead; the hash still changes exactly when the data does. Diagnostic only: no served number reads it.
 */
export function seedJsDataHash(vectors, layer, identity) {
  if (!vectors || !vectors.length || !identity) return false;
  vectors[`__jsDataHash_${layer}`] = fnv1a_32(`content:${identity}`);
  return true;
}

export function computeJsDataHash(vectors, layer = 'waves') {
  if (!vectors || !vectors.length) return fnv1a_32("");
  const cacheKey = `__jsDataHash_${layer}`;
  if (vectors[cacheKey]) {
    return vectors[cacheKey];
  }

  const parts = [];
  const len = vectors.length;
  for (let i = 0; i < len; i++) {
    const v = vectors[i];
    const hasFlat = v.speed !== undefined;
    const layerObj = !hasFlat && layer ? v[layer] : null;

    const speed = hasFlat ? v.speed : (layerObj?.speed !== undefined ? layerObj.speed : 0.0);
    const u = hasFlat ? v.u : (layerObj?.u !== undefined ? layerObj.u : 0.0);
    const vVal = hasFlat ? v.v : (layerObj?.v !== undefined ? layerObj.v : 0.0);
    const period = hasFlat ? (v.period != null ? v.period : 0.0) : (layerObj?.period != null ? layerObj.period : 0.0);
    const isValid = (v.is_valid === undefined || v.is_valid) ? 1 : 0;

    parts.push(`${Number(v.lat).toFixed(4)},${Number(v.lng).toFixed(4)},${Number(speed).toFixed(4)},${Number(u).toFixed(4)},${Number(vVal).toFixed(4)},${Number(period).toFixed(4)},${isValid}`);
  }
  const hash = fnv1a_32(parts.join('\n'));
  vectors[cacheKey] = hash;
  return hash;
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

/**
 * Resets the truth tracker state when the active model or layer changes.
 * Prevents stale stages from prior model/layer fetches from triggering
 * false MISMATCH verdicts against the new model's data.
 */
export function resetTruthTracker(reason) {
  if (typeof window === 'undefined') return;
  initializeTruthTracker();
  const trace = window.__WEATHER_TRUTH_TRACE__;
  trace.stages = [];
  trace.activeTraceId = null;
  trace.verdict = {
    status: "PASS",
    firstMismatchStage: null,
    failReasons: [],
    nextPatchTarget: null
  };
  // A1: a reset means the model/layer moved on — pending chains are superseded, not absent.
  _pendingChains.clear();
  if (window.__WEATHER_TRUTH_DEBUG__) {
    console.log(`[WEATHER_TRUTH] Tracker reset: ${reason}`);
  }
}

/** One pass over the vectors: nonzero count, validity census, min and max speed. Shape-agnostic: raw backend vectors carry
 * is_valid (snake_case), mapper-rebuilt vectors carry isOcean ONLY — a probe that checks is_valid on mapper vectors reads every
 * land cell as "valid + speed 0.00" (the misleading 134-valid-zero signature). */
export function vectorCensus(vecs) {
  let nonzeroCount = 0, invalidCount = 0, validZeroCount = 0, minS = Infinity, maxS = -Infinity;
  for (let i = 0; i < vecs.length; i++) {
    const v = vecs[i];
    const s = v?.speed || 0;
    if (s > 0) nonzeroCount++;
    if (s < minS) minS = s;
    if (s > maxS) maxS = s;
    if (!v) continue;
    if (v.is_valid === false || v.isOcean === false) invalidCount++;
    else if (s === 0) validZeroCount++;
  }
  return { nonzeroCount, invalidCount, validZeroCount, minSpeed: minS === Infinity ? 0 : minS, maxSpeed: maxS === -Infinity ? 0 : maxS };
}

const CENSUS_KEYS = ['nonzeroCount', 'invalidCount', 'validZeroCount', 'minSpeed', 'maxSpeed'];
/** Put the census on `tag`: eager values with the kill set, else enumerable getters that compute it ONCE on first read (a spread
 * or JSON.stringify of the tag reads them then). Returns the tag. */
export function attachCensus(tag, vecs) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_TRUTH_TAG_LAZY_CENSUS__ === true) return Object.assign(tag, vectorCensus(vecs));
  let census = null;
  const c = () => census || (census = vectorCensus(vecs));
  for (const k of CENSUS_KEYS) Object.defineProperty(tag, k, { enumerable: true, configurable: true, get: () => c()[k] });
  return tag;
}

// Build a truthTag from a grid-commit-shaped payload. Exported so series-frame MINT sites can
// stamp lineage ONCE (audit #18/A3): recordTruthStage PRESERVES an existing data.truthTag, so a
// tag minted at frame construction keeps product_id + traceId identical across commit → webglUpload
// (the per-stage reconstruction below cannot — the engine's waveGrid carries no product_id, so
// series frames recorded `Product: undefined` + a divergent traceId, orphaning their lineage).
export function buildTruthTag(data, stageName) {
  if (!(data && data.grid && data.grid.vectors && data.model && data.domain && data.layer)) return null;
  const timestamp = new Date().toISOString();
  {
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
    
    return attachCensus({
      ...verifiedCycleTime(data),
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
      // The vector census (nonzero / validity / min / max speed), for people reading the trace: no code compares it (the HUD
      // compares dataHash, boundsHash, product and chain). It is computed in ONE pass on first read and cached, so building a tag
      // on the click no longer walks every vector four times (PR D, 2026-10-26: 3.6-3.9 ms of a world wind frame's build).
      // Validity census (zoom-in cleared-rect forensics, 2026-07-05): shape-agnostic, see vectorCensus.
      // Kill: window.__RAW_DISABLE_TRUTH_TAG_LAZY_CENSUS__ = true (computed eagerly, as before). Attached below with
      // attachCensus: an object spread here would call the getters at once.
      dataHash,
      boundsHash,
      createdAt: timestamp,
      sourceStage: stageName,
      build: BUILD_VERSION
    }, data.grid.vectors);
  }
}

export function recordTruthStage(stageName, data, file, functionName) {
  initializeTruthTracker();

  const trace = window.__WEATHER_TRUTH_TRACE__;
  const timestamp = new Date().toISOString();

  let truthTag = data ? data.truthTag : null;

  // If truthTag is missing (e.g. at mappedGrid, cacheRead, etc.), construct it (see buildTruthTag)
  if (!truthTag) {
    truthTag = buildTruthTag(data, stageName);
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

  if ((isGfsWaves || isWindLayer) && stageName !== 'pointRequest' && stageName !== 'pointResponse' && stageName !== 'infoboxDisplay') {
    // Lineage = PRODUCT (2026-07-04): stages are compared only within the same product_id.
    // Zoom-driven coarse<->regional swaps, the render-backstop sharpen, and land_mask_res_swap
    // re-uploads all legitimately move to a DIFFERENT product for the same model/layer/valid_time
    // without an orchestratorCommit first — the old cross-product comparison fired a console.error
    // MISMATCH on every zoom transition (and console.error feeds the telemetry error interceptor
    // → false HUD violations). Within-product divergence (same product_id, different
    // dataHash/boundsHash across stages) remains fully compared — that is the real "rendered
    // something other than what was committed" detector.
    const previousStages = trace.stages.filter(s =>
      s.truthTag &&
      s.truthTag.model === truthTag.model &&
      s.truthTag.layer === truthTag.layer &&
      s.truthTag.valid_time === truthTag.valid_time &&
      (s.truthTag.product_id || s.truthTag.grid_product_id) === productId &&
      s.stage !== 'pointRequest' &&
      s.stage !== 'pointResponse' &&
      s.stage !== 'infoboxDisplay'
    );
    if (previousStages.length > 0) {
      // seriesFrameMint is a START stage (task #14, 2026-07-18): a re-minted series frame is a NEW
      // chain on a stable product_id (series_*_h0 is reused every refresh) — comparing its tag
      // backward against the superseded chain's commit produced the false-MISMATCH spam.
      const isStartStage = stageName === "backendResponse" || stageName === "cacheRead" || stageName === "seriesFrameMint";
      // Lineage = CHAIN (task #14 round 2, 2026-07-18): compare only against the last stage of the
      // SAME traceId. The zoomlab battery proved same-product chains legitimately INTERLEAVE — the
      // engine re-uploads HELD grids (bridge promote, coarse-base, ring-fill) with their original
      // chain's tag while newer chains mint/commit on the same stable series product_id, so
      // "last same-product stage" routinely belongs to a DIFFERENT legit chain and the cross-chain
      // compare fired false MISMATCH errors on every interleave. Within-chain divergence (same
      // traceId, different dataHash/bounds/product across stages) is the real "rendered something
      // other than what was committed" detector and remains fully compared; chain DEATH is the
      // absence watchdog's job.
      const ownStages = previousStages.filter(s => s.truthTag.traceId === traceId);
      const prev = ownStages.length > 0 ? ownStages[ownStages.length - 1] : null;
      if (!isStartStage && prev) {
        if (prev.truthTag.product_id !== productId) {
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

  _trackChainProgress(stageName, truthTag, traceId, productId);

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

// ── A1 STAGE-ABSENCE WATCHDOG (audit #18, 2026-07-11) ─────────────────────────────────────────
// The tracker detected DIVERGENCE but not DEATH: a chain that dies after any stage left
// verdict=PASS — and this week's hard bugs all presented as silence (stranded-fetch wedge,
// safety-net exhaustion, 30s fastpath stalls). Invariant: a chain that starts recording must
// reach a terminal stage (webglUpload+) within ABSENCE_WINDOW_MS — unless a NEWER chain for the
// same DISPLAY LANE (domain|layer, model-agnostic: the display shows one model per layer, so a
// model switch legitimately supersedes) replaces it, or resetTruthTracker fires (transitions).
// Scope inherits the existing call-site gates (GFS-waves@h0 + wind@h0 + series h0) — this is
// NOT the A2 scope extension. Fires ONCE per dead chain: console.warn + verdict.failReasons +
// window.__WEATHER_TRUTH_ABSENT__ (capped ring). verdict.status is left untouched.
export const ABSENCE_WINDOW_MS = 30000; // > worst legit gap seen (style-deferred commits ~10s at boot)
const _ARMING_STAGES = new Set(["backendResponse", "cacheRead", "mappedGrid", "cacheWrite", "orchestratorCommit", "seriesFrameMint"]);
const _TERMINAL_STAGES = new Set(["webglUpload", "webglRender", "animationFrame"]);
const _pendingChains = new Map(); // lane -> {traceId, productId, lane, lastStage, firstAt, lastAt}
let _absenceTimer = null;

function _trackChainProgress(stageName, truthTag, traceId, productId) {
  const lane = `${truthTag.domain || "?"}|${truthTag.layer || "?"}`;
  if (_TERMINAL_STAGES.has(stageName)) {
    // Any terminal on the lane means the lane is alive — its pending chain either completed
    // (same traceId) or was superseded by whatever just rendered.
    _pendingChains.delete(lane);
    return;
  }
  if (!_ARMING_STAGES.has(stageName)) return; // point/infobox stages are not chain stages
  const now = Date.now();
  const existing = _pendingChains.get(lane);
  if (existing && existing.traceId === traceId) {
    existing.lastStage = stageName;
    existing.lastAt = now;
  } else {
    // New chain for the lane: the previous pending one (if any) was superseded — not absent.
    _pendingChains.set(lane, { traceId, productId, lane, lastStage: stageName, firstAt: now, lastAt: now });
  }
  if (!_absenceTimer && typeof window !== "undefined" && typeof setInterval === "function") {
    _absenceTimer = setInterval(() => _sweepAbsentChains(Date.now()), 10000);
  }
}

export function _sweepAbsentChains(nowMs) {
  if (typeof window === "undefined" || !window.__WEATHER_TRUTH_TRACE__) return [];
  const fired = [];
  for (const [lane, entry] of Array.from(_pendingChains.entries())) {
    if (nowMs - entry.lastAt > ABSENCE_WINDOW_MS) {
      _pendingChains.delete(lane); // fire once
      const silentSec = Math.round((nowMs - entry.lastAt) / 1000);
      const reason = `ABSENT: ${lane} chain ${entry.traceId} (${entry.productId || "no-product"}) died after ${entry.lastStage} (${silentSec}s silent, no terminal stage)`;
      console.warn(`[WEATHER_TRUTH] ${reason}`);
      try {
        window.__WEATHER_TRUTH_TRACE__.verdict.failReasons.push(reason);
        const ring = (window.__WEATHER_TRUTH_ABSENT__ = window.__WEATHER_TRUTH_ABSENT__ || []);
        ring.push({ ...entry, reason, firedAt: nowMs });
        if (ring.length > 20) ring.shift();
      } catch (e) { /* diagnostics must never throw */ }
      fired.push(reason);
    }
  }
  return fired;
}

// ── DELIBERATE-TRANSITION TERMINAL (2026-08-09, Report 11.0 R11-01/R11-15) ────────────────────
// The 12-stage vocabulary was success-shaped: a chain abandoned by a DELIBERATE renderer
// transition (the WebGL guardrail flipping to the raster/canvas fallback) had no terminal, so
// 30 s later the absence watchdog reported it "died after <stage>" — a false death that polluted
// verdict.failReasons and misdirected live forensics (observed in the 2026-08-09 Codex episode).
// This is the cancel terminal: the transition owner calls it, each pending chain is closed as
// CANCELLED (informational — a cancel is not a failure, so verdict.status and failReasons are
// untouched), and the watchdog never fires for it. Ring-capped like the absent ring.
export function cancelTruthChains(reason) {
  const cancelled = [];
  for (const [lane, entry] of Array.from(_pendingChains.entries())) {
    _pendingChains.delete(lane);
    cancelled.push({ ...entry, reason, cancelledAt: Date.now() });
    console.log(`[WEATHER_TRUTH] Stage: chainCancelled | TraceID: ${entry.traceId} | ` +
                `Product: ${entry.productId || "no-product"} | Status: CANCELLED | ${reason}`);
  }
  if (cancelled.length && typeof window !== "undefined") {
    try {
      const ring = (window.__WEATHER_TRUTH_CANCELLED__ = window.__WEATHER_TRUTH_CANCELLED__ || []);
      ring.push(...cancelled);
      while (ring.length > 20) ring.shift();
    } catch (e) { /* diagnostics must never throw */ }
  }
  return cancelled.length;
}

export function _getPendingChainsForTest() {
  return new Map(_pendingChains);
}

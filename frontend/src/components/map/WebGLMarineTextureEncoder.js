import { renderMaskToCanvas, maskDensityPxPerDeg, incomingMaskDensityPxPerDeg } from './WebGLMarineMaskRenderer';
import { recordMarineEvent } from './marineForensics';   // __RAW_FORENSIC__ ring buffer
import { applyPatchCarry } from './maskSmoothing';
import { writeCoastDistanceField } from './maskCoastSDF'; // signed dist-to-coast → mask .b (opt-in, best-in-class crisp coast)
import {
  getEncoderScratchBuffers,
  scaleUnitDirByConfidence,
  extrapolateOceanData,
  dilateDirectionField,
  FloatArrayConstructor,
} from './WebGLMarineFieldMath';
import { getMarineGeoData } from './WebGLMarineGeoData';
import {
  createShader,
  createProgram,
  unbindTexture,
  bindTexture,
  safeDeleteTexture
} from './WebGLWindUtils';

export {
  createShader,
  createProgram,
  unbindTexture,
  bindTexture,
  safeDeleteTexture
};

// Re-exported from WebGLMarineFieldMath (moved there for LOC compliance) so existing importers and
// unit tests that pull these from THIS module keep resolving them.
export { scaleUnitDirByConfidence, extrapolateOceanData, dilateDirectionField } from './WebGLMarineFieldMath';

// --- Texture Lifecycle Utilities ---
// Moved to WebGLMarineTextureState.js on 2026-08-11 for the 800-LOC ratchet (this file was at 799
// and the getParameter batching took it to 832). Re-exported here so every existing importer and
// unit test that pulls these from THIS module keeps resolving them — the same move this file
// already made for WebGLMarineFieldMath above.
export { withTextureState, createTexture, updateTexture } from './WebGLMarineTextureState';
import { withTextureState, createTexture, updateTexture } from './WebGLMarineTextureState';

// --- Land Mask Rendering imported from WebGLMarineMaskRenderer ---
// --- The Ocean GPU Grid Texture Compressor ---

export function encodeMarineTexture(gl, waveGrid, landGeoJSON, engine, opts) {
  // ⭐ THE WHOLE ENCODE IS ONE STATE SCOPE. This function creates up to FIVE textures per commit
  // (wave, chlorophyll, bathymetry, mask, score); each used to open with its own pair of
  // `gl.getParameter` round trips to the GPU process. One pair now covers the batch — measured at
  // 1465.9 ms / 4.6% of a 30 s profile on deploy `23743f63`. Semantics are unchanged: only our own
  // code runs between these texture ops, so no external observer can see the intermediate states,
  // and `withTextureState` restores in a `finally`.
  // Static telemetry props below (`encodeMarineTexture._lastSig` etc.) still resolve to THIS
  // exported function, so the encode-dup counters are untouched.
  return withTextureState(gl, () => _encodeMarineTexture(gl, waveGrid, landGeoJSON, engine, opts));
}

// Exported ONLY so the source-text wiring assertions in WebGLMarineTextureEncoder.dilation.test.js
// can still see the encode body after it moved inside the state scope. Those tests check the
// presence AND ORDER of guards by reading `.toString()`; they had already been adapted once for the
// WebGLMarineFieldMath extraction (see their own note about "the import indirection").
// ⚠️ A source-text assertion is a weak needle — it also fires on a comment reflow and cannot fail on
// a behavioural regression. Preserved here rather than deleted, but it is not real coverage of the
// guards it names; behavioural tests for those live in this module's other suites.
export function _encodeMarineTexture(gl, waveGrid, landGeoJSON, engine, opts) {
  // standalone (BLEND BOTH coarse-base capture): create FRESH, independently-owned textures and never touch the
  // engine's resident wave/chl/bath set or its cached land mask. Required because the resident textures are
  // reused/realloc'd in place on every commit — a naive "retain the old coarse textures" would hand back a
  // texture the next regional commit deletes. The caller (engine._captureCoarseBase) owns + frees these.
  const standalone = !!(opts && opts.standalone);
  const { vectors, cols, rows, bounds } = waveGrid;
  if (!vectors?.length || !cols || !rows || cols < 2 || rows < 2) return null;

  // §4.5 ENCODE-DUP TELEMETRY (2026-07-13, instrument-first per the perf-arc discipline —
  // NO behavior change): the boot path encodes the SAME product multiple times (user log
  // round-12: three identical 629-vector coarse encodes back-to-back) and commit storms
  // re-encode identical grids. Count consecutive same-identity encodes so the dedup arc has
  // a live baseline + the forensic ring names the duplicates. Standalone (coarse-base
  // capture) encodes are a different purpose — excluded.
  if (!standalone) {
    const _sig = `${waveGrid.productId || waveGrid.product_id || ''}:${waveGrid.hourOffset || 0}:` +
      `${waveGrid.__componentLayer || 'waves'}:${cols}x${rows}:${waveGrid.__sourceModel || ''}:${!!waveGrid.ratingMode}`;
    if (encodeMarineTexture._lastSig === _sig) {
      encodeMarineTexture._dupRun = (encodeMarineTexture._dupRun || 0) + 1;
      if (typeof window !== 'undefined') {
        const g = window.__RAW_GPU__ || (window.__RAW_GPU__ = {});
        g.encodeDupCount = (g.encodeDupCount || 0) + 1;
      }
      // Ring only on the first few of a run (a commit storm must not flood the ring).
      if (encodeMarineTexture._dupRun <= 3) {
        recordMarineEvent('encode_dup', { sig: _sig, run: encodeMarineTexture._dupRun });
      }
    } else {
      encodeMarineTexture._lastSig = _sig;
      encodeMarineTexture._dupRun = 0;
    }
  }

  const activeLayer = waveGrid.__componentLayer || 'waves';
  const N = cols * rows;

  // MOTION-UNLOCK (§4.2, 2026-07-13): rating grids mask open-ocean cells (is_valid=false) so the
  // band colors stay a coastal ribbon — but those cells still carry the backend's honest u/v/height
  // (rating_transform_grid only rewrites RATED cells). Build a parallel MOTION-water array (geographic
  // water = color-water OR masked-with-data) so dataMask.g can carry it; the particle shaders lift
  // their land checks to max(mask.r, mask.g * u_motionUnlock) — crests ride the real swell over the
  // whole ocean in rating mode while band COLORS stay untouched. Non-rating grids pass null → the
  // geo derivation and its cache behave byte-identically. Kill/enable: __RAW_RATING_MOTION_UNLOCK__.
  const ratingMotion = !!waveGrid.ratingMode;

  // §0e ANIM-PHYS (2026-07-14, user directive "animations identical rating-on/off"): rating
  // grids carry the surf SCORE in `speed` (the band's color channel) and the HONEST height in
  // `phys_speed` (backend rating_transform_grid). Build the honest field alongside: the MAIN
  // wave texture drives draw/advect with physics while a score-only variant feeds the heatmap
  // (bound at the engine's heatmap site). Kill: __RAW_DISABLE_ANIM_PHYS__ = true → no phys
  // field, score stays in the shared channel — pre-§0e behavior end to end.
  const animPhysOn = ratingMotion && !standalone &&
    (typeof window === 'undefined' || window.__RAW_DISABLE_ANIM_PHYS__ !== true);
  const hPhys = animPhysOn ? new FloatArrayConstructor(N) : null;

  // Reusable scratch buffers to avoid TypedArray allocation in hot path
  const scratch = getEncoderScratchBuffers(N);
  const uArr = scratch.uArr.subarray(0, N);
  const vArr = scratch.vArr.subarray(0, N);
  const hArr = scratch.hArr.subarray(0, N);
  const pArr = scratch.pArr.subarray(0, N);
  const oceanArr = scratch.oceanArr.subarray(0, N);
  const confArr = scratch.confArr.subarray(0, N);
  const dataWave = scratch.dataWave.subarray(0, N * 4);
  const motionArr = ratingMotion ? scratch.motionArr.subarray(0, N) : null;
  confArr.fill(1.0);   // default: fully confident (products without dir_confidence are unchanged)

  const numGridToProcess = Math.min(vectors.length, N);
  let flatSpeedNonzeroCount = 0;

  for (let i = 0; i < numGridToProcess; i++) {
    const v = vectors[i];
    if (!v) {
      oceanArr[i] = 0;
      if (motionArr) motionArr[i] = 0;
      if (hPhys) hPhys[i] = 0;
      continue;
    }
    const hasSub = activeLayer !== 'waves' && v[activeLayer];
    const sub = hasSub ? v[activeLayer] : {};
    
    let uVal = hasSub && typeof sub.u === 'number' ? sub.u : (typeof v.u === 'number' ? v.u : 0);
    let vVal = hasSub && typeof sub.v === 'number' ? sub.v : (typeof v.v === 'number' ? v.v : 0);
    const speed = hasSub && typeof sub.speed === 'number' ? sub.speed : (typeof v.speed === 'number' ? v.speed : 0);
    const height = hasSub && typeof sub.height === 'number' ? sub.height : (typeof v.height === 'number' ? v.height : (hasSub ? sub.speed || 0 : v.speed || 0));
    const period = hasSub && typeof sub.period === 'number' ? sub.period : (typeof v.period === 'number' ? v.period : 0);
    
    const direction = hasSub && typeof sub.direction === 'number' ? sub.direction : (typeof v.direction === 'number' ? v.direction : undefined);

    // The waves layer reads TOP-LEVEL u/v/direction, but coarse products mirror those from a v.waves
    // sub-record whose is_valid:false does NOT survive the mirror — land cells arrive top-level as
    // {direction: 0, u: 0, v: 0} with no is_valid. Consult the sub-record so land is land (2026-07-03).
    const waveSub = activeLayer === 'waves' && v.waves && typeof v.waves === 'object' ? v.waves : null;

    // Honor the backend's explicit is_valid=false (land / no-data / surf-band open-ocean mask) so those cells
    // render transparent. Only falls through to it when isOcean isn't set, so existing isOcean logic is intact.
    const isOcean = hasSub && sub.isOcean !== undefined ? sub.isOcean
      : (v.isOcean !== undefined ? v.isOcean
         : (v.is_valid === false || (waveSub && waveSub.is_valid === false) ? false : true));

    // Conform direction directly to unit vectors in uArr/vArr if uVal/vVal are zero — OCEAN cells only
    // (2026-07-03): invalid cells carry direction 0 as a PLACEHOLDER, and synthesizing from it stamped a
    // phantom due-south unit vector on every landmass — a coastline-wide fake direction seam against any
    // northish sea (the land-blind fade's second costume, after the zero-vector one). Left at zero here,
    // such cells get a REAL neighbor direction from extrapolateOceanData / dilateDirectionField below.
    if (uVal === 0 && vVal === 0 && direction !== undefined && isOcean) {
      const dirRad = direction * (Math.PI / 180);
      uVal = -Math.sin(dirRad);
      vVal = -Math.cos(dirRad);
    }
    
    uArr[i] = uVal;
    vArr[i] = vVal;
    hArr[i] = height;
    pArr[i] = period;
    // §0e: the honest height — phys_speed when the backend carried it (rated/masked cells),
    // else `height` (untouched cells' speed IS honest). waveSub covers the conjoined mirror;
    // mappers/conform carry the top-level field.
    if (hPhys) {
      const _pv = typeof v.phys_speed === 'number' ? v.phys_speed
        : (typeof v.physSpeed === 'number' ? v.physSpeed
           : (waveSub && typeof waveSub.phys_speed === 'number' ? waveSub.phys_speed : null));
      hPhys[i] = _pv !== null ? _pv : height;
    }
    oceanArr[i] = isOcean ? 1 : 0;
    // Motion-water: color-water OR a masked cell that still carries real field data. True LAND
    // arrives as is_valid=false with all-zero u/v/height/period, so it stays 0 on both channels.
    if (motionArr) {
      motionArr[i] = (isOcean || uVal !== 0 || vVal !== 0 || height > 0 || period > 0) ? 1 : 0;
    }

    // §0B-a: per-cell direction confidence (coarse NOAA products only; null/absent = 1.0). Ocean
    // cells only — land/invalid texels keep 1.0 so dilated/extrapolated directions stay full-strength
    // (they're mask-culled for rendering; their job is stabilizing the bilinear direction field).
    // Read chain covers every vector shape that reaches the engine: mapper camelCase (top-level +
    // subs), the useMarineWindData conform (top-level + active-layer sub), raw backend snake_case
    // (series frames commit flat GridVector dicts), and the waves-mirror sub.
    const confVal = hasSub && typeof sub.dirConfidence === 'number' ? sub.dirConfidence
      : (hasSub && typeof sub.dir_confidence === 'number' ? sub.dir_confidence
         : (typeof v.dirConfidence === 'number' ? v.dirConfidence
            : (typeof v.dir_confidence === 'number' ? v.dir_confidence
               : (waveSub && typeof waveSub.dirConfidence === 'number' ? waveSub.dirConfidence
                  : (waveSub && typeof waveSub.dir_confidence === 'number' ? waveSub.dir_confidence : null)))));
    if (isOcean && confVal !== null) {
      confArr[i] = Math.max(0, Math.min(1, confVal));
    }

    if (speed > 0) {
      flatSpeedNonzeroCount++;
    }
  }

  // Clear any remaining elements in scratch buffers
  if (numGridToProcess < N) {
    uArr.fill(0, numGridToProcess, N);
    vArr.fill(0, numGridToProcess, N);
    hArr.fill(0, numGridToProcess, N);
    pArr.fill(0, numGridToProcess, N);
    oceanArr.fill(0, numGridToProcess, N);
    if (motionArr) motionArr.fill(0, numGridToProcess, N);
    if (hPhys) hPhys.fill(0, numGridToProcess, N);
  }

  if (!encodeMarineTexture._forensicCount) encodeMarineTexture._forensicCount = 0;
  if (encodeMarineTexture._forensicCount < 3) {
    let minS = Infinity, maxS = 0, sumS = 0, cnt = 0;
    for (let fi = 0; fi < numGridToProcess; fi++) {
      if (oceanArr[fi] !== 0 && hArr[fi] > 0) {
        cnt++;
        if (hArr[fi] < minS) minS = hArr[fi];
        if (hArr[fi] > maxS) maxS = hArr[fi];
        sumS += hArr[fi];
      }
    }
    const meanS = cnt > 0 ? sumS / cnt : 0;
    console.log(`[FORENSIC-ENCODE] encodeMarineTexture input: ${numGridToProcess} vectors, ${cnt} ocean w/speed, speed: min=${minS.toFixed(3)}m max=${maxS.toFixed(3)}m mean=${meanS.toFixed(3)}m (${(meanS*3.281).toFixed(1)}ft), cols=${cols}, rows=${rows}`);
    encodeMarineTexture._forensicCount++;
  }

  const isGlobal = bounds ? !(bounds.east - bounds.west < 359.0) : false;

  // §0e: extrapolateOceanData MUTATES ocean/u/v alongside h — the legacy call below must keep
  // its historical side-effects byte-identical for the band (hArr carries the score on rating
  // grids), so the honest field extrapolates on PRE-CALL clones instead of sharing state.
  let _physClones = null;
  if (hPhys) {
    _physClones = {
      u: FloatArrayConstructor.from(uArr),
      v: FloatArrayConstructor.from(vArr),
      p: FloatArrayConstructor.from(pArr),
      o: Uint8Array.from(oceanArr),
    };
  }

  // LAND-AWARE FETCH (2026-08-18): snapshot the TRUE land mask FIRST. extrapolateOceanData sets
  // oceanArr[idx] = 1 on every cell it fills, so after it runs the array no longer distinguishes
  // "ocean" from "land we invented a value for" — and those filled cells are exactly the ones the
  // land-aware fetch must exclude. Reading the flag after extrapolation made the fix inert.
  const trueOceanArr = Uint8Array.from(oceanArr);
  extrapolateOceanData(uArr, vArr, hArr, pArr, oceanArr, cols, rows, isGlobal);
  if (hPhys && _physClones) {
    extrapolateOceanData(_physClones.u, _physClones.v, hPhys, _physClones.p, _physClones.o, cols, rows, isGlobal);
    _physClones = null;
  }

  // LAND-AWARE SEAM COHERENCE (2026-07-03): fill DIRECTION into the zero-vector texels the pass above
  // doesn't reach, so the shaders' bilinear-|waveVec| coherence measure stops collapsing beside every
  // coastline (the "missing patches" regression). Direction only — height/period/mask untouched.
  // Kill switch (forensics): window.__RAW_DISABLE_DIR_DILATION__ = true.
  if (typeof window === 'undefined' || window.__RAW_DISABLE_DIR_DILATION__ !== true) {
    const dilatedCount = dilateDirectionField(uArr, vArr, cols, rows, isGlobal);
    if (typeof window !== 'undefined') {
      window.__MARINE_DIR_DILATION__ = { filled: dilatedCount, cols, rows, isGlobal, at: Date.now() };
    }
  }

  // Shelf-distance / bathymetry / chlorophyll / ocean-mask channels (viewport-cached in
  // WebGLMarineGeoData). Extracted for LOC compliance — pure geo derivation, no engine/mask coupling.
  // motionArr (rating grids only) rides into dataMask.g; null leaves the derivation byte-identical.
  const { dataBath, dataChl, dataMask } = getMarineGeoData(cols, rows, bounds, oceanArr, numGridToProcess, isGlobal, motionArr, trueOceanArr);

  // §4.2 A/B DISCRIMINATOR: if the unlock A/B still shows locked animations, this tells the next
  // probe WHICH root is live — unlockable = masked-ocean cells the g-channel frees; withMotion =
  // how many of those actually carry nonzero u/v after extrapolation/dilation. withMotion≈0 means
  // the mapper/conform strips u/v from is_valid=false cells BEFORE the encode (fix there, not here).
  if (motionArr && typeof window !== 'undefined') {
    let _unlockable = 0, _withMotion = 0;
    for (let i = 0; i < N; i++) {
      if (motionArr[i] === 1 && oceanArr[i] === 0) {
        _unlockable++;
        if (uArr[i] !== 0 || vArr[i] !== 0) _withMotion++;
      }
    }
    window.__RAW_MOTION_UNLOCK_ENCODE__ = {
      unlockable: _unlockable, withMotion: _withMotion,
      cols, rows, at: Date.now()
    };
  }

  // §0B-a: confidence consumption gate + telemetry. Kill switch __RAW_DISABLE_DIR_CONFIDENCE__=true
  // restores full-strength unit directions everywhere (forensic A/B).
  const confEnabled = typeof window === 'undefined' || window.__RAW_DISABLE_DIR_CONFIDENCE__ !== true;
  const confStrength = (typeof window !== 'undefined' && typeof window.__RAW_CONF_FADE_STRENGTH__ === 'number')
    ? window.__RAW_CONF_FADE_STRENGTH__ : 0.75;
  let confScaledCells = 0;
  let confMin = 1.0;

  for (let i = 0; i < N; i++) {
    const u = uArr[i];
    const v_y = vArr[i];
    // §0e: the MAIN texture packs the HONEST height on rating grids (animation channel);
    // the score variant for the heatmap is built after the seam block below.
    const height = hPhys ? hPhys[i] : hArr[i];
    const periodVal = pArr[i];

    let nu, nv;
    const mag = Math.sqrt(u * u + v_y * v_y);
    if (mag > 0.001) {
      let su = u / mag;
      let sv = v_y / mag;
      if (confEnabled && confArr[i] < 1.0) {
        const scaled = scaleUnitDirByConfidence(su, sv, confArr[i], confStrength);
        su = scaled[0]; sv = scaled[1];
        confScaledCells++;
        if (confArr[i] < confMin) confMin = confArr[i];
      }
      nu = Math.max(0.0, Math.min(1.0, su * 0.5 + 0.5));
      nv = Math.max(0.0, Math.min(1.0, sv * 0.5 + 0.5));
    } else {
      nu = 0.5;
      nv = 0.5;
    }
    const hEnc = Math.max(0.0, Math.min(1.0, height / 10.0));
    const periodEnc = periodVal > 0 ? Math.max(0.0, Math.min(1.0, periodVal / 20.0)) : 0.0;

    dataWave[i * 4 + 0] = Math.floor(nu * 255);
    dataWave[i * 4 + 1] = Math.floor(nv * 255);
    dataWave[i * 4 + 2] = Math.floor(hEnc * 255);
    dataWave[i * 4 + 3] = Math.floor(periodEnc * 255);
  }

  if (typeof window !== 'undefined') {
    window.__MARINE_DIR_CONFIDENCE__ = {
      enabled: confEnabled, scaledCells: confScaledCells, strength: confStrength,
      min: +confMin.toFixed(3), cols, rows, at: Date.now()
    };
  }

  // Compute WebGL texture stats for GFS waves live trace
  if (waveGrid.__sourceModel === 'GFS' && activeLayer === 'waves') {
    let minH = 1.0, maxH = 0.0, sumH = 0.0, nonzeroCount = 0;
    let validOceanCount = 0;
    for (let i = 0; i < cols * rows; i++) {
      const h = dataWave[i * 4 + 2] / 255.0;
      if (h > 0) {
        nonzeroCount++;
        sumH += h;
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
      if (dataMask[i * 4 + 0] === 255) {
        validOceanCount++;
      }
    }
    const meanH = nonzeroCount > 0 ? sumH / nonzeroCount : 0;
    
    if (typeof window !== 'undefined') {
      window.__GFS_WAVES_SINGLE_SLICE_TRACE__ = window.__GFS_WAVES_SINGLE_SLICE_TRACE__ || {};
      window.__GFS_WAVES_SINGLE_SLICE_TRACE__.webglTextureUpload = {
        uploadProductId: waveGrid.productId || null,
        uploadReason: window.__WEBGL_MARINE_UPLOAD_REASON__ || 'unknown',
        activeLayer: activeLayer,
        cols: cols,
        rows: rows,
        vectorCount: vectors.length,
        flatSpeedNonzeroCount: flatSpeedNonzeroCount,
        encodedTextureMin: nonzeroCount > 0 ? minH : 0.0,
        encodedTextureMax: maxH,
        encodedTextureMean: meanH,
        encodedNonzeroPixelCount: nonzeroCount,
        maskValidOceanCount: validOceanCount,
        colorRampName: window.__WEBGL_MARINE_THEME__ || 'default',
        opacity: window.__WEBGL_MARINE_OPACITY__ || 0.65,
        renderDecision: (nonzeroCount > 0 && validOceanCount > 0) ? 'render' : 'skip'
      };
      if (typeof window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__ === 'function') {
        window.__UPDATE_GFS_WAVES_SINGLE_SLICE_VERDICT__();
      }
    }
  }

  if (isGlobal) {
    for (let r = 0; r < rows; r++) {
      const idx0 = (r * cols + 0) * 4;
      const idxN = (r * cols + cols - 1) * 4;

      const u0 = (dataWave[idx0 + 0] / 255.0) * 2.0 - 1.0;
      const v0 = (dataWave[idx0 + 1] / 255.0) * 2.0 - 1.0;
      const uN = (dataWave[idxN + 0] / 255.0) * 2.0 - 1.0;
      const vN = (dataWave[idxN + 1] / 255.0) * 2.0 - 1.0;

      const avgU = (u0 + uN) * 0.5;
      const avgV = (v0 + vN) * 0.5;
      const mag = Math.sqrt(avgU * avgU + avgV * avgV);

      let nu = 0.5, nv = 0.5;
      if (mag > 0.001) {
        let su = avgU / mag;
        let sv = avgV / mag;
        // Re-normalizing strips the §0B-a confidence scale — reapply the weaker edge's confidence.
        if (confEnabled) {
          const cWrap = Math.min(confArr[r * cols], confArr[r * cols + cols - 1]);
          if (cWrap < 1.0) {
            const scaled = scaleUnitDirByConfidence(su, sv, cWrap, confStrength);
            su = scaled[0]; sv = scaled[1];
          }
        }
        nu = Math.max(0.0, Math.min(1.0, su * 0.5 + 0.5));
        nv = Math.max(0.0, Math.min(1.0, sv * 0.5 + 0.5));
      }

      const avgH = Math.floor((dataWave[idx0 + 2] + dataWave[idxN + 2]) * 0.5);
      const avgP = Math.floor((dataWave[idx0 + 3] + dataWave[idxN + 3]) * 0.5);

      dataWave[idx0 + 0] = dataWave[idxN + 0] = Math.floor(nu * 255);
      dataWave[idx0 + 1] = dataWave[idxN + 1] = Math.floor(nv * 255);
      dataWave[idx0 + 2] = dataWave[idxN + 2] = avgH;
      dataWave[idx0 + 3] = dataWave[idxN + 3] = avgP;
    }
  }

  // §0e: score variant for the heatmap — identical u/v/period bytes (post-seam-average), b =
  // the score field (legacy hArr, extrapolated by the legacy call). Rating grids are never
  // global (the transform is skipped on global extent) so no extra seam handling is needed.
  let dataWaveScore = null;
  if (hPhys) {
    dataWaveScore = new Uint8Array(dataWave);
    for (let i = 0; i < N; i++) {
      dataWaveScore[i * 4 + 2] = Math.floor(Math.max(0.0, Math.min(1.0, hArr[i] / 10.0)) * 255);
    }
  }

  const allocatedTextures = [];
  let waveTex, chlTex, bathTex, maskTex;
  let standaloneMaskDims = null;   // dims of the standalone (coarse-base) mercator mask, if built
  let scoreTex = null;
  try {
    if (!standalone && engine && engine._residentWaveTex && engine._texWidth === cols && engine._texHeight === rows) {
      waveTex = engine._residentWaveTex;
      chlTex = engine._residentChlTex;
      bathTex = engine._residentBathTex;
      updateTexture(gl, waveTex, dataWave, cols, rows);
      updateTexture(gl, chlTex, dataChl, cols, rows);
      updateTexture(gl, bathTex, dataBath, cols, rows);
      // §0e score texture rides the same resident realloc-in-place contract.
      if (dataWaveScore) {
        if (engine._residentScoreTex) {
          updateTexture(gl, engine._residentScoreTex, dataWaveScore, cols, rows);
        } else {
          engine._residentScoreTex = createTexture(gl, gl.LINEAR, dataWaveScore, cols, rows);
        }
        scoreTex = engine._residentScoreTex;
      } else if (engine._residentScoreTex) {
        safeDeleteTexture(gl, engine._residentScoreTex, engine);
        engine._residentScoreTex = null;
      }
    } else {
      if (!standalone && engine) {
        if (engine._residentWaveTex) {
          // ⚠️ NO MANUAL DECREMENT (2026-08-04): `safeDeleteTexture` now accounts for every caller
          // from each texture's RECORDED dims, so these three subtract 3 x (w*h*4) themselves —
          // exactly the old `* 12`. Both would double-count, hiding a leak as the over-count did.
          safeDeleteTexture(gl, engine._residentWaveTex, engine);
          safeDeleteTexture(gl, engine._residentChlTex, engine);
          safeDeleteTexture(gl, engine._residentBathTex, engine);
        }
        if (engine._residentScoreTex) {
          safeDeleteTexture(gl, engine._residentScoreTex, engine);
          engine._residentScoreTex = null;
        }
      }
      waveTex = createTexture(gl, gl.LINEAR, dataWave, cols, rows);
      if (waveTex) allocatedTextures.push(waveTex);
      chlTex = createTexture(gl, gl.LINEAR, dataChl, cols, rows);
      if (chlTex) allocatedTextures.push(chlTex);
      bathTex = createTexture(gl, gl.LINEAR, dataBath, cols, rows);
      if (bathTex) allocatedTextures.push(bathTex);
      if (dataWaveScore) {
        scoreTex = createTexture(gl, gl.LINEAR, dataWaveScore, cols, rows);
        if (scoreTex) allocatedTextures.push(scoreTex);
      }
      if (!standalone && engine) {
        engine._residentWaveTex = waveTex;
        engine._residentChlTex = chlTex;
        engine._residentBathTex = bathTex;
        engine._residentScoreTex = scoreTex;
        engine._texWidth = cols;
        engine._texHeight = rows;
      }
    }

    if (standalone) {
      // Coarse-base wash needs a HIGH-RES MERCATOR mask, NOT the grid mask. The heatmap shader samples the ocean
      // mask with a mercator-projected mask_v (built for renderMaskToCanvas output); the grid mask is linear in
      // latitude, so sampling it with mask_v reads the wrong row (e.g. lat 28° → ~lat 7°) and masks the wash out
      // entirely. Render a dedicated mercator mask for THIS grid's bounds, owned by the base (never engine-cached).
      if (opts && opts.reuseMaskTex) {
        // §2d SHARED WORLD MASK: every coarse-global base carves the SAME geography — reuse the
        // caller-provided mask texture (ref-counted by the engine's _freeCoarseBase) instead of
        // rasterizing + uploading another ~32 MB copy. NOT pushed to allocatedTextures: ownership
        // stays with the refcount, and the error-cleanup path must not delete a shared texture.
        maskTex = opts.reuseMaskTex;
        standaloneMaskDims = opts.reuseMaskDims || null;
      } else if (landGeoJSON) {
        try {
          const maskCanvas = renderMaskToCanvas(landGeoJSON, bounds);
          // Recorded on the returned set (2026-07-16 staircase forensics): the damp sites need to
          // know whether the base's OWN mask is the dense tier (island halos bounded) or the
          // legacy 1024×512 (the damps' original rationale).
          standaloneMaskDims = { w: maskCanvas.width, h: maskCanvas.height };
          const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
          const prevFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
          maskTex = gl.createTexture();
          if (maskTex) allocatedTextures.push(maskTex);
          gl.bindTexture(gl.TEXTURE_2D, maskTex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);
          gl.bindTexture(gl.TEXTURE_2D, prevTex);
        } catch (e) {
          console.warn('[WebGLMarineTextureEncoder] standalone high-res mask failed, falling back to grid mask:', e && e.message);
          maskTex = createTexture(gl, gl.LINEAR, dataMask, cols, rows);
          if (maskTex) allocatedTextures.push(maskTex);
        }
      } else {
        maskTex = createTexture(gl, gl.LINEAR, dataMask, cols, rows);
        if (maskTex) allocatedTextures.push(maskTex);
      }
    } else if (landGeoJSON) {
      // LAST-MILE mask-source authority (2026-07-04, the Palos-Verdes "half underwater" root):
      // commits funnel in from many paths (data_commit, scrub-settle sharpen, series frames,
      // land_mask_res_swap) each carrying whatever landGeoJSON reference its caller held — a
      // commit racing the 50m→10m swap re-encoded a REGIONAL mask from the 50m polygons, whose
      // generalization error cuts ~2 km inland at PV Estates (debug-mode 'mask' showed the ocean
      // intrusion while the separately-cached 10m texture read correct land). Choose the mask
      // source HERE, at the single point every commit passes through: regional bounds always
      // prefer the 10m cache once it exists (global spans keep the cheap 50m — 1024px world
      // masks cannot resolve 10m detail anyway).
      let effectiveGeoJSON = landGeoJSON;
      try {
        const _hires = (typeof window !== 'undefined') && window.__LAND_GEOJSON_HIRES_CACHE__;
        const _span = bounds
          ? (((bounds.east < bounds.west) ? bounds.east + 360 : bounds.east) - bounds.west)
          : 360;
        if (_hires && _hires.features && _hires.features.length && _span < 30) {
          effectiveGeoJSON = _hires;
        }
      } catch (e) { /* keep the caller's geojson */ }

      const boundsChanged = !engine || !engine._cachedMaskBounds ||
        engine._cachedMaskBounds.west !== bounds.west ||
        engine._cachedMaskBounds.south !== bounds.south ||
        engine._cachedMaskBounds.east !== bounds.east ||
        engine._cachedMaskBounds.north !== bounds.north;

      if (engine && engine._cachedMaskTex && effectiveGeoJSON === engine._cachedMaskGeoJSON && !boundsChanged) {
        maskTex = engine._cachedMaskTex;
        if (engine) engine._lastMaskEncodeMode = 'reuse'; // DIAG (item ①): patched mask retained → source_not_ready no-op is HARMLESS
      } else if (
        // ITEM ① RETAIN-PATCHED (2026-07-05, live-confirmed): a REBUILD arriving while the basemap-water
        // source is mid-load encodes PATCH-LESS, and the trailing refreshMaskWithBasemapWater no-ops
        // (source_not_ready) → piers/canals animate for one commit until the idle/source-ready re-drive
        // (the Long Beach idle glitch-cycle). Keep the resident PATCHED texture for THIS commit instead:
        // the render's decoupled maskBounds (engine.js ~708) sample it at its OWN _cachedMaskBounds, so
        // retaining is geometry-safe — and the layer only sets _maskRetainPatchedOk when the viewport is
        // fully INSIDE those bounds (a pan to a different coast falls through to the normal rebuild).
        // _cachedMaskGeoJSON/_cachedMaskBounds stay untouched (they describe the retained texture); the
        // next source-ready commit rebuilds normally. Fail-open: undefined stamps (other setWaveData
        // callers) skip this branch. Kill switch: window.__RAW_DISABLE_MASK_RETAIN__ = true.
        engine && engine._cachedMaskTex &&
        engine._maskSourceReady === false && engine._maskRetainPatchedOk === true &&
        !(typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_RETAIN__ === true) &&
        // RETAIN UPGRADE GUARD (2026-07-06, "halo band on islands at mid zoom after a full
        // zoom-out"): after a world round-trip the resident is the WORLD-tier mask, whose bounds
        // contain EVERY viewport — so the containment stamp holds on the way back in while
        // basemap tiles load, and this branch silently held the ~11 px/° world mask in place of
        // the ~128 px/° mid rebuild (a downgrade-hold: soft island edges render as the halo,
        // stuck until the next ladder step forces a commit). Retaining is only for a resident at
        // least comparable in density to what this rebuild would produce; the rebuild path keeps
        // patch truth via carry-forward (2a894207). Fail-open on missing dims (older callers).
        // Kill: __RAW_DISABLE_MASK_RETAIN_UPGRADE_GUARD__ (restores the unconditional retain).
        (
          (typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_RETAIN_UPGRADE_GUARD__ === true) ||
          !engine._cachedMaskTexDims || !engine._cachedMaskBounds ||
          maskDensityPxPerDeg(engine._cachedMaskTexDims, engine._cachedMaskBounds) >=
            incomingMaskDensityPxPerDeg(bounds) * 0.75 ||
          // CLOSE-ZOOM CARVE-OUT (2026-07-06 same-day regression, "heatmap covering land at close
          // zoom"): a forced rebuild here is NE-coastline-ONLY — the basemap-water patch that
          // carves intracoastal/waterfront land is async and tile-gated (legitimately blocked
          // mid-gesture), so at close zoom the upgrade rebuild showed waves over fine-grained
          // land until the repaint. NE truth is only adequate at the mid/wide tiers (the halo
          // class this guard exists for), so the forced rebuild requires incoming span ≥ 8°;
          // closer commits retain the patched resident as before — the next source-ready commit
          // rebuilds crisp AND patched (the pre-guard behavior the user verified as self-fixing).
          // ⚠️ DENSITY FLOOR (same-day #2, "heatmap covering land over the Bahamas"): the FL
          // regression's wrongly-rebuilt resident was a DENSE mid mask (~256 px/°, patched) —
          // worth retaining. A WORLD-tier resident (~11 px/°) cannot carve island cays AT ALL,
          // so retaining it at close zoom paints waves straight over the Bahamas; it must
          // rebuild (NE-10m carves cays crisply; no basemap-patch dependency out there). Retain
          // only residents dense enough to hold island truth (≥32 px/° ≈ 3.5 km/px).
          ((bounds ? ((bounds.east < bounds.west ? bounds.east + 360 : bounds.east) - bounds.west) : 360) < 8 &&
            maskDensityPxPerDeg(engine._cachedMaskTexDims, engine._cachedMaskBounds) >= 32)
        )
      ) {
        maskTex = engine._cachedMaskTex;
        engine._lastMaskEncodeMode = 'retain_patched_src_not_ready';
        if (typeof window !== 'undefined') {
          window.__RAW_MASK_RETAIN_COUNT__ = (window.__RAW_MASK_RETAIN_COUNT__ || 0) + 1;
        }
      } else if (
        // MASK NO-DOWNGRADE RETAIN (2026-07-06, the Florida z9-10.5 "waves/heatmap over land and
        // intracoastal for a second" report): a MID-TIER grid commit (span 10-30°) rebuilds this
        // mask at the 2048 tier (~870 m/px at span 16), replacing a crisp 4096 resident until the
        // fine grid returns ~1s later — the mid mask cannot carve barrier islands or the
        // intracoastal, so waves visibly ride over land in the window. When the RESIDENT texture
        // is meaningfully denser (px/° > 1.5× what this rebuild would produce) AND the layer
        // stamped viewport containment (_maskRetainPatchedOk — the same geometry safety as the
        // retain-patched branch above: decoupled maskBounds sample the texture at its OWN
        // geography), keep it for this commit; a commit whose rebuild would be as fine or finer
        // (the returning fine grid) falls through and rebuilds normally.
        // Kill: __RAW_DISABLE_MASK_NO_DOWNGRADE__. Telemetry: __RAW_MASK_RES_RETAIN_COUNT__.
        engine && engine._cachedMaskTex && engine._cachedMaskTexDims && engine._cachedMaskBounds &&
        engine._maskRetainPatchedOk === true &&
        !(typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_NO_DOWNGRADE__ === true) &&
        maskDensityPxPerDeg(engine._cachedMaskTexDims, engine._cachedMaskBounds) >
          incomingMaskDensityPxPerDeg(bounds) * 1.5
      ) {
        maskTex = engine._cachedMaskTex;
        engine._lastMaskEncodeMode = 'retain_res_no_downgrade';
        if (typeof window !== 'undefined') {
          window.__RAW_MASK_RES_RETAIN_COUNT__ = (window.__RAW_MASK_RES_RETAIN_COUNT__ || 0) + 1;
        }
      } else {
        if (engine) {
          // DIAG (item ①): fresh patch-less mask → source_not_ready no-op = the GLITCH.
          // 'rebuild_upgrade_over_retain' = the upgrade guard above declined a src-not-ready
          // retain because the resident was meaningfully coarser (the island-halo class).
          const _upgradeOverRetain = engine._cachedMaskTex &&
            engine._maskSourceReady === false && engine._maskRetainPatchedOk === true &&
            !(typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_RETAIN__ === true);
          engine._lastMaskEncodeMode = _upgradeOverRetain ? 'rebuild_upgrade_over_retain' : 'rebuild';
          if (_upgradeOverRetain && typeof window !== 'undefined') {
            window.__RAW_MASK_RETAIN_UPGRADE_REBUILD__ = (window.__RAW_MASK_RETAIN_UPGRADE_REBUILD__ || 0) + 1;
          }
        }
        if (engine && engine._cachedMaskTex) {
          gl.deleteTexture(engine._cachedMaskTex);
          if (typeof window !== 'undefined' && window.__RAW_GPU__) {
            window.__RAW_GPU__.textureCount--;
            // Decrement with the RECORDED dims (2026-07-05): this was hardcoded 1024×512, but mask
            // canvases are tiered up to 4096×2048 — every rebuild leaked +31.5MB into the estimate,
            // poisoning the very telemetry the OOM forensics rely on.
            const _dims = engine._cachedMaskTexDims || { w: 1024, h: 512 };
            window.__RAW_GPU__.gpuMemoryEstimate -= _dims.w * _dims.h * 4;
          }
          engine._cachedMaskTex = null;
          engine._cachedMaskTexDims = null;
        }
        try {
          const maskCanvas = renderMaskToCanvas(effectiveGeoJSON, bounds);
          // PATCH CARRY-FORWARD (2026-07-06, "bays flicker on rapid zoom"): a rebuild paints
          // NE-only truth and the basemap-water repatch is async (throttled + tile-gated —
          // legitimately blocked mid-gesture), so bays/piers flash wrong for a beat on every
          // bounds-changing commit. Transplant the last painted truth box into this canvas NOW
          // (geometrically exact — see maskSmoothing.js); the async repaint still follows with
          // fresher truth. Kill: window.__RAW_DISABLE_MASK_PATCH_CARRY__ = true.
          // COARSE-DST CARRY GATE (2026-07-07, live-caught: the "rectangle/box shape" over south
          // FL at z5.7 = the carry box's SEAM — crisp transplanted truth inside vs the 11 px/°
          // world mask outside). A destination too coarse to hold island truth (<32 px/°, the
          // same floor as the retain guards) cannot benefit from the transplant; it only paints
          // a visible rectangular seam. Carry stays for same-scale rebuilds (its bay-flicker
          // purpose): dst density ≥ 32 px/°.
          if (engine && bounds &&
              !(typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_PATCH_CARRY__ === true) &&
              incomingMaskDensityPxPerDeg(bounds) >= 32 &&
              applyPatchCarry(maskCanvas, bounds, engine._lastPatchedMask) &&
              typeof window !== 'undefined') {
            window.__RAW_MASK_PATCH_CARRY__ = (window.__RAW_MASK_PATCH_CARRY__ || 0) + 1;
            // Rectangle forensics (2026-07-07, the transient "rectangle cut out of the heatmap"
            // report — healed before capture): the carry box is the only RECTANGULAR actor on
            // this path, so record its geometry; when the next rectangle appears, one eval
            // compares it against this box. Diagnosis aid only.
            try {
              const _bx = engine._lastPatchedMask && engine._lastPatchedMask.box;
              if (_bx) window.__RAW_MASK_PATCH_CARRY_LAST__ = { box: { ..._bx }, ts: Date.now() };
            } catch (e) { /* telemetry only */ }
          }
          // COAST SDF (2026-07-21): pack a signed distance-to-coast into the finalized mask canvas'
          // free .b channel so the shader can threshold a crisp, resolution-independent coast. Opt-in
          // (__RAW_COAST_SDF__); no-op + byte-identical .b otherwise. Runs on the NE-truth base here;
          // the basemap-water re-upload (refreshMaskWithBasemapWater) re-writes it on the patched coast.
          const _sdfWritten = writeCoastDistanceField(maskCanvas);
          const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
          const prevFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
          maskTex = gl.createTexture();
          if (maskTex) allocatedTextures.push(maskTex);
          gl.bindTexture(gl.TEXTURE_2D, maskTex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);
          gl.bindTexture(gl.TEXTURE_2D, prevTex);
          console.log(`[WebGLMarineEngine-Forensic] High-resolution land mask texture created (${maskCanvas.width}x${maskCanvas.height})`);
          // Mask-arc diagnostic: the 4096↔2048 rebuild alternation is a named suspect in the
          // land-halo report — the ring turns it into a timestamped sequence beside the commits.
          recordMarineEvent('mask_rebuild', { dims: `${maskCanvas.width}x${maskCanvas.height}` });

          if (engine) {
            engine._cachedMaskTex = maskTex;
            engine._cachedMaskHasSDF = _sdfWritten; // .b carries a signed dist-to-coast (shader gate)
            engine._cachedMaskTexDims = { w: maskCanvas.width, h: maskCanvas.height };
            engine._cachedMaskGeoJSON = effectiveGeoJSON;
            engine._cachedMaskBounds = { ...bounds };
            if (typeof window !== 'undefined' && window.__RAW_GPU__) {
              window.__RAW_GPU__.textureCount++;
              window.__RAW_GPU__.gpuMemoryEstimate += maskCanvas.width * maskCanvas.height * 4;
            }
          }
        } catch (e) {
          console.warn('[WebGLMarineEngine] Failed to create high-res mask texture, falling back to grid-mask', e);
          maskTex = createTexture(gl, gl.LINEAR, dataMask, cols, rows);
          if (maskTex) allocatedTextures.push(maskTex);
          if (engine) engine._cachedMaskHasSDF = false; // grid fallback has no .b SDF
        }
      }
    } else {
      if (engine && engine._cachedMaskTex) {
        maskTex = engine._cachedMaskTex;
      } else {
        maskTex = createTexture(gl, gl.LINEAR, dataMask, cols, rows);
        if (maskTex) allocatedTextures.push(maskTex);
        if (engine) engine._cachedMaskHasSDF = false; // grid fallback has no .b SDF
      }
    }
  } catch (err) {
    console.error('[WebGLMarineTextureEncoder] Error during texture upload transaction, rolling back allocations:', err);
    for (const tex of allocatedTextures) {
      try {
        gl.deleteTexture(tex);
      } catch (e) { /* best-effort cleanup */ }
    }
    if (engine && !standalone) {
      engine._residentWaveTex = null;
      engine._residentChlTex = null;
      engine._residentBathTex = null;
      engine._cachedMaskTex = null;
    }
    throw err;
  }

  return {
    u_waveTexture: waveTex,
    u_chlorophyllTexture: chlTex,
    u_bathymetryTexture: bathTex,
    u_oceanMaskTexture: maskTex,
    __maskCanvasDims: standaloneMaskDims,
    // §0e: present ONLY on rating grids (anim-phys on) — the heatmap binds this for band
    // colors while u_waveTexture stays honest for draw/advect.
    u_waveScoreTexture: scoreTex,
    bounds
  };
}

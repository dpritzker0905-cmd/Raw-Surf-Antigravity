// WebGLMarineFieldMath.js
// Pure marine field math extracted VERBATIM from WebGLMarineTextureEncoder.js for LOC compliance.
// No WebGL / engine / mask coupling — reusable scratch buffers, shoreline in-painting
// (extrapolateOceanData), land-aware direction dilation (dilateDirectionField), and the §0B-a
// render-confidence scaling (scaleUnitDirByConfidence). Safe to unit-test in isolation.

export const FloatArrayConstructor = (typeof window !== 'undefined' && window.Float16Array) ? window.Float16Array : Float32Array;

// --- Dynamic GFS Shoreline Extrapolation (In-painting Coastline) ---

// Reusable scratch buffers to avoid TypedArray allocation in hot path
let uReadScratch = null;
let vReadScratch = null;
let hReadScratch = null;
let pReadScratch = null;
let oceanReadScratch = null;

let uArrScratch = null;
let vArrScratch = null;
let hArrScratch = null;
let pArrScratch = null;
let oceanArrScratch = null;
let confArrScratch = null;
let dataWaveScratch = null;

export function getEncoderScratchBuffers(N) {
  if (!uArrScratch || uArrScratch.length < N) {
    uArrScratch = new FloatArrayConstructor(N);
    vArrScratch = new FloatArrayConstructor(N);
    hArrScratch = new FloatArrayConstructor(N);
    pArrScratch = new FloatArrayConstructor(N);
    oceanArrScratch = new Uint8Array(N);
    confArrScratch = new FloatArrayConstructor(N);
    dataWaveScratch = new Uint8Array(N * 4);
  }
  return {
    uArr: uArrScratch,
    vArr: vArrScratch,
    hArr: hArrScratch,
    pArr: pArrScratch,
    oceanArr: oceanArrScratch,
    confArr: confArrScratch,
    dataWave: dataWaveScratch
  };
}

// §0B-a render-confidence consumption (2026-07-03): scale the encoded UNIT direction vector by the
// backend's per-cell direction confidence (GridVector.dir_confidence = the R_d-gate estimator's
// circular resultant length). The shaders' bilinear-|waveVec| coherence measure — the seam-dim /
// confused-sea machinery — then fades crest animation exactly where the exported direction is a
// cancellation residual with no stable truth (the (20,-120) GFS-vs-ECMWF divergence class): show
// nothing confidently wrong. Height/period/mask channels untouched → the HEATMAP is unaffected.
// Clamped ≥0.05 so a low-confidence cell can never re-enter the zero-direction regime
// (|u,v|≤0.001) that dilateDirectionField would refill with a full-strength neighbor direction.
export function scaleUnitDirByConfidence(unitU, unitV, conf, strength = 0.75) {
  // v2 COMPRESSED MAPPING (2026-07-03 eve, user report "fading of waves in patches z2.6-5.7"):
  // confidence rides the SAME channel as seam coherence (dim threshold 0.7) — the original LINEAR
  // conf→magnitude map dimmed every cell below ~0.7 confidence (~60+ mid-confidence patches
  // worldwide), far beyond the ~dozen truly-incoherent cells the design targets. The quadratic
  // compression `1 − (1−conf)²·strength` keeps mid-confidence ABOVE the dim threshold
  // (conf 0.65 → 0.908, conf 0.5 → 0.813 → NO dim) while genuine annihilation still dims:
  // conf 0.2 → 0.52 (crest alpha ≈ 0.63), Baja-class conf 0.09 → 0.38 (dim shimmer, never dead).
  // Strength override: window.__RAW_CONF_FADE_STRENGTH__ (default 0.75; 0 = confidence fade off).
  if (!(typeof conf === 'number' && conf >= 0 && conf <= 1)) return [unitU, unitV];
  const s = (typeof strength === 'number' && strength >= 0 && strength <= 1) ? strength : 0.75;
  const d = 1.0 - conf;
  const c = Math.max(0.05, 1.0 - d * d * s);
  return [unitU * c, unitV * c];
}

export function extrapolateOceanData(uArr, vArr, hArr, pArr, oceanArr, cols, rows, isGlobal = true) {
  if (cols < 2 || rows < 2) return;
  const N = cols * rows;

  if (!uReadScratch || uReadScratch.length < N) {
    uReadScratch = new FloatArrayConstructor(N);
    vReadScratch = new FloatArrayConstructor(N);
    hReadScratch = new FloatArrayConstructor(N);
    pReadScratch = new FloatArrayConstructor(N);
    oceanReadScratch = new Uint8Array(N);
  }

  const uRead = uReadScratch.subarray(0, N);
  const vRead = vReadScratch.subarray(0, N);
  const hRead = hReadScratch.subarray(0, N);
  const pRead = pReadScratch.subarray(0, N);
  const oceanRead = oceanReadScratch.subarray(0, N);

  for (let pass = 0; pass < 2; pass++) {
    uRead.set(uArr);
    vRead.set(vArr);
    hRead.set(hArr);
    pRead.set(pArr);
    oceanRead.set(oceanArr);

    let changes = 0;

    for (let r = 0; r < rows; r++) {
      const rCols = r * cols;
      for (let c = 0; c < cols; c++) {
        const idx = rCols + c;
        if (oceanRead[idx] !== 0) continue;

        let sumU = 0, sumV = 0, sumHeight = 0, sumPeriod = 0;
        let count = 0;

        for (let dr = -1; dr <= 1; dr++) {
          const nr = r + dr;
          if (nr < 0 || nr >= rows) continue;
          const nrCols = nr * cols;
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            let nc = c + dc;
            if (isGlobal) {
              if (nc < 0) nc = cols - 1;
              if (nc >= cols) nc = 0;
            } else {
              if (nc < 0 || nc >= cols) continue;
            }

            const nIdx = nrCols + nc;
            if (oceanRead[nIdx] !== 0) {
              sumU += uRead[nIdx];
              sumV += vRead[nIdx];
              sumHeight += hRead[nIdx];
              sumPeriod += pRead[nIdx];
              count++;
            }
          }
        }

        if (count > 0) {
          uArr[idx] = sumU / count;
          vArr[idx] = sumV / count;
          hArr[idx] = sumHeight / count;
          pArr[idx] = sumPeriod / count;
          oceanArr[idx] = 1;
          changes++;
        }
      }
    }

    if (changes === 0) break;

    if (isGlobal) {
      for (let r = 0; r < rows; r++) {
        const idx0 = r * cols + 0;
        const idxN = r * cols + cols - 1;

        if (oceanArr[idx0] !== 0 || oceanArr[idxN] !== 0) {
          const avgU = (uArr[idx0] + uArr[idxN]) * 0.5;
          const avgV = (vArr[idx0] + vArr[idxN]) * 0.5;
          const avgHeight = (hArr[idx0] + hArr[idxN]) * 0.5;
          const avgPeriod = (pArr[idx0] + pArr[idxN]) * 0.5;

          uArr[idx0] = uArr[idxN] = avgU;
          vArr[idx0] = vArr[idxN] = avgV;
          hArr[idx0] = hArr[idxN] = avgHeight;
          pArr[idx0] = pArr[idxN] = avgPeriod;
          oceanArr[idx0] = oceanArr[idxN] = 1;
        }
      }
    }
  }
}
// --- Direction-only dilation (land-aware seam coherence, 2026-07-03) ---
// The seam fade measures coherence as the bilinear |waveVec|, but the encode loop writes the ZERO
// vector (0.5,0.5) for any texel with no direction — land, is_valid:false, cells the 2-ring
// extrapolateOceanData pass doesn't reach. Bilinear samples collapse in magnitude within a full texel
// of such a cell, so on the 10° coarse grid the coherence floor faded/culled up to a cell-width of
// ocean beside every coastline ("missing patches all over" — HANDOFF-2026-07-03 §0A). This pass fills
// the DIRECTION of the nearest direction-bearing cell into every zero-direction texel. Direction ONLY:
// height, period and the ocean mask are untouched, so nothing new becomes renderable — but the bilinear
// magnitude now collapses only at true divergent-direction seams, making the fade safe to default on.
let dirResolvedScratch = null;
let dirResolvedReadScratch = null;

export function dilateDirectionField(uArr, vArr, cols, rows, isGlobal = true) {
  if (cols < 2 || rows < 2) return 0;
  const N = cols * rows;

  if (!dirResolvedScratch || dirResolvedScratch.length < N) {
    dirResolvedScratch = new Uint8Array(N);
    dirResolvedReadScratch = new Uint8Array(N);
  }
  const resolved = dirResolvedScratch.subarray(0, N);
  const resolvedRead = dirResolvedReadScratch.subarray(0, N);

  // Same zero test the encode loop applies (|u,v| > 0.001): anything it would write as (0.5,0.5)
  // is a fill target; everything else is a BFS source and is never modified.
  let sources = 0;
  for (let i = 0; i < N; i++) {
    const m2 = uArr[i] * uArr[i] + vArr[i] * vArr[i];
    const isSource = m2 > 1e-6 ? 1 : 0;
    resolved[i] = isSource;
    sources += isSource;
  }
  if (sources === 0 || sources === N) return 0;

  // Ring-by-ring relaxation (same structure as extrapolateOceanData, but unbounded passes — every
  // reachable texel must end up direction-bearing). Reads gate on the previous ring's snapshot, so
  // the fill is order-independent within a ring; terminates when a ring fills nothing (≤ max(cols,
  // rows) rings). Filled cells hold UNIT vectors — the encode loop normalizes anyway, and nothing
  // downstream reads uArr/vArr magnitude.
  let filled = 0;
  for (;;) {
    resolvedRead.set(resolved);
    let changes = 0;

    for (let r = 0; r < rows; r++) {
      const rCols = r * cols;
      for (let c = 0; c < cols; c++) {
        const idx = rCols + c;
        if (resolvedRead[idx] !== 0) continue;

        let sumU = 0, sumV = 0, count = 0;
        let fallbackIdx = -1;

        for (let dr = -1; dr <= 1; dr++) {
          const nr = r + dr;
          if (nr < 0 || nr >= rows) continue;
          const nrCols = nr * cols;
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            let nc = c + dc;
            if (isGlobal) {
              if (nc < 0) nc = cols - 1;
              if (nc >= cols) nc = 0;
            } else if (nc < 0 || nc >= cols) {
              continue;
            }

            const nIdx = nrCols + nc;
            if (resolvedRead[nIdx] === 0) continue;
            const nu = uArr[nIdx];
            const nv = vArr[nIdx];
            const mag = Math.sqrt(nu * nu + nv * nv);
            if (mag <= 0) continue;
            if (fallbackIdx < 0) fallbackIdx = nIdx;
            // Normalize per neighbor: raw source magnitudes must not weight the direction average.
            sumU += nu / mag;
            sumV += nv / mag;
            count++;
          }
        }

        if (count === 0) continue;
        const sumMag = Math.sqrt(sumU * sumU + sumV * sumV);
        if (sumMag > 1e-3) {
          uArr[idx] = sumU / sumMag;
          vArr[idx] = sumV / sumMag;
        } else {
          // Opposing neighbors self-cancel — the exact failure mode this pass exists to remove.
          // Copy one neighbor's unit direction deterministically instead of writing another zero.
          const fu = uArr[fallbackIdx];
          const fv = vArr[fallbackIdx];
          const fm = Math.sqrt(fu * fu + fv * fv);
          uArr[idx] = fu / fm;
          vArr[idx] = fv / fm;
        }
        resolved[idx] = 1;
        filled++;
        changes++;
      }
    }

    if (changes === 0) break;
  }

  return filled;
}

/**
 * waterTempLandFill.js: Water Temp's decode-time land handling (moved out of openMeteoProtocol.js, 2026-10-22).
 * surface_temperature is SKIN temperature, so grid cells containing land carry land heat; openMeteoProtocol's postReadCallback
 * ocean-fills them against the NE 50m land mask (the 2026-07-11 coastal-halo fix). The two functions below are that code,
 * verbatim (the legacy path); the fast path after them computes the same values without scanning every cell.
 */
// Ocean-fill: replace land-contaminated cells with the mean of their clean WATER neighbors
// (breadth-first, 3 dilation passes), then NaN whatever land remains unfilled (deep interior —
// visually covered by the opaque ocean-mask land fill anyway). Straight NaN-ing every
// land-touching cell was scientifically honest but product-fatal on coarse grids: at ifs025
// (0.25°≈28km/cell) the whole SoCal bight rendered as an empty moat around land — worse than the
// halo it replaced. Fill keeps the field continuous to the true (vector-mask) coastline with
// plausible nearshore values; the palette shows water-derived temps only.
export function oceanFillLandCells(values, landMask, nx, ny) {
  const state = Uint8Array.from(landMask); // 1 = land, not yet filled; 0 = water / filled source
  const PASSES = 3;
  for (let p = 0; p < PASSES; p++) {
    const filled = [];
    for (let y = 0; y < ny; y++) {
      const row = y * nx;
      for (let x = 0; x < nx; x++) {
        const i = row + x;
        if (state[i] !== 1) continue;
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= ny) continue;
          const rr = yy * nx;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx;
            if (xx < 0 || xx >= nx) continue;
            const j = rr + xx;
            if (state[j] === 0) {
              const vv = values[j];
              if (vv !== null && !Number.isNaN(vv)) { sum += vv; cnt++; }
            }
          }
        }
        if (cnt > 0) { values[i] = sum / cnt; filled.push(i); }
      }
    }
    if (!filled.length) break;
    for (let k = 0; k < filled.length; k++) state[filled[k]] = 0;
  }
  for (let i = 0; i < state.length; i++) { if (state[i] === 1) values[i] = NaN; }
}

// Coastal outlier QC (2026-07-11, "deep hot red spot off Marsh Harbour"): the dilated NE mask
// misses cells the MODEL's landmask calls land (thin cays absent from NE 50m), which render raw
// land-skin temps (probed: 47.3°C in Bahamas water at midday). Standard SST coastal QC: within 2
// cells of the coastline, a cell >3°C from the local water median (9×9 at stride 2 ≈ ±4 cells;
// median resists the contaminated minority) is ocean-filled. Symmetric — land runs hot by day,
// cold by night. Real fronts survive: deviation from a ±50km median stays ~2-3°C even at the Gulf
// Stream wall, Bahamas banks ~+1.5-2°C. Kill: globalThis.__RAW_WT_COASTAL_QC_DISABLED__.
export function coastalOutlierQC(values, landMask, nx, ny) {
  const augmented = Uint8Array.from(landMask);
  // ring = non-land cells within Chebyshev distance 2 of land (stamped from land cells)
  const ring = new Uint8Array(nx * ny);
  for (let y = 0; y < ny; y++) {
    const row = y * nx;
    for (let x = 0; x < nx; x++) {
      if (landMask[row + x] !== 1) continue;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= ny) continue;
        const rr = yy * nx;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= nx) continue;
          const j = rr + xx;
          if (landMask[j] === 0) ring[j] = 1;
        }
      }
    }
  }
  const windowVals = [];
  for (let y = 0; y < ny; y++) {
    const row = y * nx;
    for (let x = 0; x < nx; x++) {
      const i = row + x;
      if (ring[i] !== 1) continue;
      const v = values[i];
      if (v === null || Number.isNaN(v)) continue;
      windowVals.length = 0;
      for (let dy = -4; dy <= 4; dy += 2) {
        const yy = y + dy;
        if (yy < 0 || yy >= ny) continue;
        const rr = yy * nx;
        for (let dx = -4; dx <= 4; dx += 2) {
          const xx = x + dx;
          if (xx < 0 || xx >= nx) continue;
          const j = rr + xx;
          if (landMask[j] === 0) {
            const wv = values[j];
            if (wv !== null && !Number.isNaN(wv)) windowVals.push(wv);
          }
        }
      }
      if (windowVals.length < 5) continue; // not enough clean context — leave the cell alone
      windowVals.sort((a, b) => a - b);
      const median = windowVals[windowVals.length >> 1];
      if (Math.abs(v - median) > 3.0) augmented[i] = 1;
    }
  }
  return augmented;
}


// ─── FAST PATH (2026-10-22, raster-instant P4): the same two computations, byte for byte, without scanning every cell. ───
// Measured (raster lab, dev 6a03c442a, zero network latency): a GFS 0.13° water-temp field (3072 x 1536 = 4.7 M cells) took
// 1.35-2.05 s to load on a desktop against 0.49-0.59 s for air temperature on the same grid: the coastal QC and the ocean
// fill above ran on the main thread over every cell (~100 M operations), about 4-6 s with a phone's CPU (water temp's phone
// toggle p50 was 12 s). Two facts make them cheap without changing a value:
//  - the QC's RING (water cells within 2 of land) depends only on the land mask: built once per mask, then only ring cells are
//    tested (each test reads only values and the mask, never another cell's result, so the order does not matter);
//  - a fill pass can only fill a land cell with an unfilled-water neighbour that HAS a value. In pass 1 that is a land cell
//    next to water in the QC'd mask: the mask's static frontier plus the cells the QC added (QC only turns water into land,
//    so no other land cell gains a water neighbour). In pass p+1 it is a still-land neighbour of a cell filled in pass p
//    (a cell that had such a neighbour earlier was already filled then). Within a pass a filled cell stays "land" until
//    the pass ends, exactly as above, so no cell reads another cell's new value; neighbour order and arithmetic are the same.
// Kill: globalThis.__RAW_DISABLE_WT_FAST_FILL__ = true (the scans above). Parity: waterTempLandFill.test.js compares both
// paths byte for byte on masks and fields with NaNs.
const STATIC = new WeakMap();   // land mask -> { ring, frontier, land } (Int32Array cell lists)

function staticLists(landMask, nx, ny) {
  let s = STATIC.get(landMask);
  if (s) return s;
  const ringFlag = new Uint8Array(nx * ny);
  const ring = []; const frontier = []; const land = [];
  for (let y = 0; y < ny; y++) {
    const row = y * nx;
    for (let x = 0; x < nx; x++) {
      const i = row + x;
      if (landMask[i] !== 1) continue;
      land.push(i);
      let nearWater = false;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= ny) continue;
        const rr = yy * nx;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= nx) continue;
          const j = rr + xx;
          if (landMask[j] === 0) {
            if (!ringFlag[j]) { ringFlag[j] = 1; ring.push(j); }
            if (dy >= -1 && dy <= 1 && dx >= -1 && dx <= 1) nearWater = true;
          }
        }
      }
      if (nearWater) frontier.push(i);
    }
  }
  s = { ring: Int32Array.from(ring), frontier: Int32Array.from(frontier), land: Int32Array.from(land) };
  STATIC.set(landMask, s);
  return s;
}

/** coastalOutlierQC, fast: returns { augmented, added } (added = the ring cells the QC turned into land). */
export function fastCoastalOutlierQC(values, landMask, nx, ny) {
  const { ring } = staticLists(landMask, nx, ny);
  const augmented = Uint8Array.from(landMask);
  const added = [];
  const windowVals = [];
  for (let k = 0; k < ring.length; k++) {
    const i = ring[k];
    const v = values[i];
    if (v === null || Number.isNaN(v)) continue;
    const y = (i / nx) | 0; const x = i - y * nx;
    windowVals.length = 0;
    for (let dy = -4; dy <= 4; dy += 2) {
      const yy = y + dy;
      if (yy < 0 || yy >= ny) continue;
      const rr = yy * nx;
      for (let dx = -4; dx <= 4; dx += 2) {
        const xx = x + dx;
        if (xx < 0 || xx >= nx) continue;
        const j = rr + xx;
        if (landMask[j] === 0) {
          const wv = values[j];
          if (wv !== null && !Number.isNaN(wv)) windowVals.push(wv);
        }
      }
    }
    if (windowVals.length < 5) continue;
    windowVals.sort((a, b) => a - b);
    const median = windowVals[windowVals.length >> 1];
    if (Math.abs(v - median) > 3.0) { augmented[i] = 1; added.push(i); }
  }
  return { augmented, added };
}

/** oceanFillLandCells, fast. `workMask` = the QC'd mask (or `baseMask`), `added` = cells the QC added (or none). */
export function fastOceanFillLandCells(values, workMask, nx, ny, baseMask = workMask, added = []) {
  const { frontier, land } = staticLists(baseMask, nx, ny);
  const state = Uint8Array.from(workMask);
  const queued = new Uint8Array(nx * ny);
  let cand = [];
  const take = (i) => { if (state[i] === 1 && !queued[i]) { queued[i] = 1; cand.push(i); } };
  for (let k = 0; k < frontier.length; k++) take(frontier[k]);
  for (let k = 0; k < added.length; k++) take(added[k]);
  const PASSES = 3;
  for (let p = 0; p < PASSES; p++) {
    const filled = [];
    for (let k = 0; k < cand.length; k++) {
      const i = cand[k];
      if (state[i] !== 1) continue;
      const y = (i / nx) | 0; const x = i - y * nx;
      let sum = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= ny) continue;
        const rr = yy * nx;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= nx) continue;
          const j = rr + xx;
          if (state[j] === 0) {
            const vv = values[j];
            if (vv !== null && !Number.isNaN(vv)) { sum += vv; cnt++; }
          }
        }
      }
      if (cnt > 0) { values[i] = sum / cnt; filled.push(i); }
    }
    if (!filled.length) break;
    for (let k = 0; k < filled.length; k++) state[filled[k]] = 0;
    // Next pass: still-land neighbours of what this pass filled.
    queued.fill(0);
    cand = [];
    for (let k = 0; k < filled.length; k++) {
      const i = filled[k]; const y = (i / nx) | 0; const x = i - y * nx;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= ny) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= nx) continue;
          take(yy * nx + xx);
        }
      }
    }
  }
  for (let k = 0; k < land.length; k++) { const i = land[k]; if (state[i] === 1) values[i] = NaN; }
  for (let k = 0; k < added.length; k++) { const i = added[k]; if (state[i] === 1) values[i] = NaN; }
}

/** The decode-time water-temp land handling: QC (unless qcOff) then the ocean fill, fast unless killed. */
export function applyWaterTempLandFill(values, mask, nx, ny, qcOff = false) {
  const legacy = typeof globalThis !== 'undefined' && globalThis.__RAW_DISABLE_WT_FAST_FILL__ === true;
  if (legacy) {
    const workMask = qcOff ? mask : coastalOutlierQC(values, mask, nx, ny);
    oceanFillLandCells(values, workMask, nx, ny);
    return;
  }
  if (qcOff) { fastOceanFillLandCells(values, mask, nx, ny, mask, []); return; }
  const { augmented, added } = fastCoastalOutlierQC(values, mask, nx, ny);
  fastOceanFillLandCells(values, augmented, nx, ny, mask, added);
}

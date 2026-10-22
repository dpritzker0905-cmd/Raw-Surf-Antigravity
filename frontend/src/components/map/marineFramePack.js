/**
 * marineFramePack.js — a static forecast frame (RSWF v1, decoded) straight to the wave texture's RGBA8 bytes, with NO per-node
 * JS objects (GPU-resident frames, phase 2 step 1; spec docs/architecture/gpu-resident-forecast-frames.md section 3).
 *
 * WHY: a static frame reaches the engine today as ~15k vector objects (staticFrameCodec.buildVectors, then the /grid mapper or the
 * series conform, then trimDeadEdges, then encodeMarineTexture). The bench measured 1.7-4.3 ms p50 of main thread per world
 * frame for the objects alone on desktop (up to 55 ms under CPU x4) and 4.2-5.5 MiB of heap per kept frame. This module
 * produces the SAME bytes encodeMarineTexture would upload as `u_waveTexture` for that frame, from the decoded planes.
 *
 * IDENTICAL BY CONSTRUCTION, and pinned by marineFramePack.parity.test.js against the real encoder:
 *   - the per-node values follow staticFrameCodec.buildVectors' rounding (speed 4 dp, direction 2 dp, u/v 4 dp, period 2 dp,
 *     confidence 4 dp) and the encoder's input stage for the `waves` layer (validity = ocean, u/v = 0 + a direction is
 *     re-conformed to a unit vector, period null = 0, confidence only on ocean cells);
 *   - trimDeadEdges' edge rule (marineEngineDecisions.js) runs on the planes; a full-wrap MIRROR case returns null instead, so
 *     the caller takes the normal path for it;
 *   - extrapolateOceanData / dilateDirectionField are the encoder's own functions (WebGLMarineFieldMath.js) on arrays of the
 *     same FloatArrayConstructor (Float16 where the browser has it), so precision matches too;
 *   - the pack loop, confidence scaling, the theme's height scale (marineWaveHeightScale: 16 m rounded for light v2, 10 m
 *     floored for beach / dark) and the full-wrap seam average are the encoder's.
 * Everything that changes the bytes is in packSignature(): a pack is valid only while its signature matches.
 *
 * SCOPE: the `waves` layer of non-rating frames. Other layers return null: the series conform drops `is_valid` for them, so the
 * encoder's ocean flag differs by lane there (phase 2 finding; see the spec). Nothing in the app calls this yet.
 */
import { FloatArrayConstructor, extrapolateOceanData, dilateDirectionField, scaleUnitDirByConfidence } from './WebGLMarineFieldMath';
import { marineWaveHeightScale } from './marineWavePalette';

const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const DEG = Math.PI / 180;

const winOf = (win) => win || (typeof window !== 'undefined' ? window : {});

/** Everything outside the frame that changes the packed bytes. A stored pack is reusable only while this is unchanged. */
export function packSignature(win) {
  const w = winOf(win);
  const confOn = w.__RAW_DISABLE_DIR_CONFIDENCE__ !== true;
  const strength = typeof w.__RAW_CONF_FADE_STRENGTH__ === 'number' ? w.__RAW_CONF_FADE_STRENGTH__ : 0.75;
  return [
    `h${marineWaveHeightScale(w.__WEBGL_MARINE_THEME__)}`,
    `dil${w.__RAW_DISABLE_DIR_DILATION__ === true ? 0 : 1}`,
    `conf${confOn ? strength : 'off'}`,
    `trim${w.__RAW_DISABLE_DEAD_EDGE_TRIM__ === true ? 0 : 1}`,
    `wrap${w.__RAW_DISABLE_WRAP_MIRROR__ === true ? 0 : 1}`,
    `f${FloatArrayConstructor === Float32Array ? 32 : 16}`,
  ].join('|');
}

/** FNV-1a over a 0/1 validity mask: the chl/bath/mask textures derive from it, so a stored frame may replace only a resident
 * wave texture whose validity hash is the same. */
export function validityHash(mask) {
  let h = 0x811c9dc5;
  for (let i = 0; i < mask.length; i++) { h ^= mask[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** The 0/1 validity mask as a bitset (1.9 KB for a world frame): kept with each pack so two frames' masks can be compared. */
export function validityBits(mask) {
  const out = new Uint8Array((mask.length + 7) >> 3);
  for (let i = 0; i < mask.length; i++) if (mask[i]) out[i >> 3] |= 1 << (i & 7);
  return out;
}

/** Cells whose validity differs between two bitsets of the same grid (Infinity when they are not comparable). */
export function validityDiff(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let n = 0;
  for (let i = 0; i < a.length; i++) { let x = a[i] ^ b[i]; while (x) { n += x & 1; x >>= 1; } }
  return n;
}

// trimDeadEdges' decision on planes: live = valid AND speed > 0 (its `v.speed > 0 || value` test; static frames carry no value).
function trimWindow(cols, rows, bounds, live, w) {
  const full = { c0: 0, c1: cols - 1, r0: 0, r1: rows - 1, mirror: false };
  if (w.__RAW_DISABLE_DEAD_EDGE_TRIM__ === true || !(cols > 3) || !(rows > 3)) return full;
  const stepX = (bounds.east - bounds.west) / (cols - 1);
  const stepY = (bounds.north - bounds.south) / (rows - 1);
  if (!(stepX > 0) || !(stepY > 0)) return full;
  const colValid = new Int32Array(cols);
  const rowValid = new Int32Array(rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) if (live[r * cols + c]) { colValid[c]++; rowValid[r]++; }
  }
  const fullWrap = (bounds.east - bounds.west) >= 359.0 && w.__RAW_DISABLE_WRAP_MIRROR__ !== true;
  if (fullWrap && ((colValid[cols - 1] === 0 && colValid[0] > 0) || (colValid[0] === 0 && colValid[cols - 1] > 0))) {
    return { ...full, mirror: true };
  }
  let c0 = 0; let c1 = cols - 1; let r0 = 0; let r1 = rows - 1;
  for (let k = 0; k < 2 && c1 > c0 + 2 && colValid[c1] === 0; k++) c1--;
  for (let k = 0; k < 2 && c1 > c0 + 2 && colValid[c0] === 0; k++) c0++;
  for (let k = 0; k < 2 && r1 > r0 + 2 && rowValid[r1] === 0; k++) r1--;
  for (let k = 0; k < 2 && r1 > r0 + 2 && rowValid[r0] === 0; k++) r0++;
  return { c0, c1, r0, r1, mirror: false, stepX, stepY };
}

/**
 * `parsed` is staticFrameCodec.parseFrame's output: { cols, rows, bounds, fields: {0: height, 1: direction, 2: period,
 * 3: dir_confidence} (Float64Array, NaN = missing), uvConvention }. Returns { bytes, cols, rows, bounds, isGlobal,
 * validityHash, signature, trimmed } or null when the frame is outside this module's scope (non-waves layer, rating grid,
 * no height plane, or the full-wrap mirror case).
 */
export function packStaticFrame(parsed, { layer = 'waves', ratingMode = false, win } = {}) {
  const w = winOf(win);
  if (!parsed || layer !== 'waves' || ratingMode) return null;
  const { cols: C0, rows: R0, bounds: B0, fields } = parsed;
  const H = fields && fields[0];
  if (!H || !(C0 >= 2) || !(R0 >= 2) || H.length !== C0 * R0) return null;
  const D = fields[1]; const P = fields[2]; const CF = fields[3];
  const sign = parsed.uvConvention === 1 ? 1 : -1;
  const n0 = C0 * R0;

  // buildVectors' node values (the shape both static lanes hand the encoder for the waves layer).
  const live = new Uint8Array(n0);
  const valid = new Uint8Array(n0);
  const spd = new Float64Array(n0); const dir = new Float64Array(n0); const per = new Float64Array(n0);
  const cnf = new Float64Array(n0); const uu = new Float64Array(n0); const vv = new Float64Array(n0);
  for (let i = 0; i < n0; i++) {
    const ok = !Number.isNaN(H[i]);
    valid[i] = ok ? 1 : 0;
    const d = D ? (Number.isNaN(D[i]) ? 0 : r2(D[i])) : 0;
    dir[i] = d;
    per[i] = P && !Number.isNaN(P[i]) ? r2(P[i]) : 0;          // null period reaches the encoder as 0
    cnf[i] = CF && !Number.isNaN(CF[i]) ? r4(CF[i]) : NaN;       // NaN = no confidence (null)
    if (!ok) { spd[i] = 0; uu[i] = 0; vv[i] = 0; continue; }
    const s = r4(H[i]);
    spd[i] = s;
    live[i] = s > 0 ? 1 : 0;
    uu[i] = r4(sign * s * Math.sin(d * DEG)) + 0;
    vv[i] = r4(sign * s * Math.cos(d * DEG)) + 0;
  }

  const tw = trimWindow(C0, R0, B0, live, w);
  if (tw.mirror) return null;
  const cols = tw.c1 - tw.c0 + 1; const rows = tw.r1 - tw.r0 + 1;
  const trimmed = cols !== C0 || rows !== R0;
  const bounds = trimmed ? {
    west: B0.west + tw.c0 * tw.stepX, east: B0.west + tw.c1 * tw.stepX,
    south: B0.south + tw.r0 * tw.stepY, north: B0.south + tw.r1 * tw.stepY,
  } : { ...B0 };
  const N = cols * rows;

  // The encoder's input stage (waves layer), into arrays of the encoder's own float type.
  const uArr = new FloatArrayConstructor(N); const vArr = new FloatArrayConstructor(N);
  const hArr = new FloatArrayConstructor(N); const pArr = new FloatArrayConstructor(N);
  const confArr = new FloatArrayConstructor(N); const oceanArr = new Uint8Array(N);
  confArr.fill(1.0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const j = (r + tw.r0) * C0 + (c + tw.c0);
      const isOcean = valid[j] === 1;
      let uVal = uu[j]; let vVal = vv[j];
      if (uVal === 0 && vVal === 0 && isOcean) {
        const rad = dir[j] * DEG;
        uVal = -Math.sin(rad);
        vVal = -Math.cos(rad);
      }
      uArr[i] = uVal; vArr[i] = vVal; hArr[i] = spd[j]; pArr[i] = per[j];
      oceanArr[i] = isOcean ? 1 : 0;
      if (isOcean && !Number.isNaN(cnf[j])) confArr[i] = Math.max(0, Math.min(1, cnf[j]));
    }
  }
  const vHash = validityHash(oceanArr);
  const vBits = validityBits(oceanArr);
  const isGlobal = !(bounds.east - bounds.west < 359.0);
  extrapolateOceanData(uArr, vArr, hArr, pArr, oceanArr, cols, rows, isGlobal);
  if (w.__RAW_DISABLE_DIR_DILATION__ !== true) dilateDirectionField(uArr, vArr, cols, rows, isGlobal);

  // The encoder's pack loop.
  const confEnabled = w.__RAW_DISABLE_DIR_CONFIDENCE__ !== true;
  const confStrength = typeof w.__RAW_CONF_FADE_STRENGTH__ === 'number' ? w.__RAW_CONF_FADE_STRENGTH__ : 0.75;
  const hScale = marineWaveHeightScale(w.__WEBGL_MARINE_THEME__);
  const out = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const u = uArr[i]; const vy = vArr[i];
    let nu = 0.5; let nv = 0.5;
    const mag = Math.sqrt(u * u + vy * vy);
    if (mag > 0.001) {
      let su = u / mag; let sv = vy / mag;
      if (confEnabled && confArr[i] < 1.0) [su, sv] = scaleUnitDirByConfidence(su, sv, confArr[i], confStrength);
      nu = Math.max(0.0, Math.min(1.0, su * 0.5 + 0.5));
      nv = Math.max(0.0, Math.min(1.0, sv * 0.5 + 0.5));
    }
    const hEnc = Math.max(0.0, Math.min(1.0, hArr[i] / hScale));
    const pv = pArr[i];
    const periodEnc = pv > 0 ? Math.max(0.0, Math.min(1.0, pv / 20.0)) : 0.0;
    out[i * 4] = Math.floor(nu * 255);
    out[i * 4 + 1] = Math.floor(nv * 255);
    out[i * 4 + 2] = hScale > 10 ? Math.round(hEnc * 255) : Math.floor(hEnc * 255);
    out[i * 4 + 3] = Math.floor(periodEnc * 255);
  }

  // The encoder's full-wrap seam: both edge columns take their average.
  if (isGlobal) {
    for (let r = 0; r < rows; r++) {
      const i0 = r * cols * 4; const iN = (r * cols + cols - 1) * 4;
      const u0 = (out[i0] / 255.0) * 2.0 - 1.0; const v0 = (out[i0 + 1] / 255.0) * 2.0 - 1.0;
      const uN = (out[iN] / 255.0) * 2.0 - 1.0; const vN = (out[iN + 1] / 255.0) * 2.0 - 1.0;
      const au = (u0 + uN) * 0.5; const av = (v0 + vN) * 0.5;
      const m = Math.sqrt(au * au + av * av);
      let nu = 0.5; let nv = 0.5;
      if (m > 0.001) {
        let su = au / m; let sv = av / m;
        if (confEnabled) {
          const cWrap = Math.min(confArr[r * cols], confArr[r * cols + cols - 1]);
          if (cWrap < 1.0) [su, sv] = scaleUnitDirByConfidence(su, sv, cWrap, confStrength);
        }
        nu = Math.max(0.0, Math.min(1.0, su * 0.5 + 0.5));
        nv = Math.max(0.0, Math.min(1.0, sv * 0.5 + 0.5));
      }
      const avgH = (hScale > 10 ? Math.round : Math.floor)((out[i0 + 2] + out[iN + 2]) * 0.5);
      const avgP = Math.floor((out[i0 + 3] + out[iN + 3]) * 0.5);
      out[i0] = out[iN] = Math.floor(nu * 255);
      out[i0 + 1] = out[iN + 1] = Math.floor(nv * 255);
      out[i0 + 2] = out[iN + 2] = avgH;
      out[i0 + 3] = out[iN + 3] = avgP;
    }
  }
  return { bytes: out, cols, rows, bounds, isGlobal, validityHash: vHash, validityBits: vBits, signature: packSignature(w), trimmed };
}

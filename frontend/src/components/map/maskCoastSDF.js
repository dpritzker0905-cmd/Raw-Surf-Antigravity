/**
 * maskCoastSDF.js — runtime signed distance-to-coast field for the marine ocean mask (2026-07-21).
 *
 * WHY (best-in-class coastline, forensically grounded): the ocean mask is a binary land/water canvas
 * bounded by the basemap water-tile precision at the current zoom. Thresholding the binary `.r`
 * channel STAIRCASES across texels (a soft feather that bleeds onto thin coasts at z~9-12; see the
 * 2026-07-21 John Pennekamp forensics + the halo debug overlay). A SIGNED DISTANCE FIELD fixes this:
 * because the GPU LINEAR-filters the mask, bilinear-interpolating a *distance* reconstructs the coast
 * isoline at SUB-TEXEL accuracy — a crisp, resolution-independent coast even from a coarse mask — and
 * a threshold OFFSET erodes/dilates the coast for free (pull the wave field off the land to kill bleed).
 *
 * This packs the SDF into the FREE `.b` channel of the mask canvas (verified: `.r` = land/water and
 * `.g` = motion-water are the only channels any shader reads; `.b` is a redundant copy of `.r`; `.a`
 * must stay 255 — non-premultiplied upload). Runs at mask-build time (a few ms), not shipped as an asset.
 *
 * Rollout: OPT-IN via `window.__RAW_COAST_SDF__ === true` (ships byte-identical when off — `.b` stays a
 * redundant `.r`). Hard kill `window.__RAW_DISABLE_COAST_SDF__`. Tunables: `__RAW_COAST_SDF_RANGE__`
 * (texels mapped to the encoded half-range; default 40). The shader gates on engine._cachedMaskHasSDF /
 * _overlayMaskHasSDF (an 8-bit `.b` cannot self-distinguish an encoded coast from a redundant `.r`).
 */

// 8-neighbour 3-4 weighted chamfer (orthogonal=3, diagonal=4 → ~3 units per texel; a good Euclidean
// approximation that avoids the Chebyshev "diamond" isolines a unit-cost chamfer would give). Two
// sweeps, integer, O(w·h) — matches the classifySheltered chamfer house pattern. Mutates d in place;
// seeds are d[i]===0, everything else starts at INF.
const CHAMF_ORTH = 3, CHAMF_DIAG = 4, CHAMF_UNITS_PER_TEXEL = 3;

function chamfer34(d, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let m = d[i];
      if (x > 0 && d[i - 1] + CHAMF_ORTH < m) m = d[i - 1] + CHAMF_ORTH;
      if (y > 0) {
        const u = i - w;
        if (d[u] + CHAMF_ORTH < m) m = d[u] + CHAMF_ORTH;
        if (x > 0 && d[u - 1] + CHAMF_DIAG < m) m = d[u - 1] + CHAMF_DIAG;
        if (x < w - 1 && d[u + 1] + CHAMF_DIAG < m) m = d[u + 1] + CHAMF_DIAG;
      }
      d[i] = m;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let m = d[i];
      if (x < w - 1 && d[i + 1] + CHAMF_ORTH < m) m = d[i + 1] + CHAMF_ORTH;
      if (y < h - 1) {
        const dn = i + w;
        if (d[dn] + CHAMF_ORTH < m) m = d[dn] + CHAMF_ORTH;
        if (x > 0 && d[dn - 1] + CHAMF_DIAG < m) m = d[dn - 1] + CHAMF_DIAG;
        if (x < w - 1 && d[dn + 1] + CHAMF_DIAG < m) m = d[dn + 1] + CHAMF_DIAG;
      }
      d[i] = m;
    }
  }
}

/**
 * Compute the signed distance-to-coast from a binary water field and pack it into `outB` (0..255,
 * 128 = coastline, >128 = offshore water, <128 = inland). Pure + exported for tests.
 * @param {Uint8Array|Uint8ClampedArray} water  length w*h, 1 = water, 0 = land
 * @param {number} w @param {number} h
 * @param {number} rangeTexels  texels mapped to the encoded half-range (bigger = gentler gradient)
 * @param {Uint8Array} outB  length w*h — receives the encoded byte
 */
// Reused scratch buffers — a 2048×2048 mask allocates ~24 MB of Int32Array per call; freshly
// allocating on every mask rebuild (base + overlay) churned ~48 MB/settle and the GC pauses spiked
// the transform from ~56 ms to ~145 ms. Reuse eliminates that. Safe: single-threaded, and the
// returned `sd` is consumed immediately by the caller before the next call.
let _scratchN = 0, _dL = null, _dW = null, _sd = null;

// Signed distance-to-coast in CHAMFER UNITS (+ offshore water / − inland land). Returns a SHARED
// buffer (`_sd`) — consume it before the next signedDistChamfer call. Shared by the exact full-res
// encoder and the downsampled fast path.
function signedDistChamfer(water, w, h) {
  const N = w * h;
  const INF = 0x3fffffff;
  if (_scratchN < N) { _scratchN = N; _dL = new Int32Array(N); _dW = new Int32Array(N); _sd = new Int32Array(N); }
  const dToLand = _dL, dToWater = _dW, sd = _sd;
  for (let i = 0; i < N; i++) {
    const isW = water[i] ? 1 : 0;
    dToLand[i] = isW ? INF : 0;   // seeds = land
    dToWater[i] = isW ? 0 : INF;  // seeds = water
  }
  chamfer34(dToLand, w, h); // only touches [0, w*h); any stale tail beyond N is never read
  chamfer34(dToWater, w, h);
  for (let i = 0; i < N; i++) sd[i] = water[i] ? dToLand[i] : -dToWater[i];
  return sd;
}

export function computeCoastSDFBytes(water, w, h, rangeTexels, outB) {
  const sd = signedDistChamfer(water, w, h);
  const k = 127 / (CHAMF_UNITS_PER_TEXEL * Math.max(1, rangeTexels || 40)); // chamfer-units → byte offset
  for (let i = 0, N = w * h; i < N; i++) {
    let b = 128 + Math.round(sd[i] * k);
    b = b < 0 ? 0 : (b > 255 ? 255 : b);
    outB[i] = b;
  }
  return outB;
}

/**
 * Read a finalized RGBA mask canvas, compute the coast SDF from `.r`, and write it into `.b` (A pinned
 * to 255; R/G untouched so every existing shader read is byte-identical). No-op (returns false) unless
 * opted in. Returns true when the SDF was written.
 */
export function writeCoastDistanceField(canvas, opts) {
  opts = opts || {};
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_COAST_SDF__ === true) return false;
  const optedIn = opts.force === true || (typeof window !== 'undefined' && window.__RAW_COAST_SDF__ === true);
  if (!optedIn) return false;
  if (!canvas || !canvas.width || !canvas.height || typeof canvas.getContext !== 'function') return false;
  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  const tA = now();
  let ctx, img;
  try {
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch (e) { return false; }
  const tB = now();
  const W = canvas.width, H = canvas.height, N = W * H;
  const px = img.data;
  const waterCut = opts.waterCut != null ? opts.waterCut : 128;
  const water = new Uint8Array(N);
  for (let i = 0; i < N; i++) water[i] = px[i * 4] >= waterCut ? 1 : 0;
  const rangeTexels = opts.rangeTexels != null ? opts.rangeTexels
    : ((typeof window !== 'undefined' && Number(window.__RAW_COAST_SDF_RANGE__)) || 40);
  const k = 127 / (CHAMF_UNITS_PER_TEXEL * Math.max(1, rangeTexels));
  // DOWNSAMPLE lever (__RAW_COAST_SDF_MAXDIM__, e.g. 1024): run the distance transform at reduced res
  // and NEAREST-upsample the distance into full-res .b — the GPU LINEAR filter + the erosion offset
  // hide the coarser grid. 0/absent = exact full-res. The transform is the cost; nearest keeps the
  // upsample cheap. A stepping stone; the real perf fix is a GPU jump-flood (see the handoff).
  const maxDim = opts.maxDim != null ? opts.maxDim
    : ((typeof window !== 'undefined' && Number(window.__RAW_COAST_SDF_MAXDIM__)) || 0);
  const step = (maxDim && W > maxDim) ? Math.ceil(W / maxDim) : 1;
  const tC = now();
  if (step <= 1) {
    const sd = signedDistChamfer(water, W, H);
    for (let i = 0; i < N; i++) { let b = 128 + Math.round(sd[i] * k); b = b < 0 ? 0 : (b > 255 ? 255 : b); px[i * 4 + 2] = b; px[i * 4 + 3] = 255; }
  } else {
    const dsW = Math.ceil(W / step), dsH = Math.ceil(H / step);
    const dsWater = new Uint8Array(dsW * dsH);
    for (let y = 0; y < dsH; y++) for (let x = 0; x < dsW; x++) {
      const sx = Math.min(W - 1, x * step + (step >> 1)), sy = Math.min(H - 1, y * step + (step >> 1));
      dsWater[y * dsW + x] = water[sy * W + sx];
    }
    const sdDs = signedDistChamfer(dsWater, dsW, dsH);
    const kk = k * step; // one ds-pixel distance = `step` full-res texels
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = Math.min(dsW - 1, (x / step) | 0), dy = Math.min(dsH - 1, (y / step) | 0);
      let b = 128 + Math.round(sdDs[dy * dsW + dx] * kk);
      b = b < 0 ? 0 : (b > 255 ? 255 : b);
      const i = y * W + x; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
    }
  }
  const tD = now();
  try { ctx.putImageData(img, 0, 0); } catch (e) { return false; }
  const tE = now();
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.coastSdf = {
      dims: `${W}x${H}`, step, rangeTexels, ms: +(tE - tA).toFixed(1),
      read: +(tB - tA).toFixed(1), compute: +(tD - tC).toFixed(1), put: +(tE - tD).toFixed(1),
    };
  }
  return true;
}

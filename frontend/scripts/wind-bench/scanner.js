/**
 * Wind bench: the significance-tested artifact scanner. Pure math, no DOM, no GL, so Jest covers it
 * (src/components/map/windBenchScanner.test.js) and the page, Node and the test share ONE copy.
 *
 * What it answers: "is there a shape on screen that the wind field does not explain?" The owner
 * calls them diamonds, rectangles and holes. Eyeballing them failed twice, so the scanner works in
 * four steps:
 *
 *   1. BLOCKS: the trail framebuffer is cut into 32 css px blocks. A block's ink is the mean of
 *      max(R,G,B) over its pixels (the legacy composite's alpha IS brightness, so max-RGB is what the
 *      eye sees).
 *   2. RESIDUAL: each block's ink over the median ink of the blocks 2 to 4 blocks away (a square
 *      ring, Chebyshev distance). A smooth field gives about 1. The near ring (distance 1) is left
 *      out so a shape a few blocks wide cannot hide inside its own reference.
 *   3. CLUSTERS: blocks below 0.72 (a HOLE) or above 1.38 (a BLOB), joined 4-connected with others
 *      of the same sign.
 *   4. NULL: the same ink values are shuffled across the same blocks 30 times. The 95th percentile
 *      of the largest cluster per shuffle is the biggest cluster chance alone makes. Only larger
 *      clusters are significant. Without this step a sparse z10 field produced fake "artifacts", and
 *      two identical renders disagreed with each other (4 vs 7).
 *
 * A significant cluster whose mean wind is under 5 kn is labelled calm: thin, slow air is expected
 * to look patchy. Every other significant cluster is an ARTIFACT.
 */

const DEFAULTS = Object.freeze({
  blockCss: 32,     // block edge, css px
  stride: 2,        // sample every 2nd device pixel in x and in y
  satLevel: 200,    // max-RGB above this is a saturated pixel
  litLevel: 32,     // max-RGB above this is a lit (trail) pixel, for brightness per speed band
  ringInner: 2,     // ring of reference blocks: Chebyshev distance 2..4
  ringOuter: 4,
  minRing: 20,      // fewer valid reference blocks than this: no residual (screen edges)
  lo: 0.72,         // residual below: HOLE candidate
  hi: 1.38,         // residual above: BLOB candidate
  shuffles: 30,     // permutation null size
  quantile: 0.95,   // chance cluster size = this quantile of the null maxima
  calmKn: 5,        // significant clusters slower than this are calm air, not artifacts
  bandKn: 5,        // speed band width for the per-band table
  minBandBlocks: 8, // bands with fewer blocks are not reported
  seed: 1,         // permutation RNG seed: the same ink grid always gets the same verdict
});

/** Deterministic RNG (mulberry32), so a scan is reproducible from its ink grid alone. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Upper median (index floor(n/2) of the sorted values), as the 2026-10-08 scanner used. */
function upperMedian(values) {
  const s = values.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

/**
 * Step 1. `pixels` is RGBA from gl.readPixels: row 0 is the BOTTOM of the screen.
 * Returns per-block mean ink, lit-pixel brightness, and the whole-screen saturated fraction.
 */
function blockStats(pixels, devW, devH, cssW, cssH, dpr, options) {
  const o = { ...DEFAULTS, ...options };
  const B = o.blockCss;
  const bw = Math.floor(cssW / B), bh = Math.floor(cssH / B);
  const ink = new Float64Array(bw * bh), litSum = new Float64Array(bw * bh), litN = new Uint32Array(bw * bh);
  let n = 0, saturated = 0;
  for (let by = 0; by < bh; by++) {
    const yT = Math.round(by * B * dpr), yB = Math.min(devH, Math.round((by + 1) * B * dpr));
    for (let bx = 0; bx < bw; bx++) {
      const x0 = Math.round(bx * B * dpr), x1 = Math.min(devW, Math.round((bx + 1) * B * dpr));
      let s = 0, k = 0;
      const cell = by * bw + bx;
      for (let y = yT; y < yB; y += o.stride) {
        for (let x = x0; x < x1; x += o.stride) {
          const i = ((devH - 1 - y) * devW + x) * 4;
          const b = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
          s += b; k++;
          if (b > o.satLevel) saturated++;
          if (b > o.litLevel) { litSum[cell] += b; litN[cell]++; }
        }
      }
      n += k;
      ink[cell] = k ? s / k : 0;
    }
  }
  return { bw, bh, ink, litSum, litN, saturatedFrac: n ? saturated / n : 0 };
}

/** Step 2. Residual = ink / upper median of the valid blocks 2..4 away. NaN where undefined. */
function ringResiduals(ink, bw, bh, valid, options) {
  const o = { ...DEFAULTS, ...options };
  const res = new Float64Array(bw * bh).fill(NaN);
  const ring = [];
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      if (valid && !valid[i]) continue;
      ring.length = 0;
      for (let dy = -o.ringOuter; dy <= o.ringOuter; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= bh) continue;
        for (let dx = -o.ringOuter; dx <= o.ringOuter; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < o.ringInner) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= bw) continue;
          const j = ny * bw + nx;
          if (!valid || valid[j]) ring.push(ink[j]);
        }
      }
      if (ring.length < o.minRing) continue;
      const med = upperMedian(ring);
      if (med > 0) res[i] = ink[i] / med;
    }
  }
  return res;
}

/** Step 3. 4-connected same-sign clusters of out-of-band residuals, in cell-index order. */
function findClusters(res, bw, bh, options) {
  const o = { ...DEFAULTS, ...options };
  const flagged = (i) => Number.isFinite(res[i]) && (res[i] < o.lo || res[i] > o.hi);
  const seen = new Uint8Array(bw * bh);
  const clusters = [];
  for (let i0 = 0; i0 < bw * bh; i0++) {
    if (seen[i0] || !flagged(i0)) continue;
    const low = res[i0] < 1;
    const cells = [], stack = [i0];
    seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop();
      cells.push(i);
      const x = i % bw, y = (i - x) / bw;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const j = ny * bw + nx;
        if (!seen[j] && flagged(j) && (res[j] < 1) === low) { seen[j] = 1; stack.push(j); }
      }
    }
    cells.sort((a, b) => a - b);
    clusters.push({ low, cells, meanRes: cells.reduce((a, i) => a + res[i], 0) / cells.length });
  }
  return clusters;
}

/** Step 4. Largest cluster per shuffle of the valid blocks' ink, sorted ascending. */
function nullMaxSizes(ink, bw, bh, valid, options) {
  const o = { ...DEFAULTS, ...options };
  const rng = o.rng || mulberry32(o.seed);
  const slots = [];
  for (let i = 0; i < bw * bh; i++) if (!valid || valid[i]) slots.push(i);
  const maxima = [];
  for (let p = 0; p < o.shuffles; p++) {
    const values = slots.map((i) => ink[i]);
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    const shuffled = Float64Array.from(ink);
    slots.forEach((cell, k) => { shuffled[cell] = values[k]; });
    const clusters = findClusters(ringResiduals(shuffled, bw, bh, valid, o), bw, bh, o);
    maxima.push(clusters.reduce((m, c) => Math.max(m, c.cells.length), 0));
  }
  return maxima.sort((a, b) => a - b);
}

function quantileOf(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

const round = (x, dp) => (Number.isFinite(x) ? +x.toFixed(dp) : null);

/**
 * The whole scan on a block grid. `speed[i]` is the wind speed (kn) under block i, or null where
 * no grid covers it; such blocks are invalid: never flagged and never anyone's reference.
 */
function scanBlocks(blocks, options) {
  const o = { ...DEFAULTS, ...options };
  const { bw, bh, ink, speed } = blocks;
  const litSum = blocks.litSum || new Float64Array(bw * bh);
  const litN = blocks.litN || new Uint32Array(bw * bh);
  const valid = Uint8Array.from({ length: bw * bh }, (_, i) => (speed[i] == null ? 0 : 1));
  const validCells = [];
  for (let i = 0; i < bw * bh; i++) if (valid[i]) validCells.push(i);

  const clusters = findClusters(ringResiduals(ink, bw, bh, valid, o), bw, bh, o);
  const nullMaxima = nullMaxSizes(ink, bw, bh, valid, o);
  const chanceBlocks = quantileOf(nullMaxima, o.quantile);
  const B = o.blockCss;
  const significant = clusters.filter((c) => c.cells.length > chanceBlocks).map((c) => {
    const kn = c.cells.reduce((a, i) => a + speed[i], 0) / c.cells.length;
    return {
      kind: c.low ? 'HOLE' : 'BLOB',
      blocks: c.cells.length,
      res: round(c.meanRes, 2),
      kn: round(kn, 1),
      at: [Math.round(c.cells.reduce((a, i) => a + ((i % bw) + 0.5) * B, 0) / c.cells.length),
        Math.round(c.cells.reduce((a, i) => a + (Math.floor(i / bw) + 0.5) * B, 0) / c.cells.length)],
      calm: kn < o.calmKn,
    };
  });
  const artifacts = significant.filter((c) => !c.calm);

  const litMean = (cells) => {
    let s = 0, n = 0;
    cells.forEach((i) => { s += litSum[i]; n += litN[i]; });
    return n ? s / n : NaN;
  };
  const bands = [];
  for (let lo = 0; lo < 80; lo += o.bandKn) {
    const cells = validCells.filter((i) => speed[i] >= lo && speed[i] < lo + o.bandKn);
    if (cells.length < o.minBandBlocks) continue;
    bands.push({ kn: lo, blocks: cells.length, ink: round(cells.reduce((a, i) => a + ink[i], 0) / cells.length, 1), lit: round(litMean(cells), 1) });
  }
  // Storm/slow: lit brightness of the fastest band on screen over the slowest non-calm one. Lit
  // pixels only, so it compares how bright a fast MARK is with a slow one, not how many there are
  // (raw ink mixes coverage with brightness). Relative to the view because a z8 storm view has no
  // 5-15 kn air at all; the pair it used is reported as stormSlowKn.
  const litBands = bands.filter((b) => b.kn >= o.calmKn && b.lit != null);
  const fast = litBands[litBands.length - 1], slow = litBands[0];
  const stormSlow = litBands.length >= 2 ? fast.lit / slow.lit : NaN;

  return {
    ink: round(validCells.reduce((a, i) => a + ink[i], 0) / (validCells.length || 1), 1),
    stormSlow: round(stormSlow, 2),
    stormSlowKn: litBands.length >= 2 ? [fast.kn, slow.kn] : null,
    chanceBlocks,
    nullMaxima,
    clusters: clusters.length,
    significant,
    artifacts: artifacts.length,
    artifactBlocks: artifacts.reduce((a, c) => a + c.blocks, 0),
    bands,
  };
}

module.exports = { DEFAULTS, mulberry32, upperMedian, blockStats, ringResiduals, findClusters, nullMaxSizes, quantileOf, scanBlocks };

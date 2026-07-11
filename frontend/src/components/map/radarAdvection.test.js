/**
 * radarAdvection.test.js — the pure motion-estimation + warp core (backlog #2 foundation).
 * Synthetic shifted frames → the estimator must recover the shift; the warp must advect it.
 * Headless, deterministic — no DOM/canvas (the core operates on plain RGBA arrays).
 */
import { echoField, echoFraction, estimateMotion, advectTile, advectTileWithNeighbors, advectForecast } from './radarAdvection';

const W = 256, H = 256;

// A soft radar "echo" blob: alpha = gaussian, RGB a fixed precip color where alpha>0.
function makeBlob(cx, cy, radius, width = W, height = H) {
  const data = new Uint8ClampedArray(width * height * 4);
  const sigma = radius / 2;
  const twoSig2 = 2 * sigma * sigma;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      const a = 255 * Math.exp(-d2 / twoSig2);
      const i = (y * width + x) * 4;
      data[i] = 100; data[i + 1] = 180; data[i + 2] = 255;
      data[i + 3] = a; // Uint8ClampedArray rounds/clamps
    }
  }
  return data;
}

const emptyTile = () => new Uint8ClampedArray(W * H * 4);

// Alpha-weighted centroid — where the echo "is".
function centroid(rgba, width = W, height = H) {
  let sx = 0, sy = 0, sw = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = rgba[(y * width + x) * 4 + 3];
      sx += x * a; sy += y * a; sw += a;
    }
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw, mass: sw } : { x: NaN, y: NaN, mass: 0 };
}

describe('radarAdvection — echoField / echoFraction', () => {
  it('localizes echo to the blob region and reads ~0 elsewhere', () => {
    const f = echoField(makeBlob(64, 64, 24), W, H, 64);
    // grid cell for (64,64) on a 64-grid over 256px = cell (16,16)
    expect(f[16 * 64 + 16]).toBeGreaterThan(0.3);
    expect(f[0]).toBeLessThan(0.02);          // far corner ~ no echo
    expect(f[63 * 64 + 63]).toBeLessThan(0.02);
  });

  it('empty tile → all-zero field, zero fraction', () => {
    const f = echoField(emptyTile(), W, H, 64);
    expect(f.reduce((a, b) => a + b, 0)).toBe(0);
    expect(echoFraction(f)).toBe(0);
  });
});

describe('radarAdvection — estimateMotion recovers a known shift', () => {
  const cases = [
    { name: 'rightward', SX: 16, SY: 0 },
    { name: 'downward', SX: 0, SY: 20 },
    { name: 'diagonal +/-', SX: 16, SY: -12 },
    { name: 'leftward-up', SX: -20, SY: -16 },
  ];
  for (const { name, SX, SY } of cases) {
    it(`${name} (${SX},${SY})`, () => {
      const prev = makeBlob(128, 128, 26);
      const curr = makeBlob(128 + SX, 128 + SY, 26);
      const { dx, dy, confidence } = estimateMotion(prev, curr, W, H);
      expect(confidence).toBeGreaterThan(0.1);
      expect(dx).toBeCloseTo(SX, -0.7);  // within ~5px
      expect(dy).toBeCloseTo(SY, -0.7);
    });
  }
});

describe('radarAdvection — estimateMotion degenerate cases', () => {
  it('two empty tiles → zero motion, zero confidence', () => {
    const r = estimateMotion(emptyTile(), emptyTile(), W, H);
    expect(r).toEqual({ dx: 0, dy: 0, confidence: 0 });
  });

  it('identical tiles → ~zero motion', () => {
    const t = makeBlob(128, 128, 26);
    const r = estimateMotion(t, Uint8ClampedArray.from(t), W, H);
    expect(Math.abs(r.dx)).toBeLessThan(3);
    expect(Math.abs(r.dy)).toBeLessThan(3);
  });

  it('rejects an implausibly large jump (clamp) → zero', () => {
    const prev = makeBlob(40, 40, 18);
    const curr = makeBlob(220, 220, 18); // ~180px jump >> maxMotionCells
    const r = estimateMotion(prev, curr, W, H);
    expect(r).toEqual({ dx: 0, dy: 0, confidence: 0 });
  });
});

describe('radarAdvection — advectTile', () => {
  it('shifts the echo by (dx,dy)', () => {
    const t = makeBlob(100, 100, 24);
    const out = advectTile(t, W, H, 30, -18);
    const c = centroid(out);
    expect(c.x).toBeCloseTo(130, -0.9);
    expect(c.y).toBeCloseTo(82, -0.9);
  });

  it('(0,0) is identity', () => {
    const t = makeBlob(128, 128, 24);
    const out = advectTile(t, W, H, 0, 0);
    expect(Array.from(out)).toEqual(Array.from(t));
  });

  it('warping fully out of bounds → transparent', () => {
    const t = makeBlob(128, 128, 20);
    const out = advectTile(t, W, H, 400, 0);
    expect(centroid(out).mass).toBe(0);
  });
});

describe('radarAdvection — advectTileWithNeighbors fills the upwind edge (no "rectangle" blank)', () => {
  // Solid opaque tiles of distinct colors so we can read which source filled each output band.
  const solid = (r, g, b) => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
    return d;
  };
  const px = (d, x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };

  it('eastward motion pulls the WEST neighbor into the incoming left band (not transparent)', () => {
    const center = solid(255, 0, 0);   // red
    const west = solid(0, 255, 0);     // green (the upwind neighbor for dx>0)
    const out = advectTileWithNeighbors({ '0,0': center, '-1,0': west }, W, H, 80, 0);
    // Left band (x < 80) sampled from x-80 < 0 → the west neighbor: green + opaque, NOT blank.
    expect(px(out, 5, 128)).toEqual([0, 255, 0, 255]);
    expect(px(out, 40, 128)).toEqual([0, 255, 0, 255]);
    // Interior (x well past the seam) is still the center echo.
    expect(px(out, 200, 128)).toEqual([255, 0, 0, 255]);
  });

  it('without the neighbor, the same warp leaves a transparent band (the bug it fixes)', () => {
    const out = advectTile(solid(255, 0, 0), W, H, 80, 0);
    expect(px(out, 5, 128)[3]).toBe(0);   // isolated per-tile warp → blank incoming band
    expect(px(out, 40, 128)[3]).toBe(0);
    expect(px(out, 200, 128)).toEqual([255, 0, 0, 255]);
  });

  it('a MISSING upwind neighbor degrades to transparent for that band (grid-edge safety)', () => {
    const out = advectTileWithNeighbors({ '0,0': solid(255, 0, 0) }, W, H, 80, 0);
    expect(px(out, 5, 128)[3]).toBe(0);   // no neighbor supplied → same as isolated warp, no crash
    expect(px(out, 200, 128)).toEqual([255, 0, 0, 255]);
  });

  it('(0,0) motion is identity on the center tile', () => {
    const center = solid(10, 20, 30);
    const out = advectTileWithNeighbors({ '0,0': center, '-1,0': solid(0, 0, 0) }, W, H, 0, 0);
    expect(Array.from(out)).toEqual(Array.from(center));
  });
});

describe('radarAdvection — advectForecast extrapolates along the motion', () => {
  it('leadFactor scales the predicted displacement', () => {
    const SX = 16, SY = 8;
    const prev = makeBlob(110, 120, 26);
    const curr = makeBlob(110 + SX, 120 + SY, 26);

    const f1 = advectForecast(prev, curr, W, H, 1);
    const c1 = centroid(f1.data);
    // curr blob at (126,128); +1× motion → ~(142,136)
    expect(c1.x).toBeCloseTo(110 + 2 * SX, -0.9);
    expect(c1.y).toBeCloseTo(120 + 2 * SY, -0.9);

    const f2 = advectForecast(prev, curr, W, H, 2);
    const c2 = centroid(f2.data);
    // +2× motion → ~(158,144)
    expect(c2.x).toBeCloseTo(110 + 3 * SX, -0.9);
    expect(c2.y).toBeCloseTo(120 + 3 * SY, -0.9);
  });

  it('no-echo input → confidence 0 and an unchanged (still-transparent) tile', () => {
    const f = advectForecast(emptyTile(), emptyTile(), W, H, 3);
    expect(f.confidence).toBe(0);
    expect(centroid(f.data).mass).toBe(0);
  });
});

describe('radarAdvection — advectTileSmoothField (continuous motion, no gridlike seams)', () => {
  const { advectTileSmoothField } = require('./radarAdvection');

  // A horizontal linear alpha gradient — any sampling discontinuity shows as a value jump.
  function makeGradient(offsetX, width = W, height = H) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const a = ((x + offsetX) % 1024) / 1024 * 255;
        data[i] = 100; data[i + 1] = 180; data[i + 2] = 255; data[i + 3] = a;
      }
    }
    return data;
  }

  it('uniform vectors reproduce the rigid neighbor warp', () => {
    const tiles = {};
    for (let gy = -1; gy <= 1; gy++) for (let gx = -1; gx <= 1; gx++) {
      tiles[`${gx},${gy}`] = makeBlob(128, 128, 40);
    }
    const motions = {};
    for (let gy = -1; gy <= 1; gy++) for (let gx = -1; gx <= 1; gx++) {
      motions[`${gx},${gy}`] = { dx: 12, dy: -8, confidence: 0.5 };
    }
    const smooth = advectTileSmoothField(tiles, motions, W, H, 2);
    const rigid = advectTileWithNeighbors(tiles, W, H, 24, -16);
    // identical vectors everywhere → identical sampling
    let maxDiff = 0;
    for (let i = 3; i < smooth.length; i += 4) maxDiff = Math.max(maxDiff, Math.abs(smooth[i] - rigid[i]));
    expect(maxDiff).toBeLessThanOrEqual(1); // rounding only
  });

  it('differing neighbor vectors stay CONTINUOUS across the shared tile edge', () => {
    // Two adjacent center tiles A (at grid 0) and B (at grid +1) over a seamless global gradient.
    // A's neighborhood and B's neighborhood share the physical tiles/vectors along their boundary,
    // so the warped outputs must meet continuously at the seam (the "gridlike" bug was a jump here).
    const tileAt = (g) => makeGradient(g * W); // physical tile at global column g
    const motionAt = (g) => ({ dx: g % 2 === 0 ? 16 : -16, dy: 0, confidence: 0.5 }); // alternating motion!
    const nb = (cg) => { // neighborhood (tiles+motions) for the center at global column cg
      const tiles = {}, motions = {};
      for (let gy = -1; gy <= 1; gy++) for (let gx = -1; gx <= 1; gx++) {
        tiles[`${gx},${gy}`] = tileAt(cg + gx);
        motions[`${gx},${gy}`] = motionAt(cg + gx);
      }
      return { tiles, motions };
    };
    const a = nb(0), b = nb(1);
    const outA = advectTileSmoothField(a.tiles, a.motions, W, H, 2);
    const outB = advectTileSmoothField(b.tiles, b.motions, W, H, 2);
    // Compare the seam: A's last column vs B's first column, mid rows (away from top/bottom edges).
    let maxJump = 0;
    for (let y = 32; y < H - 32; y++) {
      const aA = outA[(y * W + (W - 1)) * 4 + 3];
      const aB = outB[(y * W + 0) * 4 + 3];
      // adjacent PIXELS of a 1024-period gradient differ by ~0.25 alpha; allow a few counts
      maxJump = Math.max(maxJump, Math.abs(aA - aB));
    }
    expect(maxJump).toBeLessThanOrEqual(3);
    // Sanity: the field actually moved (not a no-op) — alternating ±16 vectors × lead 2
    const rigidA = advectTileWithNeighbors(a.tiles, W, H, 32, 0);
    let differs = 0;
    for (let i = 3; i < outA.length; i += 4) if (Math.abs(outA[i] - rigidA[i]) > 2) differs++;
    expect(differs).toBeGreaterThan(1000); // smooth field ≠ rigid warp when vectors vary
  });

  it('conf-0 zero neighbors do NOT damp real motion (confidence weighting)', () => {
    // The verbatim-zero version dragged the field toward 0 near edges wherever a neighbor had
    // no measurable echo — "not actually moving forward much". With confidence weighting the
    // conf-0 zeros contribute ~nothing: the blob must advect by ~the full center vector.
    const tiles = { '0,0': makeBlob(128, 128, 40) };
    const motions = { '0,0': { dx: 16, dy: 0, confidence: 0.5 } };
    for (let gy = -1; gy <= 1; gy++) for (let gx = -1; gx <= 1; gx++) {
      if (gx === 0 && gy === 0) continue;
      tiles[`${gx},${gy}`] = emptyTile();
      motions[`${gx},${gy}`] = { dx: 0, dy: 0, confidence: 0 }; // no-echo identity verdicts
    }
    const outSm = advectTileSmoothField(tiles, motions, W, H, 1);
    const c = centroid(outSm);
    expect(c.x).toBeGreaterThan(128 + 16 * 0.9); // ≥90% of the true displacement survives
    expect(c.x).toBeLessThan(128 + 16 * 1.05);
  });

  it('MISSING neighbor motions fall back to the center vector (uniform field)', () => {
    const tiles = { '0,0': makeBlob(128, 128, 40) };
    const motionsMissing = { '0,0': { dx: 10, dy: 0, confidence: 0.5 } }; // all neighbors absent
    const a = advectTileSmoothField(tiles, motionsMissing, W, H, 1);
    const c = centroid(a);
    expect(c.x).toBeCloseTo(138, -0.9); // blob at 128 + 10px — uniform center-vector field
  });

  it('PRESENT zero-motion entries are used VERBATIM (seam symmetry), any confidence', () => {
    // Two adjacent neighborhoods where tile B's verdict is a conf-0 identity: both sides must
    // interpolate the SAME (A, B=0) vector pair at the seam — the old per-side center-fallback
    // rule re-created the seam here (real-tile proof: z7/100,101 residual 14.6 → symmetric now).
    const tileAt = (g) => makeGradient(g * W);
    const motionAt = (g) => (g === 1 ? { dx: 0, dy: 0, confidence: 0 } : { dx: 16, dy: 0, confidence: 0.5 });
    const nb = (cg) => {
      const tiles = {}, motions = {};
      for (let gy = -1; gy <= 1; gy++) for (let gx = -1; gx <= 1; gx++) {
        tiles[`${gx},${gy}`] = tileAt(cg + gx);
        motions[`${gx},${gy}`] = motionAt(cg + gx);
      }
      return { tiles, motions };
    };
    const a = nb(0), b = nb(1);
    const outA = advectTileSmoothField(a.tiles, a.motions, W, H, 2);
    const outB = advectTileSmoothField(b.tiles, b.motions, W, H, 2);
    let maxJump = 0;
    for (let y = 32; y < H - 32; y++) {
      maxJump = Math.max(maxJump, Math.abs(outA[(y * W + (W - 1)) * 4 + 3] - outB[(y * W) * 4 + 3]));
    }
    expect(maxJump).toBeLessThanOrEqual(3);
  });
});

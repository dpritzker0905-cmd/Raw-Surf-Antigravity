/**
 * radarAdvection.test.js — the pure motion-estimation + warp core (backlog #2 foundation).
 * Synthetic shifted frames → the estimator must recover the shift; the warp must advect it.
 * Headless, deterministic — no DOM/canvas (the core operates on plain RGBA arrays).
 */
import { echoField, echoFraction, estimateMotion, advectTile, advectForecast } from './radarAdvection';

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

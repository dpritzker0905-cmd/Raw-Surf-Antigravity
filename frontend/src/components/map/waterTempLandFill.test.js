import { oceanFillLandCells, coastalOutlierQC, fastCoastalOutlierQC, fastOceanFillLandCells, applyWaterTempLandFill } from './waterTempLandFill';

// Deterministic PRNG so every run checks the same fields.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// A land mask of blobs, coasts, one-cell islands and thin spits; a smooth "SST" field with land heat, spikes and NaN holes.
function scene(seed, nx = 160, ny = 110) {
  const r = rng(seed);
  const mask = new Uint8Array(nx * ny);
  for (let b = 0; b < 9; b++) {
    const cx = r() * nx; const cy = r() * ny; const rad = 2 + r() * 14;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if ((x - cx) ** 2 + (y - cy) ** 2 < rad * rad) mask[y * nx + x] = 1;
  }
  for (let k = 0; k < 40; k++) mask[Math.floor(r() * nx * ny)] = 1;                       // one-cell islands
  for (let k = 0; k < 6; k++) { const y = Math.floor(r() * ny); const x0 = Math.floor(r() * nx); for (let x = x0; x < Math.min(nx, x0 + 25); x++) mask[y * nx + x] = 1; }
  const values = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = y * nx + x;
    values[i] = 18 + 6 * Math.sin(x / 17) + 4 * Math.cos(y / 11) + (mask[i] ? 8 + r() * 25 : r() * 0.8);
    if (!mask[i] && r() < 0.02) values[i] += (r() < 0.5 ? -1 : 1) * (4 + r() * 20);      // coastal outliers
    if (r() < 0.015) values[i] = NaN;                                                       // holes
  }
  return { mask, values, nx, ny };
}

const sameBytes = (a, b) => Buffer.from(a.buffer).equals(Buffer.from(b.buffer));

describe('fast path = legacy path, byte for byte', () => {
  for (let seed = 1; seed <= 40; seed++) {
    test(`scene ${seed}: QC + fill`, () => {
      const { mask, values, nx, ny } = scene(seed);
      const legacy = Float32Array.from(values);
      const legacyMask = coastalOutlierQC(legacy, mask, nx, ny);
      oceanFillLandCells(legacy, legacyMask, nx, ny);
      const fast = Float32Array.from(values);
      const { augmented, added } = fastCoastalOutlierQC(fast, mask, nx, ny);
      expect(sameBytes(augmented, legacyMask)).toBe(true);
      expect(added.length).toBe([...legacyMask].filter((v, i) => v === 1 && mask[i] === 0).length);
      fastOceanFillLandCells(fast, augmented, nx, ny, mask, added);
      expect(sameBytes(fast, legacy)).toBe(true);
    });
  }
  test('fill alone (QC off), several scenes', () => {
    for (let seed = 50; seed < 60; seed++) {
      const { mask, values, nx, ny } = scene(seed, 97, 61);
      const legacy = Float32Array.from(values); oceanFillLandCells(legacy, mask, nx, ny);
      const fast = Float32Array.from(values); fastOceanFillLandCells(fast, mask, nx, ny, mask, []);
      expect(sameBytes(fast, legacy)).toBe(true);
    }
  });
  test('all water, all land, edges', () => {
    for (const fill of [0, 1]) {
      const nx = 9; const ny = 7; const mask = new Uint8Array(nx * ny).fill(fill);
      const values = Float32Array.from({ length: nx * ny }, (_, i) => i / 3);
      const legacy = Float32Array.from(values); oceanFillLandCells(legacy, coastalOutlierQC(legacy, mask, nx, ny), nx, ny);
      const fast = Float32Array.from(values); applyWaterTempLandFill(fast, mask, nx, ny, false);
      expect(sameBytes(fast, legacy)).toBe(true);
    }
  });
});

describe('applyWaterTempLandFill', () => {
  afterEach(() => { delete globalThis.__RAW_DISABLE_WT_FAST_FILL__; });
  test('fast and killed (legacy) give the same field', () => {
    const { mask, values, nx, ny } = scene(77);
    const a = Float32Array.from(values); applyWaterTempLandFill(a, mask, nx, ny, false);
    globalThis.__RAW_DISABLE_WT_FAST_FILL__ = true;
    const b = Float32Array.from(values); applyWaterTempLandFill(b, mask, nx, ny, false);
    expect(sameBytes(a, b)).toBe(true);
  });
});

/**
 * EURO wind fixes (forensics 2026-06-25, deterministic from backend curls):
 *  - SEAM: EURO global wind ships a near-zero +180 column while -180 carries wind (GFS has them
 *    equal). lng -180 ≡ lng +180 → repairGlobalWindSeamInPlace copies -180→+180. No-op for GFS.
 *  - CLEARING: a failed wind /grid (EURO 500 → browser CORS error) returns a 1-vector safe-zero grid;
 *    committing it clears the heatmap. isRenderableWindData gates the commit so we retain instead.
 */
import { repairGlobalWindSeamInPlace } from '../components/map/WebGLWindUtils';
import { isRenderableWindData } from '../components/map/windController';

function mkData(cols, rows, fill) {
  const d = new Uint8Array(cols * rows * 4);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 4;
      const [a, b, cc, dd] = fill(r, c);
      d[i] = a; d[i + 1] = b; d[i + 2] = cc; d[i + 3] = dd;
    }
  }
  return d;
}

describe('repairGlobalWindSeamInPlace — EURO antimeridian seam fix', () => {
  it('copies the WEST (-180) column onto a DEAD EAST (+180) column for a global grid', () => {
    const cols = 4, rows = 2;
    const data = mkData(cols, rows, (r, c) =>
      c === 0 ? [100 + r, 110, 120, 255] : (c === cols - 1 ? [0, 0, 0, 255] : [50, 50, 50, 255]));
    const repaired = repairGlobalWindSeamInPlace(data, cols, rows, true, 13.92, 0.41);
    expect(repaired).toBe(true);
    for (let r = 0; r < rows; r++) {
      const src = (r * cols + 0) * 4;
      const dst = (r * cols + (cols - 1)) * 4;
      expect(Array.from(data.slice(dst, dst + 4))).toEqual(Array.from(data.slice(src, src + 4)));
    }
  });

  it('is a NO-OP when columns already match (GFS: last≈first)', () => {
    const cols = 4, rows = 2;
    const data = mkData(cols, rows, () => [10, 20, 30, 255]);
    const before = Array.from(data);
    expect(repairGlobalWindSeamInPlace(data, cols, rows, true, 13.31, 13.49)).toBe(false);
    expect(Array.from(data)).toEqual(before);
  });

  it('is a NO-OP for a non-global grid (regional edges legitimately differ)', () => {
    const cols = 4, rows = 2;
    const data = mkData(cols, rows, (r, c) => (c === cols - 1 ? [0, 0, 0, 255] : [50, 50, 50, 255]));
    expect(repairGlobalWindSeamInPlace(data, cols, rows, false, 13.9, 0.41)).toBe(false);
  });

  it('is a NO-OP for a single-column grid', () => {
    expect(repairGlobalWindSeamInPlace(new Uint8Array(4), 1, 1, true, 13, 0)).toBe(false);
  });
});

describe('isRenderableWindData — gate that prevents the EURO-wind clearing', () => {
  it('accepts a real renderable grid', () => {
    expect(isRenderableWindData({ vectors: [{ u: 1, v: 1, speed: 5 }], renderable: true })).toBe(true);
  });
  it('accepts a grid with no explicit renderable flag (legacy cache path)', () => {
    expect(isRenderableWindData({ vectors: [{ u: 1, v: 1, speed: 5 }] })).toBe(true);
  });
  it('REJECTS the 1-vector safe-zero fallback (renderable:false/stale:true) — committing it clears the heatmap', () => {
    expect(isRenderableWindData({ vectors: [{ u: 0, v: 0, speed: 0 }], renderable: false, stale: true, cols: 1, rows: 1 })).toBe(false);
  });
  it('rejects empty / null', () => {
    expect(isRenderableWindData({ vectors: [] })).toBe(false);
    expect(isRenderableWindData(null)).toBe(false);
  });
});

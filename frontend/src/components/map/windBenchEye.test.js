/**
 * The wind bench's EYE mode (frontend/scripts/wind-bench/eye.js), tested on masks and grids whose
 * answer is known. Lives under src/ because CRA's Jest only discovers tests there; nothing in the app
 * imports the bench. The GPU half (eye-run.js) is the instrument; this pins its arithmetic.
 */
import {
  gridFromFixture, worldBase, cropGrid, decimateGrid, thresholdRamp, components, eyeGeometry,
  eyeSummary, compareSummaries, sameEye, nodeAt,
} from '../../../scripts/wind-bench/eye';

const fixture = (west, south, cols, rows, step, fn) => {
  const u = [], v = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const [a, b] = fn(west + i * step, south + j * step); u.push(a); v.push(b); }
  return { product_id: 't', valid_time: '2026-10-09T15:00:00Z', bounds: { west, south, east: west + (cols - 1) * step, north: south + (rows - 1) * step }, cols, rows, u, v };
};

describe('grids', () => {
  const g = gridFromFixture(fixture(-90, 25, 5, 3, 0.5, (lng, lat) => [lng, lat]), 'g');

  test('a fixture becomes a point-registered engine grid, row-major from the south-west', () => {
    expect(g.cols).toBe(5);
    expect(g.vectors[0]).toMatchObject({ lng: -90, lat: 25, u: -90, v: 25 });
    expect(g.vectors[4]).toMatchObject({ lng: -88, lat: 25 });
    expect(g.vectors[14]).toMatchObject({ lng: -88, lat: 26 });
    expect(g.source).toBe('GFS');
    expect(g.coverage_scope).toBe('regional');
  });

  test('cropGrid keeps the same nodes and snaps the box to the lattice', () => {
    const c = cropGrid(g, { west: -89.7, east: -88.6, south: 25, north: 26 });
    expect(c.bounds).toEqual({ west: -89.5, east: -89, south: 25, north: 26 });
    expect(c.cols).toBe(2);
    expect(c.rows).toBe(3);
    expect(nodeAt(c, -89, 25.5)).toMatchObject({ u: -89, v: 25.5 });
  });

  test('decimateGrid takes every n-th node', () => {
    const d = decimateGrid(g, 2);
    expect([d.cols, d.rows]).toEqual([3, 2]);
    expect(d.bounds).toEqual({ west: -90, east: -88, south: 25, north: 26 });
    expect(nodeAt(d, -89, 26)).toMatchObject({ u: -89, v: 26 });
  });

  test('the world base copies served nodes where they exist and climatology elsewhere', () => {
    const w = worldBase([g]);
    expect([w.cols, w.rows]).toEqual([181, 83]);
    expect(w.coverage_scope).toBe('global');
    expect(nodeAt(w, -90, 26)).toMatchObject({ u: -90, v: 26 });
    const far = nodeAt(w, 0, 0);
    expect(far.u).not.toBe(0);
    expect(Number.isFinite(far.speed)).toBe(true);
  });
});

describe('thresholdRamp', () => {
  test('white strictly below T on the engine LUT convention (texel i = i/255 * max)', () => {
    const r = thresholdRamp(51, 20);
    expect(r[0]).toBe(255);
    expect(r[99 * 4]).toBe(255);           // 19.8 kn
    expect(r[100 * 4]).toBe(0);            // 20.0 kn
    expect(r[255 * 4 + 3]).toBe(255);      // alpha always opaque
  });
});

describe('eye geometry', () => {
  const W = 120, H = 120;
  // A ring of fast air (mask 0) of radius 20-35 px around (60, 60), slow air elsewhere (mask 1).
  const ringMask = (gap = false) => {
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - 60, y - 60);
      const wall = r >= 20 && r <= 35 && !(gap && x > 60 && Math.abs(y - 60) < 4);
      m[y * W + x] = wall ? 0 : 1;
    }
    return m;
  };
  const px = (x, y) => ({ lng: x / 100, lat: -y / 100 });   // 0.01 deg per pixel
  const ref = { lng: 0.6, lat: -0.6 };

  test('components are 4-connected and know whether they touch the edge', () => {
    const { comps } = components(ringMask(), W, H);
    expect(comps.length).toBe(2);
    expect(comps.filter((c) => c.touchesEdge).length).toBe(1);
  });

  test('a closed ring gives the enclosed eye: its centroid, equivalent radius and a round aspect', () => {
    const e = eyeGeometry(ringMask(), W, H, px, 1, ref);
    expect(e.lng).toBeCloseTo(0.6, 2);
    expect(e.lat).toBeCloseTo(-0.6, 2);
    expect(e.rKm).toBeGreaterThan(18.5);
    expect(e.rKm).toBeLessThan(20.5);
    expect(e.aspect).toBeLessThan(1.05);
  });

  test('a ring with a gap is an OPEN eye: null, because its low air reaches the outside', () => {
    expect(eyeGeometry(ringMask(true), W, H, px, 1, ref)).toBeNull();
  });

  test('specks under minPx (particle sprites) are not eyes', () => {
    const m = new Uint8Array(W * H);
    for (let y = 58; y < 62; y++) for (let x = 58; x < 62; x++) m[y * W + x] = 1;
    expect(eyeGeometry(m, W, H, px, 1, ref)).toBeNull();
    expect(eyeGeometry(m, W, H, px, 1, ref, 200, 10)).not.toBeNull();
  });
});

describe('summaries', () => {
  const eye = (lng, lat, areaKm2) => ({ lng, lat, areaKm2, rKm: Math.sqrt(areaKm2 / Math.PI), aspect: 1 });
  const Ts = [30, 32, 34, 36];

  test('firstT is the lowest closing threshold and closeT the last before the first gap', () => {
    const s = eyeSummary({ 30: null, 32: eye(-87.5, 28, 100), 34: eye(-87.5, 28, 200), 36: null }, Ts);
    expect([s.firstT, s.closeT]).toEqual([32, 34]);
    expect(s.centre).toEqual({ lng: -87.5, lat: 28 });
    expect(s.at.areaKm2).toBe(200);
    expect(eyeSummary({}, Ts)).toEqual({ firstT: null, closeT: null, centre: null, at: null });
  });

  test('the comparison reports centre shift, wall change and area at the common closing T', () => {
    const ea = { 30: eye(-87.5, 28, 100), 32: eye(-87.5, 28, 150), 34: eye(-87.5, 28, 200), 36: eye(-87.5, 28, 260) };
    const eb = { 30: eye(-87.5, 27.7, 300), 32: eye(-87.5, 27.7, 400), 34: null, 36: null };
    const c = compareSummaries(eyeSummary(ea, Ts), eyeSummary(eb, Ts), ea, eb);
    expect(c.shiftKm).toBeCloseTo(33.4, 1);
    expect(c.dCloseKn).toBe(-4);
    expect(c.atT).toBe(32);
    expect(c.areaRatio).toBeCloseTo(2.67, 2);
    expect(sameEye(c, { shiftKm: 5, closeKn: 0, areaRatio: 0.1 })).toBe(false);
    expect(sameEye(compareSummaries(eyeSummary(ea, Ts), eyeSummary(ea, Ts), ea, ea), { shiftKm: 5, closeKn: 0, areaRatio: 0.1 })).toBe(true);
  });

  test('open in both is the same (absent) eye; open in one is a change', () => {
    const none = eyeSummary({}, Ts), some = eyeSummary({ 30: eye(0, 0, 10) }, Ts);
    const tol = { shiftKm: 5, closeKn: 0, areaRatio: 0.1 };
    expect(sameEye(compareSummaries(none, none, {}, {}), tol)).toBe(true);
    expect(sameEye(compareSummaries(some, none, {}, {}), tol)).toBe(false);
  });
});

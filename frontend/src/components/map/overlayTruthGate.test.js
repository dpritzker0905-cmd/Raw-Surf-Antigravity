// AV-01a unit contract — resolveOverlayTruthUv / setOverlayTruthUniforms (Audit 4.0 lane,
// 2026-08-16). The pixel half lives in scripts/shaderlab-gate.js S8 (real compiled shader,
// ring probe + texel-perturbation containment); THIS file pins the pure math and the fail-open
// surface: every malformed input must yield enabled:false (legacy behavior), never a guess.
import { resolveOverlayTruthUv, setOverlayTruthUniforms } from './marineCoverageContract';

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const STORAGE = { west: -85, south: 20, east: -70, north: 40 };  // padded box
const TRUTH = { west: -82, south: 25, east: -74, north: 35 };    // strict viewport inside it

describe('resolveOverlayTruthUv — the truth box as an overlay-UV rect', () => {
  it('maps u linearly in degrees and v as a mercator RATIO (not linear lat)', () => {
    const r = resolveOverlayTruthUv(STORAGE, TRUTH, {});
    expect(r.enabled).toBe(true);
    // u: plain degree ratios
    expect(r.min[0]).toBeCloseTo((TRUTH.west - STORAGE.west) / (STORAGE.east - STORAGE.west), 10);
    expect(r.max[0]).toBeCloseTo((TRUTH.east - STORAGE.west) / (STORAGE.east - STORAGE.west), 10);
    // v: mercator ratio, v=0 at storage south, v=1 at storage north
    const vOf = (lat) => (mercY(STORAGE.south) - mercY(lat)) / (mercY(STORAGE.south) - mercY(STORAGE.north));
    expect(r.min[1]).toBeCloseTo(vOf(TRUTH.south), 10);
    expect(r.max[1]).toBeCloseTo(vOf(TRUTH.north), 10);
    // and the mercator ratio is NOT the linear-lat ratio at these asymmetric latitudes —
    // a linear-lat regression would pass a symmetric fixture; this one refuses it.
    const linear = (TRUTH.south - STORAGE.south) / (STORAGE.north - STORAGE.south);
    expect(Math.abs(r.min[1] - linear)).toBeGreaterThan(1e-4);
  });

  it('truth == storage resolves to the full [0,1] rect', () => {
    const r = resolveOverlayTruthUv(STORAGE, { ...STORAGE }, {});
    expect(r.enabled).toBe(true);
    expect(r.min[0]).toBeCloseTo(0, 10); expect(r.min[1]).toBeCloseTo(0, 10);
    expect(r.max[0]).toBeCloseTo(1, 10); expect(r.max[1]).toBeCloseTo(1, 10);
  });

  it('a truth box leaking past storage is clamped to [0,1], never extrapolated', () => {
    const r = resolveOverlayTruthUv(STORAGE, { west: -90, south: 10, east: -60, north: 50 }, {});
    expect(r.enabled).toBe(true);
    expect(r.min).toEqual([0, 0]);
    expect(r.max).toEqual([1, 1]);
  });

  it.each([
    ['kill switch', STORAGE, TRUTH, { __RAW_DISABLE_OVERLAY_TRUTH_GATE__: true }, 'killed'],
    ['missing truth (fallback overlay / identity mismatch)', STORAGE, null, {}, 'no_truth'],
    ['missing storage', null, TRUTH, {}, 'no_storage'],
    ['NaN in truth', STORAGE, { ...TRUTH, east: NaN }, {}, 'no_truth'],
    ['zero-span storage', { west: -80, south: 30, east: -80, north: 30 }, TRUTH, {}, 'degenerate_storage'],
    ['antimeridian-wrapped storage (east < west raw pair)', { west: 170, south: 20, east: -170, north: 40 }, TRUTH, {}, 'degenerate_storage'],
    ['inverted truth', STORAGE, { west: -74, south: 35, east: -82, north: 25 }, {}, 'degenerate_truth'],
  ])('fails OPEN on %s — enabled:false, legacy behavior', (_label, s, t, win, reason) => {
    const r = resolveOverlayTruthUv(s, t, win);
    expect(r.enabled).toBe(false);
    expect(r.reason).toBe(reason);
  });

  it('negative control: flipping ONLY the kill switch flips enabled', () => {
    expect(resolveOverlayTruthUv(STORAGE, TRUTH, {}).enabled).toBe(true);
    expect(resolveOverlayTruthUv(STORAGE, TRUTH, { __RAW_DISABLE_OVERLAY_TRUTH_GATE__: true }).enabled).toBe(false);
  });

  it('writes telemetry to __RAW_GPU__.overlayTruthGate when the sink exists', () => {
    const w = { __RAW_GPU__: {} };
    const r = resolveOverlayTruthUv(STORAGE, TRUTH, w);
    expect(w.__RAW_GPU__.overlayTruthGate).toBe(r);
    expect(w.__RAW_GPU__.overlayTruthGate.reason).toBe('gated');
  });
});

describe('setOverlayTruthUniforms — cached locations, null-location safety', () => {
  const mockGl = (locs) => {
    const calls = { f1: [], f2: [], queries: 0 };
    return {
      calls,
      getUniformLocation: (_p, name) => { calls.queries++; return name in locs ? locs[name] : null; },
      uniform1f: (loc, v) => calls.f1.push([loc, v]),
      uniform2f: (loc, x, y) => calls.f2.push([loc, x, y]),
    };
  };
  const LOCS = { u_overlayTruthEnabled: 'EN', u_overlayTruth_min: 'MN', u_overlayTruth_max: 'MX' };

  // ⛔ C4-MR-13 (2026-08-16): this asserted `queries === 3`, the same exact-count census the gate
  // setter carried — and it was REPLICATED here when this setter was written, which is how a defect
  // shape spreads. The count conflates "how many uniforms" with "is caching working", so it fails
  // when a uniform is added (correct code, wrong reason) and passes if caching broke while one was
  // removed. Split into the two facts.
  it('uploads flag + rect when enabled; caching re-queries NOTHING on the second call', () => {
    const gl = mockGl(LOCS); const prog = {};
    const rect = resolveOverlayTruthUv(STORAGE, TRUTH, {});
    expect(setOverlayTruthUniforms(gl, prog, rect)).toBe(true);
    const afterFirst = gl.calls.queries;
    expect(afterFirst).toBeGreaterThan(0);        // non-vacuity: it really does query on call 1
    setOverlayTruthUniforms(gl, prog, rect);
    expect(gl.calls.queries - afterFirst).toBe(0); // THE invariant — a delta, not a total
    expect(gl.calls.f1).toEqual([['EN', 1.0], ['EN', 1.0]]);
    expect(gl.calls.f2.length).toBe(4);
    expect(rect.locationActive).toBe(true);
  });

  it('membership: the managed set is NAMED, not counted', () => {
    const asked = [];
    const gl = {
      calls: { f1: [], f2: [], queries: 0 },
      getUniformLocation: (_p, name) => { asked.push(name); return name in LOCS ? LOCS[name] : null; },
      uniform1f: () => {}, uniform2f: () => {},
    };
    setOverlayTruthUniforms(gl, {}, resolveOverlayTruthUv(STORAGE, TRUTH, {}));
    expect(asked.sort()).toEqual(['u_overlayTruthEnabled', 'u_overlayTruth_max', 'u_overlayTruth_min']);
  });

  it('enabled:false writes ONLY the flag=0 — stale rects can never act', () => {
    const gl = mockGl(LOCS); const prog = {};
    setOverlayTruthUniforms(gl, prog, resolveOverlayTruthUv(STORAGE, null, {}));
    expect(gl.calls.f1).toEqual([['EN', 0.0]]);
    expect(gl.calls.f2).toEqual([]);
  });

  it('a program without the uniforms (old shader) is silently safe and REPORTED inactive', () => {
    const gl = mockGl({}); const prog = {};
    const rect = resolveOverlayTruthUv(STORAGE, TRUTH, {});
    expect(setOverlayTruthUniforms(gl, prog, rect)).toBe(false);
    expect(gl.calls.f1).toEqual([]);
    expect(gl.calls.f2).toEqual([]);
    expect(rect.locationActive).toBe(false);
  });
});

import { resolveCoverageTerminalState, setHeatmapGateUniforms } from './marineCoverageContract';
import { resolveDeliveredCoverage } from './WebGLMarineEngine';

// A3.1-02 — the missing SAFE TERMINAL ACTION after the one-repaint budget is exhausted.
//
// The RED this suite closes (measured before the fix, 2026-08-15): with the second delivery still
// short, the engine had no action — the pipeline's own tests proved `deliveredShort:true,
// forceRepaint:false` and rendering proceeded normally from a known-invalid coverage state; the
// runtime pixel harness (scripts/shaderlab-gate.js S2) showed the halo strip painting with the
// u_dataMaskGate defense ON, unchanged gate-on vs gate-off (0 of 262,144 px). These tests pin the
// terminal contract; the harness's S2c scenario pins the pixel consequence.

const VIEW = { west: -81.443, south: 27.318, east: -79.057, north: 29.471 };
const SHORT = { west: -81.5501, south: 26.9252, east: -79.1873, north: 29.5986 };
const COVERS = { west: -82, south: 26, east: -78, north: 30 };
const KEY = 'g1';
const W = {}; // explicit empty win — never the real window

describe('resolveCoverageTerminalState — the coverage state machine has a safe terminal state', () => {
  it('covering delivery -> COVERED, render, no clip', () => {
    const dv = resolveDeliveredCoverage(COVERS, VIEW, KEY, null, false);
    expect(resolveCoverageTerminalState(dv, W)).toMatchObject({ state: 'covered', action: 'render', maskClip: false });
  });

  it('first short delivery -> RETRY (repaint in flight), no clip yet', () => {
    const dv = resolveDeliveredCoverage(SHORT, VIEW, KEY, null, false);
    expect(dv.forceRepaint).toBe(true);
    expect(resolveCoverageTerminalState(dv, W)).toMatchObject({ state: 'retry', action: 'retry', maskClip: false });
  });

  it('short -> retry -> covered: the repaint healed it, back to COVERED', () => {
    const first = resolveDeliveredCoverage(SHORT, VIEW, KEY, null, false);
    const healed = resolveDeliveredCoverage(COVERS, VIEW, KEY, first.forceKey, false);
    expect(resolveCoverageTerminalState(healed, W)).toMatchObject({ state: 'covered', maskClip: false });
  });

  // THE CASE THE AUDIT NAMED: two consecutive short deliveries must end SAFELY, never
  // "known short, render normally".
  it('short -> retry -> STILL SHORT: SAFE_DEGRADED with the clip action engaged', () => {
    const first = resolveDeliveredCoverage(SHORT, VIEW, KEY, null, false);
    const second = resolveDeliveredCoverage(SHORT, VIEW, KEY, first.forceKey, false);
    expect(second.deliveredShort).toBe(true);
    expect(second.forceRepaint).toBe(false);
    const term = resolveCoverageTerminalState(second, W);
    expect(term).toMatchObject({ state: 'safe_degraded', action: 'clip', maskClip: true, reason: 'retry_exhausted' });
  });

  it('a CHANGED view re-arms: the terminal state returns to RETRY, not clip', () => {
    const first = resolveDeliveredCoverage(SHORT, VIEW, KEY, null, false);
    const moved = { ...VIEW, west: VIEW.west - 0.5, east: VIEW.east - 0.5 };
    const dv = resolveDeliveredCoverage(SHORT, moved, KEY, first.forceKey, false);
    expect(resolveCoverageTerminalState(dv, W)).toMatchObject({ state: 'retry', maskClip: false });
  });

  it('a CHANGED grid re-arms identically', () => {
    const first = resolveDeliveredCoverage(SHORT, VIEW, KEY, null, false);
    const dv = resolveDeliveredCoverage(SHORT, VIEW, 'g2', first.forceKey, false);
    expect(resolveCoverageTerminalState(dv, W)).toMatchObject({ state: 'retry', maskClip: false });
  });

  it('UNKNOWN verdict fails open: no clip on missing information', () => {
    expect(resolveCoverageTerminalState(null, W)).toMatchObject({ state: 'unknown', maskClip: false });
    expect(resolveCoverageTerminalState(undefined, W)).toMatchObject({ state: 'unknown', maskClip: false });
    expect(resolveCoverageTerminalState({}, W)).toMatchObject({ state: 'unknown', maskClip: false });
  });

  it('the kill switch restores "known short, render normally" — honestly labeled', () => {
    const first = resolveDeliveredCoverage(SHORT, VIEW, KEY, null, false);
    const second = resolveDeliveredCoverage(SHORT, VIEW, KEY, first.forceKey, false);
    const term = resolveCoverageTerminalState(second, { __RAW_DISABLE_MASK_SHORT_CLIP__: true });
    expect(term).toMatchObject({ state: 'safe_degraded', action: 'render', maskClip: false, reason: 'clip_killed' });
  });

  // NEGATIVE CONTROL — flipping ONLY the retry-budget input flips the clip, nothing else.
  it('flipping ONLY forceRepaint flips maskClip', () => {
    const a = resolveCoverageTerminalState({ deliveredShort: true, forceRepaint: false }, W);
    const b = resolveCoverageTerminalState({ deliveredShort: true, forceRepaint: true }, W);
    expect(a.maskClip).toBe(true);
    expect(b.maskClip).toBe(false);
  });
});

// A3.1-03 — the setter can never again silently write to a null location without telemetry.
function mockGl(locations) {
  const calls = [];
  return {
    calls,
    getUniformLocation: (prog, name) => (name in locations ? locations[name] : null),
    uniform1f: (loc, v) => calls.push([loc, v]),
  };
}

describe('setHeatmapGateUniforms — cached locations, null-location safety, telemetry', () => {
  const SHORT_TERM = { deliveredShort: true, forceRepaint: false };

  it('caches locations on the program and reports location-activity', () => {
    const gl = mockGl({ u_dataMaskGate: 'GATE', u_maskClipEnabled: 'CLIP' });
    const prog = {};
    const w = { __RAW_GPU__: {} };
    const term = setHeatmapGateUniforms(gl, prog, 'resident', SHORT_TERM, true, w);
    expect(term.maskClip).toBe(true);
    expect(prog.__gateLoc).toBe('GATE');
    expect(prog.__clipLoc).toBe('CLIP');
    expect(gl.calls).toContainEqual(['GATE', 1.0]);
    expect(gl.calls).toContainEqual(['CLIP', 1.0]);
    expect(w.__RAW_GPU__.heatmapGate.resident).toMatchObject({
      gateLocationActive: true, clipLocationActive: true, gateValue: 1, clipValue: 1, terminal: 'safe_degraded',
    });
  });

  it('a NULL location is never written and is REPORTED, not hidden (the Khronos silent-ignore trap)', () => {
    const gl = mockGl({ u_dataMaskGate: 'GATE' }); // clip uniform absent from the linked program
    const prog = {};
    const w = { __RAW_GPU__: {} };
    setHeatmapGateUniforms(gl, prog, 'resident', SHORT_TERM, true, w);
    expect(gl.calls.some(([loc]) => loc === null)).toBe(false);
    expect(w.__RAW_GPU__.heatmapGate.resident.clipLocationActive).toBe(false);
  });

  it('the coarse pass NEVER clips (world bounds; its own mask) and says why', () => {
    const gl = mockGl({ u_dataMaskGate: 'GATE', u_maskClipEnabled: 'CLIP' });
    const w = { __RAW_GPU__: {} };
    const term = setHeatmapGateUniforms(gl, {}, 'coarse', SHORT_TERM, true, w);
    expect(term.maskClip).toBe(false);
    expect(gl.calls).toContainEqual(['CLIP', 0.0]);
    expect(w.__RAW_GPU__.heatmapGate.coarse.terminal).toBe('coarse_pass');
  });

  it('a resident pass whose bound mask is NOT the cached mask never clips', () => {
    const gl = mockGl({ u_dataMaskGate: 'GATE', u_maskClipEnabled: 'CLIP' });
    const term = setHeatmapGateUniforms(gl, {}, 'resident', SHORT_TERM, false, { __RAW_GPU__: {} });
    expect(term.maskClip).toBe(false);
    expect(term.state).toBe('mask_not_cached');
  });

  it('the legacy gate kill switch still reaches the shader through the cached location', () => {
    const gl = mockGl({ u_dataMaskGate: 'GATE', u_maskClipEnabled: 'CLIP' });
    setHeatmapGateUniforms(gl, {}, 'resident', null, true, { __RAW_DISABLE_HEATMAP_BOUNDS_GATE__: true, __RAW_GPU__: {} });
    expect(gl.calls).toContainEqual(['GATE', 0.0]);
  });

  it('second call reuses the cached location (getUniformLocation not re-queried)', () => {
    let queries = 0;
    const gl = {
      calls: [],
      getUniformLocation: () => { queries++; return 'L'; },
      uniform1f: () => {},
    };
    const prog = {};
    setHeatmapGateUniforms(gl, prog, 'resident', null, true, {});
    setHeatmapGateUniforms(gl, prog, 'resident', null, true, {});
    expect(queries).toBe(2); // one per uniform, first call only
  });
});

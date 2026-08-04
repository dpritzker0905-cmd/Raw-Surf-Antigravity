/**
 * THE DEDUP KEY THAT COULD NOT DEDUP (2026-08-03).
 *
 * `populateCrestDiagnostics` runs from inside the per-frame render loop
 * (WebGLMarineEngine.js:2143). Its expensive half — an O(N) loop over every vector plus a telemetry
 * emit — is guarded by `engine._lastUploadedSig !== uploadSig`. That key fell back to `Date.now()`
 * when `productId` and both timestamps were absent, so it differed on EVERY FRAME and the guard
 * always passed.
 *
 * MEASURED LIVE on the owner's reproduction (GFS/waves/h129, productId: null): the 500-entry
 * telemetry ring held 500 `texture_generated` events, all the identical payload
 * `143v / 99nz / max 1.8901 / h129`, 18 consecutive samples 31.4 ms apart during interaction.
 * The ring is capped, so this one event evicted every other telemetry event within ~17 s.
 *
 * These tests drive the REAL function against a grid with no productId and no timestamps — the
 * exact live shape — and assert the number of telemetry emits, not the colour of a pass.
 */
import { populateCrestDiagnostics } from './WebGLMarineEngineDiagnostics';

function mkGrid(over = {}) {
  const cols = 11, rows = 13;
  const vectors = Array.from({ length: cols * rows }, (_, i) => ({ speed: 1 + (i % 3) * 0.1 }));
  return {
    cols, rows, vectors,
    hourOffset: 129,
    __sourceModel: 'GFS',
    __componentLayer: 'waves',
    productId: null,            // the live shape: no product id…
    // …and deliberately NO `timestamp` / `grid.timestamp` either.
    bounds: [-83, 25.5, -79, 30.75],
    ...over,
  };
}

function mkEngine(grid) {
  return {
    _waveData: { waveGrid: grid },
    _minPointSize: 1, _maxPointSize: 64,
    _crestCount: 0, _gridCols: grid.cols, _gridRows: grid.rows,
  };
}

const GL = {};                       // the telemetry block reads no GL state
const BOUNDS = [-83, 25.5, -79, 30.75];

let emits;
beforeEach(() => {
  emits = [];
  delete window.__RAW_DISABLE_CREST_DIAG_DEDUP__;
  window.__WEATHER_TELEMETRY__ = {
    trackTextureGeneration: (...a) => emits.push(a),
  };
});

test('an unchanged grid emits telemetry ONCE across many frames, not once per frame', () => {
  const grid = mkGrid();
  const engine = mkEngine(grid);

  for (let frame = 0; frame < 60; frame++) {
    try { populateCrestDiagnostics(engine, GL, BOUNDS, 8.3); } catch (e) { /* GL-side parts may no-op */ }
  }

  // THE NUMBER THAT RAN, not the colour. Before the fix this was 60.
  expect(emits.length).toBe(1);
});

test('SETUP CONTROL: the fixture really is the live shape that broke it', () => {
  const g = mkGrid();
  expect(g.productId).toBeNull();
  expect(g.timestamp).toBeUndefined();
  expect(g.grid).toBeUndefined();
});

test('a genuinely NEW grid still emits — the guard must not become a mute', () => {
  const engine = mkEngine(mkGrid());
  try { populateCrestDiagnostics(engine, GL, BOUNDS, 8.3); } catch (e) { /* the harness has no real GL context, so the render path may throw; only the EMIT COUNT is under test */ }
  expect(emits.length).toBe(1);

  // hour advanced: different content, must re-emit
  engine._waveData.waveGrid = mkGrid({ hourOffset: 132 });
  try { populateCrestDiagnostics(engine, GL, BOUNDS, 8.3); } catch (e) { /* the harness has no real GL context, so the render path may throw; only the EMIT COUNT is under test */ }
  expect(emits.length).toBe(2);

  // different vector count at the same hour: must re-emit
  const g3 = mkGrid({ hourOffset: 132 });
  g3.vectors = g3.vectors.slice(0, 100);
  engine._waveData.waveGrid = g3;
  try { populateCrestDiagnostics(engine, GL, BOUNDS, 8.3); } catch (e) { /* the harness has no real GL context, so the render path may throw; only the EMIT COUNT is under test */ }
  expect(emits.length).toBe(3);

  // different layer: must re-emit
  engine._waveData.waveGrid = mkGrid({ __componentLayer: 'swell_1' });
  try { populateCrestDiagnostics(engine, GL, BOUNDS, 8.3); } catch (e) { /* the harness has no real GL context, so the render path may throw; only the EMIT COUNT is under test */ }
  expect(emits.length).toBe(4);
});

test('the key carries no clock — two calls a second apart on identical data still dedup', () => {
  const engine = mkEngine(mkGrid());
  const realNow = Date.now;
  try {
    let t = 1_000_000;
    Date.now = () => (t += 1000);        // force the clock to move between calls
    try { populateCrestDiagnostics(engine, GL, BOUNDS, 8.3); } catch (e) { /* the harness has no real GL context, so the render path may throw; only the EMIT COUNT is under test */ }
    try { populateCrestDiagnostics(engine, GL, BOUNDS, 8.3); } catch (e) { /* the harness has no real GL context, so the render path may throw; only the EMIT COUNT is under test */ }
  } finally {
    Date.now = realNow;                  // restore in a finally — a harness must not leak state
  }
  expect(emits.length).toBe(1);
});

test('the kill switch restores the old always-emit behaviour', () => {
  window.__RAW_DISABLE_CREST_DIAG_DEDUP__ = true;
  const engine = mkEngine(mkGrid());
  for (let i = 0; i < 5; i++) {
    try { populateCrestDiagnostics(engine, GL, BOUNDS, 8.3); } catch (e) { /* the harness has no real GL context, so the render path may throw; only the EMIT COUNT is under test */ }
  }
  expect(emits.length).toBe(5);
});

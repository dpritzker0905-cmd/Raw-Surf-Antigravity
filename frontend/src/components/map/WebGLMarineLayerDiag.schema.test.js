/**
 * SCHEMA PARITY: the default diag object must declare exactly what the live write provides.
 *
 * `updateWebGLMarineLayerDiag` REPLACES `window.__WebGLMarineLayer_DIAG__` wholesale — it does not
 * merge. So a key present in the module-load default but absent from the write reads as `0`/`null`
 * before the first write and `undefined` forever after, while the real value sits under a different
 * name. Measured 2026-08-11 against production build `23743f63`: a harness polling `.vectorCount`
 * read 0 for 60 s while the grid served 15,023 vectors — the written names are
 * `backendGridVectorCount` / `webglSourceVectorCount`, and `.vectorCount` was declared but never
 * written. Eleven such phantom keys existed.
 *
 * ★ This is `516a7200`'s orphaned read in schema form. That one was a NAME nothing wrote; this was
 *   a whole FIELD SET nothing wrote. A grep for the global finds both write sites and still misses
 *   it — the mismatch is between two object literals, not in any single one.
 *
 * These tests fail if either side drifts, in either direction.
 */

describe('__WebGLMarineLayer_DIAG__ schema parity', () => {
  let defaultKeys;
  let updateWebGLMarineLayerDiag;

  beforeEach(() => {
    jest.resetModules();
    delete window.__WebGLMarineLayer_DIAG__;
    delete window.__WEBGL_MARINE_UPLOAD_DIAG__;
    delete window.__MARINE_POINT_DIAG__;
    delete window.__WEBGL_MARINE_UPLOAD_REASON__;
    // Importing the module installs the module-load default.
    const mod = require('./WebGLMarineLayerDiag');
    updateWebGLMarineLayerDiag = mod.updateWebGLMarineLayerDiag;
    defaultKeys = Object.keys(window.__WebGLMarineLayer_DIAG__).sort();
  });

  const drive = () => {
    updateWebGLMarineLayerDiag(
      { particleRes: 296, _waveData: {} },
      'GFS',
      ['waves'],
      0,
      { gridProvider: 'open-meteo', vectorsLength: 15023, uploadSig: 'sig-abc', componentLayer: 'waves' }
    );
    return window.__WebGLMarineLayer_DIAG__;
  };

  it('the module-load default declares at least one key (it exists at all)', () => {
    expect(defaultKeys.length).toBeGreaterThan(5);
  });

  it('REGRESSION: every DEFAULT key is also written by the live write', () => {
    const written = Object.keys(drive()).sort();
    const phantom = defaultKeys.filter((k) => !written.includes(k));
    // A phantom key reads 0/null then undefined forever, while the real value lives elsewhere.
    expect(phantom).toEqual([]);
  });

  it('REGRESSION: every WRITTEN key is also declared in the default', () => {
    const written = Object.keys(drive()).sort();
    const undeclared = written.filter((k) => !defaultKeys.includes(k));
    // The reverse drift: a field that only appears after the first write, so anyone inspecting the
    // object before then concludes it does not exist.
    expect(undeclared).toEqual([]);
  });

  it('REGRESSION: no declared key is undefined after a real write', () => {
    const diag = drive();
    const undef = defaultKeys.filter((k) => diag[k] === undefined);
    expect(undef).toEqual([]);
  });

  it('the specific field that burned the frame harness is gone, not resurrected as a phantom', () => {
    const diag = drive();
    // Either absent from BOTH sides, or present in both. What must never recur is "declared,
    // never written" — which is what `vectorCount` was.
    const declaredNotWritten = ['vectorCount', 'nonzeroCount', 'uploadCount', 'productId', 'provider']
      .filter((k) => defaultKeys.includes(k) && diag[k] === undefined);
    expect(declaredNotWritten).toEqual([]);
  });

  it('the counts a consumer actually reads are populated (readHeatmapCounts contract)', () => {
    const diag = drive();
    // forecastDiagnostics.readHeatmapCounts reads exactly these two, in this order.
    expect(diag.webglSourceVectorCount ?? diag.backendGridVectorCount).toBe(15023);
  });

  it('the uninitialised discriminator still works in both states', () => {
    // forecastDiagnostics.isDiagUninitialised: !d || status === 'not_initialized' || timestamp == null
    const before = window.__WebGLMarineLayer_DIAG__;
    expect(before.status === 'not_initialized' || before.timestamp == null).toBe(true);
    const after = drive();
    expect(after.status === 'not_initialized' || after.timestamp == null).toBe(false);
  });
});

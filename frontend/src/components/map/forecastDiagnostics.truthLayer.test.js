/**
 * forecastDiagnostics.truthLayer.test.js
 *
 * Regression lock for certification audit 11.2, Phase 0 (RC-02).
 *
 * These tests encode ONE rule: **an unsampled comparison must never be reported as a pass.**
 *
 * Both defects they guard were live at `e015d90b` and were measured against the PRODUCTION
 * backend, not a fixture:
 *
 *   1. `__MARINE_SOURCE_PARITY__.match` was `mismatches.length === 0`. Every comparison is
 *      guarded on both sides being populated, so when nothing was comparable the result was
 *      `match: true` — a pass manufactured out of absence. Observed live with
 *      `heatmap.vectorCount: 0`, `infobox.status: 'idle'` and `productId: null`, i.e. during a
 *      total data-load failure, while the HUD reported "No Causal Layer Violations Detected".
 *
 *   2. The heatmap side read `webglDiag.renderedVectorCount` / `.renderedNonzeroCount`. Nothing
 *      has written either name since the producer was renamed around `dcfce3c1` (2026-06-03):
 *      repo-wide they appeared 4 times, ALL reads, ZERO writes. So the count was pinned at 0 for
 *      ~10 weeks while real fields of up to 15,023 vectors were on screen — which is what made
 *      defect 1 fire permanently instead of occasionally.
 *
 * `PARITY_HEATMAP_COUNT_KEY` below is the anti-re-orphaning guard: if someone renames the
 * producer's key again, the last test fails loudly instead of silently returning 0 forever.
 */

import { writeOverlayDiagnostics } from './forecastDiagnostics';

const PARITY_HEATMAP_COUNT_KEY = 'webglSourceVectorCount';

function baseParams(overrides = {}) {
  return {
    lat: 28.32, lng: -80.55,
    activeModel: 'GFS', activeLayer: 'waves', timeOffsetHours: 0,
    exactPoint: null, marineGridSample: null, marineData: null,
    exactPointStatus: 'idle',
    // writeOverlayDiagnostics takes its formatters by injection; supply real ones so the
    // parity block under test runs against the genuine code path, not a stubbed shell.
    mToFt: (m) => (typeof m === 'number' ? m * 3.28084 : null),
    degToCompass: (d) => (typeof d === 'number' ? 'NE' : null),
    ...overrides,
  };
}

// A diag as the REAL writer publishes it: object replaced wholesale, no `status`, real timestamp.
// The timestamp matters — it is how a written diag is told apart from the module-load defaults.
function setHeatmapDiag({ provider = 'open-meteo', vectors = 629, nonzero = 398, layer = 'waves', model = 'GFS' } = {}) {
  window.__WebGLMarineLayer_DIAG__ = {
    activeModel: model,
    activeMarineLayer: layer,
    componentLayer: layer,
    renderedProvider: provider,
    [PARITY_HEATMAP_COUNT_KEY]: vectors,
    backendGridVectorCount: vectors,
    timestamp: '2026-08-11T04:00:00.000Z',
  };
  window.__WEBGL_MARINE_UPLOAD_DIAG__ = { nonzeroCount: nonzero, timestamp: '2026-08-11T04:00:00.000Z' };
}

// The DEFAULTS object exactly as WebGLMarineLayerDiag.js:11-38 publishes it at module load.
function setHeatmapDiagUninitialised() {
  window.__WebGLMarineLayer_DIAG__ = {
    status: 'not_initialized',
    activeModel: null, activeMarineLayer: null, renderedProvider: null, componentLayer: null,
    backendGridVectorCount: 0, webglSourceVectorCount: 0, particleCount: 0, renderedParticleCount: 0,
    waveDataPresent: false, vectorCount: 0, nonzeroCount: 0, uploadCount: 0,
    infoboxHeatmapParity: false, timestamp: null,
  };
  window.__WEBGL_MARINE_UPLOAD_DIAG__ = { status: 'not_initialized', nonzeroCount: 0, timestamp: null };
}

beforeEach(() => {
  delete window.__WebGLMarineLayer_DIAG__;
  delete window.__WEBGL_MARINE_UPLOAD_DIAG__;
  delete window.__MARINE_SOURCE_PARITY__;
  delete window.__MARINE_ENGINE__;
});

describe('source parity refuses instead of passing', () => {
  test('REGRESSION: an idle, never-sampled infobox is UNSAMPLED — not a match', () => {
    // This is the exact production state: field rendered, infobox never sampled.
    setHeatmapDiag();
    writeOverlayDiagnostics(baseParams({ exactPointStatus: 'idle' }));

    const parity = window.__MARINE_SOURCE_PARITY__;
    expect(parity.status).toBe('UNSAMPLED');
    // The pre-fix behaviour was `match: true` here. That is the whole defect.
    expect(parity.match).toBe(false);
    expect(parity.unsampledReasons).toEqual(expect.arrayContaining([expect.stringMatching(/infobox/)]));
  });

  test('REGRESSION: an empty heatmap is UNSAMPLED — not a match', () => {
    setHeatmapDiag({ vectors: 0, nonzero: 0 });
    writeOverlayDiagnostics(baseParams({
      exactPoint: { provider: 'open-meteo', time: '2026-08-11T03:00:00Z' },
      exactPointStatus: 'valid',
    }));

    const parity = window.__MARINE_SOURCE_PARITY__;
    expect(parity.status).toBe('UNSAMPLED');
    expect(parity.match).toBe(false);
    expect(parity.unsampledReasons).toEqual(expect.arrayContaining([expect.stringMatching(/heatmap/)]));
  });

  test('both sides sampled and agreeing is a real MATCH', () => {
    setHeatmapDiag({ provider: 'open-meteo' });
    writeOverlayDiagnostics(baseParams({
      exactPoint: { provider: 'open-meteo', time: '2026-08-11T03:00:00Z' },
      exactPointStatus: 'valid',
    }));

    const parity = window.__MARINE_SOURCE_PARITY__;
    expect(parity.status).toBe('MATCH');
    expect(parity.match).toBe(true);
    expect(parity.unsampledReasons).toBeNull();
    expect(parity.mismatchReasons).toBeNull();
  });

  test('SCOPING: with NO point selected the infobox side is NOT_APPLICABLE, not a refusal', () => {
    // The resting state. `useExactPointFetch.js:122` sets status 'idle' when !pointLat || !pointLng,
    // so an always-on amber warning here would carry as little information as an always-on pass.
    setHeatmapDiag();                                   // heatmap healthy
    writeOverlayDiagnostics(baseParams({ lat: null, lng: null, exactPointStatus: 'idle' }));

    const parity = window.__MARINE_SOURCE_PARITY__;
    expect(parity.status).toBe('NOT_APPLICABLE');
    expect(parity.match).toBe(false);                   // must never be dressed up as a pass
    expect(parity.unsampledReasons).toBeNull();
  });

  test('SCOPING: heatmap-side absence still refuses even with NO point selected', () => {
    // The heatmap side is always checkable — scoping the infobox must not mute this.
    setHeatmapDiag({ vectors: 0, nonzero: 0 });
    writeOverlayDiagnostics(baseParams({ lat: null, lng: null, exactPointStatus: 'idle' }));

    const parity = window.__MARINE_SOURCE_PARITY__;
    expect(parity.status).toBe('UNSAMPLED');
    expect(parity.unsampledReasons).toEqual(expect.arrayContaining([expect.stringMatching(/heatmap/)]));
    expect(parity.unsampledReasons.join(' ')).not.toMatch(/infobox/);
  });

  test('a genuine provider disagreement is a MISMATCH, and outranks unsampled', () => {
    setHeatmapDiag({ provider: 'gfs_estimated_fallback' });
    writeOverlayDiagnostics(baseParams({
      exactPoint: { provider: 'copernicus', time: '2026-08-11T03:00:00Z' },
      exactPointStatus: 'valid',
    }));

    const parity = window.__MARINE_SOURCE_PARITY__;
    expect(parity.status).toBe('MISMATCH');
    expect(parity.match).toBe(false);
    expect(parity.mismatchReasons.join(' ')).toMatch(/provider/);
  });
});

describe('the heatmap vector count is read from a key that is actually written', () => {
  test('REGRESSION: parity reports the real rendered vector count, not 0', () => {
    setHeatmapDiag({ vectors: 15023, nonzero: 9001 });
    writeOverlayDiagnostics(baseParams({
      exactPoint: { provider: 'open-meteo', time: '2026-08-11T03:00:00Z' },
      exactPointStatus: 'valid',
    }));

    // Pre-fix this was 0 for every field ever rendered, because the key read was never written.
    expect(window.__MARINE_SOURCE_PARITY__.heatmap.vectorCount).toBe(15023);
    expect(window.__MARINE_SOURCE_PARITY__.heatmap.nonzeroActiveLayer).toBe(9001);
  });

  test('REGRESSION: the module-load DEFAULTS object must read as UNREADABLE, not as a real zero', () => {
    // WebGLMarineLayerDiag.js:11-38 publishes webglSourceVectorCount:0 with status:'not_initialized'
    // and timestamp:null BEFORE the first real write. Observed live: parity said "zero vectors
    // rendered" while 629 vectors were visibly painted. A default must never impersonate a
    // measurement — otherwise a legitimate future zero is indistinguishable from "never ran".
    setHeatmapDiagUninitialised();
    writeOverlayDiagnostics(baseParams({
      exactPoint: { provider: 'open-meteo', time: '2026-08-11T03:00:00Z' },
      exactPointStatus: 'valid',
    }));

    const parity = window.__MARINE_SOURCE_PARITY__;
    expect(parity.heatmap.vectorCount).toBeNull();          // NOT 0
    expect(parity.status).toBe('UNSAMPLED');
    expect(parity.match).toBe(false);
    expect(parity.unsampledReasons.join(' ')).toMatch(/unreadable/);
    expect(parity.unsampledReasons.join(' ')).not.toMatch(/zero vectors/);
  });

  test('a real writer reporting a genuine zero is still distinguishable from uninitialised', () => {
    setHeatmapDiag({ vectors: 0, nonzero: 0 });             // written, timestamped, genuinely zero
    writeOverlayDiagnostics(baseParams({
      exactPoint: { provider: 'open-meteo', time: '2026-08-11T03:00:00Z' },
      exactPointStatus: 'valid',
    }));

    const parity = window.__MARINE_SOURCE_PARITY__;
    expect(parity.heatmap.vectorCount).toBe(0);             // a measured zero, not null
    expect(parity.unsampledReasons.join(' ')).toMatch(/zero vectors/);
  });

  test('ANTI-ORPHAN: reading a key the producer does not publish must NOT look like zero', () => {
    // Simulate the exact 2026-06-03 rename: producer publishes some OTHER name.
    window.__WebGLMarineLayer_DIAG__ = {
      activeModel: 'GFS', activeMarineLayer: 'waves', componentLayer: 'waves',
      renderedProvider: 'open-meteo',
      someRenamedCountKey: 629,     // <- the count exists, under a name we do not read
      timestamp: '2026-08-11T04:00:00.000Z',  // WRITTEN — so this fails for ORPHANING, not staleness
    };
    window.__WEBGL_MARINE_UPLOAD_DIAG__ = { nonzeroCount: 398, timestamp: '2026-08-11T04:00:00.000Z' };
    writeOverlayDiagnostics(baseParams({
      exactPoint: { provider: 'open-meteo', time: '2026-08-11T03:00:00Z' },
      exactPointStatus: 'valid',
    }));

    const parity = window.__MARINE_SOURCE_PARITY__;
    // null means "unreadable", NOT 0 — and it must degrade to a refusal, never to a pass.
    expect(parity.heatmap.vectorCount).toBeNull();
    expect(parity.status).toBe('UNSAMPLED');
    expect(parity.match).toBe(false);
  });
});

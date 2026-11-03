/**
 * Kill-switch coverage: marineSeriesFrame.js
 *
 * Switches tested:
 *   __RAW_DISABLE_SERIES_MINT_STAGE__           (line 126) — gates recordTruthStage call for
 *                                                GFS/waves/h0 frame mints
 *   __RAW_DISABLE_SERIES_ESTIMATE_PROVENANCE__  (line 46)  — strips estimateBasis / isEstimated
 *                                                from the returned marineData object
 *
 * NULL CONTROLS: every "switch OFF" assertion has a companion "switch ON" assertion that would
 * pass trivially if the switch were entirely absent. Passing both is the only proof the switch
 * has real effect.
 *
 * Why spyOn instead of jest.mock factory: both approaches hoist before imports, but with
 * Babel's CJS transform named imports compile to live property accesses on the required module
 * object (_wtt.recordTruthStage(...)). jest.spyOn replaces those properties on the SAME
 * cached module object that marineSeriesFrame.js holds, so the spy intercepts every call.
 * A factory-based jest.mock creates a FRESH exports object; any binding captured by value
 * at module evaluation time would point to the original factory mock, not the spy.
 * Transitive deps of weatherTruthTracker (buildVersion, verifiedCycleTime) are mocked so the
 * real module loads cleanly without build-time or ledger side effects.
 */
jest.mock('../../buildVersion', () => ({ BUILD_VERSION: 'test-build-v0' }));
jest.mock('./verifiedCycleTime', () => ({ verifiedCycleTime: jest.fn(() => null) }));

import { frameToMarineData } from './marineSeriesFrame';
import * as weatherTruthTrackerMod from './weatherTruthTracker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal renderable GFS/waves frame at hour_offset 0 (the gated path). */
function gfsWavesH0(overrides = {}) {
  return {
    hour_offset: 0,
    vectors: [0.1, 0.2, 0.3],   // non-empty → renderable === true
    cols: 1,
    rows: 1,
    bounds: { west: -80, south: 25, east: -79, north: 26 },
    valid_time: '2026-11-01T00:00:00Z',
    run_time: '2026-11-01T00:00:00Z',
    model_run_time: '2026-11-01T00:00:00Z',
    model_run_time_status: 'exact',
    ingested_at: '2026-11-01T01:00:00Z',
    product_id: 'test_product_h0',
    is_estimated: false,
    estimate_basis: null,
    rating_mode: false,
    decimated_stride: 0,
    ...overrides,
  };
}

// Shared spy implementation: returns a truthy tag so the if (truthTag) branch fires.
const mockBuildTruthTag = (opts) => ({
  _mockTag: true,
  timeOffsetHours: null,
  product_id: opts?.product_id,
  model: opts?.model,
});

// ---------------------------------------------------------------------------
// __RAW_DISABLE_SERIES_MINT_STAGE__
// ---------------------------------------------------------------------------

describe('__RAW_DISABLE_SERIES_MINT_STAGE__', () => {
  beforeEach(() => {
    jest.spyOn(weatherTruthTrackerMod, 'buildTruthTag').mockImplementation(mockBuildTruthTag);
    jest.spyOn(weatherTruthTrackerMod, 'recordTruthStage').mockImplementation(() => {});
    delete window.__RAW_DISABLE_SERIES_MINT_STAGE__;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete window.__RAW_DISABLE_SERIES_MINT_STAGE__;
  });

  it('NULL CONTROL — recordTruthStage IS called for GFS/waves/h0 when switch is absent', () => {
    frameToMarineData(gfsWavesH0(), 'GFS', 'waves');
    expect(weatherTruthTrackerMod.recordTruthStage).toHaveBeenCalledTimes(1);
    expect(weatherTruthTrackerMod.recordTruthStage.mock.calls[0][0]).toBe('seriesFrameMint');
    expect(weatherTruthTrackerMod.recordTruthStage.mock.calls[0][2]).toBe('marineGridSeries.js');
  });

  it('recordTruthStage NOT called when __RAW_DISABLE_SERIES_MINT_STAGE__ === true', () => {
    window.__RAW_DISABLE_SERIES_MINT_STAGE__ = true;
    frameToMarineData(gfsWavesH0(), 'GFS', 'waves');
    expect(weatherTruthTrackerMod.recordTruthStage).not.toHaveBeenCalled();
  });

  it('falsy values do NOT activate the kill (switch uses plain ! operator, not === true)', () => {
    for (const v of [undefined, null, 0, '', false]) {
      // clearAllMocks resets call counts but preserves spy implementations.
      jest.clearAllMocks();
      window.__RAW_DISABLE_SERIES_MINT_STAGE__ = v;
      frameToMarineData(gfsWavesH0(), 'GFS', 'waves');
      expect(weatherTruthTrackerMod.recordTruthStage).toHaveBeenCalledTimes(1);
    }
  });

  it('switch only gates GFS/waves/h0 — other combinations never call recordTruthStage', () => {
    // EURO waves h0
    frameToMarineData(gfsWavesH0(), 'EURO', 'waves');
    expect(weatherTruthTrackerMod.recordTruthStage).not.toHaveBeenCalled();
    // GFS wind h0
    frameToMarineData(gfsWavesH0(), 'GFS', 'wind');
    expect(weatherTruthTrackerMod.recordTruthStage).not.toHaveBeenCalled();
    // GFS waves h3 (hour_offset !== 0)
    frameToMarineData(gfsWavesH0({ hour_offset: 3, product_id: 'test_product_h3' }), 'GFS', 'waves');
    expect(weatherTruthTrackerMod.recordTruthStage).not.toHaveBeenCalled();
    // non-renderable GFS/waves/h0 (empty vectors)
    frameToMarineData(gfsWavesH0({ vectors: [] }), 'GFS', 'waves');
    expect(weatherTruthTrackerMod.recordTruthStage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// __RAW_DISABLE_SERIES_ESTIMATE_PROVENANCE__
// ---------------------------------------------------------------------------

describe('__RAW_DISABLE_SERIES_ESTIMATE_PROVENANCE__', () => {
  beforeEach(() => {
    jest.spyOn(weatherTruthTrackerMod, 'buildTruthTag').mockImplementation(mockBuildTruthTag);
    jest.spyOn(weatherTruthTrackerMod, 'recordTruthStage').mockImplementation(() => {});
    delete window.__RAW_DISABLE_SERIES_ESTIMATE_PROVENANCE__;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete window.__RAW_DISABLE_SERIES_ESTIMATE_PROVENANCE__;
  });

  const estimatedFrame = () => gfsWavesH0({
    is_estimated: true,
    estimate_basis: { blend_weights: [0.6, 0.4], models: ['GFS', 'EURO'] },
  });

  it('NULL CONTROL — isEstimated and estimateBasis present when switch is absent', () => {
    const result = frameToMarineData(estimatedFrame(), 'GFS', 'waves');
    expect(result.isEstimated).toBe(true);
    expect(result.estimateBasis).toEqual({ blend_weights: [0.6, 0.4], models: ['GFS', 'EURO'] });
  });

  it('isEstimated and estimateBasis absent when __RAW_DISABLE_SERIES_ESTIMATE_PROVENANCE__ === true', () => {
    window.__RAW_DISABLE_SERIES_ESTIMATE_PROVENANCE__ = true;
    const result = frameToMarineData(estimatedFrame(), 'GFS', 'waves');
    expect(result.isEstimated).toBeUndefined();
    expect(result.estimateBasis).toBeUndefined();
  });

  it('estimate_basis on the nested grid object is also stripped', () => {
    window.__RAW_DISABLE_SERIES_ESTIMATE_PROVENANCE__ = true;
    const result = frameToMarineData(estimatedFrame(), 'GFS', 'waves');
    expect(result.grid.estimate_basis).toBeUndefined();
  });

  it('strict-true semantics: non-true values do NOT strip provenance', () => {
    for (const v of [undefined, false, null, 0, 'true']) {
      window.__RAW_DISABLE_SERIES_ESTIMATE_PROVENANCE__ = v;
      const result = frameToMarineData(estimatedFrame(), 'GFS', 'waves');
      expect(result.isEstimated).toBe(true);
    }
  });
});

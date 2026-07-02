/**
 * Regression tests for the scrub-settle COMMIT STAMPING — the root of the regional_too_small
 * clamp (2026-07-01): a covering series frame was committed (found:true, covers:true,
 * willSharpen:true) but never became the engine's resident grid (engineGw stayed 3.0), because
 *   (1) series frames carry no __commitRevision, so MapWebGL's revision prop stayed 0 across
 *       series→series commits and WebGLMarineLayer's revision-keyed upload effect (it has NO
 *       `data` dependency) never fired; and
 *   (2) re-drives re-committed the SAME cached object, which React's setState bails out on.
 * The fix commits a shallow CLONE stamped from the SHARED marineRevision sequence
 * (stampSeriesCommit). Also covers the engine-empty (zoom-out clear) recovery branch.
 */
import { runScrubSettleCheck, stampSeriesCommit } from './useMarineScrubSettle';
import { getMarineSeriesFrame, ensureMarineSeries } from './marineGridSeries';

jest.mock('./marineGridSeries', () => ({
  getMarineSeriesFrame: jest.fn(),
  ensureMarineSeries: jest.fn(),
}));

const mkFrame = ({ west, south, east, north, hour = 0 }) => ({
  grid: {
    vectors: [{ lat: south, lng: west, speed: 1.2, u: 1, v: 0 }],
    cols: 17, rows: 13,
    bounds: { west, south, east, north },
    hourOffset: hour,
    __renderable: true,
  },
  hourOffset: hour,
  __renderable: true,
  product_id: `series_GFS_waves_h${hour}`,
});

const mkMap = ({ zoom, west, south, east, north }) => ({
  getZoom: () => zoom,
  getBounds: () => ({
    getWest: () => west, getSouth: () => south, getEast: () => east, getNorth: () => north,
  }),
});

const mkCtx = (over = {}) => ({
  marineData: null,
  mapInstance: null,
  setMarineData: jest.fn(),
  timeOffsetRef: { current: 0 },
  activeModelRef: { current: 'GFS' },
  activeMarineLayerRef: { current: 'waves' },
  safetyNetRetryRef: { current: { key: '', count: 0 } },
  clampRefetchRef: { current: { key: '', count: 0 } },
  marineFetchLocksRef: { current: { isFetching: false, lastHash: null } },
  updateMarineGridRef: { current: jest.fn() },
  marineRevision: { current: 0 },
  lastCommittedSigRef: { current: 'SIG_pre_sharpen_product' },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  delete window.__MARINE_ENGINE__;
  delete window.__MARINE_FETCH_PENDING__;
  delete window.__MARINE_SHARPEN_DIAG__;
  delete window.__MARINE_GRIDMISMATCH_COUNT__;
  delete window.__MARINE_ENGINE_EMPTY_RECOVER__;
  window.isScrubbingTimeline = false;
});

describe('stampSeriesCommit (pure)', () => {
  it('returns a NEW object sharing the grid by reference, stamped from the shared revision', () => {
    const frame = mkFrame({ west: -83, south: 27, east: -79, north: 30.5 });
    const rev = { current: 41 };
    const out = stampSeriesCommit(frame, rev);
    expect(out).not.toBe(frame);
    expect(out.grid).toBe(frame.grid);
    expect(out.__commitRevision).toBe(42);
    expect(rev.current).toBe(42);
    // The cached frame itself is NOT mutated — a later stamp of the same frame gets a fresh clone.
    expect(frame.__commitRevision).toBeUndefined();
  });

  it('stamps strictly-increasing revisions and distinct identities for the SAME cached frame', () => {
    const frame = mkFrame({ west: -83, south: 27, east: -79, north: 30.5 });
    const rev = { current: 0 };
    const a = stampSeriesCommit(frame, rev);
    const b = stampSeriesCommit(frame, rev);
    expect(a).not.toBe(b);
    expect(b.__commitRevision).toBeGreaterThan(a.__commitRevision);
  });

  it('works without a marineRevision ref (fallback sequence still increases)', () => {
    const frame = mkFrame({ west: -83, south: 27, east: -79, north: 30.5 });
    const a = stampSeriesCommit(frame);
    const b = stampSeriesCommit(frame);
    expect(typeof a.__commitRevision).toBe('number');
    expect(b.__commitRevision).toBeGreaterThan(a.__commitRevision);
  });
});

describe('runScrubSettleCheck — clamp sharpen commits a stamped clone (the §2a fix)', () => {
  // The live repro: engine holds a 3°-wide Cocoa tile; viewport at z7.67 is ~3.7° wide → clamp.
  // The series has a covering 4° frame. Before the fix the commit was the raw cached object
  // (revision 0→0, then React bailouts) so the engine never updated.
  const setup = () => {
    window.__MARINE_ENGINE__ = {
      _waveData: { waveGrid: { bounds: { west: -82, south: 27, east: -79, north: 30 }, cols: 13, rows: 13 } },
    };
    const mapInstance = mkMap({ zoom: 7.67, west: -82.75, south: 27.56, east: -79.02, north: 29.23 });
    const covering = mkFrame({ west: -83, south: 27, east: -79, north: 30.5 });
    getMarineSeriesFrame.mockReturnValue(covering);
    return { mapInstance, covering };
  };

  it('commits a stamped CLONE of the covering frame, never the raw cached object', () => {
    const { mapInstance, covering } = setup();
    const setMarineData = jest.fn();
    const marineRevision = { current: 7 };
    const lastCommittedSigRef = { current: 'SIG_pre_sharpen_product' };
    runScrubSettleCheck(mkCtx({ mapInstance, setMarineData, marineRevision, lastCommittedSigRef }));

    expect(setMarineData).toHaveBeenCalledTimes(1);
    const committed = setMarineData.mock.calls[0][0];
    expect(committed).not.toBe(covering);          // fresh identity → no setState bailout
    expect(committed.grid).toBe(covering.grid);    // grid shared (no vector copy)
    expect(committed.__commitRevision).toBe(8);    // shared monotonic sequence → upload effect fires
    expect(window.__MARINE_SHARPEN_DIAG__.willSharpen).toBe(true);
    // The duplicate-commit ledger now records the SHARPENED product — so the next fetch that
    // returns the PRE-sharpen product (e.g. the cached coarse-global) is no longer sig-equal and
    // commits normally (live-reproduced wedge: zoom-out re-fetch was duplicate_commit_skipped).
    expect(lastCommittedSigRef.current).not.toBe('SIG_pre_sharpen_product');
    expect(typeof lastCommittedSigRef.current).toBe('string');
  });

  it('re-drives commit DISTINCT objects with increasing revisions (recovery can always retry)', () => {
    const { mapInstance } = setup();
    const setMarineData = jest.fn();
    const marineRevision = { current: 0 };
    const ctx = mkCtx({ mapInstance, setMarineData, marineRevision });
    runScrubSettleCheck(ctx);
    runScrubSettleCheck(ctx);

    expect(setMarineData).toHaveBeenCalledTimes(2);
    const [first] = setMarineData.mock.calls[0];
    const [second] = setMarineData.mock.calls[1];
    expect(first).not.toBe(second);
    expect(second.__commitRevision).toBeGreaterThan(first.__commitRevision);
  });
});

describe('runScrubSettleCheck — engine-empty recovery (the §2b zoom-out clear fix)', () => {
  // Zoom-out: the display gate rejects the resident regional and the layer clears the engine,
  // but marineData still holds the regional frame — previously NO branch could recover.
  const staleRegional = () => mkFrame({ west: -82, south: 27, east: -79, north: 30 });
  const wideMap = () => mkMap({ zoom: 4.2, west: -100, south: 10, east: -60, north: 45 });

  it('commits a covering warmed series frame (stamped) when the engine is empty', () => {
    window.__MARINE_ENGINE__ = { _waveData: null };
    const globalFrame = mkFrame({ west: -180, south: -85, east: 180, north: 85 });
    getMarineSeriesFrame.mockReturnValue(globalFrame);
    const setMarineData = jest.fn();
    const marineRevision = { current: 3 };
    runScrubSettleCheck(mkCtx({
      mapInstance: wideMap(), setMarineData, marineRevision, marineData: staleRegional(),
    }));

    expect(setMarineData).toHaveBeenCalledTimes(1);
    const committed = setMarineData.mock.calls[0][0];
    expect(committed).not.toBe(globalFrame);
    expect(committed.grid).toBe(globalFrame.grid);
    expect(committed.__commitRevision).toBe(4);
    expect(window.__MARINE_ENGINE_EMPTY_RECOVER__).toBe(1);
    // Gate-compatible selection: at a zoomed-out viewport the display gate rejects ALL regional-width
    // grids, so the recovery must request the GLOBAL series (not the smallest containing regional).
    expect(getMarineSeriesFrame).toHaveBeenCalledWith('GFS', 'waves', { west: -180, south: -85, east: 180, north: 85 }, 0);
  });

  it('loads the series (currentPageOnly) instead of committing when nothing covering is warmed', () => {
    window.__MARINE_ENGINE__ = { _waveData: null };
    getMarineSeriesFrame.mockReturnValue(null);
    const setMarineData = jest.fn();
    runScrubSettleCheck(mkCtx({ mapInstance: wideMap(), setMarineData, marineData: staleRegional() }));

    expect(setMarineData).not.toHaveBeenCalled();
    expect(ensureMarineSeries).toHaveBeenCalledTimes(1);
    const args = ensureMarineSeries.mock.calls[0];
    expect(args[0]).toBe('GFS');
    expect(args[1]).toBe('waves');
    expect(args[2]).toEqual({ west: -180, south: -85, east: 180, north: 85 }); // global warm at a zoomed-out viewport
    expect(args[3]).toBe(0);            // current hour
    expect(args[5]).toBe(true);         // currentPageOnly — no adjacent-page fan-out for a backstop
  });

  it('does NOT fire while a fetch is pending (the pending commit will restore the engine)', () => {
    window.__MARINE_ENGINE__ = { _waveData: null };
    window.__MARINE_FETCH_PENDING__ = { model: 'GFS', layer: 'waves', hour: 0 };
    const globalFrame = mkFrame({ west: -180, south: -85, east: 180, north: 85 });
    getMarineSeriesFrame.mockReturnValue(globalFrame);
    const setMarineData = jest.fn();
    runScrubSettleCheck(mkCtx({ mapInstance: wideMap(), setMarineData, marineData: staleRegional() }));

    expect(setMarineData).not.toHaveBeenCalled();
    expect(ensureMarineSeries).not.toHaveBeenCalled();
  });

  it('does NOT fire when the engine is resident (normal render path untouched)', () => {
    window.__MARINE_ENGINE__ = {
      _waveData: { waveGrid: { bounds: { west: -180, south: -85, east: 180, north: 85 }, cols: 37, rows: 17 } },
    };
    const setMarineData = jest.fn();
    runScrubSettleCheck(mkCtx({ mapInstance: wideMap(), setMarineData, marineData: staleRegional() }));
    expect(setMarineData).not.toHaveBeenCalled();
  });
});

/**
 * A thinned world frame must not replace an EXACT one of the same valid time (2026-10-01).
 *
 * Found by an offline A/B of the erratic zoom (5 seeds of 25 s at Wed 15Z, same mock backend, same seeds): the unfixed client
 * committed the thin series frame (46 x 21, an 8-degree lattice, swell 1.34 m against 2.33 m) 17 times, and the first build of
 * the exact-frame upgrade only followed each of them, then fought the settle check, which kept putting the thin frame back.
 * The cause is the hour LABEL: at 3-hourly far range the selected hour sits between two frames, so the exact /grid result
 * (labelled with the hour that was selected when it was fetched) and the series frame (labelled with the page's own hour) are the
 * same data under different labels, and `rendered label != selected hour` reads as "stale".
 */
import { exactResidentSupersedes, keepExactResident, _resetExactUpgradeForTest } from './marineExactUpgrade';
import { runScrubSettleCheck } from './useMarineScrubSettle';
import { getMarineSeriesFrame } from './marineGridSeries';

jest.mock('./marineGridSeries', () => ({
  getMarineSeriesFrame: jest.fn(),
  ensureMarineSeries: jest.fn(),
}));

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const T15 = '2026-10-07T15:00:00Z';
const vec = [{ lat: 0, lng: 0, speed: 1, u: 0, v: 1 }];
const exactGrid = (over = {}) => ({ vectors: vec, cols: 181, rows: 82, bounds: WORLD, hourOffset: 144, __renderable: true, __decimatedStride: 0, valid_time: T15, ...over });
const thinGrid = (over = {}) => ({ vectors: vec, cols: 46, rows: 21, bounds: WORLD, hourOffset: 145, __renderable: true, __decimatedStride: 4, valid_time: T15, ...over });
const wrap = (g, over = {}) => ({ grid: g, hourOffset: g.hourOffset, ...over });

describe('exactResidentSupersedes (pure)', () => {
  it('is true for an exact world resident and a thin frame of the same valid time, whatever their hour labels (the live case)', () => {
    expect(exactResidentSupersedes(wrap(exactGrid({ hourOffset: 144 })), wrap(thinGrid({ hourOffset: 145 })))).toBe(true);
    expect(exactResidentSupersedes(wrap(exactGrid({ hourOffset: 147 })), wrap(thinGrid({ hourOffset: 146 })))).toBe(true);
  });
  it('reads the SERVED time first: an exact frame the backend substituted from another hour does not supersede the right-hour thin frame', () => {
    const substituted = exactGrid({ served_valid_time: '2026-10-07T12:00:00Z' });
    expect(exactResidentSupersedes(wrap(substituted), wrap(thinGrid()))).toBe(false);
    expect(exactResidentSupersedes(wrap(exactGrid()), wrap(thinGrid({ served_valid_time: '2026-10-07T15:00:00Z' })))).toBe(true);
  });
  it.each([
    ['a different valid time (the user moved to another hour)', exactGrid({ valid_time: '2026-10-07T12:00:00Z' }), thinGrid()],
    ['a thin resident (nothing exact to protect)', exactGrid({ __decimatedStride: 4, cols: 46, rows: 21 }), thinGrid()],
    ['a coarser world tier than the thin frame (the 10 degree lattice is no better)', exactGrid({ cols: 37, rows: 17 }), thinGrid()],
    ['a regional resident', exactGrid({ bounds: { west: -82, south: 26, east: -79, north: 29 } }), thinGrid()],
    ['an empty resident', exactGrid({ vectors: [] }), thinGrid()],
    ['an unrenderable resident', exactGrid({ __renderable: false }), thinGrid()],
    ['a resident with no valid time', exactGrid({ valid_time: undefined }), thinGrid()],
    ['a candidate with no valid time', exactGrid(), thinGrid({ valid_time: undefined })],
    ['an unparseable valid time', exactGrid({ valid_time: 'soon' }), thinGrid()],
    ['a surf-rating flavor change (a rated frame over an unrated resident is the arbiter\'s flavor upgrade)', exactGrid({ ratingMode: false }), thinGrid({ ratingMode: true })],
    ['a surf-rating flavor change the other way (the rated exact frame is not replaced by an unrated one either)', exactGrid({ ratingMode: true }), thinGrid({ ratingMode: false })],
  ])('is false for %s', (_l, resident, frame) => {
    expect(exactResidentSupersedes(wrap(resident), wrap(frame))).toBe(false);
  });
  it('keeps a rated exact frame against a rated thin one (the same flavor)', () => {
    expect(exactResidentSupersedes(wrap(exactGrid({ ratingMode: true })), wrap(thinGrid({ ratingMode: true })))).toBe(true);
  });
  it('is false when the candidate is not a thinned world frame (ordinary rules apply to an exact or regional frame)', () => {
    expect(exactResidentSupersedes(wrap(exactGrid()), wrap(exactGrid({ hourOffset: 145 })))).toBe(false);
    expect(exactResidentSupersedes(wrap(exactGrid()), wrap(thinGrid({ bounds: { west: -82, south: 26, east: -79, north: 29 } })))).toBe(false);
  });
  it('lets a NEWER model run replace an exact frame of an older run, and keeps an exact frame of the same run', () => {
    expect(exactResidentSupersedes(wrap(exactGrid({ run_time: '2026-10-01T06:00:00Z' })), wrap(thinGrid({ run_time: '2026-10-01T12:00:00Z' })))).toBe(false);
    expect(exactResidentSupersedes(wrap(exactGrid({ run_time: '2026-10-01T06:00:00Z' })), wrap(thinGrid({ run_time: '2026-10-01T06:00:00Z' })))).toBe(true);
    expect(exactResidentSupersedes(wrap(exactGrid()), wrap(thinGrid({ run_time: '2026-10-01T06:00:00Z' })))).toBe(true);      // one side names no run: same data time decides
  });
  it('compares model runs as instants, not as strings (the /grid and series paths may spell one run differently)', () => {
    expect(exactResidentSupersedes(wrap(exactGrid({ run_time: '2026-10-01T06:00:00Z' })), wrap(thinGrid({ run_time: '2026-10-01T06:00:00+00:00' })))).toBe(true);
    expect(exactResidentSupersedes(wrap(exactGrid({ run_time: '2026-10-01T06:00:00Z' })), wrap(thinGrid({ run_time: '2026-10-01T02:00:00-04:00' })))).toBe(true);
    expect(exactResidentSupersedes(wrap(exactGrid({ run_time: 'run-A' })), wrap(thinGrid({ run_time: 'run-A' })))).toBe(true);     // unparseable but identical
    expect(exactResidentSupersedes(wrap(exactGrid({ run_time: 'run-A' })), wrap(thinGrid({ run_time: 'run-B' })))).toBe(false);
  });
  it('reads the time from the wrapper as well as the grid, and never throws on junk', () => {
    expect(exactResidentSupersedes(wrap(exactGrid({ valid_time: undefined }), { valid_time: T15 }), wrap(thinGrid({ valid_time: undefined }), { valid_time: T15 }))).toBe(true);
    expect(exactResidentSupersedes(null, null)).toBe(false);
    expect(exactResidentSupersedes({}, {})).toBe(false);
    expect(exactResidentSupersedes(wrap(exactGrid()), undefined)).toBe(false);
  });
});

describe('keepExactResident (the settle check call)', () => {
  beforeEach(() => { _resetExactUpgradeForTest(); delete window.__RAW_DISABLE_EXACT_UPGRADE__; });
  it('counts the kept frames in the telemetry record', () => {
    expect(keepExactResident(wrap(exactGrid()), wrap(thinGrid()))).toBe(true);
    expect(keepExactResident(wrap(exactGrid()), wrap(thinGrid()))).toBe(true);
    expect(window.__MARINE_EXACT_UPGRADE__.kept).toBe(2);
  });
  it('is false, and silent, when the frame would not be a downgrade', () => {
    expect(keepExactResident(wrap(exactGrid({ valid_time: '2026-10-07T12:00:00Z' })), wrap(thinGrid()))).toBe(false);
    expect(window.__MARINE_EXACT_UPGRADE__).toBeUndefined();
  });
  it('honours the kill switch: the old behaviour (the thin frame goes in) comes back whole', () => {
    window.__RAW_DISABLE_EXACT_UPGRADE__ = true;
    expect(keepExactResident(wrap(exactGrid()), wrap(thinGrid()))).toBe(false);
  });
});

describe('runScrubSettleCheck keeps an exact world frame (the call site)', () => {
  const mkMap = () => ({
    getZoom: () => 3.6,
    getBounds: () => ({ getWest: () => -160, getEast: () => 0, getSouth: () => -7, getNorth: () => 63 }),
  });
  const mkCtx = (resident) => ({
    marineData: resident, mapInstance: mkMap(), setMarineData: jest.fn(),
    timeOffsetRef: { current: 146 }, activeModelRef: { current: 'GFS' }, activeMarineLayerRef: { current: 'waves' },
    safetyNetRetryRef: { current: { key: '', count: 0 } }, clampRefetchRef: { current: { key: '', count: 0 } },
    marineFetchLocksRef: { current: { isFetching: false, lastHash: 'abc' } }, updateMarineGridRef: { current: jest.fn() },
    marineRevision: { current: 0 }, lastCommittedSigRef: { current: 'SIG' },
  });
  beforeEach(() => {
    jest.clearAllMocks();
    _resetExactUpgradeForTest();
    delete window.__MARINE_ENGINE__;
    delete window.__MARINE_FETCH_PENDING__;
    delete window.__RAW_DISABLE_EXACT_UPGRADE__;
    window.isScrubbingTimeline = false;
  });

  it('does not put the thin series frame over an exact frame of the same valid time, and fetches nothing (the label mismatch is not a stale frame)', () => {
    getMarineSeriesFrame.mockReturnValue(wrap(thinGrid({ hourOffset: 145 })));
    const ctx = mkCtx(wrap(exactGrid({ hourOffset: 144 })));            // selected 146: the exact frame's label is 144, its data 15Z
    runScrubSettleCheck(ctx);
    expect(getMarineSeriesFrame).toHaveBeenCalled();                    // the branch ran...
    expect(ctx.setMarineData).not.toHaveBeenCalled();                   // ...and kept what is drawn
    expect(ctx.updateMarineGridRef.current).not.toHaveBeenCalled();     // with no refetch either
    expect(window.__MARINE_EXACT_UPGRADE__.kept).toBe(1);
  });

  it('still commits the thin frame when the user moved to another hour (different valid time), then the upgrade owns the sharpening', () => {
    getMarineSeriesFrame.mockReturnValue(wrap(thinGrid({ hourOffset: 149, valid_time: '2026-10-07T18:00:00Z' })));
    const ctx = mkCtx(wrap(exactGrid({ hourOffset: 144 })));
    ctx.timeOffsetRef.current = 149;
    runScrubSettleCheck(ctx);
    expect(ctx.setMarineData).toHaveBeenCalledTimes(1);
  });

  it('still commits the thin frame over a regional or empty resident (nothing exact to keep: the placeholder is right, the upgrade follows)', () => {
    getMarineSeriesFrame.mockReturnValue(wrap(thinGrid({ hourOffset: 145 })));
    const regional = wrap(exactGrid({ bounds: { west: -82, south: 26, east: -79, north: 29 }, cols: 21, rows: 17, hourOffset: 144 }));
    const ctx = mkCtx(regional);
    runScrubSettleCheck(ctx);
    expect(ctx.setMarineData).toHaveBeenCalledTimes(1);
    expect(window.__MARINE_EXACT_UPGRADE__).toBeUndefined();            // nothing was "kept"
  });

  it('with the kill switch on, behaves as before (the thin frame replaces the exact one)', () => {
    window.__RAW_DISABLE_EXACT_UPGRADE__ = true;
    getMarineSeriesFrame.mockReturnValue(wrap(thinGrid({ hourOffset: 145 })));
    const ctx = mkCtx(wrap(exactGrid({ hourOffset: 144 })));
    runScrubSettleCheck(ctx);
    expect(ctx.setMarineData).toHaveBeenCalledTimes(1);
  });
});

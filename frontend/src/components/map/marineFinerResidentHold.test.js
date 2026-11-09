/**
 * Pan, pan, clamp_resharpen racing (the owner's "bounces / clamps / clears" capture): offline, no backend. The REAL commitMarineData
 * reducer and the REAL detectClamp / runScrubSettleCheck run against a mock state holder.
 * Kill-switch tests: __RAW_DISABLE_FINER_RESIDENT_HOLD__ and __RAW_DISABLE_LANE_SWITCH_REGIONAL_FIRST__.
 */
import { commitMarineData } from './useMarineDataFetcherHelpers';
import { shouldHoldFinerResident } from './marineFinerResidentHold';
import { pickLaneSwitchRegionalFrame } from './marineLaneSwitchFrame';
import { detectClamp } from './useMarineScrubSettle';

const VEC = [{ lat: 28, lng: -80, speed: 1.2, u: 0.1, v: 0.1, direction: 0, period: 9 }];
const RUN = '2026-11-08T00:00:00Z';
const VALID = '2026-11-08T12:00:00Z';
const VIEW = { west: -80.9, south: 27.5, east: -78.9, north: 29.5 };       // 2 x 2 deg, z9-ish
const FINE_B = { west: -82.0, south: 26.0, east: -76.75, north: 32.25 };   // 0.25 deg tile, 21 x 25, contains VIEW
const MID_B = { west: -86, south: 22, east: -72, north: 36 };              // 14 deg clip, 2 deg cells, contains VIEW
const FAR_VIEW = { west: -79.0, south: 31.0, east: -77.0, north: 33.0 };   // a pan off the fine tile

const mk = (cols, rows, bounds, extra = {}) => ({
  type: 'FeatureCollection', features: [], hourOffset: 12, run_time: RUN,
  grid: { vectors: VEC, cols, rows, bounds, hourOffset: 12, validTime: VALID, run_time: RUN, renderable: true, __renderable: true,
    __sourceModel: 'ICON', __componentLayer: 'wind_waves', ...extra },
});
const fine = () => mk(21, 25, FINE_B);
const mid = (b = MID_B) => mk(7, 7, b);

function harness(initial) {
  let state = initial;
  const setMarineData = (fn) => { state = typeof fn === 'function' ? fn(state) : fn; };
  const history = [];
  const commit = (data, bounds, source) => {
    commitMarineData({
      data, bounds, model: 'ICON', layer: 'wind_waves', timeOffset: 12, timeOffsetRef: { current: 12 }, setMarineData,
      lastCommittedSigRef: { current: null }, marineRevision: { current: 0 }, getViewportHash: () => 'h', logPipelineEventHelper: () => {},
      consecutiveFailuresRef: { current: 0 }, isCommittingDataRef: { current: false }, isInternalMapUpdateRef: { current: false },
      internalUpdateTimerRef: { current: null }, locks: {}, source, scheduleSWRRevalidation: () => {}, updateMarineGrid: () => {},
      getBackendCopernicusFlag: () => false, getBackendIconMarineFlag: () => true, getBackendWeatherFlag: () => true,
      _marineDataSignature: (d) => `${d.grid.cols}x${d.grid.rows}:${d.grid.bounds.west}`, getSharedValidTime: () => null,
      updateDeprecationDiag: () => {}, setTimeoutFunc: () => 0, clearTimeoutFunc: () => {},
    });
    history.push(state && state.grid ? `${state.grid.cols}x${state.grid.rows}` : 'EMPTY');
  };
  return { commit, history, get state() { return state; } };
}
const mapOf = (v) => ({ getZoom: () => 9, getBounds: () => ({ getWest: () => v.west, getEast: () => v.east, getSouth: () => v.south, getNorth: () => v.north }) });

beforeEach(() => {
  delete window.__RAW_DISABLE_FINER_RESIDENT_HOLD__;
  delete window.__RAW_DISABLE_LANE_SWITCH_REGIONAL_FIRST__;
  delete window.__MARINE_FINER_HELD__;
  delete window.__MARINE_ENGINE__;
  window.isScrubbingTimeline = false;
});
afterEach(() => { delete window.__MARINE_ENGINE__; });

describe('pan, pan, clamp_resharpen racing: the drawn frame is never empty and never coarser while the finer one covers', () => {
  test('pan fetches answered with the 2 deg clip never replace the covering 0.25 deg tile, so no clamp is ever detected', () => {
    const h = harness(fine());
    for (let pan = 0; pan < 4; pan++) {
      h.commit(mid(), VIEW, `moveend_${pan}`);
      window.__MARINE_ENGINE__ = { _waveData: { waveGrid: h.state.grid } };
      expect(detectClamp(mapOf(VIEW)).clamp).toBe(false);   // nothing for clamp_resharpen to chase
    }
    expect(h.history).toEqual(['21x25', '21x25', '21x25', '21x25']);
    expect(window.__MARINE_FINER_HELD__.count).toBe(4);
  });

  test('without the hold (kill switch) the same pans bounce: coarse commit -> regional_too_coarse -> resharpen -> fine', () => {
    window.__RAW_DISABLE_FINER_RESIDENT_HOLD__ = true;
    const h = harness(fine());
    h.commit(mid(), VIEW, 'moveend');
    window.__MARINE_ENGINE__ = { _waveData: { waveGrid: h.state.grid } };
    expect(h.state.grid.cols).toBe(7);
    expect(detectClamp(mapOf(VIEW))).toMatchObject({ clamp: true, kind: 'regional_too_coarse' });
    h.commit(fine(), VIEW, 'clamp_resharpen');
    expect(h.history).toEqual(['7x7', '21x25']);
  });

  test('a pan OFF the fine tile still commits the covering coarse clip (never blank), and the finer resharpen replaces it', () => {
    const h = harness(fine());
    h.commit(mid({ west: -86, south: 26, east: -72, north: 40 }), FAR_VIEW, 'moveend');
    expect(h.state.grid.cols).toBe(7);                         // the resident covers none of FAR_VIEW: coarse is the fallback
    h.commit(mk(21, 25, { west: -80, south: 30, east: -74.75, north: 36.25 }), FAR_VIEW, 'clamp_resharpen');
    expect(h.state.grid.cols).toBe(21);
    h.history.forEach((d) => expect(d).not.toBe('EMPTY'));
  });

  test('a same-cell clip of the same frame (post-pan clip <-> clip ping-pong) is held while the resident covers the view', () => {
    const h = harness(mid());
    const other = mk(7, 7, { west: -85.5, south: 22.5, east: -71.5, north: 36.5 });
    h.commit(other, VIEW, 'moveend');
    h.commit(mid(), VIEW, 'moveend');
    expect(h.history).toEqual(['7x7', '7x7']);
    expect(h.state.grid.bounds).toEqual(MID_B);               // never swapped
  });

  test('a fresher run, another hour, another flavour or another model commits even when coarser', () => {
    const prev = fine();
    const inc = (extra, top = {}) => ({ ...mid(), ...top, grid: { ...mid().grid, ...extra } });
    const hold = (incoming) => shouldHoldFinerResident({ prev, incoming, viewport: VIEW });
    expect(hold(inc({}))).toBeTruthy();
    expect(hold(inc({ run_time: '2026-11-08T06:00:00Z' }, { run_time: '2026-11-08T06:00:00Z' }))).toBe(false);
    expect(hold(inc({ hourOffset: 15 }, { hourOffset: 15 }))).toBe(false);
    expect(hold(inc({ ratingMode: true }))).toBe(false);
    expect(hold(inc({ __sourceModel: 'GFS' }))).toBe(false);
    // a world incoming is held at a regional viewport since 2026-11-08 (marineWorldOverRegionalHold.test.js); its own kill restores "engine guards only"
    expect(shouldHoldFinerResident({ prev, incoming: inc({ bounds: { west: -180, south: -80, east: 180, north: 85 }, cols: 181, rows: 83 }), viewport: VIEW, disabledWorld: true })).toBe(false);
    expect(shouldHoldFinerResident({ prev: { ...prev, stale: true }, incoming: mid(), viewport: VIEW })).toBe(false);
    expect(shouldHoldFinerResident({ prev, incoming: mk(41, 49, FINE_B), viewport: VIEW })).toBe(false);                 // finer always commits
  });

  test('an unlabelled frame (no run or valid time on either side) is never held', () => {
    const strip = (d) => ({ ...d, run_time: undefined, grid: { ...d.grid, run_time: undefined, validTime: undefined } });
    expect(shouldHoldFinerResident({ prev: strip(fine()), incoming: strip(mid()), viewport: VIEW })).toBe(false);
  });
});

describe('lane switch: the cached regional window is offered before the 2 deg world frame', () => {
  const resident = mk(21, 25, FINE_B, { __componentLayer: 'swell_1' });   // another lane's frame is resident
  const regional = mk(21, 25, FINE_B);
  const args = (over = {}) => ({ resident, viewport: VIEW, model: 'ICON', layer: 'wind_waves', hour: 12, wantSurf: false,
    getFrame: () => regional, ...over });

  test('returns the covering regional frame of the target lane', () => {
    expect(pickLaneSwitchRegionalFrame(args())).toBe(regional);
  });
  test('nothing when the lane did not change, the frame is a world frame, does not cover, or the view is wide', () => {
    expect(pickLaneSwitchRegionalFrame(args({ resident: regional }))).toBeNull();
    expect(pickLaneSwitchRegionalFrame(args({ getFrame: () => mk(181, 83, { west: -180, south: -80, east: 180, north: 85 }) }))).toBeNull();
    expect(pickLaneSwitchRegionalFrame(args({ viewport: FAR_VIEW }))).toBeNull();
    expect(pickLaneSwitchRegionalFrame(args({ viewport: { west: -100, south: 10, east: -60, north: 45 } }))).toBeNull();
    expect(pickLaneSwitchRegionalFrame(args({ wantSurf: true }))).toBeNull();
  });
  test('kill switch: __RAW_DISABLE_LANE_SWITCH_REGIONAL_FIRST__ semantics (the caller passes disabled)', () => {
    expect(pickLaneSwitchRegionalFrame(args({ disabled: true }))).toBeNull();
  });
});

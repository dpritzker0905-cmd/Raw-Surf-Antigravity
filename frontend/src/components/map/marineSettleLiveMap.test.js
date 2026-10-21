/**
 * SETTLE_LIVE_MAP and SETTLE_ARM_ON_ACTIVATE (marineSettleLiveMap.js, 2026-10-21).
 *
 * The settle check was memoised on marineData alone, so until a layer's first marine commit it read the map of the render before
 * the map existed (null): its SERIES-FIRST lookup threw inside its try and it started a /grid fetch instead of committing the
 * series frame that had landed. And its listeners were not attached when a layer switched on after the map existed.
 * Each kill switch is the control arm of the test that pins its part.
 */
import { renderHook, act } from '@testing-library/react';
import { useMarineScrubSettle } from './useMarineScrubSettle';
import { getMarineSeriesFrame } from './marineGridSeries';
import { settleMapFor, settleArmKey, runSettleCheckLive } from './marineSettleLiveMap';

jest.mock('./marineGridSeries', () => ({
  getMarineSeriesFrame: jest.fn(),
  ensureMarineSeries: jest.fn(),
}));
jest.mock('./marineWorldWarmOnSettle', () => ({ useMarineWorldWarmOnSettle: () => {} }));

const mkMap = () => ({
  getZoom: () => 3.5,
  getBounds: () => ({ getWest: () => -120, getEast: () => -40, getSouth: () => 5, getNorth: () => 45 }),
  on: jest.fn(), off: jest.fn(),
});
const seriesFrame = () => ({
  grid: { vectors: [{ lat: 0, lng: 0, speed: 1, u: 0, v: 1 }], cols: 91, rows: 42, hourOffset: 0,
    bounds: { west: -180, south: -80, east: 180, north: 85 } },
  hourOffset: 0, __fromSeries: true,
});

function mount({ layerOn }) {
  const setMarineData = jest.fn();
  const updateMarineGridRef = { current: jest.fn() };
  const activeMarineLayersRef = { current: layerOn };
  const base = {
    marineData: null, setMarineData,
    timeOffsetRef: { current: 0 }, activeModelRef: { current: 'GFS' }, activeMarineLayerRef: { current: 'waves' },
    activeMarineLayersRef, marineFetchLocksRef: { current: { isFetching: false, lastHash: 'h' } }, updateMarineGridRef,
    marineRevision: { current: 0 }, lastCommittedSigRef: { current: null },
  };
  const hook = renderHook((p) => useMarineScrubSettle({ ...base, ...p }), { initialProps: { mapInstance: null } });
  return { hook, setMarineData, updateMarineGridRef, activeMarineLayersRef };
}

// A series page landing fires this event (marineGridSeries); the settle effect re-runs the check 60 ms later.
function seriesLands() {
  act(() => { window.dispatchEvent(new Event('marine_series_revalidated')); });
  act(() => { jest.advanceTimersByTime(100); });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  getMarineSeriesFrame.mockImplementation(() => seriesFrame());
  delete window.__MARINE_ENGINE__;
  delete window.__MARINE_FETCH_PENDING__;
  delete window.__MARINE_SETTLE_CHECK__;
  delete window.__RAW_DISABLE_SETTLE_LIVE_MAP__;
  delete window.__RAW_DISABLE_SETTLE_ARM_ON_ACTIVATE__;
  window.isScrubbingTimeline = false;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  console.log.mockRestore();
});

describe('SETTLE_LIVE_MAP: the check reads the map of the current render', () => {
  it('commits the landed series frame when the map arrived after mount and nothing has committed yet', () => {
    const m = mount({ layerOn: true });
    m.hook.rerender({ mapInstance: mkMap() });          // the map exists now; marineData is still null (no commit)
    seriesLands();
    expect(m.setMarineData).toHaveBeenCalledTimes(1);
    expect(m.setMarineData.mock.calls[0][0].__commitLane).toBe('series_settle');
    expect(m.updateMarineGridRef.current).not.toHaveBeenCalled();
    expect(window.__MARINE_SETTLE_CHECK__.counts['live|commit:series_settle']).toBe(1);
  });

  it('kill switch: the memoised null map again, so the lookup throws and the check starts a /grid fetch instead', () => {
    window.__RAW_DISABLE_SETTLE_LIVE_MAP__ = true;
    const m = mount({ layerOn: true });
    m.hook.rerender({ mapInstance: mkMap() });
    seriesLands();
    expect(m.setMarineData).not.toHaveBeenCalled();
    expect(m.updateMarineGridRef.current).toHaveBeenCalledWith('timeline_scrub');
    expect(window.__MARINE_SETTLE_CHECK__.counts['none|fetch:timeline_scrub']).toBe(1);
  });

  it('after a commit the memoised map is the live one (trace "same"), so nothing changes past the first load', () => {
    const map = mkMap();
    const m = mount({ layerOn: true });
    m.hook.rerender({ mapInstance: map });
    m.hook.rerender({ mapInstance: map, marineData: { grid: { vectors: [], hourOffset: 0 }, hourOffset: 0 } });
    seriesLands();
    const keys = Object.keys(window.__MARINE_SETTLE_CHECK__.counts);
    expect(keys.every((k) => k.startsWith('same|'))).toBe(true);
  });
});

describe('SETTLE_ARM_ON_ACTIVATE: switching a marine layer on arms the listeners before the first commit', () => {
  // The SAME map object in both renders: a new object would re-run the effect by itself and hide the activation bug.
  it('a series landing after the layer switched on runs the check', () => {
    const m = mount({ layerOn: false });
    const map = mkMap();
    m.hook.rerender({ mapInstance: map });               // map first, layer off: the effect returns early
    m.activeMarineLayersRef.current = true;              // the orchestrator syncs the ref in render, then this hook renders
    m.hook.rerender({ mapInstance: map });
    seriesLands();
    expect(m.setMarineData).toHaveBeenCalledTimes(1);
    expect(m.setMarineData.mock.calls[0][0].__commitLane).toBe('series_settle');
  });

  it.each([
    ['its own kill', '__RAW_DISABLE_SETTLE_ARM_ON_ACTIVATE__'],
    // Armed listeners with the memoised null map only re-drive the check into more /grid fetches, so the map kill disarms too.
    ['the live-map kill', '__RAW_DISABLE_SETTLE_LIVE_MAP__'],
  ])('%s: the effect ignores activation again, so no listener runs the check until the first commit', (_, kill) => {
    window[kill] = true;
    const m = mount({ layerOn: false });
    const map = mkMap();
    m.hook.rerender({ mapInstance: map });
    m.activeMarineLayersRef.current = true;
    m.hook.rerender({ mapInstance: map });
    seriesLands();
    expect(m.setMarineData).not.toHaveBeenCalled();
    expect(m.updateMarineGridRef.current).not.toHaveBeenCalled();
    expect(window.__MARINE_SETTLE_CHECK__).toBeUndefined();
  });
});

describe('pure parts', () => {
  it('settleMapFor: live beats a null or older memoised map; the kill keeps the memoised one', () => {
    const a = mkMap(), b = mkMap();
    expect(settleMapFor(null, { current: a })).toEqual({ map: a, src: 'live' });
    expect(settleMapFor(b, { current: a })).toEqual({ map: a, src: 'live' });
    expect(settleMapFor(a, { current: a })).toEqual({ map: a, src: 'same' });
    expect(settleMapFor(null, { current: null })).toEqual({ map: null, src: 'none' });
    window.__RAW_DISABLE_SETTLE_LIVE_MAP__ = true;
    expect(settleMapFor(null, { current: a })).toEqual({ map: null, src: 'none' });
    expect(settleMapFor(b, { current: a })).toEqual({ map: b, src: 'closure' });
  });

  it('settleArmKey: the active flag, or a constant under either kill', () => {
    expect(settleArmKey({ current: true })).toBe(true);
    expect(settleArmKey({ current: false })).toBe(false);
    window.__RAW_DISABLE_SETTLE_ARM_ON_ACTIVATE__ = true;
    expect(settleArmKey({ current: true })).toBe('legacy');
    expect(settleArmKey({ current: false })).toBe('legacy');
    delete window.__RAW_DISABLE_SETTLE_ARM_ON_ACTIVATE__;
    window.__RAW_DISABLE_SETTLE_LIVE_MAP__ = true;
    expect(settleArmKey({ current: true })).toBe('legacy');
  });

  it('runSettleCheckLive hands the callbacks through unchanged and records only the first outcome', () => {
    const commit = jest.fn(() => 'c');
    const fetch = jest.fn(() => 'f');
    const map = mkMap();
    let seen = null;
    runSettleCheckLive((ctx) => {
      seen = ctx;
      expect(ctx.setMarineData({ __commitLane: 'recovery_2b' })).toBe('c');
      expect(typeof ctx.updateMarineGridRef.current).toBe('function');
      expect(ctx.updateMarineGridRef.current('clamp_resharpen', 1)).toBe('f');
    }, { mapInstance: null, setMarineData: commit, updateMarineGridRef: { current: fetch }, keep: 7 }, { current: map });
    expect(seen.mapInstance).toBe(map);
    expect(seen.keep).toBe(7);
    expect(commit).toHaveBeenCalledWith({ __commitLane: 'recovery_2b' });
    expect(fetch).toHaveBeenCalledWith('clamp_resharpen', 1);
    expect(window.__MARINE_SETTLE_CHECK__.counts).toEqual({ 'live|commit:recovery_2b': 1 });
    expect(window.__MARINE_SETTLE_CHECK__.recent[0]).toMatchObject({ map: 'live', out: 'commit:recovery_2b', data: false, pending: false });
  });

  it('runSettleCheckLive keeps a missing fetch callback missing (the check tests it before calling)', () => {
    runSettleCheckLive((ctx) => { expect(ctx.updateMarineGridRef.current).toBeNull(); expect(ctx.setMarineData).toBeUndefined(); },
      { mapInstance: null, updateMarineGridRef: { current: null } }, { current: null });
    expect(window.__MARINE_SETTLE_CHECK__.counts).toEqual({ 'none|none': 1 });
  });
});

/**
 * The settle check upgrades a thinned world frame to the exact one (2026-10-01).
 *
 * At world zoom the settle safety net commits the warmed series frame and SKIPS the per-hour /grid fetch (right while scrubbing).
 * That frame is a thinned view (46 x 20, `decimated_stride` 4) and was FINAL. runScrubSettleCheck now starts the exact fetch
 * through the normal path (source 'exact_upgrade') once the timeline has settled on a world-width viewport.
 */
import { renderHook } from '@testing-library/react';
import { runScrubSettleCheck, useMarineScrubSettle } from './useMarineScrubSettle';
import * as upgrade from './marineExactUpgrade';
import { _resetExactUpgradeForTest } from './marineExactUpgrade';

jest.mock('./marineGridSeries', () => ({
  getMarineSeriesFrame: jest.fn(),
  ensureMarineSeries: jest.fn(),
}));

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const resident = (over = {}) => ({
  grid: { vectors: [{ lat: 0, lng: 0, speed: 1, u: 0, v: 1 }], cols: 46, rows: 20, bounds: WORLD, hourOffset: 147, __renderable: true, __decimatedStride: 4, ...over },
  hourOffset: 147, __renderable: true,
});
const mkMap = ({ zoom = 3.6, w = 160, h = 70 } = {}) => ({
  getZoom: () => zoom,
  getBounds: () => ({ getWest: () => -80 - w / 2, getEast: () => -80 + w / 2, getSouth: () => 28 - h / 2, getNorth: () => 28 + h / 2 }),
});
const mkCtx = (over = {}) => ({
  marineData: resident(), mapInstance: mkMap(), setMarineData: jest.fn(),
  timeOffsetRef: { current: 147 }, activeModelRef: { current: 'GFS' }, activeMarineLayerRef: { current: 'waves' },
  safetyNetRetryRef: { current: { key: '', count: 0 } }, clampRefetchRef: { current: { key: '', count: 0 } },
  marineFetchLocksRef: { current: { isFetching: false, lastHash: 'abc' } }, updateMarineGridRef: { current: jest.fn() },
  marineRevision: { current: 0 }, lastCommittedSigRef: { current: 'SIG' },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  _resetExactUpgradeForTest();
  delete window.__MARINE_ENGINE__;
  delete window.__MARINE_FETCH_PENDING__;
  delete window.__RAW_DISABLE_EXACT_UPGRADE__;
  window.isScrubbingTimeline = false;
});

describe('runScrubSettleCheck -> exact upgrade', () => {
  it('starts the exact fetch for a settled, thinned world frame at the selected hour (and commits nothing itself)', () => {
    const ctx = mkCtx();
    runScrubSettleCheck(ctx);
    expect(ctx.updateMarineGridRef.current).toHaveBeenCalledTimes(1);
    expect(ctx.updateMarineGridRef.current).toHaveBeenCalledWith('exact_upgrade');
    expect(ctx.marineFetchLocksRef.current.lastHash).toBeNull();      // the same-viewport dedupe cannot swallow it
    expect(ctx.setMarineData).not.toHaveBeenCalled();                 // the exact frame commits through the NORMAL path
  });

  it('upgrades the nearest-hour placeholder too (selected offset 147, warmed frame h146: the live case)', () => {
    const ctx = mkCtx({ marineData: resident({ hourOffset: 146 }) });
    runScrubSettleCheck(ctx);
    expect(ctx.updateMarineGridRef.current).toHaveBeenCalledWith('exact_upgrade');
  });

  it('leaves an exact world frame alone', () => {
    const ctx = mkCtx({ marineData: resident({ cols: 181, rows: 82, __decimatedStride: 0 }) });
    runScrubSettleCheck(ctx);
    expect(ctx.updateMarineGridRef.current).not.toHaveBeenCalled();
  });

  it('waits while the timeline is moving (the thin frame is the right placeholder mid-scrub)', () => {
    window.isScrubbingTimeline = true;
    const ctx = mkCtx();
    runScrubSettleCheck(ctx);
    expect(ctx.updateMarineGridRef.current).not.toHaveBeenCalled();
  });

  it('does not fire at a zoomed-in viewport, where the display gate hides a world frame', () => {
    const ctx = mkCtx({ mapInstance: mkMap({ zoom: 9, w: 3, h: 2 }) });
    runScrubSettleCheck(ctx);
    expect(ctx.updateMarineGridRef.current).not.toHaveBeenCalledWith('exact_upgrade');
  });

  it('honours the kill switch', () => {
    window.__RAW_DISABLE_EXACT_UPGRADE__ = true;
    const ctx = mkCtx();
    runScrubSettleCheck(ctx);
    expect(ctx.updateMarineGridRef.current).not.toHaveBeenCalled();
  });

  it('is bounded: a second immediate settle does not refire (no storm against a backend that cannot serve it)', () => {
    const ctx = mkCtx();
    runScrubSettleCheck(ctx);
    runScrubSettleCheck(ctx);
    expect(ctx.updateMarineGridRef.current).toHaveBeenCalledTimes(1);
  });
});

// ── the hook's call site: pure helpers passing does not mean the hook calls them (the recorded "11 green tests guarded nothing
// at the call site" class). Mount the REAL useMarineScrubSettle with the upgrade module spied and read what it is handed.
describe('useMarineScrubSettle wiring', () => {
  it('hands the exact-upgrade hook the live marineData and ITS OWN settle check, so a thinned frame re-drives the very check that upgrades it', () => {
    const spy = jest.spyOn(upgrade, 'useMarineExactUpgrade').mockImplementation(() => {});
    const data = resident();
    const ctx = mkCtx({ marineData: data });
    renderHook(() => useMarineScrubSettle({
      mapInstance: null, marineData: data, setMarineData: ctx.setMarineData,
      timeOffsetRef: ctx.timeOffsetRef, activeModelRef: ctx.activeModelRef, activeMarineLayerRef: ctx.activeMarineLayerRef,
      activeMarineLayersRef: { current: true }, marineFetchLocksRef: ctx.marineFetchLocksRef, updateMarineGridRef: ctx.updateMarineGridRef,
      marineRevision: ctx.marineRevision, lastCommittedSigRef: ctx.lastCommittedSigRef,
    }));
    expect(spy).toHaveBeenCalled();
    const [seenData, checkRef, seenHourRef] = spy.mock.calls[spy.mock.calls.length - 1];
    expect(seenData).toBe(data);
    expect(typeof checkRef.current).toBe('function');
    expect(seenHourRef).toBe(ctx.timeOffsetRef);            // the live hour ref: the drive waits for the selected hour to hold still
    spy.mockRestore();
  });
});

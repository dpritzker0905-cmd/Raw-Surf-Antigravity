/**
 * The settle hook mounts the world warm (2026-10-01, audit F-21; marineWorldWarmOnSettle.js).
 *
 * The warm's own tests mount the warm. This one mounts the REAL useMarineScrubSettle and reads what it hands the warm: the recorded "green unit
 * tests, nothing wired" class. Every ref the warm reads at its fire time must be the live one (a stale or missing ref would warm the wrong hour,
 * model or layer, or never fire).
 */
import { renderHook } from '@testing-library/react';
import { useMarineScrubSettle } from './useMarineScrubSettle';
import * as warm from './marineWorldWarmOnSettle';

jest.mock('./marineGridSeries', () => ({
  getMarineSeriesFrame: jest.fn(),
  ensureMarineSeries: jest.fn(),
}));

describe('useMarineScrubSettle wiring: the world warm', () => {
  it('hands the warm the live marineData, map and every ref it reads when it fires', () => {
    const spy = jest.spyOn(warm, 'useMarineWorldWarmOnSettle').mockImplementation(() => {});
    const data = { grid: { vectors: [{ lat: 0, lng: 0, speed: 1 }], cols: 181, rows: 82, bounds: { west: -180, south: -80, east: 180, north: 85 } }, hourOffset: 147 };
    const refs = {
      timeOffsetRef: { current: 147 }, activeModelRef: { current: 'GFS' }, activeMarineLayerRef: { current: 'waves' },
      activeMarineLayersRef: { current: ['waves'] },
    };
    const map = { getZoom: () => 9, getBounds: () => ({ getWest: () => -81, getEast: () => -80, getSouth: () => 27, getNorth: () => 28 }), on: jest.fn(), off: jest.fn() };
    renderHook(() => useMarineScrubSettle({
      mapInstance: map, marineData: data, setMarineData: jest.fn(), ...refs,
      marineFetchLocksRef: { current: { isFetching: false, lastHash: 'abc' } }, updateMarineGridRef: { current: jest.fn() },
      safetyNetRetryRef: { current: { key: '', count: 0 } }, clampRefetchRef: { current: { key: '', count: 0 } },
      marineRevision: { current: 0 }, lastCommittedSigRef: { current: 'SIG' },
    }));
    expect(spy).toHaveBeenCalled();
    const arg = spy.mock.calls[spy.mock.calls.length - 1][0];
    expect(arg.marineData).toBe(data);
    expect(arg.mapInstance).toBe(map);
    for (const k of Object.keys(refs)) expect(arg[k]).toBe(refs[k]);                       // the very objects: a copy would go stale
    spy.mockRestore();
  });
});

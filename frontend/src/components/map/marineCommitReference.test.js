import { useEffect, useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { commitMarineData } from './useMarineDataFetcherHelpers';
import { _marineDataSignature } from './useMarineOrchestratorDiag';
import { getMarineSeriesFrame } from './marineGridSeries';
jest.mock('./marineGridSeries', () => ({ ...jest.requireActual('./marineGridSeries'), getMarineSeriesFrame: jest.fn() }));

const bounds = { west: -84, south: 26, east: -76, north: 32 };
const ref = current => ({ current });
function fixture(speed = 2) {
  const data = { hourOffset: 0, __commitRevision: 7, grid: { bounds, cols: 3, rows: 3, hourOffset: 0,
    __sourceModel: 'GFS', __componentLayer: 'waves', __provider: 'test-fixture',
    model_run_time: '2026-09-13T00:00:00Z', served_valid_time: '2026-09-14T03:00:00Z',
    vectors: Array.from({ length: 9 }, (_, i) => ({ lng: -84 + i % 3 * 4, lat: 26 + Math.floor(i / 3) * 3, speed, height: speed, direction: 90, period: 8 })) } };
  data.__committedSig = _marineDataSignature(data, 'waves');
  return data;
}
function setup(initial, recover = true) {
  const observed = [];
  const h = renderHook(() => {
    const [data, setData] = useState(initial);
    useEffect(() => { observed.push(data.__commitRevision); }, [data]);
    return { data, setData, renderedRevision: data.__commitRevision };
  });
  const ledger = ref(recover ? null : initial.__committedSig), revision = ref(7);
  const commit = data => act(() => commitMarineData({ data, bounds, model: 'GFS', layer: 'waves', timeOffset: 0,
    timeOffsetRef: ref(0), setMarineData: h.result.current.setData, lastCommittedSigRef: ledger, marineRevision: revision,
    getViewportHash: () => 'viewport', logPipelineEventHelper: jest.fn(), consecutiveFailuresRef: ref(0),
    isCommittingDataRef: ref(false), isInternalMapUpdateRef: ref(false), internalUpdateTimerRef: ref(null),
    locks: {}, source: 'regional_ready', scheduleSWRRevalidation: jest.fn(), updateMarineGrid: jest.fn(),
    getBackendCopernicusFlag: () => false, getBackendIconMarineFlag: () => false, getBackendWeatherFlag: () => false,
    _marineDataSignature, getSharedValidTime: () => null, updateDeprecationDiag: jest.fn(),
    setTimeoutFunc: setTimeout, clearTimeoutFunc: clearTimeout }));
  return { ...h, observed, ledger, revision, commit };
}
beforeEach(() => { jest.useFakeTimers(); getMarineSeriesFrame.mockReset(); window.__RAW_CAPTURE_OPACITY__ = true; delete window.__RAW_DEMAND_EVIDENCE__; });
afterEach(() => { cleanup(); jest.clearAllTimers(); jest.useRealTimers(); delete window.__RAW_CAPTURE_OPACITY__; delete window.__RAW_DEMAND_EVIDENCE__; });

test('ledger-null recovery of the same cached object reaches a React effect', () => {
  const original = fixture(), h = setup(original);
  h.commit(original);
  expect(h.revision.current).toBe(8);
  expect(h.result.current.renderedRevision).toBe(8);
  expect(h.observed).toEqual([7, 8]);
  expect(h.result.current.data).not.toBe(original);
  expect(h.result.current.data.grid).toBe(original.grid);
  expect(h.result.current.data.grid.vectors).toBe(original.grid.vectors);
  expect(window.__RAW_DEMAND_EVIDENCE__.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'state_selected', revision: 8, sameReference: true })
  ]));
});

test('normal duplicate remains suppressed with no new observed revision', () => {
  const original = fixture(), h = setup(original, false);
  h.commit(original);
  expect(h.revision.current).toBe(7);
  expect(h.result.current.data).toBe(original);
  expect(h.observed).toEqual([7]);
  expect(window.__RAW_DEMAND_EVIDENCE__.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'state_skipped', status: 'duplicate' })
  ]));
});

test('a different accepted object keeps its identity and forecast fields', () => {
  const original = fixture(), incoming = fixture(4), h = setup(original);
  h.commit(incoming);
  expect(h.result.current.data).toBe(incoming);
  expect(h.observed).toEqual([7, 8]);
  expect(h.result.current.data.grid.served_valid_time).toBe('2026-09-14T03:00:00Z');
  expect(h.result.current.data.grid.model_run_time).toBe('2026-09-13T00:00:00Z');
});

test('the stale-global guard can refeed the same covering regional series object', () => {
  const original = fixture(), h = setup(original);
  const coarse = fixture(4); coarse.stale = true;
  coarse.grid.bounds = { west: -180, south: -80, east: 180, north: 85 };
  getMarineSeriesFrame.mockReturnValue(original);
  h.commit(coarse);
  expect(h.observed).toEqual([7, 8]);
  expect(h.result.current.data).not.toBe(original);
  expect(h.result.current.data.grid).toBe(original.grid);
});

test('the stale-global guard still skips an already committed regional series object', () => {
  const original = fixture(), h = setup(original, false);
  const coarse = fixture(4); coarse.stale = true;
  coarse.grid.bounds = { west: -180, south: -80, east: 180, north: 85 };
  getMarineSeriesFrame.mockReturnValue(original);
  h.commit(coarse);
  expect(h.observed).toEqual([7]);
  expect(h.result.current.data).toBe(original);
});

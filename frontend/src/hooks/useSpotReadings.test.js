import { act, renderHook, waitFor } from '@testing-library/react';
import { useSpotReadings } from './useSpotReadings';
import apiClient from '../lib/apiClient';
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); apiClient.get.mockResolvedValue({ data: {} }); });
test.each([
  ['conditions', '/conditions/old?model=GFS', '/conditions/new?model=GFS', { current: { wave_height_ft: 2 } }],
  ['tideData', '/tides/old', '/tides/new', { height_m: 1 }],
  ['reports', '/surf-reports/today/old', '/surf-reports/today/new', { count: 2 }],
  ['forecast', '/conditions/forecast/old?model=GFS', '/conditions/forecast/new?model=GFS', { forecast: [{ wave_height_max: 3 }] }],
])('%s late completion is owned by its original spot and is aborted on replacement', async (field, oldUrl, newUrl, data) => {
  const old = deferred();
  apiClient.get.mockImplementation(url => url === oldUrl ? old.promise : Promise.resolve({ data: url === newUrl ? data : {} }));
  const { result, rerender } = renderHook(({ id }) => useSpotReadings(id, true), { initialProps: { id: 'old' } });
  const signal = apiClient.get.mock.calls.find(([url]) => url === oldUrl)[1].signal;
  rerender({ id: 'new' });
  await waitFor(() => expect(result.current[field]).toEqual(field === 'forecast' ? data.forecast : data));
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve({ data: { stale: true, forecast: [{ stale: true }] } }));
  expect(result.current[field]).toEqual(field === 'forecast' ? data.forecast : data);
});
test('closing/unmounting aborts all owned reads and cannot expose a late value on reopen', async () => {
  const pending = deferred(); apiClient.get.mockReturnValue(pending.promise);
  const { result, rerender, unmount } = renderHook(({ enabled }) => useSpotReadings('spot', enabled), { initialProps: { enabled: true } });
  const signals = apiClient.get.mock.calls.map(([, config]) => config.signal);
  rerender({ enabled: false }); expect(signals.every(signal => signal.aborted)).toBe(true);
  await act(async () => pending.resolve({ data: { current: { wave_height_ft: 9 } } }));
  expect(result.current.conditions).toBeNull();
  rerender({ enabled: true }); unmount();
  expect(apiClient.get.mock.calls.every(([, config]) => config.signal.aborted)).toBe(true);
});
test('report refresh cannot be overwritten by the initial slower report read', async () => {
  const old = deferred(); let reports = 0;
  apiClient.get.mockImplementation(url => url.startsWith('/surf-reports/')
    ? ++reports === 1 ? old.promise : Promise.resolve({ data: { count: 2 } }) : Promise.resolve({ data: {} }));
  const { result } = renderHook(() => useSpotReadings('spot', true));
  act(() => result.current.refreshReports());
  await waitFor(() => expect(result.current.reports).toEqual({ count: 2 }));
  await act(async () => old.resolve({ data: { count: 1 } }));
  expect(result.current.reports).toEqual({ count: 2 });
});

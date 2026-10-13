import { act, renderHook } from '@testing-library/react';
import { useExactPointFetch } from './useExactPointFetch';
jest.mock('../components/map/forecastSamplers', () => ({
  fetchExactMarinePoint: jest.fn(), hasCacheForModel: () => false, getCachedPointResponse: () => null,
  selectExactPointHour: response => response?.selected || null,
}));
jest.mock('../components/map/marineControllerUtils', () => ({ isInCooldown: () => false, clearCooldown: jest.fn() }));
const props = { pointLat: 30, pointLng: -87, activeModel: 'GFS', activeLayer: 'waves',
  isExactPointRequired: true, settledOffset: 98, timeOffsetHours: 98, isPlaying: true };
const receipt = { servedValidTime: '2026-10-09T00:00:00.000Z', storedProductId: 'actual.json' };
const response = { frameReceipt: receipt, selected: { time: '2026-10-09T02:00:00Z', wave_height: 5.79 } };
beforeEach(() => { jest.useFakeTimers(); delete window.__MARINE_POINT_DIAG__; });
afterEach(() => { jest.useRealTimers(); delete window.__MARINE_POINT_DIAG__; });
test('point hook reports the response receipt, not the selected hourly ask', () => {
  const hook = renderHook(p => useExactPointFetch(p), { initialProps: props });
  act(() => hook.result.current.setExactPointResponse(response));
  expect(window.__MARINE_POINT_DIAG__.frameReceipt).toBe(receipt);
  expect(window.__MARINE_POINT_DIAG__.selectedTimestamp).not.toBe(receipt.servedValidTime);
});
test('clearing point selection clears its old diagnostic receipt', () => {
  const hook = renderHook(p => useExactPointFetch(p), { initialProps: props });
  act(() => hook.result.current.setExactPointResponse(response));
  hook.rerender({ ...props, pointLat: null, pointLng: null });
  expect(window.__MARINE_POINT_DIAG__?.frameReceipt || null).toBeNull();
});
test('an hour outside exact response coverage cannot certify the old point receipt', () => {
  const hook = renderHook(p => useExactPointFetch(p), { initialProps: props });
  act(() => hook.result.current.setExactPointResponse({ ...response,
    selected: { ...response.selected, status: 'exact_no_time_coverage', wave_height: null } }));
  expect(window.__MARINE_POINT_DIAG__?.frameReceipt || null).toBeNull();
});

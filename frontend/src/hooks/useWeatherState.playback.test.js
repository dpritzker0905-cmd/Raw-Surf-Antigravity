import { act, renderHook } from '@testing-library/react';
import { useWeatherState } from './useWeatherState';

jest.mock('../components/map/LayerAccessResolver', () => ({
  resolveForecastWindow: () => 14, getUserTier: () => 'premium', getAllowedModels: () => ['GFS', 'ICON'],
}));
jest.mock('../components/map/radarTileRecolor', () => ({ registerRadarRecolorProtocol: jest.fn() }));
jest.mock('../components/map/marineController', () => ({
  getModelSafeMarine: jest.fn(), prewarmGlobalMarineGrid: jest.fn(),
}));
jest.mock('../components/map/backendWeatherServiceClient', () => ({
  getSharedValidTime: h => new Date(Date.UTC(2026, 9, 4, h)).toISOString(), getSurfModeFlag: () => false,
}));
import { getModelSafeMarine, prewarmGlobalMarineGrid } from '../components/map/marineController';

const frame = h => ({ grid: {
  bounds: { west: -180, east: 180, south: -80, north: 85 }, cols: 181, rows: 82,
  vectors: [{ speed: 2 }], __sourceModel: 'GFS', __componentLayer: 'waves',
  valid_time: new Date(Date.UTC(2026, 9, 4, h)).toISOString(), __decimatedStride: 1,
} });
function player() {
  const hook = renderHook(() => useWeatherState({ user: null }));
  act(() => { hook.result.current.setActiveLayers(['waves']); hook.result.current.setIsPlayingTimeline(true); });
  return hook;
}
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(Date.UTC(2026, 9, 4)); jest.clearAllMocks(); localStorage.clear();
  process.env.REACT_APP_GFS_EXACT_PLAYBACK = 'true';
  window.map = { getBounds: () => ({ getWest: () => -130, getEast: () => -10, getSouth: () => 0, getNorth: () => 60 }) };
  global.fetch = jest.fn().mockResolvedValue({ json: async () => ({}) });
  getModelSafeMarine.mockReturnValue(null);
});
afterEach(() => {
  jest.useRealTimers(); delete process.env.REACT_APP_GFS_EXACT_PLAYBACK; delete window.map;
  delete window.__RAW_DISABLE_GFS_EXACT_PLAYBACK__;
});
test('slow next frame holds the selected hour, warms only the next frame, then advances once ready', () => {
  const { result } = player();
  expect(prewarmGlobalMarineGrid).toHaveBeenCalledWith('GFS', 6, expect.any(Object), 'waves', expect.objectContaining({ playback: true }));
  act(() => jest.advanceTimersByTime(12000));
  expect(result.current.timeOffsetHours).toBe(0);
  expect(result.current.isForecastBuffering).toBe(true);
  getModelSafeMarine.mockImplementation((model, h) => h === 6 ? frame(6) : null);
  act(() => jest.advanceTimersByTime(250));
  expect(result.current.timeOffsetHours).toBe(6);
  act(() => jest.advanceTimersByTime(1000));
  expect(result.current.timeOffsetHours).toBe(6);
  expect(prewarmGlobalMarineGrid.mock.calls.every(c => [6, 12].includes(c[1]))).toBe(true);
});
test.each(['thin', 'old time', 'substituted', 'wrong model', 'empty', 'wrong layer', 'served time', 'invalid time', 'nonrenderable'])('a %s next frame cannot advance playback', invalid => {
  const value = frame(6);
  if (invalid === 'thin') value.grid.__decimatedStride = 4;
  if (invalid === 'old time') value.grid.valid_time = frame(0).grid.valid_time;
  if (invalid === 'substituted') value.grid.frame_substituted = true;
  if (invalid === 'wrong model') value.grid.__sourceModel = 'ICON';
  if (invalid === 'empty') value.grid.vectors = [];
  if (invalid === 'wrong layer') value.grid.__componentLayer = 'swell_1';
  if (invalid === 'served time') value.grid.served_valid_time = frame(0).grid.valid_time;
  if (invalid === 'invalid time') value.grid.valid_time = 'invalid';
  if (invalid === 'nonrenderable') value.grid.__renderable = false;
  getModelSafeMarine.mockReturnValue(value);
  const { result } = player();
  act(() => jest.advanceTimersByTime(8000));
  expect(result.current.timeOffsetHours).toBe(0);
});
test('ready next frame keeps the four-second cadence without catching up', () => {
  getModelSafeMarine.mockImplementation((_, h) => frame(h));
  const { result } = player();
  act(() => jest.advanceTimersByTime(3999)); expect(result.current.timeOffsetHours).toBe(0);
  act(() => jest.advanceTimersByTime(1)); expect(result.current.timeOffsetHours).toBe(6);
});
test('pause stops readiness polling and cannot advance on a late response', () => {
  const { result } = player();
  act(() => jest.advanceTimersByTime(4000));
  act(() => result.current.setIsPlayingTimeline(false));
  getModelSafeMarine.mockReturnValue(frame(6));
  act(() => jest.advanceTimersByTime(12000));
  expect(result.current.timeOffsetHours).toBe(0);
  expect(result.current.isForecastBuffering).toBe(false);
});
test.each(['unset', 'kill'])('legacy cadence remains under %s control', control => {
  if (control === 'unset') delete process.env.REACT_APP_GFS_EXACT_PLAYBACK;
  else window.__RAW_DISABLE_GFS_EXACT_PLAYBACK__ = true;
  const { result } = player();
  act(() => jest.advanceTimersByTime(4000));
  expect(result.current.timeOffsetHours).toBe(6);
  expect(prewarmGlobalMarineGrid).not.toHaveBeenCalled();
});
test('failed warm attempts are bounded to three for a selected next hour', () => {
  const { result } = player();
  act(() => jest.advanceTimersByTime(180000));
  expect(prewarmGlobalMarineGrid).toHaveBeenCalledTimes(3);
  expect(result.current.timeOffsetHours).toBe(0);
});
test('manual scrub owns the hour while its gesture is active', () => {
  window.isScrubbingTimeline = true;
  getModelSafeMarine.mockImplementation((_, h) => frame(h));
  const { result } = player();
  act(() => jest.advanceTimersByTime(8000));
  expect(result.current.timeOffsetHours).toBe(0);
  expect(prewarmGlobalMarineGrid).not.toHaveBeenCalled();
  delete window.isScrubbingTimeline;
});
test('zooming into a regional viewport pauses wide-view playback', () => {
  const { result } = player();
  window.map.getBounds = () => ({ getWest: () => -81, getEast: () => -79, getSouth: () => 27, getNorth: () => 29 });
  act(() => jest.advanceTimersByTime(250));
  expect(result.current.isPlayingTimeline).toBe(false); expect(result.current.timeOffsetHours).toBe(0);
});
test('switching model cancels the GFS readiness gate and resumes the model cadence', () => {
  const { result } = player();
  act(() => jest.advanceTimersByTime(5000));
  act(() => result.current.setActiveModel('ICON'));
  act(() => jest.advanceTimersByTime(4000)); expect(result.current.timeOffsetHours).toBe(6);
});

/**
 * Spot-hub phase 4 on the REAL pinned drawer (SpotConditions): the chart in place of the tiered rows once the
 * series is published, in three themes, with the map hour both ways; a miss or the kill switch keeps the rows.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SpotConditions from './SpotConditions';
import apiClient from '../lib/apiClient';
import { makeSeriesBody } from './spot-hub/charts/spotSeries.fixture';
import { _resetSpotSeriesCacheForTests } from './spot-hub/charts/useSpotSeries';

let mockTheme = 'dark';
let mockUser = null;
jest.mock('../lib/apiClient', () => {
  global.fetch = jest.fn(() => Promise.reject(new Error('offline test')));   // LayerAccessResolver's load-time fetch
  return { __esModule: true, BACKEND_URL: '', default: { get: jest.fn(), post: jest.fn() } };
});
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const H = 3600 * 1000;
const NOW = Date.parse('2026-11-04T16:20:00Z');
const ROWS = Array.from({ length: 10 }, (_, i) => ({
  date: new Date(Date.parse('2026-11-05T12:00:00Z') + i * 24 * H).toISOString().slice(0, 10),
  wave_height_min: 2, wave_height_max: 3, label: 'Waist High', wave_period: 11.5,
}));

function mockApi(series) {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/weather/spot-series/')) {
      return series.status === 'ok' ? Promise.resolve({ data: series }) : Promise.reject({ response: { status: 404, data: series } });
    }
    if (url.startsWith('/conditions/forecast/')) return Promise.resolve({ data: { forecast: ROWS } });
    if (url.startsWith('/conditions/')) return Promise.resolve({ data: { current: { wave_height_ft: 3, wave_period: 11, swell_height_ft: 2 } } });
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetSpotSeriesCacheForTests();
  mockTheme = 'dark';
  mockUser = null;
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  Date.now.mockRestore();
  delete window.__RAW_DISABLE_SPOT_HUB_CHARTS__;
  localStorage.clear();
});

test.each(['light', 'dark', 'beach'])('%s: the drawer shows the chart instead of the tiered rows', async (theme) => {
  mockTheme = theme;
  mockApi(makeSeriesBody({ nowMs: NOW }));
  render(<SpotConditions spotId="spot" />);
  expect(await screen.findByTestId('spot-forecast-chart')).toBeInTheDocument();
  expect(screen.queryByText('Surf Forecast')).toBeNull();
  expect(apiClient.get).toHaveBeenCalledWith('/weather/spot-series/spot', { params: { model: 'GFS', subscription_tier: 'guest' } });
});

test('the drawer follows the map hour and moves it', async () => {
  const onSelect = jest.fn();
  mockApi(makeSeriesBody({ nowMs: NOW }));
  render(<SpotConditions spotId="spot" timeOffsetHours={48} onSelectOffset={onSelect} />);
  const slider = await screen.findByRole('slider');
  expect(slider.getAttribute('aria-valuetext')).toMatch(/^Fri /);
  // anchor 16Z; +48 h = Fri 16Z, nearest frame 15Z (+47 h); one step left is 12Z = +44 h
  fireEvent.keyDown(slider, { key: 'ArrowLeft' });
  expect(onSelect).toHaveBeenCalledWith(44);
});

test('a premium drawer asks for its model and opens 14 days', async () => {
  mockUser = { subscription_tier: 'premium' };
  localStorage.setItem('rawsurf-active-model', 'EURO');
  mockApi(makeSeriesBody({ nowMs: NOW, hours: 336, tier: 'premium', model: 'EURO' }));
  render(<SpotConditions spotId="spot" />);
  await screen.findByTestId('spot-forecast-chart');
  expect(apiClient.get).toHaveBeenCalledWith('/weather/spot-series/spot', { params: { model: 'EURO', subscription_tier: 'premium' } });
  expect(screen.getAllByTestId('spot-chart-day')).toHaveLength(14);
  expect(screen.queryByTestId('spot-chart-upgrade')).toBeNull();
});

test('unpublished or killed: the tiered rows, as before', async () => {
  mockApi({ status: 'unpublished' });
  const { unmount } = render(<SpotConditions spotId="spot" />);
  expect(await screen.findByText('Surf Forecast')).toBeInTheDocument();
  unmount();
  _resetSpotSeriesCacheForTests();
  apiClient.get.mockClear();
  window.__RAW_DISABLE_SPOT_HUB_CHARTS__ = true;
  mockApi(makeSeriesBody({ nowMs: NOW }));
  render(<SpotConditions spotId="spot" />);
  expect(await screen.findByText('Surf Forecast')).toBeInTheDocument();
  expect(apiClient.get.mock.calls.some(([url]) => url.startsWith('/weather/spot-series/'))).toBe(false);
});

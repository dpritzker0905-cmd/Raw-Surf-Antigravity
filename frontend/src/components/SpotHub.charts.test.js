/**
 * Spot-hub phase 4 on the REAL full hub (/spot-hub/:id): Raw Surf's chart replaces the daily cards once the
 * spot's series is published, asks for the resolver's tier and model, follows the map hour (`timeOffset`) both
 * ways, and every miss or the kill switch leaves the previous cards. Three themes. Mocking: SpotHub.phase1.test.js.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { makeSeriesBody } from './spot-hub/charts/spotSeries.fixture';

let mockTheme = 'dark';
let mockUser = { id: 'u1', subscription_tier: 'free' };
let mockSearch = '';
const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  useParams: () => ({ spotId: 'spot-1' }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/spot-hub/spot-1', search: mockSearch, state: null }),
}), { virtual: true });
jest.mock('../lib/apiClient', () => {
  global.fetch = jest.fn(() => Promise.reject(new Error('offline test')));   // LayerAccessResolver's load-time fetch
  return { __esModule: true, BACKEND_URL: '', default: { get: jest.fn(), post: jest.fn() } };
});
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../utils/logger', () => ({
  __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('./spot-hub/SpotHubConditionsTab', () => () => null);
jest.mock('./spot-hub/SpotHubIntelTab', () => () => null);
jest.mock('./spot-hub/SpotHubMediaTab', () => () => null);
jest.mock('./spot-hub/SpotHubPhotographers', () => () => null);
jest.mock('./spot-hub/SpotHubLivePulse', () => () => null);
jest.mock('./spot-hub/BookingTypeModal', () => () => null);
jest.mock('./spot-hub/PhotographerRequestModal', () => () => null);
jest.mock('./ScheduledBookingDrawer', () => ({ ScheduledBookingDrawer: () => null }));

import apiClient from '../lib/apiClient';
import SpotHub from './SpotHub';
import { _resetSpotSeriesCacheForTests } from './spot-hub/charts/useSpotSeries';

const H = 3600 * 1000;
const NOW = Date.parse('2026-11-04T16:20:00Z');
const ROWS = Array.from({ length: 10 }, (_, i) => ({
  date: new Date(Date.parse('2026-11-05T12:00:00Z') + i * 24 * H).toISOString().slice(0, 10),
  wave_height_max: 3 + i, wave_height_min: 2, label: 'Waist High',
}));

function mockApi(series) {
  apiClient.get.mockImplementation((url) => {
    if (url.includes('/explore/spot-details/')) {
      return Promise.resolve({ data: { id: 'spot-1', name: 'Test Point', region: 'Coast', latitude: 1, longitude: -117,
        current_conditions: { label: 'Knee High', wave_height_ft: 2.1, wave_period: 11, wave_direction: 286 }, forecast: ROWS } });
    }
    if (url.startsWith('/weather/spot-series/')) {
      return series.status === 'ok' ? Promise.resolve({ data: series })
        : Promise.reject({ response: { status: 404, data: series } });
    }
    return Promise.resolve({ data: {} });
  });
}

class NoopObserver { observe() {} unobserve() {} disconnect() {} }
beforeAll(() => {
  global.IntersectionObserver = global.IntersectionObserver || NoopObserver;
  Element.prototype.scrollTo = Element.prototype.scrollTo || function scrollTo() {};
});
beforeEach(() => {
  jest.clearAllMocks();
  _resetSpotSeriesCacheForTests();
  mockTheme = 'dark';
  mockUser = { id: 'u1', subscription_tier: 'free' };
  mockSearch = '';
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  Date.now.mockRestore();
  delete window.__RAW_DISABLE_SPOT_HUB_CHARTS__;
  localStorage.clear();
});

test.each(['light', 'dark', 'beach'])('%s: the chart replaces the daily cards once the series is published', async (theme) => {
  mockTheme = theme;
  mockApi(makeSeriesBody({ nowMs: NOW }));
  render(<SpotHub />);
  expect(await screen.findByTestId('spot-forecast-chart')).toBeInTheDocument();
  expect(screen.queryByText(/day forecast, from tomorrow/)).toBeNull();
  expect(apiClient.get).toHaveBeenCalledWith('/weather/spot-series/spot-1', { params: { model: 'GFS', subscription_tier: 'free' } });
  expect(screen.getAllByTestId('spot-chart-day')).toHaveLength(3);
});

test('the map hour selects the bar, and a bar choice writes the hub\'s timeOffset', async () => {
  mockSearch = '?timeOffset=24&model=GFS';
  mockApi(makeSeriesBody({ nowMs: NOW }));
  render(<SpotHub />);
  const slider = await screen.findByRole('slider');
  expect(slider.getAttribute('aria-valuetext')).toMatch(/^Thu /);   // +24 h from Wed 08:20 local
  fireEvent.keyDown(slider, { key: 'Home' });
  expect(mockNavigate).toHaveBeenLastCalledWith('/spot-hub/spot-1?timeOffset=0&model=GFS', { replace: true });
});

test('the upgrade prompt goes to billing', async () => {
  mockApi(makeSeriesBody({ nowMs: NOW }));
  render(<SpotHub />);
  fireEvent.click(await screen.findByTestId('spot-chart-upgrade'));
  expect(mockNavigate).toHaveBeenCalledWith('/settings?tab=billing');
});

test.each(['unpublished', 'disabled'])('a series that is %s leaves the previous daily cards', async (why) => {
  mockApi({ status: why });
  render(<SpotHub />);
  expect(await screen.findByText(/day forecast, from tomorrow/)).toBeInTheDocument();
  expect(screen.queryByTestId('spot-forecast-chart')).toBeNull();
});

test('kill switch: the previous cards and no series request', async () => {
  window.__RAW_DISABLE_SPOT_HUB_CHARTS__ = true;
  mockApi(makeSeriesBody({ nowMs: NOW }));
  render(<SpotHub />);
  expect(await screen.findByText(/day forecast, from tomorrow/)).toBeInTheDocument();
  expect(apiClient.get.mock.calls.some(([url]) => url.startsWith('/weather/spot-series/'))).toBe(false);
});

/**
 * Spot-hub phase 1 on the REAL full hub (/spot-hub/:id, 2026-11-03): tides from the drawer's endpoint,
 * the direction and period formats, the window per tier from the app resolver, the selected day, and
 * the kill switch restoring the previous hub. Mocking pattern: SpotHub.confidence.test.js.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';

let mockTheme = 'dark';
let mockUser = { id: 'u1', subscription_tier: 'free' };
let mockSearch = '';

jest.mock('react-router-dom', () => ({
  useParams: () => ({ spotId: 'spot-1' }),
  useNavigate: () => jest.fn(),
  useLocation: () => ({ pathname: '/spot-hub/spot-1', search: mockSearch, state: null }),
}), { virtual: true });
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
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

const H = 3600 * 1000;
const NOW = Date.parse('2026-11-03T04:55:00Z');
const ROWS = Array.from({ length: 10 }, (_, i) => ({
  date: new Date(Date.parse('2026-11-04T12:00:00Z') + i * 24 * H).toISOString().slice(0, 10),
  wave_height_max: 3 + i, wave_height_min: 2, label: 'Waist High',
}));
const TIDES = { source: 'global', station_id: 'open-meteo:sea_level_height_msl', current_status: 'Rising',
  tides: [{ time: '2026-11-03T09:00:00Z', height: 2.1, type: 'High' }, { time: '2026-11-03T15:00:00Z', height: -0.4, type: 'Low' }] };

function mockApi({ current = { label: 'Knee High', wave_height_ft: 2.1, wave_period: 11.24, wave_direction: 286.4, swell_height_ft: 1 },
  forecast = ROWS, lockedDates, tides = TIDES } = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url.includes('/explore/spot-details/')) {
      return Promise.resolve({ data: { id: 'spot-1', name: 'Test Point', region: 'Coast', latitude: 1, longitude: 1,
        current_conditions: current, forecast, ...(lockedDates ? { forecast_locked_dates: lockedDates } : {}) } });
    }
    if (url.startsWith('/tides/')) return Promise.resolve({ data: tides });
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
  mockTheme = 'dark';
  mockUser = { id: 'u1', subscription_tier: 'free' };
  mockSearch = '';
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  Date.now.mockRestore();
  delete window.__RAW_DISABLE_SPOT_HUB_P1__;
  localStorage.clear();
});

test.each(['light', 'dark', 'beach'])('%s: the full hub shows the tide block from /tides/{id}, honestly labelled', async (theme) => {
  mockTheme = theme;
  mockApi();
  render(<SpotHub />);
  const block = await screen.findByTestId('spothub-tides');
  expect(apiClient.get).toHaveBeenCalledWith('/tides/spot-1', expect.anything());
  expect(within(block).getByText("Today's Tides")).toBeInTheDocument();
  expect(within(block).getByText('Rising')).toBeInTheDocument();
  expect(within(block).getByTestId('tide-source-label')).toHaveTextContent('Open-Meteo modelled sea level, mean sea level datum');
  expect(block).not.toHaveTextContent('NOAA');
});

test('no tide for the spot: no tide card, nothing invented', async () => {
  mockApi({ tides: { error: 'Tide data unavailable for this location' } });
  render(<SpotHub />);
  await screen.findByText('Test Point', { selector: 'h1' });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/tides/spot-1', expect.anything()));
  expect(screen.queryByTestId('spothub-tides')).toBeNull();
});

test('direction prints degrees and a compass point, period one decimal', async () => {
  mockApi();
  render(<SpotHub />);
  expect(await screen.findByText('286° WNW')).toBeInTheDocument();
  expect(screen.getByText('11.2s')).toBeInTheDocument();
  expect(screen.queryByText(/286\.4-/)).toBeNull();
});

test('missing direction and period render "—", never "0" or "-s"', async () => {
  mockApi({ current: { label: 'Flat', wave_height_ft: 0.5, wave_period: 0, wave_direction: 0, swell_height_ft: null } });
  render(<SpotHub />);
  await screen.findByText('Test Point', { selector: 'h1' });
  const card = screen.getByText('Direction').closest('.grid');
  expect(within(card).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  expect(within(card).queryByText('-s')).toBeNull();
  expect(within(card).queryByText('--')).toBeNull();
});

test.each([
  ['free', 2, 8, true], ['basic', 6, 4, true], ['premium', 10, 0, false],
])('%s: the forecast opens the resolver window (rolling) and locks the rest', async (tier, open, locked, upsell) => {
  mockUser = { id: 'u1', subscription_tier: tier };
  mockApi();
  render(<SpotHub />);
  const list = await screen.findByRole('list', { name: 'Daily forecast' });
  const items = within(list).getAllByRole('listitem');
  expect(items.filter((i) => /locked/.test(i.getAttribute('aria-label')))).toHaveLength(locked);
  expect(items).toHaveLength(open + locked);
  expect(screen.getByText(`${open}-day forecast, from tomorrow (UTC dates)`)).toBeInTheDocument();
  expect(!!screen.queryByRole('button', { name: 'Upgrade to unlock more forecast days' })).toBe(upsell);
  if (tier === 'premium') {
    // Premium's window is 14 days and the hub carries 10 rows: said, not faked.
    expect(screen.getByTestId('spothub-forecast-horizon-note')).toHaveTextContent('opens 14 days on the map; spot forecasts show up to 10 days');
  }
});

test('locked previews survive a server that withholds the rows (forecast_locked_dates)', async () => {
  mockApi({ forecast: ROWS.slice(0, 2), lockedDates: ROWS.slice(2).map((r) => r.date) });
  render(<SpotHub />);
  const list = await screen.findByRole('list', { name: 'Daily forecast' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(10);
});

test('the map hour selects its UTC day: +24 h is TOMORROW\'s card, not the day after', async () => {
  mockUser = { id: 'u1', subscription_tier: 'premium' };
  mockSearch = '?timeOffset=24';
  mockApi();
  render(<SpotHub />);
  const list = await screen.findByRole('list', { name: 'Daily forecast' });
  const current = within(list).getAllByRole('listitem').filter((i) => i.getAttribute('aria-current') === 'date');
  expect(current).toHaveLength(1);
  expect(current[0].getAttribute('aria-label')).toMatch(/^Wed 4: 3ft/);
});

test('kill switch restores the previous hub: no tide card, old direction, old count slice', async () => {
  window.__RAW_DISABLE_SPOT_HUB_P1__ = true;
  mockApi();
  render(<SpotHub />);
  expect(await screen.findByText('286.4-')).toBeInTheDocument();
  expect(screen.getByText('11.24s')).toBeInTheDocument();
  expect(screen.getByText('3-Day Forecast (Tomorrow onwards)')).toBeInTheDocument();
  expect(screen.getByText('Unlock 14-Day')).toBeInTheDocument();
  expect(screen.queryByTestId('spothub-tides')).toBeNull();
  expect(apiClient.get.mock.calls.some(([url]) => url.startsWith('/tides/'))).toBe(false);
});

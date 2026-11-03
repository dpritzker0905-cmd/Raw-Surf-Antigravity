/**
 * Spot-hub phase 1 on the REAL pinned drawer (SpotConditions, 2026-11-03): the tide and forecast source
 * lines say what the data is, the period is named "Period" and is "—" when absent, the window per tier
 * is the app resolver's, and the kill switch restores the old lines.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import SpotConditions from './SpotConditions';
import apiClient from '../lib/apiClient';

let mockTheme = 'dark';
let mockUser = null;
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const H = 3600 * 1000;
const NOW = Date.parse('2026-11-03T04:55:00Z');
const ROWS = Array.from({ length: 10 }, (_, i) => ({
  date: new Date(Date.parse('2026-11-04T12:00:00Z') + i * 24 * H).toISOString().slice(0, 10),
  wave_height_min: 2, wave_height_max: 3, label: 'Waist High', wave_period: i === 1 ? 0 : 11.5,
}));
const TIDES = { source: 'global', station_id: 'open-meteo:sea_level_height_msl', current_status: 'Falling',
  tides: [{ time: '2026-11-03T09:00:00Z', height: 2.1, type: 'High' }] };

function mockApi(tides = TIDES) {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/conditions/forecast/')) return Promise.resolve({ data: { forecast: ROWS } });
    if (url.startsWith('/conditions/')) return Promise.resolve({ data: { current: { wave_height_ft: 3, wave_period: 11, swell_height_ft: 2 } } });
    if (url.startsWith('/tides/')) return Promise.resolve({ data: tides });
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTheme = 'dark';
  mockUser = null;
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  Date.now.mockRestore();
  delete window.__RAW_DISABLE_SPOT_HUB_P1__;
  localStorage.clear();
});

test.each(['light', 'dark', 'beach'])('%s: the tide line names the modelled sea level, not NOAA', async (theme) => {
  mockTheme = theme;
  mockApi();
  render(<SpotConditions spotId="spot" />);
  const label = await screen.findByTestId('tide-source-label');
  expect(label).toHaveTextContent('Model estimate: Open-Meteo modelled sea level, mean sea level datum');
  expect(screen.queryByText('Data from NOAA Tides & Currents')).toBeNull();
  expect(screen.getByText('Falling')).toBeInTheDocument();
});

test.each([
  [null, 3, 2], [{ subscription_tier: 'basic' }, 7, 6], [{ subscription_tier: 'premium' }, 14, 10],
])('tier %j: the forecast opens the resolver window, labelled "Raw Surf forecast"', async (user, _days, open) => {
  mockUser = user;
  mockApi();
  render(<SpotConditions spotId="spot" />);
  const toggle = await screen.findByRole('button', { name: `Surf forecast, ${open} days` });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByTestId('forecast-source-label')).toHaveTextContent('Raw Surf forecast');
  expect(screen.queryByText('Forecast from Open-Meteo Marine API')).toBeNull();
  expect(screen.getAllByText(/^Period /)).toHaveLength(open);
  if (open < 10) {
    expect(screen.getByText(`+${10 - open} more days locked`)).toBeInTheDocument();
    expect(screen.getByText(/Premium opens the map's 14-day window; spot forecasts show up to 10 days for now\./)).toBeInTheDocument();
  } else {
    expect(screen.queryByTestId('upgrade-forecast-btn')).toBeNull();
  }
});

test('the row period is the total period, named "Period", and "—" when absent (never "0s")', async () => {
  mockApi();
  render(<SpotConditions spotId="spot" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Surf forecast, 2 days' }));
  expect(screen.getByText('Period 11.5s')).toBeInTheDocument();
  expect(screen.getByText('Period —')).toBeInTheDocument();
  expect(screen.queryByText('0s')).toBeNull();
  // Rows are labelled by their UTC date: Nov 4 is Tomorrow at 04:55Z on Nov 3.
  expect(screen.getByText('Tomorrow')).toBeInTheDocument();
  expect(screen.getByText('Nov 4')).toBeInTheDocument();
});

test('kill switch: the old source lines, the old toggle name, the resolver day count', async () => {
  window.__RAW_DISABLE_SPOT_HUB_P1__ = true;
  mockApi();
  render(<SpotConditions spotId="spot" />);
  expect(await screen.findByText('Data from NOAA Tides & Currents')).toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: 'Calendar' });
  expect(within(toggle).getByText('3 Days')).toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.getByText('Forecast from Open-Meteo Marine API')).toBeInTheDocument();
  expect(screen.queryByText(/^Period /)).toBeNull();
});

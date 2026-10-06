import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SpotConditions from './SpotConditions';
import apiClient from '../lib/apiClient';
let mockTheme = 'dark';
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const current = height => ({ data: { current: { wave_height_ft: height, swell_height_ft: height, wave_period: 12 } } });
beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear(); mockTheme = 'dark';
  process.env.REACT_APP_FORECAST_STATE_IDENTITY = 'true'; process.env.REACT_APP_MARINE_VALUE_VALIDITY = 'true';
  apiClient.get.mockResolvedValue({ data: {} });
});
afterEach(() => { delete process.env.REACT_APP_FORECAST_STATE_IDENTITY; delete process.env.REACT_APP_MARINE_VALUE_VALIDITY; });

test.each(['light', 'dark', 'beach'])('daily %s rows name their actual UTC calendar date, not array position', async theme => {
  mockTheme = theme;
  const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-04T12:00:00Z'));
  apiClient.get.mockImplementation(url => Promise.resolve(url.startsWith('/conditions/forecast/')
    ? { data: { forecast: [
      { date: '2026-10-05', wave_height_min: 3, wave_height_max: 5, label: 'Head High' },
      { date: '2026-10-07', wave_height_min: 3, wave_height_max: 5, label: 'Head High' },
    ] } } : url.startsWith('/conditions/') ? current(5) : { data: {} }));
  try {
    render(<SpotConditions spotId="spot" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Calendar' }));
    expect(await screen.findByText('Tomorrow')).toBeInTheDocument();
    expect(screen.getByText('Oct 5')).toBeInTheDocument();
    expect(screen.getByText('Wed')).toBeInTheDocument();
    expect(screen.queryByText('Today')).toBeNull();
  } finally { now.mockRestore(); }
});

test.each([[7, 'Overhead'], [9, 'Overhead'], [12, 'Double Overhead'], [16, 'Triple Overhead+']])(
  'full and compact %sft agree with the canonical size ladder', async (height, label) => {
    apiClient.get.mockImplementation(url => Promise.resolve(url.startsWith('/conditions/') ? current(height) : { data: {} }));
    const { rerender } = render(<SpotConditions spotId="spot" compact />);
    expect(await screen.findAllByText(label)).toHaveLength(1);
    rerender(<SpotConditions spotId="spot" />);
    expect(await screen.findAllByText(label)).toHaveLength(1);
  }
);

test.each(['flag-off', 'runtime-kill'])('%s restores the legacy size ladder and positional date labels', async rollback => {
  if (rollback === 'flag-off') process.env.REACT_APP_FORECAST_STATE_IDENTITY = 'false';
  else window.__RAW_DISABLE_FORECAST_STATE_IDENTITY__ = true;
  apiClient.get.mockImplementation(url => Promise.resolve(url.startsWith('/conditions/forecast/')
    ? { data: { forecast: [{ date: '2026-10-05', wave_height_min: 5, wave_height_max: 9, label: 'Overhead' }] } }
    : url.startsWith('/conditions/') ? current(9) : { data: {} }));
  try {
    render(<SpotConditions spotId="spot" />);
    expect(await screen.findByText('Double Overhead')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Calendar' }));
    expect(await screen.findByText('Today')).toBeInTheDocument();
  } finally { delete window.__RAW_DISABLE_FORECAST_STATE_IDENTITY__; }
});
test.each(['light', 'dark', 'beach'])('late previous spot cannot replace the current %s reading', async theme => {
  mockTheme = theme;
  const old = deferred();
  apiClient.get.mockImplementation(url => url === '/conditions/old?model=GFS' ? old.promise
    : Promise.resolve(url === '/conditions/new?model=GFS' ? current(4) : { data: {} }));
  const { rerender } = render(<SpotConditions spotId="old" compact />);
  rerender(<SpotConditions spotId="new" compact />);
  expect(await screen.findByText('4ft')).toBeInTheDocument();
  await act(async () => old.resolve(current(9)));
  expect(screen.getByText('4ft')).toBeInTheDocument(); expect(screen.queryByText('9ft')).toBeNull();
});
test.each(['light', 'dark', 'beach'])('missing compact sea is unavailable and measured zero is Flat in %s', async theme => {
  mockTheme = theme;
  apiClient.get.mockImplementation(url => Promise.resolve(url.startsWith('/conditions/spot?') ? current(null) : { data: {} }));
  const { rerender } = render(<SpotConditions spotId="spot" compact />);
  expect(await screen.findAllByText('Unavailable')).toHaveLength(2); expect(screen.queryByText('Flat')).toBeNull();
  apiClient.get.mockImplementation(url => Promise.resolve(url.startsWith('/conditions/calm?') ? current(0) : { data: {} }));
  rerender(<SpotConditions spotId="calm" compact />);
  expect(await screen.findAllByText('Flat')).toHaveLength(2);
});
test('same-spot model switch refetches and rejects the old model response', async () => {
  const old = deferred();
  apiClient.get.mockImplementation(url => url === '/conditions/spot?model=GFS' ? old.promise
    : Promise.resolve(url === '/conditions/spot?model=ICON' ? current(5) : { data: {} }));
  render(<SpotConditions spotId="spot" compact />);
  act(() => { localStorage.setItem('rawsurf-active-model', 'ICON'); window.dispatchEvent(new Event('rawsurf-model-changed')); });
  expect(await screen.findByText('5ft')).toBeInTheDocument();
  await act(async () => old.resolve(current(9)));
  expect(screen.queryByText('9ft')).toBeNull();
});
test.each(['light', 'dark', 'beach'])('full %s current and daily missing heights never print zero or empty units', async theme => {
  mockTheme = theme;
  apiClient.get.mockImplementation(url => Promise.resolve(url.startsWith('/conditions/forecast/')
    ? { data: { forecast: [{ date: '2026-10-05', wave_height_min: null, wave_height_max: null, label: 'Flat' }] } }
    : url.startsWith('/conditions/') ? current(null) : { data: {} }));
  render(<SpotConditions spotId="spot" />);
  expect(await screen.findAllByText('Unavailable')).toHaveLength(3);
  fireEvent.click(await screen.findByRole('button', { name: 'Calendar' }));
  expect(screen.getAllByText('Unavailable')).toHaveLength(5);
  expect(screen.queryByText('Flat')).toBeNull(); expect(screen.queryByText('-ft')).toBeNull();
});

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import apiClient from '../../lib/apiClient';
import ForecastDataHealth, { verdictText } from './ForecastDataHealth';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));

const REPORT = {
  status: 'warn', generated_at: '2026-11-18T03:00:00Z', freshest_run_age_h: 1.2, manifest_written_by: 'designated:ingest',
  alerts: ['ICON/wind: lags freshest by 7.0h'],
  lanes: {
    'GFS/marine': { verdict: 'ok', age_h: 1.2, lag_h: 0, horizon_h: 330.5, model_cycle_age_h: 5.1,
      model_cycle_status: 'known', source: 'noaa_gfs' },
    'ICON/wind': { verdict: 'warn', age_h: 8.2, lag_h: 7.0, horizon_h: 140, model_cycle_age_h: 9.0,
      model_cycle_status: 'verified_contributors', source: 'dwd_icon' },
    'ratings/precomputed': { verdict: 'ok', age_h: 0.5, frames: 120 },
  },
  thresholds: { stale_h: 6, critical_h: 12, min_horizon_h: { GFS: 288, EURO: 192, ICON: 96 },
    euro_short_cycle_reach_h: 138, ratings_warn_h: 3.5, ratings_critical_h: 6 },
};

beforeEach(() => apiClient.get.mockReset());

test('verdicts are words', () => {
  expect(verdictText('ok')).toBe('OK');
  expect(verdictText('warn')).toBe('Warning');
  expect(verdictText('critical')).toBe('Critical');
  expect(verdictText(undefined)).toBe('Unknown');
});

test('shows overall status, alerts, every lane and the limits it was judged against', async () => {
  apiClient.get.mockResolvedValue({ data: REPORT });
  render(<ForecastDataHealth />);
  expect(await screen.findByText(/Overall:/)).toHaveTextContent('Overall: Warning · freshest run 1.2 h old');
  expect(apiClient.get).toHaveBeenCalledWith('/health/data');
  expect(screen.getByRole('list', { name: 'Data-health alerts' })).toHaveTextContent('ICON/wind: lags freshest by 7.0h');
  const icon = screen.getByTestId('lane-ICON/wind');
  expect(within(icon).getByRole('rowheader')).toHaveTextContent('ICON/wind');
  expect(icon).toHaveTextContent('Warning');
  expect(icon).toHaveTextContent('verified contributors');
  expect(screen.getByTestId('lane-ratings/precomputed')).toHaveTextContent('120 frames');
  expect(screen.getByTestId('health-thresholds')).toHaveTextContent('more than 6.0 h');
  expect(screen.getAllByRole('columnheader').every((th) => th.getAttribute('scope') === 'col')).toBe(true);
});

test('a critical report arrives as HTTP 503 and is still shown, as an alert', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 503, data: {
    status: 'critical', alerts: ['cron appears DOWN: freshest global product is 14.0h old (> 12.0h)'], lanes: {} } } });
  render(<ForecastDataHealth />);
  const overall = await screen.findByText(/Overall:/);
  expect(overall).toHaveTextContent('Critical');
  expect(overall).toHaveAttribute('role', 'alert');
  expect(screen.getByText(/cron appears DOWN/)).toBeInTheDocument();
});

test('an unreachable check says so', async () => {
  apiClient.get.mockRejectedValue(new Error('network'));
  render(<ForecastDataHealth />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the data-health check.');
});

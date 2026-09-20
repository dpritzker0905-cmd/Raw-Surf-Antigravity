import React from 'react';
import { act, render, screen } from '@testing-library/react';
import ForecastTimeStatus from './ForecastTimeStatus';

beforeEach(() => {
  jest.useFakeTimers();
  window.__FORECAST_TIMELINE_COVERAGE_DIAG__ = {
    activeModel: 'GFS', activeLayer: 'waves', timeOffsetHours: 0,
    requestedValidTime: '2026-09-20T21:00:00Z', selectedValidTime: '2026-09-21T15:00:00Z',
  };
  delete window.__MARINE_RENDER_HOUR_PARITY__;
});
afterEach(() => {
  jest.useRealTimers();
  delete window.__FORECAST_TIMELINE_COVERAGE_DIAG__;
  delete window.__MARINE_RENDER_HOUR_PARITY__;
});

it.each(['light', 'dark', 'beach'])('shows a spoken time mismatch in %s theme', (theme) => {
  render(<ForecastTimeStatus model="GFS" layer="waves" hour={0} theme={theme} />);
  expect(screen.getByRole('status')).toHaveTextContent(/forecast time.*does not match/i);
  expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
});

it('clears the warning when the selected response catches up without another user action', () => {
  window.__FORECAST_TIMELINE_COVERAGE_DIAG__.coverage_status = 'stale_time_mismatch';
  window.__FORECAST_TIMELINE_COVERAGE_DIAG__.spatialCoverageStatus = 'full_coverage';
  render(<ForecastTimeStatus model="GFS" layer="waves" hour={0} theme="dark" />);
  expect(screen.getByRole('status')).toBeInTheDocument();
  window.__FORECAST_TIMELINE_COVERAGE_DIAG__.selectedValidTime = '2026-09-20T21:00:00Z';
  act(() => { jest.advanceTimersByTime(1000); });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(window.__FORECAST_TIMELINE_COVERAGE_DIAG__.coverage_status).toBe('full_coverage');
});

it('does not attribute an old model or layer diagnostic to the current selection', () => {
  render(<ForecastTimeStatus model="ICON" layer="waves" hour={0} theme="dark" />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('does not claim an unverified render diagnostic proves a stale field', () => {
  window.__FORECAST_TIMELINE_COVERAGE_DIAG__.selectedValidTime = '2026-09-20T21:00:00Z';
  window.__MARINE_RENDER_HOUR_PARITY__ = { requestedHour: 0, renderedDataHour: 18, parity: false };
  render(<ForecastTimeStatus model="GFS" layer="waves" hour={0} theme="dark" />);
  expect(screen.getByRole('status')).toHaveTextContent(/verifying.*displayed forecast time/i);
  expect(screen.getByRole('status')).not.toHaveTextContent(/does not match/i);
});

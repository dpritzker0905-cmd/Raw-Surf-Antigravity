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

describe('the rating band held off (marineRatingBandRes.js): said in words, never colour alone', () => {
  afterEach(() => { delete window.__RAW_GPU__; });
  it.each(['light', 'dark', 'beach'])('a coarse rating grid: the band pause is a polite status line in %s theme', (theme) => {
    window.__RAW_GPU__ = { ratingBandFade: { heldBy: 'resolution' } };
    render(<ForecastTimeStatus model="ICON" layer="waves" hour={0} theme={theme} />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent(/surf ratings paused.*detailed rating grid.*still loading/i);
    expect(el).toHaveAttribute('aria-live', 'polite');
    expect(el).toHaveAttribute('data-rating-band-held', 'resolution');
  });
  it('a rating grid that ends in view says so, and the line clears when the engine stops holding', () => {
    window.__RAW_GPU__ = { ratingBandFade: { heldBy: 'edge' } };
    render(<ForecastTimeStatus model="ICON" layer="waves" hour={0} theme="dark" />);
    expect(screen.getByRole('status')).toHaveTextContent(/does not cover this whole view/i);
    window.__RAW_GPU__.ratingBandFade.heldBy = null;
    act(() => { jest.advanceTimersByTime(600); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('it sits beside the time-mismatch line instead of replacing it, and no line without a hold', () => {
    window.__RAW_GPU__ = { ratingBandFade: { heldBy: 'resolution' } };
    render(<ForecastTimeStatus model="GFS" layer="waves" hour={0} theme="dark" />);
    const lines = screen.getAllByRole('status');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveAttribute('data-rating-band-held', 'resolution');   // FIRST: the phone sheet's last line sits under the bottom nav
    expect(lines[1]).toHaveTextContent(/forecast time.*does not match/i);
  });
  it('just switched ON and the rating grid still on its way: "loading" in words; the instant hide (off) says nothing', () => {
    window.__RAW_BAND_TOGGLE_AT__ = Date.now();
    window.__RAW_GPU__ = { ratingBand: { forcedOff: true }, ratingBandFade: { heldBy: null } };
    render(<ForecastTimeStatus model="ICON" layer="waves" hour={0} theme="light" />);
    expect(screen.getByRole('status')).toHaveTextContent(/surf ratings loading for this view/i);
    delete window.__RAW_BAND_TOGGLE_AT__;
  });
  it('band OFF with no honest wash to show: "Loading wave heights" in words', () => {
    window.__RAW_GPU__ = { ratingBandFade: { heldBy: 'off_loading' } };
    render(<ForecastTimeStatus model="ICON" layer="waves" hour={0} theme="beach" />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading wave heights for this view/i);
  });
  it('the instant hide is silent: the band is simply gone', () => {
    window.__RAW_GPU__ = { ratingBandFade: { heldBy: 'off' } };
    render(<ForecastTimeStatus model="ICON" layer="waves" hour={0} theme="dark" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('no hold, no line (the usual case)', () => {
    window.__RAW_GPU__ = { ratingBandFade: { heldBy: null } };
    render(<ForecastTimeStatus model="ICON" layer="waves" hour={0} theme="dark" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

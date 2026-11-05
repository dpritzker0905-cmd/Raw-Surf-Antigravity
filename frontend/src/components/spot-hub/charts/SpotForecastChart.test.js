/**
 * Spot-hub phase 4 on the real components: the chart in all three themes, the slider's keyboard
 * contract (ForecastWheel's), the two-way link to the map hour, locked days with one upgrade prompt,
 * the infobox's compact chart, and the panel's fallback and kill switch (no request at all).
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiClient from '../../../lib/apiClient';
import SpotForecastChart, { SpotForecastMiniChart } from './SpotForecastChart';
import { SpotChartPanel, SpotMiniChartPanel } from './SpotChartPanel';
import { _resetSpotSeriesCacheForTests } from './useSpotSeries';
import { makeSeriesBody } from './spotSeries.fixture';
import { RATING_COLOR, RATING_LABEL } from '../../map/surfRating';

let mockTheme = 'dark';
// LayerAccessResolver fetches /capabilities at module load; keep this suite offline (the factory runs before it).
jest.mock('../../../lib/apiClient', () => {
  global.fetch = jest.fn(() => Promise.reject(new Error('offline test')));
  return { __esModule: true, BACKEND_URL: '', default: { get: jest.fn() } };
});
jest.mock('../../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));

const H = 3600 * 1000;
const NOW = Date.parse('2026-11-04T16:20:00Z');

beforeEach(() => {
  jest.clearAllMocks();
  _resetSpotSeriesCacheForTests();
  mockTheme = 'dark';
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  Date.now.mockRestore();
  delete window.__RAW_DISABLE_SPOT_HUB_CHARTS__;
  localStorage.clear();
});

test.each(['light', 'dark', 'beach'])('%s: bars in the rating colours, each with its word in the slider text', (theme) => {
  mockTheme = theme;
  const body = makeSeriesBody({ nowMs: NOW });
  render(<SpotForecastChart body={body} resolverHours={72} />);
  const bars = screen.getAllByTestId('spot-chart-bar');
  expect(bars.length).toBe(body.valid_times.length);
  bars.forEach((b) => {
    const rect = b.querySelectorAll('rect')[1];
    expect(rect.getAttribute('fill')).toBe(RATING_COLOR[b.getAttribute('data-level')]);
  });
  const slider = screen.getByRole('slider');
  expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining(RATING_LABEL[bars[0].getAttribute('data-level')]));
  expect(screen.getByText(/Local solar time \(UTC−8\)/)).toBeInTheDocument();
  expect(screen.getByText(/↑ offshore · ↔ cross-shore · ↓ onshore/)).toBeInTheDocument();
});

test('the slider keyboard: arrows, PgUp/PgDn, Home/End, and every move names the map hour', () => {
  const onSelect = jest.fn();
  const body = makeSeriesBody({ nowMs: NOW });
  render(<SpotForecastChart body={body} resolverHours={72} onSelectOffset={onSelect} />);
  const slider = screen.getByRole('slider');
  expect(slider).toHaveAttribute('tabindex', '0');
  expect(slider).toHaveAttribute('aria-valuenow', '0');
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(slider).toHaveAttribute('aria-valuenow', '1');
  fireEvent.keyDown(slider, { key: 'PageUp' });
  expect(slider).toHaveAttribute('aria-valuenow', '9');
  fireEvent.keyDown(slider, { key: 'End' });
  expect(slider).toHaveAttribute('aria-valuenow', String(body.valid_times.length - 1));
  fireEvent.keyDown(slider, { key: 'Home' });
  expect(slider).toHaveAttribute('aria-valuenow', '0');
  const anchor = Math.round(NOW / H) * H;
  const f1 = Date.parse(body.valid_times[1]);
  expect(onSelect).toHaveBeenCalledWith(Math.round((f1 - anchor) / H));
  expect(onSelect).toHaveBeenLastCalledWith(0);
});

test('the map hour selects its bar, and tapping a bar moves the map hour', () => {
  const onSelect = jest.fn();
  const body = makeSeriesBody({ nowMs: NOW });
  const { rerender } = render(<SpotForecastChart body={body} resolverHours={72} selectedOffsetHours={24} onSelectOffset={onSelect} />);
  const slider = screen.getByRole('slider');
  const i = Number(slider.getAttribute('aria-valuenow'));
  const anchor = Math.round(NOW / H) * H;
  expect(Math.abs(Date.parse(body.valid_times[i]) - (anchor + 24 * H))).toBeLessThanOrEqual(1.5 * H);
  rerender(<SpotForecastChart body={body} resolverHours={72} selectedOffsetHours={48} onSelectOffset={onSelect} />);
  expect(Number(slider.getAttribute('aria-valuenow'))).toBeGreaterThan(i);
  fireEvent.click(screen.getAllByTestId('spot-chart-bar')[3]);
  expect(slider).toHaveAttribute('aria-valuenow', '3');
  expect(onSelect).toHaveBeenCalledWith(Math.max(0, Math.round((Date.parse(body.valid_times[3]) - anchor) / H)));
});

test('free: 3 daily buttons (today + 2), 11 locked days, one upgrade prompt, and the leftover-hours note', () => {
  const onUpgrade = jest.fn();
  render(<SpotForecastChart body={makeSeriesBody({ nowMs: NOW })} resolverHours={72} onUpgrade={onUpgrade} />);
  const days = screen.getAllByTestId('spot-chart-day');
  expect(days).toHaveLength(3);
  days.forEach((d) => expect(d.tagName).toBe('BUTTON'));
  expect(days[0]).toHaveAttribute('aria-label', expect.stringMatching(/^Wed 4 Nov: .* best (Very poor|Poor|Poor to Fair|Fair|Fair to Good|Good|Epic)/));
  expect(screen.getAllByTestId('spot-chart-locked-day')).toHaveLength(11);
  expect(screen.getAllByTestId('spot-chart-locked-day')[0]).toHaveAttribute('aria-label', 'Sat 7 Nov: locked on your plan');
  fireEvent.click(screen.getByTestId('spot-chart-upgrade'));
  expect(onUpgrade).toHaveBeenCalled();
  expect(screen.getByTestId('spot-chart-leftover')).toHaveTextContent('Hours after Fri through +72 h are in the hourly chart.');
});

test('a day button selects that day\'s best frame', () => {
  const onSelect = jest.fn();
  const body = makeSeriesBody({ nowMs: NOW });
  render(<SpotForecastChart body={body} resolverHours={72} onSelectOffset={onSelect} />);
  fireEvent.click(screen.getAllByTestId('spot-chart-day')[1]);
  expect(screen.getAllByTestId('spot-chart-day')[1]).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('spot-chart-readout')).toHaveTextContent(/^Thu /);
});

test('premium: 14 open days, nothing locked, no upgrade prompt; beyond +72 h the tide is labelled absent', () => {
  render(<SpotForecastChart body={makeSeriesBody({ nowMs: NOW, hours: 336, tier: 'premium' })} resolverHours={336} isPremium
    onUpgrade={() => {}} />);
  expect(screen.getAllByTestId('spot-chart-day')).toHaveLength(14);
  expect(screen.queryAllByTestId('spot-chart-locked-day')).toHaveLength(0);
  expect(screen.queryByTestId('spot-chart-upgrade')).toBeNull();
  expect(screen.getByTestId('spot-chart-no-tide')).toHaveTextContent('No tide forecast beyond here');
});

test('heights follow the ft / m preference', () => {
  localStorage.setItem('__RAW_HEIGHT_UNIT__', 'm');
  render(<SpotForecastChart body={makeSeriesBody({ nowMs: NOW })} resolverHours={72} />);
  expect(screen.getByTestId('spot-chart-readout')).toHaveTextContent(/\d\.\d m/);
});

test('the infobox chart: the slider over the next 72 h, with a text readout', () => {
  render(<SpotForecastMiniChart body={makeSeriesBody({ nowMs: NOW, hours: 336 })} resolverHours={72} />);
  expect(screen.getByRole('slider')).toHaveAttribute('aria-label', 'Surf forecast at this spot, next 72 hours');
  expect(screen.getByTestId('spot-mini-chart-readout')).toHaveTextContent(/\(UTC\u22128\) · \d.* ft · /);   // the spot's clock, named
});

// ── the panel: request, fallback, kill switch ─────────────────────────────────────────────────────────

test('the panel asks the proxy with the resolver\'s tier and model, then draws the chart', async () => {
  apiClient.get.mockResolvedValue({ data: makeSeriesBody({ nowMs: NOW }) });
  render(<SpotChartPanel spotId="abc" user={null} model="EURO" fallback={<p>old rows</p>} />);
  expect(screen.getByText('old rows')).toBeInTheDocument();      // while loading: the previous rows, never a blank card
  await screen.findByTestId('spot-forecast-chart');
  // a guest may not use EURO: the resolver's first model, the scrubber's
  expect(apiClient.get).toHaveBeenCalledWith('/weather/spot-series/abc', { params: { model: 'GFS', subscription_tier: 'guest' } });
  expect(screen.queryByText('old rows')).toBeNull();
});

test.each(['unpublished', 'disabled', 'spot_not_found'])('a 404 (%s) shows the previous rows', async (why) => {
  apiClient.get.mockRejectedValue({ response: { status: 404, data: { status: why } } });
  render(<SpotChartPanel spotId="abc" user={{ subscription_tier: 'premium' }} model="EURO" fallback={<p>old rows</p>} />);
  await screen.findByText('old rows');
  expect(apiClient.get).toHaveBeenCalledWith('/weather/spot-series/abc', { params: { model: 'EURO', subscription_tier: 'premium' } });
});

test('kill switch: no request at all and the previous rows, on the hub panel and the infobox', async () => {
  window.__RAW_DISABLE_SPOT_HUB_CHARTS__ = true;
  render(<><SpotChartPanel spotId="abc" user={null} model="GFS" fallback={<p>old rows</p>} />
    <SpotMiniChartPanel spotId="abc" user={null} model="GFS" /></>);
  expect(screen.getByText('old rows')).toBeInTheDocument();
  expect(screen.queryByTestId('spot-mini-chart')).toBeNull();
  await act(async () => {});
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('three surfaces open on one spot share one request', async () => {
  apiClient.get.mockResolvedValue({ data: makeSeriesBody({ nowMs: NOW }) });
  render(<><SpotChartPanel spotId="abc" user={null} model="GFS" /><SpotChartPanel spotId="abc" user={null} model="GFS" />
    <SpotMiniChartPanel spotId="abc" user={null} model="GFS" /></>);
  await waitFor(() => expect(screen.getAllByTestId('spot-forecast-chart')).toHaveLength(2));
  expect(screen.getByTestId('spot-mini-chart')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test('the infobox chart takes the palette of the glass it sits on (beach app, dark infobox glass)', () => {
  mockTheme = 'beach';
  render(<SpotForecastMiniChart body={makeSeriesBody({ nowMs: NOW })} resolverHours={72} hostTheme="dark" />);
  expect(screen.getByTestId('spot-mini-chart-readout').className).toMatch(/text-white/);
  expect(screen.getByTestId('spot-mini-chart-readout').className).not.toMatch(/amber/);
});

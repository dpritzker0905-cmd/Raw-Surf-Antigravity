import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import * as weatherClient from './backendWeatherServiceClient';

let mockTheme = 'dark';
const mockAnchor = Date.parse('2026-10-31T12:00:00Z');
const mockPayload = {
  available: true, events: [], source: 'model-msl',
  series: Array.from({ length: 72 }, (_, hour) => ({
    t: new Date(mockAnchor + hour * 3600000).toISOString(), h: hour / 10,
  })),
};
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../../hooks/useExactPointFetch', () => ({ useExactPointFetch: () => ({
  exactPoint: null, exactPointResponse: null, exactPointStatus: 'idle',
  setExactPointStatus: jest.fn(), setExactPointResponse: jest.fn(), setEstimateTrigger: jest.fn(),
}) }));
jest.mock('./usePointRating', () => ({ usePointRating: () => null }));
jest.mock('./marineDrawnFrame', () => ({ useMarineDrawnFrame: () => null }));
jest.mock('./usePointTide', () => ({ usePointTide: () => ({ status: 'ok', data: mockPayload }) }));
jest.mock('./heightUnits', () => ({ ...jest.requireActual('./heightUnits'), getHeightUnit: () => 'm' }));


// beforeEach runs after imports. Isolate the real resolver's startup request too,
// while retaining its real tier/window rules and every component under test.
const importRequests = [];
const { MapForecastOverlay } = (() => {
  const original = global.fetch;
  global.fetch = url => {
    importRequests.push(String(url));
    return Promise.reject(new Error('Offline UI test: capabilities not acquired'));
  };
  try { return require('./MapForecastOverlay'); }
  finally { global.fetch = original; }
})();
beforeAll(() => {
  expect(importRequests).toEqual([expect.stringMatching(/\/api\/weather\/capabilities$/)]);
});

const props = {
  activeLayer: 'waves', activeModel: 'GFS', currentWeather: {}, forecastData: null,
  marineData: null, longPressLocation: { lat: 28.34, lng: -80.58 }, timeOffsetHours: 0,
};
beforeEach(() => {
  jest.spyOn(weatherClient, 'getSeriesAnchorMs').mockReturnValue(mockAnchor);
});
afterEach(() => {
  jest.restoreAllMocks();
  delete window.__RAW_DISABLE_INFOBOX_TIDE__;
});

test.each(['light', 'dark', 'beach'])('%s overlay moves tide and its explicit UTC label with selection', theme => {
  mockTheme = theme;
  const { rerender } = render(<MapForecastOverlay {...props} />);
  expect(within(screen.getByRole('group', { name: 'Tide', exact: true })).getByText('0.0 m')).toBeInTheDocument();
  expect(screen.getByText(/^Tide at .*Oct 31, 2026.*12:00 PM UTC$/)).toBeInTheDocument();
  expect(screen.getByRole('group', { name: /^Tide at selected forecast time:/ })).toHaveAccessibleName(/Oct 31, 2026.*12:00 PM UTC/);
  const details = screen.getByRole('button', { name: 'Details Waves · m', exact: true });
  expect(details).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(details);
  expect(details).toHaveAttribute('aria-expanded', 'true');
  expect(document.getElementById(details.getAttribute('aria-controls'))).not.toHaveAttribute('inert');
  rerender(<MapForecastOverlay {...props} timeOffsetHours={24} />);
  expect(within(screen.getByRole('group', { name: 'Tide', exact: true })).getByText('2.4 m')).toBeInTheDocument();
  expect(screen.getByText(/^Tide at .*Nov 1, 2026.*12:00 PM UTC$/)).toBeInTheDocument();
  expect(screen.getByRole('group', { name: /^Tide at selected forecast time:/ })).toHaveAccessibleName(/Nov 1, 2026.*12:00 PM UTC/);
  expect(screen.queryByText('Tide now Â· not forecast hour')).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByTestId('forecast-overlay'), { key: 'Escape' });
  expect(details).toHaveAttribute('aria-expanded', 'false');
  expect(details).toHaveFocus();
  fireEvent.click(details);
  fireEvent.click(details);
  expect(details).toHaveAttribute('aria-expanded', 'false');
  expect(within(screen.getByRole('group', { name: 'Tide', exact: true })).getByText('2.4 m')).toBeInTheDocument();
});

test('selection outside acquired coverage shows unavailable instead of the current tide', () => {
  render(<MapForecastOverlay {...props} timeOffsetHours={336} />);
  expect(screen.getByTestId('tide-readout-unavailable')).toHaveTextContent('unavailable for selected time');
  expect(screen.queryByRole('group', { name: 'Tide', exact: true })).not.toBeInTheDocument();
});

test.each(['wind', 'pressure'])('%s keeps tide absent', activeLayer => {
  render(<MapForecastOverlay {...props} activeLayer={activeLayer} />);
  expect(screen.queryByRole('group', { name: 'Tide', exact: true })).not.toBeInTheDocument();
});

test('infobox tide kill switch still hides the entire selected-time block', () => {
  window.__RAW_DISABLE_INFOBOX_TIDE__ = true;
  render(<MapForecastOverlay {...props} />);
  expect(screen.queryByText(/^Tide at /)).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Tide', exact: true })).not.toBeInTheDocument();
});


test('a missing selected sample cannot become a zero tide reading', () => {
  const saved = mockPayload.series[1].h;
  const savedCoverage = mockPayload.coverage;
  mockPayload.series[1].h = null;
  try {
    const { rerender } = render(<MapForecastOverlay {...props} timeOffsetHours={1} />);
    expect(screen.getByTestId('tide-readout-unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Tide', exact: true })).not.toBeInTheDocument();
    mockPayload.series[1].h = saved;
    const iso = h => new Date(mockAnchor + h * 3600000).toISOString();
    mockPayload.coverage = [{ start: iso(0), end: iso(1) }, { start: iso(2), end: iso(3) }];
    for (const theme of ['light', 'dark', 'beach']) {
      mockTheme = theme;
      rerender(<MapForecastOverlay {...props} timeOffsetHours={1.5} />);
      expect(screen.getByTestId('tide-readout-unavailable')).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Tide', exact: true })).not.toBeInTheDocument();
      rerender(<MapForecastOverlay {...props} timeOffsetHours={0.5} />);
      expect(screen.getByRole('group', { name: 'Tide', exact: true })).toBeInTheDocument();
      expect(screen.getByTestId('tide-curve').querySelector('path').getAttribute('d').match(/M/g)).toHaveLength(2);
    }
  } finally {
    mockPayload.series[1].h = saved;
    if (savedCoverage === undefined) delete mockPayload.coverage;
    else mockPayload.coverage = savedCoverage;
  }
});

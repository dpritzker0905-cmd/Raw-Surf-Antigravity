/**
 * Wind terminal no-coverage recording (2026-07-10, audit queue #2 — wind analog of marine
 * d38a693b). A coverage 404 from the wind horizon gate (surfaced as `no_wind_coverage` by the
 * wind grid client) records (model,'wind',hour) in the shared terminal tracker so the settle
 * stops re-driving the doomed fetch; transient errors are NEVER recorded. The safe-zero
 * fallback grid now carries __failureReason for the hold-last-frame log.
 */
import { fetchWindData, _resetWindCachesForTest } from '../components/map/windController';
import {
  isTerminalNoCoverage,
  _resetTerminalNoCoverageForTest,
} from '../components/map/marineControllerCache';
import { fetchBackendWindGrid } from '../components/map/backendWindServiceClient';
import {
  getBackendWindFlag,
  clampViewportBbox,
  getSharedValidTime,
} from '../components/map/backendWeatherServiceClient';
import { getSnapConfig } from '../components/map/marineControllerUtils';

jest.mock('../components/map/backendWindServiceClient', () => ({
  fetchBackendWindGrid: jest.fn(),
}));

jest.mock('../components/map/backendWeatherServiceClient', () => ({
  getBackendWindFlag: jest.fn(),
  clampViewportBbox: jest.fn(),
  getSharedValidTime: jest.fn(),
}));

jest.mock('../components/map/marineControllerUtils', () => ({
  findClosestHourIndex: jest.fn(() => 0),
  HOURLY_CACHE_TTL: 600000,
  hydrateCache: jest.fn(),
  getSnapConfig: jest.fn(),
  isViewportInsideCachedBounds: jest.fn(() => false),
}));

jest.mock('../components/map/weatherTruthTracker', () => ({
  recordTruthStage: jest.fn(),
}));

const bounds = { west: -100, south: 20, east: -80, north: 40 };

describe('windController — terminal no-coverage recording', () => {
  beforeEach(() => {
    _resetWindCachesForTest();
    _resetTerminalNoCoverageForTest();
    // CRA jest runs with resetMocks:true — re-arm implementations each test.
    getBackendWindFlag.mockReturnValue(true);
    clampViewportBbox.mockReturnValue({ isInside: true, selectedTileId: 'global' });
    getSharedValidTime.mockReturnValue('2026-07-21T00:00:00Z');
    getSnapConfig.mockReturnValue({ snap: 5, padding: 0 });
  });

  it('records a terminal (model, wind, hour) on a coverage failure and stamps __failureReason', async () => {
    fetchBackendWindGrid.mockRejectedValue(new Error('no_wind_coverage'));

    const result = await fetchWindData(bounds, null, 272, false, 3, 'EURO');

    expect(result.renderable).toBe(false);
    expect(result.__failureReason).toBe('no_wind_coverage');
    expect(isTerminalNoCoverage('EURO', 'wind', 272)).toBe(true);
    // Other hours/models untouched; marine layers unaffected by the wind key.
    expect(isTerminalNoCoverage('EURO', 'wind', 200)).toBe(false);
    expect(isTerminalNoCoverage('GFS', 'wind', 272)).toBe(false);
    expect(isTerminalNoCoverage('EURO', 'waves', 272)).toBe(false);
  });

  it('NEVER records transient failures (5xx / fetch errors keep retrying)', async () => {
    fetchBackendWindGrid.mockRejectedValue(new Error('Backend returned HTTP 503'));

    const result = await fetchWindData(bounds, null, 120, false, 3, 'GFS');

    expect(result.renderable).toBe(false);
    expect(result.__failureReason).toBe('Backend returned HTTP 503');
    expect(isTerminalNoCoverage('GFS', 'wind', 120)).toBe(false);
  });

  it('a renderable result records nothing and returns clean', async () => {
    fetchBackendWindGrid.mockResolvedValue({
      vectors: [{ lat: 28, lng: -80, speed: 5, direction: 90, u: 1, v: 0 }],
      bounds, cols: 1, rows: 1, renderable: true, stale: false, nonzeroCount: 1,
    });

    const result = await fetchWindData(bounds, null, 24, false, 3, 'GFS');

    expect(result.renderable).toBe(true);
    expect(isTerminalNoCoverage('GFS', 'wind', 24)).toBe(false);
  });
});

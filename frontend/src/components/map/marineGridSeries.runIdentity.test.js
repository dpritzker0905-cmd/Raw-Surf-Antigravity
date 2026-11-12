/**
 * CLI-7 (Fable audit 2026-11-10): series pages are not keyed by model run.
 * Page keys are model, layer, flavour, viewport, page and anchor, with a 5-minute TTL. Pages fetched either side of an ingest
 * can hold two model cycles, so a scrub across the page boundary steps from the new run back to the old one (each frame's
 * provenance stays honest, but the map changes runs mid-scrub). Fix: when a page lands carrying a NEWER model cycle than a
 * sibling page of the same identity, the older sibling is evicted, so the next scrub into it fetches the current run.
 * Kill: window.__RAW_DISABLE_SERIES_RUN_EVICT__ = true.
 */
jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null, recordTruthStage: () => {} }));

import { ensureMarineSeries, getMarineSeriesFrame, marineSeriesPageForHour, _resetMarineSeriesForTest } from './marineGridSeries';

const BOX = { west: -81, east: -80, south: 28, north: 29 };
const OLD = '2026-11-10T00:00:00Z';
const NEW = '2026-11-10T06:00:00Z';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const HOUR_P1 = (() => { for (let h = 3; h < 400; h += 3) if (marineSeriesPageForHour(h, 'GFS') === 1) return h; return null; })();

function payload(hour, run) {
  return { frames: [{ hour_offset: hour, bounds: BOX, cols: 2, rows: 2, vectors: [{ lat: 28, lon: -81, height: 1.5, period: 10 }],
    source_dataset: 'fixture', valid_time: '2026-11-10T12:00:00Z', model_run_time: run, model_run_time_status: 'known' }] };
}

async function load(hour, run) {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => payload(hour, run) }));
  await ensureMarineSeries('GFS', 'waves', BOX, hour, undefined, true);
  await flush();
}

describe('CLI-7: a page from a newer run evicts older-run sibling pages', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    _resetMarineSeriesForTest();
    window.__MARINE_SERIES__ = true;
    window.__RAW_DISABLE_HOUR0_FIRST__ = true;
  });
  afterEach(() => {
    _resetMarineSeriesForTest(); jest.useRealTimers(); delete global.fetch;
    delete window.__MARINE_SERIES__; delete window.__RAW_DISABLE_HOUR0_FIRST__; delete window.__RAW_DISABLE_SERIES_RUN_EVICT__;
  });

  test('the fixture spans two pages', () => {
    expect(HOUR_P1).not.toBeNull();
    expect(marineSeriesPageForHour(0, 'GFS')).toBe(0);
  });

  test('page 0 from the old run, then page 1 from a newer run: page 0 no longer answers with the old run', async () => {
    await load(0, OLD);
    expect(getMarineSeriesFrame('GFS', 'waves', BOX, 0).model_run_time).toBe(OLD);
    await load(HOUR_P1, NEW);
    expect(getMarineSeriesFrame('GFS', 'waves', BOX, HOUR_P1).model_run_time).toBe(NEW);
    const p0 = getMarineSeriesFrame('GFS', 'waves', BOX, 0);
    expect(p0 === null || p0.model_run_time === NEW).toBe(true);   // never the old run beside a newer page
  });

  test('a page from an OLDER run never evicts a newer sibling', async () => {
    await load(0, NEW);
    await load(HOUR_P1, OLD);
    expect(getMarineSeriesFrame('GFS', 'waves', BOX, 0).model_run_time).toBe(NEW);
  });

  test('the same run on both pages keeps both (no churn)', async () => {
    await load(0, NEW);
    await load(HOUR_P1, NEW);
    expect(getMarineSeriesFrame('GFS', 'waves', BOX, 0).model_run_time).toBe(NEW);
  });

  test('kill switch: the pre-fix cache (both runs kept)', async () => {
    window.__RAW_DISABLE_SERIES_RUN_EVICT__ = true;
    await load(0, OLD);
    await load(HOUR_P1, NEW);
    expect(getMarineSeriesFrame('GFS', 'waves', BOX, 0).model_run_time).toBe(OLD);
  });
});

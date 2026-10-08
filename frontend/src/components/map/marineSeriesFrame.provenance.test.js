jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null }));
jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));

import { frameToMarineData } from './marineSeriesFrame';
import { ensureMarineSeries, getMarineSeriesFrame, _resetMarineSeriesForTest } from './marineGridSeries';

const vectors = [{ lat: 27.5, lng: -80.5, speed: 0, direction: 0, period: 8 }];
const basis = {
  type: 'anchored_trend_blend', target_valid_time: '2026-10-16T12:00:00Z',
  native_limit_hours: 240, weights: { persistence: 0, gfs: 0.8, icon: 0.2 }, confidence: 0,
  euro_anchor_product_id: 'euro_anchor', gfs_target_product_id: 'gfs_target',
};
const makeFrame = (extra = {}) => ({
  hour_offset: 288, vectors, cols: 1, rows: 1,
  bounds: { west: -81, south: 27, east: -80, north: 28 },
  valid_time: '2026-10-16T12:00:00Z', served_valid_time: '2026-10-16T12:00:00Z',
  product_id: 'stored_estimate_fixture', is_estimated: true, estimate_basis: basis,
  ...extra,
});

describe('series frame estimate identity without changing forecast values', () => {
  it.each(['GFS', 'ICON', 'EURO'])('%s retains the entire backend estimate explanation', model => {
    const result = frameToMarineData(makeFrame(), model, 'waves');
    expect(result.grid.is_estimated).toBe(true);
    expect(result.grid.estimate_basis).toEqual(basis);
    expect(result.isEstimated).toBe(true);
    expect(result.estimateBasis).toEqual(basis);
    expect(result.grid.vectors).toBe(vectors);
    expect(result.grid.__servedProductId).toBe('stored_estimate_fixture');
    expect(result.grid.served_valid_time).toBe('2026-10-16T12:00:00Z');
  });

  it('changing only blend weights changes metadata, never vectors or product identity', () => {
    const first = frameToMarineData(makeFrame(), 'EURO', 'waves');
    const other = { ...basis, weights: { persistence: 0.5, gfs: 0.5, icon: 0 } };
    const second = frameToMarineData(makeFrame({ estimate_basis: other }), 'EURO', 'waves');
    expect(first.grid.estimate_basis).not.toEqual(second.grid.estimate_basis);
    expect(first.grid.vectors).toBe(second.grid.vectors);
    expect(first.grid.__servedProductId).toBe(second.grid.__servedProductId);
    expect(first.product_id).toBe(second.product_id);
  });

  it.each([null, undefined])('missing estimate basis stays missing (%s), with no guessed blend', value => {
    const result = frameToMarineData(makeFrame({ estimate_basis: value }), 'EURO', 'waves');
    expect(result.grid.estimate_basis).toBeNull();
    expect(result.estimateBasis).toBeNull();
    expect(result.isEstimated).toBe(true);
  });

  it('explicit native classification is preserved even if source metadata contains zero weights', () => {
    const result = frameToMarineData(makeFrame({ is_estimated: false }), 'EURO', 'waves');
    expect(result.grid.is_estimated).toBe(false);
    expect(result.isEstimated).toBe(false);
    expect(result.grid.estimate_basis.confidence).toBe(0);
    expect(result.grid.estimate_basis.weights.persistence).toBe(0);
  });

  it('does not reuse the previous estimated frame basis for a native frame', () => {
    frameToMarineData(makeFrame(), 'EURO', 'waves');
    const result = frameToMarineData(makeFrame({ is_estimated: false, estimate_basis: undefined }), 'EURO', 'waves');
    expect(result.grid.estimate_basis).toBeNull();
    expect(result.isEstimated).toBe(false);
    expect(result.estimateBasis).toBeNull();
  });

  it('kill switch restores the former adapter metadata while retaining forecast values', () => {
    window.__RAW_DISABLE_SERIES_ESTIMATE_PROVENANCE__ = true;
    try {
      const result = frameToMarineData(makeFrame(), 'EURO', 'waves');
      expect(result.grid.estimate_basis).toBeUndefined();
      expect(result.estimateBasis).toBeUndefined();
      expect(result.isEstimated).toBeUndefined();
      expect(result.grid.is_estimated).toBe(true);
      expect(result.grid.vectors).toBe(vectors);
    } finally { delete window.__RAW_DISABLE_SERIES_ESTIMATE_PROVENANCE__; }
  });
});

describe('estimate provenance through the actual page and mini cache lanes', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    _resetMarineSeriesForTest();
    window.__MARINE_SERIES__ = true;
  });
  afterEach(() => {
    _resetMarineSeriesForTest();
    jest.useRealTimers();
    delete global.fetch;
    delete window.__RAW_DISABLE_HOUR0_FIRST__;
  });
  it.each([false, true])('cached estimate retains its explanation (mini=%s)', async mini => {
    window.__RAW_DISABLE_HOUR0_FIRST__ = !mini;
    global.fetch = jest.fn(async url => {
      const hours = new URL(url, 'https://example.invalid').searchParams.get('hours');
      return { ok: true, json: async () => ({ frames: mini && hours.includes(',') ? [] : [makeFrame({ warnings: ['HTTP 429'], fallbackReason: 'l2_read_refused', partial_coverage: true })] }) };
    });
    await ensureMarineSeries('EURO', 'waves', makeFrame().bounds, 288, new AbortController().signal, true);
    for (let i = 0; i < 24; i++) await Promise.resolve();
    const cached = getMarineSeriesFrame('EURO', 'waves', makeFrame().bounds, 288);
    expect(cached).not.toBeNull();
    expect(cached.grid.estimate_basis).toEqual(basis);
    expect(cached.estimateBasis).toEqual(basis);
    expect(cached.isEstimated).toBe(true);
    expect(cached.grid.vectors).toBe(vectors);
    expect(cached.grid.warnings).toEqual(['HTTP 429']);
    expect(cached.grid.fallbackReason).toBe('l2_read_refused');
    expect(cached.grid.partial_coverage).toBe(true);
  });
});


describe('series fallback receipts remain attached to their own frame', () => {
  it.each(['GFS', 'ICON', 'EURO'])('%s retains warnings and partial coverage on grid and wrapper', model => {
    const warnings = ['L2 read refused (HTTP 429); substitute tier served'];
    const frame = makeFrame({ warnings, fallbackReason: 'l2_read_refused', partial_coverage: true });
    const result = frameToMarineData(frame, model, 'waves');
    for (const receipt of [result, result.grid]) {
      expect(receipt.warnings).toEqual(warnings);
      expect(receipt.fallbackReason).toBe('l2_read_refused');
      expect(receipt.partial_coverage).toBe(true);
    }
    expect(result.grid.vectors).toBe(frame.vectors);
  });

  it('consumer warning edits do not mutate the cached source frame or another commit', () => {
    const frame = makeFrame({ warnings: ['upstream unavailable'], fallbackReason: 'l2_read_refused' });
    const first = frameToMarineData(frame, 'EURO', 'waves');
    const second = frameToMarineData(frame, 'EURO', 'waves');
    expect(first.grid.warnings).toEqual(frame.warnings);
    first.grid.warnings.push('consumer-only');
    expect(frame.warnings).toEqual(['upstream unavailable']);
    expect(second.grid.warnings).toEqual(['upstream unavailable']);
  });

  it('a clean native frame does not inherit the previous fallback receipt', () => {
    frameToMarineData(makeFrame({ warnings: ['HTTP 429'], fallbackReason: 'l2_read_refused', partial_coverage: true }), 'EURO', 'waves');
    const clean = frameToMarineData(makeFrame({ is_estimated: false }), 'EURO', 'waves');
    expect(clean.grid.warnings || []).toEqual([]);
    expect(clean.grid.fallbackReason || null).toBeNull();
    expect(clean.grid.partial_coverage || false).toBe(false);
  });
});

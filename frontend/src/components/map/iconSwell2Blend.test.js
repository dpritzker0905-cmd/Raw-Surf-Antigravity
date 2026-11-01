jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null, recordTruthStage: () => {} }));

import { blendIconSwell2, isIconSwell2Blend, ICON_SWELL2_BLEND_MAX_HOUR } from './iconSwell2Blend';
import { ensureMarineSeries, getMarineSeriesFrame, _resetMarineSeriesForTest } from './marineGridSeries';

const BOUNDS = { west: -90, east: -78, south: 22, north: 30 };
const cell = (lat, lng, speed, direction = 270, period = 9) => ({ lat, lng, speed, direction, period, is_valid: true });
const grid = (vectors, extra = {}) => ({ vectors, bounds: BOUNDS, cols: 2, rows: 2, ...extra });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

describe('blendIconSwell2 (the one place the ICON swell_2 math lives)', () => {
  test('both sources: 60/40 by origin, anchored on the fuller grid, labelled an estimate', () => {
    const gfs = grid([cell(24, -84, 1.0), cell(26, -84, 2.0)]);
    const euro = grid([cell(24, -84, 2.0)]);
    const md = blendIconSwell2(gfs, euro, 12, BOUNDS, { quiet: true });
    const g = md.grid;
    expect(g.vectors).toHaveLength(2);                       // anchored on GFS (more vectors)
    expect(g.estimate_basis).toMatchObject({ type: 'icon_swell_2_gfs_euro_blend', gfs_weight: 0.6, euro_weight: 0.4 });
    expect(g.vectors[0].speed).toBeCloseTo(0.6 * 1.0 + 0.4 * 2.0, 6);   // matched cell blends
    expect(g.vectors[1].speed).toBeCloseTo(2.0, 6);           // unmatched cell keeps its single source at full strength
    expect(g).toMatchObject({ __sourceModel: 'ICON', __componentLayer: 'swell_2', __gridProvider: 'gfs_euro_blend', is_estimated: true });
  });
  test('one source only: weight 1.0 on what exists', () => {
    const md = blendIconSwell2(grid([cell(24, -84, 1.5)]), null, 3, BOUNDS, { quiet: true });
    expect(md.grid.estimate_basis.gfs_weight).toBe(1);
    expect(md.grid.vectors[0].speed).toBeCloseTo(1.5, 6);
  });
  test('no source: honest unsupported, never an empty "ok"', () => {
    const md = blendIconSwell2(null, null, 3, BOUNDS, { quiet: true });
    expect(md).toMatchObject({ status: 'unsupported', __renderable: false });
  });
  test('blend window: ICON swell_2 to 240 h only', () => {
    expect(isIconSwell2Blend('ICON', 'swell_2', ICON_SWELL2_BLEND_MAX_HOUR)).toBe(true);
    expect(isIconSwell2Blend('ICON', 'swell_2', ICON_SWELL2_BLEND_MAX_HOUR + 1)).toBe(false);
    expect(isIconSwell2Blend('GFS', 'swell_2', 3)).toBe(false);
    expect(isIconSwell2Blend('ICON', 'waves', 3)).toBe(false);
  });
});

describe('ICON swell_2 is served from the GFS + EURO series caches (no per-hour network)', () => {
  const frames = (model) => ({ frames: [0, 3, 6].map(h => ({ hour_offset: h, bounds: BOUNDS, cols: 2, rows: 2,
    vectors: [cell(24, -84, model === 'GFS' ? 1 + h / 10 : 2 + h / 10), cell(26, -84, 1.2)],
    source_dataset: model === 'GFS' ? 'ncep_gfswave025' : 'cmems_mod_glo_wav_anfc_0.083deg_PT3H-i',
    valid_time: `2026-10-19T0${h}:00:00Z` })) });
  let requests;
  beforeEach(() => {
    jest.useFakeTimers();
    _resetMarineSeriesForTest();
    window.__MARINE_SERIES__ = true;
    window.__RAW_DISABLE_HOUR0_FIRST__ = true;
    requests = [];
    global.fetch = jest.fn(async (url) => {
      const u = new URL(url, 'https://fixture.invalid');
      requests.push(`${u.searchParams.get('model')}/${u.searchParams.get('layer')}`);
      const model = u.searchParams.get('model');
      return { ok: true, json: async () => (model === 'ICON' ? { frames: [] } : frames(model)) };
    });
  });
  afterEach(() => {
    _resetMarineSeriesForTest(); jest.useRealTimers(); delete global.fetch;
    delete window.__MARINE_SERIES__; delete window.__RAW_DISABLE_HOUR0_FIRST__;
    delete window.__RAW_DISABLE_ICON_SWELL2_SERIES_BLEND__;
  });

  test('ensure asks for GFS and EURO swell_2, never ICON swell_2 (which has no product)', async () => {
    await ensureMarineSeries('ICON', 'swell_2', BOUNDS, 3, undefined, true);
    await flush();
    expect(requests).toEqual(expect.arrayContaining(['GFS/swell_2', 'EURO/swell_2']));
    expect(requests).not.toContain('ICON/swell_2');
  });

  test('the series frame equals the per-hour blend of the same inputs, for every hour on the lattice', async () => {
    await ensureMarineSeries('ICON', 'swell_2', BOUNDS, 0, undefined, true);
    await flush();
    for (const h of [0, 3, 6]) {
      const md = getMarineSeriesFrame('ICON', 'swell_2', BOUNDS, h);
      const g = getMarineSeriesFrame('GFS', 'swell_2', BOUNDS, h);
      const e = getMarineSeriesFrame('EURO', 'swell_2', BOUNDS, h);
      const ref = blendIconSwell2(g.grid, e.grid, h, BOUNDS, { quiet: true });
      expect(md.hourOffset).toBe(h);
      expect(md.grid.vectors.map(v => v.speed)).toEqual(ref.grid.vectors.map(v => v.speed));
      expect(md.grid.vectors.map(v => v.direction)).toEqual(ref.grid.vectors.map(v => v.direction));
      expect(md.grid).toMatchObject({ __fromSeries: true, __sourceModel: 'ICON', __componentLayer: 'swell_2', is_estimated: true });
    }
    // Jacobian of the time mapping: one lattice step of the request moves the served frame one lattice step.
    const a = getMarineSeriesFrame('ICON', 'swell_2', BOUNDS, 3);
    const b = getMarineSeriesFrame('ICON', 'swell_2', BOUNDS, 6);
    expect((b.hourOffset - a.hourOffset) / (6 - 3)).toBe(1);
    expect(b.grid.vectors[0].speed).not.toBe(a.grid.vectors[0].speed);   // the field changes with the hour (not frozen)
  });

  test('a repeated lookup returns the memoized object (no re-blend per scrub step)', async () => {
    await ensureMarineSeries('ICON', 'swell_2', BOUNDS, 0, undefined, true);
    await flush();
    expect(getMarineSeriesFrame('ICON', 'swell_2', BOUNDS, 3)).toBe(getMarineSeriesFrame('ICON', 'swell_2', BOUNDS, 3));
  });

  test('EURO input missing: no series answer (the per-hour blend runs, as before)', async () => {
    await ensureMarineSeries('GFS', 'swell_2', BOUNDS, 0, undefined, true);
    await flush();
    expect(getMarineSeriesFrame('ICON', 'swell_2', BOUNDS, 3)).toBeNull();
  });

  test('kill switch restores the old behaviour (no series blend)', async () => {
    await ensureMarineSeries('ICON', 'swell_2', BOUNDS, 0, undefined, true);
    await flush();
    window.__RAW_DISABLE_ICON_SWELL2_SERIES_BLEND__ = true;
    expect(getMarineSeriesFrame('ICON', 'swell_2', BOUNDS, 3)).toBeNull();
  });
});

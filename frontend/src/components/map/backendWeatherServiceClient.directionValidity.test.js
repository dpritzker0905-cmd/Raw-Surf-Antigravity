import {
  blendDirection, blendSubVector, extrapolateSubVector, applySubContinuity,
  fetchBackendMarineGridIconExtended,
} from './backendWeatherServiceClientHelpers';
import { fetchBackendExactPoint, fetchBackendMarineGrid, pointCache, setCachedManifest } from './backendWeatherServiceClient';

const cell = (speed, direction = 0, isOcean = true) => ({ speed, height: speed, direction, period: 10,
  u: -speed * Math.sin(direction * Math.PI / 180), v: -speed * Math.cos(direction * Math.PI / 180), isOcean });
const refused = v => {
  expect(v.isOcean).toBe(false);
  expect(v.speed).toBe(0);
  expect(v.u).toBe(0);
  expect(v.v).toBe(0);
};
const epoch = Date.parse('2026-09-20T00:00:00Z');
let boundsId = 0;
const boundsForTest = () => ({ west: -82 + ++boundsId * 0.02, east: -80, south: 26, north: 28 });
const grid = (v, bounds) => ({ grid: { bounds, cols: 1, rows: 1, vectors: [{ lat: 27, lng: -81, ...v, waves: v }] } });

describe('marine direction identifiability', () => {
  test.each([[0, 180], [90, 270], [45, 225]])('opposed %s/%s has no stable bearing', (a, b) => {
    expect(blendDirection([1, 1], [a, b], [0.5, 0.5])).toBeNull();
  });
  test.each([null, undefined, NaN, Infinity, true, '90'])('active invalid bearing %s refuses', invalid => {
    expect(blendDirection([1, 1], [0, invalid], [0.5, 0.5])).toBeNull();
  });
  test.each([null, -1, Infinity, NaN, true, '1'])('active invalid height %s refuses', invalid => {
    expect(blendDirection([1, invalid], [0, 90], [0.5, 0.5])).toBeNull();
  });
  test('relative resultant threshold refuses near cancellation but keeps resolved imbalance', () => {
    const eps = Math.sqrt(Number.EPSILON);
    expect(blendDirection([1, 1], [0, 180], [0.5 + eps / 4, 0.5 - eps / 4])).toBeNull();
    expect(blendDirection([1, 1], [0, 180], [0.5 + eps, 0.5 - eps])).toBeCloseTo(0, 5);
  });
  test('north, wrap, normalized bearings, calm and inactive invalid sources remain valid', () => {
    expect(blendDirection([1, 1], [350, 10], [0.5, 0.5])).toBeCloseTo(0);
    expect(blendDirection([1], [720], [1])).toBe(0);
    expect(blendDirection([0, 0], [25, null], [0.5, 0.5])).toBe(25);
    expect(blendDirection([1, NaN], [0, null], [1, 0])).toBe(0);
    expect(blendDirection([1, 0], [0, null], [0.5, 0.5])).toBe(0);
    expect(blendDirection([1], [0], [Infinity])).toBeNull();
  });
  test('subvector and trend callers invalidate positive-height cancellation', () => {
    refused(blendSubVector(cell(2, 0), cell(3, 180), 0.6, 0.4));
    refused(extrapolateSubVector(cell(3, 0), cell(3, 0), cell(2, 180), 0.4, 0.6));
  });
  test('component-only near cancellation cannot be expanded to a full-height bearing', () => {
    const unresolved = { speed: 2, u: 1e-16, v: 0, period: 10, isOcean: true };
    refused(blendSubVector(unresolved, null, 1, 0));
  });
  test('explicit placeholder bearing cannot override cancelled components; direction-only input remains usable', () => {
    refused(blendSubVector({ ...cell(2, 0), u: 1e-16, v: 0 }, null, 1, 0));
    expect(blendSubVector({ speed: 2, direction: 10, period: 9 }, null, 1, 0))
      .toMatchObject({ speed: 2, direction: 10, isOcean: true });
  });
  test('masked secondary remains excluded while a valid single-source fallback survives', () => {
    const out = blendSubVector(cell(2, 0), cell(3, 180, false), 0.6, 0.4);
    expect(out.speed).toBe(2);
    expect(out.direction).toBe(0);
    expect(out.isOcean).toBe(true);
  });
  test('unused anchor bearing and zero-weight invalid source do not block healthy output', () => {
    const trend = extrapolateSubVector(cell(2, 0), cell(1, null), cell(2, 0), 0.4, 0.6);
    expect(trend.isOcean).toBe(true);
    expect(trend.speed).toBeCloseTo(2.6);
    const inactive = blendSubVector(cell(NaN, null), cell(2, 0), 0, 1);
    expect(inactive.isOcean).toBe(true);
    expect(inactive.speed).toBe(2);
  });
  test('calm remains available and continuity cannot resurrect a refused cell', () => {
    const calm = blendSubVector(cell(0, null), cell(0, null), 0.6, 0.4);
    expect(calm.speed).toBe(0);
    expect(calm.isOcean).toBe(true);
    const invalid = blendSubVector(cell(2, 0), cell(3, 180), 0.6, 0.4);
    refused(applySubContinuity(invalid, { dH: 4, dP: 2 }, 0.5));
  });
});

describe('actual ICON point and grid mirror callers', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    pointCache.clear();
    setCachedManifest({ products: [{ model: 'OTHER', domain: 'marine', layer: 'waves' }] });
    window.__MOCK_DATE_NOW__ = epoch;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete window.__MOCK_DATE_NOW__;
    jest.restoreAllMocks();
  });
  function mockPointProvider(kind, healthy = false) {
    global.fetch = jest.fn(async rawUrl => {
      const url = new URL(rawUrl, 'https://fixture.invalid');
      const model = url.searchParams.get('model');
      const at = (Date.parse(url.searchParams.get('valid_time')) - epoch) / 3600000;
      const value = kind === 'trend'
        ? ((model === 'ICON' || at === 168) ? cell(3, 0) : cell(2, healthy ? 0 : 180))
        : (model === 'GFS' ? cell(2, 0) : cell(3, healthy ? 0 : 180));
      return { ok: true, status: 200, json: async () => ({ point: { ...value, interpolation_method: 'bilinear_ocean_masked' } }) };
    });
  }
  test.each([['trend', 192], ['tail', 300]])('%s point refuses unresolved positive height', async (kind, hour) => {
    mockPointProvider(kind);
    await expect(fetchBackendExactPoint(27, -81, hour, undefined, 'waves', 'ICON')).rejects.toThrow(/direction/i);
    expect(global.fetch.mock.calls.some(([url]) => url.includes('model=ICON') && url.includes(new Date(epoch + hour * 3600000).toISOString()))).toBe(false);
  });
  test('secondary-swell point reports unsupported on direction cancellation', async () => {
    mockPointProvider('tail');
    const out = await fetchBackendExactPoint(27, -81, 24, undefined, 'swell_2', 'ICON');
    expect(out.status).toBe('unsupported');
    expect(out.hourly.secondary_swell_wave_height).toEqual([null]);
  });
  test.each([['trend', 192, 'waves'], ['tail', 300, 'waves'], ['tail', 24, 'swell_2']])('%s/%s healthy point remains available', async (kind, hour, layer) => {
    mockPointProvider(kind, true);
    const out = await fetchBackendExactPoint(27, -81, hour, undefined, layer, 'ICON');
    const prefix = layer === 'swell_2' ? 'secondary_swell_wave' : 'wave';
    expect(out.status).toBe('exact_success');
    expect(out.hourly[prefix + '_height'][0]).toBeCloseTo(2.4);
    expect(out.hourly[prefix + '_direction'][0]).toBe(0);
  });
  test('point trend retains a height-only GFS anchor but refuses a missing active target bearing', async () => {
    let missingTarget = false;
    global.fetch = jest.fn(async rawUrl => {
      const url = new URL(rawUrl, 'https://fixture.invalid');
      const model = url.searchParams.get('model');
      const at = (Date.parse(url.searchParams.get('valid_time')) - epoch) / 3600000;
      const direction = model === 'GFS' && (at === 168 || missingTarget) ? null : 0;
      return { ok: true, status: 200, json: async () => ({ point: { speed: 2, direction, period: 10 } }) };
    });
    const healthy = await fetchBackendExactPoint(27, -81, 192, undefined, 'waves', 'ICON');
    expect(healthy.hourly.wave_height[0]).toBe(2);
    expect(healthy.hourly.wave_direction[0]).toBe(0);
    pointCache.clear();
    missingTarget = true;
    await expect(fetchBackendExactPoint(27, -81, 192, undefined, 'waves', 'ICON')).rejects.toThrow(/direction/i);
  });
  test('point trend refuses a missing required height rather than manufacturing calm', async () => {
    global.fetch = jest.fn(async rawUrl => {
      const query = new URL(rawUrl, 'https://fixture.invalid').searchParams;
      const at = (Date.parse(query.get('valid_time')) - epoch) / 3600000;
      return { ok: true, status: 200, json: async () => ({ point: {
        speed: query.get('model') === 'GFS' && at === 192 ? null : 2, direction: 0, period: 10,
      } }) };
    });
    await expect(fetchBackendExactPoint(27, -81, 192, undefined, 'waves', 'ICON')).rejects.toThrow(/height/i);
  });
  test('point continuity cannot turn an unresolved positive blend into apparently valid calm', async () => {
    global.fetch = jest.fn(async rawUrl => {
      const query = new URL(rawUrl, 'https://fixture.invalid').searchParams;
      const at = (Date.parse(query.get('valid_time')) - epoch) / 3600000, model = query.get('model');
      const speed = at === 168 ? (model === 'ICON' ? 0 : 20) : at === 240 ? 6 : model === 'GFS' ? 2 : 3;
      const direction = at === 264 && model === 'EURO' ? 180 : 0;
      return { ok: true, status: 200, json: async () => ({ point: { speed, direction, period: 10 } }) };
    });
    await expect(fetchBackendExactPoint(27, -81, 264, undefined, 'waves', 'ICON')).rejects.toThrow(/direction/i);
  });
  test.each([192, 264, 300])('extended grid +%sh masks unresolved cells through continuity', async hour => {
    const bounds = boundsForTest();
    const fetchGrid = jest.fn(async (_bounds, at, _signal, _snapped, _layer, model) => {
      const value = hour === 192 ? ((model === 'ICON' || at === 168) ? cell(3, 0) : cell(2, 180))
        : (model === 'GFS' ? cell(2, 0) : cell(3, 180));
      return grid(value, bounds);
    });
    const out = await fetchBackendMarineGridIconExtended(bounds, hour, undefined, bounds, 'waves', fetchGrid);
    refused(out.grid.vectors[0]);
    refused(out.grid.vectors[0].waves);
    expect(out.grid.nonzeroCount).toBe(0);
  });
  test.each([192, 300])('extended grid +%sh preserves a healthy direction and magnitude', async hour => {
    const bounds = boundsForTest();
    const fetchGrid = async () => grid(cell(2, 0), bounds);
    const out = await fetchBackendMarineGridIconExtended(bounds, hour, undefined, bounds, 'waves', fetchGrid);
    expect(out.grid.vectors[0]).toMatchObject({ speed: 2, direction: 0, isOcean: true });
    expect(out.grid.nonzeroCount).toBe(1);
  });
  test.each(['cancel', 'unresolved_components', 'healthy', 'masked_secondary', 'masked_primary', 'zero_primary'])('public secondary-swell grid preserves %s policy', async kind => {
    const bounds = boundsForTest();
    setCachedManifest({ products: ['GFS', 'EURO'].map(model => ({ model, domain: 'marine', layer: 'swell_2',
      region_id: 'fixture', coverage: { west: -85, east: -79, south: 24, north: 31 },
      valid_time_start: '2026-09-21T00:00:00Z', valid_time_end: '2026-09-21T00:00:00Z' })) });
    global.fetch = jest.fn(async rawUrl => {
      const model = new URL(rawUrl, 'https://fixture.invalid').searchParams.get('model');
      const value = model === 'GFS' ? cell(kind === 'zero_primary' ? 0 : 2, 0, kind !== 'masked_primary')
        : cell(3, kind === 'healthy' ? 0 : kind === 'unresolved_components' ? 90 : 180, kind !== 'masked_secondary');
      if (kind === 'unresolved_components' && model === 'GFS') { value.u = 1e-16; value.v = 0; }
      return { ok: true, status: 200, json: async () => grid(value, bounds) };
    });
    const out = await fetchBackendMarineGrid(bounds, 24, undefined, bounds, 'swell_2', 'ICON');
    if (kind === 'cancel' || kind === 'unresolved_components') {
      refused(out.grid.vectors[0]);
      expect(out.grid.nonzeroCount).toBe(0);
    } else {
      const expected = kind === 'healthy' ? 2.4 : kind === 'masked_secondary' ? 2 : 3;
      expect(out.grid.vectors[0].speed).toBeCloseTo(expected);
      expect(out.grid.vectors[0].isOcean).toBe(true);
      expect(out.grid.nonzeroCount).toBe(1);
    }
  });
});

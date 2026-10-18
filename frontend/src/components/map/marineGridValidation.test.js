import fs from 'fs';
import path from 'path';
import { marineGridRejection } from './marineGridValidation';
import { hasUsableMarineVectors } from './iconEstimateDelivery';
import { fetchBackendMarineGridIconExtended } from './backendWeatherServiceClientHelpers';

const bounds = {west: -108, south: 14, east: -106, north: 16};
const layers = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
function frame(model, hour, layer = 'waves') {
  const component = {speed: 2 + hour / 100, height: 2 + hour / 100, u: -2, v: 0,
    period: 10, direction: 90, isOcean: true, is_valid: true};
  return {__sourceModel: model, hourOffset: hour, run_time: '2026-10-17T12:00:00Z',
    truthTag: {model, provider: 'open-meteo', valid_time: '2026-10-25T12:00:00Z'},
    grid: {cols: 1, rows: 1, bounds, hourOffset: hour, __sourceModel: model,
      __gridProvider: 'open-meteo', __componentLayer: layer, __renderable: true,
      vectors: [{lat: 15, lng: -107, ...component,
        ...Object.fromEntries(layers.map(l => [l, {...component}]))}]}};
}
const fetchFrame = async (_b, h, _s, _snap, layer, model) => frame(model, h, layer);
afterEach(() => { delete window.__RAW_DISABLE_ICON_FAR_HOUR_RENDER__; });

test('every literal renderable provider built by the client is admitted for ICON on every layer', () => {
  const files = ['backendWeatherServiceClient.js', 'backendWeatherServiceClientHelpers.js', 'iconEstimateDelivery.js'];
  const providers = new Set(files.flatMap(file => [...fs.readFileSync(path.join(__dirname, file), 'utf8')
    .matchAll(/__gridProvider:\s*(?:json\.provider\s*\|\|\s*)?['"]([^'"]+)['"]/g)].map(m => m[1])));
  // `none` is the deliberately non-renderable, missing-source sentinel, not a built forecast.
  providers.delete('none');
  expect([...providers]).toEqual(expect.arrayContaining(['gfs_trend', 'gfs_euro_blend']));
  for (const provider of providers) for (const layer of layers) {
    const data = frame('ICON', 192, layer);
    data.grid.__gridProvider = provider;
    expect({provider, layer, reason: marineGridRejection(data, 'ICON', layer)}).toEqual({provider, layer, reason: null});
  }
});

test.each(layers)('real trend builder passes the render gate at every hour 169–240 (%s)', async layer => {
  for (let hour = 169; hour <= 240; hour++) {
    const data = await fetchBackendMarineGridIconExtended(bounds, hour, undefined, bounds, layer, fetchFrame);
    expect(data.grid.__gridProvider).toBe('gfs_trend');
    expect(data.grid.hourOffset).toBe(hour);
    expect(marineGridRejection(data, 'ICON', layer)).toBeNull();
  }
});

test.each([false, true])('missing ICON anchor recovers stored ICON estimate; both anchors missing=%s', async both => {
  const b = {...bounds, west: both ? -110 : -112}; // independent anchor-cache keys
  const target = frame('ICON', 192);
  target.grid.__gridProvider = 'estimated';
  target.grid.is_estimated = true;
  target.grid.estimate_basis = {type: 'icon_persistence_gfs_blend', persistence_anchor_product_id: 'ICON-native'};
  const original = JSON.parse(JSON.stringify(target));
  const recovery = jest.fn();
  const data = await fetchBackendMarineGridIconExtended(b, 192, undefined, b, 'waves',
    async (_b, h, _s, _snap, layer, model, options) => {
      if (options?.storedIconRecovery) { recovery(model, h); return target; }
      if (h === 168 && (model === 'ICON' || both)) throw new Error('anchor unavailable');
      return frame(model, h, layer);
    });
  expect(marineGridRejection(data, 'ICON', 'waves')).toBeNull();
  expect(recovery).toHaveBeenCalledWith('ICON', 192);
  expect(data).toBe(target);
  expect(target).toEqual(original);
});

test('no ICON anchor and no stored estimate cannot deliver bare GFS', async () => {
  const b = {...bounds, west: -114};
  await expect(fetchBackendMarineGridIconExtended(b, 192, undefined, b, 'waves',
    async (_b, h, _s, _snap, layer, model) => {
      if (model === 'ICON') throw new Error('ICON unavailable');
      return frame('GFS', h, layer);
    })).rejects.toThrow('ICON unavailable');
});

test.each(['anchor', 'target', 'both', 'masked_target', 'nonfinite_target'])(
  'unusable GFS %s recovers stored ICON instead of uploading an unavailable trend', async defect => {
    const b = {...bounds, west: -140 - ['anchor', 'target', 'both', 'masked_target', 'nonfinite_target'].indexOf(defect)};
    const stored = frame('ICON', 192);
    stored.grid.__gridProvider = 'estimated';
    const recovery = jest.fn(() => stored);
    const result = await fetchBackendMarineGridIconExtended(b, 192, undefined, b, 'waves',
      async (_b, hour, _s, _snap, layer, model, options) => {
        if (options?.storedIconRecovery) return recovery(model, hour);
        if (model === 'GFS' && (defect === 'both' || (defect === 'anchor' && hour === 168)
            || (defect === 'target' && hour === 192))) throw new Error('GFS donor unavailable');
        const data = frame(model, hour, layer);
        if (model === 'GFS' && hour === 192) {
          if (defect === 'masked_target') data.grid.vectors[0].waves.isOcean = false;
          if (defect === 'nonfinite_target') data.grid.vectors[0].waves.speed = NaN;
        }
        return data;
      });
    expect(result).toBe(stored);
    expect(recovery).toHaveBeenCalledTimes(1);
    expect(recovery).toHaveBeenCalledWith('ICON', 192);
    expect(marineGridRejection(result, 'ICON', 'waves')).toBeNull();
  });

test('missing GFS donor and stored ICON cannot replace the resident with an unavailable trend', async () => {
  const b = {...bounds, west: -146};
  const recovery = jest.fn(() => { throw new Error('stored ICON unavailable'); });
  await expect(fetchBackendMarineGridIconExtended(b, 192, undefined, b, 'waves',
    async (_b, hour, _s, _snap, layer, model, options) => {
      if (options?.storedIconRecovery) return recovery();
      if (model === 'GFS' && hour === 192) throw new Error('GFS target unavailable');
      return frame(model, hour, layer);
    })).rejects.toThrow('stored ICON unavailable');
  expect(recovery).toHaveBeenCalledTimes(1);
});

test('disjoint donor masks recover stored ICON when no cell has common input support', async () => {
  const b = {...bounds, west: -147};
  const stored = frame('ICON', 192);
  stored.grid.__gridProvider = 'estimated';
  const recovery = jest.fn(() => stored);
  const result = await fetchBackendMarineGridIconExtended(b, 192, undefined, b, 'waves',
    async (_b, hour, _s, _snap, layer, model, options) => {
      if (options?.storedIconRecovery) return recovery();
      const data = frame(model, hour, layer);
      data.grid.vectors.push({...data.grid.vectors[0], lat: 16, waves: {...data.grid.vectors[0].waves}});
      if (model === 'GFS') data.grid.vectors[hour === 168 ? 1 : 0].waves.isOcean = false;
      return data;
    });
  expect(result).toBe(stored);
  expect(recovery).toHaveBeenCalledTimes(1);
});

test.each(['calm', 'partial'])('%s usable trend support does not trigger stored recovery', async support => {
  const b = {...bounds, west: support === 'calm' ? -148 : -149};
  const recovery = jest.fn();
  const result = await fetchBackendMarineGridIconExtended(b, 192, undefined, b, 'waves',
    async (_b, hour, _s, _snap, layer, model, options) => {
      if (options?.storedIconRecovery) return recovery();
      const data = frame(model, hour, layer);
      if (support === 'calm') {
        for (const component of [data.grid.vectors[0], ...layers.map(l => data.grid.vectors[0][l])]) {
          Object.assign(component, {speed: 0, height: 0, u: 0, v: 0});
        }
      } else {
        data.grid.vectors.push({...data.grid.vectors[0], isOcean: false});
      }
      return data;
    });
  expect(recovery).not.toHaveBeenCalled();
  expect(result.grid.__gridProvider).toBe('gfs_trend');
  expect(hasUsableMarineVectors(result.grid.vectors)).toBe(true);
  if (support === 'calm') expect(result.grid.vectors[0].speed).toBe(0);
});

test('kill switch restores both previous rejection paths and preserves native/tail delivery', async () => {
  window.__RAW_DISABLE_ICON_FAR_HOUR_RENDER__ = true;
  const trend = await fetchBackendMarineGridIconExtended(bounds, 192, undefined, bounds, 'waves', fetchFrame);
  expect(marineGridRejection(trend, 'ICON', 'waves')).toBe('provider_not_whitelisted');
  const gfs = frame('GFS', 192);
  expect(marineGridRejection(gfs, 'ICON', 'waves')).toBe('model_mismatch');
  expect(marineGridRejection(frame('ICON', 168), 'ICON', 'waves')).toBeNull();
  const tail = await fetchBackendMarineGridIconExtended(bounds, 288, undefined, bounds, 'waves', fetchFrame);
  expect(marineGridRejection(tail, 'ICON', 'waves')).toBeNull();
});

test.each(['gfs_trend', 'gfs_euro_blend', 'estimated', 'backend-weather-service', 'test-fixture'])(
  '%s cannot bypass component or model checks', provider => {
    const data = frame('ICON', 192, 'swell_1');
    data.grid.__gridProvider = provider;
    expect(marineGridRejection(data, 'ICON', 'waves')).toBe('component_layer_mismatch');
    data.__sourceModel = 'GFS';
    expect(marineGridRejection(data, 'ICON', 'swell_1')).toBe('model_mismatch');
  });

test.each(['GFS', 'ICON', 'EURO'])('%s still rejects unknown providers', model => {
  const data = frame(model, 192);
  data.grid.__gridProvider = 'unrecognized';
  expect(marineGridRejection(data, model, 'waves')).toBe('provider_not_whitelisted');
});

test.each(['GFS', 'EURO'])('%s cannot admit ICON trend delivery', model => {
  const data = frame(model, 192);
  data.grid.__gridProvider = 'gfs_trend';
  expect(marineGridRejection(data, model, 'waves')).toBe('provider_not_whitelisted');
});

test('an ICON wrapper cannot hide a GFS grid from the model guard', () => {
  const data = frame('GFS', 192);
  data.__sourceModel = 'ICON';
  expect(marineGridRejection(data, 'ICON', 'waves')).toBe('model_mismatch');
});

test.each(['invalid', 'nonfinite', 'masked'])('an all-%s ICON anchor recovers the existing stored estimate once', async defect => {
  const b = {...bounds, west: {invalid: -120, nonfinite: -122, masked: -124}[defect]};
  const calls = [];
  const stored = frame('ICON', 192);
  stored.grid.__gridProvider = 'estimated';
  const result = await fetchBackendMarineGridIconExtended(b, 192, undefined, b, 'waves',
    async (_b, hour, _s, _snap, layer, model, options) => {
      if (options?.storedIconRecovery) { calls.push({model, hour}); return stored; }
      const value = frame(model, hour, layer);
      if (model === 'ICON') {
        if (defect === 'invalid') value.grid.vectors[0].is_valid = false;
        if (defect === 'nonfinite') value.grid.vectors[0].speed = NaN;
        if (defect === 'masked') value.grid.vectors[0].isOcean = false;
      }
      return value;
    });
  expect(result).toBe(stored);
  expect(calls).toEqual([{model: 'ICON', hour: 192}]);
});

test('usable support admits calm water, rejects null/negative/nonfinite vectors', () => {
  const calm = {speed: 0, u: 0, v: 0, is_valid: true};
  expect(hasUsableMarineVectors([null, calm])).toBe(true);
  expect(hasUsableMarineVectors([null, {...calm, speed: -1}, {...calm, u: NaN}])).toBe(false);
});

test.each(['error', 'signal'])('abort by %s propagates without starting stored recovery', async mode => {
  const b = {...bounds, west: mode === 'error' ? -126 : -128};
  const controller = new AbortController();
  const recovery = jest.fn();
  await expect(fetchBackendMarineGridIconExtended(b, 192, controller.signal, b, 'waves',
    async (_b, hour, _s, _snap, layer, model, options) => {
      if (options?.storedIconRecovery) recovery();
      if (model === 'ICON') {
        if (mode === 'signal') controller.abort();
        const error = new Error('cancelled'); error.name = 'AbortError'; throw error;
      }
      return frame(model, hour, layer);
    })).rejects.toMatchObject({name: 'AbortError'});
  expect(recovery).not.toHaveBeenCalled();
});

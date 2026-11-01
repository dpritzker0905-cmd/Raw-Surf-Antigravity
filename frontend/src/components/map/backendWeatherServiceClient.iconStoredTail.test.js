
jest.mock('../../lib/apiClient', () => ({ BACKEND_URL: 'https://backend.example.invalid' }));
jest.mock('./backendWeatherServiceClientTrace', () => ({}));
const BASE = Date.parse('2026-10-04T00:00:00Z');
const bounds = {west: -86, south: 23, east: -72, north: 34};
let client, requests, mode;
function frame(model, layer, hour) {
  const height = model === 'ICON' ? (hour <= 168 ? 2 : 4) : 3;
  const component = {speed: height, height, period: 11, direction: 90, u: height, v: 0, is_valid: true};
  const time = new Date(BASE + hour * 3600000).toISOString();
  return {
    model, layer, domain: 'marine', provider: hour > 168 ? 'estimated' : 'native',
    source_dataset: 'fixture_dataset', value_kind: 'wave_height', value_unit: 'm',
    product_id: model + '_' + layer + '_fixture_' + hour, run_time: '2026-10-04T00:00:00Z',
    valid_time: time, served_valid_time: time, is_estimated: hour > 168,
    estimate_basis: {type: 'stored_estimate_fixture', target_valid_time: time},
    grid: {cols: 1, rows: 1, bounds, vectors: mode === 'empty' && model === 'ICON' && hour > 168 ? [] :
      [{lat: 28, lng: -80, ...component, waves: {...component}, swell_1: {...component},
        swell_2: {...component}, wind_waves: {...component}}]}
  };
}
beforeEach(() => {
  process.env.REACT_APP_ICON_STORED_TAIL = 'true';
  jest.resetModules();
  jest.useFakeTimers('modern'); jest.setSystemTime(BASE);
  requests = []; mode = 'normal';
  global.fetch = jest.fn(async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/products')) return {ok: true, status: 200, json: async () => ({products: []})};
    const model = parsed.searchParams.get('model'), layer = parsed.searchParams.get('layer');
    const hour = (Date.parse(parsed.searchParams.get('valid_time')) - BASE) / 3600000;
    requests.push({model, layer, hour});
    if (mode.startsWith('error') && model === 'ICON' && hour > 168) {
      return {ok: false, status: Number(mode.slice(5)), json: async () => ({detail: 'stored_product_unavailable'})};
    }
    return {ok: true, status: 200, json: async () => frame(model, layer, hour)};
  });
  client = require('./backendWeatherServiceClient');
  client.setCachedManifest(null);
});
afterEach(() => {jest.useRealTimers(); delete global.fetch; delete process.env.REACT_APP_ICON_STORED_TAIL;});
describe.each(['waves', 'swell_1', 'wind_waves'])('stored ICON %s source', (layer) => {
  test.each([179, 240, 241, 336])('hour %s preserves stored values and identity with one grid request', async (hour) => {
    const result = await client.fetchBackendMarineGrid(bounds, hour, undefined, bounds, layer, 'ICON');
    expect(requests).toEqual([{model: 'ICON', layer, hour}]);
    expect(result.grid.vectors[0].speed).toBe(4);
    expect(result.grid.productId).toBe('ICON_' + layer + '_fixture_' + hour);
    expect(result.run_time).toBe('2026-10-04T00:00:00Z');
    expect(result.served_valid_time).toBe(new Date(BASE + hour * 3600000).toISOString());
    expect(result.grid.is_estimated).toBe(true);
    expect(result.grid.estimate_basis.type).toBe('stored_estimate_fixture');
  });
  test('native-hour control keeps existing field', async () => {
    const result = await client.fetchBackendMarineGrid(bounds, 0, undefined, bounds, layer, 'ICON');
    expect(requests).toEqual([{model: 'ICON', layer, hour: 0}]);
    expect(result.grid.vectors[0].speed).toBe(2);
    expect(result.grid.is_estimated).toBe(false);
  });
  test('missing stored field cannot manufacture a tail', async () => {
    mode = 'empty';
    const result = await client.fetchBackendMarineGrid(bounds, 179, undefined, bounds, layer, 'ICON');
    expect(result.grid.vectors).toEqual([]);
    expect(result.grid.__renderable).toBe(false);
    expect(requests).toEqual([{model: 'ICON', layer, hour: 179}]);
  });
});
test.each([404, 503])('stored failure %s cannot be replaced with other models', async (status) => {
  mode = 'error' + status;
  await expect(client.fetchBackendMarineGrid(bounds, 179, undefined, bounds, 'waves', 'ICON')).rejects.toThrow();
  expect(requests).toEqual([{model: 'ICON', layer: 'waves', hour: 179}]);
});
test('secondary swell control retains its separately disclosed blend', async () => {
  const result = await client.fetchBackendMarineGrid(bounds, 179, undefined, bounds, 'swell_2', 'ICON');
  expect(requests.map(r => r.model).sort()).toEqual(['EURO', 'GFS']);
  expect(result.grid.is_estimated).toBe(true);
  expect(result.grid.estimate_basis.type).toBe('icon_swell_2_gfs_euro_blend');
});

test.each([undefined, 'false', '1', 'TRUE'])('default/invalid flag %s leaves served values unchanged', async (flag) => {
  if (flag === undefined) delete process.env.REACT_APP_ICON_STORED_TAIL;
  else process.env.REACT_APP_ICON_STORED_TAIL = flag;
  const result = await client.fetchBackendMarineGrid(bounds, 179, undefined, bounds, 'waves', 'ICON');
  expect(requests).toEqual([
    {model: 'ICON', layer: 'waves', hour: 168},
    {model: 'GFS', layer: 'waves', hour: 168},
    {model: 'GFS', layer: 'waves', hour: 179}
  ]);
  expect(result.grid.vectors[0].speed).toBe(2);
  expect(result.grid.estimate_basis.type).toBe('icon_trend_extrapolation');
});

test.each(['waves', 'swell_1', 'wind_waves'])('missing native anchor recovers the existing stored %s estimate', async layer => {
  process.env.REACT_APP_ICON_STORED_TAIL = 'false';
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async url => {
    const parsed = new URL(url);
    const model = parsed.searchParams.get('model');
    const hour = (Date.parse(parsed.searchParams.get('valid_time')) - BASE) / 3600000;
    if (model === 'ICON' && hour === 168) return {ok: false, status: 503, json: async () => ({})};
    if (model === 'ICON' && hour === 179) {
      requests.push({model, layer, hour});
      const data = frame(model, layer, hour);
      data.is_forecast_authoritative = false;
      data.estimate_basis = {type: 'icon_persistence_gfs_blend',
        persistence_anchor_product_id: 'ICON-native-168', persistence_anchor_valid_time: new Date(BASE + 168 * 3600000).toISOString(),
        target_valid_time: data.valid_time};
      return {ok: true, status: 200, json: async () => data};
    }
    return originalFetch(url);
  });
  const result = await client.fetchBackendMarineGrid(bounds, 179, undefined, bounds, layer, 'ICON');
  expect(result.grid.__sourceModel).toBe('ICON');
  expect(result.grid.__gridProvider).toBe('estimated');
  expect(result.grid.estimate_basis.persistence_anchor_product_id).toBe('ICON-native-168');
  expect(result.grid.productId).toBe('ICON_' + layer + '_fixture_179');
  expect(result.grid.vectors[0].speed).toBe(4); // stored estimate; GFS target in this fixture is 3
  expect(requests.at(-1)).toEqual({model: 'ICON', layer, hour: 179});
});

test.each(['model', 'layer', 'anchor', 'anchor_time', 'target', 'served_time', 'authoritative', 'estimated', 'vectors', 'invalid_vectors'])(
  'stored recovery refuses invalid %s provenance instead of substituting GFS', async defect => {
    const data = frame('ICON', 'waves', 179);
    data.is_forecast_authoritative = false;
    data.estimate_basis = {type: 'icon_persistence_gfs_blend', persistence_anchor_product_id: 'ICON-native',
      persistence_anchor_valid_time: new Date(BASE + 168 * 3600000).toISOString(), target_valid_time: data.valid_time};
    if (defect === 'model') data.model = 'GFS';
    if (defect === 'layer') data.layer = 'swell_1';
    if (defect === 'anchor') delete data.estimate_basis.persistence_anchor_product_id;
    if (defect === 'anchor_time') data.estimate_basis.persistence_anchor_valid_time = 'unknown';
    if (defect === 'target') data.estimate_basis.target_valid_time = new Date(BASE).toISOString();
    if (defect === 'served_time') data.served_valid_time = new Date(BASE).toISOString();
    if (defect === 'authoritative') data.is_forecast_authoritative = true;
    if (defect === 'estimated') data.is_estimated = false;
    if (defect === 'vectors') data.grid.vectors = [];
    if (defect === 'invalid_vectors') data.grid.vectors[0].is_valid = false;
    global.fetch = jest.fn(async () => ({ok: true, status: 200, json: async () => data}));
    await expect(client.fetchBackendMarineGrid(bounds, 179, undefined, bounds, 'waves', 'ICON',
      {storedIconRecovery: true})).rejects.toThrow('refusing model substitution');
  });

test('failed stored recovery is single-shot even with the normal stored-tail flag off', async () => {
  process.env.REACT_APP_ICON_STORED_TAIL = 'false';
  mode = 'error503';
  await expect(client.fetchBackendMarineGrid(bounds, 179, undefined, bounds, 'waves', 'ICON',
    {storedIconRecovery: true})).rejects.toThrow('stored_product_unavailable');
  expect(requests).toEqual([{model: 'ICON', layer: 'waves', hour: 179}]);
});

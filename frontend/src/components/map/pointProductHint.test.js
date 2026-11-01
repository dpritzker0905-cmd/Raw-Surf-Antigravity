/**
 * D4 (the lead's offline erratic fuzzer, 2026-10-27; repro/min-infobox-model.json, seed 980): GFS Waves at the Atlantic z3,
 * /grid slowed, click EURO, right-click the sea 150 ms later. The app asked
 * /point?model=EURO&grid_product_id=gfs_marine_waves_global_mid_…, the backend answered model GFS 1.1309 m, and the card read
 * "EURO Forecast … 3.7 ft" (EURO's own: 1.1987 m, 3.9 ft). Replayed offline against the real point clients with fetch stubbed
 * to answer exactly as that backend did; the kill switch prints the live reading.
 */
import { productIdentity, gridHintsFor, hintIsForeign, refuseForeignReply } from './pointProductHint';
import { fetchBackendExactPoint } from './backendWeatherServiceClientPoint';
import { fetchBackendExactCopernicusPoint } from './backendCopernicusServiceClient';
import { pointCache } from './backendWeatherServiceClient';

const GFS_ID = 'gfs_marine_waves_global_mid_20261027T120000Z.json';
const EURO_ID = 'euro_marine_waves_global_mid_20261027T120000Z.json';
const reply = (model, speed, productId) => ({
  model, provider: model === 'EURO' ? 'copernicus' : 'open-meteo', product_id: productId, valid_time: '2026-10-27T12:00:00Z',
  status: 'exact_success', is_estimated: false,
  point: { speed, direction: 270, period: 11, sampled_lat: 30, sampled_lng: -40, interpolation_method: 'bilinear' },
});
// The fuzzer's backend: it samples whatever product the ask names, else the asked model's own.
function stubBackend() {
  const asks = [];
  global.fetch = jest.fn(async (url) => {
    if (!/\/point\?/.test(String(url))) return { ok: false, status: 404, json: async () => ({}) };   // the manifest refresh
    const q = new URL(url, 'http://x').searchParams;
    asks.push(Object.fromEntries(q));
    const pid = q.get('grid_product_id');
    const body = pid && pid.startsWith('gfs_') ? reply('GFS', 1.1309, pid) : reply(q.get('model'), q.get('model') === 'EURO' ? 1.1987 : 1.1309, pid);
    return { ok: true, status: 200, json: async () => body };
  });
  return asks;
}
const ftOf = (p) => (p.hourly.wave_height[0] * 3.28084).toFixed(1);

beforeEach(() => {
  window.__USE_BACKEND_MARINE_SYSTEM__ = true;
  pointCache.clear && pointCache.clear();
});
afterEach(() => {
  delete global.fetch;
  delete window.__RAW_DISABLE_POINT_MODEL_GUARD__;
  delete window.__RAW_POINT_MODEL_GUARD__;
  delete window.__MARINE_PROJECTION_DIAG__;
  delete window.__USE_BACKEND_MARINE_SYSTEM__;
});

describe('the product an id names', () => {
  test('reads model, domain and layer from the store\'s id form (viewport and wind_waves included)', () => {
    expect(productIdentity(GFS_ID)).toEqual({ model: 'GFS', domain: 'marine', layer: 'waves' });
    expect(productIdentity('viewport_icon_marine_waves_20261028T090000Z_-74.00_26.00.json')).toEqual({ model: 'ICON', domain: 'marine', layer: 'waves' });
    expect(productIdentity('gfs_marine_swell_2_us_west_coast_socal_20261027T120000Z.json').layer).toBe('swell_2');
    expect(productIdentity('euro_marine_wind_waves_florida_east_coast_x.json')).toEqual({ model: 'EURO', domain: 'marine', layer: 'wind_waves' });
    expect(productIdentity('some-other-id')).toBeNull();
  });

  test('a hint is foreign by its id or by its grid; an unknown id from a matching grid is kept', () => {
    expect(hintIsForeign(GFS_ID, 'EURO', 'waves')).toBe(true);
    expect(hintIsForeign('gfs_marine_swell_2_socal_x.json', 'GFS', 'waves')).toBe(true);    // the SoCal swell_2 sighting
    expect(hintIsForeign(EURO_ID, 'EURO', 'waves')).toBe(false);
    expect(hintIsForeign('opaque', 'EURO', 'waves', { __sourceModel: 'GFS' })).toBe(true);
    expect(hintIsForeign('opaque', 'EURO', 'waves', { __sourceModel: 'EURO', __componentLayer: 'waves' })).toBe(false);
  });

  test('gridHintsFor: the mid-switch GFS grid lends nothing to a EURO ask; the EURO grid lends id and box', () => {
    const gfsGrid = { productId: GFS_ID, __sourceModel: 'GFS', __componentLayer: 'waves', bounds: { west: -60, south: 20, east: -20, north: 40 } };
    expect(gridHintsFor(gfsGrid, 'EURO', 'waves')).toEqual({ productId: null, bbox: null });
    expect(window.__RAW_POINT_MODEL_GUARD__.hint_dropped).toBe(1);
    expect(gridHintsFor({ ...gfsGrid, productId: EURO_ID, __sourceModel: 'EURO' }, 'EURO', 'waves'))
      .toEqual({ productId: EURO_ID, bbox: '-60,20,-20,40' });
    window.__RAW_DISABLE_POINT_MODEL_GUARD__ = true;
    expect(gridHintsFor(gfsGrid, 'EURO', 'waves').productId).toBe(GFS_ID);                   // kill: the live behaviour
  });

  test('a reply naming another model is refused (thrown), the same model passes', () => {
    expect(() => refuseForeignReply({ model: 'GFS' }, 'EURO', 'waves')).toThrow(/point_model_mismatch: asked EURO waves, answered GFS/);
    expect(() => refuseForeignReply({ model: 'euro' }, 'EURO', 'waves')).not.toThrow();
    expect(() => refuseForeignReply({}, 'EURO', 'waves')).not.toThrow();
  });
});

describe('the repro through the real point clients', () => {
  test('EURO ask with the GFS grid\'s id: the id is not sent and the card reads EURO\'s own 3.9 ft (live: GFS\'s 3.7 ft)', async () => {
    const asks = stubBackend();
    const p = await fetchBackendExactCopernicusPoint(30, -40, 0, null, 'waves', GFS_ID, '-60,20,-20,40');
    expect(asks[0].model).toBe('EURO');
    expect(asks[0].grid_product_id).toBeUndefined();
    expect(asks[0].grid_bbox).toBeUndefined();
    expect(p.requestedModel).toBe('EURO');
    expect(ftOf(p)).toBe('3.9');
  });

  test('kill switch: the GFS id goes out and the GFS answer is mapped as EURO, 3.7 ft (the fuzzer\'s card)', async () => {
    window.__RAW_DISABLE_POINT_MODEL_GUARD__ = true;
    const asks = stubBackend();
    const p = await fetchBackendExactCopernicusPoint(30, -40, 0, null, 'waves', GFS_ID, '-60,20,-20,40');
    expect(asks[0].grid_product_id).toBe(GFS_ID);
    expect(p.requestedModel).toBe('EURO');
    expect(ftOf(p)).toBe('3.7');
  });

  test('a stale GFS projection diag is not borrowed by the EURO client either', async () => {
    window.__MARINE_PROJECTION_DIAG__ = { activeModel: 'GFS', activeLayer: 'waves', productId: GFS_ID, requested_bbox: '-60,20,-20,40' };
    const asks = stubBackend();
    await fetchBackendExactCopernicusPoint(32, -40, 0, null, 'waves');
    expect(asks[0].grid_product_id).toBeUndefined();
  });

  test('defence in depth: a backend that still answers GFS to a EURO ask is refused, never cached', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => reply('GFS', 1.1309, GFS_ID) }));
    await expect(fetchBackendExactCopernicusPoint(33, -40, 0, null, 'waves')).rejects.toThrow(/point_model_mismatch/);
    await expect(fetchBackendExactPoint(34, -40, 0, null, 'waves', 'ICON')).rejects.toThrow(/answered GFS/);
    expect(window.__RAW_POINT_MODEL_GUARD__.reply_refused).toBe(2);
  });

  test('GFS/ICON client: an ICON ask drops a GFS id (the ICON past-168 children forwarded theirs the same way)', async () => {
    const asks = stubBackend();
    await fetchBackendExactPoint(35, -40, 0, null, 'waves', 'ICON', GFS_ID, '-60,20,-20,40');
    expect(asks[0].model).toBe('ICON');
    expect(asks[0].grid_product_id).toBeUndefined();
    await fetchBackendExactPoint(36, -40, 0, null, 'waves', 'GFS', GFS_ID, '-60,20,-20,40');
    expect(asks[1].grid_product_id).toBe(GFS_ID);                                            // its own product still goes
  });
});

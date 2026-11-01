/**
 * INFOBOX P1-B (owner 2026-11-01, DARK): past ICON hour 168 the point card reads the backend's STORED estimate (the one the heat
 * map draws, D-055) instead of blending its own anchor fetches in the browser. The real point client against a stub backend that
 * answers like serve_synthetic.py: ICON past 168 from a stored `icon_persistence_gfs_blend` product, with the surf chain.
 */
import { fetchBackendExactPoint } from './backendWeatherServiceClientPoint';
import { iconPointStoredTailEnabled } from './iconEstimateDelivery';
import { pointCache } from './backendWeatherServiceClient';

const H = 3600000;
const NOW = Date.parse('2026-11-01T21:00:00Z');
const ENV = ['REACT_APP_ICON_POINT_STORED_TAIL', 'REACT_APP_ICON_STORED_TAIL'];
const saved = {};
let asks;
// GFS at 168 and at the hour, ICON native at 168, ICON's stored estimate past 168 (a different number from the browser blend).
const HEIGHT = { 'GFS@168': 1.0, 'GFS@200': 1.6, 'GFS@240': 1.8, 'GFS@250': 2.0, 'EURO@240': 1.7, 'EURO@250': 1.9, 'ICON@168': 1.2, 'ICON@250': 1.55 };
function stub() {
  asks = [];
  global.fetch = jest.fn(async (url) => {
    if (!/\/point\?/.test(String(url))) return { ok: false, status: 404, json: async () => ({}) };
    const q = new URL(url, 'http://x').searchParams;
    const hour = Math.round((Date.parse(q.get('valid_time')) - NOW) / H);
    const model = q.get('model');
    asks.push(`${model}@${hour}`);
    const stored = model === 'ICON' && hour > 168;
    return { ok: true, status: 200, json: async () => ({
      model, provider: stored ? 'estimated' : 'open-meteo', valid_time: q.get('valid_time'), served_valid_time: q.get('valid_time'),
      product_id: `${model.toLowerCase()}_marine_waves_global_mid_x.json`, status: 'exact_success',
      is_estimated: stored, estimate_basis: stored ? { type: 'icon_persistence_gfs_blend', native_limit_hours: 168 } : null,
      surf_height_m: stored ? 2.1 : null, surf_regime: stored ? 'shoaling' : null,
      point: { speed: HEIGHT[`${model}@${hour}`], direction: 270, period: 12, sampled_lat: 21.5, sampled_lng: -118, interpolation_method: 'bilinear' },
    }) };
  });
}
const ask = (hour, layer = 'waves', lat = 21.5) => fetchBackendExactPoint(lat, -118, hour, null, layer, 'ICON');

beforeEach(() => {
  jest.useFakeTimers('modern');
  jest.setSystemTime(NOW);
  window.__USE_BACKEND_MARINE_SYSTEM__ = true;
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  if (pointCache.clear) pointCache.clear();
  stub();
});
afterEach(() => {
  jest.useRealTimers();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  delete window.__RAW_DISABLE_ICON_POINT_STORED_TAIL__;
  delete window.__USE_BACKEND_MARINE_SYSTEM__;
  delete global.fetch;
});

test('OFF (the default build): past 168 the card blends in the browser from anchor asks, as before', async () => {
  const p200 = await ask(200);                                               // 169-240: ICON@168 persistence + GFS trend
  expect(asks.sort()).toEqual(['GFS@168', 'GFS@200', 'ICON@168']);
  expect(p200.estimate_basis.type).toBe('icon_extended_estimate');
  asks.length = 0;
  const p = await ask(250, 'waves', 21.45);                                  // past 240: GFS/EURO at 240 and the hour, plus the anchors
  expect(asks).toEqual(expect.arrayContaining(['ICON@168', 'GFS@250', 'EURO@250']));
  expect(asks).not.toContain('ICON@250');                                    // never the stored estimate the map draws
  expect(p.provider).toBe('estimated');
  expect(p.surf_height_m == null).toBe(true);                                // the blends carry no surf chain
  expect(p.hourly.wave_height[0]).not.toBeCloseTo(1.55, 2);
});

test('ON: one /point ask for ICON at the hour, answered by the stored estimate the heat map draws (surf chain included)', async () => {
  process.env.REACT_APP_ICON_POINT_STORED_TAIL = 'true';
  process.env.REACT_APP_ICON_STORED_TAIL = 'true';
  const p = await ask(250, 'waves', 21.6);
  expect(asks).toEqual(['ICON@250']);
  expect(p.hourly.wave_height[0]).toBeCloseTo(1.55, 6);
  expect(p.estimate_basis.type).toBe('icon_persistence_gfs_blend');
  expect(p.is_estimated).toBe(true);
  expect(p.surf_height_m).toBe(2.1);
});

test('the flag needs the map\'s stored tail too (the card must read what the map draws), and only builds turn it on', () => {
  expect(iconPointStoredTailEnabled('waves')).toBe(false);
  process.env.REACT_APP_ICON_POINT_STORED_TAIL = 'true';
  expect(iconPointStoredTailEnabled('waves')).toBe(false);                   // map still blends: the card blends with it
  process.env.REACT_APP_ICON_STORED_TAIL = 'true';
  expect(iconPointStoredTailEnabled('waves')).toBe(true);
  expect(iconPointStoredTailEnabled('swell_1')).toBe(true);
  expect(iconPointStoredTailEnabled('wind_waves')).toBe(true);
  expect(iconPointStoredTailEnabled('swell_2')).toBe(false);                 // D-003: the disclosed GFS/EURO blend stays
  window.__RAW_DISABLE_ICON_POINT_STORED_TAIL__ = true;
  expect(iconPointStoredTailEnabled('waves')).toBe(false);                   // the runtime switch only disables
});

test('ON leaves native ICON hours and secondary swell untouched; the kill switch brings the blend back', async () => {
  process.env.REACT_APP_ICON_POINT_STORED_TAIL = 'true';
  process.env.REACT_APP_ICON_STORED_TAIL = 'true';
  await ask(168, 'waves', 21.7);
  expect(asks).toEqual(['ICON@168']);
  window.__RAW_DISABLE_ICON_POINT_STORED_TAIL__ = true;
  asks.length = 0;
  await ask(250, 'waves', 21.8);
  expect(asks).toEqual(expect.arrayContaining(['ICON@168', 'GFS@250']));
  expect(asks).not.toContain('ICON@250');
});

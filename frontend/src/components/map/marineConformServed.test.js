/**
 * marineConformServed.js: the conform (useMarineWindData) carries the SERVED frame identity to the engine BY NAME, end to end:
 * a /grid JSON through the real mapper (mapNormalizedGridToWebGL) and a series frame through frameToMarineData, then the real
 * hook, then the engine-side readers (marineFrameInstant, publishMarineDrawn, marineStaleHour.gridValidMs).
 * served_valid_time is DARK (D-001): off, the conformed grid is exactly the old one. __servedProductId is on, with a kill switch.
 */
import { renderHook } from '@testing-library/react';
import { useMarineWindData } from './useMarineWindData';
import { mapNormalizedGridToWebGL } from './backendWeatherServiceClientHelpers';
import { frameToMarineData } from './marineSeriesFrame';
import { marineFrameInstant, sameMarineFrameInstant } from './marineFrameInstant';
import { publishMarineDrawn, getMarineDrawn, _resetMarineDrawnForTest } from './marineDrawnFrame';
import { gridValidMs, isWorldGridForSelectedHour, isStaleWorldGrid } from './marineStaleHour';
import { describeDrawnFrame } from './drawnFrameReadout';
import { conformServedTimeOn, conformServedProductOn, conformServedIdentity } from './marineConformServed';
import { __resetForTests } from './marineTransitionCoordinator';

// The ask and the frame the backend served differ: a 3-hourly product asked at 13:00Z is served from 12:00Z (frame_substituted).
const ASK = '2026-10-22T13:00:00Z';
const SERVED = '2026-10-22T12:00:00Z';
const BOUNDS = { west: -180, south: -80, east: 180, north: 85 };
const map = { getBounds: () => ({ getWest: () => -100, getEast: () => -60, getSouth: () => 10, getNorth: () => 40 }), getZoom: () => 3.5 };
const FLAGS = ['__RAW_MARINE_CONFORM_SERVED_TIME__', '__RAW_DISABLE_MARINE_CONFORM_SERVED_TIME__', '__RAW_DISABLE_CONFORM_SERVED_PRODUCT__'];

const vectors = [
  { lat: 20, lng: -120, speed: 1.4, direction: 32, u: -0.74, v: -1.19, period: 11.6, is_valid: true },
  { lat: 20, lng: -110, speed: 1.1, direction: 40, u: -0.7, v: -0.84, period: 9.0, is_valid: true },
];
const gridJson = () => ({
  provider: 'open-meteo', product_id: 'gfs_marine_waves_global_mid_20261022T12.json', run_time: '2026-10-22T06:00:00Z',
  valid_time: ASK, served_valid_time: SERVED, frame_offset_hours: -1, frame_substituted: true,
  grid: { cols: 2, rows: 1, bounds: BOUNDS, vectors },
});
const seriesFrame = () => ({
  hour_offset: 15, valid_time: SERVED, served_valid_time: SERVED, product_id: 'gfs_marine_waves_global_mid_20261022T12.json',
  run_time: '2026-10-22T06:00:00Z', provider: 'open-meteo', cols: 2, rows: 1, bounds: BOUNDS, vectors,
});

function conform(marineData, hour = 16) {
  const { result } = renderHook(() => useMarineWindData({
    marineData, activeMarineLayer: 'waves', activeModel: 'GFS', timeOffsetHours: hour, mapInstance: map, viewState: { zoom: 3.5 },
  }));
  return result.current;
}

let savedEnv;
beforeEach(() => {
  savedEnv = process.env.REACT_APP_MARINE_CONFORM_SERVED_TIME;
  delete process.env.REACT_APP_MARINE_CONFORM_SERVED_TIME;
  FLAGS.forEach((k) => { delete window[k]; });
  __resetForTests();
  _resetMarineDrawnForTest();
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.REACT_APP_MARINE_CONFORM_SERVED_TIME;
  else process.env.REACT_APP_MARINE_CONFORM_SERVED_TIME = savedEnv;
  FLAGS.forEach((k) => { delete window[k]; });
});

describe('served_valid_time through the conform (DARK, D-001)', () => {
  test('default off: a mapped /grid grid conforms exactly as before (no served clock on the engine grid)', () => {
    const data = mapNormalizedGridToWebGL(gridJson(), BOUNDS, 16, 'waves', 'GFS');
    expect(data.grid.served_valid_time).toBe(SERVED);                  // the mapper carries it ...
    const g = conform(data);
    expect(g).not.toBeNull();
    expect(g.__renderable).toBe(true);
    expect('served_valid_time' in g).toBe(false);                      // ... and the conform, off, still drops it
    expect(g.valid_time).toBe(ASK);
    expect(marineFrameInstant(g)).toBeNull();
    expect(gridValidMs(g)).toBe(Date.parse(ASK));                      // the stale-hour rules read the ask's echo
    publishMarineDrawn(g);
    expect(getMarineDrawn().dataMs).toBeNull();                        // the drawn record, as dev records it today
    expect(getMarineDrawn().validTime).toBe(ASK);
  });

  test('on: the /grid served clock reaches every engine-side reader, end to end', () => {
    window.__RAW_MARINE_CONFORM_SERVED_TIME__ = true;
    const g = conform(mapNormalizedGridToWebGL(gridJson(), BOUNDS, 16, 'waves', 'GFS'));
    expect(g.served_valid_time).toBe(SERVED);
    expect(g.valid_time).toBe(ASK);                                    // the ask's echo is untouched
    expect(marineFrameInstant(g)).toBe(Date.parse(SERVED));
    expect(gridValidMs(g)).toBe(Date.parse(SERVED));
    publishMarineDrawn(g);
    expect(getMarineDrawn()).toMatchObject({ dataMs: Date.parse(SERVED), validTime: SERVED, hour: 16 });
  });

  test('on: the same served frame asked by two hour labels is ONE frame instant (the guards can see it)', () => {
    window.__RAW_MARINE_CONFORM_SERVED_TIME__ = true;
    const a = conform(mapNormalizedGridToWebGL(gridJson(), BOUNDS, 16, 'waves', 'GFS'), 16);
    const b = conform(mapNormalizedGridToWebGL({ ...gridJson(), valid_time: '2026-10-22T11:00:00Z' }, BOUNDS, 14, 'waves', 'GFS'), 14);
    expect(sameMarineFrameInstant(a, b)).toBe(true);
    window.__RAW_MARINE_CONFORM_SERVED_TIME__ = false;
    const c = conform(mapNormalizedGridToWebGL(gridJson(), BOUNDS, 16, 'waves', 'GFS'), 16);
    expect(sameMarineFrameInstant(c, c)).toBe(false);                  // off: unknown on both sides, never "same"
  });

  test('on: a series frame keeps its own served clock too (the conform stripped it on every lane)', () => {
    window.__RAW_MARINE_CONFORM_SERVED_TIME__ = true;
    const g = conform(frameToMarineData(seriesFrame(), 'GFS', 'waves'), 15);
    expect(g.__fromSeries).toBe(true);
    expect(g.served_valid_time).toBe(SERVED);
    expect(marineFrameInstant(g)).toBe(Date.parse(SERVED));
  });

  test('the build flag turns it on; the kill switch outranks the build flag and the window opt-in', () => {
    process.env.REACT_APP_MARINE_CONFORM_SERVED_TIME = 'true';
    expect(conformServedTimeOn()).toBe(true);
    expect(conform(mapNormalizedGridToWebGL(gridJson(), BOUNDS, 16, 'waves', 'GFS')).served_valid_time).toBe(SERVED);
    window.__RAW_MARINE_CONFORM_SERVED_TIME__ = true;
    window.__RAW_DISABLE_MARINE_CONFORM_SERVED_TIME__ = true;
    expect(conformServedTimeOn()).toBe(false);
    expect('served_valid_time' in conform(mapNormalizedGridToWebGL(gridJson(), BOUNDS, 16, 'waves', 'GFS'))).toBe(false);
  });

  test('on, a grid that names no served clock gets none (never the ask substituted for it)', () => {
    window.__RAW_MARINE_CONFORM_SERVED_TIME__ = true;
    const json = gridJson(); delete json.served_valid_time;
    const g = conform(mapNormalizedGridToWebGL(json, BOUNDS, 16, 'waves', 'GFS'));
    expect('served_valid_time' in g).toBe(false);
    expect(marineFrameInstant(g)).toBeNull();
  });
});

// WHY IT IS DARK: where the served frame is not the asked instant, the real engine-side deciders answer differently by which clock
// the conform hands them. EURO's 6-hourly band (past 144 h): asked 15Z (the raw hour, before the manifest lands), served 12Z.
describe('what carrying the served clock changes (the reason it ships dark)', () => {
  const EURO_ASK = '2026-10-28T15:00:00Z', EURO_SERVED = '2026-10-28T12:00:00Z';
  const euroWorld = (hour) => mapNormalizedGridToWebGL({ ...gridJson(), product_id: 'euro_waves_world_12z.json',
    valid_time: EURO_ASK, served_valid_time: EURO_SERVED, grid: { cols: 2, rows: 1, bounds: BOUNDS, vectors } }, BOUNDS, hour, 'waves', 'EURO');
  const conformEuro = (hour) => {
    const { result } = renderHook(() => useMarineWindData({ marineData: euroWorld(hour), activeMarineLayer: 'waves', activeModel: 'EURO',
      timeOffsetHours: hour, mapInstance: map, viewState: { zoom: 3.5 } }));
    return result.current;
  };
  const selected12z = Date.parse(EURO_SERVED);   // the selection's instant once the manifest snaps it to the stored 12Z frame

  test('the base-aware bridge: "is the held world base the selected hour?" flips from no to yes', () => {
    const off = conformEuro(147);
    expect(off.__renderable).toBe(true);
    expect(isWorldGridForSelectedHour(off, selected12z)).toBe(false);   // echo 15Z is 3 h from 12Z: fails closed, no promotion
    window.__RAW_MARINE_CONFORM_SERVED_TIME__ = true;
    const on = conformEuro(147);
    expect(isWorldGridForSelectedHour(on, selected12z)).toBe(true);     // the served 12Z frame IS the selected hour: promoted
    expect(isStaleWorldGrid(on, selected12z)).toBe(false);
  });

  test('the drawn-frame line: "nearest stored forecast" (labels) becomes no note (instants)', () => {
    const requested = { model: 'EURO', layer: 'waves', hour: 144, instantMs: selected12z, nearestMaxHours: 3 };
    publishMarineDrawn(conformEuro(147));
    expect(describeDrawnFrame(requested, getMarineDrawn())).toMatchObject({ state: 'nearest' });   // hour 147 vs 144 by label
    window.__RAW_MARINE_CONFORM_SERVED_TIME__ = true;
    publishMarineDrawn(conformEuro(147));
    expect(describeDrawnFrame(requested, getMarineDrawn())).toBeNull();                       // the drawn data IS the 12Z ask
  });

  test('a stored-series frame between steps: its valid_time is the hour ASKED, so off the line names an hour no frame has', () => {
    // grid_series_helper.py: valid_time "echoes the per-hour ask"; served_valid_time is the stored 3-hourly frame (+-1 h between steps).
    const between = { ...seriesFrame(), hour_offset: 153, valid_time: '2026-10-28T10:00:00Z', served_valid_time: '2026-10-28T09:00:00Z',
      frame_offset_hours: -1, frame_substituted: true };
    const requested = { model: 'GFS', layer: 'waves', hour: 153, instantMs: Date.parse('2026-10-28T09:00:00Z'), nearestMaxHours: 1 };   // the snapped ask
    publishMarineDrawn(conform(frameToMarineData(between, 'GFS', 'waves'), 153));
    expect(getMarineDrawn().dataMs).toBe(Date.parse('2026-10-28T10:00:00Z'));                // the ASK read as the data instant
    expect(describeDrawnFrame(requested, getMarineDrawn())).toMatchObject({ state: 'nearest' });   // "Showing <10:00Z>: the nearest stored forecast"
    window.__RAW_MARINE_CONFORM_SERVED_TIME__ = true;
    publishMarineDrawn(conform(frameToMarineData(between, 'GFS', 'waves'), 153));
    expect(getMarineDrawn().dataMs).toBe(Date.parse('2026-10-28T09:00:00Z'));
    expect(describeDrawnFrame(requested, getMarineDrawn())).toBeNull();                       // the frame on screen IS the snapped ask
  });
});

describe('__servedProductId through the conform (on, diagnostics only)', () => {
  test('a series frame keeps the STORED product it came from; /grid adds nothing (productId names it there)', () => {
    const s = conform(frameToMarineData(seriesFrame(), 'GFS', 'waves'), 15);
    expect(s.__servedProductId).toBe('gfs_marine_waves_global_mid_20261022T12.json');
    const g = conform(mapNormalizedGridToWebGL(gridJson(), BOUNDS, 16, 'waves', 'GFS'));
    expect('__servedProductId' in g).toBe(false);
    expect(g.productId).toBe('gfs_marine_waves_global_mid_20261022T12.json');
  });

  test('kill switch: window.__RAW_DISABLE_CONFORM_SERVED_PRODUCT__ restores the old conform', () => {
    window.__RAW_DISABLE_CONFORM_SERVED_PRODUCT__ = true;
    expect(conformServedProductOn()).toBe(false);
    expect('__servedProductId' in conform(frameToMarineData(seriesFrame(), 'GFS', 'waves'), 15)).toBe(false);
  });

  test('the helper adds only fields the source carries', () => {
    expect(conformServedIdentity(null)).toEqual({});
    expect(conformServedIdentity({ grid: {} })).toEqual({});
    window.__RAW_MARINE_CONFORM_SERVED_TIME__ = true;
    expect(conformServedIdentity({ served_valid_time: SERVED, grid: {} })).toEqual({ served_valid_time: SERVED });   // wrapper fallback
  });
});

/**
 * cacheBudgetAdapters.js (2026-11-23): each cache's contents as budget entries, sized in O(1) per entry, never building a lazy
 * series frame, pinning the active view's working set.
 */
import {
  MARINE_CELL_BYTES, WIND_CELL_BYTES, decodedOmEntries, frameStoreEntries, hourCacheEntries, packedBytes, rasterEntries, rasterPathView,
  seriesEntries, seriesPageBytes, windCacheEntries,
} from './cacheBudgetAdapters';
import { LazySeriesFrames } from './marineSeriesDecode';

const view = (model, layer, hour = 0) => ({ model, layer, hour });
const grid = (n, extra = {}) => ({ vectors: new Array(n).fill(0).map(() => ({})), ...extra });

describe('series pages', () => {
  it('a lazy page is sized from its packed bytes WITHOUT building a frame', () => {
    const packed = new Map([[0, { buf: new Uint8Array(1000), meta: {} }], [3, { buf: new Uint8Array(2000), meta: {} }]]);
    const frames = new LazySeriesFrames(packed, 'GFS', 'waves');
    const spy = jest.spyOn(frames, '_build');
    const bytes = seriesPageBytes({ frames });
    expect(spy).not.toHaveBeenCalled();
    expect(frames._packed.size).toBe(2);
    expect(bytes).toBe(256 + 1000 + 512 + 2000 + 512);
  });
  it('a built page counts each frame\'s cells once (a shared vectors array once)', () => {
    const g = grid(100);
    const frames = new Map([[0, { grid: g }], [1, { grid: g }], [2, { grid: grid(50) }]]);
    expect(seriesPageBytes({ frames })).toBe(256 + 100 * MARINE_CELL_BYTES + 1024 + 50 * MARINE_CELL_BYTES + 1024);
  });
  it('the page holding the selected hour (+-3 h) of the view on screen is pinned; another layer\'s is not', () => {
    const cache = new Map([
      ['a', { model: 'GFS', layer: 'waves', hours: [0, 3, 6], ts: 1, frames: new Map() }],
      ['b', { model: 'GFS', layer: 'waves', hours: [144, 147], ts: 1, frames: new Map() }],
      ['c', { model: 'GFS', layer: 'swell_1', hours: [0, 3], ts: 1, frames: new Map(), __used: 7 }],
    ]);
    const e = Object.fromEntries(seriesEntries(cache, view('GFS', 'waves', 4)).map((x) => [x.key, x]));
    expect([e.a.pinned, e.b.pinned, e.c.pinned]).toEqual([true, false, false]);
    expect(e.c.lastUse).toBe(7);
  });
});

describe('per-hour grids', () => {
  it('an alias shares its vectors (one id); the view\'s hour +-3 is pinned', () => {
    const g = grid(10, { __componentLayer: 'waves' });
    const entry = { data: { grid: g }, model: 'EURO', timestamp: 5 };
    const cache = new Map([['EURO_waves_global_mid_12', entry], ['EURO_waves_global_coarse_12', entry], ['EURO_waves_global_mid_30', { data: { grid: grid(10, { __componentLayer: 'waves' }) }, model: 'EURO', timestamp: 6 }]]);
    const es = hourCacheEntries(cache, view('EURO', 'waves', 14));
    expect(es[0].id).toBe(es[1].id);
    expect(es.map((x) => x.pinned)).toEqual([true, true, false]);
    expect(es[0].bytes).toBe(10 * MARINE_CELL_BYTES + 1024);
    expect(es[0].model).toBe('EURO');
  });
});

describe('frame store sets', () => {
  it('a set\'s CPU bytes; the set being scrubbed is pinned', () => {
    const store = { sets: new Map([
      ['GFS/waves/world/r/s', { key: 'GFS/waves/world/r/s', model: 'GFS', layer: 'waves', lastActive: 3,
        frames: new Map([['t1', { packed: new Uint8Array(100), raw: new ArrayBuffer(50) }], ['t2', { packed: null, raw: null }]]) }],
      ['ICON/swell_1/world/r/s', { key: 'ICON/swell_1/world/r/s', model: 'ICON', layer: 'swell_1', lastActive: 1,
        frames: new Map([['t1', { packed: new Uint8Array(10) }]]) }],
    ]) };
    const es = frameStoreEntries(store, 'GFS/waves/world/r/s');
    expect(es.map((x) => [x.key, x.bytes, x.pinned])).toEqual([['GFS/waves/world/r/s', 150, true], ['ICON/swell_1/world/r/s', 10, false]]);
    expect(frameStoreEntries(null, null)).toEqual([]);
  });
});

describe('raster fields', () => {
  it('reads model, layer and valid time from the CDN path (CMEMS currents model-agnostic)', () => {
    expect(rasterPathView('v1/gfs/weather/gust/global_0p25/20261123T060000Z/20261124T030000Z-abcdef012345.bin'))
      .toEqual({ model: 'GFS', layer: 'gusts', validMs: Date.UTC(2026, 10, 24, 3) });
    expect(rasterPathView('v1/cmems/marine/currents/global_0p25/x/20261124T000000Z-ab12.bin').model).toBeNull();
  });
  it('pins the 3 most recently used fields on screen; all on-screen anchors; never another layer\'s', () => {
    const f = (used) => ({ values: new Float32Array(10), __used: used });
    const p = (layer, i) => `v1/icon/weather/${layer}/global_0p125/r/2026112${i}T000000Z-aa.bin`;
    const m = new Map([[p('temperature', 1), f(1)], [p('temperature', 2), f(2)], [p('temperature', 3), f(3)], [p('temperature', 4), f(4)], [p('gust', 5), f(9)]]);
    const es = rasterEntries(m, view('ICON', 'temperature'));
    expect(es.filter((x) => x.pinned).map((x) => x.lastUse).sort()).toEqual([2, 3, 4]);
    expect(es.find((x) => x.layer === 'gusts').pinned).toBeFalsy();
    expect(es[0].bytes).toBe(40);
    expect(rasterEntries(m, view('ICON', 'temperature'), { anchors: true }).filter((x) => x.pinned).length).toBe(4);
  });
});

describe('decoded .om fields', () => {
  it('normalises model and variable; the 3 newest on screen are pinned', () => {
    const t = (variable, model, ts) => ({ values: new Float32Array(4), variable, model, timestamp: ts });
    const m = new Map([['a', t('temperature_2m', 'ncep_gfs013', 1)], ['b', t('temperature_2m', 'ncep_gfs013', 2)], ['c', t('temperature_2m', 'ncep_gfs013', 3)],
      ['d', t('temperature_2m', 'ncep_gfs013', 4)], ['e', t('cloud_cover', 'ecmwf_ifs025', 9)]]);
    const es = Object.fromEntries(decodedOmEntries(m, view('GFS', 'temperature')).map((x) => [x.key, x]));
    expect([es.a.pinned, es.b.pinned, es.c.pinned, es.d.pinned, es.e.pinned].map(Boolean)).toEqual([false, true, true, true, false]);
    expect(es.e).toMatchObject({ model: 'EURO', layer: 'satellite', bytes: 16 });
    expect(decodedOmEntries(null, view('GFS', 'waves'))).toEqual([]);
  });
});

describe('wind grids', () => {
  it('model and hour from the key; the view\'s wind hour +-3 pinned', () => {
    const m = new Map([['GFS_wind_grid_global_mid_6', { data: { vectors: new Array(20) }, timestamp: 1 }], ['ICON_wind_grid_x_6', { data: { vectors: new Array(20) }, timestamp: 1 }]]);
    const es = windCacheEntries(m, view('GFS', 'wind', 4));
    expect(es.map((x) => [x.model, x.pinned, x.bytes])).toEqual([['GFS', true, 20 * WIND_CELL_BYTES + 512], ['ICON', false, 20 * WIND_CELL_BYTES + 512]]);
  });
});

it('packedBytes: a buffer itself or one level of typed arrays', () => {
  expect(packedBytes(new Uint8Array(7))).toBe(7);
  expect(packedBytes({ a: new Float32Array(2), b: new ArrayBuffer(3), c: 'x' })).toBe(11);
  expect(packedBytes(null)).toBe(0);
});

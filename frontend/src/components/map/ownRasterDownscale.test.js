import {
  loadDownscale, validDescriptor, downscaleKilled, setDownscaled, getDownscaled, subscribeDownscaled, DZ_DESCRIPTOR, DZ_DESCRIPTOR_LO,
  preferredVariant,
  _resetDownscaleForTest,
} from './ownRasterDownscale';
import { fetchFrameBytes, staticFramesBase } from './staticFrames';

jest.mock('./staticFrames', () => ({ fetchFrameBytes: jest.fn(), staticFramesBase: jest.fn() }));

const desc = {
  version: 1, lapse_K_per_m: -0.0065, credit: 'Elevation: NOAA NCEI ETOPO 2022 (public domain)',
  lattice: { south: -90, west: -180, dlat: 60, dlon: 60, rows: 4, cols: 6 },
  encoding: { dtype: 'uint8', offset: 128, step_m: 25, overlap_cols: 1 },
  tiles: [{ path: 'v1/t0.bin', col0: 0, cols: 4, rows: 4 }, { path: 'v1/t1.bin', col0: 3, cols: 4, rows: 4 }],
};
const okFetch = (body, status = 200) => jest.fn(() => Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) }));

beforeEach(() => {
  staticFramesBase.mockReturnValue('https://cdn.example/');
  fetchFrameBytes.mockImplementation(() => Promise.resolve({ buffer: new Uint8Array(16).fill(130).buffer, wire: 9 }));
});
afterEach(() => {
  _resetDownscaleForTest();
  delete window.__RAW_DISABLE_RASTER_TEMP_DOWNSCALE__;
  delete window.__RAW_OWN_RASTER__;
  delete global.fetch;
});

test('the asset loads once per page: the descriptor (no-cache), then every tile through the static frames fetch', async () => {
  global.fetch = okFetch(desc);
  const [a, b] = await Promise.all([loadDownscale(), loadDownscale()]);
  expect(a).toBe(b);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toBe(`https://cdn.example/${DZ_DESCRIPTOR}`);
  expect(global.fetch.mock.calls[0][1].cache).toBe('no-cache');
  expect(fetchFrameBytes.mock.calls.map((c) => [c[0], c[2]])).toEqual([['https://cdn.example/v1/t0.bin', 'low'], ['https://cdn.example/v1/t1.bin', 'low']]);
  expect(a.tiles.map((t) => [t.col0, t.cols, t.rows, t.data.length])).toEqual([[0, 4, 4, 16], [3, 4, 4, 16]]);
  expect([a.offset, a.step, a.lapse]).toEqual([128, 25, -0.0065]);
  expect(window.__RAW_OWN_RASTER__.downscale.wire).toBe(18);
});

test('not published, a short tile, the kill switch: no asset (the field draws as is), and a failure retries next time', async () => {
  global.fetch = okFetch({}, 404);
  expect(await loadDownscale()).toBeNull();
  expect(window.__RAW_OWN_RASTER__.misses.dz_not_published).toBe(1);
  global.fetch = okFetch(desc);
  fetchFrameBytes.mockImplementation(() => Promise.resolve({ buffer: new Uint8Array(15).buffer, wire: 9 }));
  expect(await loadDownscale()).toBeNull();                             // a fresh attempt (the 404 was not cached)
  expect(window.__RAW_OWN_RASTER__.misses.dz_load_failed).toBe(1);
  window.__RAW_DISABLE_RASTER_TEMP_DOWNSCALE__ = true;
  expect(downscaleKilled()).toBe(true);
  expect(await loadDownscale()).toBeNull();
});

test('the descriptor check: version, uint8, 1-2 tiles whose inner columns cover the lattice', () => {
  expect(validDescriptor(desc)).toBe(true);
  expect(validDescriptor({ ...desc, version: 2 })).toBe(false);
  expect(validDescriptor({ ...desc, encoding: { ...desc.encoding, dtype: 'int16' } })).toBe(false);
  expect(validDescriptor({ ...desc, tiles: [] })).toBe(false);
  expect(validDescriptor({ ...desc, tiles: [desc.tiles[0]] })).toBe(false);          // 3 inner columns, lattice has 6
  expect(validDescriptor({ ...desc, tiles: [...desc.tiles, desc.tiles[0]] })).toBe(false);
});

test('the terrain-adjusted store notifies subscribers on change only', () => {
  const fn = jest.fn();
  const off = subscribeDownscaled(fn);
  setDownscaled('temperature', true); setDownscaled('temperature', true);
  expect(getDownscaled().temperature).toBe(true);
  expect(fn).toHaveBeenCalledTimes(1);
  setDownscaled('temperature', false);
  expect(fn).toHaveBeenCalledTimes(2);
  off();
});

test('the 1/8 fallback: a small device asks for it; it loads from its own descriptor and is cached apart', async () => {
  const had = Object.getOwnPropertyDescriptor(navigator, 'deviceMemory');
  Object.defineProperty(navigator, 'deviceMemory', { value: 2, configurable: true });
  expect(preferredVariant()).toBe('lo');
  Object.defineProperty(navigator, 'deviceMemory', { value: 8, configurable: true });
  expect(preferredVariant()).toBe('hi');
  if (had) Object.defineProperty(navigator, 'deviceMemory', had); else delete navigator.deviceMemory;
  global.fetch = okFetch(desc);
  const lo = await loadDownscale('lo');
  const hi = await loadDownscale('hi');
  expect(global.fetch.mock.calls.map((c) => c[0])).toEqual([`https://cdn.example/${DZ_DESCRIPTOR_LO}`, `https://cdn.example/${DZ_DESCRIPTOR}`]);
  expect(lo.variant).toBe('lo');
  expect(hi.variant).toBe('hi');
  expect(lo).not.toBe(hi);
});

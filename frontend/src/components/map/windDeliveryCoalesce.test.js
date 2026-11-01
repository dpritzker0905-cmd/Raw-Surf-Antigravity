// Owner manual test 2026-10-25: "delivering 8 grid(s)", maxWindSpeed flapping 26.43 <-> 27.87 kn. windDeliveryCoalesce.js pins what
// the layer hands the engine per effect run; these use the engine's own windGridsCompatible as the "same air" rule.
import { coalesceWindDeliveries, queueWindDelivery, refreshWindSpeedScale, WIND_DELIVERY_QUEUE_MAX } from './windDeliveryCoalesce';
import { windGridsCompatible } from './WebGLWindEngine';

const VT = '2026-10-28T20:00:00Z';
const grid = (model, hour, world, extra = {}) => ({
  source: model, hourOffset: hour, valid_time: extra.vt || VT, truthTag: { model },
  bounds: world ? { west: -180, south: -80, east: 180, north: 85 } : { west: -90, south: 20, east: -70, north: 35 },
  vectors: [{ u: 1, v: 1 }], ...extra,
});

beforeEach(() => {
  delete window.__WIND_DELIVERY_COALESCE__;
  delete window.__RAW_DISABLE_WIND_DELIVERY_COALESCE__;
  delete window.__RAW_DISABLE_WIND_REASK_DEDUPE__;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('the re-ask dedupe at the queue', () => {
  test('a cache hit returning the queued grid object is not queued again; a new object is', () => {
    const q = []; const a = grid('EURO', 68, true); const b = grid('EURO', 68, false);
    expect(queueWindDelivery(q, a)).toBe(true);
    expect(queueWindDelivery(q, a)).toBe(false);          // React bails out of the same state: only the queue would grow
    expect(queueWindDelivery(q, b)).toBe(true);
    expect(queueWindDelivery(q, a)).toBe(true);           // not the LAST queued: a real change back
    expect(q).toEqual([a, b, a]);
    expect(window.__WIND_DELIVERY_COALESCE__).toMatchObject({ pushes: 4, repeats: 1 });
  });

  test('killed, every commit is queued as before; the queue stays bounded either way', () => {
    window.__RAW_DISABLE_WIND_REASK_DEDUPE__ = true;
    const q = []; const a = grid('EURO', 68, true);
    for (let i = 0; i < 40; i++) queueWindDelivery(q, a);
    expect(q.length).toBe(WIND_DELIVERY_QUEUE_MAX);
    expect(window.__WIND_DELIVERY_COALESCE__.repeats).toBe(39);
  });
});

describe('the coalesce at the drain', () => {
  test('the owner\'s batch: repeated world/clip pairs plus left-behind hours become the newest world + newest clip', () => {
    const gfsOld = grid('GFS', 68, true);                            // the model just left
    const eurOld = grid('EURO', 67, false, { vt: '2026-10-28T19:00:00Z' }); // an hour just scrubbed past
    const w1 = grid('EURO', 68, true); const c1 = grid('EURO', 68, false);
    const w2 = grid('EURO', 68, true); const c2 = grid('EURO', 68, false);
    const q = [gfsOld, w1, c1, w1, c1, eurOld, w2, c2, w2];
    const out = coalesceWindDeliveries(q, c2, windGridsCompatible);
    expect(out).toEqual([w2, c2]);                                   // commit order kept, ends with the final grid
    // queued 10: the final grid is appended (the queue ends with w2); dupes 4: w1, c1, w2 again and the appended c2
    expect(window.__WIND_DELIVERY_COALESCE__).toMatchObject({ queued: 10, delivered: 2, dupes: 4, superseded: 2 });
    expect(window.__WIND_DELIVERY_COALESCE__.stale).toBe(2);          // GFS, and EURO +67 h (other hourOffset)
  });

  test('#14\'s case is kept: a world committed earlier in the batch, then its clip', () => {
    const w = grid('GFS', 0, true); const c = grid('GFS', 0, false);
    expect(coalesceWindDeliveries([w, c], c, windGridsCompatible)).toEqual([w, c]);
    expect(coalesceWindDeliveries([c, w], w, windGridsCompatible)).toEqual([c, w]);   // clip then world: the engine promotes
  });

  test('the final grid is always delivered, last, even when nothing queued matches it', () => {
    const d = grid('ICON', 3, false);
    expect(coalesceWindDeliveries([grid('GFS', 0, true)], d, windGridsCompatible)).toEqual([d]);
    expect(coalesceWindDeliveries([], d, windGridsCompatible)).toEqual([d]);
    const off = { ...grid('ICON', 3, true), renderable: false };
    expect(coalesceWindDeliveries([off, d], d, windGridsCompatible)).toEqual([d]);
  });

  test('killed: today\'s list (every renderable queued grid, then the final one), while the telemetry still counts', () => {
    window.__RAW_DISABLE_WIND_DELIVERY_COALESCE__ = true;
    const w = grid('EURO', 68, true); const c = grid('EURO', 68, false);
    const q = [w, c, w, c, w];
    expect(coalesceWindDeliveries(q, c, windGridsCompatible)).toEqual([w, c, w, c, w, c]);
    expect(window.__WIND_DELIVERY_COALESCE__).toMatchObject({ queued: 6, delivered: 6, dupes: 4 });
  });
});

describe('the speed scale, once', () => {
  const gl = { deleteTexture: jest.fn() };
  test('from both textures, clamped [10, 80] kn; the ramp is dropped only on a change', () => {
    const e = { _maxWindSpeed: 50, _colorRamp: 'ramp', _windData: { maxSpeed: 26.43 }, _windFine: { maxSpeed: 27.87 } };
    expect(refreshWindSpeedScale(e, gl)).toBe(true);
    expect(e._maxWindSpeed).toBe(27.87);
    expect(e._colorRamp).toBe(null);
    e._colorRamp = 'ramp2';
    expect(refreshWindSpeedScale(e, gl)).toBe(false);                 // same value: the ramp stays
    expect(e._colorRamp).toBe('ramp2');
    expect(refreshWindSpeedScale({ _maxWindSpeed: 50, _windData: { maxSpeed: 3 } }, gl)).toBe(true);
    const calm = { _maxWindSpeed: 50, _windData: { maxSpeed: 3 } }; refreshWindSpeedScale(calm, gl); expect(calm._maxWindSpeed).toBe(10);
    const storm = { _maxWindSpeed: 50, _windData: { maxSpeed: 140 } }; refreshWindSpeedScale(storm, gl); expect(storm._maxWindSpeed).toBe(80);
    expect(refreshWindSpeedScale({ _maxWindSpeed: 50 }, gl)).toBe(false);   // nothing held: unchanged
  });
});

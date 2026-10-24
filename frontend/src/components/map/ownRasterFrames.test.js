import {
  planWindow, toField, ownFramesOn, ownIndex, lastIndex, frameAt, framesOf, setWanted, getField, MAX_IN_FLIGHT, MISSING, OWN_RASTER_SETS,
  combinedFrames, combinedFrameAt, setKey, TEMP_FIELD, NO_DATA_BELOW, leverCovers, loadField, telSet,
  _resetOwnRasterFramesForTest,
} from './ownRasterFrames';
import { getPinnedIndex, loadFrameParsed, staticFramesBase, staticFramesEnabled, staticSetEnabled } from './staticFrames';

jest.mock('./staticFrames', () => ({
  getPinnedIndex: jest.fn(),
  loadFrameParsed: jest.fn(),
  staticFramesBase: jest.fn(),
  staticFramesEnabled: jest.fn(),
  staticSetEnabled: jest.fn(),
}));

// CRA resets mock implementations before each test: set them here.
beforeEach(() => {
  staticFramesBase.mockReturnValue('https://cdn.example/');
  staticFramesEnabled.mockReturnValue(true);
  staticSetEnabled.mockReturnValue(true);
});

afterEach(() => {
  _resetOwnRasterFramesForTest();
  delete window.__RAW_RASTER_OWN_FRAMES__;
  delete window.__RAW_DISABLE_RASTER_OWN_FRAMES__;
  try { window.localStorage.removeItem('__RAW_RASTER_OWN_FRAMES__'); } catch (e) { /* none */ }
  loadFrameParsed.mockReset();
});

describe('planWindow: direction-aware, at most +-2', () => {
  test('desktop forward: shown, two ahead, one behind', () => expect(planWindow(10, 113, 1, 2)).toEqual([10, 11, 12, 9]));
  test('desktop backward: ahead means earlier', () => expect(planWindow(10, 113, -1, 2)).toEqual([10, 9, 8, 11]));
  test('handheld: shown, one ahead, one behind', () => expect(planWindow(10, 113, 1, 1)).toEqual([10, 11, 9]));
  test('clipped at the run ends', () => {
    expect(planWindow(112, 113, 1, 2)).toEqual([112, 111]);
    expect(planWindow(0, 113, -1, 2)).toEqual([0, 1]);
  });
  test('nothing for an empty run or a bad position', () => {
    expect(planWindow(0, 0, 1, 2)).toEqual([]);
    expect(planWindow(-1, 10, 1, 2)).toEqual([]);
  });
});

test('toField: Float32 values, missing nodes as MISSING, the frame times in ms', () => {
  const parsed = { cols: 2, rows: 2, bounds: { west: 0, south: 0, east: 1, north: 1 }, validEpoch: 100, runEpoch: 40,
    fields: { 6: new Float64Array([1013.2, NaN, 980.5, 1040.1]) } };
  const f = toField(parsed, 6);
  expect(Array.from(f.values)).toEqual([Math.fround(1013.2), MISSING, Math.fround(980.5), Math.fround(1040.1)]);
  expect([f.min, f.max, f.validMs, f.runMs]).toEqual([980.5, 1040.1, 100000, 40000]);
  expect(toField(parsed, 0)).toBeNull();
});

describe('levers (phase 1 is dark)', () => {
  test('off by default', () => expect(ownFramesOn('pressure')).toBe(false));
  test("on with the window lever or this browser's choice", () => {
    window.__RAW_RASTER_OWN_FRAMES__ = true;
    expect(ownFramesOn('pressure')).toBe(true);
    delete window.__RAW_RASTER_OWN_FRAMES__;
    window.localStorage.setItem('__RAW_RASTER_OWN_FRAMES__', 'true');
    expect(ownFramesOn('pressure')).toBe(true);
  });
  test('the kill wins; a layer without a set is never on', () => {
    window.__RAW_RASTER_OWN_FRAMES__ = true;
    window.__RAW_DISABLE_RASTER_OWN_FRAMES__ = true;
    expect(ownFramesOn('pressure')).toBe(false);
    delete window.__RAW_DISABLE_RASTER_OWN_FRAMES__;
    expect(ownFramesOn('rain')).toBe(false);
  });
  test('per model: each has its own set; a model whose set is killed stays on the .om path', () => {
    window.__RAW_RASTER_OWN_FRAMES__ = true;
    for (const m of ['GFS', 'EURO', 'ICON', 'euro']) expect(ownFramesOn('pressure', m)).toBe(true);
    staticSetEnabled.mockImplementation((key) => key !== 'ICON/weather/pressure/global_0p5');
    expect(ownFramesOn('pressure', 'ICON')).toBe(false);
    expect(ownFramesOn('pressure', 'HRRR')).toBe(false);
  });
  test('the set keys match the publisher contract', () => {
    expect(setKey('pressure', 'GFS')).toBe('GFS/weather/pressure/global_0p5');
    expect(setKey('pressure', 'EURO')).toBe('EURO/weather/pressure/global_0p5');
    expect(setKey('pressure', 'ICON')).toBe('ICON/weather/pressure/global_0p5');
    expect(OWN_RASTER_SETS.pressure.fallback).toBe('GFS');
  });
});

describe('frames of the index', () => {
  const index = { frames: [
    { valid_time: '2026-10-23T00:00:00Z', path: 'f000' },
    { valid_time: '2026-10-23T03:00:00Z', path: null },
    { valid_time: '2026-10-23T06:00:00Z', path: 'f006' },
  ] };
  test('frameAt: the nearest stored frame within 3 h; a listed frame without a file is a gap', () => {
    expect(frameAt(index, Date.parse('2026-10-23T01:00:00Z')).path).toBe('f000');
    expect(frameAt(index, Date.parse('2026-10-23T03:00:00Z'))).toBeNull();
    expect(frameAt(index, Date.parse('2026-10-23T11:00:00Z'))).toBeNull();
  });
  test('framesOf keeps only frames with a file', () => expect(framesOf(index).map((f) => f.path)).toEqual(['f000', 'f006']));
});

describe('the window pump', () => {
  const parsedFor = (v) => ({ cols: 1, rows: 1, bounds: {}, validEpoch: 0, runEpoch: 0, fields: { 6: new Float64Array([v]) } });
  test(`at most ${MAX_IN_FLIGHT} loads at once, in window order; a frame that left the window never starts`, async () => {
    const resolvers = {};
    loadFrameParsed.mockImplementation((key, frame) => new Promise((r) => { resolvers[frame.path] = () => r({ parsed: parsedFor(1), wire: 10 }); }));
    const got = [];
    setWanted('pressure', ['a', 'b', 'c', 'd'].map((p) => ({ path: p })), (p) => got.push(p));
    expect(loadFrameParsed.mock.calls.map((c) => c[1].path)).toEqual(['a', 'b', 'c']);
    expect(loadFrameParsed.mock.calls.map((c) => c[3] && c[3].priority)).toEqual(['high', 'low', 'low']);   // the wanted frame first
    setWanted('pressure', ['e', 'a'].map((p) => ({ path: p })), (p) => got.push(p));   // the scrub moved on: d is gone
    resolvers.a(); await new Promise((r) => setTimeout(r, 0));
    expect(loadFrameParsed.mock.calls.map((c) => c[1].path)).toEqual(['a', 'b', 'c', 'e']);
    expect(got).toEqual(['a']);
    expect(getField('a').values[0]).toBe(1);
    resolvers.b(); resolvers.c(); resolvers.e(); await new Promise((r) => setTimeout(r, 0));
    expect(got).toEqual(['a', 'e']);                    // b and c landed (kept in the LRU) but are no longer wanted
    expect(loadFrameParsed.mock.calls.map((c) => c[1].path)).not.toContain('d');
  });
});

describe('the remembered index (prewarm: a toggle draws after one frame round trip)', () => {
  test('ownIndex remembers what it pinned; nothing while the lever is off', async () => {
    const idx = { path: 'i.json', frames: [{ valid_time: '2026-10-23T06:00:00Z', path: 'f0' }] };
    getPinnedIndex.mockResolvedValue(idx);
    expect(await ownIndex('pressure')).toBeNull();          // lever off
    expect(lastIndex('pressure')).toBeNull();
    window.__RAW_RASTER_OWN_FRAMES__ = true;
    expect(await ownIndex('pressure')).toBe(idx);
    expect(lastIndex('pressure')).toBe(idx);
    expect(getPinnedIndex).toHaveBeenCalledWith('GFS/weather/pressure/global_0p5');
  });
});


describe("past a model's range: the GFS stand-in, labelled (the wave layers' extension policy)", () => {
  const vt = (h) => new Date(Date.UTC(2026, 9, 24, 0) + h * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const euro = { frames: [0, 3, 6, 150, 156, 240].map((h) => ({ valid_time: vt(h), path: `e${h}` })) };
  const gfs = { frames: [0, 3, 237, 240, 243, 246, 336].map((h) => ({ valid_time: vt(h), path: `g${h}` })) };
  const at = (h) => Date.UTC(2026, 9, 24, 0) + h * 3600000;
  test("the model's own frames, then GFS frames past its last one, flagged estimated", () => {
    const c = combinedFrames('pressure', 'EURO', euro, gfs);
    expect(c.map((f) => f.path)).toEqual(['e0', 'e3', 'e6', 'e150', 'e156', 'e240', 'g243', 'g246', 'g336']);
    expect(c[0]).toMatchObject({ model: 'EURO', estimated: null, setKey: 'EURO/weather/pressure/global_0p5' });
    expect(c[6]).toMatchObject({ model: 'GFS', estimated: 'gfs_estimated_fallback', setKey: 'GFS/weather/pressure/global_0p5' });
    expect(euro.frames[0].model).toBeUndefined();                       // the index is never mutated
    expect(combinedFrames('pressure', 'GFS', gfs, gfs).every((f) => !f.estimated)).toBe(true);
    expect(combinedFrames('pressure', 'EURO', euro, null)).toHaveLength(6);
  });
  test("inside the range the model's own frame always wins; past it, the stand-in; a gap inside the range stays a gap", () => {
    const c = combinedFrames('pressure', 'EURO', euro, gfs);
    expect(combinedFrameAt(c, at(239)).path).toBe('e240');            // own, within 3 h
    expect(combinedFrameAt(c, at(244)).path).toBe('g243');            // past 240 h: GFS
    expect(combinedFrameAt(c, at(300))).toBeNull();                   // nothing within 3 h either side
    expect(combinedFrameAt(c, at(60))).toBeNull();                    // inside EURO's range, no frame within 3 h: no stand-in
  });
});

describe('air temperature and two layers at once (2026-10-24)', () => {
  const parsedOf = (key, v) => ({ cols: 1, rows: 1, bounds: {}, validEpoch: 0, runEpoch: 0,
    fields: /temperature/.test(key) ? { 7: new Float64Array([v]) } : { 6: new Float64Array([v]) } });
  afterEach(() => { delete window.__RAW_DISABLE_RASTER_OWN_TEMPERATURE__; });

  test('the temperature set is GFS only: with EURO or ICON picked the layer stays on the .om path', () => {
    window.__RAW_RASTER_OWN_FRAMES__ = true;
    expect(setKey('temperature', 'GFS')).toBe('GFS/weather/temperature/global_0p5');
    expect(OWN_RASTER_SETS.temperature.field).toBe(TEMP_FIELD);
    expect(TEMP_FIELD).toBe(7);
    expect(OWN_RASTER_SETS.temperature.fallback).toBeNull();
    expect(ownFramesOn('temperature', 'GFS')).toBe(true);
    expect(ownFramesOn('temperature', 'EURO')).toBe(false);
    expect(ownFramesOn('temperature', 'ICON')).toBe(false);
  });

  test('the lever can name its layers; each layer has its own kill', () => {
    window.__RAW_RASTER_OWN_FRAMES__ = 'pressure';
    expect(ownFramesOn('pressure')).toBe(true);
    expect(ownFramesOn('temperature')).toBe(false);
    window.__RAW_RASTER_OWN_FRAMES__ = 'pressure, temperature';
    expect(ownFramesOn('temperature')).toBe(true);
    window.__RAW_DISABLE_RASTER_OWN_TEMPERATURE__ = true;
    expect(ownFramesOn('temperature')).toBe(false);
    expect(ownFramesOn('pressure')).toBe(true);
    delete window.__RAW_DISABLE_RASTER_OWN_TEMPERATURE__;
    delete window.__RAW_RASTER_OWN_FRAMES__;
    window.localStorage.setItem('__RAW_RASTER_OWN_FRAMES__', 'temperature');
    expect(ownFramesOn('temperature')).toBe(true);
    expect(ownFramesOn('pressure')).toBe(false);
    expect(leverCovers(false, 'pressure')).toBe(false);
    expect(leverCovers('true', 'temperature')).toBe(true);
    expect(leverCovers('pressures', 'pressure')).toBe(false);
  });

  test('a below-zero temperature is a value, never no-data', () => {
    const f = toField({ cols: 2, rows: 1, bounds: {}, validEpoch: 0, runEpoch: 0, fields: { 7: new Float64Array([-41.5, NaN]) } }, 7);
    expect(f.values[0]).toBeCloseTo(-41.5, 5);
    expect(f.values[1]).toBe(MISSING);
    expect(f.min).toBeCloseTo(-41.5, 5);
    expect(MISSING).toBeLessThan(NO_DATA_BELOW);
    expect(NO_DATA_BELOW).toBeLessThan(-273.15);
  });

  test("two windows, a cap per layer: pressure's look-ahead never holds back temperature's shown frame, nor drops its landing", async () => {
    const resolvers = {};
    loadFrameParsed.mockImplementation((key, frame) => new Promise((r) => { resolvers[frame.path] = () => r({ parsed: parsedOf(key, 1), wire: 1 }); }));
    const got = [];
    setWanted('pressure', [{ path: 'p1' }, { path: 'p2' }, { path: 'p3' }, { path: 'p4' }], (p) => got.push(p));
    setWanted('temperature', [{ path: 't1' }, { path: 't2' }], (p) => got.push(p));
    // pressure alone fills its own three; temperature's shown frame (high) starts at once beside them
    expect(loadFrameParsed.mock.calls.map((c) => c[1].path)).toEqual(['p1', 'p2', 'p3', 't1', 't2']);
    expect(loadFrameParsed.mock.calls.map((c) => c[3] && c[3].priority)).toEqual(['high', 'low', 'low', 'high', 'low']);
    setWanted('temperature', [{ path: 't1' }, { path: 't2' }], (p) => got.push(p));   // temperature steps again
    resolvers.p1(); resolvers.t1(); await new Promise((r) => setTimeout(r, 0));
    expect(got.sort()).toEqual(['p1', 't1']);                                       // pressure's landing was not dropped
    expect(getField('t1').values[0]).toBe(1);
  });

  test('each layer keeps its own LRU of six decoded fields', async () => {
    loadFrameParsed.mockImplementation((key) => Promise.resolve({ parsed: parsedOf(key, 2), wire: 1 }));
    for (let i = 0; i < 7; i++) await loadField('pressure', { path: `p${i}` });
    for (let i = 0; i < 6; i++) await loadField('temperature', { path: `t${i}` });
    expect(getField('p0')).toBeNull();                       // pressure's seventh evicted its own oldest
    for (let i = 1; i < 7; i++) expect(getField(`p${i}`)).not.toBeNull();
    for (let i = 0; i < 6; i++) expect(getField(`t${i}`)).not.toBeNull();   // temperature never evicted pressure, nor the reverse
  });

  test('telemetry keeps shown / want / pin per layer, each stamped with its layer', () => {
    telSet('pressure', 'want', { path: 'p1' });
    telSet('temperature', 'want', { path: 't1' });
    const t = window.__RAW_OWN_RASTER__;
    expect(t.byLayer.pressure.want).toEqual({ path: 'p1', layer: 'pressure' });
    expect(t.byLayer.temperature.want).toEqual({ path: 't1', layer: 'temperature' });
    expect(t.want.layer).toBe('temperature');                // the top-level slot: the latest of any layer
  });
});

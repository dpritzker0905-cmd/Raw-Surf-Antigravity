import {
  planWindow, toField, ownFramesOn, ownIndex, lastIndex, frameAt, framesOf, setWanted, getField, MAX_IN_FLIGHT, MISSING, OWN_RASTER_SETS,
  combinedFrames, combinedFrameAt, setKey, TEMP_FIELD, CLOUD_FIELD, PRECIP_FIELD, NO_DATA_BELOW, leverCovers, DEFAULT_ON_LAYERS,
  _resetOwnRasterFramesForTest, FAIL_BACKOFF_MS, FOG_FIELD, landFill, tel, DEFAULT_ON_MODELS,
} from './ownRasterFrames';
import { getPinnedIndex, loadFrameParsed, staticFramesBase, staticFramesEnabled, staticSetEnabled } from './staticFrames';

import { landCellMaskReady } from './openMeteoProtocol';
jest.mock('./openMeteoProtocol', () => ({ landCellMaskReady: jest.fn() }));
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
  // Pressure is ON by default since 2026-11-12, air temperature, fog and water temp since 2026-11-14 (DEFAULT_ON_LAYERS); rain is
  // the layer that is still dark.
  test('off by default', () => expect(ownFramesOn('rain')).toBe(false));
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
    expect(ownFramesOn('radar')).toBe(false);                 // radar has no own set
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

describe('a mixed-cadence index: hourly to f120, then 3-hourly (GFS pressure, 2026-11-12)', () => {
  const RUN = Date.parse('2026-11-12T12:00:00Z');
  const HOURS = [...Array(121).keys(), ...Array.from({ length: 72 }, (_, i) => 123 + 3 * i)];
  const index = { frames: HOURS.map((h) => ({ valid_time: new Date(RUN + h * 3600000).toISOString(), path: `f${h}` })) };
  const at = (h) => frameAt(index, RUN + h * 3600000);
  test('193 frames; every hour of the first five days shows its own frame', () => {
    expect(HOURS).toHaveLength(193);
    for (let h = 0; h <= 120; h++) expect(at(h).path).toBe(`f${h}`);
  });
  test('past f120 an hour shows the nearer 3-hourly frame, picked by valid time and not by position', () => {
    expect(at(121).path).toBe('f120');
    expect(at(122).path).toBe('f123');
    expect(at(123).path).toBe('f123');
    expect(at(335).path).toBe('f336');
    expect(at(340)).toBeNull();                        // more than 3 h past the last frame: a gap, nothing drawn
  });
  test('the window walks positions: across f120 it holds f119, f120 and the next stored frame f123', () => {
    const frames = framesOf(index);
    expect(planWindow(120, frames.length, 1, 2).map((i) => frames[i].path)).toEqual(['f120', 'f123', 'f126', 'f119']);
    expect(planWindow(120, frames.length, -1, 1).map((i) => frames[i].path)).toEqual(['f120', 'f119', 'f123']);
  });
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
    window.__RAW_DISABLE_RASTER_OWN_PRESSURE__ = true;      // pressure is on by default (2026-11-12): its kill is the "off"
    expect(await ownIndex('pressure')).toBeNull();
    expect(lastIndex('pressure')).toBeNull();
    delete window.__RAW_DISABLE_RASTER_OWN_PRESSURE__;
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

describe('air temperature (2026-10-24)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_RASTER_OWN_TEMPERATURE__; });

  test('per model since 2026-11-14: GFS, EURO and ICON each read their own set (no stand-in); an unpublished set stays on .om', () => {
    expect(setKey('temperature', 'GFS')).toBe('GFS/weather/temperature/global_0p5');
    expect(setKey('temperature', 'EURO')).toBe('EURO/weather/temperature/global_0p5');
    expect(setKey('temperature', 'ICON')).toBe('ICON/weather/temperature/global_0p5');
    expect(OWN_RASTER_SETS.temperature.field).toBe(TEMP_FIELD);
    expect(TEMP_FIELD).toBe(7);
    expect(OWN_RASTER_SETS.temperature.fallback).toBeNull();
    // default: GFS only (resolution rule: EURO / ICON sets are 0.5 deg, coarser than their .om grids); the lever reaches all three
    expect(ownFramesOn('temperature', 'GFS')).toBe(true);
    expect(ownFramesOn('temperature', 'EURO')).toBe(false);
    expect(ownFramesOn('temperature', 'ICON')).toBe(false);
    window.__RAW_RASTER_OWN_FRAMES__ = 'temperature';
    for (const m of ['GFS', 'EURO', 'ICON']) expect(ownFramesOn('temperature', m)).toBe(true);
    staticSetEnabled.mockImplementation((key) => key !== 'EURO/weather/temperature/global_0p5');
    expect(ownFramesOn('temperature', 'EURO')).toBe(false);
  });

  test('the lever can name its layers; each layer has its own kill', () => {
    window.__RAW_RASTER_OWN_FRAMES__ = 'pressure';
    expect(ownFramesOn('pressure')).toBe(true);
    expect(ownFramesOn('rain')).toBe(false);
    window.__RAW_RASTER_OWN_FRAMES__ = 'pressure, rain';
    expect(ownFramesOn('rain')).toBe(true);
    expect(ownFramesOn('temperature')).toBe(true);             // on by default (2026-11-14), whatever the lever names
    window.__RAW_DISABLE_RASTER_OWN_TEMPERATURE__ = true;
    expect(ownFramesOn('temperature')).toBe(false);
    expect(ownFramesOn('pressure')).toBe(true);
    delete window.__RAW_DISABLE_RASTER_OWN_TEMPERATURE__;
    delete window.__RAW_RASTER_OWN_FRAMES__;
    window.localStorage.setItem('__RAW_RASTER_OWN_FRAMES__', 'temperature');
    expect(ownFramesOn('temperature')).toBe(true);
    expect(ownFramesOn('pressure')).toBe(true);             // on by default (2026-11-12), whatever the lever names
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
});

describe('cloud cover, the satellite layer (2026-10-24)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_RASTER_OWN_SATELLITE__; });
  test('the cloud set is GFS only, field 8; its own kill', () => {
    window.__RAW_RASTER_OWN_FRAMES__ = 'satellite';
    expect(setKey('satellite', 'GFS')).toBe('GFS/weather/cloud_cover/global_0p25');
    expect(OWN_RASTER_SETS.satellite.field).toBe(CLOUD_FIELD);
    expect(CLOUD_FIELD).toBe(8);
    expect(ownFramesOn('satellite', 'GFS')).toBe(true);
    expect(ownFramesOn('satellite', 'EURO')).toBe(false);
    expect(ownFramesOn('rain', 'GFS')).toBe(false);
    window.__RAW_DISABLE_RASTER_OWN_SATELLITE__ = true;
    expect(ownFramesOn('satellite', 'GFS')).toBe(false);
  });
  test('ON by default (D-052; pressure 2026-11-12; air temp, fog, water temp 2026-11-14): no lever needed; rain stays dark', () => {
    expect(DEFAULT_ON_LAYERS).toEqual(['satellite', 'pressure', 'fog']);
    expect(DEFAULT_ON_MODELS).toEqual({ temperature: ['GFS'], water_temp: ['EURO', 'ICON'] });
    expect(ownFramesOn('satellite', 'GFS')).toBe(true);
    expect(ownFramesOn('satellite', 'EURO')).toBe(false); // no EURO cloud set: the .om path draws EURO as before
    expect(ownFramesOn('temperature', 'GFS')).toBe(true);
    expect(ownFramesOn('rain', 'GFS')).toBe(false);
  });
  test('pressure is ON by default for each model with its own set', () => {
    for (const m of ['GFS', 'EURO', 'ICON']) expect(ownFramesOn('pressure', m)).toBe(true);
  });
  test('KILL: __RAW_DISABLE_RASTER_OWN_PRESSURE__ puts pressure back on the .om path and leaves cloud alone', () => {
    window.__RAW_DISABLE_RASTER_OWN_PRESSURE__ = true;
    try {
      for (const m of ['GFS', 'EURO', 'ICON']) expect(ownFramesOn('pressure', m)).toBe(false);
      expect(ownFramesOn('satellite', 'GFS')).toBe(true);
    } finally { delete window.__RAW_DISABLE_RASTER_OWN_PRESSURE__; }
  });
  test('the pressure default yields to the all-layers kill and to a per-set kill', () => {
    window.__RAW_DISABLE_RASTER_OWN_FRAMES__ = true;
    expect(ownFramesOn('pressure', 'GFS')).toBe(false);
    delete window.__RAW_DISABLE_RASTER_OWN_FRAMES__;
    staticSetEnabled.mockImplementation((key) => key !== 'EURO/weather/pressure/global_0p5');   // the per-set kill's answer
    expect(ownFramesOn('pressure', 'EURO')).toBe(false);     // EURO alone falls back to the .om path
    expect(ownFramesOn('pressure', 'GFS')).toBe(true);
  });
  test('the cloud default yields to both kills and to a set that is not published', () => {
    window.__RAW_DISABLE_RASTER_OWN_SATELLITE__ = true;
    expect(ownFramesOn('satellite', 'GFS')).toBe(false);
    delete window.__RAW_DISABLE_RASTER_OWN_SATELLITE__;
    window.__RAW_DISABLE_RASTER_OWN_FRAMES__ = true;
    expect(ownFramesOn('satellite', 'GFS')).toBe(false);
    delete window.__RAW_DISABLE_RASTER_OWN_FRAMES__;
    staticSetEnabled.mockImplementation((key) => key !== 'GFS/weather/cloud_cover/global_0p25');
    expect(ownFramesOn('satellite', 'GFS')).toBe(false);
    staticSetEnabled.mockImplementation(() => true);
    staticFramesEnabled.mockReturnValue(false);
    expect(ownFramesOn('satellite', 'GFS')).toBe(false);
  });
});

describe('precipitation, the rain layer (2026-11-12): GFS and EURO, dark until the lever names it', () => {
  afterEach(() => { delete window.__RAW_DISABLE_RASTER_OWN_RAIN__; });

  test('the set keys and field match the publisher contract; ICON has no set', () => {
    expect(setKey('rain', 'GFS')).toBe('GFS/weather/precipitation/global_0p25');
    expect(setKey('rain', 'EURO')).toBe('EURO/weather/precipitation/global_0p25');
    expect(setKey('rain', 'ICON')).toBeNull();
    expect(OWN_RASTER_SETS.rain.field).toBe(PRECIP_FIELD);
    expect(PRECIP_FIELD).toBe(10);
    expect(OWN_RASTER_SETS.rain.unit).toBe('mm/h');
    expect(OWN_RASTER_SETS.rain.fallback).toBe('GFS');
  });

  test('dark: off with no lever, and not one of the default-on layers', () => {
    expect(DEFAULT_ON_LAYERS).not.toContain('rain');
    expect(ownFramesOn('rain')).toBe(false);
  });

  test('on when the lever names it, for GFS and EURO; ICON stays on the .om path', () => {
    window.__RAW_RASTER_OWN_FRAMES__ = 'rain';
    expect(ownFramesOn('rain', 'GFS')).toBe(true);
    expect(ownFramesOn('rain', 'EURO')).toBe(true);
    expect(ownFramesOn('rain', 'ICON')).toBe(false);
    expect(leverCovers('rain', 'temperature')).toBe(false);  // the lever named rain only
  });

  test('OFF PATH: its own kill wins over the lever and touches no other layer', () => {
    window.__RAW_RASTER_OWN_FRAMES__ = true;
    window.__RAW_DISABLE_RASTER_OWN_RAIN__ = true;
    expect(ownFramesOn('rain')).toBe(false);
    expect(ownFramesOn('pressure')).toBe(true);
    expect(ownFramesOn('temperature')).toBe(true);
  });
});

describe('EURO rain past its own range: the GFS frame stands in, labelled as an estimate (2026-11-12)', () => {
  const RUN = Date.parse('2026-11-12T12:00:00Z');
  const at = (h) => new Date(RUN + h * 3600000).toISOString();
  const euro = { frames: [3, 6, 234, 240].map((h) => ({ valid_time: at(h), path: `e${h}` })) };
  const gfs = { frames: [237, 240, 243, 246, 336].map((h) => ({ valid_time: at(h), path: `g${h}` })) };

  test('inside EURO range its own frames win; past 240 h the scrub walks GFS frames flagged as estimates', () => {
    const frames = combinedFrames('rain', 'EURO', euro, gfs);
    expect(frames.map((f) => f.path)).toEqual(['e3', 'e6', 'e234', 'e240', 'g243', 'g246', 'g336']);
    expect(frames.filter((f) => f.estimated).map((f) => f.path)).toEqual(['g243', 'g246', 'g336']);
    expect(combinedFrameAt(frames, RUN + 240 * 3600000).path).toBe('e240');
    expect(combinedFrameAt(frames, RUN + 246 * 3600000)).toMatchObject({ path: 'g246', model: 'GFS', estimated: 'gfs_estimated_fallback' });
    expect(combinedFrameAt(frames, RUN + 336 * 3600000).path).toBe('g336');   // the 14-day scrubber is never cut to EURO's range
  });

  test('GFS rain has no stand-in (it is the fallback itself)', () => {
    expect(combinedFrames('rain', 'GFS', gfs, gfs).some((f) => f.estimated)).toBe(false);
  });
});

describe('failed-load backoff (2026-11-14): the pump never re-asks a frame that just failed', () => {
  const flush = async (n = 20) => { for (let i = 0; i < n; i += 1) await Promise.resolve(); };
  const frame = { path: 'v1/gfs/weather/pressure/global_0p5/frames/f000.bin', valid_time: '2026-11-14T00:00:00Z' };
  afterEach(() => { delete window.__RAW_DISABLE_RASTER_OWN_FAIL_BACKOFF__; });

  test('a failed load is asked once, not in a loop, and again after the backoff', async () => {
    loadFrameParsed.mockResolvedValue(null);
    setWanted('pressure', [frame], null);
    await flush();
    expect(loadFrameParsed).toHaveBeenCalledTimes(1);
    expect(tel().misses.load_failed).toBe(1);
    setWanted('pressure', [frame], null);                   // the next step re-offers it inside the backoff: not asked
    await flush();
    expect(loadFrameParsed).toHaveBeenCalledTimes(1);
    const now = Date.now(); const spy = jest.spyOn(Date, 'now').mockReturnValue(now + FAIL_BACKOFF_MS + 1);
    setWanted('pressure', [frame], null);                   // past the backoff: one more try
    await flush();
    spy.mockRestore();
    setWanted('pressure', [], null);
    expect(loadFrameParsed).toHaveBeenCalledTimes(2);
  });

  test('parked on the frame (no further step): the backoff ends with one re-ask, not never', async () => {
    jest.useFakeTimers();
    try {
      loadFrameParsed.mockResolvedValue(null);
      setWanted('pressure', [frame], null);
      await flush();
      expect(loadFrameParsed).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(FAIL_BACKOFF_MS - 1000);
      await flush();
      expect(loadFrameParsed).toHaveBeenCalledTimes(1);      // still inside the backoff
      jest.advanceTimersByTime(2000);                         // past it, with no step at all
      await flush();
      expect(loadFrameParsed).toHaveBeenCalledTimes(2);
      setWanted('pressure', [], null);                        // the layer leaves: its retry timer goes with it
      jest.advanceTimersByTime(FAIL_BACKOFF_MS * 2);
      await flush();
      expect(loadFrameParsed).toHaveBeenCalledTimes(2);
    } finally { jest.useRealTimers(); }
  });

  test('a success after a failure clears the backoff (the frame is cached, never re-asked)', async () => {
    jest.useFakeTimers();
    try {
      loadFrameParsed.mockResolvedValueOnce(null).mockResolvedValue({
        parsed: { cols: 1, rows: 1, bounds: {}, validEpoch: 0, runEpoch: 0, fields: { 6: new Float64Array([1013]) } }, wire: 10 });
      setWanted('pressure', [frame], null);
      await flush();
      jest.advanceTimersByTime(FAIL_BACKOFF_MS + 1000);
      await flush();
      expect(loadFrameParsed).toHaveBeenCalledTimes(2);
      expect(getField(frame.path)).not.toBeNull();
      setWanted('pressure', [frame], null);
      jest.advanceTimersByTime(FAIL_BACKOFF_MS * 2);
      await flush();
      expect(loadFrameParsed).toHaveBeenCalledTimes(2);
    } finally { jest.useRealTimers(); setWanted('pressure', [], null); }
  });

  test('OFF PATH: __RAW_DISABLE_RASTER_OWN_FAIL_BACKOFF__ restores the re-ask (the old loop)', async () => {
    window.__RAW_DISABLE_RASTER_OWN_FAIL_BACKOFF__ = true;
    loadFrameParsed.mockResolvedValue(null);
    setWanted('pressure', [frame], null);
    await flush();
    setWanted('pressure', [], null);                        // stop the loop
    await flush();
    expect(loadFrameParsed.mock.calls.length).toBeGreaterThan(1);
  });
});

// FOG, WATER TEMP (2026-11-14, the overnight instant lane): own frames ON by default, each with its own kill; the .om path's land
// cover for water temp reproduced at decode.
describe('fog and water temperature (2026-11-14)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_RASTER_OWN_FOG__; delete window.__RAW_DISABLE_RASTER_OWN_WATER_TEMP__; delete globalThis.__RAW_WT_LANDMASK_DISABLED__; });

  test('fog reads the GFS visibility set for every model (the .om path pins GFS for fog); field 11, metres', () => {
    for (const m of ['GFS', 'EURO', 'ICON']) expect(setKey('fog', m)).toBe('GFS/weather/fog/global_0p25');
    expect(FOG_FIELD).toBe(11);
    expect(OWN_RASTER_SETS.fog.field).toBe(FOG_FIELD);
    expect(OWN_RASTER_SETS.fog.unit).toBe('m');
  });

  test('water temp: GFS skin temperature for GFS and ICON (ICON has none; the .om cross-fall), EURO its own; land filled', () => {
    expect(setKey('water_temp', 'GFS')).toBe('GFS/weather/water_temp/global_0p25');
    expect(setKey('water_temp', 'ICON')).toBe('GFS/weather/water_temp/global_0p25');
    expect(setKey('water_temp', 'EURO')).toBe('EURO/weather/water_temp/global_0p25');
    expect(OWN_RASTER_SETS.water_temp.field).toBe(TEMP_FIELD);
    expect(OWN_RASTER_SETS.water_temp.landFill).toBe(true);
  });

  test('ON by default with no lever: fog for every model; water temp for EURO (skt = ifs025) and ICON (today blank), not GFS', () => {
    for (const m of ['GFS', 'EURO', 'ICON']) expect(ownFramesOn('fog', m)).toBe(true);
    expect(ownFramesOn('water_temp', 'GFS')).toBe(false);     // gfs013 (0.117 deg) on the .om path is finer than the 0.25 deg set
    expect(ownFramesOn('water_temp', 'EURO')).toBe(true);
    expect(ownFramesOn('water_temp', 'ICON')).toBe(true);
  });

  test('OFF PATH: __RAW_DISABLE_RASTER_OWN_FOG__ puts fog back on the .om path and touches no other layer', () => {
    window.__RAW_DISABLE_RASTER_OWN_FOG__ = true;
    for (const m of ['GFS', 'EURO', 'ICON']) expect(ownFramesOn('fog', m)).toBe(false);
    expect(ownFramesOn('water_temp', 'EURO')).toBe(true);
    expect(ownFramesOn('temperature', 'GFS')).toBe(true);
  });

  test('OFF PATH: __RAW_DISABLE_RASTER_OWN_WATER_TEMP__ puts water temp back on the .om path and touches no other layer', () => {
    window.__RAW_DISABLE_RASTER_OWN_WATER_TEMP__ = true;
    for (const m of ['GFS', 'EURO', 'ICON']) expect(ownFramesOn('water_temp', m)).toBe(false);
    expect(ownFramesOn('fog', 'GFS')).toBe(true);
  });

  // 3 x 3 grid, the centre is land holding 40 deg C of land skin heat; its water neighbours read 20 (one is no data).
  const field = () => ({ cols: 3, rows: 3, bounds: { west: 0, south: 0, east: 2, north: 2 },
    values: Float32Array.from([20, 20, 20, 20, 40, 20, 20, 20, MISSING]), min: 20, max: 40 });
  const MASK = Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]);

  test('landFill: a land cell takes its clean water neighbours mean (no data never counts), as the .om path', async () => {
    landCellMaskReady.mockResolvedValue(MASK);
    const f = field();
    await landFill(f);
    expect(landCellMaskReady).toHaveBeenCalledWith(3, 3, [0, 0, 2, 2]);
    expect(f.values[4]).toBeCloseTo(20, 5);
    expect(f.values[8]).toBe(MISSING);                         // no data stays no data
    expect([f.min, f.max]).toEqual([20, 20]);
  });

  test('landFill: no mask (no OffscreenCanvas) draws the field as is and says so; the .om kill skips it', async () => {
    landCellMaskReady.mockResolvedValue(null);
    const f = field();
    await landFill(f);
    expect(f.values[4]).toBe(40);
    expect(tel().misses.wt_landfill_skipped).toBe(1);
    globalThis.__RAW_WT_LANDMASK_DISABLED__ = true;
    landCellMaskReady.mockClear();
    const g = field();
    await landFill(g);
    expect(landCellMaskReady).not.toHaveBeenCalled();
    expect(g.values[4]).toBe(40);
  });
});

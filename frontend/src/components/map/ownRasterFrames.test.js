import {
  planWindow, toField, ownFramesOn, frameAt, framesOf, setWanted, getField, MAX_IN_FLIGHT, MISSING, OWN_RASTER_SETS,
  _resetOwnRasterFramesForTest,
} from './ownRasterFrames';
import { loadFrameParsed, staticFramesBase, staticFramesEnabled, staticSetEnabled } from './staticFrames';

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
  test('on with the window lever or this browser\'s choice', () => {
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
  test('GFS only: with EURO or ICON selected the .om path draws that model', () => {
    window.__RAW_RASTER_OWN_FRAMES__ = true;
    expect(ownFramesOn('pressure', 'GFS')).toBe(true);
    expect(ownFramesOn('pressure', 'EURO')).toBe(false);
    expect(ownFramesOn('pressure', 'ICON')).toBe(false);
  });
  test('the set key matches the publisher contract', () => expect(OWN_RASTER_SETS.pressure.key).toBe('GFS/weather/pressure/global_0p5'));
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

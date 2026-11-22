/**
 * Native 1/12-deg currents on the surf boxes (currentNative.js; DARK). Pins: the lever, its kill and the particles' own gates;
 * the box choice (the WHOLE view inside one box); a per-cell direction gives one node per cell; the box frame load (exact hour,
 * the index's flow_dir_stride); the hook (world grid unless a Copernicus world grid sits under a box with a frame for the hour)
 * and the colour texture travelling with the grid.
 */
import fs from 'fs';
import path from 'path';
import { act, renderHook, waitFor } from '@testing-library/react';
import * as staticFrames from './staticFrames';
import * as decode from './ownRasterDecode';
import {
  NATIVE_BOXES, NATIVE_REFINES, boxFor, currentsNativeOn, loadNativeField, nativeGridOf, nativeKey, useCurrentFlowGrid,
  _resetCurrentNativeForTest,
} from './currentNative';
import { buildCurrentGrid, setShownCurrentField } from './currentParticles';

jest.mock('./staticFrames', () => ({ getPinnedIndex: jest.fn(), fetchFrameBytes: jest.fn(), staticFramesBase: () => 'https://cdn.test/' }));
jest.mock('./ownRasterDecode', () => ({ decodeOwnField: jest.fn() }));

const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const T = Date.parse('2026-11-23T00:00:00Z');

afterEach(() => {
  delete window.__RAW_CURRENTS_NATIVE__;
  delete window.__RAW_DISABLE_CURRENTS_NATIVE__;
  delete window.__RAW_DISABLE_CURRENT_PARTICLES__;
  delete window.matchMedia;
  try { window.localStorage.removeItem('__RAW_CURRENTS_NATIVE__'); } catch (e) { /* none */ }
  setShownCurrentField(null);
  _resetCurrentNativeForTest();
  jest.clearAllMocks();
});

/** A native box field: `cols` x `rows`, 1 kn everywhere, every cell flowing east (code 64), the box's own bounds. */
const boxField = (box = 'hawaii', validMs = T) => {
  const [w, s, e, n] = NATIVE_BOXES[box];
  const cols = Math.round((e - w) * 12) + 1; const rows = Math.round((n - s) * 12) + 1;
  return { cols, rows, bounds: { west: w, south: s, east: e, north: n }, validMs,
    values: new Float32Array(cols * rows).fill(1), dirCodes: new Uint8Array(cols * rows).fill(64) };
};

describe('the gate (dark)', () => {
  test('off by default; the lever (window or a phone\'s localStorage) turns it on; its kill and the particles\' gates win', () => {
    expect(currentsNativeOn()).toBe(false);
    window.__RAW_CURRENTS_NATIVE__ = true;
    expect(currentsNativeOn()).toBe(true);
    window.__RAW_DISABLE_CURRENTS_NATIVE__ = true;
    expect(currentsNativeOn()).toBe(false);
    delete window.__RAW_DISABLE_CURRENTS_NATIVE__;
    window.__RAW_DISABLE_CURRENT_PARTICLES__ = true;
    expect(currentsNativeOn()).toBe(false);
    delete window.__RAW_DISABLE_CURRENT_PARTICLES__;
    window.matchMedia = (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' });
    expect(currentsNativeOn()).toBe(false);
    delete window.matchMedia;
    delete window.__RAW_CURRENTS_NATIVE__;
    window.localStorage.setItem('__RAW_CURRENTS_NATIVE__', '1');
    expect(currentsNativeOn()).toBe(true);
  });
});

describe('the box under the view', () => {
  test('only a view wholly inside a box picks it; a view across its edge, or nowhere near one, keeps the world grid', () => {
    expect(boxFor({ west: -158.5, south: 20.5, east: -157.5, north: 21.8 })).toBe('hawaii');
    expect(boxFor({ west: -162, south: 20, east: -157, north: 22 })).toBe(null);          // past Hawaii's west edge
    expect(boxFor({ west: -40, south: 0, east: -30, north: 10 })).toBe(null);
    expect(boxFor(null)).toBe(null);
    expect(boxFor({ west: NaN, south: 0, east: 1, north: 1 })).toBe(null);
  });

  test('the key is the publisher\'s set and the box table is the snapped pilot boxes (the backend test pins the numbers)', () => {
    expect(nativeKey('hawaii')).toBe('CMEMS/marine/currents/hawaii_0p083');
    expect(Object.keys(NATIVE_BOXES)).toHaveLength(14);
    for (const [w, s, e, n] of Object.values(NATIVE_BOXES)) { expect(e).toBeGreaterThan(w); expect(n).toBeGreaterThan(s); }
  });
});

describe('the native grid', () => {
  test('a per-cell direction (dirStride 1) gives one node per 1/12-deg cell; the world anchors still give one per 2 x 2', () => {
    const f = { ...boxField(), dirStride: 1 };
    const g = buildCurrentGrid(f, 'cmems/marine/currents/hawaii_0p083', 1);
    expect([g.cols, g.rows]).toEqual([f.cols, f.rows]);
    expect(g.bounds).toEqual(f.bounds);
    expect(g.vectors[0].u).toBeCloseTo(12, 5);   // 1 kn east x the one gain
    expect(g.vectors[0].v).toBeCloseTo(0, 5);
    expect(g.colourField).toBe(f);               // the colour / sea texture travels with the grid
    const world = buildCurrentGrid({ ...boxField(), dirStride: undefined }, 's', 1);
    expect(world.cols).toBe(Math.ceil(f.cols / 2));
  });

  test('nativeGridOf builds once per field and names the box set as the source (a box change reseeds)', () => {
    const f = { ...boxField(), dirStride: 1 };
    const g = nativeGridOf(f, 'hawaii');
    expect(nativeGridOf(f, 'hawaii')).toBe(g);
    expect(g.source).toBe('currents:cmems/marine/currents/hawaii_0p083');
    expect(nativeGridOf(null, 'hawaii')).toBe(null);
  });
});

const INDEX = { grid: { flow_dir_stride: 1 }, frames: [
  { valid_time: '2026-11-23T00:00:00Z', path: 'v1/cmems/marine/currents/hawaii_0p083/r/a.bin' },
  { valid_time: '2026-11-23T06:00:00Z', path: null, unbuilt: 'failed' },
] };

describe('the box frame load', () => {
  test('the exact hour only; the index\'s stride rides on the field; one load per path', async () => {
    staticFrames.getPinnedIndex.mockResolvedValue(INDEX);
    staticFrames.fetchFrameBytes.mockResolvedValue({ buffer: new ArrayBuffer(8) });
    decode.decodeOwnField.mockResolvedValue(boxField());
    const f = await loadNativeField('hawaii', T);
    expect(staticFrames.getPinnedIndex).toHaveBeenCalledWith('CMEMS/marine/currents/hawaii_0p083');
    expect(staticFrames.fetchFrameBytes.mock.calls[0][0]).toBe('https://cdn.test/v1/cmems/marine/currents/hawaii_0p083/r/a.bin');
    expect(decode.decodeOwnField.mock.calls[0].slice(1)).toEqual([[13, 4], -9999, [14]]);
    expect(f.dirStride).toBe(1);
    expect(await loadNativeField('hawaii', T)).toBe(f);
    expect(staticFrames.fetchFrameBytes).toHaveBeenCalledTimes(1);
    expect(await loadNativeField('hawaii', T + 6 * 3600e3)).toBe(null);    // unbuilt hour
    expect(await loadNativeField('hawaii', T + 3 * 3600e3)).toBe(null);    // no frame at that hour: never a neighbour
  });

  test('a failed fetch, no direction or a frame for another hour is no field (the world grid flows)', async () => {
    staticFrames.getPinnedIndex.mockResolvedValue(INDEX);
    staticFrames.fetchFrameBytes.mockResolvedValue({ error: 'http_404', status: 404 });
    expect(await loadNativeField('hawaii', T)).toBe(null);
    _resetCurrentNativeForTest();
    staticFrames.fetchFrameBytes.mockResolvedValue({ buffer: new ArrayBuffer(8) });
    decode.decodeOwnField.mockResolvedValue({ ...boxField(), dirCodes: undefined });
    expect(await loadNativeField('hawaii', T)).toBe(null);
    _resetCurrentNativeForTest();
    decode.decodeOwnField.mockResolvedValue(boxField('hawaii', T + 3600e3));
    expect(await loadNativeField('hawaii', T)).toBe(null);
    staticFrames.getPinnedIndex.mockResolvedValue(null);
    expect(await loadNativeField('hawaii', T)).toBe(null);
  });
});

/** A map stub whose view is `view` and that fires moveend on demand. */
function mapAt(view) {
  const subs = new Set();
  return {
    view,
    getBounds() { const v = this.view; return { getWest: () => v.west, getSouth: () => v.south, getEast: () => v.east, getNorth: () => v.north }; },
    on: (ev, fn) => { if (ev === 'moveend') subs.add(fn); },
    off: (ev, fn) => subs.delete(fn),
    move(v) { this.view = v; subs.forEach((fn) => fn()); },
  };
}
/** The world currents field on screen: 0.25 deg over Hawaii, anchors flowing north. */
const worldField = () => {
  const cols = 41; const rows = 41;
  const codes = new Uint8Array(cols * rows);
  return { cols, rows, bounds: { west: -165, south: 15, east: -155, north: 25 }, validMs: T,
    values: new Float32Array(cols * rows).fill(0.5), dirCodes: codes };
};
const HAWAII_VIEW = { west: -158.5, south: 20.5, east: -157.5, north: 21.8 };

describe('the hook', () => {
  beforeEach(() => {
    staticFrames.getPinnedIndex.mockResolvedValue(INDEX);
    staticFrames.fetchFrameBytes.mockResolvedValue({ buffer: new ArrayBuffer(8) });
    decode.decodeOwnField.mockImplementation(async () => boxField());
  });

  test('dark: the world grid, with no box frame asked for', async () => {
    setShownCurrentField(worldField(), 'cmems/marine/currents/global_0p25');
    const { result } = renderHook(() => useCurrentFlowGrid(true, mapAt(HAWAII_VIEW)));
    expect(result.current.source).toBe(NATIVE_REFINES);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(result.current.source).toBe(NATIVE_REFINES);
    expect(staticFrames.getPinnedIndex).not.toHaveBeenCalled();
  });

  test('on, inside a box: the box\'s native grid for the same hour; panning out returns the world grid', async () => {
    window.__RAW_CURRENTS_NATIVE__ = true;
    setShownCurrentField(worldField(), 'cmems/marine/currents/global_0p25');
    const map = mapAt(HAWAII_VIEW);
    const { result } = renderHook(() => useCurrentFlowGrid(true, map));
    await waitFor(() => expect(result.current.source).toBe('currents:cmems/marine/currents/hawaii_0p083'));
    expect(result.current.cols).toBe(85);
    expect(window.__RAW_CURRENT_NATIVE__).toMatchObject({ box: 'hawaii', state: 'flowing', cols: 85, rows: 61 });
    act(() => map.move({ west: -170, south: 10, east: -150, north: 30 }));
    await waitFor(() => expect(result.current.source).toBe(NATIVE_REFINES));
  });

  test('the kill takes effect at the next pan, without a reload', async () => {
    window.__RAW_CURRENTS_NATIVE__ = true;
    setShownCurrentField(worldField(), 'cmems/marine/currents/global_0p25');
    const map = mapAt(HAWAII_VIEW);
    const { result } = renderHook(() => useCurrentFlowGrid(true, map));
    await waitFor(() => expect(result.current.source).toBe('currents:cmems/marine/currents/hawaii_0p083'));
    window.__RAW_DISABLE_CURRENTS_NATIVE__ = true;
    act(() => map.move({ ...HAWAII_VIEW, west: HAWAII_VIEW.west + 0.01 }));
    await waitFor(() => expect(result.current.source).toBe(NATIVE_REFINES));
  });

  test('another ocean model on screen (GIOPS, RTOFS) never gets Copernicus box particles', async () => {
    window.__RAW_CURRENTS_NATIVE__ = true;
    setShownCurrentField(worldField(), 'giops/marine/currents/global_0p25');
    const { result } = renderHook(() => useCurrentFlowGrid(true, mapAt(HAWAII_VIEW)));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(result.current.source).toBe('currents:giops/marine/currents/global_0p25');
    expect(staticFrames.getPinnedIndex).not.toHaveBeenCalled();
  });

  test('no box frame for the hour: the world grid flows', async () => {
    window.__RAW_CURRENTS_NATIVE__ = true;
    staticFrames.getPinnedIndex.mockResolvedValue({ grid: {}, frames: [] });
    setShownCurrentField(worldField(), 'cmems/marine/currents/global_0p25');
    const { result } = renderHook(() => useCurrentFlowGrid(true, mapAt(HAWAII_VIEW)));
    await waitFor(() => expect(window.__RAW_CURRENT_NATIVE__ && window.__RAW_CURRENT_NATIVE__.state).toBe('no_frame'));
    expect(result.current.source).toBe(NATIVE_REFINES);
  });
});

describe('the wiring', () => {
  test('MapWebGL flows the particles on the hook\'s grid; the wind layer colours them from the grid\'s own field', () => {
    expect(src('MapWebGL.js')).toContain('const currentGrid = useCurrentFlowGrid(currentFlow, mapInstance);');
    const l = src('WebGLWindLayer.js');
    expect(l).toContain("const curColourField = colourMode === 'current' && data && data.isCurrentFlow ? (data.colourField || null) : null;");
    expect(l).toContain('useEffect(() => { if (applyColourRef.current) applyColourRef.current(curColourField); }, [curColourField]);');
  });
});

/**
 * Fog (every model) and EURO water / air temp: built, OFF by default pending the owner (vote split 2026-11-14 08:31Z), reachable
 * with the lever (window.__RAW_RASTER_OWN_FRAMES__), which these tests set; their sets publish one per ingest run after merge.
 * Until a set is in latest.json, the hook must let go of the layer, so MapWebGL hands it back to the .om path, and never leave
 * it drawn by nobody.
 * Contract: the hook returns `engaged`; MapWebGL drops a layer from the .om list only while that is true.
 */
import React, { useLayoutEffect } from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { useOwnRasterFrames, HANDOVER_LAYERS } from './useOwnRasterFrames';
import { _resetOwnRasterFramesForTest, tel } from './ownRasterFrames';
import { getPinnedIndex, loadFrameParsed, staticFramesBase, staticFramesEnabled, staticSetEnabled } from './staticFrames';
import { createOwnRasterLayer } from './ownRasterLayer';

jest.mock('./openMeteoProtocol', () => ({ landCellMaskReady: jest.fn() }));
jest.mock('./staticFrames', () => ({
  getPinnedIndex: jest.fn(),
  loadFrameParsed: jest.fn(),
  pickIndexFrame: jest.fn(),
  staticFramesBase: jest.fn(),
  staticFramesEnabled: jest.fn(),
  staticSetEnabled: jest.fn(),
}));
// The GL layer, faked: it records its onShown callback, so a test decides when our first frame is drawn.
jest.mock('./ownRasterLayer', () => ({ ...jest.requireActual('./ownRasterLayer'), createOwnRasterLayer: jest.fn() }));

beforeEach(() => {
  staticFramesBase.mockReturnValue('https://cdn.example/');
  staticFramesEnabled.mockReturnValue(true);
  staticSetEnabled.mockReturnValue(true);
  loadFrameParsed.mockResolvedValue(null);
  window.__RAW_RASTER_OWN_FRAMES__ = 'fog,water_temp,temperature';   // the owner's preview path while the defaults are OFF
});
afterEach(() => { _resetOwnRasterFramesForTest(); getPinnedIndex.mockReset(); delete window.__RAW_RASTER_OWN_FRAMES__; delete window.__RAW_DISABLE_RASTER_OWN_HANDOVER__; delete window.__RAW_DISABLE_RASTER_OWN_SAME_FRAME__; });

function fakeGl() {
  const gl = { shown: null, wants: [] };
  createOwnRasterLayer.mockImplementation(() => ({
    onShown: (fn) => { gl.shown = fn; }, setLut: jest.fn(), want: jest.fn((p) => { gl.wants.push(p); }), offerField: jest.fn(), isResident: () => false,
    setIsobarColor: jest.fn(), setDownscale: jest.fn(),
  }));
  const map = { getLayer: () => undefined, addLayer: jest.fn(), removeLayer: jest.fn(), on: jest.fn(), off: jest.fn() };
  return { gl, map };
}
const published = () => ({ path: 'idx', run: 'r', frames: [{ valid_time: new Date().toISOString(), path: 'f000' }] });

const run = (layer, model, mapInstance = null) => renderHook(() => useOwnRasterFrames({
  mapInstance, layer, model, active: true, timeOffsetHours: 0, theme: 'dark', beforeId: undefined,
}));

describe('a layer whose set is not published yet falls back to .om (lever on)', () => {
  test.each([['fog', 'GFS'], ['fog', 'EURO'], ['fog', 'ICON'], ['water_temp', 'EURO'], ['temperature', 'EURO']])(
    '%s / %s: no index in latest.json -> disengaged, miss counted', async (layer, model) => {
      getPinnedIndex.mockResolvedValue(null);              // what staticFrames answers for a set missing from latest.json
      const { result } = run(layer, model);
      await waitFor(() => expect(result.current).toBe(false));
      expect(tel().misses.no_index).toBe(1);
    },
  );

  test('a read that throws also lets go', async () => {
    getPinnedIndex.mockRejectedValue(new Error('404'));
    const { result } = run('fog', 'GFS');
    await waitFor(() => expect(result.current).toBe(false));
  });

  test('COLD TOGGLE: .om keeps the layer until our first frame is DRAWN, then hands over on that frame', async () => {
    const { gl, map } = fakeGl();
    let answer; getPinnedIndex.mockReturnValue(new Promise((r) => { answer = r; }));
    const { result } = run('fog', 'GFS', map);
    expect(result.current).toBe(false);                      // first render: .om draws (index not read yet)
    await act(async () => { answer(published()); });
    await waitFor(() => expect(map.addLayer).toHaveBeenCalled());
    expect(gl.shown).toEqual(expect.any(Function));
    expect(result.current).toBe(false);                      // set confirmed, our layer added, nothing drawn: .om still draws
    await act(async () => { gl.shown('f000', { validMs: Date.now() }); });
    expect(result.current).toBe(true);                       // our frame is on screen: .om may let go
    expect(tel().misses.no_index).toBeUndefined();
  });

  test('OFF PATH: __RAW_DISABLE_RASTER_OWN_HANDOVER__ reports at once (the pre-handover order)', async () => {
    window.__RAW_DISABLE_RASTER_OWN_HANDOVER__ = true;
    const { map } = fakeGl();
    getPinnedIndex.mockResolvedValue(published());
    const { result } = run('fog', 'GFS', map);
    expect(result.current).toBe(true);
  });

  test('a layer that failed after drawing goes back to .om, and a new engagement waits for its own first frame', async () => {
    const { gl, map } = fakeGl();
    getPinnedIndex.mockResolvedValue(published());
    const { result, rerender } = renderHook(({ active }) => useOwnRasterFrames({
      mapInstance: map, layer: 'fog', model: 'GFS', active, timeOffsetHours: 0, theme: 'dark', beforeId: undefined,
    }), { initialProps: { active: true } });
    await waitFor(() => expect(gl.shown).toEqual(expect.any(Function)));
    await act(async () => { gl.shown('f000', { validMs: Date.now() }); });
    expect(result.current).toBe(true);
    rerender({ active: false });
    expect(result.current).toBe(false);
    gl.shown = null;
    rerender({ active: true });
    await waitFor(() => expect(gl.shown).toEqual(expect.any(Function)));
    expect(result.current).toBe(false);                      // re-toggled: no stale "shown" from the last engagement
  });

  test('without the lever none of them engages on any model (default-OFF pending the owner): the .om path draws', () => {
    delete window.__RAW_RASTER_OWN_FRAMES__;
    for (const layer of ['fog', 'water_temp', 'temperature']) for (const model of ['GFS', 'EURO', 'ICON']) {
      expect(run(layer, model).result.current).toBe(false);
    }
    expect(getPinnedIndex).not.toHaveBeenCalled();
  });
});

test('MapWebGL hands a disengaged fog / water layer back to the .om list (the filter reads each hook return)', () => {
  const read = (f) => require('fs').readFileSync(require('path').join(__dirname, f), 'utf8');
  const hooks = read('useOwnRasterLayers.js');
  expect(hooks).toMatch(/const ownFog = useOwnRasterFrames\(\{[^}]*layer: 'fog'/);
  expect(hooks).toMatch(/const ownWaterTemp = useOwnRasterFrames\(\{[^}]*layer: 'water_temp'/);
  expect(hooks).toMatch(/fog: ownFog, water_temp: ownWaterTemp/);
  expect(hooks).toMatch(/\.filter\(\(l\) => !own\[l\]\)/);
  expect(read('MapWebGL.js')).toMatch(/const omLayers = useOwnRasterLayers\(\{/);
});

describe('SAME FRAME: the layer is asked for the new frame in the commit that paints the new time label', () => {
  const H = 3600000;
  const hourly = () => {
    const t0 = Date.now() + 60000;   // a minute ahead: hour h is always nearest to frame fh
    return { path: 'idx', run: 'r', frames: [-1, 0, 1, 2, 3, 4].map((h) => ({ valid_time: new Date(t0 + h * H).toISOString(), path: `f${h}` })) };
  };
  // A sibling's LAYOUT effect declared after the hook runs right after the hook's layout effects, before the browser paints:
  // what our layer was asked for by then is what the painted frame can show next to the new label.
  function Probe({ map, offset, seen, gl, layer = 'fog' }) {
    useOwnRasterFrames({ mapInstance: map, layer, model: 'GFS', active: true, timeOffsetHours: offset, theme: 'dark', beforeId: undefined });
    useLayoutEffect(() => { seen.push([offset, gl.wants[gl.wants.length - 1] || null]); }, [offset]);
    return null;
  }
  const mount = async () => {
    const { gl, map } = fakeGl();
    getPinnedIndex.mockResolvedValue(hourly());
    const seen = [];
    const view = render(<Probe map={map} offset={0} seen={seen} gl={gl} />);
    await waitFor(() => expect(gl.wants.length).toBeGreaterThan(0));
    return { gl, map, seen, view };
  };

  test('each step: by the pre-paint layout pass the layer already wants the new hour', async () => {
    const { gl, map, seen, view } = await mount();
    for (const h of [1, 2, 3]) {
      act(() => { view.rerender(<Probe map={map} offset={h} seen={seen} gl={gl} />); });
      expect(seen[seen.length - 1]).toEqual([h, `f${h}`]);
    }
  });

  test('OFF PATH: __RAW_DISABLE_RASTER_OWN_SAME_FRAME__ asks after the paint (the layer still wants the old hour then)', async () => {
    window.__RAW_DISABLE_RASTER_OWN_SAME_FRAME__ = true;
    const { gl, map, seen, view } = await mount();
    act(() => { view.rerender(<Probe map={map} offset={1} seen={seen} gl={gl} />); });
    expect(seen[seen.length - 1]).toEqual([1, 'f0']);
    expect(gl.wants[gl.wants.length - 1]).toBe('f1');          // asked, but only after the layout pass
  });
});

describe('SCOPE (the advisor, 2026-11-14): handover and same-frame apply to fog / air temp / water temp only', () => {
  test('the scoped layers are exactly the ones this lane built', () => {
    expect(HANDOVER_LAYERS).toEqual(['fog', 'temperature', 'water_temp']);
  });

  test('pressure and satellite (live defaults) report engaged at once, as on dev; fog waits for its first drawn frame', async () => {
    delete window.__RAW_RASTER_OWN_FRAMES__;                    // pressure and satellite are ON by default: no lever
    for (const layer of ['pressure', 'satellite']) {
      const { map } = fakeGl();
      getPinnedIndex.mockReturnValue(new Promise(() => {}));   // the index never answers: dev reported engaged regardless
      const { result } = renderHook(() => useOwnRasterFrames({ mapInstance: map, layer, model: 'GFS', active: true, timeOffsetHours: 0, theme: 'dark', beforeId: undefined }));
      expect(result.current).toBe(true);
    }
    window.__RAW_RASTER_OWN_FRAMES__ = 'fog';
    const { map } = fakeGl();
    getPinnedIndex.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useOwnRasterFrames({ mapInstance: map, layer: 'fog', model: 'GFS', active: true, timeOffsetHours: 0, theme: 'dark', beforeId: undefined }));
    expect(result.current).toBe(false);
  });

  test('pressure keeps the passive step (dev): by the layout pass its layer still wants the old hour', async () => {
    delete window.__RAW_RASTER_OWN_FRAMES__;
    const { gl, map } = fakeGl();
    const H = 3600000; const t0 = Date.now() + 60000;
    getPinnedIndex.mockResolvedValue({ path: 'idx', run: 'r', frames: [-1, 0, 1, 2].map((h) => ({ valid_time: new Date(t0 + h * H).toISOString(), path: `f${h}` })) });
    const seen = [];
    function P({ offset }) {
      useOwnRasterFrames({ mapInstance: map, layer: 'pressure', model: 'GFS', active: true, timeOffsetHours: offset, theme: 'dark', beforeId: undefined });
      useLayoutEffect(() => { seen.push([offset, gl.wants[gl.wants.length - 1] || null]); }, [offset]);
      return null;
    }
    const view = render(<P offset={0} />);
    await waitFor(() => expect(gl.wants.length).toBeGreaterThan(0));
    act(() => { view.rerender(<P offset={1} />); });
    expect(seen[seen.length - 1]).toEqual([1, 'f0']);
    expect(gl.wants[gl.wants.length - 1]).toBe('f1');
  });
});

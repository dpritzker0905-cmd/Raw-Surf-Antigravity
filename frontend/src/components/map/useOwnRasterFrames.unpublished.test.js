/**
 * The ON defaults (fog for every model, EURO water and air temp) ship before their frame sets are published: the
 * publish variables are staged one per ingest run after merge. Until a set is in latest.json, the hook must let go of
 * the layer, so MapWebGL hands it back to the .om path, and never leave it drawn by nobody.
 * Contract: the hook returns `engaged`; MapWebGL drops a layer from the .om list only while that is true.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useOwnRasterFrames } from './useOwnRasterFrames';
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
});
afterEach(() => { _resetOwnRasterFramesForTest(); getPinnedIndex.mockReset(); delete window.__RAW_DISABLE_RASTER_OWN_HANDOVER__; });

function fakeGl() {
  const gl = { shown: null };
  createOwnRasterLayer.mockImplementation(() => ({
    onShown: (fn) => { gl.shown = fn; }, setLut: jest.fn(), want: jest.fn(), offerField: jest.fn(), isResident: () => false,
    setIsobarColor: jest.fn(), setDownscale: jest.fn(),
  }));
  const map = { getLayer: () => undefined, addLayer: jest.fn(), removeLayer: jest.fn(), on: jest.fn(), off: jest.fn() };
  return { gl, map };
}
const published = () => ({ path: 'idx', run: 'r', frames: [{ valid_time: new Date().toISOString(), path: 'f000' }] });

const run = (layer, model, mapInstance = null) => renderHook(() => useOwnRasterFrames({
  mapInstance, layer, model, active: true, timeOffsetHours: 0, theme: 'dark', beforeId: undefined,
}));

describe('an ON default whose set is not published yet falls back to .om', () => {
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

  test('defaults that are OFF never engage (GFS and ICON water, GFS and ICON air temp)', () => {
    for (const [layer, model] of [['water_temp', 'GFS'], ['water_temp', 'ICON'], ['temperature', 'GFS'], ['temperature', 'ICON']]) {
      expect(run(layer, model).result.current).toBe(false);
    }
    expect(getPinnedIndex).not.toHaveBeenCalled();
  });
});

test('MapWebGL hands a disengaged fog / water layer back to the .om list (the filter reads each hook\'s return)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'MapWebGL.js'), 'utf8');
  expect(src).toMatch(/const ownFog = useOwnRasterFrames\(\{[^}]*layer: 'fog'/);
  expect(src).toMatch(/const ownWaterTemp = useOwnRasterFrames\(\{[^}]*layer: 'water_temp'/);
  expect(src).toMatch(/!\(l === 'fog' && ownFog\)/);
  expect(src).toMatch(/!\(l === 'water_temp' && ownWaterTemp\)/);
});

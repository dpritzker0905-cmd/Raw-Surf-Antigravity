/**
 * The ON defaults (fog for every model, EURO water and air temp) ship before their frame sets are published: the
 * publish variables are staged one per ingest run after merge. Until a set is in latest.json, the hook must let go of
 * the layer, so MapWebGL hands it back to the .om path, and never leave it drawn by nobody.
 * Contract: the hook returns `engaged`; MapWebGL drops a layer from the .om list only while that is true.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useOwnRasterFrames } from './useOwnRasterFrames';
import { _resetOwnRasterFramesForTest, tel } from './ownRasterFrames';
import { getPinnedIndex, staticFramesBase, staticFramesEnabled, staticSetEnabled } from './staticFrames';

jest.mock('./openMeteoProtocol', () => ({ landCellMaskReady: jest.fn() }));
jest.mock('./staticFrames', () => ({
  getPinnedIndex: jest.fn(),
  loadFrameParsed: jest.fn(),
  pickIndexFrame: jest.fn(),
  staticFramesBase: jest.fn(),
  staticFramesEnabled: jest.fn(),
  staticSetEnabled: jest.fn(),
}));

beforeEach(() => {
  staticFramesBase.mockReturnValue('https://cdn.example/');
  staticFramesEnabled.mockReturnValue(true);
  staticSetEnabled.mockReturnValue(true);
});
afterEach(() => { _resetOwnRasterFramesForTest(); getPinnedIndex.mockReset(); });

const run = (layer, model) => renderHook(() => useOwnRasterFrames({
  mapInstance: null, layer, model, active: true, timeOffsetHours: 0, theme: 'dark', beforeId: undefined,
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

  test('positive control: a published set keeps the layer on our frames', async () => {
    getPinnedIndex.mockResolvedValue({ path: 'idx', run: 'r', frames: [{ valid_time: '2026-11-14T00:00:00Z', path: 'f000' }] });
    const { result } = run('fog', 'GFS');
    await waitFor(() => expect(getPinnedIndex).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe(true);
    expect(tel().misses.no_index).toBeUndefined();
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

/**
 * ICON rain from our own 0.125-degree DWD frames, ON by default with NO Open-Meteo fallback (2026-11-18; the owner: "cut
 * Open-Meteo out of all user data"; the director's order: ICON air temperature, then rain ICON 0.125).
 * Pins: the set key, the default (ICON only), the off-main-thread decode, the GFS stand-in past ICON's range (labelled), and that
 * no kill ever hands the layer to the .om path (the .om layer list drops it under every kill).
 */
import { renderHook } from '@testing-library/react';
import {
  OWN_RASTER_SETS, PRECIP_FIELD, ownFramesOn, ownOnlyFor, setKey, combinedFrames, _resetOwnRasterFramesForTest,
} from './ownRasterFrames';
import { RASTER_SET_KEYS } from './staticRasterSets';
import { useOwnRasterLayers } from './useOwnRasterLayers';
import { getPinnedIndex, staticFramesBase, staticFramesEnabled, staticSetEnabled } from './staticFrames';

jest.mock('./openMeteoProtocol', () => ({ landCellMaskReady: jest.fn() }));
jest.mock('./staticFrames', () => ({
  fetchFrameBytes: jest.fn(),
  getPinnedIndex: jest.fn(),
  loadFrameParsed: jest.fn(),
  markStaticPinStale: jest.fn(),
  pickIndexFrame: jest.fn(),
  staticFramesBase: jest.fn(),
  staticFramesEnabled: jest.fn(),
  staticSetEnabled: jest.fn(),
}));

const ICON_RAIN = 'ICON/weather/precipitation/global_0p125';

beforeEach(() => {
  staticFramesBase.mockReturnValue('https://cdn.example/');
  staticFramesEnabled.mockReturnValue(true);
  staticSetEnabled.mockReturnValue(true);
  getPinnedIndex.mockResolvedValue(null);
});

afterEach(() => {
  _resetOwnRasterFramesForTest();
  getPinnedIndex.mockReset();
  delete window.__RAW_RASTER_OWN_FRAMES__;
  delete window.__RAW_DISABLE_RASTER_OWN_RAIN__;
  delete window.__RAW_DISABLE_RASTER_OWN_FRAMES__;
});

describe('ICON rain at 0.125 deg (2026-11-18)', () => {
  test('ICON reads the 0.125-degree set, listed in the static store; field 10 in mm/h; decoded off the main thread', () => {
    expect(setKey('rain', 'ICON')).toBe(ICON_RAIN);
    expect(RASTER_SET_KEYS).toContain(ICON_RAIN);
    expect(OWN_RASTER_SETS.rain.field).toBe(PRECIP_FIELD);
    expect(OWN_RASTER_SETS.rain.unit).toBe('mm/h');
    expect(OWN_RASTER_SETS.rain.workerDecode).toBe(true);
  });

  test('ON by default for ICON only, own frames only for ICON; GFS and EURO rain unchanged (dark, .om)', () => {
    expect(ownFramesOn('rain', 'ICON')).toBe(true);
    expect(ownOnlyFor('rain', 'ICON')).toBe(true);
    for (const m of ['GFS', 'EURO']) {
      expect(ownFramesOn('rain', m)).toBe(false);
      expect(ownOnlyFor('rain', m)).toBe(false);
    }
  });

  test('past ICON\'s last frame the GFS frame stands in, labelled as an estimate (the rain layer\'s rule)', () => {
    const t = (h) => new Date(Date.UTC(2026, 10, 18, 12) + h * 3600e3).toISOString();
    const icon = { frames: [{ valid_time: t(177), path: 'i177' }, { valid_time: t(180), path: 'i180' }] };
    const gfs = { frames: [{ valid_time: t(180), path: 'g180' }, { valid_time: t(183), path: 'g183' }] };
    const c = combinedFrames('rain', 'ICON', icon, gfs);
    expect(c.map((f) => f.path)).toEqual(['i177', 'i180', 'g183']);
    expect(c[1]).toMatchObject({ model: 'ICON', estimated: null, setKey: ICON_RAIN });
    expect(c[2]).toMatchObject({ model: 'GFS', estimated: 'gfs_estimated_fallback' });
  });

  test('THE KILL NEVER REQUESTS .om: with ICON picked the .om list drops rain under every kill; GFS keeps it', () => {
    const omLayersFor = (model) => renderHook(() => useOwnRasterLayers({
      mapInstance: null, activeModel: model, activeLayers: ['rain'], timeOffsetHours: 0, theme: 'dark',
    })).result.current;
    for (const kill of [null, '__RAW_DISABLE_RASTER_OWN_RAIN__', '__RAW_DISABLE_RASTER_OWN_FRAMES__']) {
      if (kill) window[kill] = true;
      try {
        expect(omLayersFor('ICON')).toEqual([]);
        expect(omLayersFor('GFS')).toEqual(['rain']);
      } finally {
        if (kill) delete window[kill];
      }
    }
    staticSetEnabled.mockImplementation((key) => key !== ICON_RAIN);   // the per-set kill
    expect(omLayersFor('ICON')).toEqual([]);
    staticFramesEnabled.mockReturnValue(false);                         // the static-frames global kill
    expect(omLayersFor('ICON')).toEqual([]);
  });
});

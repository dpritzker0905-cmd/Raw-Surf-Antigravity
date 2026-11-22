/**
 * EURO cloud cover (the 'satellite' layer) from our own ECMWF tcc frames, ON with NO Open-Meteo fallback (2026-11-18; the owner:
 * "cut Open-Meteo out of all user data"; the director's order after ICON temperature and ICON rain).
 * Pins: the set key, ON for EURO through the default-on layer, own-only for EURO only, no stand-in past 240 h, and that no kill
 * ever hands EURO cloud to the .om path (the .om layer list drops it under every kill). GFS cloud keeps its behaviour.
 */
import { renderHook } from '@testing-library/react';
import { OWN_RASTER_SETS, CLOUD_FIELD, ownFramesOn, ownOnlyFor, setKey, combinedFrames, _resetOwnRasterFramesForTest } from './ownRasterFrames';
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

const EURO_CLOUD = 'EURO/weather/cloud_cover/global_0p25';

beforeEach(() => {
  staticFramesBase.mockReturnValue('https://cdn.example/');
  staticFramesEnabled.mockReturnValue(true);
  staticSetEnabled.mockReturnValue(true);
  getPinnedIndex.mockResolvedValue(null);
});

afterEach(() => {
  _resetOwnRasterFramesForTest();
  getPinnedIndex.mockReset();
  delete window.__RAW_DISABLE_RASTER_OWN_SATELLITE__;
  delete window.__RAW_DISABLE_RASTER_OWN_FRAMES__;
});

describe('EURO cloud cover (2026-11-18)', () => {
  test('EURO reads the ECMWF tcc set, listed in the static store; field 8 in %', () => {
    expect(setKey('satellite', 'EURO')).toBe(EURO_CLOUD);
    expect(RASTER_SET_KEYS).toContain(EURO_CLOUD);
    expect(OWN_RASTER_SETS.satellite.field).toBe(CLOUD_FIELD);
    expect(OWN_RASTER_SETS.satellite.unit).toBe('%');
  });

  test('ON for EURO with no lever; own frames only for GFS, EURO and ICON; ICON has no set yet, so it draws the labelled GFS fill', () => {
    expect(ownFramesOn('satellite', 'EURO')).toBe(true);
    expect(ownOnlyFor('satellite', 'EURO')).toBe(true);
    expect(ownOnlyFor('satellite', 'GFS')).toBe(true);
    expect(ownOnlyFor('satellite', 'ICON')).toBe(true);
    expect(ownFramesOn('satellite', 'ICON')).toBe(true);    // no ICON set: on through its gap fill (GFS cloud, labelled; 2026-11-22)
  });

  test('past EURO\'s 240 h: the EURO-anchored GFS prediction, labelled (the 2026-11-22 gap fill), never blank and never .om', () => {
    const t = (h) => new Date(Date.UTC(2026, 10, 18, 12) + h * 3600e3).toISOString();
    const euro = { frames: [{ valid_time: t(222), path: 'e222' }, { valid_time: t(234), path: 'e234' }, { valid_time: t(240), path: 'e240' }] };
    const gfs = { frames: [{ valid_time: t(222), path: 'g222' }, { valid_time: t(240), path: 'g240' }, { valid_time: t(246), path: 'g246' }] };
    const c = combinedFrames('satellite', 'EURO', euro, gfs);
    expect(c.map((f) => f.estimated)).toEqual([null, null, null, 'euro_anchored_gfs']);
    expect(c[3]).toMatchObject({ model: 'EURO+GFS', gap: true });
    expect(c[3].parts).toMatchObject({ fillAnchor: { path: 'g222' }, modelAnchor: { path: 'e222' }, clamp: [0, 100] });   // same UTC hour
    expect(c[3].parts.weight).toBeCloseTo(1 - 6 / 120);
  });

  test('THE KILL NEVER REQUESTS .om: with EURO or GFS picked the .om list drops cloud under every kill and on a miss', () => {
    const omLayersFor = (model) => renderHook(() => useOwnRasterLayers({
      mapInstance: null, activeModel: model, activeLayers: ['satellite'], timeOffsetHours: 0, theme: 'dark',
    })).result.current;
    for (const model of ['EURO', 'GFS']) {
      expect(omLayersFor(model)).toEqual([]);                            // a miss (no published index): unavailable, not .om
      for (const kill of ['__RAW_DISABLE_RASTER_OWN_SATELLITE__', '__RAW_DISABLE_RASTER_OWN_FRAMES__']) {
        window[kill] = true;
        try { expect(omLayersFor(model)).toEqual([]); } finally { delete window[kill]; }
      }
    }
    expect(omLayersFor('ICON')).toEqual([]);                            // no ICON cloud set yet: the labelled GFS fill, never .om
    staticSetEnabled.mockReturnValue(false);                             // the per-set kills
    expect(omLayersFor('EURO')).toEqual([]);
    expect(omLayersFor('GFS')).toEqual([]);
    staticSetEnabled.mockReturnValue(true);
    staticFramesEnabled.mockReturnValue(false);                          // the static-frames global kill
    expect(omLayersFor('EURO')).toEqual([]);
    expect(omLayersFor('GFS')).toEqual([]);
  });
});

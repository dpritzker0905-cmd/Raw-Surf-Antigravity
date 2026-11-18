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

  test('ON for EURO with no lever; own frames only for EURO; GFS cloud unchanged; ICON has no set', () => {
    expect(ownFramesOn('satellite', 'EURO')).toBe(true);
    expect(ownOnlyFor('satellite', 'EURO')).toBe(true);
    expect(ownOnlyFor('satellite', 'GFS')).toBe(false);
    expect(ownFramesOn('satellite', 'ICON')).toBe(false);
  });

  test('no stand-in past EURO\'s 240 h (the layer has no fallback model): those hours say unavailable', () => {
    const t = (h) => new Date(Date.UTC(2026, 10, 18, 12) + h * 3600e3).toISOString();
    const euro = { frames: [{ valid_time: t(234), path: 'e234' }, { valid_time: t(240), path: 'e240' }] };
    const gfs = { frames: [{ valid_time: t(243), path: 'g243' }] };
    expect(combinedFrames('satellite', 'EURO', euro, gfs).map((f) => f.path)).toEqual(['e234', 'e240']);
  });

  test('THE KILL NEVER REQUESTS .om: with EURO picked the .om list drops cloud under every kill; GFS cloud keeps today\'s rule', () => {
    const omLayersFor = (model) => renderHook(() => useOwnRasterLayers({
      mapInstance: null, activeModel: model, activeLayers: ['satellite'], timeOffsetHours: 0, theme: 'dark',
    })).result.current;
    for (const kill of [null, '__RAW_DISABLE_RASTER_OWN_SATELLITE__', '__RAW_DISABLE_RASTER_OWN_FRAMES__']) {
      if (kill) window[kill] = true;
      try {
        expect(omLayersFor('EURO')).toEqual([]);
      } finally {
        if (kill) delete window[kill];
      }
    }
    window.__RAW_DISABLE_RASTER_OWN_SATELLITE__ = true;   // GFS cloud: its kill still releases it to .om, as before this PR
    try { expect(omLayersFor('GFS')).toEqual(['satellite']); } finally { delete window.__RAW_DISABLE_RASTER_OWN_SATELLITE__; }
    staticSetEnabled.mockImplementation((key) => key !== EURO_CLOUD);   // the per-set kill
    expect(omLayersFor('EURO')).toEqual([]);
    staticFramesEnabled.mockReturnValue(false);                          // the static-frames global kill
    expect(omLayersFor('EURO')).toEqual([]);
  });
});

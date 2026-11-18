/**
 * ICON air temperature from our own 0.125-degree DWD frames, ON by default (2026-11-18; the owner: "No user data should be
 * open-meteo"; the director assigned the flip after #998's verification found the client read none of the new sets).
 * Pins: the set key, the default (ICON only), the kill back to the .om path, the off-main-thread decode, and the phone memory cap.
 */
import {
  OWN_RASTER_SETS, DEFAULT_ON_MODELS, HANDHELD_NODE_BUDGET, TEMP_FIELD, ownFramesOn, ownOnlyFor, setKey, loadField, getField,
  _resetOwnRasterFramesForTest,
} from './ownRasterFrames';
import { RASTER_SET_KEYS } from './staticRasterSets';
import { fetchFrameBytes, loadFrameParsed, staticFramesBase, staticFramesEnabled, staticSetEnabled } from './staticFrames';
import { decodeOwnField, decodeWorkerKilled } from './ownRasterDecode';
import { isHandheldDevice } from './deviceTier';

jest.mock('./openMeteoProtocol', () => ({ landCellMaskReady: jest.fn() }));
jest.mock('./staticFrames', () => ({
  fetchFrameBytes: jest.fn(),
  getPinnedIndex: jest.fn(),
  loadFrameParsed: jest.fn(),
  markStaticPinStale: jest.fn(),
  staticFramesBase: jest.fn(),
  staticFramesEnabled: jest.fn(),
  staticSetEnabled: jest.fn(),
}));
jest.mock('./ownRasterDecode', () => ({ decodeOwnField: jest.fn(), decodeWorkerKilled: jest.fn() }));
jest.mock('./deviceTier', () => ({ isHandheldDevice: jest.fn(), isWeakDevice: jest.fn() }));

const ICON_0P125 = 'ICON/weather/temperature/global_0p125';
const NODES_0P125 = 2880 * 1441;
const VALID = '2026-11-18T12:00:00Z';
const frame = (i) => ({ path: `v1/icon/weather/temperature/global_0p125/f${i}.bin`, valid_time: VALID, setKey: ICON_0P125 });
// A decoded field the size of a 0.125-degree frame without allocating 16 MB per test field: the LRU only reads values.length.
const field0p125 = () => ({ values: { length: NODES_0P125 }, validMs: Date.parse(VALID), cols: 2880, rows: 1441 });

beforeEach(() => {
  staticFramesBase.mockReturnValue('https://cdn.example/');
  staticFramesEnabled.mockReturnValue(true);
  staticSetEnabled.mockReturnValue(true);
  decodeWorkerKilled.mockReturnValue(false);
  isHandheldDevice.mockReturnValue(false);
  fetchFrameBytes.mockResolvedValue({ buffer: new ArrayBuffer(8), wire: 100 });
  decodeOwnField.mockImplementation(async () => field0p125());
});

afterEach(() => {
  _resetOwnRasterFramesForTest();
  delete window.__RAW_DISABLE_RASTER_OWN_TEMPERATURE__;
  delete window.__RAW_DISABLE_RASTER_OWN_FRAMES__;
  delete window.__RAW_RASTER_OWN_FRAMES__;
});

describe('ICON air temperature at 0.125 deg (2026-11-18)', () => {
  test('ICON reads the 0.125-degree set, which the static store lists; GFS and EURO keep their sets', () => {
    expect(setKey('temperature', 'ICON')).toBe(ICON_0P125);
    expect(RASTER_SET_KEYS).toContain(ICON_0P125);
    expect(setKey('temperature', 'GFS')).toBe('GFS/weather/temperature/global_0p5');
    expect(setKey('temperature', 'EURO')).toBe('EURO/weather/temperature/global_0p25');
    expect(OWN_RASTER_SETS.temperature.field).toBe(TEMP_FIELD);
  });

  test('own frames ONLY for ICON temperature (no .om fallback); GFS / EURO temperature keep their .om path; gusts stay own-only', () => {
    expect(ownOnlyFor('temperature', 'ICON')).toBe(true);
    expect(ownOnlyFor('temperature', 'icon')).toBe(true);
    expect(ownOnlyFor('temperature', 'GFS')).toBe(false);
    expect(ownOnlyFor('temperature', 'EURO')).toBe(false);
    expect(ownOnlyFor('gusts', 'GFS')).toBe(true);
    expect(ownOnlyFor('fog', 'ICON')).toBe(false);
    expect(ownOnlyFor('nope', 'ICON')).toBe(false);
  });

  test('ON by default for ICON only, with no lever', () => {
    expect(DEFAULT_ON_MODELS).toEqual({ temperature: ['ICON'] });
    expect(ownFramesOn('temperature', 'ICON')).toBe(true);
    expect(ownFramesOn('temperature', 'GFS')).toBe(false);    // the .om gfs013 is finer than the 0.5-degree set
    expect(ownFramesOn('temperature', 'EURO')).toBe(false);   // pending the owner (vote split 2026-11-14)
  });

  test('KILL: the temperature kill, the global kill or the per-set kill stops our ICON frames (unavailable; never .om: see the unpublished suite)', () => {
    window.__RAW_DISABLE_RASTER_OWN_TEMPERATURE__ = true;
    expect(ownFramesOn('temperature', 'ICON')).toBe(false);
    delete window.__RAW_DISABLE_RASTER_OWN_TEMPERATURE__;
    window.__RAW_DISABLE_RASTER_OWN_FRAMES__ = true;
    expect(ownFramesOn('temperature', 'ICON')).toBe(false);
    delete window.__RAW_DISABLE_RASTER_OWN_FRAMES__;
    staticSetEnabled.mockImplementation((key) => key !== ICON_0P125);
    expect(ownFramesOn('temperature', 'ICON')).toBe(false);
    staticSetEnabled.mockReturnValue(true);
    expect(ownFramesOn('temperature', 'ICON')).toBe(true);    // and back on when the kills clear
  });

  test('a frame decodes only its drawn field off the main thread; the worker kill falls back to the shared path', async () => {
    const got = await loadField('temperature', frame(0), 'high');
    expect(got.values.length).toBe(NODES_0P125);
    expect(fetchFrameBytes).toHaveBeenCalledTimes(1);
    expect(decodeOwnField).toHaveBeenCalledWith(expect.any(ArrayBuffer), TEMP_FIELD, expect.any(Number));
    expect(loadFrameParsed).not.toHaveBeenCalled();
    decodeWorkerKilled.mockReturnValue(true);
    loadFrameParsed.mockResolvedValue(null);
    await loadField('temperature', frame(1), 'high');
    expect(loadFrameParsed).toHaveBeenCalledTimes(1);
  });

  test('a frame whose valid time is not its index entry is refused', async () => {
    decodeOwnField.mockImplementation(async () => ({ ...field0p125(), validMs: Date.parse(VALID) + 3 * 3600e3 }));
    expect(await loadField('temperature', frame(0), 'high')).toBeNull();
  });
});

describe('phone memory cap (HANDHELD_NODE_BUDGET)', () => {
  test('a handheld holds at most four 0.125-degree fields; the +-1 window (3) always fits; the newest are kept', async () => {
    isHandheldDevice.mockReturnValue(true);
    expect(HANDHELD_NODE_BUDGET).toBe(4 * NODES_0P125);
    for (let i = 0; i < 6; i++) await loadField('temperature', frame(i), 'high');
    const held = [0, 1, 2, 3, 4, 5].filter((i) => getField(frame(i).path));
    expect(held).toEqual([2, 3, 4, 5]);
  });

  test('desktop keeps the frame-count LRU (six)', async () => {
    for (let i = 0; i < 7; i++) await loadField('temperature', frame(i), 'high');
    expect([0, 1, 2, 3, 4, 5, 6].filter((i) => getField(frame(i).path))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('0.25-degree fields never reach the budget on a handheld (unchanged behaviour)', async () => {
    isHandheldDevice.mockReturnValue(true);
    decodeOwnField.mockImplementation(async () => ({ values: { length: 1440 * 721 }, validMs: Date.parse(VALID) }));
    for (let i = 0; i < 7; i++) await loadField('temperature', frame(i), 'high');
    expect([0, 1, 2, 3, 4, 5, 6].filter((i) => getField(frame(i).path))).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

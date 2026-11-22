/**
 * THE GAP FILL (2026-11-22, ownRasterGapFill.js): the owner's ruling on #1071, "no blanks, no Open-Meteo; fill with the clearly
 * labelled prediction". ICON air temperature, ICON rain and EURO / ICON cloud: every hour of the scrubber gets a value from OUR
 * frames, and the status line and the legend credit say whose it is.
 */
import { renderHook, waitFor } from '@testing-library/react';
import {
  ANCHOR_DECAY_HOURS, anchoredField, basisFor, gapFillFrameAt, gapFillFrames, sampleBox,
} from './ownRasterGapFill';
import {
  _resetOwnRasterFramesForTest, combinedFrameAt, combinedFrames, framesOf, gapFillFor, gapFillIndex, getEngaged, ownFramesOn, setEngaged,
} from './ownRasterFrames';
import { useOwnRasterFrames } from './useOwnRasterFrames';
import { useOwnRasterLayers } from './useOwnRasterLayers';
import { creditFor } from './LayerDataCredit';
import { describeRasterFrame, getRasterDrawn } from './rasterDrawnFrame';
import { ESTIMATE_WORDS } from './drawnFrameReadout';
import { getPinnedIndex, staticFramesBase, staticFramesEnabled, staticSetEnabled } from './staticFrames';

jest.mock('./openMeteoProtocol', () => ({ landCellMaskReady: jest.fn() }));
jest.mock('./staticFrames', () => ({
  getPinnedIndex: jest.fn(), loadFrameParsed: jest.fn(), fetchFrameBytes: jest.fn(), markStaticPinStale: jest.fn(),
  staticFramesBase: jest.fn(), staticFramesEnabled: jest.fn(), staticSetEnabled: jest.fn(),
}));

const ICON_T = 'ICON/weather/temperature/global_0p125';
const ICON_T_COARSE = 'ICON/weather/temperature/global_0p5';
const GFS_T = 'GFS/weather/temperature/global_0p5';
const ICON_R = 'ICON/weather/precipitation/global_0p125';
const GFS_R = 'GFS/weather/precipitation/global_0p25';
const T0 = Date.UTC(2026, 10, 22, 0);
const t = (h) => new Date(T0 + h * 3600e3).toISOString();
const idx = (prefix, hours) => ({ path: `${prefix}-idx`, run: 'r', frames: hours.map((h) => ({ valid_time: t(h), path: `${prefix}${h}` })) });
const KILL = '__RAW_DISABLE_RASTER_OWN_GAP_FILL__';

beforeEach(() => {
  staticFramesBase.mockReturnValue('https://cdn.example/');
  staticFramesEnabled.mockReturnValue(true);
  staticSetEnabled.mockReturnValue(true);
});
afterEach(() => { _resetOwnRasterFramesForTest(); getPinnedIndex.mockReset(); delete window[KILL]; });

describe('what counts as a gap and what fills it', () => {
  test('RANGE: past ICON\'s 180 h, air temperature draws the ICON-anchored GFS prediction, weighted down to GFS over 5 days', () => {
    const c = combinedFrames('temperature', 'ICON', idx('i', [174, 177, 180]), idx('g', [177, 180, 183, 240, 300, 303]));
    expect(c.map((f) => f.estimated)).toEqual([null, null, null, 'icon_anchored_gfs', 'icon_anchored_gfs', 'gfs_estimated_fallback', 'gfs_estimated_fallback']);
    const p183 = c[3];
    expect(p183).toMatchObject({ model: 'ICON+GFS', gap: true, setKey: GFS_T });
    expect(p183.parts).toMatchObject({ now: { path: 'g183' }, fillAnchor: { path: 'g180' }, modelAnchor: { path: 'i180', setKey: ICON_T } });
    expect(p183.parts.weight).toBeCloseTo(1 - 3 / ANCHOR_DECAY_HOURS);
    expect(c[4].parts.weight).toBeCloseTo(1 - 60 / ANCHOR_DECAY_HOURS);
    expect(c[5]).toMatchObject({ path: 'g300', model: 'GFS', gap: true });   // 120 h on, the offset has decayed: GFS, said so
  });

  test('every hour of the 14 days has a frame: own inside ICON\'s range, the fill past it (never null, never .om)', () => {
    const c = combinedFrames('temperature', 'ICON', idx('i', [0, 3, 6, 180]), idx('g', Array.from({ length: 113 }, (_, k) => k * 3)));
    for (let h = 0; h <= 336; h += 1) expect(combinedFrameAt(c, T0 + h * 3600e3)).not.toBeNull();
    expect(combinedFrameAt(c, T0 + 2 * 3600e3).path).toBe('i3');          // own wins within 3 h
    expect(combinedFrameAt(c, T0 + 90 * 3600e3).estimated).toBe('icon_anchored_gfs');   // a HOLE inside the range: anchored to i6
    expect(combinedFrameAt(c, T0 + 90 * 3600e3).parts.modelAnchor.path).toBe('i6');
  });

  test('HOLE in ICON rain: a labelled GFS frame, never an offset (rain is not added to)', () => {
    const c = combinedFrames('rain', 'ICON', idx('i', [0, 1, 2, 30]), idx('g', [0, 12, 30, 183]));
    const hole = combinedFrameAt(c, T0 + 12 * 3600e3);
    expect(hole).toMatchObject({ path: 'g12', model: 'GFS', estimated: 'icon_gfs_gap_fill', setKey: GFS_R });
    expect(hole.parts).toBeUndefined();
    expect(combinedFrameAt(c, T0 + 183 * 3600e3)).toMatchObject({ path: 'g183', estimated: 'gfs_estimated_fallback' });
  });

  test('SET: no ICON index at all draws GFS for every hour, labelled; a coarse ICON set is preferred where it exists', () => {
    const none = combinedFrames('rain', 'ICON', null, idx('g', [0, 3]));
    expect(none.map((f) => [f.path, f.estimated])).toEqual([['g0', 'icon_gfs_gap_fill'], ['g3', 'icon_gfs_gap_fill']]);
    const coarse = { ...idx('c', [0, 3, 180]), __coarse: true };
    const c = combinedFrames('temperature', 'ICON', coarse, idx('g', [180, 186]));
    expect(c[0]).toMatchObject({ path: 'c0', setKey: ICON_T_COARSE, estimated: 'icon_coarser_set', coarse: true });
    expect(combinedFrameAt(c, T0)).toMatchObject({ path: 'c0', estimated: 'icon_coarser_set' });
    expect(c[3].parts.modelAnchor).toMatchObject({ path: 'c180', setKey: ICON_T_COARSE });
  });

  test('ICON cloud has no set of its own: on through the GFS fill, every frame labelled', () => {
    expect(ownFramesOn('satellite', 'ICON')).toBe(true);
    const c = combinedFrames('satellite', 'ICON', null, idx('g', [0, 3]));
    expect(c.every((f) => f.estimated === 'icon_gfs_gap_fill' && f.model === 'GFS')).toBe(true);
  });

  test('GFS and EURO rain, and GFS / EURO air temperature, have no gap fill (unchanged)', () => {
    for (const [l, m] of [['rain', 'GFS'], ['rain', 'EURO'], ['temperature', 'GFS'], ['temperature', 'EURO'], ['satellite', 'GFS'], ['pressure', 'ICON']]) {
      expect(gapFillFor(l, m)).toBeNull();
    }
  });
});

describe('the anchored prediction field', () => {
  const grid = (cols, rows, values, extra = {}) => ({ cols, rows, bounds: { west: 0, south: 0, east: cols - 1, north: rows - 1 }, values: Float32Array.from(values), ...extra });

  test('GFS(t) + w * (MODEL(t0) - GFS(t0)): equal to the model at the seam (w = 1), GFS once decayed (w = 0)', () => {
    const now = grid(2, 1, [10, 20]); const gA = grid(2, 1, [11, 19]); const mA = grid(2, 1, [14, 16]);
    expect(Array.from(anchoredField(now, gA, mA, 1, null).values)).toEqual([13, 17]);
    expect(Array.from(anchoredField(now, gA, mA, 0, null).values)).toEqual([10, 20]);
    expect(Array.from(anchoredField(now, gA, mA, 0.5, null).values)).toEqual([11.5, 18.5]);
    const seam = anchoredField(gA, gA, mA, 1, null);                       // at the anchor hour itself: the model's own field
    expect(Array.from(seam.values)).toEqual([14, 16]);
  });

  test('cloud is clamped to 0-100 %; a node GFS lacks stays missing; a node the anchors lack keeps GFS', () => {
    const now = grid(3, 1, [95, -9999, 40]); const gA = grid(3, 1, [50, 50, -9999]); const mA = grid(3, 1, [90, 90, 90]);
    const f = anchoredField(now, gA, mA, 1, [0, 100]);
    expect(Array.from(f.values)).toEqual([100, -9999, 40]);
    expect([f.min, f.max]).toEqual([40, 100]);
  });

  test('a finer model anchor is box-averaged onto the GFS grid (0.125 onto 0.5 deg: the 5 x 5 nodes around each)', () => {
    const fine = { cols: 9, rows: 1, bounds: { west: 0, south: 0, east: 2, north: 0 }, values: Float32Array.from([1, 1, 1, 1, 5, 9, 9, 9, 9]) };
    expect(sampleBox(fine, 1, 0, 2)).toBeCloseTo((1 + 1 + 5 + 9 + 9) / 5);
    expect(sampleBox(fine, 0, 0, 0)).toBe(1);
  });
});

describe('the label: status line and legend credit, every source named, never Open-Meteo', () => {
  test('each basis has its own words, naming the model whose frames are missing and that GFS is shown', () => {
    for (const k of [basisFor.coarse('ICON'), basisFor.anchored('ICON'), basisFor.anchored('EURO'), basisFor.hole('ICON'), basisFor.hole('EURO')]) {
      expect(ESTIMATE_WORDS[k]).toBeTruthy();
    }
    expect(ESTIMATE_WORDS.icon_anchored_gfs).toMatch(/^ICON prediction: NOAA GFS trend anchored to ICON/);
    const shown = { url: 'x', dataMs: T0, model: 'ICON+GFS', estimated: 'icon_anchored_gfs', fill: true };
    expect(describeRasterFrame({ layer: 'temperature', shown, want: shown }, 'temperature', T0))
      .toEqual({ state: 'estimated', fill: true, text: 'Estimated forecast: ICON prediction: NOAA GFS trend anchored to ICON’s last frame' });
  });

  test('the credit names DWD and NOAA for an ICON prediction, ECMWF (CC BY) and NOAA for a EURO one, NOAA for a stand-in', () => {
    setEngaged('temperature', 'ICON+GFS:fill:ICON');
    const c = creditFor('temperature');
    expect(c.text).toBe('ICON · Datenbasis: Deutscher Wetterdienst + NOAA GFS · ICON prediction');
    expect(c.label).toMatch(/^Estimated: ICON prediction where ICON's own frames end/);
    expect(c.label).toMatch(/Deutscher Wetterdienst.*NOAA NCEP Global Forecast System/);
    setEngaged('satellite', 'EURO+GFS:fill:EURO');
    expect(creditFor('satellite').text).toBe('EURO · © ECMWF · CC BY 4.0 + NOAA GFS · EURO prediction');
    setEngaged('rain', 'GFS:fill:ICON');
    expect(creditFor('rain').text).toBe('NOAA GFS · stand-in for ICON');
    for (const l of ['temperature', 'satellite', 'rain']) expect(creditFor(l).text).not.toMatch(/Open-Meteo/);
  });
});

describe('through the hook (the advisor\'s HOLD on #1075: the stand-in must load in the DEFAULT configuration)', () => {
  const run = (layer, model) => renderHook(() => useOwnRasterFrames({
    mapInstance: null, layer, model, active: true, timeOffsetHours: 0, theme: 'dark', beforeId: undefined,
  }));

  test('ICON rain with no lever reads GFS rain\'s index for its gaps, though GFS rain itself is off by default', async () => {
    delete window.__RAW_RASTER_OWN_FRAMES__;
    expect(ownFramesOn('rain', 'GFS')).toBe(false);
    getPinnedIndex.mockImplementation(async (key) => (key === ICON_R ? idx('i', [0, 180]) : key === GFS_R ? idx('g', [0, 183]) : null));
    const { result } = run('rain', 'ICON');
    await waitFor(() => expect(getPinnedIndex).toHaveBeenCalledWith(GFS_R));
    expect(result.current).toBe(true);
  });

  test('ICON air temperature with its 0.125 set unpublished: the coarse ICON set, then GFS; drawing, not "unavailable"', async () => {
    delete window.__RAW_RASTER_OWN_FRAMES__;
    getPinnedIndex.mockImplementation(async (key) => (key === ICON_T ? null : key === ICON_T_COARSE ? idx('c', [0]) : key === GFS_T ? idx('g', [0, 3]) : null));
    const { result } = run('temperature', 'ICON');
    await waitFor(() => expect(getPinnedIndex).toHaveBeenCalledWith(ICON_T_COARSE));
    await waitFor(() => expect(getEngaged().temperature).toBe('ICON'));   // drawing: the credit names ICON's own source
    expect(result.current).toBe(true);
    const r = getRasterDrawn();
    expect(r && r.unavailable).toBeFalsy();
    expect((await gapFillIndex('temperature', 'ICON', 'coarse')).__coarse).toBe(true);
  });

  test('ICON air temperature with NO ICON set at all still draws (the GFS fill engages the layer)', async () => {
    delete window.__RAW_RASTER_OWN_FRAMES__;
    getPinnedIndex.mockImplementation(async (key) => (key === GFS_T ? idx('g', [0, 3]) : null));
    run('temperature', 'ICON');
    await waitFor(() => expect(getEngaged().temperature).toBe('GFS:fill:ICON'));
    expect(creditFor('temperature').text).toBe('NOAA GFS · stand-in for ICON');
  });

  test('THE KILL: __RAW_DISABLE_RASTER_OWN_GAP_FILL__ restores the gaps as "unavailable", and still never requests .om', async () => {
    window[KILL] = true;
    delete window.__RAW_RASTER_OWN_FRAMES__;
    expect(gapFillFor('temperature', 'ICON')).toBeNull();
    expect(ownFramesOn('satellite', 'ICON')).toBe(false);                  // ICON cloud has nothing to draw again
    const c = combinedFrames('temperature', 'ICON', idx('i', [177, 180]), idx('g', [180, 183]));
    expect(c.map((f) => f.path)).toEqual(['i177', 'i180']);                  // past 180 h: nothing (the status line says so)
    expect(combinedFrameAt(c, T0 + 190 * 3600e3)).toBeNull();
    getPinnedIndex.mockImplementation(async (key) => (key === GFS_T ? idx('g', [0]) : null));
    run('temperature', 'ICON');
    await waitFor(() => expect(getEngaged().temperature).toBe('ICON:idle'));
    expect(getPinnedIndex).not.toHaveBeenCalledWith(GFS_T);
    const om = renderHook(() => useOwnRasterLayers({ mapInstance: null, activeModel: 'ICON', activeLayers: ['temperature', 'rain', 'satellite'], timeOffsetHours: 0, theme: 'dark' }));
    expect(om.result.current).toEqual([]);                                   // no Open-Meteo for any of the three, killed or not
  });
});

test('framesOf and gapFillFrameAt agree on an empty fill (nothing invented)', () => {
  expect(gapFillFrames({ ownIndex: null, fillIndex: null, keys: { own: 'a', fill: 'b' }, model: 'ICON', sourceModel: 'ICON', anchored: true, framesOf })).toEqual([]);
  expect(gapFillFrameAt([], T0)).toBeNull();
});

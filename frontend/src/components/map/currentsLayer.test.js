// Ocean Currents layer (2026-11-15): own frames only, ON with a kill, a colour-blind-safe sequential palette per theme,
// legend in the user's unit, the Copernicus credit, and the frame's direction field in the wind layout.
import { CURRENTS_LUT, MS_PER_KN, currentsColor, currentsLegend, currentsScale } from './currentsPalette';
import { toOklch } from './WindColorRamp';
import { DEFAULT_ON_LAYERS, OWN_ONLY_LAYERS, OWN_RASTER_SETS, SPEED_FIELD, ownFramesOn, ownWindowRadius, setKey, sourceModel, windowRadius } from './ownRasterFrames';
import { RASTER_SET_KEYS } from './staticRasterSets';
import { buildStepLut, colorAtValue } from './ownRasterLayer';
import { RASTER_STATUS_LAYERS, describeRasterFrame } from './rasterDrawnFrame';
import { creditFor } from './LayerDataCredit';
import { buildWindVectors } from './staticFrameCodec';

const THEMES = ['light', 'dark', 'beach'];
afterEach(() => { delete window.__RAW_DISABLE_RASTER_OWN_CURRENTS__; });

describe('currents set and switches', () => {
  test('one Copernicus set for every model, speed field in knots, own frames only', () => {
    for (const m of ['GFS', 'EURO', 'ICON']) expect(setKey('currents', m)).toBe('CMEMS/marine/currents/global_0p25');
    expect(OWN_RASTER_SETS.currents).toMatchObject({ field: SPEED_FIELD, unit: 'kn', fallback: null, ownOnly: true });
    expect(OWN_ONLY_LAYERS).toEqual(['gusts', 'currents']);
    expect(RASTER_SET_KEYS).toContain('CMEMS/marine/currents/global_0p25');
    expect(sourceModel('currents', 'EURO')).toBe('CMEMS');
  });
  test('ships ON, and its kill turns it off', () => {
    expect(DEFAULT_ON_LAYERS).toContain('currents');
    window.__RAW_DISABLE_RASTER_OWN_CURRENTS__ = true;
    expect(ownFramesOn('currents', 'GFS')).toBe(false);
  });
  test('credits Copernicus Marine with the product DOI (its licence asks for it)', () => {
    for (const engaged of [{ currents: 'CMEMS' }, {}]) {
      const c = creditFor('currents', engaged, {});
      expect(c.text).toBe('© Copernicus Marine');
      expect(c.href).toBe('https://doi.org/10.48670/moi-00016');
      expect(c.label).toMatch(/Copernicus Marine Service Information/);
    }
  });
  test('the status line names a missing hour', () => {
    expect(RASTER_STATUS_LAYERS.has('currents')).toBe(true);
    const rec = { layer: 'currents', shown: null, want: null, unavailable: 'Currents: no forecast for this hour' };
    expect(describeRasterFrame(rec, 'currents', Date.now()).state).toBe('unavailable');
  });
});

describe('currents palette', () => {
  test.each(THEMES)('%s: lightness rises with speed (reads in order under every colour-vision deficiency and in grey)', (theme) => {
    let prev = -1;
    for (let kn = 0; kn <= 4; kn += 0.25) {
      const L = toOklch(currentsColor(kn, theme).slice(0, 3).map((x) => x / 255))[0];
      expect(L).toBeGreaterThan(prev);
      prev = L;
    }
  });
  test.each(THEMES)('%s: still water fades out, a 1 kn current is strong, above 4 kn holds the top colour', (theme) => {
    const scale = currentsScale(theme);
    expect(scale.breakpoints.length).toBe(CURRENTS_LUT.n);
    expect(colorAtValue(scale, 0)[3]).toBe(0);
    expect(colorAtValue(scale, 1)[3]).toBeGreaterThanOrEqual(0.85);
    expect(colorAtValue(scale, 6)).toEqual(colorAtValue(scale, 4));
    expect(buildStepLut(scale, CURRENTS_LUT).length).toBe(CURRENTS_LUT.n * 4);
  });
  test('dark lifts the slow end sooner than light and beach', () => {
    expect(currentsColor(0.3, 'dark')[3]).toBeGreaterThan(currentsColor(0.3, 'light')[3]);
  });
  test.each(THEMES)('%s: no veil: open-ocean drift (<= 0.2 kn) is fully transparent', (theme) => {
    for (const kn of [0, 0.1, 0.2]) expect(currentsColor(kn, theme)[3]).toBe(0);
  });
  test('legend ticks follow the unit preference; colours do not move', () => {
    const kt = currentsLegend('dark', 'ft'); const ms = currentsLegend('dark', 'm');
    expect(kt.label).toMatch(/kts/); expect(ms.label).toMatch(/m\/s/);
    expect(kt.ticks).toEqual(['0', '1', '2', '3', '4+']);
    expect(ms.ticks).toEqual(['0.0', '0.5', '1.0', '1.5', `${(4 * MS_PER_KN).toFixed(1)}+`]);
    expect(kt.gradientCSS).toBe(ms.gradientCSS);
  });
});

test('a currents frame (speed + direction TOWARD, uv convention 1) rebuilds flow vectors with the wind codec', () => {
  const parsed = { cols: 2, rows: 1, bounds: { west: 0, south: 0, east: 0.25, north: 0 }, uvConvention: 1,
    fields: { 4: new Float64Array([1, NaN]), 1: new Float64Array([90, 0]) } };
  const { vectors } = buildWindVectors(parsed);
  expect(vectors[0]).toMatchObject({ speed: 1, direction: 90, u: 1, v: 0, is_valid: true });   // eastward water: +u
  expect(vectors[1].is_valid).toBe(false);
});

jest.mock('./deviceTier', () => ({ ...jest.requireActual('./deviceTier'), isHandheldDevice: () => true }));
describe('phone prefetch for the own-only layers', () => {
  afterEach(() => { delete window.__RAW_DISABLE_OWN_ONLY_PREFETCH2__; });
  test('handhelds keep two frames ahead for gusts and currents; the live lanes keep their radius', () => {
    expect(windowRadius()).toBe(1);
    expect(ownWindowRadius('gusts')).toBe(2);
    expect(ownWindowRadius('currents')).toBe(2);
    expect(ownWindowRadius('pressure')).toBe(1);
  });
  test('its kill restores the handheld radius', () => {
    window.__RAW_DISABLE_OWN_ONLY_PREFETCH2__ = true;
    expect(ownWindowRadius('gusts')).toBe(1);
  });
});

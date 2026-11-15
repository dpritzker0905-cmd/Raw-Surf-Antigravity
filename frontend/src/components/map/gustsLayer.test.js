// Gusts layer (2026-11-15): own frames only, ON by default with a kill, the wind palette per theme, honest credit and status.
import { GUST_LUT, gustLegend, gustScale } from './gustPalette';
import { huePathStops, resolveDrawnField, resolveThemeRamp, sampleRamp } from './WindColorRamp';
const field = (theme) => huePathStops(resolveDrawnField(theme) || resolveThemeRamp(theme));
import { DEFAULT_ON_LAYERS, OWN_ONLY_LAYERS, OWN_RASTER_SETS, SPEED_FIELD, ownFramesOn, setKey, sourceModel, combinedFrames, combinedFrameAt } from './ownRasterFrames';
import { RASTER_SET_KEYS } from './staticRasterSets';
import { buildStepLut, colorAtValue } from './ownRasterLayer';
import { describeRasterFrame, RASTER_STATUS_LAYERS } from './rasterDrawnFrame';
import { creditFor } from './LayerDataCredit';

const THEMES = ['light', 'dark', 'beach'];
afterEach(() => { delete window.__RAW_DISABLE_RASTER_OWN_GUSTS__; });

describe('gusts set and switches', () => {
  test('each model reads its OWN gust set (GFS stands in past its range), field 4 in knots, own frames only', () => {
    for (const m of ['GFS', 'EURO', 'ICON']) expect(setKey('gusts', m)).toBe(`${m}/weather/gust/global_0p25`);
    expect(OWN_RASTER_SETS.gusts).toMatchObject({ field: SPEED_FIELD, unit: 'kn', fallback: 'GFS', ownOnly: true });
    for (const m of ['EURO', 'ICON']) expect(RASTER_SET_KEYS).toContain(`${m}/weather/gust/global_0p25`);
    expect(SPEED_FIELD).toBe(4);
    expect(OWN_ONLY_LAYERS).toContain('gusts');
    expect(RASTER_SET_KEYS).toContain('GFS/weather/gust/global_0p25');
  });
  test('ships ON, and its kill turns it off', () => {
    expect(DEFAULT_ON_LAYERS).toContain('gusts');
    window.__RAW_DISABLE_RASTER_OWN_GUSTS__ = true;
    expect(ownFramesOn('gusts', 'GFS')).toBe(false);
  });
  test('the source model is the set\'s (fog under EURO is NOAA\'s data); the credit names each model\'s gust definition', () => {
    expect(sourceModel('fog', 'EURO')).toBe('GFS');
    expect(sourceModel('gusts', 'EURO')).toBe('EURO');
    const idx = { frames: [{ valid_time: '2026-11-15T06:00:00Z', path: 'a.bin' }] };
    expect(combinedFrames('fog', 'ICON', idx, null)[0].model).toBe('GFS');
    expect(creditFor('gusts', { gusts: 'GFS' }, {}).text).toBe('NOAA GFS · instantaneous');
    expect(creditFor('gusts', { gusts: 'EURO' }, {}).text).toMatch(/^EURO \(ECMWF\).* · peak since last step$/);
    expect(creditFor('gusts', { gusts: 'ICON' }, {}).label).toMatch(/VMAX_10M/);
    expect(creditFor('gusts', {}, {}).text).toBe('NOAA GFS');
  });
});

describe('gust palette = the wind palette', () => {
  test.each(THEMES)('%s: each knot takes the wind HEATMAP colour (the field as drawn): faster gusts show faster-wind colours', (theme) => {
    const scale = gustScale(theme);
    const stops = field(theme);
    expect(scale.breakpoints.length).toBe(GUST_LUT.n);
    for (const kn of [0, 5, 12.5, 20, 30, 47, 63, 75]) {
      const want = sampleRamp(stops, kn);
      const got = colorAtValue(scale, kn);
      expect(got.slice(0, 3)).toEqual(want.slice(0, 3).map((x) => Math.round(x * 255)));
      expect(got[3]).toBeCloseTo(want[3], 6);
    }
    expect(colorAtValue(scale, 120)).toEqual(colorAtValue(scale, 75));   // above the ramp: the last colour holds
    const lut = buildStepLut(scale, GUST_LUT);
    expect(lut.length).toBe(GUST_LUT.n * 4);
    expect(lut[3]).toBeGreaterThan(0);
  });
  test.each(THEMES)('%s: the legend bar is built from the same wind-field stops', (theme) => {
    const g = gustLegend(theme);
    const first = field(theme)[0];
    expect(g.gradientCSS).toContain(`rgba(${Math.round(first[1] * 255)},${Math.round(first[2] * 255)},${Math.round(first[3] * 255)},${first[4]}) 0.0%`);
    expect(g.label).toMatch(/kts/);
    expect(g.ticks[g.ticks.length - 1]).toMatch(/\+$/);
  });
  test('themes differ (a themed palette, not one hardcoded set)', () => {
    expect(gustScale('light').colors[60]).not.toEqual(gustScale('dark').colors[60]);
  });
});

describe('status line for an own-only layer', () => {
  test('a miss says so instead of leaving an empty map unexplained', () => {
    expect(RASTER_STATUS_LAYERS.has('gusts')).toBe(true);
    const rec = { layer: 'gusts', shown: null, want: null, unavailable: 'Gusts: no published forecast yet' };
    expect(describeRasterFrame(rec, 'gusts', Date.now())).toEqual({ state: 'unavailable', text: 'Gusts: no published forecast yet' });
    expect(describeRasterFrame({ layer: 'fog', shown: null, want: null }, 'fog', Date.now())).toBeNull();
  });
});

describe("past each model's range: the wind layer's rules", () => {
  const H = 3600000; const RUN = Date.parse('2026-11-15T00:00:00Z');
  const iso = (h) => new Date(RUN + h * H).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const idx = (hours, pre) => ({ run_time: iso(0), frames: hours.map((h) => ({ valid_time: iso(h), path: `${pre}${h}.bin` })) });
  const iconHours = [...Array.from({ length: 78 }, (_, i) => i + 1), ...Array.from({ length: 34 }, (_, i) => 81 + 3 * i)];   // 1..78, 81..180
  test("ICON loops its own whole days to 336 h, 3-hourly, labelled as beyond ICON's native range (no GFS)", () => {
    const frames = combinedFrames('gusts', 'ICON', idx(iconHours, 'icon/'), idx([0, 3, 300], 'gfs/'));
    const tail = frames.filter((f) => f.estimated);
    expect(tail.every((f) => f.estimated === 'icon_loop_extrapolation' && f.path.startsWith('icon/') && f.model === 'ICON')).toBe(true);
    expect(tail[0].valid_time).toBe(iso(183));
    expect(tail[tail.length - 1].valid_time).toBe(iso(336));
    // span = whole days of 1..180 h = 168 h: hour 200 shows the frame of hour 1 + (199 mod 168) = 32
    expect(combinedFrameAt(frames, RUN + 201 * H).path).toBe('icon/33.bin');
    expect(combinedFrameAt(frames, RUN + 90 * H).estimated).toBeNull();   // inside the native range: the native frame
  });
  test('EURO takes the GFS stand-in past its range, labelled as such (the EURO wind tail)', () => {
    const frames = combinedFrames('gusts', 'EURO', idx([3, 6, 240], 'euro/'), idx([240, 243, 336], 'gfs/'));
    expect(frames.filter((f) => f.estimated).map((f) => [f.path, f.estimated, f.model]))
      .toEqual([['gfs/243.bin', 'gfs_estimated_fallback', 'GFS'], ['gfs/336.bin', 'gfs_estimated_fallback', 'GFS']]);
  });
});

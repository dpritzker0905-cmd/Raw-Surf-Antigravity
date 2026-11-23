// Gusts layer (2026-11-15): own frames only, ON by default with a kill, the wind palette per theme, honest credit and status.
import { GUST_LUT, GUST_LIGHT_FASTBAND, WIND_FIELD_ALPHA, gustBaseAlpha, gustLegend, gustScale, lightCompositeL, gustDarkFieldOn, gustFieldOpacity, windDarkFieldAlpha } from './gustPalette';
import { WIND_FIELD_OPACITY } from './gustParticles';
import { GUST_OPACITY_STOPS, opacityAtZoom } from './ownRasterLayer';
import { huePathStops, resolveDrawnField, resolveThemeRamp, sampleRamp } from './WindColorRamp';
const field = (theme) => huePathStops(resolveDrawnField(theme) || resolveThemeRamp(theme));
import { DEFAULT_ON_LAYERS, OWN_ONLY_LAYERS, OWN_RASTER_SETS, SPEED_FIELD, ownFramesOn, setKey, sourceModel, combinedFrames, combinedFrameAt, endNoteText } from './ownRasterFrames';
import { RASTER_SET_KEYS } from './staticRasterSets';
import { buildStepLut, colorAtValue } from './ownRasterLayer';
import { describeRasterFrame, RASTER_STATUS_LAYERS } from './rasterDrawnFrame';
import { creditFor } from './LayerDataCredit';
import { edgeNoteOn, firstFrameFirstOn } from './useOwnRasterFrames';

const THEMES = ['light', 'dark', 'beach'];
afterEach(() => { delete window.__RAW_DISABLE_RASTER_OWN_GUSTS__; });

describe('gusts set and switches', () => {
  test('each model reads its OWN gust set, field 4 in knots, own frames only', () => {
    for (const m of ['GFS', 'EURO', 'ICON']) expect(setKey('gusts', m)).toBe(`${m}/weather/gust/global_0p25`);
    expect(OWN_RASTER_SETS.gusts).toMatchObject({ field: [12, SPEED_FIELD], unit: 'kn', fallback: null, ownOnly: true });
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
    expect(creditFor('gusts', { gusts: 'EURO' }, {}).text).toMatch(/^EURO · © ECMWF · CC BY 4\.0 · peak since last step$/);
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
      // the same hue everywhere (dark's LUT holds it pre-scaled by the wind field's alpha: DARK FIELD PARITY, pinned below).
      // Alpha: dark takes the wind's law over the layer's 0.48; light and beach take the WIND FIELD's own alpha law
      // (HEATMAP_FS: base + (1 - base) x smoothstep(0, rampEnd, kn)); light above 40 kn draws lighter still (the gentler band)
      const k = theme === 'dark' ? windDarkFieldAlpha(kn) : 1;
      expect(got.slice(0, 3)).toEqual(want.slice(0, 3).map((x) => Math.round(x * k * 255)));
      if (theme === 'dark') expect(got[3]).toBeCloseTo(windDarkFieldAlpha(kn) / WIND_FIELD_OPACITY.dark, 6);
      else if (theme === 'light' && kn > 40) expect(got[3]).toBeLessThan(gustBaseAlpha(theme, kn, want));
      else expect(got[3]).toBeCloseTo(gustBaseAlpha(theme, kn, want), 6);
    }
    expect(colorAtValue(scale, 120)).toEqual(colorAtValue(scale, 75));   // above the ramp: the last colour holds
    const lut = buildStepLut(scale, GUST_LUT);
    expect(lut.length).toBe(GUST_LUT.n * 4);
    expect(lut[3]).toBeGreaterThan(0);
  });
  test.each(THEMES)('%s: the legend bar is built from the same wind-field stops', (theme) => {
    const g = gustLegend(theme);
    const first = field(theme)[0];
    const a0 = gustBaseAlpha(theme, first[0], [first[1], first[2], first[3], first[4]]);   // the field's alpha law, as the map draws it
    expect(g.gradientCSS).toContain(`rgba(${Math.round(first[1] * 255)},${Math.round(first[2] * 255)},${Math.round(first[3] * 255)},${a0}) 0.0%`);
    expect(g.label).toMatch(/kts/);
    expect(g.ticks[g.ticks.length - 1]).toMatch(/\+$/);
  });
  test('themes differ (a themed palette, not one hardcoded set)', () => {
    expect(gustScale('light').colors[60]).not.toEqual(gustScale('dark').colors[60]);
  });
});

describe('the wind field\'s alpha law on light and beach (the pink was CALM air at 1.7x the wind\'s strength)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_GUST_WIND_ALPHA__; });

  test('calm air is laid at the wind field\'s calm strength, full by its ramp end (HEATMAP_FS v3.22, pinned in the shader)', () => {
    expect(WIND_FIELD_ALPHA).toEqual({ dark: [0.44, 5], light: [0.42, 7], beach: [0.45, 7] });
    for (const theme of ['light', 'beach']) {
      const [base, end] = WIND_FIELD_ALPHA[theme];
      expect(colorAtValue(gustScale(theme), 0)[3]).toBeCloseTo(base, 6);
      expect(colorAtValue(gustScale(theme), end)[3]).toBeCloseTo(1, 6);
      expect(colorAtValue(gustScale(theme), 0)[3]).toBeLessThan(sampleRamp(field(theme), 0)[3]);   // was the table's 0.72+
    }
    const fs = require('./WebGLWindShaders').HEATMAP_FS;
    expect(fs).toContain('float alpha = u_opacity * (baseAlpha + (1.0 - baseAlpha) * smoothstep(0.0, rampEnd, speed));');
    expect(fs).toMatch(/baseAlpha = 0\.42; rampEnd = 7\.0;/);
  });

  test('dark under its own kill keeps the table\'s alpha; the kill returns light and beach to it', () => {
    window.__RAW_DISABLE_GUST_DARK_FIELD__ = true;
    for (const kn of [0, 3, 20]) expect(colorAtValue(gustScale('dark'), kn)[3]).toBeCloseTo(sampleRamp(field('dark'), kn)[3], 6);
    delete window.__RAW_DISABLE_GUST_DARK_FIELD__;
    window.__RAW_DISABLE_GUST_WIND_ALPHA__ = true;
    for (const kn of [0, 3, 20]) expect(colorAtValue(gustScale('beach'), kn)[3]).toBeCloseTo(sampleRamp(field('beach'), kn)[3], 6);
  });
});

describe('dark field parity (2026-11-22: dark gusts drew ~2x the wind field\'s colour at speed, ~10x at calm)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_GUST_DARK_FIELD__; });
  // What lands on the map, per channel, over a ground g (0..1). The WIND heatmap writes premultiplied (rgb x a, a) and blends it
  // SRC_ALPHA, ONE_MINUS_SRC_ALPHA: rgb x a^2 + g (1 - a). The gust raster writes (lut.rgb x A, A), A = lut.a x opacity, through
  // MapLibre's premultiplied blend ONE, ONE_MINUS_SRC_ALPHA: lut.rgb x A + g (1 - A).
  const windDark = (kn, g) => { const c = sampleRamp(field('dark'), kn); const a = windDarkFieldAlpha(kn); return [0, 1, 2].map((i) => c[i] * a * a + g[i] * (1 - a)); };
  const gustDark = (kn, g, opacity) => { const l = colorAtValue(gustScale('dark'), kn); const A = l[3] * opacity; return [0, 1, 2].map((i) => (l[i] / 255) * A + g[i] * (1 - A)); };
  const GROUNDS = [[93 / 255, 117 / 255, 126 / 255], [58 / 255, 71 / 255, 79 / 255], [0.02, 0.02, 0.03]];   // dark water, dark land (bench reads), near black

  test('the shaders still draw what this models (the wind heatmap premultiplies and blends by SRC_ALPHA)', () => {
    const { HEATMAP_FS } = require('./WebGLWindShaders');
    expect(HEATMAP_FS).toContain('vec4(fieldRgb * alpha, alpha)');
    expect(HEATMAP_FS).toMatch(/baseAlpha = 0\.44;\s*float rampEnd = 5\.0;/);
    const engine = require('fs').readFileSync(require('path').join(__dirname, 'WebGLWindEngine.js'), 'utf8');
    expect(engine).toContain('blendIntoMap(gl, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // field tint: multiply');
    expect(engine).toMatch(/heatmapOpacity = effectiveTheme === 'dark' \? 0\.48/);
    expect(WIND_FIELD_OPACITY.dark).toBe(0.48);
  });

  test('every knot, every ground: the gust field lands within one byte of the wind field', () => {
    const op = gustFieldOpacity('dark', 5, () => 0.56);
    expect(op).toBe(WIND_FIELD_OPACITY.dark);
    for (let kn = 0; kn <= 75; kn += 0.5) for (const g of GROUNDS) {
      const w = windDark(kn, g); const s = gustDark(kn, g, op);
      for (let i = 0; i < 3; i++) expect(Math.abs(w[i] - s[i]) * 255).toBeLessThan(1);
    }
  });

  test('before (the kill): calm drew ~10x the wind\'s colour and 20 kn about twice it', () => {
    window.__RAW_DISABLE_GUST_DARK_FIELD__ = true;
    const stops = (z) => opacityAtZoom(GUST_OPACITY_STOPS, z);
    expect(gustFieldOpacity('dark', 5, stops)).toBe(stops(5));
    const black = [0, 0, 0];
    const ratio = (kn) => gustDark(kn, black, stops(5)).reduce((a, b) => a + b) / windDark(kn, black).reduce((a, b) => a + b);
    expect(ratio(0)).toBeGreaterThan(8);
    expect(ratio(20)).toBeGreaterThan(1.8);
  });

  test('light and beach are untouched (their tint path already matched); the layer keeps its stops there', () => {
    const stops = (z) => opacityAtZoom(GUST_OPACITY_STOPS, z);
    for (const theme of ['light', 'beach']) {
      expect(gustDarkFieldOn(theme)).toBe(false);
      expect(gustFieldOpacity(theme, 7, stops)).toBe(stops(7));
    }
  });

  test('the legend bar keeps the colours (no pre-scaling), as the wind legend does', () => {
    const g = gustLegend('dark'); const first = field('dark')[0];
    expect(g.gradientCSS).toContain(`rgba(${Math.round(first[1] * 255)},${Math.round(first[2] * 255)},${Math.round(first[3] * 255)},`);
  });

  test('the gust layer is wired to draw at that opacity, decided with the LUT', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'useOwnRasterFrames.js'), 'utf8');
    expect(src).toMatch(/gustDarkFieldOn\(theme\) \? gustFieldOpacity\(theme, 2, \(\) => 0, \{\}\) : null/);
    expect(src).toContain('L.setOpacityAt(');
  });
});

describe('gentler fast band, light only (David 2026-11-18: light gusts "too dark pink in areas")', () => {
  afterEach(() => { delete window.__RAW_DISABLE_GUST_LIGHT_FASTBAND__; });
  const comp = (theme, kn) => { const s = gustScale(theme); const c = colorAtValue(s, kn); return lightCompositeL(c.slice(0, 3).map((x) => x / 255), c[3]); };

  test('above 40 kn light descends at half the slope; the order stays one way (faster = darker)', () => {
    const stops = field('light');
    const L = (kn) => { const c = sampleRamp(stops, kn); return lightCompositeL(c, gustBaseAlpha('light', kn, c)); };
    const L40 = L(40);
    for (const kn of [45, 50, 60, 75]) expect(comp('light', kn)).toBeCloseTo(L40 + (L(kn) - L40) * GUST_LIGHT_FASTBAND.slope, 0);
    let prev = Infinity;
    // each step follows the wind field's own step at half the slope (light's field is itself nearly flat, with a small rise,
    // at 40-45 kn), within the 8-bit table's quantization (0.5 kn steps, rgb to 1/255: under ~0.3 L*)
    let prevSrc = L(40);
    for (let kn = 42.5; kn <= 75; kn += 2.5) {
      const v = comp('light', kn); const src = L(kn);
      if (prev !== Infinity) expect(v - prev).toBeLessThanOrEqual((src - prevSrc) * GUST_LIGHT_FASTBAND.slope + 0.3);
      prev = v; prevSrc = src;
    }
    // the fastest gusts no longer reach the wind field's near-black maroon: half its fall from 40 kn is given back
    expect(comp('light', 75) - L(75)).toBeGreaterThan((L40 - L(75)) * 0.4);
    expect(comp('light', 75)).toBeLessThan(comp('light', 40));
  });

  test('at or under 40 kn, and in dark and beach, the band does nothing', () => {
    for (const kn of [0, 10, 25, 40]) {
      expect(colorAtValue(gustScale('light'), kn)[3]).toBeCloseTo(gustBaseAlpha('light', kn, sampleRamp(field('light'), kn)), 6);
    }
    for (const kn of [45, 60, 75]) {
      expect(colorAtValue(gustScale('beach'), kn)[3]).toBeCloseTo(gustBaseAlpha('beach', kn, sampleRamp(field('beach'), kn)), 6);
      expect(colorAtValue(gustScale('dark'), kn)[3]).toBeCloseTo(windDarkFieldAlpha(kn) / WIND_FIELD_OPACITY.dark, 6);   // dark: the wind's law (parity)
    }
  });

  test('the kill returns light to the wind field\'s law exactly; the legend follows the same rows', () => {
    window.__RAW_DISABLE_GUST_LIGHT_FASTBAND__ = true;
    for (const kn of [45, 60, 75]) {
      expect(colorAtValue(gustScale('light'), kn)[3]).toBeCloseTo(gustBaseAlpha('light', kn, sampleRamp(field('light'), kn)), 6);
    }
    const killed = gustLegend('light').gradientCSS;
    delete window.__RAW_DISABLE_GUST_LIGHT_FASTBAND__;
    expect(gustLegend('light').gradientCSS).not.toBe(killed);
    expect(gustLegend('dark').gradientCSS).toBe(gustLegend('dark').gradientCSS);
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

describe("past each model's range: NO gusts, an honest end note (never GFS, never a loop)", () => {
  const H = 3600000; const RUN = Date.parse('2026-11-15T00:00:00Z');
  const iso = (h) => new Date(RUN + h * H).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const idx = (hours, pre) => ({ run_time: iso(0), frames: hours.map((h) => ({ valid_time: iso(h), path: `${pre}${h}.bin` })) });
  const iconHours = [...Array.from({ length: 78 }, (_, i) => i + 1), ...Array.from({ length: 34 }, (_, i) => 81 + 3 * i)];   // 1..78, 81..180
  test('ICON and EURO gusts carry no stand-in: their own frames only', () => {
    expect(OWN_RASTER_SETS.gusts.fallback).toBeNull();
    const icon = combinedFrames('gusts', 'ICON', idx(iconHours, 'icon/'), idx([183, 300], 'gfs/'));
    expect(icon.every((f) => f.path.startsWith('icon/') && !f.estimated)).toBe(true);
    expect(combinedFrameAt(icon, RUN + 200 * H)).toBeNull();          // past ICON's range: nothing is drawn
    expect(combinedFrameAt(icon, RUN + 90 * H).path).toBe('icon/90.bin');
    const euro = combinedFrames('gusts', 'EURO', idx([3, 6, 240], 'euro/'), idx([243, 336], 'gfs/'));
    expect(euro.map((f) => f.path)).toEqual(['euro/3.bin', 'euro/6.bin', 'euro/240.bin']);
  });
  test('the status line names whose range ended (EURO / ICON); GFS keeps the plain words', () => {
    expect(endNoteText('gusts', 'ICON', RUN + 180 * H, RUN)).toBe('ICON gusts end at day 7.5; ensemble estimate coming');
    expect(endNoteText('gusts', 'EURO', RUN + 240 * H, RUN)).toBe('EURO gusts end at day 10; ensemble estimate coming');
    expect(endNoteText('gusts', 'GFS', RUN + 336 * H, RUN)).toBeNull();
    expect(endNoteText('pressure', 'ICON', RUN + 180 * H, RUN)).toBeNull();
  });
});

describe("the nearest-stored-forecast note at a set's edge", () => {
  afterEach(() => { delete window.__RAW_DISABLE_RASTER_EDGE_NEAREST_NOTE__; });
  test('a frame drawn 2 h from the asked hour at the end of a set says so (the note covers the whole 3 h pick window)', () => {
    expect(edgeNoteOn()).toBe(true);
    const asked = Date.parse('2026-11-29T08:00:00Z');
    const shown = { url: 'gfs/336.bin', dataMs: asked - 2 * 3600000, nearestMaxHours: 3 };
    expect(describeRasterFrame({ layer: 'gusts', shown, want: shown }, 'gusts', asked)).toMatchObject({ state: 'nearest' });
    expect(describeRasterFrame({ layer: 'gusts', shown: { ...shown, nearestMaxHours: 1 }, want: shown }, 'gusts', asked)).toBeNull();
  });
  test('its kill restores the half-gap rule', () => {
    window.__RAW_DISABLE_RASTER_EDGE_NEAREST_NOTE__ = true;
    expect(edgeNoteOn()).toBe(false);
  });
});

test('first frame first (own-only layers on a cold toggle) is on by default; its kill restores the whole window at once', () => {
  expect(firstFrameFirstOn()).toBe(true);
  window.__RAW_DISABLE_OWN_FIRST_FRAME_FIRST__ = true;
  expect(firstFrameFirstOn()).toBe(false);
  delete window.__RAW_DISABLE_OWN_FIRST_FRAME_FIRST__;
});

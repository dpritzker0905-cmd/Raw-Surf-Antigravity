/**
 * rasterPalettes: the app's own tables for air temperature (diverging around 0 C), water temperature (sequential) and fog
 * (a veil that stands off each theme's map), with legends computed from the same tables (2026-11-14). The colour-distance
 * gates are checked by scripts/raster-color (see docs/weather-program/log/2026-11-14-fable-raster-palettes.md); these pin the
 * shape of the tables, the switches, what a kill restores, and that the legend is the table.
 */
import fs from 'fs';
import path from 'path';
import { BASE_CUSTOM_COLOR_SCALES, CUSTOM_COLOR_SCALES, smoothColorScale } from './colorScales';
import {
  RASTER_LEGEND_SPEC, RASTER_PALETTE_LAYERS, __test, applyThemeRasterScales, rasterLegend, rasterPalette, rasterPaletteOn,
  rasterScaleFor, rememberLibraryRasterScales,
} from './rasterPalettes';

const { AIR_TEMP, WATER_TEMP, FOG, sampleScale, fToC } = __test;
const THEMES = ['light', 'beach', 'dark'];
const KILLS = Object.values(RASTER_PALETTE_LAYERS).map((l) => l.kill);
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const sat = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
const LIB = { temperature: { type: 'breakpoint', breakpoints: [-80, 50], colors: [[1, 2, 3, 1], [4, 5, 6, 1]] }, sea_surface_temperature: { type: 'breakpoint', breakpoints: [-80, 50], colors: [[7, 8, 9, 1], [9, 8, 7, 1]] } };

beforeEach(() => {
  for (const k of KILLS) delete window[k];
  delete window.__RAW_DISABLE_RASTER_LEGENDS__;
  delete window.__OM_PROTOCOL_SETTINGS__; delete window.__RAW_RASTER_PALETTES__;
  for (const { key } of Object.values(RASTER_PALETTE_LAYERS)) delete CUSTOM_COLOR_SCALES[key];
});

describe('the tables are well formed', () => {
  test.each([['air temp', AIR_TEMP], ['water temp', WATER_TEMP], ['fog light', FOG.light], ['fog beach', FOG.beach], ['fog dark', FOG.dark]])('%s', (_n, s) => {
    expect(s.type).toBe('breakpoint');
    expect(s.colors).toHaveLength(s.breakpoints.length);
    for (let i = 1; i < s.breakpoints.length; i += 1) expect(s.breakpoints[i]).toBeGreaterThan(s.breakpoints[i - 1]);
    for (const c of s.colors) {
      expect(c).toHaveLength(4);
      for (const k of [0, 1, 2]) { expect(Number.isInteger(c[k])).toBe(true); expect(c[k]).toBeGreaterThanOrEqual(0); expect(c[k]).toBeLessThanOrEqual(255); }
      expect(c[3]).toBeGreaterThanOrEqual(0); expect(c[3]).toBeLessThanOrEqual(1);
    }
  });

  test('air temp and water temp span the library\'s own range, so every value the old table coloured is still coloured', () => {
    for (const s of [AIR_TEMP, WATER_TEMP]) { expect(s.breakpoints[0]).toBe(-80); expect(s.breakpoints[s.breakpoints.length - 1]).toBe(50); expect(s.colors.every((c) => c[3] === 1)).toBe(true); }
  });
});

describe('air temperature diverges around 0 C', () => {
  const at = (v) => sampleScale(AIR_TEMP, v);
  test('the palest, least coloured point is 0 C, and the two sides are different colours from the first degree', () => {
    const vals = []; for (let v = -15; v <= 15; v += 0.5) vals.push(v);
    const least = vals.reduce((a, b) => (sat(at(b)) < sat(at(a)) ? b : a));
    expect(least).toBe(0);
    expect(at(-1)[2]).toBeGreaterThan(at(-1)[0] + 30);                           // below freezing: blue leads
    expect(at(1)[0]).toBeGreaterThan(at(1)[2] + 30);                             // above freezing: red and green lead
  });

  test('lightness falls one way from 0 C to -40 C and one way from 0 C to 45 C', () => {
    const cold = [0, -1, -2.5, -5, -10, -15, -20, -25, -30, -35, -40].map((v) => luma(at(v)));
    const warm = [0, 1, 2.5, 5, 10, 15, 20, 25, 30, 35, 40, 45].map((v) => luma(at(v)));
    for (const side of [cold, warm]) for (let i = 1; i < side.length; i += 1) expect(side[i]).toBeLessThan(side[i - 1]);
  });

  test('cold is blue to violet, warm is gold through red', () => {
    for (const v of [-30, -20, -10, -5]) expect(at(v)[2]).toBeGreaterThan(Math.max(at(v)[0], at(v)[1]));
    for (const v of [5, 15, 25, 35]) expect(at(v)[0]).toBeGreaterThan(at(v)[2]);
  });
});

describe('water temperature is sequential', () => {
  test('lightness rises with every degree from 0 C to 32 C', () => {
    let prev = -1;
    for (let v = 0; v <= 32; v += 1) { const l = luma(sampleScale(WATER_TEMP, v)); expect(l).toBeGreaterThan(prev); prev = l; }
  });
  test('a degree is a step: no two neighbouring degrees between 4 C and 30 C share a colour', () => {
    for (let v = 4; v < 30; v += 1) {
      const a = sampleScale(WATER_TEMP, v); const b = sampleScale(WATER_TEMP, v + 1);
      expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])).toBeGreaterThanOrEqual(12);
    }
  });
});

describe('fog is a veil that stands off each theme\'s map, strongest where visibility is lowest', () => {
  test.each(THEMES)('%s: opaque below 300 m, thinner with every step, gone from 10 km', (theme) => {
    const s = FOG[theme]; const a = (v) => sampleScale(s, v)[3];
    expect(a(100)).toBe(1); expect(a(300)).toBe(1);
    const steps = [300, 500, 800, 1000, 2000, 3000, 5000, 7500, 10000].map(a);
    for (let i = 1; i < steps.length; i += 1) expect(steps[i]).toBeLessThan(steps[i - 1]);
    expect(a(10000)).toBe(0); expect(a(20000)).toBe(0);
    expect(a(3000)).toBeGreaterThan(0.1); expect(a(3000)).toBeLessThan(0.35);    // mist: a hint, not a blanket
  });
  test('slate over the pale maps, near-white over the dark one', () => {
    expect(luma(FOG.light.colors[0])).toBeLessThan(70); expect(luma(FOG.beach.colors[0])).toBeLessThan(75);
    expect(luma(FOG.dark.colors[0])).toBeGreaterThan(235);
  });
});

describe('applying the tables', () => {
  test('each layer\'s table goes under the key the tile library looks it up by, in CUSTOM_COLOR_SCALES and the live settings', () => {
    window.__OM_PROTOCOL_SETTINGS__ = { colorScales: {} };
    for (const theme of THEMES) {
      expect(applyThemeRasterScales(theme)).toEqual({ temperature: 'palette', water_temp: 'palette', fog: 'palette' });
      expect(CUSTOM_COLOR_SCALES.temperature).toBe(AIR_TEMP);
      expect(CUSTOM_COLOR_SCALES.surface_temperature).toBe(WATER_TEMP);
      expect(CUSTOM_COLOR_SCALES.visibility).toBe(FOG[theme]);
      expect(window.__OM_PROTOCOL_SETTINGS__.colorScales).toMatchObject({ temperature: AIR_TEMP, surface_temperature: WATER_TEMP, visibility: FOG[theme] });
      expect(window.__RAW_RASTER_PALETTES__).toEqual({ theme, temperature: 'palette', water_temp: 'palette', fog: 'palette' });
    }
    expect(rasterPalette('fog', 'anything-else')).toBe(FOG.dark);
    expect(rasterPalette('rain', 'dark')).toBeNull();
  });

  test.each([
    ['__RAW_DISABLE_TEMP_PALETTE__', 'temperature', 'temperature', () => LIB.temperature],
    ['__RAW_DISABLE_WATER_TEMP_PALETTE__', 'water_temp', 'surface_temperature', () => LIB.sea_surface_temperature],
  ])('OFF PATH: %s puts back the tile library\'s own table, and only that layer\'s', (kill, layerId, key, was) => {
    rememberLibraryRasterScales(LIB);
    window.__OM_PROTOCOL_SETTINGS__ = { colorScales: {} };
    applyThemeRasterScales('light');
    window[kill] = true;
    expect(rasterPaletteOn(layerId)).toBe(false);
    const state = applyThemeRasterScales('light');
    expect(state[layerId]).toBe('before');
    expect(CUSTOM_COLOR_SCALES[key]).toBe(was());
    expect(window.__OM_PROTOCOL_SETTINGS__.colorScales[key]).toBe(was());
    for (const other of Object.keys(RASTER_PALETTE_LAYERS).filter((l) => l !== layerId)) expect(state[other]).toBe('palette');
    expect(rasterLegend(layerId, 'light')).toBeNull();                           // the caller keeps its own bar
    for (const v of [1, 'true', false, null]) { window[kill] = v; expect(rasterPaletteOn(layerId)).toBe(true); }   // only exactly true is a kill
  });

  test('OFF PATH: __RAW_DISABLE_FOG_PALETTE__ puts back the grey fog table, as before', () => {
    window.__RAW_DISABLE_FOG_PALETTE__ = true;
    expect(applyThemeRasterScales('light').fog).toBe('before');
    expect(CUSTOM_COLOR_SCALES.visibility).toEqual(smoothColorScale(BASE_CUSTOM_COLOR_SCALES.visibility, 80));
    expect(BASE_CUSTOM_COLOR_SCALES.visibility.colors[0]).toEqual([240, 240, 240, 0.85]);   // the old table itself is untouched
  });

  test('the library\'s tables are remembered once, the first time, and never replaced by ours', () => {
    rememberLibraryRasterScales(LIB);
    rememberLibraryRasterScales({ temperature: AIR_TEMP, surface_temperature: WATER_TEMP });
    window.__RAW_DISABLE_TEMP_PALETTE__ = true; window.__RAW_DISABLE_WATER_TEMP_PALETTE__ = true;
    applyThemeRasterScales('dark');
    expect(CUSTOM_COLOR_SCALES.temperature).toBe(LIB.temperature);
    expect(CUSTOM_COLOR_SCALES.surface_temperature).toBe(LIB.sea_surface_temperature);
  });

  test('the protocol remembers the library\'s tables BEFORE it merges the app\'s, and the theme effect applies ours', () => {
    const proto = fs.readFileSync(path.join(__dirname, 'openMeteoProtocol.js'), 'utf8');
    expect(proto).toMatch(/rememberLibraryRasterScales\(defaultOmProtocolSettings\.colorScales\); Object\.assign\(defaultOmProtocolSettings\.colorScales, CUSTOM_COLOR_SCALES\);/);
    const hook = fs.readFileSync(path.join(__dirname, 'useOpenMeteoTileUrls.js'), 'utf8');
    expect(hook).toMatch(/applyPrecipColorScale\(\);\s*applyThemeRasterScales\(theme\);[^\n]*\n\s*\}, \[theme\]\);/);
  });
});

describe('the legend is the table', () => {
  const stopsOf = (css) => [...css.matchAll(/rgba\((\d+),(\d+),(\d+),([\d.]+)\) ([\d.]+)%/g)].map((m) => ({ c: [+m[1], +m[2], +m[3], +m[4]], pct: +m[5] }));

  test.each(THEMES)('%s: every colour of each bar is the drawn table\'s colour at that value', (theme) => {
    for (const layerId of ['temperature', 'water_temp', 'fog']) {
      const spec = RASTER_LEGEND_SPEC[layerId]; const lg = rasterLegend(layerId, theme); const scale = rasterPalette(layerId, theme);
      const stops = stopsOf(lg.gradientCSS);
      expect(stops).toHaveLength(spec.samples + 1);
      for (const s of stops) {
        const t = s.pct / 100;
        const v = spec.log ? Math.exp(Math.log(spec.from) + t * (Math.log(spec.to) - Math.log(spec.from))) : spec.from + t * (spec.to - spec.from);
        const want = sampleScale(scale, v);
        for (const k of [0, 1, 2]) expect(Math.abs(s.c[k] - want[k])).toBeLessThanOrEqual(2);      // the percentage is printed to 0.1
        expect(Math.abs(s.c[3] - want[3])).toBeLessThanOrEqual(0.02);
      }
    }
  });

  test('temperature ticks sit at their value: 32 F is where the table turns from blue to gold', () => {
    const lg = rasterLegend('temperature', 'dark');
    expect(lg.unit).toBe('°F');
    expect(lg.stops.map((s) => s.label)).toEqual(['-10°', '10°', '32°', '50°', '70°', '90°', '110°+']);
    const freeze = lg.stops.find((s) => s.label === '32°');
    expect(freeze.pct).toBeCloseTo(((0 - fToC(-10)) / (fToC(110) - fToC(-10))) * 100, 1);
    expect(lg.stops[0].pct).toBe(0); expect(lg.stops[lg.stops.length - 1].pct).toBe(100);
    expect(rasterLegend('temperature', 'dark', 'C').stops.map((s) => s.label)).toEqual(['-23°', '-12°', '0°', '10°', '21°', '32°', '43°+']);
  });

  test('water temp names every ten degrees from 35 F; fog runs from dense to clear with half the bar under 1 km', () => {
    expect(rasterLegend('water_temp', 'light').stops.map((s) => s.label)).toEqual(['35°', '45°', '55°', '65°', '75°', '85°+']);
    const fog = rasterLegend('fog', 'beach');
    expect(fog.stops.map((s) => s.label)).toEqual(['<100 m', '300 m', '1 km', '3 km', 'Clear']);
    expect(fog.stops.find((s) => s.label === '1 km').pct).toBeCloseTo(50, 0);
    expect(fog.unit).toBe('m');
  });

  test('a layer that is not one of the three has no legend here', () => {
    expect(rasterLegend('rain', 'dark')).toBeNull();
  });
});

describe('the legend block in the weather controls', () => {
  const src = fs.readFileSync(path.join(__dirname, 'MapWeatherControls.js'), 'utf8').replace(/\r\n/g, '\n');

  test('OFF PATH: __RAW_DISABLE_RASTER_LEGENDS__ gives the three hand-written bars back; the map keeps its tables', () => {
    window.__RAW_DISABLE_RASTER_LEGENDS__ = true;
    for (const layerId of ['temperature', 'water_temp', 'fog']) { expect(rasterLegend(layerId, 'light')).toBeNull(); expect(rasterPaletteOn(layerId)).toBe(true); }
    for (const v of [1, 'true', false, null]) { window.__RAW_DISABLE_RASTER_LEGENDS__ = v; expect(rasterLegend('fog', 'light')).not.toBeNull(); }
  });

  test('each of the three bars comes from the drawn table, with its hand-written bar kept as the fallback', () => {
    const OLD = { fog: "'<1km', '5km', '10km', '20km', 'Clear'", temperature: "'0°', '20°', '40°', '60°', '80°', '100°+'", water_temp: "'35°', '45°', '55°', '65°', '75°', '85°+'" };
    for (const [layerId, oldStops] of Object.entries(OLD)) {
      const head = `config.${layerId} = {\n      label: LEGEND_LABELS.${layerId},\n      ...(rasterLegend('${layerId}', theme) || { gradientCSS: 'linear-gradient(to right,`;
      const at = src.indexOf(head);
      expect(at).toBeGreaterThan(0);
      expect(src.slice(at, src.indexOf('\n    };', at))).toContain(`stops: evenStops([${oldStops}]) }),`);
    }
    expect(src.match(/rasterLegend\(/g)).toHaveLength(3);
  });

  test('ONE legend configuration feeds every layout, and it is rebuilt when the theme changes', () => {
    expect(src.match(/const legendConfig = useMemo\(/g)).toHaveLength(1);
    expect(src).toMatch(/\}, \[theme, heightUnit, windLookKey\(theme\)\]\);/);
    expect(src.match(/legendConfig\[activeLayer\]/g).length).toBeGreaterThanOrEqual(4);
    expect(src).not.toMatch(/const legendConfig(Mobile|Desktop|Sheet)/);
  });

  test('no two ticks of a computed bar are closer than 12% of the bar', () => {
    for (const theme of THEMES) {
      for (const layerId of ['temperature', 'water_temp', 'fog']) {
        const stops = rasterLegend(layerId, theme).stops;
        for (let i = 1; i < stops.length; i += 1) expect(stops[i].pct - stops[i - 1].pct).toBeGreaterThanOrEqual(12);
      }
    }
  });
});

describe('rasterScaleFor: the table for a layer and theme, with no registry and no effect order involved', () => {
  test('the generated table per theme, the same object applyThemeRasterScales registers', () => {
    window.__OM_PROTOCOL_SETTINGS__ = { colorScales: {} };
    for (const theme of THEMES) {
      applyThemeRasterScales(theme === 'dark' ? 'light' : 'dark');             // the registry holds ANOTHER theme's fog
      expect(rasterScaleFor('fog', theme)).toBe(FOG[theme]);                   // the pure answer is still this theme's
      expect(rasterScaleFor('temperature', theme)).toBe(AIR_TEMP);
      expect(rasterScaleFor('water_temp', theme)).toBe(WATER_TEMP);
      applyThemeRasterScales(theme);
      for (const [layerId, { key }] of Object.entries(RASTER_PALETTE_LAYERS)) expect(window.__OM_PROTOCOL_SETTINGS__.colorScales[key]).toBe(rasterScaleFor(layerId, theme));
    }
    expect(rasterScaleFor('rain', 'dark')).toBeNull();
  });

  test('under a kill it is what was drawn before, and equals what gets registered', () => {
    rememberLibraryRasterScales(LIB);
    for (const k of KILLS) window[k] = true;
    expect(rasterScaleFor('temperature', 'light')).toBe(LIB.temperature);
    expect(rasterScaleFor('water_temp', 'light')).toBe(LIB.sea_surface_temperature);
    expect(rasterScaleFor('fog', 'light')).toEqual(smoothColorScale(BASE_CUSTOM_COLOR_SCALES.visibility, 80));
    expect(applyThemeRasterScales('light')).toEqual({ temperature: 'before', water_temp: 'before', fog: 'before' });
  });
});

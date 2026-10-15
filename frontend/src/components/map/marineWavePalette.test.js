import { createHash } from 'crypto';
import { getThemedWaveColorJS, applyThemeWaveScale, BASE_CUSTOM_COLOR_SCALES } from './colorScales';
import { hasMarineWavePalette, marineWaveLegendGradientCSS } from './marineWavePalette';

const hash = values => createHash('sha256').update(JSON.stringify(values)).digest('hex');
const heights = [0, .15, .3, .6, .9, 1.2, 1.8, 2.4, 3, 3.6, 4.2, 5, 6.1, 8, 10];
// Independent pre-edit baseline receipt: evidence/before/gpu-ramp.json (JS legend readback).
const surfHashes = {
  beach: '602bf3fac632d4b734e0d3000c0adadd70883f9b359f207cd3b79212ef3b7413',
  light: '741ea3b1dfa38097c6df69cfa9f85f2e764f3c7615635ae2ea9bd14dcb09c4cb',
  dark: 'e2cf4827150e358ec1cb4467a09df9f08823045924b1b4b58e70dc59c14cd24c',
};
const lightness = rgb => {
  const linear = rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  const y = .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : y * 24389 / 27;
};

it('keeps the complete dark height ramp identical to the pre-edit baseline', () => {
  expect(hasMarineWavePalette('dark')).toBe(false);
  expect(hash(Array.from({ length: 1001 }, (_, i) => getThemedWaveColorJS(i / 100, 'dark'))))
    .toBe('afb4054d64c1400579706578a192899c1ec818fde76b622019cab78f167c2b8e');
});

it.each(['beach', 'light', 'dark'])('preserves %s surf-mode colours', theme => {
  expect(hash(heights.map(h => getThemedWaveColorJS(h, theme, true)))).toBe(surfHashes[theme]);
});

it('gives beach warm height bands a consistent, visible lightness order', () => {
  const bands = [1.2, 1.8, 2.4, 3, 3.6, 4.2, 5].map(h => lightness(getThemedWaveColorJS(h, 'beach')));
  for (let i = 1; i < bands.length; i++) expect(bands[i - 1] - bands[i]).toBeGreaterThan(5);
});

it('separates light azure from royal purple, then purple from orchid by lightness', () => {
  expect(lightness(getThemedWaveColorJS(1.2, 'light')) - lightness(getThemedWaveColorJS(2.4, 'light'))).toBeGreaterThan(20);
  expect(lightness(getThemedWaveColorJS(5, 'light')) - lightness(getThemedWaveColorJS(2.4, 'light'))).toBeGreaterThan(25);
});

it('preserves breakpoints, units and raster transparency through theme switches', () => {
  const names = ['wave_height', 'wave', 'swell_wave_height', 'secondary_swell_wave_height', 'wind_wave_height'];
  const before = names.map(k => ({ unit: BASE_CUSTOM_COLOR_SCALES[k].unit, bp: BASE_CUSTOM_COLOR_SCALES[k].breakpoints.slice(), alpha: BASE_CUSTOM_COLOR_SCALES[k].colors.map(c => c[3]) }));
  for (const theme of ['beach', 'light', 'dark', 'beach']) {
    applyThemeWaveScale(theme);
    names.forEach((k, i) => {
      expect(BASE_CUSTOM_COLOR_SCALES[k].unit).toBe(before[i].unit);
      expect(BASE_CUSTOM_COLOR_SCALES[k].breakpoints).toEqual(before[i].bp);
      expect(BASE_CUSTOM_COLOR_SCALES[k].colors.map(c => c[3])).toEqual(before[i].alpha);
    });
  }
});

it.each(['beach', 'light'])('%s legend samples the GPU ramp on the existing value axis, including its 5 m turn', theme => {
  const scale = { unit: 'm', breakpoints: [0, .61, 1.22, 2.44, 3.66, 6.1] };
  const css = marineWaveLegendGradientCSS(scale, theme);
  for (const h of [0, .6, 1.2, 2.4, 5, 6.1]) {
    expect(css).toContain(`rgb(${getThemedWaveColorJS(h, theme).join(',')}) ${(h / 6.1 * 100).toFixed(3)}%`);
  }
  expect(marineWaveLegendGradientCSS(scale, 'dark')).toBeNull();
});

it('the reload kill restores both GLSL and legend to the existing paths', () => {
  jest.isolateModules(() => {
    window.__RAW_DISABLE_MARINE_WAVE_PALETTE__ = true;
    try {
      const palette = require('./marineWavePalette');
      expect(palette.hasMarineWavePalette('beach')).toBe(false);
      expect(palette.MARINE_WAVE_PALETTE_GLSL).toBe('');
      expect(palette.MARINE_WAVE_PALETTE_CALL_GLSL).toBe('');
      expect(palette.marineWaveLegendGradientCSS({ unit: 'm', breakpoints: [0, 6.1] }, 'light')).toBeNull();
    } finally { delete window.__RAW_DISABLE_MARINE_WAVE_PALETTE__; }
  });
});

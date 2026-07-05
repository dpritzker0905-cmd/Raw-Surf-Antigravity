/**
 * Buffer-color contract (2026-07-05, "land mask appears around the coastlines z2→~5.8"):
 * while the GLOBAL coarse grid is resident (span >15°) its blocky GPU land mask exposes the
 * ocean-mask-buffer line along every coast — with the legacy bright per-layer colors it glowed
 * as a cyan halo; mid/fine coverage (z≳5.8 on a wide window) hid it, which read as "the land
 * mask goes under the water when zooming in". The buffer must blend UNDER the water at every
 * zoom: default = THEME ocean color; the bright scale-colors are opt-in only.
 */
import { resolveBufferColor } from './OceanMask';

const darkTc = { ocean: 'rgba(16, 29, 43, 0.90)' };
const lightTc = { ocean: 'rgba(202, 222, 240, 0.92)' };

afterEach(() => { delete window.__RAW_MARINE_BUFFER_SCALE_COLORS__; });

it('defaults to the THEME ocean color for every marine layer (never the bright scale color)', () => {
  for (const layer of ['waves', 'swell_1', 'swell_2', 'wind_waves', null]) {
    expect(resolveBufferColor(layer, darkTc)).toBe(darkTc.ocean);
    expect(resolveBufferColor(layer, lightTc)).toBe(lightTc.ocean);
  }
});

it('falls back to the dark ocean constant when the theme entry is missing', () => {
  expect(resolveBufferColor('waves', undefined)).toBe('rgba(16, 29, 43, 0.90)');
});

it('legacy bright scale-colors are OPT-IN via __RAW_MARINE_BUFFER_SCALE_COLORS__', () => {
  window.__RAW_MARINE_BUFFER_SCALE_COLORS__ = true;
  expect(resolveBufferColor('waves', darkTc)).toBe('rgba(34, 211, 238, 0.70)');
  expect(resolveBufferColor('swell_2', darkTc)).toBe('rgba(192, 132, 252, 0.60)');
  // unknown layer still blends even in legacy mode
  expect(resolveBufferColor('nope', darkTc)).toBe(darkTc.ocean);
});

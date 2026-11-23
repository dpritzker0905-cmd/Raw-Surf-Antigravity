/**
 * Bug hunt 2026-11-22 item D (owner: "Rate the whole sea"): with a swell/wind-wave PARTITION on screen, the rating band rates
 * the TOTAL sea (backend band_total_sea.py, BAND_RATES_TOTAL_SEA). The legend says so, in every layout (desktop panel, mobile
 * collapsed float, mobile expanded sheet) and every theme. Second opinion (SubQ, 2026-11-23): users reading a partition key
 * under an unlabelled band was the top remaining risk. Kill: window.__RAW_DISABLE_BAND_WHOLE_SEA_LABEL__ = true.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ratingBandLegendTitle } from './ratingBandLegend';

const { MapWeatherControls } = (() => {
  const previousFetch = global.fetch;
  global.fetch = () => Promise.reject(new Error('offline'));
  try { return require('./MapWeatherControls'); } finally { global.fetch = previousFetch; }
})();
let mockTheme = 'dark';
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));

const WHOLE = 'Surf Rating · whole sea (coastal band)';
const PLAIN = 'Surf Rating (coastal band)';

describe('rating band legend title', () => {
  afterEach(() => { delete window.__RAW_DISABLE_BAND_WHOLE_SEA_LABEL__; delete window.__SURF_MODE__; jest.restoreAllMocks(); });

  it.each([['waves', PLAIN], ['swell_1', WHOLE], ['swell_2', WHOLE], ['wind_waves', WHOLE]])('%s -> %s', (layer, want) => {
    expect(ratingBandLegendTitle(layer)).toBe(want);
  });

  it('kill switch restores the plain title', () => {
    window.__RAW_DISABLE_BAND_WHOLE_SEA_LABEL__ = true;
    expect(ratingBandLegendTitle('swell_1')).toBe(PLAIN);
  });

  it('every legend layout reads the helper (no hard-coded title left)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'MapWeatherControls.js'), 'utf8');
    expect(src).not.toMatch(/>Surf Rating \(coastal band\)</);
    expect((src.match(/ratingBandLegendTitle\(activeLayer\)/g) || []).length).toBe(3);
  });

  it.each(['light', 'dark', 'beach'].flatMap((t) => [[t, true], [t, false]]))('%s desktop=%s shows the whole-sea title over Swell 1', (theme, isDesktop) => {
    mockTheme = theme;
    window.__SURF_MODE__ = true;
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(Object.fromEntries(
      ['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText'].map((k) => [k, jest.fn()])));
    render(<MapWeatherControls activeModel="GFS" activeLayers={['swell_1']} isDesktop={isDesktop} isCompactTimelineOpen
      onTimeChange={() => {}} onModelChange={() => {}} onLayerToggle={() => {}} onTogglePlay={() => {}} />);
    expect(screen.queryAllByText(WHOLE).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(PLAIN).length).toBe(0);
  });
});

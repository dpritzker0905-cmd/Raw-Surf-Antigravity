/**
 * Bug hunt 2026-11-22 item D, option B (the overnight research consensus the owner delegated): over Swell 1, Swell 2 and
 * Wind Waves the map shows that partition's own height, never a surf rating. The marine data lane asks a partition layer in
 * the PLAIN flavour even while Rating is on (no `surf=1`, no '~surf' cache key, the cheap page span), the engine's wash picks
 * the plain base, and the legend says "Height only, no surf rating" (role="note", aria-label) in every layout and theme.
 * The Waves layer, the toggle and the glyphs keep the rating. Kill: window.__RAW_DISABLE_PARTITION_HEIGHT_ONLY__ = true.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { bandRatedFor, isPartitionHeightOnly, PARTITION_LAYERS } from './partitionHeightOnly';
import { getMarineBandFlag, getSurfModeFlag } from './backendWeatherServiceClient';
import { marineSeriesPageForHour } from './marineGridSeries';
import { pickCoarseBaseLruKey } from './WebGLMarineEngine';
import { PARTITION_NOTE_ARIA, PARTITION_NOTE_TEXT } from './PartitionHeightOnlyNote';

const { MapWeatherControls } = (() => {
  const previousFetch = global.fetch;
  global.fetch = () => Promise.reject(new Error('offline'));
  try { return require('./MapWeatherControls'); } finally { global.fetch = previousFetch; }
})();
let mockTheme = 'dark';
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));

afterEach(() => {
  delete window.__SURF_MODE__; delete window.__RAW_DISABLE_PARTITION_HEIGHT_ONLY__;
  jest.restoreAllMocks();
});

describe('the flavour a layer is asked in', () => {
  it.each([['waves', true], ['swell_1', false], ['swell_2', false], ['wind_waves', false]])('Rating on, %s rated=%s', (layer, rated) => {
    expect(bandRatedFor(true, layer)).toBe(rated);
    window.__SURF_MODE__ = true;
    expect(getMarineBandFlag(layer)).toBe(rated);
    expect(getSurfModeFlag()).toBe(true);                      // the toggle, glyphs and infobox still read Rating ON
  });

  it('Rating off is plain everywhere', () => {
    for (const l of ['waves', ...PARTITION_LAYERS]) expect(bandRatedFor(false, l)).toBe(false);
  });

  it('kill switch rates the partitions again', () => {
    window.__RAW_DISABLE_PARTITION_HEIGHT_ONLY__ = true;
    expect(isPartitionHeightOnly('swell_1')).toBe(false);
    expect(bandRatedFor(true, 'swell_1')).toBe(true);
  });

  it('a partition keeps the cheap 48-frame page span in Rating mode (its pages are plain)', () => {
    window.__SURF_MODE__ = true;
    expect(marineSeriesPageForHour(150, 'GFS', 'swell_1')).toBe(1);   // 144 h pages
    expect(marineSeriesPageForHour(150, 'GFS', 'waves')).toBe(3);     // 48 h surf pages
  });

  it('the wash picks the plain base for a partition in Rating mode', () => {
    const keys = ['GFS|swell_1|r0', 'GFS|swell_1|r1'];
    window.__SURF_MODE__ = true;
    expect(pickCoarseBaseLruKey(keys, 'GFS', 'swell_1', bandRatedFor(true, 'swell_1'))).toBe('GFS|swell_1|r0');
    expect(pickCoarseBaseLruKey(['GFS|waves|r0', 'GFS|waves|r1'], 'GFS', 'waves', bandRatedFor(true, 'waves'))).toBe('GFS|waves|r1');
  });

  it('no marine data path asks the raw Rating flag where a layer is in scope', () => {
    const dir = __dirname;
    const leftovers = ['backendCopernicusServiceClient.js', 'marineController.js', 'marineGridSeries.js', 'marineSettleReloadGuard.js',
      'useMarineDataFetcherCore.js', 'useMarineOrchestrator.js', 'useMarineWindData.js']
      .filter((f) => /getSurfModeFlag\(\)\s*\?\s*'(~surf|&surf=1|surf)'/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(leftovers).toEqual([]);
  });
});

describe('the legend over a partition layer', () => {
  beforeEach(() => {
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(Object.fromEntries(
      ['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText'].map((k) => [k, jest.fn()])));
  });
  const view = (layer, isDesktop) => (
    <MapWeatherControls activeModel="GFS" activeLayers={[layer]} isDesktop={isDesktop} isCompactTimelineOpen
      onTimeChange={() => {}} onModelChange={() => {}} onLayerToggle={() => {}} onTogglePlay={() => {}} />);

  it.each(['light', 'dark', 'beach'].flatMap((t) => [[t, true], [t, false]]))('%s desktop=%s: Swell 1 says height only', (theme, isDesktop) => {
    mockTheme = theme;
    window.__SURF_MODE__ = true;
    render(view('swell_1', isDesktop));
    const notes = screen.getAllByRole('note', { name: PARTITION_NOTE_ARIA });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toHaveTextContent(PARTITION_NOTE_TEXT);
    expect(screen.queryAllByText('Surf Rating (coastal band)').length).toBe(0);
  });

  it.each([true, false])('desktop=%s: the Waves layer keeps the rating key and no note', (isDesktop) => {
    window.__SURF_MODE__ = true;
    render(view('waves', isDesktop));
    expect(screen.queryAllByTestId('partition-height-only-note').length).toBe(0);
    expect(screen.queryAllByText('Surf Rating (coastal band)').length).toBeGreaterThan(0);
  });

  it('Rating off shows neither', () => {
    window.__SURF_MODE__ = false;
    render(view('swell_1', true));
    expect(screen.queryAllByTestId('partition-height-only-note').length).toBe(0);
  });

  it('kill switch restores the rating key over a partition', () => {
    window.__SURF_MODE__ = true;
    window.__RAW_DISABLE_PARTITION_HEIGHT_ONLY__ = true;
    render(view('swell_1', true));
    expect(screen.queryAllByTestId('partition-height-only-note').length).toBe(0);
    expect(screen.queryAllByText('Surf Rating (coastal band)').length).toBeGreaterThan(0);
  });

  it('every legend layout carries the note (desktop panel, mobile collapsed, mobile sheet)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'MapWeatherControls.js'), 'utf8');
    expect((src.match(/<PartitionHeightOnlyNote /g) || []).length).toBe(3);
    expect((src.match(/!isPartitionHeightOnly\(activeLayer\) && \(/g) || []).length).toBe(3);
  });
});

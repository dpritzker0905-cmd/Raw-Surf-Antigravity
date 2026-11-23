/**
 * The US tide display above MLLW, client side (tideDatum.js; backend services/weather_pipeline/tide_datum.py).
 * Every surface that shows a tide height names its datum: the infobox readout, the hub block, the card row, the glyph
 * line and the spot chart. Three themes, the minus-tide copy, the MSL transition line, the source, the client kill.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import TideReadout from './TideReadout';
import { clearPointTideCache } from './usePointTide';
import { tideDatumOf, shownHeight, ratingTide, minusTideWord, pointTideForDisplay, MLLW_SHORT, MSL_SHORT } from './tideDatum';
import SpotTideBlock from '../spot-hub/SpotTideBlock';
import { sanitizePointTide, pointTideNote, formatPointTide, tideSourceLabel } from '../spot-hub/spotHubP1Format';
import { frameDescription } from '../spot-hub/charts/spotSeriesModel';

const BLOCK = {
  datum: 'MLLW', label: 'above MLLW', offset_m: 0.77, msl_minus_mllw_m: 0.851, mean_level_included_m: 0.081,
  source: 'gauge', source_label: 'NOAA CO-OPS gauge 9410660 Los Angeles (1.4 km)', epoch: '1983-2001',
  long_label: "Tide plus average sea-level rise, above MLLW (NOAA chart datum, 1983-2001 epoch). It includes the rise since the epoch (about 8 cm here, the 2016-2025 mean), so it reads that much above a NOAA tide table. It excludes today's ocean anomaly and storm surge, which can add tens of centimetres. Datum from NOAA CO-OPS gauge 9410660 Los Angeles (1.4 km).",
  negative_note: 'x',
};

afterEach(() => { delete window.__RAW_DISABLE_TIDE_MLLW__; delete global.fetch; });

describe('tideDatumOf', () => {
  test('MLLW block keeps its source; anything else is local MSL', () => {
    const d = tideDatumOf(BLOCK);
    expect(d.isMllw).toBe(true);
    expect(d.short).toBe(MLLW_SHORT);
    expect(d.source).toMatch(/9410660/);
    expect(d.offsetM).toBe(0.77);
    expect(d.negativeNote).toMatch(/minus tide.*not an error/);
    for (const x of [null, undefined, { datum: 'MSL' }, 'MSL', {}]) {
      const m = tideDatumOf(x);
      expect(m.isMllw).toBe(false);
      expect(m.short).toBe(MSL_SHORT);
      expect(m.offsetM).toBe(0);
    }
    expect(tideDatumOf('MLLW', 'model').sourceShort).toMatch(/19-yr/);
  });
  test('the compact pair (card, glyph, chart) carries the same honest frame wording as the full block', () => {
    for (const d of [tideDatumOf('MLLW', 'model'), tideDatumOf(BLOCK)]) {
      expect(d.long).toMatch(/average sea-level rise/);
      expect(d.long).toMatch(/[Ee]xcludes today's ocean anomaly/);
    }
  });
  test('client kill restores the served MSL level so the label and number agree', () => {
    window.__RAW_DISABLE_TIDE_MLLW__ = true;
    expect(tideDatumOf(BLOCK).isMllw).toBe(false);
    expect(shownHeight(1.0, BLOCK)).toBeCloseTo(0.23, 3);
    const p = pointTideForDisplay({ datum: 'MLLW', datum_info: BLOCK, height_m: 1.0, series: [{ t: 'a', h: 1.0 }],
      events: [{ type: 'Low', time: 'b', height_m: 0.1 }], next_high: null, next_low: { time: 'b', height_m: 0.1 } });
    expect(p.datum_info.datum).toBe('MSL');
    expect(p.series[0].h).toBeCloseTo(0.23, 3);
    expect(p.events[0].height_m).toBeCloseTo(-0.67, 3);
  });
  test('rating tide: display height only for MLLW; minus tide only below zero above MLLW', () => {
    expect(ratingTide({ height_m: 0.1, display_height_m: 0.9, datum: 'MLLW', datum_src: 'model' }).heightM).toBe(0.9);
    expect(ratingTide({ height_m: 0.1 }).heightM).toBe(0.1);
    const d = tideDatumOf(BLOCK);
    expect(minusTideWord(-0.1, d)).toBe('minus tide');
    expect(minusTideWord(0.1, d)).toBeNull();
    expect(minusTideWord(-0.4, tideDatumOf(null))).toBeNull();   // below MSL is ordinary, not a minus tide
  });
});

describe('card row, hub line, chart', () => {
  test('card row names MLLW and its source; MSL rows keep their old shape and words', () => {
    const t = sanitizePointTide({ height_m: -0.6, display_height_m: -0.12, datum: 'MLLW', datum_src: 'gauge', trend: 'falling' });
    expect(formatPointTide(t)).toBe('−0.4 ft, Falling');
    const n = pointTideNote(t);
    expect(n.note).toBe('model estimate, above MLLW (minus tide)');
    expect(n.label).toMatch(/above MLLW, NOAA chart datum, datum from NOAA gauge/);
    const msl = sanitizePointTide({ height_m: 0.4, trend: 'rising' });
    expect(Object.keys(msl).sort()).toEqual(['heightFt', 'heightM', 'trend']);
    expect(pointTideNote(msl).note).toBe('model estimate, above local MSL');
  });
  test('hub source line swaps the MSL wording for the MLLW long label and keeps the credit', () => {
    const s = tideSourceLabel({ station_id: 'raw-surf:tide-own:am', tide_label: 'heights above local mean sea level',
      credit: 'CREDIT TEXT', datum: BLOCK });
    expect(s).toMatch(/^Tide plus average sea-level rise, above MLLW \(NOAA chart datum/);
    expect(s).toMatch(/9410660 Los Angeles/);
    expect(s).toMatch(/CREDIT TEXT/);
    expect(s).not.toMatch(/local mean sea level/);
  });
  test('chart frame text names the datum', () => {
    const f = { label: 'Tue 13:00', heightM: 1, level: 'fair', tideM: 0.6, tideMllw: true };
    expect(frameDescription(f, (m) => `${m} m`)).toMatch(/tide 0\.6 m above MLLW$/);
    expect(frameDescription({ ...f, tideMllw: false }, (m) => `${m} m`)).toMatch(/tide 0\.6 m above local MSL$/);
  });
});

const THEMES = [['dark', {}], ['light', { isLight: true }], ['beach', { isBeach: true }]];

describe.each(THEMES)('%s theme', (name, flags) => {
  test('hub block shows the datum, the minus tide and the MSL line', () => {
    const t = { isLight: !!flags.isLight, isBeach: !!flags.isBeach, textPrimary: 'a', textSecondary: 'b', textMuted: 'c', cellBg: 'd', cellBgFaded: 'e' };
    const future = new Date(Date.now() + 3600e3).toISOString();
    render(<SpotTideBlock t={t} containerBorder="x" tideData={{
      station_id: 'raw-surf:tide-own:am', current_status: 'Falling', credit: 'CREDIT', datum: BLOCK,
      tides: [{ time: future, height: -0.3, height_msl: -2.83, type: 'Low' }] }} />);
    expect(screen.getByTestId('tide-datum-short')).toHaveTextContent('heights above MLLW');
    expect(screen.getByTestId('tide-minus')).toHaveTextContent('minus tide');
    expect(screen.getByTestId('tide-msl-ft')).toHaveTextContent('-2.8ft above local MSL');
    expect(screen.getByTestId('tide-source-label')).toHaveTextContent(/NOAA CO-OPS gauge 9410660/);
  });

  test('infobox readout labels MLLW, names the source, keeps the MSL line and the credit', async () => {
    clearPointTideCache();
    const NOW = '2026-11-07T12:00:00Z';
    const series = Array.from({ length: 37 }, (_, i) => ({
      t: new Date(Date.parse(NOW) + (i - 6) * 3600e3).toISOString(),
      h: Math.round((Math.sin(((i - 6) / 12.42) * 2 * Math.PI) * 0.9 - 0.1) * 1000) / 1000 }));
    const payload = { available: true, height_m: -0.1, trend: 'rising', now: NOW, tz_offset_h: 'UTC', series, events: [],
      datum: 'MLLW', datum_info: BLOCK, provider: 'FES2022 (CNES; LEGOS, NOVELTIS, CLS via AVISO) + Copernicus Marine',
      source_url: 'https://doi.org/10.24400/527896/A01-2024.004' };
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }));
    render(<TideReadout lat={33.7} lng={-118.3} heightUnit="m" {...flags} atTime={Date.parse(NOW)} />);
    expect(await screen.findByTestId('tide-datum')).toHaveTextContent('Tide + avg sea-level rise (minus tide)');
    expect(screen.getByTestId('tide-datum')).toHaveAttribute('title', expect.stringMatching(/excludes today's ocean anomaly/));
    expect(screen.getByTestId('tide-msl-line')).toHaveTextContent('≈ -0.9 m above local mean sea level');
    expect(screen.getByTestId('tide-datum-source')).toHaveTextContent(/MLLW from NOAA CO-OPS gauge 9410660/);
    expect(screen.getByText(/Modeled tide · above MLLW \(NOAA chart datum\)/)).toBeVisible();
    expect(screen.getByTestId('tide-credit')).toHaveTextContent(/AVISO/);
  });
});

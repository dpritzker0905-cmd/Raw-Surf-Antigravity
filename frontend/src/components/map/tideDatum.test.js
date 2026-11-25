/**
 * The US tide display above MLLW, client side (tideDatum.js; backend services/weather_pipeline/tide_datum.py).
 * Every surface that shows a tide height names its datum: the infobox readout, the hub block, the card row, the glyph
 * line and the spot chart. Three themes, the minus-tide copy, the MSL transition line, the source, the client kill.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TideReadout from './TideReadout';
import { clearPointTideCache } from './usePointTide';
import {
  tideDatumOf, shownHeight, ratingTide, minusTideWord, pointTideForDisplay, MLLW_SHORT, MSL_SHORT,
  typoMinus, typoMinusIn, plainTideText, preciseTideText,
} from './tideDatum';
import TideDatumInfo from './TideDatumInfo';
import * as tideClientModule from './tideClient';
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
    expect(screen.getByTestId('tide-msl-ft')).toHaveTextContent('−2.8ft above local MSL');
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
    // Decision B: the line is a plain number with a typographic minus and NO datum name ...
    expect(await screen.findByTestId('tide-height')).toHaveTextContent('−0.1 m');
    expect(screen.getByTestId('tide-readout').querySelector('.flex').textContent).not.toMatch(/MLLW|MSL|sea level/);
    // ... and the datum is said ONCE, in a real button (aria-expanded) that opens an info tip.
    const tip = screen.getByRole('button', { name: /Tide zero: MLLW/ });
    expect(tip).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('tide-datum-tip')).not.toBeVisible();
    fireEvent.click(tip);
    expect(tip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('tide-datum-tip')).toBeVisible();
    expect(screen.getByTestId('tide-datum-tip')).toHaveTextContent(/excludes today's ocean anomaly/);
    expect(screen.getByTestId('tide-datum-tip')).toHaveTextContent(/minus tide/);
    expect(screen.getByTestId('tide-datum-tip')).toHaveTextContent(/not comparable/);   // the cross-border note
    expect(tip.getAttribute('aria-controls')).toBe(screen.getByTestId('tide-datum-tip').id);
    expect(screen.getByTestId('tide-msl-line')).toHaveTextContent('≈ 0.9 m below local mean sea level');
    expect(screen.getByTestId('tide-datum-source')).toHaveTextContent(/MLLW from NOAA CO-OPS gauge 9410660/);
    expect(screen.getByText(/Modeled tide · above MLLW \(NOAA chart datum\)/)).toBeVisible();
    expect(screen.getByTestId('tide-credit')).toHaveTextContent(/AVISO/);
  });
});

describe.each(THEMES)('%s theme: the tide datum info tip (decision B; a11y)', (name, flags) => {
  test('keyboard: Tab reaches it, Enter and Space toggle it, Escape closes it and keeps focus', async () => {
    const user = userEvent.setup();
    render(<TideDatumInfo datum={tideDatumOf(BLOCK)} {...flags} />);
    const tip = screen.getByRole('button', { name: /Tide zero: MLLW/ });
    await user.tab();
    expect(tip).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(tip).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(tip).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');
    expect(tip).toHaveAttribute('aria-expanded', 'false');
    expect(tip).toHaveFocus();
  });

  test('on local MSL (off-US, or every point while SURF_TIDE_MLLW_US is "0") the tip never mentions MLLW', () => {
    render(<TideDatumInfo datum={tideDatumOf(null)} {...flags} />);
    fireEvent.click(screen.getByRole('button', { name: /Tide zero: local MSL/ }));
    expect(screen.getByTestId('tide-datum-tip')).toHaveTextContent(/local mean sea level/);
    // the advisor's before-merge 1 (#1149 at b1ffc76a2): no "US spots read from mean lower low water" while it is untrue
    expect(screen.getByTestId('tide-datum-tip').textContent).not.toMatch(/MLLW|lower low water|not comparable/);
  });

  test('on MLLW the tip adds the cross-border note', () => {
    render(<TideDatumInfo datum={tideDatumOf(BLOCK)} {...flags} />);
    fireEvent.click(screen.getByRole('button', { name: /Tide zero: MLLW/ }));
    expect(screen.getByTestId('tide-datum-tip')).toHaveTextContent(/not comparable/);
  });

  test('theme classes follow the theme (never a single-theme colour)', () => {
    render(<TideDatumInfo datum={tideDatumOf(BLOCK)} {...flags} />);
    const cls = screen.getByTestId('tide-datum-tip').className;
    if (flags.isLight) expect(cls).toMatch(/bg-white/);
    else if (flags.isBeach) expect(cls).toMatch(/bg-black\/85/);
    else expect(cls).toMatch(/bg-zinc-900/);
  });
});

describe('plain line and precise words (decision B)', () => {
  test('typographic minus, plain text, precise text', () => {
    expect(typoMinus('-0.4 ft')).toBe('−0.4 ft');
    expect(plainTideText('-0.4 ft', 'Falling')).toBe('−0.4 ft, falling');
    expect(plainTideText('1.2 ft', null)).toBe('1.2 ft');
    const mllw = tideDatumOf(BLOCK);
    expect(preciseTideText('1.2 ft', 0.37, mllw, 'rising')).toBe('1.2 feet above mean lower low water, rising');
    expect(preciseTideText('−0.4 ft', -0.12, mllw, 'falling')).toBe('0.4 feet below mean lower low water, a minus tide, falling');
    expect(preciseTideText('0.0 ft', -0.004, mllw, null)).toBe('0.0 feet above mean lower low water');
    expect(preciseTideText('0.6 m', 0.6, tideDatumOf(null), 'slack')).toBe('0.6 metres above local mean sea level, slack');
  });
});

describe('the decision-B client kill (window.__RAW_DISABLE_TIDE_PLAIN_LINE__)', () => {
  afterEach(() => { delete window.__RAW_DISABLE_TIDE_PLAIN_LINE__; });
  test('puts the datum name back on the line; off, the line is plain', () => {
    const { formatTideLine } = tideClientModule;
    const tide = { height_m: -0.6, display_height_m: -0.1, datum: 'MLLW', datum_src: 'gauge', trend: 'falling' };
    expect(formatTideLine(tide, 'ft')).toBe('−0.3 ft, falling');
    window.__RAW_DISABLE_TIDE_PLAIN_LINE__ = true;
    expect(formatTideLine(tide, 'ft')).toBe('-0.3 ft above MLLW (minus tide) falling');
  });
});


describe('the visual pass fixes (2026-11-25)', () => {
  test('every minus in a readout line is typographic', () => {
    expect(typoMinusIn('Next low 5:00 AM UTC · -2.0 ft')).toBe('Next low 5:00 AM UTC · −2.0 ft');
    expect(typoMinusIn('-0.4 ft')).toBe('−0.4 ft');
    expect(typoMinusIn('2026-11-25')).toBe('2026-11-25');
  });

  test('the tip panel is capped, scrolls itself and is keyboard-focusable when open', () => {
    render(<TideDatumInfo datum={tideDatumOf(BLOCK)} />);
    const tip = screen.getByTestId('tide-datum-tip');
    expect(tip.className).toMatch(/max-h-\[160px\]/);
    expect(tip.className).toMatch(/overflow-y-auto/);
    expect(tip).toHaveAttribute('tabindex', '-1');
    fireEvent.click(screen.getByRole('button', { name: /Tide zero: MLLW/ }));
    expect(tip).toHaveAttribute('tabindex', '0');
  });
});

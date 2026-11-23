// The gust time-window label (2026-11-22, gustWindow.js): which gust each model serves, per model and lead, in words, on the
// status line and the legend credit, in all three themes. Windows as decoded (backend gust_verify_collect.euro_window /
// icon_window): ECMWF 1 h to 90 h, 3 h to 144 h, 6 h after; ICON 1 h to 78 h, 3 h after; GFS instantaneous.
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { gustWindowHours, gustWindowLabel, gustWindowShort, gustLeadHours, frameTimesOfPath } from './gustWindow';
import { describeRasterFrame, publishRasterDrawn, _resetRasterDrawnForTest } from './rasterDrawnFrame';
import ForecastTimeStatus from './ForecastTimeStatus';
import LayerDataCredit, { creditFor } from './LayerDataCredit';

const RUN = Date.UTC(2026, 10, 22, 0);
const H = 3600000;
const frame = (model, lead, extra = {}) => ({ url: `${model}/gust/${lead}`, dataMs: RUN + lead * H, runMs: RUN, model, nearestMaxHours: 1, drawnFactor: 1, ...extra });
const rec = (model, lead, extra) => { const f = frame(model, lead, extra); return { layer: 'gusts', shown: f, want: f }; };

afterEach(() => { _resetRasterDrawnForTest(); delete window.__RAW_DISABLE_GUST_WINDOW_LABEL__; delete window.__RAW_DISABLE_RASTER_DRAWN_READOUT__; });

describe('the window per model and lead (each step boundary)', () => {
  test.each([
    ['GFS', 0, 0], ['GFS', 120, 0], ['GFS', 336, 0], ['GFS', NaN, 0],
    ['EURO', 3, 1], ['EURO', 90, 1], ['EURO', 93, 3], ['EURO', 144, 3], ['EURO', 150, 6], ['EURO', 240, 6],
    ['ICON', 1, 1], ['ICON', 78, 1], ['ICON', 81, 3], ['ICON', 180, 3],
    ['EURO', NaN, null], ['ICON', -3, null], ['CMEMS', 12, null],
  ])('%s at %s h -> %s h', (model, lead, hours) => { expect(gustWindowHours(model, lead)).toBe(hours); });

  test.each([
    ['GFS', 6, 'Peak gust, instantaneous (GFS)', ' · instantaneous'],
    ['EURO', 90, 'Peak gust, max over the last hour (ECMWF)', ' · max over last hour'],
    ['EURO', 93, 'Peak gust, max over the last 3 h (ECMWF)', ' · max over last 3 h'],
    ['EURO', 144, 'Peak gust, max over the last 3 h (ECMWF)', ' · max over last 3 h'],
    ['EURO', 150, 'Peak gust, max over the last 6 h (ECMWF)', ' · max over last 6 h'],
    ['ICON', 78, 'Peak gust, max over the last hour (ICON)', ' · max over last hour'],
    ['ICON', 81, 'Peak gust, max over the last 3 h (ICON)', ' · max over last 3 h'],
  ])('%s at %s h: "%s"', (model, lead, words, short) => {
    expect(gustWindowLabel(model, lead)).toBe(words);
    expect(gustWindowShort(model, lead)).toBe(short);
  });

  test('the lead from the published path: <set>/<run stamp>/<valid stamp>-<sha>.bin (what the status record holds)', () => {
    const p = 'EURO/weather/gust/global_0p25/20261122T000000Z/20261128T060000Z-0123456789ab.bin';
    expect(frameTimesOfPath(p)).toEqual({ runMs: RUN, validMs: RUN + 150 * H });
    expect(gustLeadHours({ url: p, dataMs: RUN + 150 * H })).toBe(150);
    expect(gustLeadHours({ url: `https://cdn.example/${p}?v=1` })).toBe(150);
    expect(frameTimesOfPath('om://transparent-tile')).toBeNull();
    const r = { layer: 'gusts', shown: { url: p, dataMs: RUN + 150 * H, model: 'EURO' }, want: { url: p, dataMs: RUN + 150 * H, model: 'EURO' } };
    expect(describeRasterFrame(r, 'gusts', RUN + 150 * H).text).toBe('Peak gust, max over the last 6 h (ECMWF)');
  });
  test('the lead is the drawn frame\'s own (valid - run); missing either -> NaN', () => {
    expect(gustLeadHours(frame('EURO', 147))).toBe(147);
    expect(gustLeadHours({ dataMs: RUN, runMs: NaN })).toBeNaN();
    expect(gustLeadHours(null)).toBeNaN();
  });

  test('kill switch: no label anywhere', () => {
    window.__RAW_DISABLE_GUST_WINDOW_LABEL__ = true;
    expect(gustWindowLabel('GFS', 6)).toBeNull();
    expect(gustWindowShort('EURO', 150)).toBeNull();
    expect(describeRasterFrame(rec('EURO', 150), 'gusts', RUN + 150 * H)).toBeNull();
    expect(creditFor('gusts', { gusts: 'EURO' }, {}, rec('EURO', 150)).text).toBe('EURO · © ECMWF · CC BY 4.0 · peak since last step');
  });
});

describe('the status line (describeRasterFrame)', () => {
  test.each([
    ['GFS', 6, 'Peak gust, instantaneous (GFS)'],
    ['EURO', 93, 'Peak gust, max over the last 3 h (ECMWF)'],
    ['EURO', 150, 'Peak gust, max over the last 6 h (ECMWF)'],
    ['ICON', 12, 'Peak gust, max over the last hour (ICON)'],
    ['ICON', 81, 'Peak gust, max over the last 3 h (ICON)'],
  ])('%s at %s h, the asked frame on screen: a quiet "window" line', (model, lead, text) => {
    expect(describeRasterFrame(rec(model, lead), 'gusts', RUN + lead * H)).toEqual({ state: 'window', text });
  });
  test('a nearest frame keeps its words and adds the window', () => {
    const r = describeRasterFrame(rec('EURO', 96), 'gusts', RUN + 97 * H);
    expect(r.state).toBe('nearest');
    expect(r.text).toMatch(/: the nearest stored forecast · Peak gust, max over the last 3 h \(ECMWF\)$/);
  });
  test('loading and stand-in states win; other layers are untouched', () => {
    const r = describeRasterFrame({ layer: 'gusts', shown: frame('EURO', 93), want: frame('EURO', 96) }, 'gusts', RUN + 96 * H);
    expect(r.state).toBe('pending');
    expect(describeRasterFrame(rec('GFS', 300, { estimated: 'gfs_estimated_fallback' }), 'gusts', RUN + 300 * H).state).toBe('estimated');
    const f = { ...frame('GFS', 6), runMs: RUN };
    expect(describeRasterFrame({ layer: 'pressure', shown: f, want: f }, 'pressure', f.dataMs)).toBeNull();
  });
  test('no run time on the frame: GFS still says instantaneous, ECMWF says nothing rather than guess', () => {
    expect(describeRasterFrame(rec('GFS', 6, { runMs: NaN }), 'gusts', RUN + 6 * H).text).toBe('Peak gust, instantaneous (GFS)');
    expect(describeRasterFrame(rec('EURO', 93, { runMs: NaN }), 'gusts', RUN + 93 * H)).toBeNull();
  });

  test.each(['light', 'dark', 'beach'])('%s theme: a polite status, in words, the quiet tone', (theme) => {
    const dataMs = Date.now() + 10 * H;   // the asked hour, 150 h after the frame's run
    const f = { url: 'EURO/gust/x', dataMs, runMs: dataMs - 150 * H, model: 'EURO', nearestMaxHours: 3, drawnFactor: 1 };
    act(() => { publishRasterDrawn({ layer: 'gusts', shown: f, want: f }); });
    render(<ForecastTimeStatus model="EURO" layer="gusts" hour={Math.round((f.dataMs - Date.now()) / H)} theme={theme} />);
    const s = screen.getByRole('status');
    expect(s.textContent).toBe('Peak gust, max over the last 6 h (ECMWF)');
    expect(s.getAttribute('aria-live')).toBe('polite');
    expect(s.getAttribute('data-drawn-state')).toBe('window');
    expect(s.className).toContain(theme === 'light' ? 'text-slate-600' : 'text-slate-300');
  });
});

describe('the legend credit', () => {
  test.each([
    ['GFS', 6, 'NOAA GFS · instantaneous', /^Peak gust, instantaneous \(GFS\)\. /],
    ['EURO', 90, 'EURO · © ECMWF · CC BY 4.0 · max over last hour', /^Peak gust, max over the last hour \(ECMWF\)\. ECMWF 10fg/],
    ['EURO', 150, 'EURO · © ECMWF · CC BY 4.0 · max over last 6 h', /^Peak gust, max over the last 6 h \(ECMWF\)\. /],
    ['ICON', 81, 'ICON · Datenbasis: Deutscher Wetterdienst · max over last 3 h', /^Peak gust, max over the last 3 h \(ICON\)\. ICON VMAX_10M/],
  ])('%s at %s h: "%s"', (model, lead, text, label) => {
    const c = creditFor('gusts', { gusts: model }, {}, rec(model, lead));
    expect(c.text).toBe(text);
    expect(c.label).toMatch(label);
    expect(c.label).toMatch(/Thunderstorm gusts are not resolved by the models\./);
  });
  test('no drawn lead yet, or the drawn frame is another model\'s: the generic note, as before', () => {
    expect(creditFor('gusts', { gusts: 'EURO' }, {}, null).text).toBe('EURO · © ECMWF · CC BY 4.0 · peak since last step');
    expect(creditFor('gusts', { gusts: 'ICON' }, {}, rec('EURO', 150)).text).toBe('ICON · Datenbasis: Deutscher Wetterdienst · peak since last step');
  });
  test.each(['light', 'dark', 'beach'])('%s theme: the rendered link follows the drawn frame, accessible name first', (theme) => {
    const { setEngaged } = require('./ownRasterFrames');
    const { ThemeProvider } = require('../../contexts/ThemeContext');
    window.localStorage.setItem('raw-surf-theme', theme);
    act(() => { setEngaged('gusts', 'ICON'); publishRasterDrawn(rec('ICON', 81)); });
    const { getByTestId, unmount } = render(<ThemeProvider><div className="flex justify-between"><span>Wind Gusts (kts)</span><LayerDataCredit layer="gusts" /></div></ThemeProvider>);
    const a = getByTestId('layer-data-credit');
    expect(a.textContent).toBe('ICON · Datenbasis: Deutscher Wetterdienst · max over last 3 h');
    expect(a.getAttribute('aria-label')).toMatch(/^Peak gust, max over the last 3 h \(ICON\)\./);
    act(() => { publishRasterDrawn(rec('ICON', 12)); });
    expect(a.textContent).toBe('ICON · Datenbasis: Deutscher Wetterdienst · max over last hour');
    unmount();
    act(() => { setEngaged('gusts', false); });
    window.localStorage.removeItem('raw-surf-theme');
  });
});

/**
 * Pins for the infobox's clock and frame words (audit 2026-10-27; infoboxFrameTime.js, InfoboxFrameWords.js).
 * Every behaviour ships ON; each kill switch is pinned to bring back the audited reading.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  forecastHourMs, pointDataMs, pointAnswersSelection, describeInfoboxFrame, infoboxFrameView, ratingFrameNote,
} from './infoboxFrameTime';
import { InfoboxFrameWords } from './InfoboxFrameWords';
import { findHourIndex } from './forecastHelpers';
import { selectExactPointHour } from './forecastSamplers';
import { compileForecastCards } from './forecastCardCompiler';
import { formatInstant } from './drawnFrameReadout';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';

const H = 3600000;
const NOW = Date.parse('2026-10-27T10:40:00Z');
const ANCHOR = Date.parse('2026-10-27T11:00:00Z');
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
const KILLS = ['INFOBOX_UTC_HOURS', 'INFOBOX_FRAME_WORDS', 'INFOBOX_RATING_TIME', 'DIRECT_READ_WORDS'];

/** A one-instant point answer as selectExactPointHour returns it. */
const onePoint = (askMs, extra = {}) => selectExactPointHour({
  hourly: { time: [iso(askMs)], wave_height: [1.0], wave_direction: [270], wave_period: [12] },
  requestedLat: 28.32, requestedLng: -80.61, requestedModel: 'GFS', activeLayer: 'waves', provider: 'open-meteo',
  source: 'network', status: 'exact_success', is_estimated: false, surf_height_m: 2.0, surf_regime: 'shoaling',
  surf_nearshore: true, ...extra,
}, Math.round((askMs - ANCHOR) / H));

beforeEach(() => {
  jest.useFakeTimers('modern');
  jest.setSystemTime(NOW);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  setCachedManifest(null);
  for (const k of KILLS) delete window[`__RAW_DISABLE_${k}__`];
});

describe('P1-E one clock: anchor + hour in UTC', () => {
  test('forecastHourMs is the series anchor plus whole hours, and never touches the local wall clock', () => {
    const setHours = jest.spyOn(Date.prototype, 'setHours');
    const getHours = jest.spyOn(Date.prototype, 'getHours');
    expect(forecastHourMs(0)).toBe(ANCHOR);
    expect(forecastHourMs(147)).toBe(ANCHOR + 147 * H);
    expect(forecastHourMs('x')).toBe(ANCHOR);
    const times = Array.from({ length: 200 }, (_, i) => iso(ANCHOR + i * H));
    expect(findHourIndex(times, 147)).toBe(147);
    onePoint(ANCHOR + 147 * H);
    // The structural pin that holds on a UTC CI runner too: the hour path has no local-time arithmetic left.
    expect(setHours).not.toHaveBeenCalled();
    expect(getHours).not.toHaveBeenCalled();
  });

  test('kill switch __RAW_DISABLE_INFOBOX_UTC_HOURS__ restores local setHours arithmetic', () => {
    window.__RAW_DISABLE_INFOBOX_UTC_HOURS__ = true;
    const setHours = jest.spyOn(Date.prototype, 'setHours');
    const legacy = new Date(NOW); legacy.setHours(legacy.getHours() + 147);
    setHours.mockClear();
    expect(forecastHourMs(147)).toBe(legacy.getTime());
    expect(setHours).toHaveBeenCalled();
  });

  test('across this machine\'s DST change (US Eastern: 2026-11-01), hour 147 is exactly 147 real hours', () => {
    const shift = (new Date(NOW + 147 * H).getTimezoneOffset() - new Date(NOW).getTimezoneOffset()) / 60;
    expect(forecastHourMs(147) - forecastHourMs(0)).toBe(147 * H);
    window.__RAW_DISABLE_INFOBOX_UTC_HOURS__ = true;
    // The old arithmetic was off by the zone's shift (+1 h on US Eastern; 0 on a UTC runner).
    expect(Math.round((forecastHourMs(147) - NOW) / H)).toBe(147 + shift);
  });
});

describe('P1-D which hour: a one-instant answer answers its own ask only', () => {
  test('pointAnswersSelection compares the ask instants; null when it does not apply', () => {
    const p = onePoint(ANCHOR + 6 * H);
    expect(pointAnswersSelection(p, new Date(ANCHOR + 6 * H).toISOString())).toBe(true);
    expect(pointAnswersSelection(p, new Date(ANCHOR + 7 * H).toISOString())).toBe(false);
    expect(pointAnswersSelection(p, null)).toBeNull();
    expect(pointAnswersSelection({ ...p, timeRangeEnd: iso(ANCHOR + 48 * H) }, new Date(ANCHOR).toISOString())).toBeNull();
    expect(pointAnswersSelection(null, 'x')).toBeNull();
  });

  test('a held answer gets the heatmap\'s pending words and is never called "the nearest stored forecast"', () => {
    const p = onePoint(ANCHOR + 6 * H);
    const w = describeInfoboxFrame({ point: p, model: 'GFS', layer: 'waves', hour: 7,
      askIso: new Date(ANCHOR + 7 * H).toISOString(), nearestMaxHours: 1 });
    expect(w).toMatchObject({ state: 'pending', held: true, dataMs: ANCHOR + 6 * H });
    expect(w.text).toBe(`Loading ${formatInstant(ANCHOR + 7 * H)}… still showing ${formatInstant(ANCHOR + 6 * H)}`);
  });

  test('the same data instant under a different ask is not held (the numbers ARE for the selected instant)', () => {
    const p = onePoint(ANCHOR + 6 * H, { served_valid_time: iso(ANCHOR + 7 * H) });
    const w = describeInfoboxFrame({ point: p, model: 'GFS', layer: 'waves', hour: 7,
      askIso: new Date(ANCHOR + 7 * H).toISOString(), nearestMaxHours: 1 });
    expect(w).toBeNull();
  });
});

describe('P1-C which frame: served_valid_time reaches the box and is worded like the heatmap', () => {
  test('selectExactPointHour passes the served frame through (the third whitelist)', () => {
    const p = onePoint(ANCHOR + 7 * H, { served_valid_time: iso(ANCHOR + 6 * H), frame_substituted: true, frame_offset_hours: -1 });
    expect(p).toMatchObject({ served_valid_time: iso(ANCHOR + 6 * H), frame_substituted: true, frame_offset_hours: -1 });
    expect(pointDataMs(p)).toBe(ANCHOR + 6 * H);
    expect(pointDataMs(onePoint(ANCHOR + 7 * H))).toBe(ANCHOR + 7 * H);   // no served time: the ask's instant
  });

  test('a substituted frame within the lattice half-step reads "the nearest stored forecast"', () => {
    const p = onePoint(ANCHOR + 7 * H, { served_valid_time: iso(ANCHOR + 6 * H), frame_substituted: true });
    const w = describeInfoboxFrame({ point: p, model: 'GFS', layer: 'waves', hour: 7,
      askIso: new Date(ANCHOR + 7 * H).toISOString(), nearestMaxHours: 1 });
    expect(w).toMatchObject({ state: 'nearest', held: false,
      text: `Showing ${formatInstant(ANCHOR + 6 * H)}: the nearest stored forecast` });
  });

  test('a held estimate past the stored tail reads the heatmap\'s "Holding" sentence', () => {
    // A plain selected point (selectExactPointHour gates ICON past its native hours on the flags, not the subject here).
    const ask = iso(ANCHOR + 300 * H);
    const p = { requestedModel: 'ICON', activeLayer: 'waves', time: ask, timeRangeStart: ask, timeRangeEnd: ask,
      served_valid_time: iso(ANCHOR + 290 * H), is_estimated: true, estimate_basis: { type: 'far_edge_hold' } };
    const w = describeInfoboxFrame({ point: p, model: 'ICON', layer: 'waves', hour: 300,
      askIso: new Date(ANCHOR + 300 * H).toISOString(), nearestMaxHours: 1 });
    expect(w.state).toBe('held');
    expect(w.text).toMatch(/^Holding .+’s ICON forecast: the 14-day estimate ends there$/);
    expect(w.held).toBe(false);   // the server's hold answers THIS ask; only another hour's answer is dimmed
  });

  test('a far frame that answers THIS ask never says "Loading" (nothing more is coming): the nearest stored forecast', () => {
    const p = onePoint(ANCHOR + 12 * H, { served_valid_time: iso(ANCHOR + 7 * H) });
    const w = describeInfoboxFrame({ point: p, model: 'GFS', layer: 'waves', hour: 12,
      askIso: new Date(ANCHOR + 12 * H).toISOString(), nearestMaxHours: 1 });
    expect(w).toMatchObject({ state: 'nearest', held: false,
      text: `Showing ${formatInstant(ANCHOR + 7 * H)}: the nearest stored forecast` });
  });

  test('a direct ECMWF read reads as a stand-in, not an estimate', () => {
    const p = onePoint(ANCHOR + 7 * H, { requestedModel: 'EURO', is_estimated: true,
      estimate_basis: { type: 'ecmwf_wam_direct_read', source_method: 'direct_point_api' } });
    expect(describeInfoboxFrame({ point: p, model: 'EURO', layer: 'waves', hour: 7,
      askIso: new Date(ANCHOR + 7 * H).toISOString(), nearestMaxHours: 1 }))
      .toMatchObject({ state: 'stand_in', text: 'EURO stand-in: ECMWF’s own wave model, read directly' });
  });

  test('kill switch __RAW_DISABLE_INFOBOX_FRAME_WORDS__ removes every word and every hold', () => {
    window.__RAW_DISABLE_INFOBOX_FRAME_WORDS__ = true;
    const v = infoboxFrameView({ point: onePoint(ANCHOR + 6 * H), model: 'GFS', layer: 'waves', hour: 7 });
    expect(v.words).toBeNull();
    expect(v.held).toBe(false);
  });
});

describe('infoboxFrameView: one call for the overlay, three themes', () => {
  test('header time names the numbers\' instant; classes differ per theme', () => {
    const p = onePoint(ANCHOR + 6 * H);
    const views = ['light', 'dark', 'beach'].map((theme) => infoboxFrameView({ point: p, model: 'GFS', layer: 'waves', hour: 8, theme }));
    for (const v of views) {
      expect(v.held).toBe(true);
      expect(v.timeLabel).toBe(formatInstant(ANCHOR + 6 * H, true));
      expect(v.wordsClass).toMatch(/text-amber-/);   // a pending/held line is a warning colour, beside its words
    }
    expect(new Set(views.map((v) => v.timeClass)).size).toBe(3);
    expect(new Set(views.map((v) => v.wordsClass)).size).toBe(3);
    // No point: the header names the selection's own hour.
    expect(infoboxFrameView({ point: null, model: 'GFS', layer: 'waves', hour: 8 }).timeLabel).toBe(formatInstant(ANCHOR + 8 * H, true));
  });

  test('checkAsk=false (pressure/rain clients snap their own ask) never holds', () => {
    const v = infoboxFrameView({ point: onePoint(ANCHOR + 6 * H), model: 'GFS', layer: 'pressure', hour: 8, checkAsk: false });
    expect(v.held).toBe(false);
  });

  test('InfoboxFrameWords renders a listitem named by its sentence, and nothing without words', () => {
    const v = infoboxFrameView({ point: onePoint(ANCHOR + 6 * H), model: 'GFS', layer: 'waves', hour: 8, theme: 'beach' });
    const { container, rerender } = render(<div role="list"><InfoboxFrameWords view={v} /></div>);
    const item = screen.getByRole('listitem');
    expect(item.getAttribute('aria-label')).toBe(v.words.text);
    expect(item.className).toContain('text-amber-300');
    rerender(<div role="list"><InfoboxFrameWords view={{ words: null }} /></div>);
    expect(container.querySelector('[data-testid="forecast-overlay-frame-words"]')).toBeNull();
  });
});

describe('P2 the Rating row says when it answered from another frame', () => {
  test('ratingFrameNote', () => {
    const r = { score: 70, level: 'good', servedValidTime: iso(ANCHOR + 6 * H) };
    expect(ratingFrameNote(r, ANCHOR + 9 * H)).toBe(`from ${formatInstant(ANCHOR + 6 * H)}`);
    expect(ratingFrameNote(r, ANCHOR + 6 * H)).toBeNull();
    expect(ratingFrameNote({ ...r, servedValidTime: null }, ANCHOR)).toBeNull();
    expect(ratingFrameNote(r, ANCHOR + 40 * H)).toBe(`from ${formatInstant(ANCHOR + 6 * H, true)}`);   // a day apart: dated
    window.__RAW_DISABLE_INFOBOX_RATING_TIME__ = true;
    expect(ratingFrameNote(r, ANCHOR + 9 * H)).toBeNull();
  });
});

describe('the card compiler: held rows dim, the rating carries its note, a direct read is not "(est.)"', () => {
  const base = (point, extra = {}) => compileForecastCards({
    activeLayer: 'waves', activeModel: point.requestedModel, isLoading: false, isExactPointAuthority: true,
    exactPointStatus: 'exact_success', useExactPoint: point, waveHeight: point.wave_height, wavePeriod: point.wave_period,
    waveDir: point.wave_direction, degToCompass: () => 'W', heightUnit: 'ft',
    surfRating: { score: 70, level: 'good' }, ...extra,
  });
  const find = (cards, label) => cards.find((c) => c.label === label);

  test('held: every height, period, direction and the badge are provisional', () => {
    const cards = base(onePoint(ANCHOR + 6 * H), { isHeldExactPoint: true });
    for (const label of ['Surf', 'Swell', 'Rating', 'Period']) expect(find(cards, label).provisional).toBe(true);
    expect(find(cards, 'Swell').value).toBe('3.3 ft…');
    const settled = base(onePoint(ANCHOR + 6 * H));
    for (const label of ['Surf', 'Swell', 'Rating', 'Period']) expect(find(settled, label).provisional).toBeFalsy();
  });

  test('the rating note is text and is spoken', () => {
    const r = find(base(onePoint(ANCHOR + 6 * H), { ratingNote: 'from Tue 3 PM' }), 'Rating');
    expect(r).toMatchObject({ note: 'from Tue 3 PM', ariaLabel: 'Rating: Good, from Tue 3 PM' });
    expect(find(base(onePoint(ANCHOR + 6 * H)), 'Rating').note).toBeUndefined();
  });

  test('a direct ECMWF read prints "(ECMWF)", an estimate "(est.)"; the kill switch restores "(est.)"', () => {
    const direct = onePoint(ANCHOR + 6 * H, { requestedModel: 'EURO', is_estimated: true,
      estimate_basis: { type: 'ecmwf_wam_direct_read', source_method: 'direct_point_api' } });
    const legacy = { ...direct, estimate_basis: { type: 'ecmwf_ifs_derived_fallback', source_method: 'direct_point_api' } };
    const est = { ...direct, estimate_basis: { type: 'native_time_interpolation' } };
    expect(find(base(direct), 'Swell').value).toBe('3.3 ft (ECMWF)');
    expect(find(base(legacy), 'Swell').value).toBe('3.3 ft (ECMWF)');   // an older backend's label, same lane
    expect(find(base(est), 'Swell').value).toBe('3.3 ft (est.)');
    window.__RAW_DISABLE_DIRECT_READ_WORDS__ = true;
    expect(find(base(direct), 'Swell').value).toBe('3.3 ft (est.)');
  });
});

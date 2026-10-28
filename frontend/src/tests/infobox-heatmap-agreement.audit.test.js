/**
 * Infobox vs heatmap, client half (audit 2026-10-27, offline; the backend half is
 * backend/tests/test_infobox_heatmap_agreement_audit.py).
 *
 * Owner: "Display correct data on heat map and in infobox." Each test pinned a way the infobox could show a number for a
 * different hour or frame than the heatmap, with no words saying so. The audit wrote them against dev 4bd90d0d9 (today's
 * behaviour); the infobox-honesty fix (infoboxFrameTime.js) flipped each on purpose, and each flipped assertion keeps the
 * audit's old reading in a comment so the change of meaning stays visible. The kill switches restore the old readings.
 */
import { selectExactPointHour } from '../components/map/forecastSamplers';
import { getSharedValidTime } from '../components/map/backendWeatherServiceClient';
import { setCachedManifest } from '../components/map/backendWeatherServiceClientCoverage';
import { pickIndexFrame } from '../components/map/staticFrameCodec';
import { compileForecastCards } from '../components/map/forecastCardCompiler';
import { formatHeightFromMeters } from '../components/map/heightUnits';
import { describeInfoboxFrame } from '../components/map/infoboxFrameTime';
import { formatInstant, latticeNearestMaxHours } from '../components/map/drawnFrameReadout';

const H = 3600000;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');

/** The single-hour response the GFS/ICON point client builds (backendWeatherServiceClientPoint.js, `data`). */
function pointResponse(validMs, { wave = 1.0, surf = 2.0, estimated = false, model = 'GFS', served = null, basis = null } = {}) {
  return {
    hourly: { time: [iso(validMs)], wave_height: [wave], wave_direction: [270], wave_period: [12] },
    requestedLat: 28.32, requestedLng: -80.61, requestedModel: model, activeLayer: 'waves',
    provider: estimated ? 'estimated' : 'open-meteo', source: 'network', status: 'exact_success',
    is_estimated: estimated, estimate_basis: basis, surf_height_m: surf, surf_regime: 'shoaling', surf_nearshore: true,
    served_valid_time: served,
  };
}

function cardsFor(point, extra = {}) {
  return compileForecastCards({
    activeLayer: 'waves', activeModel: point.requestedModel || 'GFS', isLoading: false,
    isExactPointAuthority: true, exactPointStatus: point.status, useExactPoint: point,
    waveHeight: point.wave_height, wavePeriod: point.wave_period, waveDir: point.wave_direction,
    degToCompass: () => 'W', heightUnit: 'ft', ...extra,
  });
}
const card = (cards, label) => cards.find((c) => c.label === label);
const wordsFor = (p, model, hour) => describeInfoboxFrame({
  point: p, model, layer: 'waves', hour,
  askIso: getSharedValidTime(hour, 'waves', model, { readOnly: true }), nearestMaxHours: latticeNearestMaxHours(model, hour),
});

afterEach(() => {
  jest.useRealTimers();
  setCachedManifest(null);
  delete window.__MOCK_DATE_NOW__;
  delete window.__RAW_DISABLE_INFOBOX_UTC_HOURS__;
  delete window.__RAW_DISABLE_INFOBOX_FRAME_WORDS__;
  delete window.__RAW_DISABLE_FIXED_HEIGHT_DECIMALS__;
});

describe('while the wheel moves, the infobox HOLDS the last settled hour and says so', () => {
  test('a 1-3 h step keeps the old hour, now dimmed with "Loading <selected>… still showing <time>" (surf included)', () => {
    const now = Date.parse('2026-10-27T10:40:00Z');
    jest.useFakeTimers('modern');
    jest.setSystemTime(now);
    const anchor = Date.parse('2026-10-27T11:00:00Z');          // getSeriesAnchorMs rounds to the hour
    const settled = pointResponse(anchor + 6 * H, { wave: 1.0, surf: 2.0 });   // fetched for wheel 6
    expect(wordsFor(selectExactPointHour(settled, 6), 'GFS', 6)).toBeNull();   // the settled hour: its own frame, no words
    for (const wheel of [7, 8, 9]) {
      const p = selectExactPointHour(settled, wheel);
      expect(p.status).toBe('exact_success');                    // still no "(latest)": 1-3 h is the nearest-frame band
      expect(p.wave_height).toBe(1.0);                           // hour 6's sea is still what the box holds
      const words = wordsFor(p, 'GFS', wheel);
      // AUDIT (4bd90d0d9): no words at all; the card read '3.3 ft' as if it were hour `wheel`.
      expect(words.held).toBe(true);
      expect(words.state).toBe('pending');
      expect(words.text).toBe(`Loading ${formatInstant(anchor + wheel * H)}… still showing ${formatInstant(anchor + 6 * H)}`);
      const cards = cardsFor(p, { isHeldExactPoint: words.held });
      expect(card(cards, 'Swell')).toMatchObject({ value: '3.3 ft…', provisional: true });
      expect(card(cards, 'Surf')).toMatchObject({ value: '6.6 ft (est.)…', provisional: true });
    }
    expect(selectExactPointHour(settled, 10).status).toBe('exact_stale_available');   // 4 h from the UTC anchor -> "(latest)"
  });

  test('kill switch: __RAW_DISABLE_INFOBOX_FRAME_WORDS__ returns the audit reading (no words, not held)', () => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(Date.parse('2026-10-27T10:40:00Z'));
    window.__RAW_DISABLE_INFOBOX_FRAME_WORDS__ = true;
    const p = selectExactPointHour(pointResponse(Date.parse('2026-10-27T17:00:00Z')), 8);
    expect(wordsFor(p, 'GFS', 8)).toBeNull();
    expect(card(cardsFor(p), 'Swell').value).toBe('3.3 ft');
  });
});

describe("EURO's 6-hourly band: the infobox and the heatmap take different frames, and both now say which", () => {
  const run = Date.parse('2026-10-26T12:00:00Z');
  const step = (h) => run + h * H;
  const product = (h, estimated) => ({
    model: 'EURO', domain: 'marine', layer: 'waves', valid_time_start: iso(step(h)), is_estimated: estimated,
  });

  test('at model step 147 the point reads the interpolated estimate and says so; the frame store draws 144', () => {
    window.__MOCK_DATE_NOW__ = Date.parse('2026-10-27T06:00:00Z');   // wheel = step - 18
    setCachedManifest({ products: [product(144, false), product(147, true), product(150, false)] });
    const asked = getSharedValidTime(129, 'waves', 'EURO', { readOnly: true });
    expect(asked).toBe(new Date(step(147)).toISOString());          // the /point valid_time
    const index = { frames: [144, 147, 150].map((h) => ({ valid_time: iso(step(h)), is_estimated: h === 147 })) };
    expect(pickIndexFrame(index, step(147)).valid_time).toBe(iso(step(144)));   // the heatmap's frame (P1-A: owner's call)
    jest.useFakeTimers('modern');
    jest.setSystemTime(window.__MOCK_DATE_NOW__);
    const p = selectExactPointHour(pointResponse(step(147), { estimated: true, model: 'EURO', served: iso(step(147)),
      basis: { type: 'native_time_interpolation' } }), 129);
    expect(p.served_valid_time).toBe(iso(step(147)));               // the served frame now reaches the infobox
    expect(card(cardsFor(p), 'Swell').value).toMatch(/\(est\.\)/);
    // AUDIT: no card or line said which frame; the heatmap's line says "the nearest stored forecast" for 144.
    expect(wordsFor(p, 'EURO', 129)).toMatchObject({ state: 'estimated', held: false,
      text: 'Estimated forecast: interpolated between stored forecasts' });
  });

  test('without the interpolated frame, the same wheel hour reads the same words at every clock minute', () => {
    const anchor = Date.parse('2026-11-10T11:00:00Z');        // no DST change within +150 h
    // Manifest order decides a 3 h tie (manifestTimeIndex.js): 150 listed first wins.
    setCachedManifest({ products: [
      { model: 'EURO', domain: 'marine', layer: 'waves', valid_time_start: iso(anchor + 150 * H) },
      { model: 'EURO', domain: 'marine', layer: 'waves', valid_time_start: iso(anchor + 144 * H) },
    ] });
    const read = (nowIso) => {
      jest.useFakeTimers('modern');
      jest.setSystemTime(Date.parse(nowIso));
      window.__MOCK_DATE_NOW__ = Date.parse(nowIso);
      const asked = Date.parse(getSharedValidTime(147, 'waves', 'EURO', { readOnly: true }));
      expect(asked).toBe(anchor + 150 * H);
      const p = selectExactPointHour(pointResponse(asked, { model: 'EURO' }), 147);
      return { swell: card(cardsFor(p), 'Swell').value, words: wordsFor(p, 'EURO', 147).text };
    };
    // AUDIT: '3.3 ft (latest)' at :40 (3h20 from an unrounded now + 147) and '3.3 ft' at :20 on the same frame.
    // Dated: the selection is six or more days out (drawnFrameReadout's datedPair rule, the heatmap line's own).
    const nearest = `Showing ${formatInstant(anchor + 150 * H, true)}: the nearest stored forecast`;
    expect(read('2026-11-10T10:40:00Z')).toEqual({ swell: '3.3 ft', words: nearest });
    expect(read('2026-11-10T11:20:00Z')).toEqual({ swell: '3.3 ft', words: nearest });
  });
});

describe('the infobox adds forecast hours on the heatmap clock (UTC anchor), not the LOCAL wall clock', () => {
  // findHourIndex and selectExactPointHour did `d.setHours(d.getHours() + offset)`; the heatmap's hour is
  // getSeriesAnchorMs() + offset * 1 h. US DST ends Sun 2026-11-01, inside today's 14-day wheel: past it, local "+h" is
  // h+1 real hours. TZ cannot be switched inside a Jest run, so the shift is derived from THIS machine's zone: on US
  // Eastern (the owner's, and this audit's) shift = +1; on a UTC CI runner shift = 0 and the structural pin in
  // infoboxFrameTime.test.js (no setHours on the hour path) carries the guarantee.
  const hourly = (startMs, n) => Array.from({ length: n }, (_, i) => iso(startMs + i * H));

  test('across a DST change, wheel hour 147 picks frame 147 (the kill switch brings back 147 + shift)', () => {
    const now = Date.parse('2026-10-27T11:00:00Z');
    const { findHourIndex } = require('../components/map/forecastHelpers');
    jest.useFakeTimers('modern');
    jest.setSystemTime(now);
    const shift = (new Date(now + 147 * H).getTimezoneOffset() - new Date(now).getTimezoneOffset()) / 60;
    expect(findHourIndex(hourly(now, 200), 147)).toBe(147);           // AUDIT: 147 + shift (148 on US Eastern)
    expect(findHourIndex(hourly(now, 200), 100)).toBe(100);
    window.__RAW_DISABLE_INFOBOX_UTC_HOURS__ = true;
    expect(findHourIndex(hourly(now, 200), 147)).toBe(147 + shift);   // the old local-clock reading, on purpose
  });
});

describe('units and rounding', () => {
  test('one formatter, one constant (3.28084); a readout keeps its tenth below 10 ft', () => {
    // AUDIT: '4 ft' (4.0) beside '4.1 ft', and 0.98 ft read '1.0 ft' while 1.02 ft read '1 ft'.
    expect(formatHeightFromMeters(1.2192, 'ft', { withUnit: true })).toBe('4.0 ft');
    expect(formatHeightFromMeters(1.25, 'ft', { withUnit: true })).toBe('4.1 ft');
    expect(formatHeightFromMeters(0.3, 'ft', { withUnit: true })).toBe('1.0 ft');       // 0.98 ft
    expect(formatHeightFromMeters(0.31, 'ft', { withUnit: true })).toBe('1.0 ft');      // 1.02 ft
    expect(formatHeightFromMeters(3.06, 'ft', { withUnit: true })).toBe('10 ft');       // integers from 10
    expect(formatHeightFromMeters(3.04, 'ft', { withUnit: true })).toBe('10 ft');       // 9.97 rounds to 10: no '10.0'
    expect(formatHeightFromMeters(1.2192, 'ft')).toBe('4');                             // legend stops: compact, unchanged
    window.__RAW_DISABLE_FIXED_HEIGHT_DECIMALS__ = true;
    expect(formatHeightFromMeters(1.2192, 'ft', { withUnit: true })).toBe('4 ft');      // kill switch: the audit reading
  });

  test('the dark heatmap floors a 4.0 ft node to 3.99 ft (byte 31 of 255 at 10 m)', () => {
    const byte = Math.floor((1.2192 / 10) * 255);
    expect(byte).toBe(31);
    expect(Math.round((byte / 255) * 10 * 3.28084 * 100) / 100).toBe(3.99);
  });
});

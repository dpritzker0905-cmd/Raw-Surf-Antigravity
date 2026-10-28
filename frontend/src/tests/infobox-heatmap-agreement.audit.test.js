/**
 * Infobox vs heatmap, client half (audit 2026-10-27, offline; the backend half is
 * backend/tests/test_infobox_heatmap_agreement_audit.py).
 *
 * Owner: "Display correct data on heat map and in infobox." Each test pins a way the infobox can show
 * a number for a different hour or frame than the heatmap, with no words saying so. They describe
 * TODAY's behaviour so a fix flips them on purpose.
 */
import { selectExactPointHour } from '../components/map/forecastSamplers';
import { getSharedValidTime } from '../components/map/backendWeatherServiceClient';
import { setCachedManifest } from '../components/map/backendWeatherServiceClientCoverage';
import { pickIndexFrame } from '../components/map/staticFrameCodec';
import { compileForecastCards } from '../components/map/forecastCardCompiler';
import { formatHeightFromMeters } from '../components/map/heightUnits';

const H = 3600000;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');

/** The single-hour response the GFS/ICON point client builds (backendWeatherServiceClientPoint.js:574). */
function pointResponse(validMs, { wave = 1.0, surf = 2.0, estimated = false, model = 'GFS' } = {}) {
  return {
    hourly: { time: [iso(validMs)], wave_height: [wave], wave_direction: [270], wave_period: [12] },
    requestedLat: 28.32, requestedLng: -80.61, requestedModel: model, activeLayer: 'waves',
    provider: estimated ? 'estimated' : 'open-meteo', source: 'network', status: 'exact_success',
    is_estimated: estimated, surf_height_m: surf, surf_regime: 'shoaling', surf_nearshore: true,
  };
}

function cardsFor(point) {
  return compileForecastCards({
    activeLayer: 'waves', activeModel: point.requestedModel || 'GFS', isLoading: false,
    isExactPointAuthority: true, exactPointStatus: point.status, useExactPoint: point,
    waveHeight: point.wave_height, wavePeriod: point.wave_period, waveDir: point.wave_direction,
    degToCompass: () => 'W', heightUnit: 'ft',
  });
}
const card = (cards, label) => cards.find((c) => c.label === label);

afterEach(() => {
  jest.useRealTimers();
  setCachedManifest(null);
  delete window.__MOCK_DATE_NOW__;
});

describe('while the wheel moves, the infobox keeps the LAST SETTLED hour', () => {
  test('a 1-3 h step shows the old hour as exact, unlabelled (surf included)', () => {
    const now = Date.parse('2026-10-27T10:40:00Z');
    jest.useFakeTimers('modern');
    jest.setSystemTime(now);
    const anchor = Date.parse('2026-10-27T11:00:00Z');          // getSeriesAnchorMs rounds to the hour
    const settled = pointResponse(anchor + 6 * H, { wave: 1.0, surf: 2.0 });   // fetched for wheel 6
    for (const wheel of [7, 8, 9]) {
      const p = selectExactPointHour(settled, wheel);
      expect(p.status).toBe('exact_success');                    // no "(latest)", no stale badge
      expect(p.wave_height).toBe(1.0);                           // hour 6's sea under wheel 7..9
      expect(p.surf_height_m).toBe(2.0);                         // a response-level scalar, never per hour
      expect(card(cardsFor(p), 'Swell').value).toBe('3.3 ft');
    }
    expect(selectExactPointHour(settled, 10).status).toBe('exact_stale_available');   // 3h40 -> "(latest)"
  });
});

describe("EURO's 6-hourly band: the infobox and the heatmap take different frames", () => {
  const run = Date.parse('2026-10-26T12:00:00Z');
  const step = (h) => run + h * H;
  const product = (h, estimated) => ({
    model: 'EURO', domain: 'marine', layer: 'waves', valid_time_start: iso(step(h)), is_estimated: estimated,
  });

  test('at model step 147 the point asks for the interpolated estimate, the frame store draws 144', () => {
    window.__MOCK_DATE_NOW__ = Date.parse('2026-10-27T06:00:00Z');   // wheel = step - 18
    setCachedManifest({ products: [product(144, false), product(147, true), product(150, false)] });
    const asked = getSharedValidTime(129, 'waves', 'EURO', { readOnly: true });
    expect(asked).toBe(new Date(step(147)).toISOString());          // the /point valid_time
    const index = { frames: [144, 147, 150].map((h) => ({ valid_time: iso(step(h)), is_estimated: h === 147 })) };
    expect(pickIndexFrame(index, step(147)).valid_time).toBe(iso(step(144)));   // the heatmap's frame
    // The infobox labels its number "(est.)"; the heatmap's line says "the nearest stored forecast".
    jest.useFakeTimers('modern');
    jest.setSystemTime(window.__MOCK_DATE_NOW__);
    const p = selectExactPointHour(pointResponse(step(147), { estimated: true, model: 'EURO' }), 129);
    const cards = cardsFor(p);
    expect(card(cards, 'Swell').value).toMatch(/\(est\.\)/);
    expect(cards.some((c) => /nearest|stored|Holding/i.test(`${c.label} ${c.value}`))).toBe(false);
  });

  test('without the interpolated frame, the same wheel hour reads "(latest)" or nothing by clock minute', () => {
    const anchor = Date.parse('2026-11-10T11:00:00Z');        // no DST change within +150 h (see below)
    // Manifest order decides a 3 h tie (manifestTimeIndex.js): 150 listed first wins.
    setCachedManifest({ products: [
      { model: 'EURO', domain: 'marine', layer: 'waves', valid_time_start: iso(anchor + 150 * H) },
      { model: 'EURO', domain: 'marine', layer: 'waves', valid_time_start: iso(anchor + 144 * H) },
    ] });
    const words = (nowIso) => {
      jest.useFakeTimers('modern');
      jest.setSystemTime(Date.parse(nowIso));
      window.__MOCK_DATE_NOW__ = Date.parse(nowIso);
      const asked = Date.parse(getSharedValidTime(147, 'waves', 'EURO', { readOnly: true }));
      expect(asked).toBe(anchor + 150 * H);
      const p = selectExactPointHour(pointResponse(asked, { model: 'EURO' }), 147);
      return card(cardsFor(p), 'Swell').value;
    };
    expect(words('2026-11-10T10:40:00Z')).toBe('3.3 ft (latest)');   // 3h20 from now+147
    expect(words('2026-11-10T11:20:00Z')).toBe('3.3 ft');            // 2h40: same frame, no word
  });
});

describe('the infobox adds forecast hours in LOCAL wall-clock time, the heatmap in UTC', () => {
  // findHourIndex (forecastHelpers.js:27-28) and selectExactPointHour (forecastSamplers.js:358-359) do
  // `d.setHours(d.getHours() + offset)`; the heatmap's hour is getSeriesAnchorMs() + offset * 1 h.
  // US DST ends Sun 2026-11-01, inside today's 14-day wheel: past it, local "+h" is h+1 real hours.
  const hourly = (startMs, n) => Array.from({ length: n }, (_, i) => iso(startMs + i * H));

  test('across a DST change, wheel hour 147 picks the hour the LOCAL clock says, not the heatmap frame', () => {
    // TZ cannot be switched inside a Jest run, so the expectation is derived from THIS machine's
    // offset change. On US Eastern (the owner's zone) shift = +1: hour 148 is shown under frame 147.
    const now = Date.parse('2026-10-27T11:00:00Z');
    const { findHourIndex } = require('../components/map/forecastHelpers');
    jest.useFakeTimers('modern');
    jest.setSystemTime(now);
    const shift = (new Date(now + 147 * H).getTimezoneOffset() - new Date(now).getTimezoneOffset()) / 60;
    expect(findHourIndex(hourly(now, 200), 147)).toBe(147 + shift);   // correct only where shift === 0
    expect(findHourIndex(hourly(now, 200), 100)).toBe(100);           // before Nov 1 06Z: right
  });
});

describe('units and rounding', () => {
  test('one formatter, one constant (3.28084); decimals drop at whole feet', () => {
    expect(formatHeightFromMeters(1.2192, 'ft', { withUnit: true })).toBe('4 ft');      // 4.0 ft
    expect(formatHeightFromMeters(1.25, 'ft', { withUnit: true })).toBe('4.1 ft');
    expect(formatHeightFromMeters(0.3, 'ft', { withUnit: true })).toBe('1.0 ft');       // 0.98 ft
    expect(formatHeightFromMeters(0.31, 'ft', { withUnit: true })).toBe('1 ft');        // 1.02 ft
    expect(formatHeightFromMeters(3.06, 'ft', { withUnit: true })).toBe('10 ft');       // integers from 10
  });

  test('the dark heatmap floors a 4.0 ft node to 3.99 ft (byte 31 of 255 at 10 m)', () => {
    const byte = Math.floor((1.2192 / 10) * 255);
    expect(byte).toBe(31);
    expect(Math.round((byte / 255) * 10 * 3.28084 * 100) / 100).toBe(3.99);
  });
});

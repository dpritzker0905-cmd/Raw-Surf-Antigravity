/**
 * Spot-hub phase 4, the pure half: the series decoded as frames, the tier window clipped again on the
 * client (the smaller of server and resolver), the owner's daily view (today + days-1 local days, the
 * leftover hours in the hourly chart only), the map-hour link, the text equivalents and the contrast
 * of every rating colour on every theme's card.
 */
import {
  CHART_THEME, LEVEL_KEYS, barOutline, contrast, dayLabel, decodeSeries, frameDescription, frameIndexForOffset,
  levelColor, localDate, offsetForFrame, offsetLabel, spotHubChartsEnabled, windArrowDeg,
} from './spotSeriesModel';
import { RATING_COLOR, RATING_LABEL } from '../../map/surfRating';
import { makeSeriesBody } from './spotSeries.fixture';

const H = 3600 * 1000;
const NOW = Date.parse('2026-11-04T16:20:00Z');
const fmt = (m) => `${(m * 3.28084).toFixed(1)} ft`;

afterEach(() => { delete window.__RAW_DISABLE_SPOT_HUB_CHARTS__; });

test('kill switch', () => {
  expect(spotHubChartsEnabled()).toBe(true);
  window.__RAW_DISABLE_SPOT_HUB_CHARTS__ = true;
  expect(spotHubChartsEnabled()).toBe(false);
});

test('anything but an ok body decodes to null (the caller falls back)', () => {
  expect(decodeSeries(null)).toBeNull();
  expect(decodeSeries({ status: 'unpublished' })).toBeNull();
  expect(decodeSeries({ status: 'ok' })).toBeNull();
});

test('the numbers are the series\', unit-converted only (cm -> m, score x10 -> score, index -> level)', () => {
  const body = makeSeriesBody({ nowMs: NOW });
  const s = decodeSeries(body, { nowMs: NOW, resolverHours: 72 });
  s.frames.forEach((f, i) => {
    expect(f.heightM).toBeCloseTo(body.frames.h[i] / 100, 10);
    expect(f.score).toBeCloseTo(body.frames.s[i] / 10, 10);
    expect(f.level).toBe(body.levels[body.frames.l[i]]);
    expect(f.windKt).toBe(body.frames.w[i]);
    expect(f.windWord).toBe(body.wind_words[body.frames.wd[i]]);
  });
});

test.each([[72, 3], [168, 7], [336, 14]])('window %i h: no frame past now + window, %i open daily columns', (hours, days) => {
  const s = decodeSeries(makeSeriesBody({ nowMs: NOW, hours }), { nowMs: NOW, resolverHours: hours });
  expect(Math.max(...s.frames.map((f) => f.ms))).toBeLessThanOrEqual(NOW + hours * H);
  expect(s.daily).toHaveLength(days);
  expect(s.daily.length + s.lockedDates.length).toBe(14);
});

test('the client clips again to the SMALLER of the resolver and the server (a boundary disagreement never opens a frame)', () => {
  // A server that sent 7 days to a client whose resolver says 3 (e.g. capabilities not yet loaded on one side).
  const s = decodeSeries(makeSeriesBody({ nowMs: NOW, hours: 168 }), { nowMs: NOW, resolverHours: 72 });
  expect(Math.max(...s.frames.map((f) => f.ms))).toBeLessThanOrEqual(NOW + 72 * H);
  expect(s.daily).toHaveLength(3);
  expect(s.lockedDates).toHaveLength(11);
  expect(s.horizonHours).toBe(72);
});

test('owner display: free shows today + 2 full local days daily, and the leftover hours only in the hourly chart', () => {
  const s = decodeSeries(makeSeriesBody({ nowMs: NOW, hours: 72 }), { nowMs: NOW, resolverHours: 72 });
  expect(s.daily.map((d) => d.date)).toEqual(['2026-11-04', '2026-11-05', '2026-11-06']);   // local, -8 h
  // Every frame of each open day is present (the day ends inside the rolling 72 h).
  s.daily.slice(1).forEach((d) => expect(d.frames).toHaveLength(8));
  expect(s.leftoverFrom).not.toBeNull();
  expect(s.leftoverFrom.date).toBe('2026-11-07');
  expect(s.lockedDates[0]).toBe('2026-11-07');
});

test('a daily column is the real max / min over its frames and its best-rated frame', () => {
  const s = decodeSeries(makeSeriesBody({ nowMs: NOW }), { nowMs: NOW, resolverHours: 72 });
  s.daily.forEach((d) => {
    const hs = d.frames.map((f) => f.heightM);
    expect(d.maxM).toBe(Math.max(...hs));
    expect(d.minM).toBe(Math.min(...hs));
    expect(d.best.score).toBe(Math.max(...d.frames.map((f) => f.score)));
    expect(d.level).toBe(d.best.level);
  });
});

test('the map hour picks the nearest frame, and a frame names its scrubber hour', () => {
  const s = decodeSeries(makeSeriesBody({ nowMs: NOW }), { nowMs: NOW, resolverHours: 72 });
  const anchor = Math.round(NOW / H) * H;
  expect(s.frames[frameIndexForOffset(s.frames, 0, anchor)].ms).toBeLessThanOrEqual(anchor + 1.5 * H);
  const i = frameIndexForOffset(s.frames, 24, anchor);
  expect(Math.abs(s.frames[i].ms - (anchor + 24 * H))).toBeLessThanOrEqual(1.5 * H);
  expect(offsetForFrame(s.frames[i], anchor)).toBe(Math.round((s.frames[i].ms - anchor) / H));
  expect(offsetForFrame(s.frames[0], anchor + 10 * H)).toBe(0);   // never before hour 0
  expect(frameIndexForOffset([], 3, anchor)).toBe(-1);
});

test('local solar time labels and dates', () => {
  expect(localDate(Date.parse('2026-11-05T05:00:00Z'), -8)).toBe('2026-11-04');
  expect(offsetLabel(-8)).toBe('UTC−8');
  expect(offsetLabel(2)).toBe('UTC+2');
  expect(offsetLabel(0)).toBe('UTC');
  expect(dayLabel('2026-11-05')).toEqual({ weekday: 'Thu', day: '5 Nov' });
});

test('every bar has a text equivalent: time, height, rating word, model spread, wind word, tide', () => {
  const s = decodeSeries(makeSeriesBody({ nowMs: NOW }), { nowMs: NOW, resolverHours: 72 });
  const spread = s.frames.find((f) => f.levelLo !== f.levelHi);
  const text = frameDescription(spread, fmt);
  expect(text).toContain(spread.label);
  expect(text).toContain(RATING_LABEL[spread.level]);
  expect(text).toMatch(/models range/);
  expect(text).toMatch(/kt (offshore|cross-shore|onshore)/);
  expect(text).toMatch(/tide -?\d+\.\d m/);
});

test('beyond +72 h there is no tide, and the series says where it ends', () => {
  const s = decodeSeries(makeSeriesBody({ nowMs: NOW, hours: 336 }), { nowMs: NOW, resolverHours: 336 });
  const last = s.frames.filter((f) => f.tideM != null).pop();
  expect(s.tideUntilMs).toBe(last.ms);
  expect(s.frames[s.frames.length - 1].tideM).toBeNull();
});

test('wind arrows are shore-relative and absent for an unknown word', () => {
  expect(windArrowDeg('offshore')).toBe(0);
  expect(windArrowDeg('onshore')).toBe(180);
  expect(windArrowDeg('cross-shore')).toBe(90);
  expect(windArrowDeg(null)).toBeNull();
});

test('the bar colours ARE the rating palette', () => {
  LEVEL_KEYS.forEach((l) => expect(levelColor(l)).toBe(RATING_COLOR[l]));
  expect(levelColor('nope')).toBe(RATING_COLOR.unknown);
});

test.each(['light', 'dark', 'beach'])('%s: every rating bar reads at 3:1 on the card (its fill, or its outline)', (theme) => {
  const bg = CHART_THEME[theme].bg;
  LEVEL_KEYS.forEach((l) => {
    const outline = barOutline(l, theme);
    const best = Math.max(contrast(RATING_COLOR[l], bg), outline ? contrast(outline, bg) : 0);
    expect(best).toBeGreaterThanOrEqual(3);
  });
  // and the chart's own text and selection marks read at 4.5:1 / 3:1
  expect(contrast(CHART_THEME[theme].text, bg)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(CHART_THEME[theme].muted, bg)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(CHART_THEME[theme].select, bg)).toBeGreaterThanOrEqual(3);
  expect(contrast(CHART_THEME[theme].tide, bg)).toBeGreaterThanOrEqual(3);
});

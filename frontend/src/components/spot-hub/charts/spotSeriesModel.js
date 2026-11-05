/**
 * spotSeriesModel.js: spot-hub phase 4 (2026-11-04). The PURE half of the hub charts: it turns one
 * /api/weather/spot-series response into frames, daily columns and labels. Nothing here computes a
 * height, a score or a level: every number is the one `rate_one_spot` wrote in CI (phase 3), so the
 * chart cannot disagree with the glyph or the hub (ONE FORECAST COMPOSITION).
 *
 * TIER. The server already trims to `forecast_tier_window` (its echo of
 * LayerAccessResolver.resolveForecastWindow). The client clips AGAIN to the resolver's hours and takes
 * the smaller (spotHubP1.effectiveWindowHours), so a frame the scrubber cannot reach is never drawn,
 * even when the two clocks or capability tables disagree near the boundary.
 *
 * OWNER DISPLAY DECISION (2026-11-04). The entitlement is ROLLING (free = the next 72 h). The hourly
 * chart shows every frame inside it; the DAILY row shows today + (days - 1) full local days (free:
 * today + 2, which always ends inside 72 h), so the leftover hours appear in the hourly chart only.
 * Day columns beyond the tier are locked (named by date, no data) with an upgrade prompt.
 *
 * LOCAL TIME is the spot's SOLAR time (round(lng / 15) h, the `utc_offset_hours` the series carries),
 * as the hub's daily rows use; the chart says so.
 *
 * Kill switch: window.__RAW_DISABLE_SPOT_HUB_CHARTS__ = true restores every surface's previous output.
 */
import { RATING_COLOR, RATING_LABEL } from '../../map/surfRating';

const HOUR_MS = 3600 * 1000;
export const LEVEL_KEYS = ['very_poor', 'poor', 'poor_fair', 'fair', 'fair_good', 'good', 'epic'];
export const WIND_WORDS = ['offshore', 'cross-shore', 'onshore'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function spotHubChartsEnabled() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_SPOT_HUB_CHARTS__ === true);
}

const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/** The local (solar) date of an instant: 'YYYY-MM-DD'. PURE. */
export function localDate(ms, offsetH) {
  return new Date(ms + offsetH * HOUR_MS).toISOString().slice(0, 10);
}

/** 'Tue 13:00' in the spot's local (solar) time. PURE. */
export function localTimeLabel(ms, offsetH) {
  const d = new Date(ms + offsetH * HOUR_MS);
  return `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
}

/** { weekday: 'Tue', day: '5 Nov' } for a 'YYYY-MM-DD' date. PURE. */
export function dayLabel(date) {
  const d = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return { weekday: '—', day: '' };
  return { weekday: WEEKDAYS[d.getUTCDay()], day: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` };
}

/** 'UTC−8' (a real minus sign), 'UTC+2', 'UTC'. PURE. */
export function offsetLabel(offsetH) {
  const o = Number(offsetH) || 0;
  return o === 0 ? 'UTC' : `UTC${o > 0 ? '+' : '−'}${Math.abs(o)}`;
}

/**
 * The response as frames + daily columns. Returns null for anything that is not an 'ok' body. PURE.
 * `resolverHours` = the client resolver's window (hubForecastWindow(user, model).hours).
 */
export function decodeSeries(body, { nowMs = Date.now(), resolverHours = null } = {}) {
  if (!body || body.status !== 'ok' || !body.frames || !Array.isArray(body.valid_times)) return null;
  const levels = Array.isArray(body.levels) ? body.levels : LEVEL_KEYS;
  const words = Array.isArray(body.wind_words) ? body.wind_words : WIND_WORDS;
  const off = Number(body.utc_offset_hours) || 0;
  const serverHours = num(body.horizon_hours);
  const hours = resolverHours != null && serverHours != null ? Math.min(resolverHours, serverHours)
    : (serverHours != null ? serverHours : resolverHours);
  const endMs = hours != null ? nowMs + hours * HOUR_MS : Infinity;
  const col = (name, i) => (Array.isArray(body.frames[name]) ? body.frames[name][i] : null);
  const frames = [];
  body.valid_times.forEach((vt, i) => {
    const ms = Date.parse(vt);
    if (!Number.isFinite(ms) || ms > endMs) return;
    const li = num(col('l', i));
    const lo = num(col('lo', i));
    const hi = num(col('hi', i));
    const h = num(col('h', i));
    const td = num(col('td', i));
    const wd = num(col('wd', i));
    frames.push({
      ms,
      date: localDate(ms, off),
      label: localTimeLabel(ms, off),
      heightM: h == null ? null : h / 100,
      score: num(col('s', i)) == null ? null : num(col('s', i)) / 10,
      level: li != null && levels[li] ? levels[li] : 'unknown',
      levelLo: lo != null && levels[lo] ? levels[lo] : null,
      levelHi: hi != null && levels[hi] ? levels[hi] : null,
      windKt: num(col('w', i)),
      windWord: wd != null && words[wd] ? words[wd] : null,
      swellM: num(col('sw', i)) == null ? null : num(col('sw', i)) / 100,
      tideM: td == null ? null : td / 100,
    });
  });
  frames.forEach((f, i) => { f.index = i; });
  const days = hours != null ? Math.max(1, Math.floor(hours / 24)) : (body.daily_dates || []).length;
  const openDates = (Array.isArray(body.daily_dates) ? body.daily_dates : []).slice(0, days);
  const lockedDates = [
    ...(Array.isArray(body.daily_dates) ? body.daily_dates.slice(days) : []),
    ...(Array.isArray(body.locked_dates) ? body.locked_dates : []),
  ];
  const daily = openDates.map((date) => dailyColumn(date, frames.filter((f) => f.date === date)));
  const lastDaily = openDates[openDates.length - 1];
  const leftover = frames.filter((f) => lastDaily && f.date > lastDaily);
  const tideMs = Date.parse(body.tide_until || '');
  return {
    model: body.model, tier: body.tier, offsetH: off, frames, daily, lockedDates,
    leftoverFrom: leftover.length ? leftover[0] : null,
    tideUntilMs: Number.isFinite(tideMs) ? tideMs : null,
    hasTide: frames.some((f) => f.tideM != null),
    horizonHours: hours, premiumDays: num(body.premium_days) || 14, daysAllowed: days,
    baseTime: body.base_time, generatedAt: body.generated_at,
  };
}

/** One daily column: real max / min over the day's frames, the best-rated frame, its wind. PURE. */
export function dailyColumn(date, dayFrames) {
  const sized = dayFrames.filter((f) => f.heightM != null);
  const rated = dayFrames.filter((f) => f.score != null);
  const best = rated.length ? rated.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  return {
    date,
    frames: dayFrames,
    maxM: sized.length ? Math.max(...sized.map((f) => f.heightM)) : null,
    minM: sized.length ? Math.min(...sized.map((f) => f.heightM)) : null,
    best,
    level: best ? best.level : 'unknown',
  };
}

/** The frame the map's hour names (nearest; ties to the earlier), or -1 with no frames. PURE. */
export function frameIndexForOffset(frames, offsetHours, anchorMs) {
  if (!Array.isArray(frames) || frames.length === 0) return -1;
  const target = anchorMs + (Number(offsetHours) || 0) * HOUR_MS;
  let best = 0;
  frames.forEach((f, i) => {
    if (Math.abs(f.ms - target) < Math.abs(frames[best].ms - target)) best = i;
  });
  return best;
}

/** The scrubber hour a frame stands for (never before hour 0). PURE. */
export function offsetForFrame(frame, anchorMs) {
  if (!frame) return 0;
  return Math.max(0, Math.round((frame.ms - anchorMs) / HOUR_MS));
}

export function levelWord(level) {
  return RATING_LABEL[level] || RATING_LABEL.unknown;
}

export function levelColor(level) {
  return RATING_COLOR[level] || RATING_COLOR.unknown;
}

/** Shore-relative wind arrow: offshore points out to sea (up), onshore at the beach (down). PURE. */
export function windArrowDeg(word) {
  if (word === 'offshore') return 0;
  if (word === 'onshore') return 180;
  if (word === 'cross-shore') return 90;
  return null;
}

/**
 * The text equivalent of a bar (never colour alone): "Tue 13:00, 4.1 ft, Fair to Good, 8 kt offshore,
 * tide 0.6 m". `fmtHeight(meters)` formats in the user's unit. PURE.
 */
export function frameDescription(f, fmtHeight) {
  if (!f) return '';
  const parts = [f.label, f.heightM == null ? 'no surf height' : fmtHeight(f.heightM), levelWord(f.level)];
  if (f.levelLo && f.levelHi && f.levelLo !== f.levelHi) parts.push(`models range ${levelWord(f.levelLo)} to ${levelWord(f.levelHi)}`);
  if (f.windKt != null) parts.push(`${f.windKt} kt${f.windWord ? ` ${f.windWord}` : ''}`);
  if (f.tideM != null) parts.push(`tide ${f.tideM.toFixed(1)} m`);
  return parts.join(', ');
}

// ── contrast (WCAG 2.x relative luminance) ──────────────────────────────────────────────────────────
function lum(hex) {
  const h = String(hex).replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// The chart's own palette per theme (the card each surface draws on, and the marks that must read on it).
export const CHART_THEME = {
  light: { bg: '#ffffff', grid: '#d1d5db', outline: '#374151', select: '#0f172a', tide: '#0e7490', text: '#111827', muted: '#4b5563' },
  beach: { bg: '#fffbeb', grid: '#e7c98f', outline: '#78350f', select: '#451a03', tide: '#0e7490', text: '#451a03', muted: '#92400e' },
  dark: { bg: '#18181b', grid: '#3f3f46', outline: '#e4e4e7', select: '#ffffff', tide: '#67e8f9', text: '#f4f4f5', muted: '#a1a1aa' },
};

export function chartTheme(theme) {
  return CHART_THEME[theme === 'light' || theme === 'beach' ? theme : 'dark'];
}

/** A bar's outline: none when its fill already reads at 3:1 (WCAG 1.4.11) on the card, else the theme's. PURE. */
export function barOutline(level, theme) {
  const t = chartTheme(theme);
  return contrast(levelColor(level), t.bg) >= 3 ? null : t.outline;
}

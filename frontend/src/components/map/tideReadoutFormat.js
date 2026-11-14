/**
 * tideReadoutFormat.js - PURE formatting for the infobox tide readout (2026-11-07). Input is the
 * /api/weather/point-tide payload (metres, UTC ISO strings); heights go through heightUnits so the
 * ft/m setting is honoured. No React, no I/O.
 */
import { formatHeightFromMeters } from './heightUnits';

export const TIDE_FOOTER = 'Modeled sea level · MSL';
export const TIDE_SOLAR_NOTE = 'times approx. (local solar time)';
export const TIDE_UNAVAILABLE = 'Modeled sea level unavailable for selected time';

export function infoboxTideDisabled() {
  return typeof window !== 'undefined' && window.__RAW_DISABLE_INFOBOX_TIDE__ === true;
}

const WORD = { rising: 'Rising', falling: 'Falling', slack: 'Slack' };
const ARROW = { rising: '↑', falling: '↓', slack: '→' };
export const trendWord = (t) => WORD[t] || 'Slack';
export const trendGlyph = (t) => ARROW[t] || ARROW.slack;

const browserOffset = (ms, bo) => (bo == null ? -new Date(ms).getTimezoneOffset() / 60 : bo);

/** True when times must be shown in the point's APPROXIMATE solar offset (browser zone is > 1.5 h away). */
export function tideUsesSolar(tzOffsetH, browserOffsetH, nowMs = Date.now()) {
  return tzOffsetH !== 'UTC' && tzOffsetH != null && Math.abs(browserOffset(nowMs, browserOffsetH) - tzOffsetH) > 1.5;
}

/** Format ms in the readout's zone: browser zone, or the solar offset (UTC-shifted). */
function inZone(ms, tzOffsetH, browserOffsetH, opts) {
  if (tzOffsetH === 'UTC') return new Date(ms).toLocaleString('en-US', { ...opts, timeZone: 'UTC' });
  if (!tideUsesSolar(tzOffsetH, browserOffsetH, ms)) return new Date(ms).toLocaleString('en-US', opts);
  return new Date(ms + tzOffsetH * 3600e3).toLocaleString('en-US', { ...opts, timeZone: 'UTC' });
}

/** "2:32 PM"; with refMs, "Sun 2:32 AM" when the instant falls on a different calendar day than refMs. */
export function formatTideTime(iso, tzOffsetH, browserOffsetH, refMs) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const t = inZone(ms, tzOffsetH, browserOffsetH, { hour: 'numeric', minute: '2-digit' });
  if (refMs == null) return t;
  const day = (m) => inZone(m, tzOffsetH, browserOffsetH, { year: 'numeric', month: 'numeric', day: 'numeric' });
  return day(ms) === day(refMs) ? t : `${inZone(ms, tzOffsetH, browserOffsetH, { weekday: 'short' })} ${t}`;
}

// Missing metadata keeps legacy hourly-series consumers working; declared metadata is authoritative.
function coverageRanges(coverage) {
  if (coverage === undefined) return undefined;
  if (!Array.isArray(coverage)) return null;
  const ranges = [];
  let previousEnd = -Infinity;
  for (const part of coverage) {
    const start = typeof part?.start === 'string' ? Date.parse(part.start) : NaN;
    const end = typeof part?.end === 'string' ? Date.parse(part.end) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || start <= previousEnd) return null;
    ranges.push([start, end]);
    previousEnd = end;
  }
  return ranges;
}

/** PURE: the tide at `atMs` from the cached payload (series + events), no network. null when out of coverage. */
export function tideAt(d, atMs) {
  const ser = d && d.series;
  if (!Array.isArray(ser) || ser.length < 2 || !Number.isFinite(atMs)) return null;
  const ts = ser.map((p) => Date.parse(p && p.t));
  if (ts.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= ts[i - 1]))) return null;
  if (atMs < ts[0] || atMs > ts[ts.length - 1]) return null;
  const ranges = coverageRanges(d.coverage);
  if (ranges === null) return null;
  const segment = ranges?.find(([start, end]) => start <= atMs && atMs <= end);
  if (ranges !== undefined && !segment) return null;
  let j = 0;
  while (j < ts.length - 2 && ts[j + 1] <= atMs) j++;
  const adjacent = (i) => i >= 0 && i + 1 < ser.length && Number.isFinite(ser[i].h)
    && Number.isFinite(ser[i + 1].h) && ts[i + 1] - ts[i] === 3600e3
    && (!segment || (segment[0] <= ts[i] && ts[i + 1] <= segment[1]));
  if (!adjacent(j) && atMs === ts[j] && adjacent(j - 1)) j--;
  if (!adjacent(j)) return null;
  let end = j + 1;
  while (adjacent(end)) end++;

  const slope = (ser[j + 1].h - ser[j].h) / ((ts[j + 1] - ts[j]) / 3600e3 || 1);   // m per hour
  const height = ser[j].h + slope * ((atMs - ts[j]) / 3600e3);
  const trend = slope > 0.02 ? 'rising' : slope < -0.02 ? 'falling' : 'slack';
  const ev = (Array.isArray(d.events) ? d.events : []).filter((e) => e && Number.isFinite(e.height_m) && Date.parse(e.time) > atMs && Date.parse(e.time) <= ts[end]).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const nxt = (type) => { const e = ev.find((x) => x.type === type); return e ? { time: e.time, height_m: e.height_m } : null; };
  return {
    ...d, available: true, selected_time_available: true, tz_offset_h: 'UTC', tz_approx: false,
    series: ser.filter((p, i) => ts[i] >= atMs - 6 * 3600e3 && ts[i] <= atMs + 18 * 3600e3),
    height_m: Math.round(height * 1000) / 1000, trend, rate_m_per_h: Math.round(slope * 1000) / 1000,
    next_high: nxt('High'), next_low: nxt('Low'), now: new Date(atMs).toISOString(),
  };
}

/** Legacy coverage helper. Cache refresh is wall-clock based, independent of this test. */
export function tideCovers(d, atMs) {
  const ser = d && d.series;
  const hasHorizon = !!(ser && ser.length && Date.parse(ser[ser.length - 1].t) >= atMs + 6 * 3600e3);
  const ranges = coverageRanges(d?.coverage);
  return hasHorizon && (ranges === undefined || !!ranges?.some(([start, end]) => start <= atMs && end >= atMs + 6 * 3600e3));
}

export function formatTideHeight(m, unit) {
  if (m == null || Number.isNaN(Number(m))) return formatHeightFromMeters(m, unit, { withUnit: true });
  const magnitude = formatHeightFromMeters(Math.abs(m), unit, { withUnit: true });
  return m < 0 && Number.parseFloat(magnitude) !== 0 ? `-${magnitude}` : magnitude;
}

/** "Next high 2:32 PM · 1.2 m", or null when there is no such event. */
export function formatTideEvent(label, ev, unit, tz, browserOffsetH, refMs) {
  if (!ev || !ev.time || !Number.isFinite(ev.height_m)) return null;
  const zone = tz === 'UTC' ? ' UTC' : '';
  return `Next ${label} ${formatTideTime(ev.time, tz, browserOffsetH, refMs)}${zone} · ${formatTideHeight(ev.height_m, unit)}`;
}

/** "0.2 ft/h" (magnitude; direction is the word + arrow). null when unknown or slack. */
export function formatTideRate(rate, unit, trend) {
  if (trend === 'slack' || rate == null || Math.abs(rate) < 0.005) return null;
  return `${formatTideHeight(Math.abs(rate), unit)}/h`;
}

/** Screen-reader summary: "Tide rising, 0.6 m now, high 1.2 m at 2:32 PM". */
export function tideAriaLabel(d, unit, browserOffsetH) {
  const next = d.trend === 'falling' ? (d.next_low || d.next_high) : (d.next_high || d.next_low);
  let s = `Tide ${String(d.trend || 'slack')}, ${formatTideHeight(d.height_m, unit)} at selected time`;
  if (next) {
    const kind = next === d.next_high ? 'high' : 'low';
    const zone = d.tz_offset_h === 'UTC' ? ' UTC' : '';
    s += `, ${kind} ${formatTideHeight(next.height_m, unit)} at ${formatTideTime(next.time, d.tz_offset_h, browserOffsetH, Date.parse(d.now))}${zone}`;
  }
  return s;
}

/** SVG geometry. Pass the payload to preserve declared gaps; legacy series arrays still work. */
export function tideCurve(input, nowIso, w = 176, h = 40, pad = 4) {
  const payload = Array.isArray(input) ? { series: input } : input;
  const series = payload?.series;
  if (!Array.isArray(series) || series.length < 3) return null;
  const ts = series.map((p) => Date.parse(p && p.t));
  if (ts.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= ts[i - 1]))) return null;
  const ranges = coverageRanges(payload.coverage);
  if (ranges === null) return null;
  const valid = series.map((p, i) => Number.isFinite(p.h)
    && (ranges === undefined || ranges.some(([start, end]) => start <= ts[i] && ts[i] <= end)));
  const hs = series.filter((p, i) => valid[i]).map((p) => p.h);
  if (hs.length < 2) return null;
  const lo = Math.min(...hs);
  const span = Math.max(...hs) - lo || 1;
  const x = (t) => pad + ((t - ts[0]) / (ts[ts.length - 1] - ts[0])) * (w - 2 * pad);
  const y = (v) => h - pad - ((v - lo) / span) * (h - 2 * pad);
  const path = series.map((p, i) => {
    if (!valid[i]) return '';
    const connected = i > 0 && valid[i - 1] && ts[i] - ts[i - 1] === 3600e3
      && (ranges === undefined || ranges.some(([start, end]) => start <= ts[i - 1] && ts[i] <= end));
    return `${connected ? 'L' : 'M'}${x(ts[i]).toFixed(1)} ${y(p.h).toFixed(1)}`;
  }).filter(Boolean).join(' ');
  const selected = tideAt(payload, Date.parse(nowIso));
  return { path, nowX: selected ? x(Date.parse(nowIso)) : null,
    nowY: selected ? y(selected.height_m) : null, w, h };
}

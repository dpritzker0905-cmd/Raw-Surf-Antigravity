/**
 * tideReadoutFormat.js - PURE formatting for the infobox tide readout (2026-11-07). Input is the
 * /api/weather/point-tide payload (metres, UTC ISO strings); heights go through heightUnits so the
 * ft/m setting is honoured. No React, no I/O.
 */
import { formatHeightFromMeters } from './heightUnits';

export const TIDE_FOOTER = 'Model sea level (MSL), ~11 km cell, not an official tide table';
export const TIDE_SOLAR_NOTE = 'times approx. (local solar time)';
export const TIDE_UNAVAILABLE = 'Tide unavailable here';

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
  return tzOffsetH != null && Math.abs(browserOffset(nowMs, browserOffsetH) - tzOffsetH) > 1.5;
}

/** Format ms in the readout's zone: browser zone, or the solar offset (UTC-shifted). */
function inZone(ms, tzOffsetH, browserOffsetH, opts) {
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

/** PURE: the tide at `atMs` from the cached payload (series + events), no network. null when out of coverage. */
export function tideAt(d, atMs) {
  const ser = d && d.series;
  if (!Array.isArray(ser) || ser.length < 2) return null;
  const ts = ser.map((p) => Date.parse(p.t));
  if (atMs < ts[0] || atMs > ts[ts.length - 1]) return null;
  let j = 0;
  while (j < ts.length - 2 && ts[j + 1] <= atMs) j++;
  const slope = (ser[j + 1].h - ser[j].h) / ((ts[j + 1] - ts[j]) / 3600e3 || 1);   // m per hour
  const height = ser[j].h + slope * ((atMs - ts[j]) / 3600e3);
  const trend = slope > 0.02 ? 'rising' : slope < -0.02 ? 'falling' : 'slack';
  const ev = (Array.isArray(d.events) ? d.events : []).filter((e) => Date.parse(e.time) > atMs);
  const nxt = (type) => { const e = ev.find((x) => x.type === type); return e ? { time: e.time, height_m: e.height_m } : null; };
  return {
    ...d, height_m: Math.round(height * 1000) / 1000, trend, rate_m_per_h: Math.round(slope * 1000) / 1000,
    next_high: nxt('High'), next_low: nxt('Low'), now: new Date(atMs).toISOString(),
  };
}

/** Does the cached series still reach atMs + 6 h? (else the hook refetches) */
export function tideCovers(d, atMs) {
  const ser = d && d.series;
  return !!(ser && ser.length && Date.parse(ser[ser.length - 1].t) >= atMs + 6 * 3600e3);
}

export function formatTideHeight(m, unit) {
  return formatHeightFromMeters(m, unit, { withUnit: true });
}

/** "Next high 2:32 PM · 1.2 m", or null when there is no such event. */
export function formatTideEvent(label, ev, unit, tz, browserOffsetH, refMs) {
  if (!ev || !ev.time) return null;
  return `Next ${label} ${formatTideTime(ev.time, tz, browserOffsetH, refMs)} · ${formatTideHeight(ev.height_m, unit)}`;
}

/** "0.2 ft/h" (magnitude; direction is the word + arrow). null when unknown or slack. */
export function formatTideRate(rate, unit) {
  if (rate == null || Math.abs(rate) < 0.005) return null;
  return `${formatTideHeight(Math.abs(rate), unit)}/h`;
}

/** Screen-reader summary: "Tide rising, 0.6 m now, high 1.2 m at 2:32 PM". */
export function tideAriaLabel(d, unit, browserOffsetH) {
  const next = d.trend === 'falling' ? (d.next_low || d.next_high) : (d.next_high || d.next_low);
  let s = `Tide ${String(d.trend || 'slack')}, ${formatTideHeight(d.height_m, unit)} now`;
  if (next) {
    const kind = next === d.next_high ? 'high' : 'low';
    s += `, ${kind} ${formatTideHeight(next.height_m, unit)} at ${formatTideTime(next.time, d.tz_offset_h, browserOffsetH, Date.parse(d.now))}`;
  }
  return s;
}

/** SVG geometry for the curve: { path, nowX, nowY, w, h } or null (needs >= 3 points). */
export function tideCurve(series, nowIso, w = 176, h = 40, pad = 4) {
  if (!Array.isArray(series) || series.length < 3) return null;
  const ts = series.map((p) => Date.parse(p.t));
  const hs = series.map((p) => p.h);
  const t0 = ts[0];
  const t1 = ts[ts.length - 1];
  const lo = Math.min(...hs);
  const hi = Math.max(...hs);
  const span = hi - lo || 1;
  const x = (t) => pad + ((t - t0) / (t1 - t0 || 1)) * (w - 2 * pad);
  const y = (v) => h - pad - ((v - lo) / span) * (h - 2 * pad);
  const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(ts[i]).toFixed(1)} ${y(p.h).toFixed(1)}`).join(' ');
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(nowMs)) return { path, nowX: null, nowY: null, w, h };
  let j = 0;
  while (j < ts.length - 2 && ts[j + 1] <= nowMs) j++;
  const f = Math.max(0, Math.min(1, (nowMs - ts[j]) / (ts[j + 1] - ts[j] || 1)));
  return { path, nowX: x(nowMs), nowY: y(hs[j] + f * (hs[j + 1] - hs[j])), w, h };
}

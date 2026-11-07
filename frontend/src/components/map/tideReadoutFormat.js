/**
 * tideReadoutFormat.js - PURE formatting for the infobox tide readout (2026-11-07). Input is the
 * /api/weather/point-tide payload (metres, UTC ISO strings); heights go through heightUnits so the
 * ft/m setting is honoured. No React, no I/O.
 */
import { formatHeightFromMeters } from './heightUnits';

export const TIDE_FOOTER = 'Model sea level (MSL), ~11 km cell, not an official tide table';
export const TIDE_UNAVAILABLE = 'Tide unavailable here';

export function infoboxTideDisabled() {
  return typeof window !== 'undefined' && window.__RAW_DISABLE_INFOBOX_TIDE__ === true;
}

const WORD = { rising: 'Rising', falling: 'Falling', slack: 'Slack' };
const ARROW = { rising: '↑', falling: '↓', slack: '→' };
export const trendWord = (t) => WORD[t] || 'Slack';
export const trendGlyph = (t) => ARROW[t] || ARROW.slack;

/** "2:32 PM" in the browser zone when it agrees (<= 1.5 h) with the point's solar offset, else in the solar offset. */
export function formatTideTime(iso, tzOffsetH, browserOffsetH) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const bo = browserOffsetH == null ? -new Date(ms).getTimezoneOffset() / 60 : browserOffsetH;
  const useBrowser = tzOffsetH == null || Math.abs(bo - tzOffsetH) <= 1.5;
  const opts = { hour: 'numeric', minute: '2-digit' };
  if (useBrowser) return new Date(ms).toLocaleTimeString('en-US', opts);
  return new Date(ms + tzOffsetH * 3600e3).toLocaleTimeString('en-US', { ...opts, timeZone: 'UTC' });
}

export function formatTideHeight(m, unit) {
  return formatHeightFromMeters(m, unit, { withUnit: true });
}

/** "Next high 2:32 PM · 1.2 m", or null when there is no such event. */
export function formatTideEvent(label, ev, unit, tz, browserOffsetH) {
  if (!ev || !ev.time) return null;
  return `Next ${label} ${formatTideTime(ev.time, tz, browserOffsetH)} · ${formatTideHeight(ev.height_m, unit)}`;
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
    s += `, ${kind} ${formatTideHeight(next.height_m, unit)} at ${formatTideTime(next.time, d.tz_offset_h, browserOffsetH)}`;
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

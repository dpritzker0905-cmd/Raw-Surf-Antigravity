// forecastReadout.js — what the timeline's time readout says.
//
// F-07 / T-01 (audit 14.1, measured live 2026-09-23 on dev b75ed960): the readout printed BROWSER
// time + the wheel offset. That is a third clock: at 03:31Z with the wheel on +1 it read "4 AM",
// the forecast anchor (getSeriesAnchorMs, which rounds) meant 05:00, and the 3-hourly marine layer
// drew the 06:00 frame. A surfer reads that label as "the forecast I'm looking at".
//
// The readout now names the instant that is actually displayed: for layers the manifest lanes serve
// (marine + wind) that is getSharedValidTime's selection — the SAME function both fetch lanes use —
// and otherwise the forecast anchor + offset. It never fetches: readOnly keeps it a pure read of the
// cached manifest, safe to call on every render of the scrubber.

import { getSharedValidTime, getSeriesAnchorMs } from './backendWeatherServiceClient';
import { windIndexSync } from './windStaticFrames';
import { blendBracket, indexRunMs, windTimeBlendOn } from './windTimeBlend';

const MANIFEST_LAYERS = new Set(['waves', 'swell_1', 'swell_2', 'wind_waves', 'wind']);
const HOUR_MS = 3600000;

/** The displayed forecast instant for a wheel hour: `{ ms, requestedMs, snapped }`. Never throws. */
export function displayedForecastTime(hour, layer, model) {
  const h = Number(hour) || 0;
  let anchorMs;
  try { anchorMs = getSeriesAnchorMs(); } catch (e) { anchorMs = NaN; }
  if (!Number.isFinite(anchorMs)) anchorMs = Math.round(Date.now() / HOUR_MS) * HOUR_MS;
  const requestedMs = anchorMs + h * HOUR_MS;
  let ms = requestedMs;
  // The wind f120+ tail blend (windTimeBlend.js, opt-in): between two built static frames at or past f120 the field drawn IS
  // valid at the requested instant (a labelled PCHIP estimate), so the readout names that instant, not the snapped frame. The
  // same bracket rule as the seam (run + 120 h), so the readout never names a blend the map does not draw. While the frames'
  // bytes are still loading the nearest frame is drawn instead, and the wind status line names it in the same frame.
  if (layer === 'wind' && windTimeBlendOn() && String(model || 'GFS').toUpperCase() === 'GFS') {
    let br = null;
    try { const idx = windIndexSync(); br = idx ? blendBracket(idx.frames, requestedMs, indexRunMs(idx)) : null; } catch (e) { br = null; }
    if (br) return { ms: requestedMs, requestedMs, snapped: false, blend: br };
  }
  if (MANIFEST_LAYERS.has(layer)) {
    try {
      const iso = getSharedValidTime(h, layer, model, { readOnly: true });
      const parsed = Date.parse(iso);
      if (Number.isFinite(parsed)) ms = parsed;
    } catch (e) { /* keep the requested instant */ }
  }
  return { ms, requestedMs, snapped: ms !== requestedMs };
}

// CACHED FORMATTERS (kill: window.__RAW_DISABLE_INTL_FORMAT_CACHE__ = true). toLocale*String builds a new Intl.DateTimeFormat
// on every call, and this runs on every scrubber render (the 2026-10-20 stall profile, PR #400: 75-220 ms of main-thread stall
// per erratic run). One pair per timeZone is kept instead. Same strings: with a field given (weekday / hour) neither
// toLocaleDateString nor toLocaleTimeString adds default fields, so each is Intl.DateTimeFormat with the same options
// (pinned by forecastReadout.formatCache.test.js). An invalid timeZone still throws the same RangeError, and is not cached.
const formatterCache = new Map();
const FORMATTER_CACHE_MAX = 16;

function formattersFor(timeZone) {
  const key = timeZone || '';
  let f = formatterCache.get(key);
  if (!f) {
    const opts = timeZone ? { timeZone } : {};
    f = {
      day: new Intl.DateTimeFormat('en-US', { weekday: 'short', ...opts }),
      hour: new Intl.DateTimeFormat('en-US', { hour: 'numeric', ...opts }),
    };
    if (formatterCache.size >= FORMATTER_CACHE_MAX) formatterCache.clear();
    formatterCache.set(key, f);
  }
  return f;
}

export function formatInstant(ms, timeZone) {
  const d = new Date(ms);
  // An Invalid Date takes the toLocale path: it returns 'Invalid Date' where Intl's format() throws.
  if (!Number.isNaN(d.getTime()) && (typeof window === 'undefined' || window.__RAW_DISABLE_INTL_FORMAT_CACHE__ !== true)) {
    const f = formattersFor(timeZone);
    return `${f.day.format(d)} ${f.hour.format(d)}`;
  }
  const opts = timeZone ? { timeZone } : {};
  return `${d.toLocaleDateString('en-US', { weekday: 'short', ...opts })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', ...opts })}`;
}

/**
 * `{ text, srText }` for the readout. `text` stays short for the 50px chip; `srText` says in words
 * when the display snapped to the model's nearest time step, so the snap is never conveyed only by
 * a number changing (ACCESSIBILITY mandate). Hour 0 keeps the product copy "Live".
 */
export function forecastReadout(hour, layer, model, { timeZone } = {}) {
  const { ms, requestedMs, snapped, blend } = displayedForecastTime(hour, layer, model);
  const shown = formatInstant(ms, timeZone);
  const text = (Number(hour) || 0) === 0 ? 'Live' : shown;
  const srText = blend
    ? `Showing an estimate for ${shown}, interpolated between the forecasts for ${formatInstant(blend.t0, timeZone)} and ${formatInstant(blend.t1, timeZone)}.`
    : snapped
      ? `Showing the forecast for ${shown}, the nearest model time step to ${formatInstant(requestedMs, timeZone)}.`
      : `Showing the forecast for ${shown}.`;
  return { text, srText };
}

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
  if (MANIFEST_LAYERS.has(layer)) {
    try {
      const iso = getSharedValidTime(h, layer, model, { readOnly: true });
      const parsed = Date.parse(iso);
      if (Number.isFinite(parsed)) ms = parsed;
    } catch (e) { /* keep the requested instant */ }
  }
  return { ms, requestedMs, snapped: ms !== requestedMs };
}

function formatInstant(ms, timeZone) {
  const d = new Date(ms);
  const opts = timeZone ? { timeZone } : {};
  return `${d.toLocaleDateString('en-US', { weekday: 'short', ...opts })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', ...opts })}`;
}

/**
 * `{ text, srText }` for the readout. `text` stays short for the 50px chip; `srText` says in words
 * when the display snapped to the model's nearest time step, so the snap is never conveyed only by
 * a number changing (ACCESSIBILITY mandate). Hour 0 keeps the product copy "Live".
 */
export function forecastReadout(hour, layer, model, { timeZone } = {}) {
  const { ms, requestedMs, snapped } = displayedForecastTime(hour, layer, model);
  const shown = formatInstant(ms, timeZone);
  const text = (Number(hour) || 0) === 0 ? 'Live' : shown;
  const srText = snapped
    ? `Showing the forecast for ${shown}, the nearest model time step to ${formatInstant(requestedMs, timeZone)}.`
    : `Showing the forecast for ${shown}.`;
  return { text, srText };
}

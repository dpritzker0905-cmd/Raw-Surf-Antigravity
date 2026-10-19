/**
 * drawnFrameReadout.js — words for the gap between the hour/layer/model the user SELECTED and the frame the map DREW
 * (W-1, scrub audit 2026-10-18). Pure; the status line under the timeline renders it (ForecastTimeStatus).
 *
 * The rule (CLAUDE.md accessibility + the audit's central invariant): never show an older or different field as the
 * selection without saying so in the same frame, in words (never colour alone).
 *   pending   — the drawn layer/model differs (a switch is loading), or the drawn hour is far from the selection
 *   nearest   — the drawn hour is the nearest stored forecast (all marine data is 3-hourly; EURO waves 6-hourly past 144 h)
 *   estimated — the frame is an estimate / blend (ICON swell 2, the extended tails that reach 14 days)
 * Returns null when the drawn frame IS the selection and is not an estimate.
 */
const LAYER_NAMES = { waves: 'Waves', swell_1: 'Swell', swell_2: 'Swell 2', wind_waves: 'Wind Waves', wind: 'Wind' };
const MARINE_LAYERS = new Set(['waves', 'swell_1', 'swell_2', 'wind_waves']);
const MODEL_NAMES = { GFS: 'GFS', ICON: 'ICON', EURO: 'EURO' };
// The widest step any stored marine lattice has (EURO WAM past 144 h is 6-hourly): a drawn frame within half of it is
// the nearest stored forecast, anything further is still loading.
const NEAREST_MAX_HOURS = 3;

const ESTIMATE_WORDS = {
  icon_swell_2_gfs_euro_blend: 'blended from GFS and EURO',
  icon_persistence_gfs_blend: 'beyond ICON’s native range',
  icon_trend_extrapolation: 'beyond ICON’s native range',
  gfs_estimated_fallback: 'GFS stand-in beyond this model’s range',
};

export function formatForecastHour(hour, nowMs = Date.now()) {
  if (!Number.isFinite(hour)) return '';
  const d = new Date(nowMs + hour * 3600000);
  d.setMinutes(0, 0, 0);
  return d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric' });
}

export function formatInstant(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' });
}

function estimateWords(drawn) {
  if (!drawn || !drawn.estimated) return '';
  return ESTIMATE_WORDS[drawn.basisType] || 'estimated';
}

export function describeDrawnFrame(requested, drawn, { nowMs = Date.now() } = {}) {
  if (!requested || !drawn) return null;
  const layer = (l) => LAYER_NAMES[l] || l || '';
  const model = (m) => MODEL_NAMES[m] || m || '';
  if ((drawn.model && requested.model && drawn.model !== requested.model)
      || (drawn.layer && requested.layer && drawn.layer !== requested.layer)) {
    return { state: 'pending',
      text: `Loading ${model(requested.model)} ${layer(requested.layer)}… still showing ${model(drawn.model)} ${layer(drawn.layer)}` };
  }
  const est = estimateWords(drawn);
  // Compare by INSTANT when both are known (the #267 rule, marineHourInstant.js: the label names the request, the valid time
  // names the data): requested.instantMs = what a fetch for the selected hour asks for now (getSharedValidTime), drawn.dataMs =
  // the frame's served valid time. Else fall back to the hour labels.
  const byInstant = Number.isFinite(requested.instantMs) && Number.isFinite(drawn.dataMs);
  const dh = byInstant ? Math.round((drawn.dataMs - requested.instantMs) / 3600000)
    : (Number.isFinite(drawn.hour) && Number.isFinite(requested.hour) ? drawn.hour - requested.hour : 0);
  const drawnLabel = byInstant ? formatInstant(drawn.dataMs) : formatForecastHour(drawn.hour, nowMs);
  if (dh !== 0) {
    if (Math.abs(dh) <= (Number.isFinite(requested.nearestMaxHours) ? requested.nearestMaxHours : NEAREST_MAX_HOURS)) {   // caller may pass its lattice's half-step
      return { state: 'nearest', text: `Showing ${drawnLabel}: the nearest stored forecast${est ? ` (${est})` : ''}` };
    }
    return { state: 'pending', text: `Loading ${formatForecastHour(requested.hour, nowMs)}… still showing ${drawnLabel}` };
  }
  if (est) return { state: 'estimated', text: `Estimated forecast: ${est}` };
  return null;
}

/**
 * T-05: the point card's "stale hour retained" badge, decided from the drawn frame instead of a status object published
 * a render later. Shows while the drawn frame is genuinely pending (another layer/model, or far from the selected hour);
 * never sticks once the drawn frame is the selection or its nearest stored forecast.
 * Kill: window.__RAW_DISABLE_DRAWN_STALE_BADGE__ = true (returns `status` unchanged).
 */
export function reconcileStaleBadge(status, requested, drawn) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_DRAWN_STALE_BADGE__ === true) return status;
  if (!requested || !drawn || !MARINE_LAYERS.has(requested.layer)) return status;
  const r = describeDrawnFrame(requested, drawn);
  if (r && r.state === 'pending') return 'retained_stale_warning';
  return status === 'retained_stale_warning' ? null : status;
}

/**
 * drawnFrameReadout.js — words for the gap between the hour/layer/model the user SELECTED and the frame the map DREW
 * (W-1, scrub audit 2026-10-18). Pure; the status line under the timeline renders it (ForecastTimeStatus).
 *
 * The rule (CLAUDE.md accessibility + the audit's central invariant): never show an older or different field as the
 * selection without saying so in the same frame, in words (never colour alone).
 *   pending   — the drawn layer/model differs (a switch is loading), or the drawn hour is far from the selection
 *   nearest   — the drawn hour is the nearest stored forecast (all marine data is 3-hourly; EURO 6-hourly past model step 144)
 *   estimated — the frame is an estimate / blend (ICON swell 2, the extended tails that reach 14 days)
 * Returns null when the drawn frame IS the selection and is not an estimate.
 */
const LAYER_NAMES = { waves: 'Waves', swell_1: 'Swell', swell_2: 'Swell 2', wind_waves: 'Wind Waves', wind: 'Wind' };
const MARINE_LAYERS = new Set(['waves', 'swell_1', 'swell_2', 'wind_waves']);
const MODEL_NAMES = { GFS: 'GFS', ICON: 'ICON', EURO: 'EURO' };
// The widest step any stored marine lattice has (EURO WAM past 144 h is 6-hourly): a drawn frame within half of it is
// the nearest stored forecast, anything further is still loading.
const NEAREST_MAX_HOURS = 3;
/** Half the stored lattice step at this hour: 3-hourly frames are never more than 1 h from a selection; EURO past 144 h is
 *  6-hourly (3 h). One rule for the marine line, the wind line and the point card's badge (review 2026-10-19).
 *  BY MODEL STEP (2026-10-27, the lead's live read on dev dcc514bf3): EURO goes 6-hourly past model STEP 144 (valid time minus the
 *  run's cycle), and the timeline counts from now: with an 18 h-old run the 6-hourly range starts at timeline hour 126, so hours
 *  126-144 read "Loading <selected>… still showing <the nearest stored frame>" for good (the server serves the authoritative frame
 *  within 3 h before an estimate, grid_resolver_selection.find_candidates + mid_res_tier.pick_mid_item). The step comes from the
 *  selection's instant and the DRAWN frame's verified cycle (marineDrawnFrame runMs); an unknown cycle keeps the timeline hour.
 *  Kill: window.__RAW_DISABLE_LATTICE_MODEL_STEP__ = true (the timeline hour decides again). */
export const EURO_SIX_HOURLY_AFTER_STEP = 144;
export function latticeNearestMaxHours(model, hour, { selectedMs, runMs } = {}) {
  if (model !== 'EURO') return 1;
  const byStep = !(typeof window !== 'undefined' && window.__RAW_DISABLE_LATTICE_MODEL_STEP__ === true)
    && Number.isFinite(selectedMs) && Number.isFinite(runMs) && selectedMs >= runMs;
  return (byStep ? (selectedMs - runMs) / 3600000 : hour) > EURO_SIX_HOURLY_AFTER_STEP ? 3 : 1;
}

export const ESTIMATE_WORDS = {
  icon_swell_2_gfs_euro_blend: 'blended from GFS and EURO',
  icon_persistence_gfs_blend: 'beyond ICON’s native range',
  icon_trend_extrapolation: 'beyond ICON’s native range',
  gfs_estimated_fallback: 'GFS stand-in beyond this model’s range',
  icon_extended_blend: 'blended from GFS and EURO beyond ICON’s range',
  far_edge_hold: 'held from the last stored forecast',
  // lattice_fill.py's 3-hourly EURO frames between the 6-hourly ones past model step 144 (was the generic 'estimated').
  native_time_interpolation: 'interpolated between stored forecasts',
};

/**
 * HELD: ONE rule for every held frame (2026-10-25/26, the owner's day-14 test: "the ICON data is showing Saturday 13th day on the
 * Sunday 14th day", with no words; #578 worded the far_edge_hold basis, #587 every source, unified here at the lead's request).
 * When the frame answering THIS selection (drawn.hour === requested.hour) is an ESTIMATE whose data is further from the selection
 * than the nearest-frame rule allows, nothing newer is coming: past a model's stored tail the server holds its last frame (its own
 * basis, or far_edge_hold when it had none), and the client blends held inputs (icon_extended_blend). "Loading" would promise a frame
 * that never arrives, so the line says what the field IS: "Holding <data time>’s <model> forecast: <why>", the time dated when it is
 * a day or more from the selection or the selection is six or more days out. An OLDER answer still on screen (another hour) stays
 * "Loading"; so does a non-estimate (a stale answer the server refreshes). The data time is the served time, else the hold's own
 * estimate_basis.held_from (marineDrawnFrame heldFromMs), else a client blend's readout time (heldFrameTime.js).
 * Kill: window.__RAW_DISABLE_DRAWN_HELD_WORDS__ = true, or #578's documented alias window.__RAW_DISABLE_DRAWN_HOLD_WORDS__ = true.
 */
const HOLD_WHY = {
  far_edge_hold: () => 'the 14-day estimate ends there',        // #578's words, as shipped
  icon_extended_blend: () => 'blended from GFS and EURO beyond ICON’s range',
  icon_persistence_gfs_blend: () => 'beyond ICON’s native range',
  icon_trend_extrapolation: () => 'beyond ICON’s native range',
  gfs_estimated_fallback: (m) => `GFS stand-in beyond ${m}’s range`,
};
const heldWordsOn = () => !(typeof window !== 'undefined'
  && (window.__RAW_DISABLE_DRAWN_HELD_WORDS__ === true || window.__RAW_DISABLE_DRAWN_HOLD_WORDS__ === true));

export function formatForecastHour(hour, nowMs = Date.now()) {
  if (!Number.isFinite(hour)) return '';
  const d = new Date(nowMs + hour * 3600000);
  d.setMinutes(0, 0, 0);
  return d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric' });
}

// DATED (2026-10-25): weekday + hour cannot tell two times a week apart, and the timeline spans 14 days ("Loading Sun 11 PM… still
// showing Sun 11 PM" was two weeks apart). With `dated` the day of the month is added. Kill: window.__RAW_DISABLE_DRAWN_DATED_LABEL__.
const DAY_MS = 24 * 3600000;
export function formatInstant(ms, dated = false) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString('en-US', dated ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' } : { weekday: 'short', hour: 'numeric' });
}
/** Date the words when the two times are a day or more apart, or the selection is six or more days out. */
const datedPair = (aMs, bMs, nowMs) => !(typeof window !== 'undefined' && window.__RAW_DISABLE_DRAWN_DATED_LABEL__ === true)
  && Number.isFinite(aMs) && Number.isFinite(bMs) && (Math.abs(aMs - bMs) >= DAY_MS || bMs - nowMs >= 6 * DAY_MS);

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
    // A SWITCH IN PROGRESS (2026-10-26, hold until replaced): the drawn frame is named by its own model, layer and time, and once
    // the hold's ceiling passes (marineTransitionCoordinator: __MARINE_SWITCH_STALLED__) the words say the new one is not arriving.
    const when = Number.isFinite(drawn.dataMs) && !(typeof window !== 'undefined' && window.__RAW_DISABLE_DRAWN_LABEL_INSTANT__ === true)
      ? `, ${formatInstant(drawn.dataMs, datedPair(drawn.dataMs, requested.labelMs, nowMs))}` : '';
    const stall = typeof window !== 'undefined' ? window.__MARINE_SWITCH_STALLED__ : null;
    const stalled = !!(stall && stall.targetKey === `${requested.model || 'GFS'}|${requested.layer || 'waves'}`);
    const want = `${model(requested.model)} ${layer(requested.layer)}`; const have = `${model(drawn.model)} ${layer(drawn.layer)}${when}`;
    return { state: 'pending', text: stalled ? `${want} is not arriving… still showing ${have}` : `Loading ${want}… still showing ${have}` };
  }
  const est = estimateWords(drawn);
  // Compare by INSTANT when both are known (the #267 rule, marineHourInstant.js: the label names the request, the valid time
  // names the data): drawn.dataMs = the frame's served valid time, against the SELECTION's own instant, requested.labelMs (the
  // series anchor + the hour: the clock the app asks on) when the caller passes it, else requested.instantMs (getSharedValidTime:
  // the ask already snapped to the nearest stored product). Else fall back to the hour labels.
  // LABEL INSTANT (2026-10-24, the verify matrix's step-to-h2 frame): against the SNAPPED ask, a nearest-stored stand-in reads as
  // exact whenever the ask was snapped to it (a 3-hourly stored frame under the hour between, or a series frame from the next
  // hour), so it was drawn with no words; the documented nearest rule labels it. The selection is also WORDED from that same
  // instant (it was floor(now) + hour while the app asks on round(now) + hour: one hour apart for half of every hour).
  // Kill: window.__RAW_DISABLE_DRAWN_LABEL_INSTANT__ = true (compare with the snapped ask, word the hour from now).
  const labelOn = Number.isFinite(requested.labelMs) && !(typeof window !== 'undefined' && window.__RAW_DISABLE_DRAWN_LABEL_INSTANT__ === true);
  const selectedMs = labelOn ? requested.labelMs : requested.instantMs;
  // The frame's DATA time: its served time, else a far-edge hold's own held_from (#578: the hold path with no served time).
  const dataMs = Number.isFinite(drawn.dataMs) ? drawn.dataMs : (Number.isFinite(drawn.heldFromMs) ? drawn.heldFromMs : null);
  const byInstant = Number.isFinite(selectedMs) && Number.isFinite(dataMs);
  const dh = byInstant ? Math.round((dataMs - selectedMs) / 3600000)
    : (Number.isFinite(drawn.hour) && Number.isFinite(requested.hour) ? drawn.hour - requested.hour : 0);
  const dated = byInstant && datedPair(dataMs, selectedMs, nowMs);
  const drawnLabel = byInstant ? formatInstant(dataMs, dated)
    : (labelOn && Number.isFinite(drawn.hour) && Number.isFinite(requested.hour)   // one clock in one sentence
      ? formatInstant(requested.labelMs + (drawn.hour - requested.hour) * 3600000) : formatForecastHour(drawn.hour, nowMs));
  if (dh !== 0) {
    if (Math.abs(dh) <= (Number.isFinite(requested.nearestMaxHours) ? requested.nearestMaxHours : NEAREST_MAX_HOURS)) {   // caller may pass its lattice's half-step
      return { state: 'nearest', text: `Showing ${drawnLabel}: the nearest stored forecast${est ? ` (${est})` : ''}` };
    }
    if (heldWordsOn() && drawn.estimated && byInstant && Number.isFinite(drawn.hour) && drawn.hour === requested.hour) {
      const m = model(drawn.model || requested.model);
      const why = HOLD_WHY[drawn.basisType] ? HOLD_WHY[drawn.basisType](m) : `beyond ${m}’s range`;
      return { state: 'held', text: `Holding ${drawnLabel}’s ${m} forecast: ${why}` };
    }
    const selectedLabel = labelOn ? formatInstant(requested.labelMs, dated) : formatForecastHour(requested.hour, nowMs);
    return { state: 'pending', text: `Loading ${selectedLabel}… still showing ${drawnLabel}` };
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

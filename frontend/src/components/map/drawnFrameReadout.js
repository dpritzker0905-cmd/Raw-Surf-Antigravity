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
import { latticeByLayerOn, servedPick, servedPickHalfStep } from './storedLattice';

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
// BY LAYER AND STORED LATTICE (2026-10-28, D8: the lead's offline fuzzer, 92 overbroad "nearest" claims): with `layer`, the
// half-step is the distance to the frame the server itself answers this selection with (storedLattice.servedPick: authoritative
// within 3 h first, else the nearest estimate). Without a manifest, only EURO WAVES keeps the 6-hourly 3 h (ECMWF's stream is
// 6-hourly from step 144 to 240); its swells and wind waves (CMEMS) and every 14-day tail are 3-hourly. Kill:
// window.__RAW_DISABLE_LATTICE_BY_LAYER__ = true (the model-only rule above).
export const EURO_SIX_HOURLY_UNTIL_STEP = 240;
// ECMWF's own streams go 6-hourly past step 144: the wave stream (EURO waves) and IFS (EURO wind). CMEMS swells are 3-hourly.
const EURO_SIX_HOURLY_LAYERS = new Set(['waves', 'wind']);
export function latticeNearestMaxHours(model, hour, { selectedMs, runMs, layer } = {}) {
  const byLayer = !!layer && latticeByLayerOn();
  if (byLayer) {
    const half = servedPickHalfStep(model, layer, selectedMs);
    if (half !== null) return half;
  }
  if (model !== 'EURO') return 1;
  if (byLayer && !EURO_SIX_HOURLY_LAYERS.has(layer)) return 1;
  const byStep = !(typeof window !== 'undefined' && window.__RAW_DISABLE_LATTICE_MODEL_STEP__ === true)
    && Number.isFinite(selectedMs) && Number.isFinite(runMs) && selectedMs >= runMs;
  const step = byStep ? (selectedMs - runMs) / 3600000 : hour;
  if (byLayer && byStep && step > EURO_SIX_HOURLY_UNTIL_STEP) return 1;
  return step > EURO_SIX_HOURLY_AFTER_STEP ? 3 : 1;
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
  // EVERY BASIS A MARINE FRAME CAN CARRY (2026-10-28, the lead's 10-26/10-27 rounds): an unnamed one read "Estimated forecast:
  // estimated", EURO's tail at h294-h336 among them (backend estimator.py, empty_frame_recovery.py, normalizer.py).
  euro_persistence_gfs_icon_blend: 'beyond EURO’s range, blended with GFS and ICON',
  euro_persistence_gfs_blend: 'beyond EURO’s range, blended with GFS',
  icon_extended_estimate: 'beyond ICON’s native range',
  icon_loop_extrapolation: 'beyond ICON’s native range',
  coarser_grid_fallback: 'from a coarser stored grid',
  gfs_derived_fallback: 'GFS stand-in',
  ecmwf_ifs_derived_fallback: 'ECMWF stand-in',
  open_meteo_fallback: 'Open-Meteo stand-in',
};
// A basis with no words of its own reads "Estimated forecast", never "Estimated forecast: estimated" (the doubled word).
// Kill: window.__RAW_DISABLE_DRAWN_ESTIMATE_WORDS__ = true (the words above and the rating-frame rule in marineDrawnFrame).
const GENERIC_ESTIMATE = 'estimated';
const estimateWordsOn = () => !(typeof window !== 'undefined' && window.__RAW_DISABLE_DRAWN_ESTIMATE_WORDS__ === true);
const NEW_ESTIMATE_KEYS = new Set(['euro_persistence_gfs_icon_blend', 'euro_persistence_gfs_blend', 'icon_extended_estimate',
  'icon_loop_extrapolation', 'coarser_grid_fallback', 'gfs_derived_fallback', 'ecmwf_ifs_derived_fallback', 'open_meteo_fallback']);

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
  if (!estimateWordsOn() && NEW_ESTIMATE_KEYS.has(drawn.basisType)) return GENERIC_ESTIMATE;
  return ESTIMATE_WORDS[drawn.basisType] || GENERIC_ESTIMATE;
}

/**
 * WHY A FRAME IS HELD, when it is not range (2026-10-28, the lead's 10-27 live round: a tab idle ~10 h, the wheel's +156 had moved
 * with the clock to 11-03T08Z while the drawn frame stayed at 11-03T03Z, and the line said "beyond EURO’s range"). Two reasons the
 * client can MEASURE: the series anchor rolled since the frame was drawn under this same hour label (drawn.anchorMs), and the frame's
 * verified cycle is older than the newest one the manifest names (requested.latestRunMs). Null when neither holds.
 * Kill: window.__RAW_DISABLE_DRAWN_HOLD_REASON__ = true (range words again).
 */
const HOUR_MS = 3600000;
function holdReason(requested, drawn, m) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_DRAWN_HOLD_REASON__ === true) return null;
  const anchorNow = Number.isFinite(requested.labelMs) && Number.isFinite(requested.hour) ? requested.labelMs - requested.hour * HOUR_MS : null;
  const rolledH = Number.isFinite(anchorNow) && Number.isFinite(drawn.anchorMs) ? Math.round((anchorNow - drawn.anchorMs) / HOUR_MS) : 0;
  const olderRun = Number.isFinite(drawn.runMs) && Number.isFinite(requested.latestRunMs) && requested.latestRunMs > drawn.runMs;
  if (rolledH >= 1) {
    return { rolled: true, why: `drawn ${rolledH} h ago${olderRun ? ' from an older run' : ''}, and the selected time has moved on` };
  }
  return olderRun ? { rolled: false, why: `from an older ${m} run` } : null;
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
    // D8: the frame the server answers this selection with (storedLattice.servedPick), when the manifest says.
    const pick = byInstant && latticeByLayerOn() && requested.layer ? servedPick(requested.model, requested.layer, selectedMs) : null;
    const pickIsDrawn = !!pick && Math.abs(pick.pickMs - dataMs) < 1800000;
    if (Math.abs(dh) <= (Number.isFinite(requested.nearestMaxHours) ? requested.nearestMaxHours : NEAREST_MAX_HOURS)) {   // caller may pass its lattice's half-step
      // The server answers with the nearest AUTHORITATIVE frame within 3 h before a closer estimate (EURO waves between its
      // 6-hourly steps); it is then not "the nearest stored forecast", so the words say what it is.
      const full = !!(pickIsDrawn && pick.nearerEstimate && !drawn.estimated);
      if (full) return { state: 'nearest', text: `Showing ${drawnLabel}: the nearest full forecast; an estimate lies closer` };
      return { state: 'nearest', text: `Showing ${drawnLabel}: the nearest stored forecast${est ? ` (${est})` : ''}` };
    }
    const sameHour = byInstant && Number.isFinite(drawn.hour) && drawn.hour === requested.hour;
    const m = model(drawn.model || requested.model);
    const reason = heldWordsOn() && sameHour ? holdReason(requested, drawn, m) : null;
    // The clock moved under a frame drawn for this hour label: name that, estimate or not ("Loading" promised nothing here).
    // `stale` keeps the point card's retained-hour badge (reconcileStaleBadge) for it.
    if (reason && reason.rolled) return { state: 'held', stale: true, text: `Holding ${drawnLabel}’s ${m} forecast: ${reason.why}` };
    // A drawn estimate is HELD only when nothing nearer answers this selection: when the stored lattice names another frame (the
    // server's pick, e.g. the GFS stand-in tail's next 3-hourly step), that frame is owed, so the line reads "Loading" (D8).
    if (heldWordsOn() && drawn.estimated && sameHour && !(pick && !pickIsDrawn)) {
      const why = HOLD_WHY[drawn.basisType] ? HOLD_WHY[drawn.basisType](m) : (reason ? reason.why : `beyond ${m}’s range`);
      return { state: 'held', text: `Holding ${drawnLabel}’s ${m} forecast: ${why}` };
    }
    const selectedLabel = labelOn ? formatInstant(requested.labelMs, dated) : formatForecastHour(requested.hour, nowMs);
    return { state: 'pending', text: `Loading ${selectedLabel}… still showing ${drawnLabel}` };
  }
  if (est) return { state: 'estimated', text: est === GENERIC_ESTIMATE && estimateWordsOn() ? 'Estimated forecast' : `Estimated forecast: ${est}` };
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
  if (r && (r.state === 'pending' || r.stale)) return 'retained_stale_warning';
  return status === 'retained_stale_warning' ? null : status;
}

/**
 * COARSE GRID (2026-10-28, the lead's 10-27 live round): EURO swell_1 at z9 is drawn from a 10.313-degree grid (CMEMS at
 * global_coarse; the TruthOverlay HUD says "COARSE 10.313° GRID") and no user-facing words said so. A drawn grid of the selected
 * model and layer whose nodes are COARSE_WORDS_MIN_DEG or more apart gets one short line; the 2-degree world tier stays quiet.
 * Kill: window.__RAW_DISABLE_COARSE_GRID_WORDS__ = true.
 */
export const COARSE_WORDS_MIN_DEG = 5;
export function describeCoarseGrid(requested, drawn) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_COARSE_GRID_WORDS__ === true) return null;
  if (!requested || !drawn || !MARINE_LAYERS.has(requested.layer)) return null;
  if ((drawn.model && requested.model && drawn.model !== requested.model)
      || (drawn.layer && requested.layer && drawn.layer !== requested.layer)) return null;   // a switch: the switch words speak
  const deg = drawn.resolutionDeg;
  if (!Number.isFinite(deg) || deg < COARSE_WORDS_MIN_DEG) return null;
  const name = `${MODEL_NAMES[requested.model] || requested.model || ''} ${LAYER_NAMES[requested.layer] || requested.layer}`.trim();
  return { state: 'coarse', deg, text: `Coarse grid: ${name} points are ${Math.round(deg * 10) / 10}° apart` };
}

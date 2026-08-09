/**
 * modelProvenance.js — WHICH MODEL IS ACTUALLY ON SCREEN (2026-08-09, report R11-11 item 4).
 *
 * THE DEFECT THIS EXISTS FOR. `useOpenMeteoTileUrls.resolveModel` silently substitutes GFS in ten
 * places: fog on EVERY model at EVERY hour (a registry pin, `LayerRegistry.js` fog.omModel =
 * 'ncep_gfs025'), wind on ICON past 120 h, marine past 168/240 h, atmospheric past 168/228 h. The
 * infobox header meanwhile prints the model the user SELECTED, so at EURO + fog the box reads
 * "ECMWF Forecast" over pixels that are GFS. That is not a missing disclosure — it is a positive
 * claim of provenance that is false.
 *
 * ⭐ THE HOUSE PRECEDENT IS TO REFUSE RATHER THAN MISLABEL. When a model genuinely lacks a marine
 * variable, `useOpenMeteoTileUrls` renders a TRANSPARENT tile and the card shows "N/A", with the
 * comment "instead of silently serving GFS Wave data labeled as ECMWF". A variable the model lacks
 * refuses; a model past its horizon lies. This module closes that asymmetry the other way — the
 * substitution is real and useful, so DISCLOSE it rather than blank the layer.
 *
 * ⚠️ Reads the rendered slot URL, never a horizon constant. The 120/168/228/240 thresholds exist in
 * four independently drifted copies (resolveModel, useTemporalPreloader's 216, forecastDiagnostics'
 * 240/168, LayerRegistry's declared horizons) and cannot be trusted to agree. The slot URL is what
 * the GPU is painting, so it is the only source that cannot be stale.
 */
import { resolveDisplayedSlot } from './decodedOmSampler';

/** Open-Meteo model id -> the family label the UI shows. Prefix-matched: the ids are versioned
 *  (`ncep_gfs013` / `ncep_gfs025` / `ncep_gfswave025` are all "GFS" to a user). */
const FAMILY_PREFIXES = [
  ['ncep_', 'GFS'],
  ['dwd_', 'ICON'],        // dwd_icon + dwd_gwam (the ICON wave model)
  ['ecmwf_', 'ECMWF'],     // ecmwf_ifs025 + ecmwf_wam025
];

/** The label the model SELECTOR uses, for the same three families. */
export const ACTIVE_MODEL_LABEL = { GFS: 'GFS', EURO: 'ECMWF', ICON: 'ICON' };

/** 'ncep_gfs025' -> 'GFS'. Unknown ids return null rather than guessing: a wrong family label
 *  would manufacture a false "substituted" banner, which is the same class of lie in reverse. */
export function familyOfOmModel(omModelId) {
  if (!omModelId || typeof omModelId !== 'string') return null;
  const id = omModelId.toLowerCase();
  for (const [prefix, family] of FAMILY_PREFIXES) {
    if (id.startsWith(prefix)) return family;
  }
  return null;
}

/**
 * Is the layer on screen being painted by a model the user did not select?
 *
 * Returns null when there is nothing to say — same family, unknown model, or no slot resolved yet
 * (mid-mount). ABSENT rather than a "no substitution" object, so a caller cannot render an empty
 * banner while the map is still settling.
 */
export function describeSubstitution(activeModel, renderedOmModel) {
  const rendered = familyOfOmModel(renderedOmModel);
  const selected = ACTIVE_MODEL_LABEL[activeModel] || activeModel;
  if (!rendered || !selected || rendered === selected) return null;
  return {
    rendered,
    selected,
    // Plain words, not a colour or an icon: the accessibility mandate forbids conveying
    // information by colour alone, and this IS the information.
    text: `Showing ${rendered} — ${selected} has no data for this layer or hour`,
    short: `${rendered} shown`,
  };
}

/** The substitution for a layer as currently RENDERED, or null. `deps` is injectable for tests;
 *  in the app the map comes from the same globals decodedOmSampler already uses. */
export function describeLayerSubstitution(activeModel, layerKey, deps = {}) {
  const map = deps.map !== undefined
    ? deps.map
    : (typeof window !== 'undefined' ? (window.map || window.__MAP_INSTANCE__) : null);
  if (!map || !layerKey) return null;
  const slot = resolveDisplayedSlot(map, layerKey);
  if (!slot) return null;
  return describeSubstitution(activeModel, slot.model);
}

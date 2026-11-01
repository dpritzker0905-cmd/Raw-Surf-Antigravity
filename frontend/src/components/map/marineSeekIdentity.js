/**
 * marineSeekIdentity.js — ONE identity for "the forecast the user selected" (scrub audit 2026-10-18, handoff W-2).
 *
 * A selection is {model, layer, hour}. The audit (docs/audits/2026-10-18-weather-scrub-audit, lane-temporal §1) found that
 * every async exit of the marine lane checked a DIFFERENT subset of it:
 *   - the fetch lane's success path checks requestId + model + layer + hour (useMarineDataFetcherCore, the stale_async gate);
 *   - its non-abort ERROR path checked the hour only (T-03), so a detached request from the previous model that threw after
 *     the switch reached `setMarineData(prev => ... null)` and blanked the NEW model's frame;
 *   - the render-parity record compared the hour only (T-06), so ~4 s of the old model's pixels under the new model's button
 *     read `parity: true` (measured F-03), and MapForecastOverlay then sampled the old model's field for a selected point.
 * This module holds the two missing checks as pure functions so both call sites, and their tests, use the same rule.
 *
 * Kill switches (independent):
 *   window.__RAW_DISABLE_MARINE_ERROR_IDENTITY__ = true  -> the error path goes back to the hour-only test
 *   window.__RAW_DISABLE_PARITY_IDENTITY__ = true        -> parity goes back to the hour-only test
 */
import { DISPLAY_EURO_WAVES_MAX_HOURS, DISPLAY_EURO_COMPONENT_MAX_HOURS, DISPLAY_ICON_MAX_HOURS } from './useMarineDataFetcherHelpers';

const _win = (win) => win || (typeof window !== 'undefined' ? window : {});

/**
 * The model a marine fetch for this selection actually asks for: past a model's display horizon (or ICON past 168 h with the
 * backend ICON flag off) the fetcher draws GFS on purpose. A GFS frame under the EURO button there is the intended product,
 * not a mismatch, so identity checks compare against THIS, not against the button. Mirrors useMarineDataFetcherCore exactly.
 */
export function resolveMarineFetchModel(rawModel, layer, hour, iconBackendFlag) {
  const nativeLimit = (layer || 'waves') === 'waves' ? DISPLAY_EURO_WAVES_MAX_HOURS : DISPLAY_EURO_COMPONENT_MAX_HOURS;
  if (rawModel === 'ICON' && hour > 168 && !iconBackendFlag) return 'GFS';
  if (rawModel === 'ICON' && hour > DISPLAY_ICON_MAX_HOURS) return 'GFS';
  if (rawModel === 'EURO' && hour > nativeLimit) return 'GFS';
  return rawModel;
}

/**
 * T-03. May a NON-ABORT error from this request change what is drawn (mark the resident stale, or clear it)?
 * Only when the request still IS the user's selection: the newest dispatched request (or one that never dispatched, id 0,
 * i.e. this very invocation failed before taking an id) AND its model, layer and hour are still the selected ones.
 *   ctx: { requestId, currentRequestId, intent: {model, layer, hour}, current: {model, layer, hour}, scrubbing }
 */
export function marineErrorOwnsDisplay(ctx, win) {
  const { requestId, currentRequestId, intent, current, scrubbing } = ctx || {};
  if (scrubbing) return false;
  const i = intent || {};
  const c = current || {};
  if (_win(win).__RAW_DISABLE_MARINE_ERROR_IDENTITY__ === true) return i.hour === c.hour;   // the pre-2026-10-18 test
  if (requestId !== 0 && requestId !== currentRequestId) return false;                     // superseded / detached
  return i.model === c.model && (i.layer || 'waves') === (c.layer || 'waves') && i.hour === c.hour;
}

/**
 * T-06. Is the frame the engine was last given (`lastSig`, WebGLMarineLayer's lastUploadedGridRef record) of the selected
 * model and layer? Unknown fields never fail the check (a record without a model says nothing either way).
 */
export function parityIdentityMatches(lastSig, selectedModel, selectedLayer, hour, iconBackendFlag, win) {
  if (_win(win).__RAW_DISABLE_PARITY_IDENTITY__ === true) return true;
  if (!lastSig) return true;
  const layer = selectedLayer || 'waves';
  const drawnModel = lastSig.activeModel;
  if (drawnModel && selectedModel) {
    const want = resolveMarineFetchModel(selectedModel, layer, hour, iconBackendFlag);
    if (drawnModel !== want && drawnModel !== selectedModel) return false;
  }
  const drawnLayer = (lastSig.componentLayer && lastSig.componentLayer !== 'none') ? lastSig.componentLayer : lastSig.activeMarineLayer;
  if (drawnLayer && drawnLayer !== layer) return false;
  return true;
}

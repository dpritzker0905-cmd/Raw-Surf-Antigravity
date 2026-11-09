// Scrubber step that lands on a real model frame. GFS/EURO marine layers are 3-hourly: a 1 h
// step asks for an hour with no frame, so the readout snaps (11 AM -> 10 AM, 12 -> 1 PM ...).
// Cadence comes from the /capabilities rows the client already holds (window.__WEATHER_CAPABILITIES__,
// loaded by LayerAccessResolver). Hourly / unknown => step 1 (unchanged). Kill switch:
// window.__RAW_DISABLE_CADENCE_STEP__ = true.
import { alignToCadenceGrid } from './seriesAnchor';

const LAYER_ALIAS = { rain: 'precipitation' };

export function activeCadenceHours(model, layer) {
  try {
    if (typeof window === 'undefined' || window.__RAW_DISABLE_CADENCE_STEP__ === true) return 1;
    const caps = window.__WEATHER_CAPABILITIES__;
    if (!Array.isArray(caps) || !model || !layer) return 1;
    const m = String(model).toUpperCase();
    const l = String(LAYER_ALIAS[layer] || layer).toLowerCase();
    const row = caps.find((c) => String(c.model).toUpperCase() === m && String(c.layer).toLowerCase() === l);
    const c = Number(row && row.cadence_hours);
    return Number.isFinite(c) && c > 1 ? Math.round(c) : 1;
  } catch (e) {
    return 1;
  }
}

/** Next/previous scrubber hour for `dir` (+1/-1): +-1 for hourly, else the adjacent real grid hour, clamped to [0,max]. */
export function stepHour(current, dir, cadence, max) {
  const cur = Number(current) || 0;
  if (!(cadence > 1)) return Math.max(0, Math.min(max, cur + dir));
  let t = alignToCadenceGrid(cur + dir * cadence, cadence);
  if (dir > 0 && t <= cur) t += cadence;
  if (dir < 0 && t >= cur) t -= cadence;
  return Math.max(0, Math.min(max, t));
}

export function stepLabel(dir, cadence) {
  const n = cadence > 1 ? cadence : 1;
  return `${dir < 0 ? '−' : '+'}${n}h`;
}

export function stepAria(dir, cadence) {
  const n = cadence > 1 ? cadence : 1;
  return `Step ${dir < 0 ? 'back' : 'forward'} ${n} hour${n > 1 ? 's' : ''}`;
}

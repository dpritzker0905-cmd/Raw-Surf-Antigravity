/**
 * RUN AGE, ALWAYS ON (reliability lane, 2026-11-24; inspection 2026-11-23 finding 4: "a stuck model run is served with no label").
 * The status line's "from an older run" compares the drawn run with the manifest's NEWEST run, which is the same run when the model
 * itself is stuck, so a day-old forecast read as current. This names the model run being served, its source and its age, at every
 * hour, and past the model's cutoff says so in words ("older than 18 h"): never colour alone.
 *
 * ONE SOURCE: the server's verdict first, the `run_age` field /api/weather/capabilities carries on every row
 * (backend/services/weather_pipeline/run_age.py: the newest VERIFIED cycle, its age, the cutoff, stale or not). If the server does
 * not send it (older backend, RUN_AGE_SERVE=0), the client reads the newest verified cycle in its cached manifest
 * (latestGlobalRunMs below: GLOBAL products only, as the server) against the SAME cutoffs. That fallback is labelled as the client's own reading.
 * Used by RunAgeLabel.js (the line under the timeline), StaleLayerChip.js (a stale run on the collapsed phone header) and the
 * collapsed header's time button. Kill: window.__RAW_DISABLE_RUN_AGE_LABEL__ = true (all three).
 */
import { getCachedManifest } from './backendWeatherServiceClientCoverage';
import { formatRunLocal } from './readoutDateFormat';

/** The client fallback: the newest VERIFIED cycle among the cached manifest's GLOBAL products for {model, layer}, the same
 * rule as the server (run_age.py), so a regional pilot tile never stands in for the world run. One scan per manifest+key. */
const _globalRun = new WeakMap();
export function latestGlobalRunMs(model, layer) {
  const manifest = getCachedManifest();
  if (!manifest || !Array.isArray(manifest.products) || !model || !layer) return null;
  let byKey = _globalRun.get(manifest);
  if (!byKey) { byKey = new Map(); _globalRun.set(manifest, byKey); }
  const m = String(model).toUpperCase();
  const key = `${m}|${layer}`;
  if (byKey.has(key)) return byKey.get(key);
  let best = null;
  for (const p of manifest.products) {
    if (!p || String(p.model || '').toUpperCase() !== m || p.layer !== layer || p.model_run_time_status !== 'known') continue;
    if (!String(p.region_id || '').startsWith('global') && p.coverage_mode !== 'global_tile') continue;
    const ms = Date.parse(p.model_run_time || '');
    if (Number.isFinite(ms) && (best == null || ms > best)) best = ms;
  }
  byKey.set(key, best);
  return best;
}

export const CUTOFF_H = { GFS: 18, EURO: 30, ICON: 30, ECMWF_ENS: 30, CMEMS: 48 };   // = run_age.CUTOFF_H (pinned by test)
const DEFAULT_CUTOFF_H = 30;
const HOUR_MS = 3600000;
const LAYER_ALIAS = { rain: 'precipitation' };

export const runAgeKilled = () => typeof window !== 'undefined' && window.__RAW_DISABLE_RUN_AGE_LABEL__ === true;

function capabilityRow(model, layer) {
  const caps = typeof window !== 'undefined' ? window.__WEATHER_CAPABILITIES__ : null;
  if (!Array.isArray(caps)) return null;
  const m = String(model || '').toUpperCase();
  const l = String(LAYER_ALIAS[layer] || layer || '').toLowerCase();
  return caps.find((c) => String(c.model).toUpperCase() === m && String(c.layer).toLowerCase() === l) || null;
}

const utcHour = (ms) => `${String(new Date(ms).getUTCHours()).padStart(2, '0')}Z`;

/**
 * readRunAge({ model, layer, nowMs }) -> null | { model, cycleMs, ageH, cutoffH, stale, source, by: 'server'|'client', text, short }
 *   text:  the full sentence for the line and the accessible name.
 *   short: a few words for the collapsed phone header ("GFS run 15 h old").
 */
export function readRunAge({ model, layer, nowMs = Date.now() } = {}) {
  if (runAgeKilled() || !model || !layer) return null;
  const m = String(model).toUpperCase();
  const row = capabilityRow(m, layer);
  const served = row && row.run_age;
  let cycleMs; let cutoffH; let source = null; let by;
  if (served && served.cycle) {
    cycleMs = Date.parse(served.cycle);
    cutoffH = Number(served.cutoff_h);
    source = served.source || null;
    by = 'server';
  } else {
    cycleMs = latestGlobalRunMs(m, layer);
    cutoffH = CUTOFF_H[m] || DEFAULT_CUTOFF_H;
    by = 'client';
  }
  if (!Number.isFinite(cycleMs)) return null;
  if (!Number.isFinite(cutoffH)) cutoffH = CUTOFF_H[m] || DEFAULT_CUTOFF_H;
  const ageH = Math.max(0, Math.round((nowMs - cycleMs) / HOUR_MS));
  // The server's verdict is frozen when /capabilities loads, while the age is recomputed now: an open page must still turn
  // stale as the hours pass (advisor, #1268). So stale = the server said so OR the age now is past the cutoff.
  const stale = (served && served.stale === true) || ageH > cutoffH;
  const when = formatRunLocal(cycleMs);
  const text = `${m} model run ${when ? `${when} (${utcHour(cycleMs)})` : utcHour(cycleMs)}, ${ageH} h old`
    + (stale ? `, older than ${cutoffH} h: newer runs have not arrived` : '')
    + (source ? `. Source: ${source}` : '')
    + (by === 'client' ? ' (read from the app’s copy of the forecast list)' : '');
  const short = `${m} run ${ageH} h old${stale ? ' (stale)' : ''}`;
  return { model: m, cycleMs, ageH, cutoffH, stale, source, by, text, short };
}

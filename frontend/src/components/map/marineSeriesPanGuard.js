/**
 * marineSeriesPanGuard.js — small pans stop asking the 1-CPU box for new series pages (2026-10-23).
 *
 * WHY. Live 19:44Z (Render logs, the lead's read): one session with Surf Rating ON, ICON and EURO, panning around Florida at
 * z7-9, kept the box at 100% CPU for 10+ min (/api/health 11-25 s). Every small pan sent a NEW 16-hour surf page for an
 * UNSNAPPED bbox (~20 boxes in 5 min), each with an hours=1 mini first; a surf page is 10-25 s of CPU (the rating chain per node).
 * The client side of it, read in marineGridSeries / useMarineSeriesWarm / marineSeriesWorkPolicy:
 *   - the request box was the raw viewport + 0.5 deg pad, so every pan asked a different box (the cache key snaps to 0.5 deg, the
 *     URL did not);
 *   - a cached or in-flight page whose box CONTAINS the new view was ignored unless its key matched exactly;
 *   - every moveend asked at once, and nothing superseded: the viewport intent only aborted with the build flag
 *     REACT_APP_MARINE_SERIES_WORK_BOUNDS, which production leaves unset, so a pan session queued every view's pages.
 * Offline (scn_sibling_toggle.js SURF=1 MODEL=ICON CASES=pans@20, a modelled box): 25 /grid_series in 120 s, 7 surf pages over 6
 * unsnapped boxes + 18 minis (one per pan), 123 s of CPU asked.
 *
 * WHAT (each with its own kill switch, window.__RAW_DISABLE_<NAME>__ = true):
 *   SERIES_REQUEST_SNAP   snapRequestBox: the /grid_series REQUEST box snapped OUTWARD to SERIES_REQUEST_SNAP_DEG (1 deg, the
 *                         backend's own GFS bbox snap), so pans inside it ask the same box. Static seams keep the unsnapped box (a
 *                         regional bundle answers only boxes it fully covers).
 *   SERIES_CONTAIN_REUSE  seriesBoxContained: a fresh cached page (or one in flight) of the same model, layer, flavour, page and
 *                         anchor whose box contains the view answers it: no request (getMarineSeriesFrame's containment fallback
 *                         serves its frames). The hour-0 mini also counts a containing mini.
 *   SERIES_PAN_SUPERSEDE  (marineSeriesWorkPolicy) a pan to another snapped box supersedes the old box's work by default; the
 *                         intent's identity is the snapped box (seriesIdentityBounds), so a pan inside it keeps its work.
 *   SERIES_PAN_DEBOUNCE   (useMarineSeriesWarm) the visible series waits until the map has been still SERIES_PAN_SETTLE_MS.
 *   SERIES_LOW_PRIORITY   seriesFetchInit: background pages and minis fetch at priority 'low' (Baseline since 2024; ignored elsewhere).
 * The scrub-settle reload loop found by the same replay (one box re-asked 117 times) is fixed apart, in marineSettleReloadGuard.js: a
 * reload budget, not "never" (a covering coarse frame can be an interim product, and the reload is how the fine one arrives).
 * Telemetry: window.__RAW_SERIES_PAN__ = { contained, containedInFlight, snapped, low }.
 */
import { bboxContains, normalizeRequestBbox, padRegionalBbox } from './marineBboxGeometry';
import { seriesAnchorTag } from './seriesAnchor';

export const SERIES_REQUEST_SNAP_DEG = 1;
export const SERIES_PAN_SETTLE_MS = 400;

const off = (name) => typeof window !== 'undefined' && window[`__RAW_DISABLE_${name}__`] === true;
const span = (b) => ({ lng: b.east - b.west, lat: b.north - b.south });
const wide = (b) => { const s = span(b); return !(s.lng > 0) || s.lng > 15 || s.lat > 15; };

function note(field) {
  if (typeof window === 'undefined') return;
  const t = (window.__RAW_SERIES_PAN__ = window.__RAW_SERIES_PAN__ || { contained: 0, containedInFlight: 0, snapped: 0, low: 0 });
  t[field] = (t[field] || 0) + 1;
}

/** The request box snapped outward to the 1-deg lattice; a wide, global or antimeridian-crossing box is left alone. */
export function snapRequestBox(box) {
  if (off('SERIES_REQUEST_SNAP') || !box || wide(box)) return box;
  const g = SERIES_REQUEST_SNAP_DEG;
  const out = {
    west: Math.floor(box.west / g) * g, east: Math.ceil(box.east / g) * g,
    south: Math.max(-89.5, Math.floor(box.south / g) * g), north: Math.min(89.5, Math.ceil(box.north / g) * g),
  };
  if (out.west < -180 || out.east > 180 || wide(out)) return box;   // never cross the dateline or the 15-deg 'global' line
  if (out.west !== box.west || out.east !== box.east || out.south !== box.south || out.north !== box.north) note('snapped');
  return out;
}

/** The bounds a viewport intent is keyed by: the snapped request box, so a pan inside it keeps the same identity. */
export function seriesIdentityBounds(bounds) {
  if (off('SERIES_PAN_SUPERSEDE') || off('SERIES_REQUEST_SNAP') || !bounds) return bounds;
  const req = normalizeRequestBbox(padRegionalBbox(bounds));
  return wide(req) ? bounds : snapRequestBox(req);
}

/**
 * A cached page (fresh, with frames, not a coarse preview, a warming placeholder or a static page) or a page in flight of the
 * same model, layer, flavour, page and anchor whose box contains `bounds` (the raw viewport). `mini` also accepts hour-0 minis.
 * `cache` / `inFlight` are marineGridSeries' maps; their keys are `${model}_${layer}_${surf|swell}_${box}_p${page}${anchor}[_h0]`.
 */
export function seriesBoxContained(cache, inFlight, { model, layer, page, bounds, surf, ttlMs, mini = false }) {
  if (off('SERIES_CONTAIN_REUSE') || !bounds || wide(bounds)) return false;
  const prefix = `${model || 'GFS'}_${layer || 'waves'}_${surf ? 'surf' : 'swell'}_`;
  const suffix = `_p${page}${seriesAnchorTag()}`;
  const ours = (k) => k.startsWith(prefix) && (k.endsWith(suffix) || (mini && k.endsWith(`${suffix}_h0`)));
  const now = Date.now();
  for (const [k, e] of cache) {
    if (!ours(k) || !e || e.coarsePreview || e.warming || e.staticFrames || !e.bounds || !e.frames || !e.frames.size) continue;
    if (now - e.ts >= ttlMs || wide(e.bounds)) continue;
    if (bboxContains(e.bounds, bounds)) { note('contained'); return true; }
  }
  for (const [k, f] of inFlight) {
    if (!ours(k) || !f || !f.reqBox || wide(f.reqBox) || (f.seriesSignal && f.seriesSignal.aborted)) continue;   // a world page never stands in
    if (bboxContains(f.reqBox, bounds)) { note('containedInFlight'); return true; }
  }
  return false;
}

/** fetch() options for a series ask: background lanes ('background' page, 'mini' background mini) at priority 'low'. */
export function seriesFetchInit(signal, lane) {
  if ((lane === 'background' || lane === 'mini') && !off('SERIES_LOW_PRIORITY')) { note('low'); return { signal, priority: 'low' }; }
  return { signal };
}

/** How long the visible series waits after a moveend (0 = at once, the kill switch). */
export function seriesPanSettleMs() {
  return off('SERIES_PAN_DEBOUNCE') ? 0 : SERIES_PAN_SETTLE_MS;
}

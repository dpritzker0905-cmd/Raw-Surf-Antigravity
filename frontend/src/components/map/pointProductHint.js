/**
 * pointProductHint.js — a point ask may name the stored product on screen (grid_product_id + grid_bbox) so the infobox samples
 * the frame the map draws (A15-09). It must be THIS selection's product.
 *
 * D4 (the lead's offline erratic fuzzer, 2026-10-27, 4 of 4 repro): GFS Waves at the Atlantic z3 with /grid slowed to 1.5 s,
 * click EURO, right-click the sea 150 ms later. During the switch `marineData.grid` is still the GFS frame, so the app asked
 * `/point?model=EURO&grid_product_id=gfs_marine_waves_global_mid_…`; the backend sampled that GFS product (`model: GFS`,
 * 1.1309 m) and the card said "EURO Forecast … 3.7 ft" (EURO's own value: 1.1987 m, 3.9 ft). Seen unprompted three more
 * times, once with a GFS SoCal swell_2 product id.
 *
 * Two guards, one kill switch (window.__RAW_DISABLE_POINT_MODEL_GUARD__ = true restores both):
 *   1. a hint whose product (read from its id, `[viewport_]{model}_{domain}_{layer}_…`) or whose grid names another model or
 *      layer is never sent: the backend then resolves the point from the selected model's own products;
 *   2. a reply whose `model` differs from the one asked for is refused (thrown), never mapped under the selected name.
 */
const ID_RE = /^(?:viewport_)?(gfs|icon|euro|ecmwf|hrrr)_(marine|wind|weather)_(wind_waves|swell_1|swell_2|waves|wind|pressure|precipitation)(?=_|\.|$)/i;
const MODEL_OF_ID = { gfs: 'GFS', icon: 'ICON', euro: 'EURO', ecmwf: 'EURO', hrrr: 'GFS' };   // HRRR is GFS's wind lane (D-017)

export const pointModelGuardOn = () => !(typeof window !== 'undefined' && window.__RAW_DISABLE_POINT_MODEL_GUARD__ === true);
const up = (m) => (m == null ? null : String(m).toUpperCase());

/** { model, domain, layer } named by a stored product id, or null when the id is not in the store's form. */
export function productIdentity(productId) {
  const m = ID_RE.exec(String(productId || ''));
  return m ? { model: MODEL_OF_ID[m[1].toLowerCase()], domain: m[2].toLowerCase(), layer: m[3].toLowerCase() } : null;
}

/** The model and layer a client grid says it is (null fields when it does not say). */
export function gridIdentity(grid) {
  if (!grid) return { model: null, layer: null };
  return {
    model: up(grid.__sourceModel || grid.activeModel || grid.model || null),
    layer: grid.__componentLayer || grid.activeMarineLayer || grid.layer || null,
  };
}

/** True when a hint (its id, and the grid it came from when given) names another model or layer than the ask. */
export function hintIsForeign(productId, model, layer, grid = null) {
  if (!pointModelGuardOn()) return false;
  const id = productId ? productIdentity(productId) : null;
  if (id && (id.model !== up(model) || id.layer !== layer)) return true;
  const g = gridIdentity(grid);
  return !!((g.model && g.model !== up(model)) || (g.layer && g.layer !== layer));
}

/** The product id to send with a {model, layer} point ask: `productId`, or null when it is another product's. */
export function productHintFor(productId, model, layer, grid = null) {
  if (!productId) return null;
  return hintIsForeign(productId, model, layer, grid) ? null : productId;
}

/** The {productId, bbox} a grid lends a {model, layer} point ask: both, or neither when the grid is another model's or layer's. */
export function gridHintsFor(grid, model, layer) {
  if (!grid) return { productId: null, bbox: null };
  const productId = grid.productId || grid.product_id || grid.__servedProductId || null;
  if (hintIsForeign(productId, model, layer, grid)) {
    notePointModelGuard('hint_dropped', { model, layer, productId, gridModel: gridIdentity(grid).model });
    return { productId: null, bbox: null };
  }
  const b = grid.bounds;
  return { productId, bbox: b ? `${b.west},${b.south},${b.east},${b.north}` : null };
}

/** A reply naming another model than the ask: refuse it. Throws (the callers' fallback paths then run, never a cache write). */
export function refuseForeignReply(json, model, layer) {
  if (!pointModelGuardOn() || !json || json.model == null || up(json.model) === up(model)) return;
  notePointModelGuard('reply_refused', { model, layer, replyModel: up(json.model), productId: json.product_id || null });
  const err = new Error(`point_model_mismatch: asked ${up(model)} ${layer}, answered ${up(json.model)}`);
  err.name = 'PointModelMismatch';
  throw err;
}

/** Instruments (the fuzzer, TruthOverlay) count what the guard did: window.__RAW_POINT_MODEL_GUARD__. */
export function notePointModelGuard(kind, detail) {
  if (typeof window === 'undefined') return;
  const g = window.__RAW_POINT_MODEL_GUARD__ || (window.__RAW_POINT_MODEL_GUARD__ = { hint_dropped: 0, reply_refused: 0, last: null });
  g[kind] = (g[kind] || 0) + 1;
  g.last = { kind, at: Date.now(), ...detail };
}

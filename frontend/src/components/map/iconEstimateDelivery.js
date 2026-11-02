// Client-only delivery repair; the existing estimator owns the forecast values.
/**
 * INFOBOX P1-B (owner 2026-11-01 16:03 EST: "build infobox P1-B, hidden"; ships DARK, D-001). Past ICON hour 168 the point card
 * blended its own anchor fetches in the browser (ICON at timeline hour 168 + GFS at 168 and at the hour, fetchBackendExactPoint),
 * while the heat map draws the backend's STORED estimate (the D-055 tail, REACT_APP_ICON_STORED_TAIL): two forecast paths for one
 * number, which the ONE FORECAST COMPOSITION mandate forbids. Measured 2026-10-28 offline at 21.5N 118W: the card +23% over the
 * heat map at h250, +11% at h300. When on, the card asks /point for ICON at the hour like any other model, and the backend answers
 * from the same stored product the map draws (manifest_point_selection.choose_for_point), surf chain included. Secondary swell keeps
 * its disclosed GFS/EURO blend, as the map does (D-003). Build default-off, and only with the stored-tail map flag also on (the
 * card must read what the map draws); the runtime switch can only disable it (no console or localStorage opt-in, D-001).
 *   build:  REACT_APP_ICON_POINT_STORED_TAIL=true (with REACT_APP_ICON_STORED_TAIL=true)
 *   kill:   window.__RAW_DISABLE_ICON_POINT_STORED_TAIL__ = true
 */
export function iconPointStoredTailEnabled(layer) {
  return layer !== 'swell_2'
    && process.env.REACT_APP_ICON_POINT_STORED_TAIL === 'true'
    && process.env.REACT_APP_ICON_STORED_TAIL === 'true'
    && !(typeof window !== 'undefined' && window.__RAW_DISABLE_ICON_POINT_STORED_TAIL__ === true);
}

export function iconFarHourRenderEnabled() {
  return typeof window === 'undefined' || window.__RAW_DISABLE_ICON_FAR_HOUR_RENDER__ !== true;
}

export function hasUsableMarineVectors(vectors) {
  return Array.isArray(vectors) && vectors.some(v => v && v.isOcean !== false && v.is_valid !== false
    && Number.isFinite(v.speed) && v.speed >= 0 && Number.isFinite(v.u) && Number.isFinite(v.v));
}

export function requireStoredIconEstimate(data, layer, validTime) {
  const basis = data?.estimate_basis;
  const target = Date.parse(validTime);
  if (data?.model !== 'ICON' || data.layer !== layer || data.is_estimated !== true
      || data.is_forecast_authoritative !== false || basis?.type !== 'icon_persistence_gfs_blend'
      || !basis.persistence_anchor_product_id || !Number.isFinite(Date.parse(basis.persistence_anchor_valid_time))
      || !Number.isFinite(target) || Date.parse(basis.target_valid_time) !== target
      || Date.parse(data.served_valid_time || data.valid_time) !== target
      || !hasUsableMarineVectors(data.grid?.vectors)) {
    throw new Error('ICON anchored estimate unavailable: refusing model substitution');
  }
}

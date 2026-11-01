// Client-only delivery repair; the existing estimator owns the forecast values.
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

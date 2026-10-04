import { getSharedValidTime, getSeriesAnchorMs } from './backendWeatherServiceClient';

// D-001: changing a served point's product/time is scientific behavior. Build default-off;
// the runtime switch can only disable it. No localStorage or console opt-in.
export function pointRequestIdentityEnabled() {
  return process.env.REACT_APP_POINT_REQUEST_IDENTITY === 'true'
    && !(typeof window !== 'undefined' && window.__RAW_DISABLE_POINT_REQUEST_IDENTITY__ === true);
}

export function createPointRequestContext(model, layer, hour, force = false, productId = null, bbox = null, anchorMs = getSeriesAnchorMs()) {
  model = model || 'GFS';
  layer = layer === 'rain' ? 'precipitation' : (layer || 'waves');
  const domain = layer === 'wind' ? 'wind' : (['pressure', 'precipitation'].includes(layer) ? 'weather' : 'marine');
  // Only hints that the adapter actually transmits belong in its cache identity.
  if (domain === 'weather') productId = bbox = null;
  if (typeof window !== 'undefined' && domain !== 'weather') {
    const diag = domain === 'wind' ? window.__WIND_PROJECTION_DIAG__ : window.__MARINE_PROJECTION_DIAG__;
    if (diag?.activeModel === model && diag?.activeLayer === layer) {
      productId = productId || diag.productId || diag.gridProductId || null;
      if (domain === 'marine') bbox = bbox || diag.requested_bbox || diag.backendRequestBbox || null;
    }
    if (domain === 'marine' && !bbox && window.map) {
      try {
        const b = window.map.getBounds();
        bbox = `${b.getWest().toFixed(4)},${b.getSouth().toFixed(4)},${b.getEast().toFixed(4)},${b.getNorth().toFixed(4)}`;
      } catch (e) { bbox = null; }
    }
  }
  if (domain === 'wind') bbox = null;
  // Preserve the existing marine guard against sampling a global coarse cell as a local point.
  if (domain === 'marine') {
    const p = bbox ? bbox.split(',').map(Number) : [];
    let width = p.length === 4 ? Math.abs(p[2] - p[0]) : 0;
    if (width > 180) width = 360 - width;
    if (/coarse/i.test(productId || '') || (p.length === 4 && p.every(Number.isFinite)
      && (width > 60 || Math.abs(p[3] - p[1]) > 60))) productId = bbox = null;
  }
  return Object.freeze({model, domain, layer, anchorMs, force,
    validTime: getSharedValidTime(hour, layer, model, {readOnly: true, anchorMs, domain}),
    gridProductId: productId, gridBbox: bbox,
    provider: layer === 'precipitation' ? 'open-meteo' : (model === 'EURO' ? 'copernicus' : 'open-meteo')});
}

export function childPointRequestContext(parent, model, layer, hour) {
  if (!parent) return null;
  return createPointRequestContext(model, layer, hour, parent.force,
    model === parent.model && layer === parent.layer ? parent.gridProductId : null,
    parent.gridBbox, parent.anchorMs);
}

export function pointRequestCacheKey(lat, lng, context) {
  return JSON.stringify(['point-v2', context.model, context.domain, context.layer,
    lat.toFixed(2), lng.toFixed(2), context.validTime, context.provider,
    context.gridProductId, context.gridBbox]);
}

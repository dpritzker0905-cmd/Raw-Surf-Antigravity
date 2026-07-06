/**
 * radarForecastSources.js — model-aware RADAR FORECAST frames (2026-07-06).
 *
 * RainViewer (the radar layer's base feed) discontinued its nowcast in Jan 2026 — the layer
 * showed only the past ~2h of observed radar. These helpers extend the radar timeline INTO THE
 * FUTURE with public radar-forecast WMS feeds, chosen by the active weather model:
 *
 *   EURO       → DWD GeoServer WMS `dwd:WN-Produkt` (radar composite WITH prediction — RADVOR
 *                lineage, +2h lead in 5-min steps; Germany/EU coverage).
 *                https://maps.dwd.de/geoserver/dwd/wms
 *   GFS / ICON → Iowa Environmental Mesonet HRRR simulated reflectivity WMS (`refp_{minutes}`
 *                layers, latest run auto-selected server-side; CONUS coverage). Capped at +4h
 *                per product decision (HRRR itself extends further).
 *                https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refp.cgi
 *
 * Coverage truth: outside each feed's footprint the WMS returns transparent tiles — the layer
 * simply shows nothing rather than lying. Levers: __RAW_RADAR_DWD_LAYER__ (layer-name override),
 * __RAW_RADAR_FUTURE_DISABLED__ (kill switch — past-only, the pre-2026-07-06 behavior).
 */

// Max forecast lead per model's feed, minutes.
export const RADAR_FORECAST_CAP_MIN = { EURO: 120, GFS: 240, ICON: 120 };

// Frame cadence, minutes. DWD products are 5-min data — 30-min frames keep the animation
// readable; IEM's refp WMS layers are hourly.
export const RADAR_FORECAST_STEP_MIN = { EURO: 30, GFS: 60, ICON: 30 };

// REGION-AWARE PER-MODEL FEEDS (2026-07-06 v2 — "EURO/ICON radar clears past the nowcast": the
// v1 model→feed map sent EURO/ICON to DWD everywhere, but DWD covers GERMANY/EU only — a CONUS
// viewport got transparent tiles, reading as "clears". Radar-forecast feeds are REGIONAL by
// nature, so the feed follows the VIEWPORT and the model differentiation applies within the
// region's available products:
//   CONUS (IEM HRRR, +4h): ALL models ride HRRR — the only public forecast-radar feed there.
//   EU    (DWD, +2h):      EURO → RV-product (RADVOR QPF), GFS/ICON → WN-product (prediction
//                          composite) — distinct products where multiple feeds exist.
//   elsewhere:             no feed → no future frames (truthful; past stays RainViewer-global).
export function radarRegionForCenter(lng, lat) {
  if (typeof lng !== 'number' || typeof lat !== 'number' || !isFinite(lng) || !isFinite(lat)) return 'NONE';
  if (lng >= -126 && lng <= -66 && lat >= 23 && lat <= 51) return 'CONUS';
  if (lng >= 2 && lng <= 18 && lat >= 44 && lat <= 57) return 'EU';
  return 'NONE';
}

export function radarForecastSourceFor(model, region) {
  const m = (model || 'GFS').toUpperCase();
  if (region === 'CONUS') return 'iem_hrrr';
  if (region === 'EU') return m === 'EURO' ? 'dwd_rv' : 'dwd_wn';
  return null;
}

const SOURCE_CAP_MIN = { iem_hrrr: 240, dwd_wn: 120, dwd_rv: 120 };
const SOURCE_STEP_MIN = { iem_hrrr: 60, dwd_wn: 30, dwd_rv: 30 };

export function radarFutureFramesForModel(model, nowMs = Date.now(), win, region = 'CONUS') {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_RADAR_FUTURE_DISABLED__ === true) return [];
  const source = radarForecastSourceFor(model, region);
  if (!source) return [];
  const cap = SOURCE_CAP_MIN[source];
  const step = SOURCE_STEP_MIN[source];
  const frames = [];
  for (let min = step; min <= cap; min += step) {
    frames.push({
      future: true,
      minutes: min,
      // unix seconds, matching RainViewer past-frame shape (frame.time) for any UI that reads it
      time: Math.floor(nowMs / 1000) + min * 60,
      source,
    });
  }
  return frames;
}

export function radarForecastTileUrl(frame, win) {
  if (!frame || !frame.future) return null;
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (frame.source === 'dwd_wn' || frame.source === 'dwd_rv') {
    // GeoServer TIME dimension: ISO8601 on the 5-min grid of the WN/RV products. Layer names
    // PROVEN via GetCapabilities + live GetMap PNGs 2026-07-06 ("dwd:WN-Produkt" is NOT defined):
    // WN prediction composite = dwd:Radar_wn-product_1x1km_ger (ICON lane);
    // RV/RADVOR precip forecast = dwd:Radar_rv_product_1x1km_ger (EURO lane).
    const t5 = Math.round((frame.time * 1000) / 300000) * 300000;
    const iso = new Date(t5).toISOString().replace(/\.\d{3}Z$/, '.000Z');
    const fallback = frame.source === 'dwd_rv' ? 'dwd:Radar_rv_product_1x1km_ger' : 'dwd:Radar_wn-product_1x1km_ger';
    const layer = typeof w.__RAW_RADAR_DWD_LAYER__ === 'string' && w.__RAW_RADAR_DWD_LAYER__
      ? w.__RAW_RADAR_DWD_LAYER__ : fallback;
    return 'https://maps.dwd.de/geoserver/dwd/wms?service=WMS&version=1.3.0&request=GetMap' +
      `&layers=${encodeURIComponent(layer)}&styles=&format=image%2Fpng&transparent=true` +
      `&crs=EPSG%3A3857&width=256&height=256&time=${encodeURIComponent(iso)}` +
      '&bbox={bbox-epsg-3857}';
  }
  // IEM HRRR: refp_{minutes, 4 digits} — the WMS serves the newest completed run for that lead.
  const mm = String(frame.minutes).padStart(4, '0');
  return 'https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refp.cgi?service=WMS&version=1.1.1&request=GetMap' +
    `&layers=refp_${mm}&styles=&format=image%2Fpng&transparent=true` +
    '&srs=EPSG%3A3857&width=256&height=256&bbox={bbox-epsg-3857}';
}

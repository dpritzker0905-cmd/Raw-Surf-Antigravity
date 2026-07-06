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

// HRRR RUN DISCOVERY (2026-07-06 v3 — "forecast doesn't tie to the nowcast"): IEM's static
// refp_{NNNN} layers are leads FROM THE LATEST COMPLETED RUN, not from now. With run 20z at
// 21:42Z, refp_0060 is valid 21:00Z — BEFORE the last RainViewer observed frame — so the
// animation jumped ~1.7h backward crossing "now" (all models, since CONUS rides HRRR for all).
// The archive-backed `refp-t` layer accepts year/month/day/hour (run) + f (lead minutes on a
// 15-min grid, ≤1080) as URL params (GetMap-proven 2026-07-06), letting frames pin EXACT
// wall-clock valid times: lead = valid − run. The latest run is discovered by probing f=0000
// newest-hour-first (present → PNG; missing → WMS XML exception), cached 5 min.
// Levers: __RAW_RADAR_HRRR_RUN_MS__ (forced run, forensics), __RAW_RADAR_FUTURE_DISABLED__.
export const HRRR_RUN_TTL_MS = 5 * 60 * 1000;
export const HRRR_LEAD_GRID_MIN = 15;
export const HRRR_MAX_LEAD_MIN = 1080;

const HRRR_WMS_BASE = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refp.cgi?service=WMS&version=1.1.1&request=GetMap';

export function hrrrRunParams(runMs) {
  const d = new Date(runMs);
  const p2 = (n) => String(n).padStart(2, '0');
  return `year=${d.getUTCFullYear()}&month=${p2(d.getUTCMonth() + 1)}&day=${p2(d.getUTCDate())}&hour=${p2(d.getUTCHours())}`;
}

let _hrrrRunCache = { runMs: null, at: 0 };
let _hrrrRunInflight = null;

export async function discoverHrrrRun(nowMs = Date.now(), win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (typeof w.__RAW_RADAR_HRRR_RUN_MS__ === 'number') return w.__RAW_RADAR_HRRR_RUN_MS__;
  if (_hrrrRunCache.runMs != null && nowMs - _hrrrRunCache.at < HRRR_RUN_TTL_MS) return _hrrrRunCache.runMs;
  if (_hrrrRunInflight) return _hrrrRunInflight;
  const fetchFn = w.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) return null;
  _hrrrRunInflight = (async () => {
    const topOfHour = Math.floor(nowMs / 3600000) * 3600000;
    // HRRR products land on IEM ~1-2h after run start; probe newest-first, 5 hours back.
    for (let back = 0; back <= 5; back++) {
      const runMs = topOfHour - back * 3600000;
      try {
        const probe = `${HRRR_WMS_BASE}&layers=refp-t&styles=&format=image%2Fpng&transparent=true` +
          '&srs=EPSG%3A3857&width=32&height=32&bbox=-10000000,3000000,-9900000,3100000' +
          `&${hrrrRunParams(runMs)}&f=0000`;
        const resp = await fetchFn(probe);
        const ct = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
        if (resp.ok && ct.indexOf('image/png') === 0) {
          _hrrrRunCache = { runMs, at: nowMs };
          return runMs;
        }
      } catch (e) { /* network hiccup — try the older run, or give up truthfully */ }
    }
    return null; // feed unreachable → no future frames (truthful; past stays RainViewer)
  })();
  try { return await _hrrrRunInflight; } finally { _hrrrRunInflight = null; }
}

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
// iem_hrrr 60→30 (2026-07-06 v3): the "hourly layers" premise behind 60 was wrong — HRRR leads
// exist on a 15-min grid; 30-min frames tie the animation to the 10-min observed cadence better.
const SOURCE_STEP_MIN = { iem_hrrr: 30, dwd_wn: 30, dwd_rv: 30 };

export function radarFutureFramesForModel(model, nowMs = Date.now(), win, region = 'CONUS', hrrrRunMs = null) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_RADAR_FUTURE_DISABLED__ === true) return [];
  const source = radarForecastSourceFor(model, region);
  if (!source) return [];
  const cap = SOURCE_CAP_MIN[source];
  const step = SOURCE_STEP_MIN[source];
  const frames = [];
  if (source === 'iem_hrrr') {
    // Run-pinned frames (v3): leads live on the RUN's 15-min grid, so valid times are exact
    // wall-clock — the first frame is the first grid point at/after "now", tying continuously
    // to the last RainViewer observed frame. Without a discovered run there are no truthful
    // future frames (discovery resolves in <1s; ~5 probe requests worst case).
    const runMs = typeof w.__RAW_RADAR_HRRR_RUN_MS__ === 'number' ? w.__RAW_RADAR_HRRR_RUN_MS__ : hrrrRunMs;
    if (typeof runMs !== 'number' || !isFinite(runMs) || runMs > nowMs) return [];
    const gridMs = HRRR_LEAD_GRID_MIN * 60000;
    const firstLead = Math.ceil((nowMs - runMs) / gridMs) * HRRR_LEAD_GRID_MIN;
    for (let f = firstLead; f <= firstLead + cap && f <= HRRR_MAX_LEAD_MIN; f += step) {
      const validMs = runMs + f * 60000;
      if (validMs - nowMs > cap * 60000) break;
      frames.push({
        future: true,
        minutes: Math.round((validMs - nowMs) / 60000),
        // unix seconds, matching RainViewer past-frame shape (frame.time) for any UI that reads it
        time: Math.floor(validMs / 1000),
        source,
        runMs,
        f,
      });
    }
    return frames;
  }
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
  // IEM HRRR (v3 run-pinned): archive-backed refp-t with explicit run (year/month/day/hour) +
  // lead f — the tile's VALID time is exactly frame.time. The static refp_{NNNN} form is kept
  // only as a legacy fallback for frames without run info (leads there are run-relative, which
  // was the "forecast doesn't tie to the nowcast" root — ~now−run behind the labeled time).
  if (typeof frame.runMs === 'number' && typeof frame.f === 'number') {
    const ff = String(frame.f).padStart(4, '0');
    return 'https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refp.cgi?service=WMS&version=1.1.1&request=GetMap' +
      '&layers=refp-t&styles=&format=image%2Fpng&transparent=true' +
      `&srs=EPSG%3A3857&width=256&height=256&${hrrrRunParams(frame.runMs)}&f=${ff}` +
      '&bbox={bbox-epsg-3857}';
  }
  const mm = String(frame.minutes).padStart(4, '0');
  return 'https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refp.cgi?service=WMS&version=1.1.1&request=GetMap' +
    `&layers=refp_${mm}&styles=&format=image%2Fpng&transparent=true` +
    '&srs=EPSG%3A3857&width=256&height=256&bbox={bbox-epsg-3857}';
}

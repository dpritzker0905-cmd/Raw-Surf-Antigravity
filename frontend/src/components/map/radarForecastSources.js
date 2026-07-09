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

// RainViewer tile URL TEMPLATE ({z}/{x}/{y} filled by maplibre). In production it routes through the
// same-origin Netlify edge proxy (/rv/*, netlify/edge-functions/rvproxy.js) which caches tiles durably
// so the free RainViewer CDN is never rate-limited (429) by the advection tile volume — the fix that
// makes advection viable. Goes DIRECT on localhost (no Netlify edge there) or when the proxy is killed.
// `path` = the RainViewer frame path ("/v2/radar/<id>"); px = '256' | '512'.
export function rainviewerTileTemplate(path, px, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  const host = (w.location && w.location.hostname) || '';
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const proxied = w.__RAW_RADAR_PROXY_DISABLED__ !== true && !isLocal;
  const base = proxied ? `/rv${path}` : `https://tilecache.rainviewer.com${path}`;
  return `${base}/${px}/{z}/{x}/{y}/7/1_0.png`;
}

// RainViewer CATALOG url (the frame index). Same proxy gating as the tiles (2026-07-09): off localhost
// it routes through the /rv/* Netlify edge proxy so the catalog is fetched from Netlify's IP (never the
// user's) and shared across users via a short edge cache — RainViewer can't rate-limit the user's IP and
// CORS-block it (the "radar barely visible" = catalog 429 → radarPastFrames=[]). Direct on localhost / when
// killed via __RAW_RADAR_PROXY_DISABLED__.
export function rainviewerCatalogUrl(win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  const host = (w.location && w.location.hostname) || '';
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const proxied = w.__RAW_RADAR_PROXY_DISABLED__ !== true && !isLocal;
  return proxied ? '/rv/public/weather-maps.json' : 'https://api.rainviewer.com/public/weather-maps.json';
}

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
      } catch (e) { /* network hiccup — try the older run, or fall back to the last known run below */ }
    }
    // FEED HICCUP RESILIENCE (2026-07-08, runbook §1c-a): every probe failed this cycle. Returning null
    // makes radarFutureFramesForModel emit ZERO future frames → the forecast side of the timeline goes
    // blank ("loses visuals when it switches into forecast") on a transient IEM outage. If we have a
    // PRIOR run (now past its TTL, else line 55 would have served it), fall back to it: its leads are
    // recomputed from ITS run time (radarFutureFramesForModel:125), so valid times stay wall-clock-correct
    // — a staler forecast, NOT the ~1.7h backward jump the legacy run-relative form caused (cbbc9557).
    // `at` is left stale so the next TTL cycle still re-probes for a fresh run (self-heals when the feed
    // returns). Kill: __RAW_RADAR_RUN_FALLBACK_DISABLED__.
    if (_hrrrRunCache.runMs != null && w.__RAW_RADAR_RUN_FALLBACK_DISABLED__ !== true) {
      return _hrrrRunCache.runMs;
    }
    return null; // no prior run either → no future frames (truthful; past stays RainViewer)
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

// ADVECTION NOWCAST near-term cap/step, minutes (backlog #2, runbook §8c). Advected RainViewer
// frames bridge the ~9.71%→3.27% observed↔HRRR coverage cliff by extrapolating the last observed
// echo forward along its motion for the near term; HRRR takes over beyond the cap. This is the
// INDUSTRY fix (Ventusky/Windy: Lagrangian extrapolation — estimate the echo motion field between
// the last two radar images, advect the latest observation forward; skillful the first 30–60 min).
// DEFAULT-ON (2026-07-08) so the forecast carries the crisp observed echo instead of cliffing to
// HRRR's sparse QPF at "now". Kill: __RAW_RADAR_ADVECTION_DISABLED__ (or __RAW_RADAR_ADVECTION__=false).
// Tunable: __RAW_RADAR_ADVECT_CAP_MIN__, __RAW_RADAR_ADVECT_STEP_MIN__.
const ADVECT_CAP_MIN_DEFAULT = 60;  // Ventusky's stated nowcast sweet spot = the first 30–60 min
const ADVECT_STEP_MIN_DEFAULT = 15;

export function radarFutureFramesForModel(model, nowMs = Date.now(), win, region = 'CONUS', hrrrRunMs = null, pastFrames = []) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_RADAR_FUTURE_DISABLED__ === true) return [];
  const source = radarForecastSourceFor(model, region);
  if (!source) return [];
  const cap = SOURCE_CAP_MIN[source];
  const step = SOURCE_STEP_MIN[source];
  const frames = [];
  if (source === 'iem_hrrr') {
    // --- ADVECTION near-term nowcast frames (RainViewer-based, run-INDEPENDENT) ---
    // Warp the last OBSERVED frame forward along its motion so the near term carries the observed echo.
    // DEFAULT-ON again (2026-07-09): the advect protocol's prev/curr tiles now route through the cached
    // same-origin proxy (rainviewerTileTemplate → /rv/*), so the ~3x tile volume hits Netlify's durable
    // edge cache instead of flooding RainViewer's free CDN (the 429 → CORS → blank-tile "rectangle"
    // failure that took the observed radar down). Kill switches if it regresses: __RAW_RADAR_PROXY_DISABLED__
    // (advect tiles → direct RainViewer) and __RAW_RADAR_ADVECTION_DISABLED__ / __RAW_RADAR_ADVECTION__=false.
    let advectCapMin = 0;
    const advectOn = w.__RAW_RADAR_ADVECTION__ !== false && w.__RAW_RADAR_ADVECTION_DISABLED__ !== true
      && Array.isArray(pastFrames) && pastFrames.length >= 2;
    if (advectOn) {
      const prevF = pastFrames[pastFrames.length - 2];
      const currF = pastFrames[pastFrames.length - 1];
      const obsSec = (prevF && currF && typeof prevF.time === 'number' && typeof currF.time === 'number')
        ? (currF.time - prevF.time) : 0;
      // Sane observed interval (RainViewer past frames are ~10 min apart) + both tiles present.
      if (prevF && currF && prevF.path && currF.path && obsSec > 60 && obsSec < 3600) {
        advectCapMin = typeof w.__RAW_RADAR_ADVECT_CAP_MIN__ === 'number' ? w.__RAW_RADAR_ADVECT_CAP_MIN__ : ADVECT_CAP_MIN_DEFAULT;
        const advStep = typeof w.__RAW_RADAR_ADVECT_STEP_MIN__ === 'number' ? w.__RAW_RADAR_ADVECT_STEP_MIN__ : ADVECT_STEP_MIN_DEFAULT;
        for (let leadMin = advStep; leadMin <= advectCapMin; leadMin += advStep) {
          frames.push({
            future: true,
            advect: true,
            source: 'advect',
            minutes: leadMin,
            time: Math.floor(nowMs / 1000) + leadMin * 60,
            leadFactor: (leadMin * 60) / obsSec, // how many observed-intervals ahead this lead is
            prevPath: prevF.path,
            currPath: currF.path,
          });
        }
      }
    }
    // RADAR = OBSERVED + NOWCAST, THEN STOP (2026-07-09, forensic correction — Windy/Ventusky).
    // Both keep the RADAR layer to observed + a short (~1h) advection nowcast and put the LONGER
    // forecast on a SEPARATE model layer (this app's "Precip" layer). Neither seams coarse model
    // precip into the crisp radar animation — that resolution seam looks bad (the reverted Stage-2
    // om-model far-term `6200c496`, and the reverted IMERG underlay `a3558d1a`). So once advection is
    // producing the nowcast, STOP: no dissipating/lower-res HRRR far-term. HRRR remains the FALLBACK
    // when advection can't run (below), and opt-in via __RAW_RADAR_HRRR_FAR__=true.
    if (advectCapMin > 0 && w.__RAW_RADAR_HRRR_FAR__ !== true) {
      return frames; // observed past + advection nowcast — the long forecast is the separate Precip layer
    }

    // --- HRRR forecast frames (run-pinned v3): leads live on the RUN's 15-min grid, so valid times
    // are exact wall-clock — the first frame is the first grid point at/after "now". Without a
    // discovered run there are no truthful HRRR frames (return whatever advect produced, else []).
    const runMs = typeof w.__RAW_RADAR_HRRR_RUN_MS__ === 'number' ? w.__RAW_RADAR_HRRR_RUN_MS__ : hrrrRunMs;
    if (typeof runMs !== 'number' || !isFinite(runMs) || runMs > nowMs) return frames;
    const gridMs = HRRR_LEAD_GRID_MIN * 60000;
    const firstLead = Math.ceil((nowMs - runMs) / gridMs) * HRRR_LEAD_GRID_MIN;
    for (let f = firstLead; f <= firstLead + cap && f <= HRRR_MAX_LEAD_MIN; f += step) {
      const validMs = runMs + f * 60000;
      if (validMs - nowMs > cap * 60000) break;
      // The advect nowcast owns the near term — skip HRRR frames it already covers (no dup steps).
      if (advectCapMin > 0 && (validMs - nowMs) <= advectCapMin * 60000) continue;
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

// LIGHTNING COMPANION (2026-07-06): NOAA nowCOAST NLDN lightning strike density rides the radar
// timeline. PAST frames only — it is an OBSERVATION product, so future frames truthfully carry
// no lightning rather than inventing it. The layer is TIME-enabled with nearestValue=1
// (GetCapabilities-proven), so each frame's timestamp snaps server-side to the nearest available
// observation; CORS is open (ACAO: *). Coverage is NEAR-GLOBAL — the nowCOAST layer's
// EX_GeographicBoundingBox is lon -180→180, lat -25→80 (Vaisala GLD360 GLOBAL lightning, not just
// US NLDN — GetCapabilities-verified 2026-07-08). This is WHY lightning shows worldwide (e.g. Sahel
// storms) even where RainViewer radar has no coverage — a FEATURE (global storm detection), not a bug.
// Kill: __RAW_RADAR_LIGHTNING_DISABLED__.
export function radarLightningTileUrl(frame, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_RADAR_LIGHTNING_DISABLED__ === true) return null;
  if (!frame || frame.future || typeof frame.time !== 'number') return null;
  const t5 = Math.round((frame.time * 1000) / 300000) * 300000;
  const iso = new Date(t5).toISOString().replace(/\.\d{3}Z$/, '.000Z');
  // White-hot flash recolor (industry look: strikes = bright white, not a density heatmap) —
  // see radarTileRecolor.js. Kill shares the layer's switch plus __RAW_RADAR_RECOLOR_DISABLED__.
  const recolor = w.__RAW_RADAR_RECOLOR_DISABLED__ === true ? '' : 'ltg-flash://';
  return recolor + 'https://nowcoast.noaa.gov/geoserver/lightning_detection/ows?service=WMS&version=1.3.0&request=GetMap' +
    '&layers=ldn_lightning_strike_density&styles=&format=image%2Fpng&transparent=true' +
    `&crs=EPSG%3A3857&width=256&height=256&time=${encodeURIComponent(iso)}` +
    '&bbox={bbox-epsg-3857}';
}

export function radarForecastTileUrl(frame, win) {
  if (!frame || !frame.future) return null;
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (frame.source === 'advect') {
    // ADVECTED near-term nowcast (backlog #2): warp the last OBSERVED RainViewer tile forward.
    // Both observed tiles are ALREADY scheme-7 → NO recolor. The advect-rv:// protocol
    // (radarTileRecolor.makeAdvectHandler) fetches prev+curr, estimates motion once/tile, and warps
    // curr by motion×leadFactor. Encoding: advect-rv://<leadFactor>|<prevTileUrl>|<currTileUrl>,
    // where each observed URL keeps its {z}/{x}/{y} (maplibre fills all with the SAME tile coords).
    if (typeof frame.leadFactor !== 'number' || !frame.prevPath || !frame.currPath) return null;
    // Through the cached same-origin proxy (rainviewerTileTemplate) — the advect protocol fetch()es these
    // prev/curr tiles, so proxying them is what stops the 429 flood. 256px = RainViewer native.
    const tile = (p) => rainviewerTileTemplate(p, '256', w);
    return `advect-rv://${frame.leadFactor}|${tile(frame.prevPath)}|${tile(frame.currPath)}`;
  }
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
    // DWD/EU PALETTE PARITY (2026-07-07): recolor DWD's native cyan→green→magenta ramp to the
    // RainViewer scheme-7 the past frames use, so the timeline reads as one product across "now"
    // (nearest-match — DWD tiles are antialiased; see radarTileRecolor.recolorDwdImageData). Kill
    // shares __RAW_RADAR_RECOLOR_DISABLED__ (→ native DWD palette).
    const recolor = w.__RAW_RADAR_RECOLOR_DISABLED__ === true ? '' : 'dwd-rv://';
    return recolor + 'https://maps.dwd.de/geoserver/dwd/wms?service=WMS&version=1.3.0&request=GetMap' +
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
    // RECOLOR PROTOCOL (2026-07-06): IEM paints precip-type ramps (green rain) while the past
    // frames are RainViewer scheme-7 (pale blue) — the palette family jumped at "now". The
    // hrrr-rv:// protocol repaints each tile to scheme 7 client-side (radarTileRecolor.js).
    const recolor = w.__RAW_RADAR_RECOLOR_DISABLED__ === true ? '' : 'hrrr-rv://';
    // 512px renders on 256px tiles (2026-07-07, "forecast animations look terrible vs the
    // nowcast"): RainViewer's past tiles are SMOOTHED; IEM renders indexed nearest-neighbor
    // blocks. The 2× supersample + the recolor pass's blur (radarTileRecolor) restore the soft
    // organic look on the future side of the timeline.
    return `${recolor}https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refp.cgi?service=WMS&version=1.1.1&request=GetMap` +
      '&layers=refp-t&styles=&format=image%2Fpng&transparent=true' +
      `&srs=EPSG%3A3857&width=512&height=512&${hrrrRunParams(frame.runMs)}&f=${ff}` +
      '&bbox={bbox-epsg-3857}';
  }
  const mm = String(frame.minutes).padStart(4, '0');
  return 'https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refp.cgi?service=WMS&version=1.1.1&request=GetMap' +
    `&layers=refp_${mm}&styles=&format=image%2Fpng&transparent=true` +
    '&srs=EPSG%3A3857&width=256&height=256&bbox={bbox-epsg-3857}';
}

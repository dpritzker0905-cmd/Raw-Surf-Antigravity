/**
 * radarTileRecolor.js — HRRR forecast-radar tiles recolored to the RainViewer scheme (2026-07-06).
 *
 * The radar timeline's PAST frames are RainViewer tiles rendered server-side with color scheme 7
 * (the `/7/1_0.png` tile-path segment): an alpha-graded pale-cyan→blue dBZ ramp. FUTURE frames
 * come from IEM's HRRR refp WMS, whose PNGs are indexed with pyiem's radar_ptype() PRECIP-TYPE
 * ramps (rain=Greens+Wistia, snow=ocean_r+PuRd, frzr=Reds, icep=Purples; 22 colors each, one per
 * 2.5 dBZ from 0 to 55 — see akrherz/iem scripts/hrrr/hrrr_ref2raster.py). Crossing the "now"
 * boundary therefore jumped color families (blue rain → green rain), reading as "different data".
 *
 * This module recolors HRRR tiles client-side through a MapLibre custom protocol: every source
 * pixel is exact-matched against the four ptype ramps (the PNGs are indexed + nearest-neighbor
 * resampled, so no blended intermediates exist), converted to its dBZ, and repainted with the
 * RainViewer scheme-7 color for that dBZ — including its alpha (0 dBZ is fully transparent, so
 * the low-reflectivity haze thresholds out exactly like the past frames). Precip-type identity
 * is deliberately collapsed to intensity: the timeline reads as ONE continuous radar product.
 *
 * Unknown colors pass through unchanged (fail-open: future palette additions still show precip),
 * and any decode/canvas error returns the ORIGINAL tile bytes. Kill switch:
 * __RAW_RADAR_RECOLOR_DISABLED__ = true → radarForecastTileUrl emits plain https URLs and this
 * protocol is bypassed entirely.
 */
import maplibregl from 'maplibre-gl';
import { createAdvectPipeline, parseAdvectUrl, neighborTileUrl, pruneOldest, ADVECT_TTL_MS } from './radarAdvectCore';
import { advectTileOffThread, recolorTileOffThread } from './radarAdvectClient';
import {
  recolorRadarImageData, recolorDwdImageData, whitenLightningImageData, extractLightningStrikes, MERC_R,
} from './radarRecolorCore';

// The pixel transforms moved to radarRecolorCore.js (2026-11-12, shared with the worker); re-exported for their callers.
export { recolorRadarImageData, recolorDwdImageData, whitenLightningImageData, extractLightningStrikes };

export const RADAR_RECOLOR_PROTOCOL = 'hrrr-rv';

export const RADAR_DWD_PROTOCOL = 'dwd-rv';

export const LIGHTNING_FLASH_PROTOCOL = 'ltg-flash';

// STRIKE-POINT EXTRACTION (2026-07-07, "the lightning bolts look terrible"): the industry look
// (Windy's live lightning tracker, Ventusky, Blitzortung — all point-fed) is INDIVIDUAL white
// flashes at strike locations, not a raster wash. Our public feed is a density raster, but the
// protocol handler already decodes every tile AND the tile URL carries its real EPSG:3857 bbox —
// so density CORES are extracted as geo-points here and MapWebGL renders per-point flash
// animations (glow + core circles, independent random phases). Grid-binned local maxima keep it
// to ≤ ~40 points/tile; the registry prunes by age so frame changes retire old strikes.
const _strikeRegistry = new Map();   // tileUrl → { points: [{lng,lat,intensity}], ts }
const STRIKE_TTL_MS = 90 * 1000;

function recordStrikes(url, points) {
  _strikeRegistry.set(url, { points, ts: Date.now() });
  if (_strikeRegistry.size > 64) {
    const oldest = [..._strikeRegistry.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _strikeRegistry.delete(oldest[0]);
  }
}

export function getLightningStrikePoints() {
  const now = Date.now();
  const out = [];
  for (const [url, e] of _strikeRegistry) {
    if (now - e.ts > STRIKE_TTL_MS) { _strikeRegistry.delete(url); continue; }
    out.push(...e.points);
  }
  return out;
}

// DIRECT VIEWPORT FETCH (2026-07-07 v3b): maplibre silently refused to request the ltg-flash://
// raster tiles (spec present, zero loads, no errors — protocol black box), so the strike feed
// no longer rides the tile pipeline at all: ONE plain-https GetMap for the current viewport,
// decoded here, cores extracted into the same registry the flash renderer reads. Refreshed by
// the caller (~60s + on move) — CURRENT lightning only, which is the truthful read of a live
// strike feed. Throttled + deduped; failures leave the registry untouched (flashes just age out).
let _lastViewportFetch = { key: '', ts: 0 };
export async function refreshViewportStrikes(map) {
  try {
    if (typeof window !== 'undefined' && window.__RAW_RADAR_LIGHTNING_DISABLED__ === true) return 0;
    const b = map.getBounds();
    const toMx = (lng) => (lng / 180) * MERC_R;
    const toMy = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI * MERC_R;
    const bbox = [toMx(b.getWest()), toMy(Math.max(-85, b.getSouth())), toMx(b.getEast()), toMy(Math.min(85, b.getNorth()))];
    const t5 = Math.round((Date.now() - 6 * 60000) / 300000) * 300000;   // newest settled 5-min slot
    const key = `${bbox.map(v => v.toFixed(0)).join(',')}_${t5}`;
    if (_lastViewportFetch.key === key && Date.now() - _lastViewportFetch.ts < 55000) return -1;
    _lastViewportFetch = { key, ts: Date.now() };
    const iso = new Date(t5).toISOString().replace(/\.\d{3}Z$/, '.000Z');
    const url = 'https://nowcoast.noaa.gov/geoserver/lightning_detection/ows?service=WMS&version=1.3.0&request=GetMap' +
      '&layers=ldn_lightning_strike_density&styles=&format=image%2Fpng&transparent=true' +
      `&crs=EPSG%3A3857&width=512&height=512&time=${encodeURIComponent(iso)}` +
      `&bbox=${bbox.join(',')}`;
    const resp = await fetch(url);
    if (!resp.ok || (resp.headers.get('content-type') || '').indexOf('image') !== 0) return 0;
    const bitmap = await createImageBitmap(await resp.blob());
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const pts = extractLightningStrikes(img.data, bitmap.width, bitmap.height, bbox);
    recordStrikes(`viewport_${key}`, pts);
    return pts.length;
  } catch (e) {
    return 0;   // network/decode hiccup — registry keeps prior strikes until TTL
  }
}

// SCRUB/LOOP TILE CACHE (2026-07-07, "slow and churning between layer transfers and scrubbing"):
// each HRRR future tile is a server-side WMS RENDER (400-600ms) with no cache headers, so every
// animation loop and scrub pass re-paid the full render latency per tile. Recolored results are
// LRU-cached (10-min TTL — inside the 5-min run-discovery cadence a given run+lead+bbox tile is
// immutable) and concurrent requests for the same tile share one in-flight promise.
// Telemetry: __RAW_RADAR_TILE_CACHE__ {hits, misses}. Kill: __RAW_RADAR_TILE_CACHE_OFF__.
const _tileCache = new Map();     // httpsUrl → { buf: ArrayBuffer, ts }
const _tileInflight = new Map();  // httpsUrl → Promise<{data}>
const TILE_CACHE_TTL_MS = 10 * 60 * 1000;
const TILE_CACHE_MAX = 160;

function makeRecolorHandler(transform, blurPx = 0, workerTransform = null) {
  return async (params, abortController) => {
    // Tile URLs are '<scheme>://https://...' — strip only the custom scheme prefix.
    const httpsUrl = params.url.replace(/^[a-z-]+:\/\/(?=https:\/\/)/, '');
    const w = typeof window !== 'undefined' ? window : {};
    const cacheOn = w.__RAW_RADAR_TILE_CACHE_OFF__ !== true;
    const tel = w.__RAW_RADAR_TILE_CACHE__ || (w.__RAW_RADAR_TILE_CACHE__ = { hits: 0, misses: 0 });
    // OFF THE MAIN THREAD (2026-11-12, default ON): the worker fetches, decodes, recolors and softens the tile and answers with
    // a decoded ImageBitmap (no PNG encode here, no second decode in maplibre). null = no worker, the kill, or this tile failed
    // there: the main-thread path below, unchanged. Kill: window.__RAW_DISABLE_RADAR_RECOLOR_WORKER__ = true.
    if (workerTransform) {
      const off = await recolorTileOffThread(workerTransform, httpsUrl, blurPx,
        { smoothOff: w.__RAW_RADAR_SMOOTH_DISABLED__ === true, cacheOff: !cacheOn }, abortController);
      if (off) {
        if (off.cached) tel.hits++; else tel.misses++;
        if (off.strikes) recordStrikes(httpsUrl, off.strikes);
        return { data: off.data };
      }
    }
    if (cacheOn) {
      const hit = _tileCache.get(httpsUrl);
      if (hit && Date.now() - hit.ts < TILE_CACHE_TTL_MS) {
        tel.hits++;
        return { data: hit.buf.slice(0) };
      }
      const inflight = _tileInflight.get(httpsUrl);
      if (inflight) return inflight;
    }
    const work = (async () => {
      tel.misses++;
      const resp = await fetch(httpsUrl);
      const buf = await resp.arrayBuffer();
      try {
        const bitmap = await createImageBitmap(new Blob([buf], { type: 'image/png' }));
        let canvas = typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(bitmap.width, bitmap.height)
          : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        transform(img.data, bitmap.width, bitmap.height, httpsUrl);
        ctx.putImageData(img, 0, 0);
        // SMOOTHING (2026-07-07, "forecast animations look terrible vs the nowcast"): RainViewer
        // past tiles are smoothed; IEM renders hard nearest-neighbor blocks. A slight blur after
        // recoloring (paired with the 512px supersampled GetMap in radarForecastSources) gives
        // the future frames the same soft organic look. Kill: __RAW_RADAR_SMOOTH_DISABLED__.
        if (blurPx > 0 && w.__RAW_RADAR_SMOOTH_DISABLED__ !== true) {
          try {
            const soft = typeof OffscreenCanvas !== 'undefined'
              ? new OffscreenCanvas(canvas.width, canvas.height)
              : Object.assign(document.createElement('canvas'), { width: canvas.width, height: canvas.height });
            const sctx = soft.getContext('2d');
            if (typeof sctx.filter === 'string' || sctx.filter !== undefined) {
              sctx.filter = `blur(${blurPx}px)`;
              sctx.drawImage(canvas, 0, 0);
              canvas = soft;
            }
          } catch (e) { /* no filter support — serve unblurred */ }
        }
        const blob = canvas.convertToBlob
          ? await canvas.convertToBlob({ type: 'image/png' })
          : await new Promise((res) => canvas.toBlob(res, 'image/png'));
        const out = await blob.arrayBuffer();
        if (cacheOn) {
          _tileCache.set(httpsUrl, { buf: out.slice(0), ts: Date.now() });
          if (_tileCache.size > TILE_CACHE_MAX) {
            const oldest = [..._tileCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
            if (oldest) _tileCache.delete(oldest[0]);
          }
        }
        return { data: out };
      } catch (e) {
        return { data: buf };   // decode/canvas failure: serve the original tile (native palette)
      }
    })();
    if (cacheOn) {
      _tileInflight.set(httpsUrl, work);
      work.finally(() => _tileInflight.delete(httpsUrl));
    }
    return work;
  };
}

// Extract strike cores from the ORIGINAL palette (ranks live there), then whiten for display.
function lightningTransform(data, w, h, url) {
  try {
    const m = /[?&]bbox=([-0-9.]+),([-0-9.]+),([-0-9.]+),([-0-9.]+)/.exec(url);
    if (m && w && h) {
      recordStrikes(url, extractLightningStrikes(data, w, h, [+m[1], +m[2], +m[3], +m[4]]));
    }
  } catch (e) { /* extraction is best-effort — the whitened raster still renders */ }
  whitenLightningImageData(data);
}

export const RADAR_ADVECT_PROTOCOL = 'advect-rv';

// ADVECTION NOWCAST protocol (backlog #2, runbook §8c). Unlike the recolor handlers, this fetches
// TWO tiles — the last two OBSERVED RainViewer tiles at this z/x/y — estimates the dominant echo
// motion ONCE per pair (cached, lead-independent), then warps the LATEST tile forward by
// motion×leadFactor (radarAdvection.js). Advected RainViewer tiles are already scheme-7, so there
// is NO recolor. URL: advect-rv://<leadFactor>|<prevTileHttpsUrl>|<currTileHttpsUrl> (maplibre fills
// the shared {z}/{x}/{y} in all). Fail-open = TRANSPARENT tile (never a stale frozen echo — the §6a
// graveyard). Dormant unless radarForecastSources emits advect frames (__RAW_RADAR_ADVECTION__=true).
const _advectMotion = new Map();   // 'prevUrl|currUrl' → { dx, dy, confidence, ts } (main-thread path only)
const _advectOut = new Map();      // full advect-rv:// url → { buf, ts }
const _advectDecoded = new Map();  // observed https tile url → { data, w, h, ts } (shared across leads + neighbors)
const _advectInflight = new Map();
let _blankTileBuf = null;

// neighborTileUrl moved to radarAdvectCore.js with the rest of the per-tile pipeline (2026-11-12); re-exported for its callers.
export { neighborTileUrl };

function advCanvas(w, h) {
  return typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
}
async function advCanvasToBuf(canvas) {
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise((res) => canvas.toBlob(res, 'image/png'));
  return blob.arrayBuffer();
}
async function advDecodeTile(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('advect tile ' + resp.status);
  const bitmap = await createImageBitmap(await resp.blob());
  const canvas = advCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return { data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, w: bitmap.width, h: bitmap.height };
}
// Decode-once cache for observed tiles: the 4 lead frames + the neighbor fills of adjacent advect
// tiles all reference the same handful of observed RainViewer tiles, so decoding each ONCE (keyed by
// url) avoids re-fetch/re-decode churn. Fetch bytes are already proxy/HTTP-cached; this caches the
// decoded RGBA. TTL matches the observed-catalog cadence.
async function advGetTile(url) {
  const now = Date.now();
  const hit = _advectDecoded.get(url);
  if (hit && now - hit.ts < ADVECT_TTL_MS) return hit;
  const t = await advDecodeTile(url);
  const rec = { data: t.data, w: t.w, h: t.h, ts: now };
  _advectDecoded.set(url, rec);
  pruneOldest(_advectDecoded);
  return rec;
}
async function advBlankTile(w = 256, h = 256) {
  if (_blankTileBuf) return _blankTileBuf.slice(0);
  _blankTileBuf = await advCanvasToBuf(advCanvas(w, h)); // untouched canvas = fully transparent
  return _blankTileBuf.slice(0);
}

// The main-thread pipeline (radarAdvectCore.js: motion once per observed pair, then smooth-field / neighbour-aware / rigid warp).
const _advectMain = createAdvectPipeline({ getTile: advGetTile, motionCache: _advectMotion });

function makeAdvectHandler() {
  return async (params, abortController) => {
    const win = typeof window !== 'undefined' ? window : {};
    const flags = {
      smoothOff: win.__RAW_RADAR_ADVECT_SMOOTH_DISABLED__ === true,
      neighborOff: win.__RAW_RADAR_ADVECT_NEIGHBOR_DISABLED__ === true,
    };
    // OFF THE MAIN THREAD (2026-11-12, default ON): the worker fetches, estimates and warps, and answers with a decoded
    // ImageBitmap that maplibre uses as is. null = no worker here (or it failed, or the kill): the main-thread path below.
    // Kill: window.__RAW_DISABLE_RADAR_ADVECT_WORKER__ = true.
    const off = await advectTileOffThread(params.url, flags, abortController);
    if (off) return off;
    const now = Date.now();
    const hit = _advectOut.get(params.url);
    if (hit && now - hit.ts < ADVECT_TTL_MS) return { data: hit.buf.slice(0) };
    const inflight = _advectInflight.get(params.url);
    if (inflight) return inflight;
    const work = (async () => {
      try {
        const parsed = parseAdvectUrl(params.url);
        if (!parsed) return { data: await advBlankTile() };
        const warped = await _advectMain.warp(parsed, flags);
        const canvas = advCanvas(warped.w, warped.h);
        canvas.getContext('2d').putImageData(new ImageData(warped.data, warped.w, warped.h), 0, 0);
        const out = await advCanvasToBuf(canvas);
        _advectOut.set(params.url, { buf: out.slice(0), ts: now });
        pruneOldest(_advectOut);
        return { data: out };
      } catch (e) {
        // Observed tile 404 (expired RainViewer path) / decode failure → transparent, NOT a frozen echo.
        try { return { data: await advBlankTile() }; } catch (e2) { return { data: new ArrayBuffer(0) }; }
      }
    })();
    _advectInflight.set(params.url, work);
    work.finally(() => _advectInflight.delete(params.url));
    return work;
  };
}

let _registered = false;
export function registerRadarRecolorProtocol() {
  if (_registered || !maplibregl?.addProtocol) return;
  _registered = true;
  maplibregl.addProtocol(RADAR_RECOLOR_PROTOCOL, makeRecolorHandler(recolorRadarImageData, 1.5, 'hrrr'));
  maplibregl.addProtocol(RADAR_DWD_PROTOCOL, makeRecolorHandler(recolorDwdImageData, 1.0, 'dwd'));
  maplibregl.addProtocol(LIGHTNING_FLASH_PROTOCOL, makeRecolorHandler(lightningTransform, 0, 'ltg'));
  maplibregl.addProtocol(RADAR_ADVECT_PROTOCOL, makeAdvectHandler());
  // Published as window globals for MapWebGL's flash renderer (avoids adding another
  // maplibre-gl-importing edge into the heavy MapPage chunk).
  if (typeof window !== 'undefined') {
    window.__LTG_STRIKES__ = getLightningStrikePoints;
    window.__LTG_REFRESH__ = refreshViewportStrikes;
  }
}

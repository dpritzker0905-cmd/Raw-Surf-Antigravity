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

export const RADAR_RECOLOR_PROTOCOL = 'hrrr-rv';

// pyiem radar_ptype() ramps, verbatim (index i = i * 2.5 dBZ). Source of truth:
// akrherz/pyiem src/pyiem/plot/colormaps.py (fetched + tile-sample-verified 2026-07-06).
const IEM_PTYPE_RAMPS = {
  rain: (
    '#eef8ea #e5f5e0 #d6efd0 #c7e9c0 #b4e1ad #a0d99b #8ace88 #73c476 ' +
    '#5ab769 #40aa5d #319a50 #228a44 #117b38 #006c2c #005723 #00441b ' +
    '#ffe81a #ffd710 #ffc505 #ffb700 #ffab00 #ffa000'
  ).split(' '),
  snow: (
    '#b4dae6 #99ccdd #81c0d5 #66b3cc #4ea6c4 #3399bb #1b8db3 #0080aa ' +
    '#0073a2 #006699 #005a91 #004d88 #003f7f #003377 #00266e #001a66 ' +
    '#8d003b #b80b4e #d81b6a #e53592 #df66b0 #cd8bc2'
  ).split(' '),
  frzr: (
    '#ffeee6 #fee6da #fedecf #fdd0bc #fcc2aa #fcb499 #fca588 #fc9576 ' +
    '#fc8767 #fb7858 #fb694a #f7593f #f24734 #ec382b #de2b25 #d11e1f ' +
    '#c4161c #b61319 #a81016 #940b13 #7c0510 #67000d'
  ).split(' '),
  icep: (
    '#f8f6fa #f3f1f7 #eeecf4 #e6e5f1 #dedded #d5d5e9 #cacae3 #bebfdd ' +
    '#b4b4d7 #a9a7cf #9e9ac8 #9390c3 #8885be #7e79b8 #7669af #6e58a7 ' +
    '#66499f #5e3a98 #552a90 #4e1c8a #460d83 #3f007d'
  ).split(' '),
};

// RainViewer color scheme 7 RAIN column, sampled at the same 2.5-dBZ steps from the published
// color table (rainviewer.com/api/color-schemes.html). ⚠️ The page's colorData JSON lists every
// dBZ TWICE — a rain row then a snow row; keep the FIRST occurrence. The initial extraction
// keyed a dict by dBZ and silently kept the SNOW column (an all-blue ramp) — heavy precip lost
// its yellows/reds (user-caught visually 2026-07-06). The past frames' `1_0` URL options run
// snow=0, so the rain column IS the whole past-frame palette — exact parity. <10 dBZ is fully
// transparent; 30≈yellow, 40≈amber, 52.5+≈red (the SELEX-SI rainbow).
// ⚠️ Indexes 0-3 (0-7.5 dBZ) are FULLY TRANSPARENT in RainViewer's published table, which
// erased the soft "blue cloud" fringe the past frames visibly carry (their smoothing spreads
// low echo) — user-caught 2026-07-07: "the blue areas of clouds aren't showing, but the reds/
// yellows/oranges are". Restored as a graduated low-alpha teal ramp into the 10-dBZ teal, so
// light precip reads as the same soft fringe on both sides of "now".
const RV_SCHEME7 = [
  '#009f9f26', '#009f9f40', '#009f9f59', '#009f9f73', '#009f9fff', '#00977dff',
  '#008c4bff', '#00b62dff', '#00d319ff', '#0de31cff', '#21fd22ff', '#a6fd1dff',
  '#fffd1bff', '#ffec10ff', '#ffd400ff', '#ffbb00ff', '#ffab00ff', '#ff9200ff',
  '#ff6e00ff', '#f63501ff', '#f01002ff', '#e30b0fff',
];

function hexToRgba(h) {
  const v = h.replace('#', '');
  return [
    parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16), v.length >= 8 ? parseInt(v.slice(6, 8), 16) : 255,
  ];
}

// 'r,g,b' → scheme-7 RGBA, all four ptype ramps collapsed onto the shared dBZ axis.
function buildLut() {
  const lut = new Map();
  for (const ramp of Object.values(IEM_PTYPE_RAMPS)) {
    ramp.forEach((hex, i) => {
      const [r, g, b] = hexToRgba(hex);
      lut.set(`${r},${g},${b}`, hexToRgba(RV_SCHEME7[i]));
    });
  }
  return lut;
}
const LUT = buildLut();

// Exported for tests. Mutates the RGBA byte array in place.
export function recolorRadarImageData(data) {
  let mapped = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;                       // transparent stays transparent
    const t = LUT.get(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    if (!t) continue;                                      // unknown color: fail-open, keep it
    data[i] = t[0]; data[i + 1] = t[1]; data[i + 2] = t[2]; data[i + 3] = t[3];
    mapped++;
  }
  return mapped;
}

// LIGHTNING WHITE-HOT (2026-07-06, "lightning appears as heatmap coloring"): industry practice
// (WeatherBug Spark, Blitzortung, RadarOmega) renders strikes as BRIGHT WHITE flashes — newest
// brightest — never as a color-ramp density heatmap. nowCOAST's LDN style paints a 17-color
// yellow→red→magenta density ramp (tile-sampled 2026-07-06); every detected pixel is remapped
// to hot white with alpha ranked by that ramp so cores read as the brightest flash centers.
// The strobe itself is the layer-opacity flicker in MapWebGL (bursts + decay).
export function whitenLightningImageData(data) {
  let mapped = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Rank density from the warm ramp: pale yellow (low) → red/magenta (high). Cool outliers
    // (blue/green classes in the LDN style) land mid-high. 0..1 scalar from simple channel cues.
    let rank;
    if (r >= 250 && g >= 250) rank = 0.25;             // pale yellow / yellow — low density
    else if (r >= 250 && g >= 120) rank = 0.5;         // gold / amber
    else if (r >= 250) rank = 0.8;                     // orange / red / magenta family
    else if (r >= 120) rank = 0.9;                     // dark red / purple
    else rank = 0.7;                                   // cool outliers — mid-high
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 240;
    data[i + 3] = Math.round(140 + 115 * rank);        // 0.55..1.0 alpha — white-hot core pops
    mapped++;
  }
  return mapped;
}

export const LIGHTNING_FLASH_PROTOCOL = 'ltg-flash';

// STRIKE-POINT EXTRACTION (2026-07-07, "the lightning bolts look terrible"): the industry look
// (Windy's live lightning tracker, Ventusky, Blitzortung — all point-fed) is INDIVIDUAL white
// flashes at strike locations, not a raster wash. Our public feed is a density raster, but the
// protocol handler already decodes every tile AND the tile URL carries its real EPSG:3857 bbox —
// so density CORES are extracted as geo-points here and MapWebGL renders per-point flash
// animations (glow + core circles, independent random phases). Grid-binned local maxima keep it
// to ≤ ~40 points/tile; the registry prunes by age so frame changes retire old strikes.
const MERC_R = 20037508.342789244;
const _strikeRegistry = new Map();   // tileUrl → { points: [{lng,lat,intensity}], ts }
const STRIKE_TTL_MS = 90 * 1000;

export function extractLightningStrikes(data, w, h, bbox) {
  // bbox = [west, south, east, north] in EPSG:3857 meters. Bin 16px, keep the strongest
  // detected pixel per bin at intensity ≥ 0.45 (gold and hotter — cores, not fringe).
  const BIN = 16;
  const best = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] === 0) continue;
      const r = data[i], g = data[i + 1];
      let rank;
      if (r >= 250 && g >= 250) rank = 0.25;
      else if (r >= 250 && g >= 120) rank = 0.5;
      else if (r >= 250) rank = 0.8;
      else if (r >= 120) rank = 0.9;
      else rank = 0.7;
      if (rank < 0.45) continue;
      const key = ((y / BIN) | 0) * 1024 + ((x / BIN) | 0);
      const prev = best.get(key);
      if (!prev || rank > prev.rank) best.set(key, { x, y, rank });
    }
  }
  const [wst, sth, est, nth] = bbox;
  const pts = [];
  for (const { x, y, rank } of best.values()) {
    const mx = wst + ((x + 0.5) / w) * (est - wst);
    const my = nth - ((y + 0.5) / h) * (nth - sth);
    const lng = (mx / MERC_R) * 180;
    const lat = (Math.atan(Math.sinh((my / MERC_R) * Math.PI)) * 180) / Math.PI;
    pts.push({ lng, lat, intensity: rank });
    if (pts.length >= 40) break;
  }
  return pts;
}

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

function makeRecolorHandler(transform) {
  return async (params) => {
    // Tile URLs are '<scheme>://https://...' — strip only the custom scheme prefix.
    const httpsUrl = params.url.replace(/^[a-z-]+:\/\/(?=https:\/\/)/, '');
    const w = typeof window !== 'undefined' ? window : {};
    const cacheOn = w.__RAW_RADAR_TILE_CACHE_OFF__ !== true;
    const tel = w.__RAW_RADAR_TILE_CACHE__ || (w.__RAW_RADAR_TILE_CACHE__ = { hits: 0, misses: 0 });
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
        const canvas = typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(bitmap.width, bitmap.height)
          : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        transform(img.data, bitmap.width, bitmap.height, httpsUrl);
        ctx.putImageData(img, 0, 0);
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

let _registered = false;
export function registerRadarRecolorProtocol() {
  if (_registered || !maplibregl?.addProtocol) return;
  _registered = true;
  maplibregl.addProtocol(RADAR_RECOLOR_PROTOCOL, makeRecolorHandler(recolorRadarImageData));
  maplibregl.addProtocol(LIGHTNING_FLASH_PROTOCOL, makeRecolorHandler(lightningTransform));
  // Published as window globals for MapWebGL's flash renderer (avoids adding another
  // maplibre-gl-importing edge into the heavy MapPage chunk).
  if (typeof window !== 'undefined') {
    window.__LTG_STRIKES__ = getLightningStrikePoints;
    window.__LTG_REFRESH__ = refreshViewportStrikes;
  }
}

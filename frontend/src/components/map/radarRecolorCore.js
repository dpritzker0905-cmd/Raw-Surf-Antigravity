/**
 * radarRecolorCore.js — the radar tiles' pixel transforms, with no DOM, no canvas and no maplibre import, so the SAME code runs on
 * the main thread (radarTileRecolor's protocol handlers) and in radarAdvectWorker.js (2026-11-12). Moved verbatim from
 * radarTileRecolor.js, which re-exports every name: HRRR ptype ramps -> RainViewer scheme 7, the DWD nearest-anchor recolor, the
 * lightning white-hot remap and the strike-core extraction. Each transform mutates an RGBA byte array in place.
 */
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
// ⚠️ GROUND-TRUTH PALETTE (2026-07-07 v3, user-caught TWICE): rainviewer.com's published
// color-table page does NOT describe what their tile server actually renders — real scheme-7
// tiles (sampled live over the GA storms: tilecache …/7/1_0.png) draw light precip as an
// OPAQUE DARK-BLUE→BLUE→CYAN ramp (the "cloud cover" areas), then yellow→amber cores. Two
// documentation-derived attempts (SELEX rainbow, then a teal fringe) both failed the eyeball
// because the doc palette ≠ the rendered palette. These 22 steps are the OBSERVED tile colors,
// darkest-blue at 0 dBZ through the sampled yellows/ambers, red extrapolated for the 50+ cap.
// NEVER re-derive this from the color-schemes page — sample a real tile.
const RV_SCHEME7 = [
  '#004768ff', '#004a70ff', '#004e78ff', '#005180ff', '#005588ff', '#005b8eff',
  '#006295ff', '#00699cff', '#0070a3ff', '#0077aaff', '#007fb4ff', '#0088bfff',
  '#0091caff', '#009ad5ff', '#00a3e0ff', '#1baee2ff', '#6cd1ebff', '#ffee00ff',
  '#ffd200ff', '#ffaa00ff', '#ff7800ff', '#e30b0fff',
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

// DWD/EU FORECAST PALETTE PARITY (2026-07-07): the EU forecast feeds (dwd:Radar_wn-product /
// Radar_rv_product) render their OWN intensity ramp — light cyan → green → yellow-green → yellow
// → amber → orange → magenta(hail) — plus a semi-transparent gray (#7e7e7e a≈128) that is the
// radar SCAN-COVERAGE mask, not precip. Crossing "now" that jumped palette families the same way
// HRRR did in CONUS. Unlike IEM's indexed tiles, DWD tiles are ANTIALIASED (live sample: ~190
// distinct colors around ~12 anchors — §1j predicted an exact-match LUT would not transfer), so
// this is a NEAREST-MATCH: each opaque pixel snaps to the closest anchor by RGB distance and is
// repainted with that anchor's RainViewer scheme-7 color; the coverage gray drops to transparent.
// Anchors + intensity order tile-sampled 2026-07-07 (maps.dwd.de WN/RV over Germany). NEVER
// re-derive from docs — these are observed tile colors. The index is into RV_SCHEME7 (0..21).
const DWD_ANCHORS = [
  [0x99, 0xff, 0xff, 2],   // palest cyan  — lightest
  [0x33, 0xff, 0xff, 4],   // cyan
  [0x00, 0xca, 0xca, 6],   // dark cyan
  [0x1a, 0xcc, 0x9a, 8],   // RV teal-green
  [0x00, 0x99, 0x34, 9],   // green
  [0x4d, 0xbf, 0x1a, 11],  // bright green (≈#4db31b)
  [0x99, 0xcc, 0x00, 13],  // yellow-green
  [0xcc, 0xe6, 0x00, 15],  // chartreuse
  [0xff, 0xff, 0x00, 17],  // yellow
  [0xff, 0xc4, 0x00, 18],  // amber
  [0xff, 0x89, 0x00, 20],  // orange
  [0xfb, 0x00, 0xff, 21],  // magenta / hail — heaviest
];
const _dwdCache = new Map();   // packed rgb → scheme-7 RGBA (or null = drop to transparent)

// Mutates the RGBA byte array in place. Low-saturation pixels (the gray scan-coverage mask and
// its antialiased edges) are cleared; everything else snaps to the nearest DWD anchor's scheme-7
// color. Memoized per unique color (tiles carry a few hundred at most).
export function recolorDwdImageData(data) {
  let mapped = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = (r << 16) | (g << 8) | b;
    let out = _dwdCache.get(key);
    if (out === undefined) {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn < 30) {
        out = null;                                        // scan-coverage gray → transparent
      } else {
        let bi = 0, bd = Infinity;
        for (let a = 0; a < DWD_ANCHORS.length; a++) {
          const A = DWD_ANCHORS[a];
          const d = (r - A[0]) * (r - A[0]) + (g - A[1]) * (g - A[1]) + (b - A[2]) * (b - A[2]);
          if (d < bd) { bd = d; bi = a; }
        }
        out = hexToRgba(RV_SCHEME7[DWD_ANCHORS[bi][3]]);
      }
      _dwdCache.set(key, out);
    }
    if (out === null) { data[i + 3] = 0; continue; }
    data[i] = out[0]; data[i + 1] = out[1]; data[i + 2] = out[2]; data[i + 3] = out[3];
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

export const MERC_R = 20037508.342789244;
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

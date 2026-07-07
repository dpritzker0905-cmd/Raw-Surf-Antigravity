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
const RV_SCHEME7 = [
  '#00000000', '#00000000', '#00000000', '#00000000', '#009f9fff', '#00977dff',
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

let _registered = false;
export function registerRadarRecolorProtocol() {
  if (_registered || !maplibregl?.addProtocol) return;
  _registered = true;
  maplibregl.addProtocol(RADAR_RECOLOR_PROTOCOL, async (params) => {
    const httpsUrl = params.url.replace(`${RADAR_RECOLOR_PROTOCOL}://`, '');
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
      recolorRadarImageData(img.data);
      ctx.putImageData(img, 0, 0);
      const blob = canvas.convertToBlob
        ? await canvas.convertToBlob({ type: 'image/png' })
        : await new Promise((res) => canvas.toBlob(res, 'image/png'));
      return { data: await blob.arrayBuffer() };
    } catch (e) {
      return { data: buf };   // decode/canvas failure: serve the original tile (native palette)
    }
  });
}

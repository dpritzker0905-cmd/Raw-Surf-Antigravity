/**
 * Wind bench, MAP mode page (bundled by ../build.js as map.js; never part of the app).
 *
 * The owner's real basemaps (Mapbox navigation-day-v1 / outdoors-v11 / navigation-night-v1 in MapLibre, as the app loads
 * them), the REAL WebGLWindEngine as a custom layer at the app's slot (windLayerBeforeId: under borders and labels) with
 * the app's coastline line above it, fed a SERVED wind grid (fixtures/, 2026-10-09 15Z Gulf) over a 2-deg world base.
 *
 * window.__MAP_BENCH__.shoot(cfg) renders one camera in three modes from the same tiles and the same particle seed:
 *   off   - the basemap alone (wind layer skipped);
 *   field - the colour field alone (a 2x2 particle pool);
 *   full  - the field and the desktop particle pool, scored at 5 moments 0.2 s apart (medians);
 * and returns, for land and water separately, at CSS-pixel scale, over the basemap's own EDGE pixels (roads, coasts,
 * rivers, label strokes; gradient >= 0.04 on the wind-off frame), each scored between ITS OWN line and ground pixels:
 *   retain   - mean share of each line's bare-basemap L* contrast kept; lost = share of lines under half;
 *   wcag     - share of the lines at >= 3:1 on the bare basemap that keep 3:1 (WCAG 1.4.11);
 *   gs       - gradient similarity to the bare basemap (GMSD's map, Xue et al. 2014, mean-pooled), a cross-check;
 *   sal      - mean |dL*| the particles add over the field alone (their visual signal; over all pixels);
 *   cover    - share of pixels the particles move by more than 5 L* (their footprint).
 * Instrument choice: research_notes/Wind particle close zoom legibility/legibility_clutter_metrics.md.
 * The Mapbox token is injected by the runner (window.__MAPBOX_TOKEN__), never written to disk.
 */
const maplibregl = require('maplibre-gl');
const EngineModule = require('wind-bench-engine');
const { windLayerBeforeId, windCoastlineLayer } = require('wind-bench-utils');
const { gridFromFixture, worldBase } = require('../eye');
const { mulberry32 } = require('../scanner');
const { resolveThemeRamp, sampleRamp } = require('wind-bench-ramp');
const { syncWindBasemapMute } = require('wind-bench-mute');
const { labTable, binOf, binImage, binMask, stylePalette, frameMetrics, coastMetrics, colourEdges, warpDiff, hueFidelity, labOf } = require('../ambiguity');
const { sampleSpeed } = require('../field');
const { latOf, mercY, TILE_PX } = require('../camera');
// The colour parser always comes from the working tree (a --ref build may predate it); it only reads the style.
const { parseColor } = require('../../../src/components/map/windBasemapMute');

const Engine = EngineModule.default || EngineModule.WebGLWindEngine || EngineModule;
const CSS_W = 897, CSS_H = 914, DPR = 2, FRAME_MS = 1000 / 60, THUMB = 448;
const STYLES = { light: 'navigation-day-v1', beach: 'outdoors-v11', dark: 'navigation-night-v1' };
const WIND_ID = 'bench-wind';
const realNow = performance.now.bind(performance);
const realRandom = Math.random;

const token = () => window.__MAPBOX_TOKEN__ || '';
function transformRequest(url) {   // mirrors mapUtils.mapboxTransformRequest (the app's resolver)
  if (!url || !url.startsWith('mapbox://')) return { url };
  const t = 'access_token=' + token();
  if (url.startsWith('mapbox://styles/')) return { url: url.replace('mapbox://styles/', 'https://api.mapbox.com/styles/v1/') + '?' + t };
  if (url.startsWith('mapbox://tiles/')) return { url: url.replace('mapbox://tiles/', 'https://api.mapbox.com/v4/') + '?' + t };
  if (url.startsWith('mapbox://sprites/')) {
    const m = url.match(/mapbox:\/\/sprites\/(.+?)((?:@\d+x)?\.(?:json|png))$/);
    return { url: m ? `https://api.mapbox.com/styles/v1/${m[1]}/sprite${m[2]}?${t}` : url.replace('mapbox://sprites/', 'https://api.mapbox.com/styles/v1/') + '/sprite?' + t };
  }
  if (url.startsWith('mapbox://fonts/')) return { url: url.replace('mapbox://fonts/', 'https://api.mapbox.com/fonts/v1/') + '?' + t };
  return { url: url.replace('mapbox://', 'https://api.mapbox.com/v4/') + '.json?secure&' + t };
}

let GRIDS = null;
const state = { map: null, theme: null, gl: null, engine: null, active: false, res: 384, levers: {} };

function clearLevers() { Object.keys(window).filter((k) => k.startsWith('__RAW_')).forEach((k) => { delete window[k]; }); }

function windLayer() {
  return {
    id: WIND_ID, type: 'custom', renderingMode: '2d',
    onAdd(_m, gl) { state.gl = gl; },
    render(gl, args) {
      if (!state.active || !state.engine) return;
      const matrix = (args && args.length >= 16) ? args : (args.defaultProjectionData?.mainMatrix || args.mercatorMatrix || args.mainMatrix);
      const map = state.map, b = map.getBounds(), c = map.getCanvas();
      state.engine.render(gl, matrix, c.width, c.height, map.getZoom(), state.theme, [0], [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    },
    onRemove() {},
  };
}

const once = (map, ev) => new Promise((resolve) => map.once(ev, resolve));
async function idle(map) { if (!map.loaded() || !map.areTilesLoaded()) await once(map, 'idle'); map.triggerRepaint(); await once(map, 'idle'); }

async function ensureMap(theme) {
  if (state.map && state.theme === theme) return state.map;
  if (state.map) { disposeEngine(); state.map.remove(); state.map = null; }
  state.theme = theme;
  const map = new maplibregl.Map({
    container: 'map', style: `mapbox://styles/mapbox/${STYLES[theme]}`, transformRequest, center: [-88, 30.5], zoom: 6,
    pixelRatio: DPR, fadeDuration: 0, interactive: false, attributionControl: false,
    canvasContextAttributes: { antialias: false, preserveDrawingBuffer: true },
  });
  state.map = map;
  await once(map, 'load');
  // Paint changes land at once (MapLibre fades them over 300 ms by default, and the virtual clock stands still while a
  // sample is captured: the water mask and the unmuted reference would otherwise be read mid-fade). Bench only.
  map.style.stylesheet.transition = { duration: 0, delay: 0 };
  const layers = map.getStyle().layers;
  map.addLayer(windLayer(), windLayerBeforeId(layers, theme, {}));
  const coast = windCoastlineLayer(layers, theme, true, {});
  if (coast) map.addLayer(coast, windLayerBeforeId(layers, theme, {}));
  if (!state.bare) addAppStack(map, layers);
  return map;
}

// THE APP'S STACK (MapWebGL.js; pinned in windBasemapMute.test.js). The app keeps a satellite photo and 18 weather-wash
// slots MOUNTED AND HIDDEN under the wind layer, and draws radar frames above it. The first path bench drew the basemap
// alone, so a mute that stood down for any raster layer passed here and never ran in the app (live dev, 2026-10-09: the
// read-back said layers 0). Hidden layers load no tiles; the frame above the wind is a clear 1x1 tile at opacity 0.01, so
// no pixel changes. `--bare` (init { bare }) gives the old instrument.
const CLEAR_TILE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const APP_WASHES = ['rain', 'satellite', 'pressure', 'temperature', 'water_temp', 'fog'];
function addAppStack(map, layers) {
  const raster = (id, layout, opacity, before) => {
    map.addSource(`${id}-source`, { type: 'raster', tiles: [CLEAR_TILE], tileSize: 256 });
    map.addLayer({ id, type: 'raster', source: `${id}-source`, layout, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 } }, before);
  };
  const ground = layers.find((l) => l.id === 'landcover' || l.id === 'water');
  raster('esri-satellite-layer', { visibility: 'none' }, 1, ground && ground.id);
  for (const k of APP_WASHES) for (const s of [0, 1, 2]) raster(`${k}-slot-${s}-layer`, { visibility: 'none' }, 0, WIND_ID);
  raster('bench-radar-frame', {}, 0.01, undefined);
}

function disposeEngine() {
  if (state.engine && state.gl) state.engine.dispose(state.gl);
  state.engine = null;
}

function newEngine(res, seed) {
  disposeEngine();
  Math.random = mulberry32(seed);
  const e = new Engine();
  e.particleRes = res;
  e.init(state.gl);
  e.setWindData(state.gl, GRIDS.world);
  e.setWindData(state.gl, GRIDS.fine);
  state.engine = e;
}

function readCanvas(map) {
  const gl = state.gl, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { px, W, H };
}

function thumb(map) {
  const t = document.createElement('canvas');
  t.width = THUMB; t.height = Math.round(THUMB * CSS_H / CSS_W);
  t.getContext('2d').drawImage(map.getCanvas(), 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.82);
}

/** Render `frames` engine frames on a virtual 60 Hz clock, then read the canvas back. */
async function animate(map, frames) {
  let vms = realNow();
  performance.now = () => vms;
  try {
    for (let i = 0; i <= frames; i++) {
      vms += FRAME_MS;
      map.triggerRepaint();
      await once(map, 'render');
    }
    return { ...readCanvas(map), shot: thumb(map) };
  } finally { delete performance.now; }
}

/** Water mask from the style itself: everything hidden but the 'water' fill, painted white. */
async function waterMask(map) {
  const layers = map.getStyle().layers, saved = [];
  for (const l of layers) {
    if (l.id === 'water') continue;
    saved.push([l.id, map.getLayoutProperty(l.id, 'visibility') || 'visible']);
    map.setLayoutProperty(l.id, 'visibility', 'none');
  }
  const fc = map.getPaintProperty('water', 'fill-color'), fo = map.getPaintProperty('water', 'fill-opacity');
  map.setPaintProperty('water', 'fill-color', '#ffffff');
  map.setPaintProperty('water', 'fill-opacity', 1);
  await idle(map);
  const { px, W, H } = readCanvas(map);
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = px[i * 4] > 128 ? 1 : 0;
  map.setPaintProperty('water', 'fill-color', fc);
  map.setPaintProperty('water', 'fill-opacity', fo === undefined ? 1 : fo);
  for (const [id, v] of saved) map.setLayoutProperty(id, 'visibility', v);
  await idle(map);
  return mask;
}

const SRGB = new Float32Array(256).map((_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });

/**
 * One frame at CSS-pixel scale (2x2 device-pixel box average, as the metrics literature advises scoring at the viewing
 * scale): encoded luma 0-1 (gradients), relative luminance Y (WCAG contrast), L* (particle signal).
 */
function cssImage(px, W, H) {
  const w = Math.floor(W / DPR), h = Math.floor(H / DPR), n = w * h, q = DPR * DPR;
  const luma = new Float32Array(n), Y = new Float32Array(n), L = new Float32Array(n);
  const lin = (c) => SRGB[Math.min(255, Math.round(c))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < DPR; j++) for (let k = 0; k < DPR; k++) { const p = ((y * DPR + j) * W + x * DPR + k) * 4; r += px[p]; g += px[p + 1]; b += px[p + 2]; }
      const R = r / q, G = g / q, B = b / q, i = y * w + x;
      luma[i] = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
      Y[i] = 0.2126729 * lin(R) + 0.7151522 * lin(G) + 0.072175 * lin(B);
      L[i] = Y[i] > 216 / 24389 ? 116 * Math.cbrt(Y[i]) - 16 : (24389 / 27) * Y[i];
    }
  }
  return { w, h, luma, Y, L };
}
function cssMask(mask, W, H) {
  const w = Math.floor(W / DPR), h = Math.floor(H / DPR), m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = mask[(y * DPR) * W + x * DPR];
  return m;
}

/** Prewitt gradient magnitude of a 0-1 image (GMSD's operator). */
function gradient(a, w, h) {
  const g = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (a[i - w + 1] + a[i + 1] + a[i + w + 1] - a[i - w - 1] - a[i - 1] - a[i + w - 1]) / 3;
      const gy = (a[i + w - 1] + a[i + w] + a[i + w + 1] - a[i - w - 1] - a[i - w] - a[i - w + 1]) / 3;
      g[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return g;
}

const EDGE_G = 0.04, GS_C = 0.0026, WCAG = 3;
const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };

/**
 * The basemap's EDGE pixels: gradient >= EDGE_G on the wind-off frame (roads, coasts, rivers, label strokes). Each is
 * paired with the darkest and brightest pixel of its 5x5 neighbourhood ON THE BARE BASEMAP: the line and its ground.
 * Scoring those same two pixels afterwards measures that line's own contrast; a 5x5 min/max taken after compositing
 * would credit a particle's bright ring or dark rim as "contrast" (the first version of this instrument did, and read
 * lines as MORE legible under particles).
 */
function edgeSet(off, mask) {
  const { w, h, luma, L } = off, g = gradient(luma, w, h), idx = [], lo = [], hi = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (g[i] < EDGE_G) continue;
      let a = i, b = i;
      for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) { const q = i + j * w + k; if (L[q] < L[a]) a = q; if (L[q] > L[b]) b = q; }
      if (L[b] - L[a] < 3) continue;                          // not a visible line on the bare basemap
      idx.push(i); lo.push(a); hi.push(b);
    }
  }
  return { idx: Int32Array.from(idx), lo: Int32Array.from(lo), hi: Int32Array.from(hi), g, wet: Uint8Array.from(idx, (i) => mask[i]) };
}
const ratio = (Y, a, b) => (Y[b] + 0.05) / (Y[a] + 0.05);

/**
 * How much of the basemap's line work survives in `img`, per surface [land, water], over the edge pixels:
 *   retain - mean of each line's own L* contrast (its ground pixel minus its line pixel, as on the bare basemap) over the
 *            bare basemap's (the real-map twin of land-run.js's `retain`); lost = share of lines under half;
 *   wcag   - share of the lines at >= 3:1 on the bare basemap that keep >= 3:1 between the same two pixels (WCAG 1.4.11);
 *   gs     - mean gradient similarity (2 g0 g + c) / (g0^2 + g^2 + c) (GMSD's similarity map, mean-pooled), a check
 *            that is blind to whether an edge belongs to the map or to a mark.
 */
function lineSurvival(off, img, edges) {
  const out = [], gi = gradient(img.luma, img.w, img.h);
  for (const surf of [0, 1]) {
    let n = 0, gsSum = 0, retSum = 0, lost = 0, base3 = 0, kept3 = 0;
    for (let k = 0; k < edges.idx.length; k++) {
      if (edges.wet[k] !== surf) continue;
      const i = edges.idx[k], a = edges.lo[k], b = edges.hi[k], g0 = edges.g[i], g1 = gi[i];
      n++;
      gsSum += (2 * g0 * g1 + GS_C) / (g0 * g0 + g1 * g1 + GS_C);
      const r = (img.L[b] - img.L[a]) / (off.L[b] - off.L[a]);
      retSum += r; if (r < 0.5) lost++;
      if (ratio(off.Y, a, b) >= WCAG) { base3++; if (ratio(img.Y, a, b) >= WCAG) kept3++; }
    }
    out.push({ retain: n ? retSum / n : null, lost: n ? lost / n : null, gs: n ? gsSum / n : null, wcag: base3 ? kept3 / base3 : null, edges: n, base3 });
  }
  return out;
}

/** Mean |dL*| the particles add over the field alone, and the share of pixels they move by more than 5 L*. */
function particleSignal(full, field, mask) {
  const acc = [[0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < full.L.length; i++) { const d = Math.abs(full.L[i] - field.L[i]), s = acc[mask[i]]; s[0] += d; if (d > 5) s[1]++; s[2]++; }
  return acc.map((s) => ({ sal: s[0] / Math.max(s[2], 1), cover: s[1] / Math.max(s[2], 1) }));
}

const SAMPLES = 5, SAMPLE_GAP = 12;   // the full layer is scored at 5 moments 0.2 s apart; medians are reported

/** cfg: {theme, z, lng, lat, frames, res, seed, levers}. Returns metrics plus three thumbnails. */
async function shoot(cfg) {
  const map = await ensureMap(cfg.theme);
  map.jumpTo({ center: [cfg.lng, cfg.lat], zoom: cfg.z });
  state.active = false;
  await idle(map);
  const maskDev = await waterMask(map);
  const offRaw = await animate(map, 0);
  clearLevers(); Object.assign(window, cfg.levers || {});
  try {
    state.active = true;
    newEngine(2, cfg.seed);
    const fieldRaw = await animate(map, cfg.frames);
    const { W, H } = offRaw, mask = cssMask(maskDev, W, H);
    const off = cssImage(offRaw.px, W, H), field = cssImage(fieldRaw.px, W, H), edges = edgeSet(off, mask);
    const fieldLines = lineSurvival(off, field, edges);
    newEngine(cfg.res, cfg.seed);
    let fullRaw = await animate(map, cfg.frames);
    const shotFull = fullRaw.shot, samples = [];
    for (let s = 0; s < SAMPLES; s++) {
      if (s) fullRaw = await animate(map, SAMPLE_GAP);
      const full = cssImage(fullRaw.px, W, H);
      samples.push({ lines: lineSurvival(off, full, edges), sig: particleSignal(full, field, mask) });
    }
    state.active = false;
    disposeEngine();
    const r = (x, d = 4) => (x == null ? null : +x.toFixed(d));
    const surf = (k) => {
      const med = (f) => median(samples.map(f));
      return {
        field: { retain: r(fieldLines[k].retain), lost: r(fieldLines[k].lost), gs: r(fieldLines[k].gs), wcag: r(fieldLines[k].wcag) },
        full: { retain: r(med((x) => x.lines[k].retain)), lost: r(med((x) => x.lines[k].lost)), gs: r(med((x) => x.lines[k].gs)), wcag: r(med((x) => x.lines[k].wcag)) },
        sal: r(med((x) => x.sig[k].sal), 3), cover: r(med((x) => x.sig[k].cover)),
        edges: fieldLines[k].edges, edges3: fieldLines[k].base3,
      };
    };
    let wet = 0; for (let i = 0; i < mask.length; i++) wet += mask[i];
    return {
      theme: cfg.theme, z: cfg.z, waterShare: +(wet / mask.length).toFixed(3), land: surf(0), water: surf(1),
      glError: state.gl.getError() || 0, shots: { off: offRaw.shot, field: fieldRaw.shot, full: shotFull },
    };
  } finally {
    Math.random = realRandom;
    clearLevers();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// PATH mode (2026-10-09): the camera moves along a scripted path (../paths.js) at a virtual 60 Hz; at each sampled frame
// the same camera is captured three or four ways without advancing the engine: map + wind, the map alone as shown
// (`off`; muted when the basemap mute is on), the ORIGINAL map (when muted), and a water mask (paint-only, so no tile
// reload between them). ../ambiguity.js scores each pair.

const LUT = labTable();
const ANALYSIS = 4;   // device px per analysis px: half CSS scale at DPR 2

/** The legend's wind colours, 3-75 kn every knot (calm is deliberately "nothing" and excluded). */
function legendBins(theme) {
  const ramp = resolveThemeRamp(theme), out = new Set();
  for (let v = 3; v <= 75; v++) { const c = sampleRamp(ramp, v); out.add(binOf(Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255))); }
  return [...out];
}

const OPACITY_PROPS = { fill: ['fill-opacity'], line: ['line-opacity'], symbol: ['text-opacity', 'icon-opacity'], 'fill-extrusion': ['fill-extrusion-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'], raster: ['raster-opacity'], heatmap: ['heatmap-opacity'], hillshade: ['hillshade-exaggeration'] };

function smallShot(map, width = 300) {
  const t = document.createElement('canvas');
  t.width = width; t.height = Math.round(width * CSS_H / CSS_W);
  t.getContext('2d').drawImage(map.getCanvas(), 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.8);
}

const camOf = (f) => ({ center: [f.lng, f.lat], zoom: f.z });

/** The served speed (kn) under every analysis pixel (row 0 = screen bottom): the fine grid inside it, else the world base. */
function speedsAt(cam, w, h) {
  const k = 1 / (TILE_PX * Math.pow(2, cam.z)), cx = (cam.lng + 180) / 360, cy = mercY(cam.lat), px = ANALYSIS / DPR, out = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    const lat = latOf(cy + (CSS_H / 2 - (r + 0.5) * px) * k);
    for (let x = 0; x < w; x++) {
      const lng = (cx + ((x + 0.5) * px - CSS_W / 2) * k) * 360 - 180, v = sampleSpeed(GRIDS.fine, lng, lat);
      out[r * w + x] = v == null ? (sampleSpeed(GRIDS.world, lng, lat) ?? NaN) : v;
    }
  }
  return out;
}
/** The legend colour (Lab) at speed v, tabulated every 0.25 kn. */
function legendLab(theme) {
  const ramp = resolveThemeRamp(theme), tab = [];
  for (let v = 0; v <= 80; v += 0.25) { const c = sampleRamp(ramp, v); tab.push(labOf(...c.slice(0, 3).map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255)))); }
  return (v) => tab[Math.max(0, Math.min(tab.length - 1, Math.round(v * 4)))];
}

const maxNumber = (v) => (typeof v === 'number' ? v : Array.isArray(v) ? Math.max(-Infinity, ...v.map(maxNumber)) : (v && typeof v === 'object') ? Math.max(-Infinity, ...Object.values(v).map(maxNumber)) : -Infinity);
/**
 * The ORIGINAL style's area colours under the wind (fill and background colour literals, every class and zoom stop),
 * labelled by layer id: the viewer's convention for this map. Faint layers (opacity <= 0.5, e.g. hillshade) never show
 * their literal colour and are left out.
 */
function styleColours(map) {
  const out = [], layers = map.getStyle().layers, end = layers.findIndex((l) => l.id === WIND_ID);
  const walk = (v, label) => {
    if (typeof v === 'string') { const c = parseColor(v); if (c && c[3] > 0.5) out.push({ rgb: c.slice(0, 3), label }); } else if (Array.isArray(v)) v.forEach((x) => walk(x, label)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, label));
  };
  for (const l of layers.slice(0, end >= 0 ? end : layers.length)) {
    if (!l.paint || (l.type !== 'fill' && l.type !== 'background')) continue;
    const op = l.paint[l.type === 'fill' ? 'fill-opacity' : 'background-opacity'];
    if (op !== undefined && maxNumber(op) <= 0.5) continue;
    walk(l.paint[l.type === 'fill' ? 'fill-color' : 'background-color'], l.id);
  }
  return stylePalette(out);
}

/**
 * The original map's line work at one camera, kept compactly for lineSurvivalFrom: each edge's line and ground pixel
 * values (L*, Y) and gradient, instead of the whole frame (a path holds ~70 of these).
 */
function lineRef(origCss, maskCss) {
  const e = edgeSet(origCss, maskCss), n = e.idx.length;
  const ref = { idx: e.idx, lo: e.lo, hi: e.hi, wet: e.wet, g0: new Float32Array(n), La: new Float32Array(n), Lb: new Float32Array(n), Ya: new Float32Array(n), Yb: new Float32Array(n) };
  for (let k = 0; k < n; k++) { ref.g0[k] = e.g[e.idx[k]]; ref.La[k] = origCss.L[e.lo[k]]; ref.Lb[k] = origCss.L[e.hi[k]]; ref.Ya[k] = origCss.Y[e.lo[k]]; ref.Yb[k] = origCss.Y[e.hi[k]]; }
  return ref;
}
/** lineSurvival against a lineRef: [land, water] retain (each line's own L* contrast kept) and lost (< half). */
function lineSurvivalFrom(ref, img) {
  const out = [];
  for (const surf of [0, 1]) {
    let n = 0, retSum = 0, lost = 0;
    for (let k = 0; k < ref.idx.length; k++) {
      if (ref.wet[k] !== surf) continue;
      n++;
      const r = (img.L[ref.hi[k]] - img.L[ref.lo[k]]) / (ref.Lb[k] - ref.La[k]);
      retSum += r; if (r < 0.5) lost++;
    }
    out.push({ retain: n ? retSum / n : null, lost: n ? lost / n : null });
  }
  return out;
}

/** Water mask by paint alone, then wait for the map to settle (data-driven paint re-parses its tiles), then restore. */
async function settledWaterMask(map) {
  const saved = [], set = (id, prop, v) => { saved.push([id, prop, map.getPaintProperty(id, prop)]); map.setPaintProperty(id, prop, v); };
  for (const l of map.getStyle().layers) {
    if (l.type === 'custom') continue;
    if (l.id === 'water') { set(l.id, 'fill-color', '#ffffff'); set(l.id, 'fill-opacity', 1); continue; }
    if (l.type === 'background') { set(l.id, 'background-color', '#000000'); set(l.id, 'background-opacity', 1); continue; }
    for (const prop of OPACITY_PROPS[l.type] || []) set(l.id, prop, 0);
  }
  await idle(map);
  const { px, W, H } = readCanvas(map), mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = px[i * 4] > 128 ? 1 : 0;
  for (let k = saved.length - 1; k >= 0; k--) map.setPaintProperty(saved[k][0], saved[k][1], saved[k][2]);
  await idle(map);
  return mask;
}

/**
 * cfg: {theme, frames: [{lng, lat, z}], samples: [frame index], res, seed, levers, warm, shots, shotWidth, fieldOnly}.
 *
 * Two passes, so that no paint change ever happens mid-path (data-driven paint makes MapLibre re-parse tiles
 * asynchronously, and a toggle per sample corrupted the frames after it):
 *   1. at rest, wind off, basemap NOT muted, at every sample camera: the original map, its water mask and its line
 *      work (this also warms the tile cache for pass 2);
 *   2. the basemap mute as the app would set it (then settle), the engine warmed, the path flown at a virtual 60 Hz;
 *      at each sample the same camera twice without advancing the engine: map + wind, and the map alone as shown.
 * Per sample: the ambiguity metrics (frame palette and the style's own colours), hue fidelity, coast separation,
 * colour-edge survival (map as shown vs the original; map + wind vs the original), L* line survival on land and water
 * against the original, and whether every tile had loaded. fieldOnly draws a 2x2 particle pool (the colour field alone,
 * as map-run's 'field' frame) and adds the exact-camera warp difference to the previous sample, wind and map alone.
 */
async function pathRun(cfg) {
  const map = await ensureMap(cfg.theme), theme = cfg.theme, S = new Set(cfg.samples);
  state.active = false;
  clearLevers(); Object.assign(window, cfg.levers || {});
  syncWindBasemapMute(map, theme, false, WIND_ID);
  await idle(map);
  const stylePal = styleColours(map), ref = new Map();
  for (const i of cfg.samples) {
    map.jumpTo(camOf(cfg.frames[i])); await idle(map);
    const o = readCanvas(map), maskDev = await settledWaterMask(map), oCss = cssImage(o.px, o.W, o.H);
    ref.set(i, { orig: binImage(o.px, o.W, o.H, ANALYSIS), wet: binMask(maskDev, o.W, o.H, ANALYSIS), lines: lineRef(oCss, cssMask(maskDev, o.W, o.H)) });
  }
  const legend = legendBins(theme), legendAt = legendLab(theme), rows = [];
  map.jumpTo(camOf(cfg.frames[0]));
  const mute = syncWindBasemapMute(map, theme, true, WIND_ID);
  await idle(map);
  state.active = true;
  newEngine(cfg.fieldOnly ? 2 : cfg.res, cfg.seed);
  const geom = { cssW: CSS_W, cssH: CSS_H, px: ANALYSIS / DPR };
  let prev = null;
  let vms = realNow();
  performance.now = () => vms;
  const frame = async () => { map.triggerRepaint(); await once(map, 'render'); };
  try {
    for (let i = 0; i < (cfg.warm || 120); i++) { vms += FRAME_MS; await frame(); }
    for (let i = 0; i < cfg.frames.length; i++) {
      map.jumpTo(camOf(cfg.frames[i]));
      vms += FRAME_MS;
      await frame();
      if (!S.has(i)) continue;
      const tiles = map.areTilesLoaded(), compRaw = readCanvas(map), shot = cfg.shots ? smallShot(map, cfg.shotWidth) : null;
      state.active = false;
      await frame();                                    // same camera, wind layer skipped, clock not advanced
      const offRaw = readCanvas(map);
      state.active = true;
      const { orig, wet, lines: lref } = ref.get(i), { W, H } = compRaw;
      const comp = binImage(compRaw.px, W, H, ANALYSIS), off = binImage(offRaw.px, W, H, ANALYSIS), cam = cfg.frames[i];
      const fm = frameMetrics({ off, comp, orig, wet, legendBins: legend, stylePal, lut: LUT });
      const ce = colourEdges(orig, [off, comp], LUT), coast = coastMetrics(orig, comp, wet, LUT);
      const hue = hueFidelity(comp, speedsAt(cam, comp.w, comp.h), legendAt, LUT);
      const lines = lineSurvivalFrom(lref, cssImage(compRaw.px, W, H));
      let warp = null;
      if (cfg.fieldOnly && prev) {
        const wc = warpDiff(prev.comp, prev.cam, comp, cam, geom, LUT), wo = warpDiff(prev.off, prev.cam, off, cam, geom, LUT);
        warp = { comp: wc.mean, compP99: wc.p99, comp5: wc.over5, off: wo.mean, offP99: wo.p99, off5: wo.over5, n: wc.n };
      }
      if (cfg.fieldOnly) prev = { comp, off, cam };
      const r = (x, d = 4) => (x == null ? null : +x.toFixed(d));
      rows.push({ i, z: cfg.frames[i].z, tiles, ink: r(fm.ink, 2), cover: r(fm.cover), mapLike: r(fm.mapLike), mapLikeConv: r(fm.mapLikeConv), windLike: r(fm.windLike),
        chroma: r(fm.chroma, 2), pairs: fm.pairs, convPairs: fm.convPairs, keptMap: r(ce.kept[0]), keptComp: r(ce.kept[1]), colourEdges: ce.edges,
        coastDE0: r(coast.coastDE0, 2), coastDE: r(coast.coastDE, 2), coastKept: r(coast.coastKept), coastN: coast.n, hueMed: r(hue.med, 1), hue30: r(hue.over30),
        retLand: r(lines[0].retain), retWater: r(lines[1].retain),
        warp: warp && Object.fromEntries(Object.entries(warp).map(([k, v]) => [k, r(v, 3)])), shot });
    }
    return { theme, mute, stylePal: stylePal.length, rows, glError: state.gl.getError() || 0 };
  } finally {
    delete performance.now;
    state.active = false;
    disposeEngine();
    syncWindBasemapMute(map, theme, false, WIND_ID);
    Math.random = realRandom;
    clearLevers();
  }
}

/**
 * Round trip of the basemap mute on the real style: the map before muting vs after mute + restore (same camera, wind
 * off). A restore that misses a property shows here. Returns the mean and max dE00 and the share of pixels > 1 dE00.
 */
async function muteRoundTrip(cfg) {
  const map = await ensureMap(cfg.theme);
  state.active = false;
  clearLevers(); Object.assign(window, cfg.levers || {});
  syncWindBasemapMute(map, cfg.theme, false, WIND_ID);
  map.jumpTo(camOf(cfg)); await idle(map);
  const a = readCanvas(map);
  const mute = syncWindBasemapMute(map, cfg.theme, true, WIND_ID);
  await idle(map);                                      // data-driven paint re-parses its tiles: wait for it
  const m = readCanvas(map);
  syncWindBasemapMute(map, cfg.theme, false, WIND_ID);
  await idle(map);
  const b = readCanvas(map);
  clearLevers();
  const A = binImage(a.px, a.W, a.H, ANALYSIS), B = binImage(b.px, b.W, b.H, ANALYSIS), M = binImage(m.px, m.W, m.H, ANALYSIS);
  let sum = 0, max = 0, over = 0, moved = 0;
  for (let i = 0; i < A.bins.length; i++) { const d = LUT.de(A.bins[i], B.bins[i]); sum += d; max = Math.max(max, d); if (d > 1) over++; if (LUT.de(A.bins[i], M.bins[i]) > 1) moved++; }
  return { mute, mean: sum / A.bins.length, max, over1: over / A.bins.length, mutedMoved: moved / A.bins.length, tiles: map.areTilesLoaded() };
}

/**
 * The mute against imagery on the real map and the real library (the app's stack is needed): the wind on, muted; the
 * satellite photo shown under the wind, as the app shows it (the layer's visibility) -> stale, and the sync stands down
 * with the original colours back; hidden again -> stale, muted again. Returns each step's read-back.
 */
async function muteImagery(cfg) {
  const map = await ensureMap(cfg.theme), mod = require('wind-bench-mute');
  if (!map.getLayer('esri-satellite-layer')) throw new Error('muteImagery needs the app stack (not --bare)');
  const stale = () => (mod.windBasemapMuteStale ? mod.windBasemapMuteStale(map, cfg.theme, true, WIND_ID) : null);
  state.active = false;
  clearLevers();
  syncWindBasemapMute(map, cfg.theme, false, WIND_ID);
  map.jumpTo(camOf(cfg)); await idle(map);
  const a = readCanvas(map), staleOff = stale(), on = syncWindBasemapMute(map, cfg.theme, true, WIND_ID), staleOn = stale();
  map.setLayoutProperty('esri-satellite-layer', 'visibility', 'visible');
  const staleShown = stale(), shown = syncWindBasemapMute(map, cfg.theme, true, WIND_ID);
  await idle(map);
  const b = readCanvas(map);
  map.setLayoutProperty('esri-satellite-layer', 'visibility', 'none');
  const staleHidden = stale(), hidden = syncWindBasemapMute(map, cfg.theme, true, WIND_ID);
  syncWindBasemapMute(map, cfg.theme, false, WIND_ID);
  await idle(map);
  const A = binImage(a.px, a.W, a.H, ANALYSIS), B = binImage(b.px, b.W, b.H, ANALYSIS);
  let max = 0;
  for (let i = 0; i < A.bins.length; i++) max = Math.max(max, LUT.de(A.bins[i], B.bins[i]));
  return { staleOff, on, staleOn, staleShown, shown, shownMaxDE: max, staleHidden, hidden };
}

/** fixtures: {fine, scale}. scale multiplies u and v (1 = as served; 2.3 puts Mobile Bay's median at ~30 kn, the owner's case). */
function init(fixtures) {
  state.bare = fixtures.bare === true;
  const k = fixtures.scale || 1, fx = { ...fixtures.fine, u: fixtures.fine.u.map((u) => u * k), v: fixtures.fine.v.map((v) => v * k) };
  const fine = gridFromFixture(fx, 'served_fine');
  GRIDS = { fine, world: worldBase([fine]) };
  return { fine: `${fine.cols}x${fine.rows}`, bounds: fixtures.fine.bounds };
}

window.__MAP_BENCH__ = { ready: true, init, shoot, pathRun, muteRoundTrip, muteImagery, maplibre: maplibregl.getVersion ? maplibregl.getVersion() : maplibregl.version };
document.getElementById('status').textContent = 'ready';

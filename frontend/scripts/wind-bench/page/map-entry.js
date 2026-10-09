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
  const layers = map.getStyle().layers;
  map.addLayer(windLayer(), windLayerBeforeId(layers, theme, {}));
  const coast = windCoastlineLayer(layers, theme, true, {});
  if (coast) map.addLayer(coast, windLayerBeforeId(layers, theme, {}));
  return map;
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

/** fixtures: {fine, scale}. scale multiplies u and v (1 = as served; 2.3 puts Mobile Bay's median at ~30 kn, the owner's case). */
function init(fixtures) {
  const k = fixtures.scale || 1, fx = { ...fixtures.fine, u: fixtures.fine.u.map((u) => u * k), v: fixtures.fine.v.map((v) => v * k) };
  const fine = gridFromFixture(fx, 'served_fine');
  GRIDS = { fine, world: worldBase([fine]) };
  return { fine: `${fine.cols}x${fine.rows}`, bounds: fixtures.fine.bounds };
}

window.__MAP_BENCH__ = { ready: true, init, shoot, maplibre: maplibregl.getVersion ? maplibregl.getVersion() : maplibregl.version };
document.getElementById('status').textContent = 'ready';

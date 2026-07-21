/**
 * haloDebugOverlay.js — permanent, toggleable coastal land-bleed diagnostic (2026-07-21).
 *
 * WHY: eyeballing a screenshot can't tell "green over the reef (water, correct)" from "green on the
 * thin Key Largo coast (a real mask bleed)". This overlay paints the truth directly on the map:
 *   • WHITE  = the basemap's own coastline (queryRenderedFeatures on the `water` fill = ground truth)
 *   • RED    = the marine ocean-mask reads WATER on a true-LAND pixel (the genuine bleed source —
 *              this is where the heatmap actually renders on land; it uses the GPU mask read-back
 *              WebGLMarineEngine.probeMaskGPU, so it is immune to the basemap's own teal/park fills
 *              that fooled a naive framebuffer-colour classifier).
 *   • ORANGE = mask feather zone (partial land, 0.25–0.5) — the soft coastal transition.
 *
 * Inert until armed (house style, matches maskFloodProbe.js). Turn on/off from the dev console:
 *   __HALO_DEBUG__.start()     // paint + auto-refresh on moveend/zoomend
 *   __HALO_DEBUG__.stop()      // remove
 *   __HALO_DEBUG__.toggle()
 *   __HALO_DEBUG__.refresh()   // one manual repaint (returns {z, coast, realBleed, feather})
 *   __HALO_DEBUG__.opts        // { cols, rows, waterThresh, featherThresh } — tweak live
 * Keyboard: Ctrl+Alt+H toggles it. A red pixel that persists on visibly-dry land at a settled view
 * is a real bleed; red that vanishes by z13–14 is a mask-resolution artifact of the basemap's coarse
 * water tiles at that zoom (see the 2026-07-21 Pennekamp forensics).
 */

const OPTS = { cols: 70, rows: 52, waterThresh: 128, featherThresh: 64 };

function waterLayerIds(map) {
  try {
    const style = map.getStyle();
    const bw = style.layers.find((l) => l.id === 'water');
    if (!bw) return ['water'];
    const ids = style.layers
      .filter((l) => l.type === 'fill' && l.source === bw.source && l['source-layer'] === bw['source-layer'])
      .map((l) => l.id);
    return ids.length ? ids : ['water'];
  } catch (e) { return ['water']; }
}

let _cv = null, _throttle = 0, _onMove = null, _armed = false;

function container() { const m = window.map; return m && m.getContainer ? m.getContainer() : null; }

function ensureCanvas() {
  const cont = container();
  if (!cont) return null;
  if (_cv && _cv.parentNode === cont) return _cv;
  _cv = document.getElementById('__halo_dbg_canvas__');
  if (!_cv) {
    _cv = document.createElement('canvas');
    _cv.id = '__halo_dbg_canvas__';
    _cv.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:9999';
    cont.appendChild(_cv);
  }
  return _cv;
}

export function refresh() {
  const m = window.map, eng = window.__MARINE_ENGINE__;
  if (!m || !eng || typeof eng.probeMaskGPU !== 'function') return { err: 'no map / engine.probeMaskGPU (toggle a marine layer on first)' };
  const cv = ensureCanvas();
  if (!cv) return { err: 'no map container' };
  const cont = container();
  const dpr = window.devicePixelRatio || 1;
  const w = cont.clientWidth, h = cont.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const ids = waterLayerIds(m);
  const cols = OPTS.cols, rows = OPTS.rows;
  let b; try { b = m.getBounds(); } catch (e) { return { err: 'no bounds' }; }
  const N = cols * rows;
  const waterFlag = new Array(N), gpx = new Array(N), pts = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lng = b.getWest() + (b.getEast() - b.getWest()) * (c + 0.5) / cols;
    const lat = b.getSouth() + (b.getNorth() - b.getSouth()) * (r + 0.5) / rows;
    const px = m.project([lng, lat]);
    const k = r * cols + c;
    let water = false;
    try { water = (m.queryRenderedFeatures([px.x, px.y], { layers: ids }) || []).length > 0; } catch (e) {}
    waterFlag[k] = water; gpx[k] = { x: px.x, y: px.y }; pts.push({ lng, lat });
  }
  let mv = [];
  try { mv = eng.probeMaskGPU(pts) || []; } catch (e) { return { err: 'probeMaskGPU threw: ' + e.message }; }

  // SDF-AWARE: when the coast SDF is live, RED must reflect what the SHADER renders (the .b distance
  // thresholded at the erosion offset), NOT the unchanged binary .r mask — else the tool shows bleed
  // where the SDF has already eliminated it. Legacy path (no SDF) reads .r effective >= 128.
  const sdfOn = !!eng._cachedMaskHasSDF && (typeof window === 'undefined' || window.__RAW_DISABLE_COAST_SDF__ !== true);
  const erode = (typeof window !== 'undefined' && Number(window.__RAW_COAST_ERODE__)) || 0;
  const sdfWaterCut = 127.5 + 255 * erode; // .b at/above this renders as water

  let coast = 0, realBleed = 0, feather = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = r * cols + c;
    if (waterFlag[k]) continue;
    const g = gpx[k];
    const nb = [k - 1, k + 1, k - cols, k + cols].some((j) => j >= 0 && j < N && waterFlag[j]);
    if (nb) { coast++; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(g.x, g.y, 1.5, 0, 7); ctx.fill(); }
    const s = mv[k]; if (!s) continue;
    const useSDF = sdfOn && s.effB != null;
    const val = useSDF ? s.effB : s.effective;
    const cut = useSDF ? sdfWaterCut : OPTS.waterThresh;
    if (val == null) continue;
    if (val >= cut) { realBleed++; ctx.fillStyle = 'rgba(255,30,30,0.95)'; ctx.beginPath(); ctx.arc(g.x, g.y, 3.4, 0, 7); ctx.fill(); }
    else if (val >= cut - (useSDF ? 8 : (OPTS.waterThresh - OPTS.featherThresh))) { feather++; ctx.fillStyle = 'rgba(255,170,0,0.85)'; ctx.beginPath(); ctx.arc(g.x, g.y, 2.3, 0, 7); ctx.fill(); }
  }
  ctx.font = '12px sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(6, 6, 372, 60);
  ctx.fillStyle = '#fff'; ctx.fillText('HALO DEBUG' + (sdfOn ? ' [SDF erode=' + erode + ']' : ' [legacy]') + ' — white = true coast', 14, 22);
  ctx.fillStyle = '#ff3030'; ctx.fillText('RED = renders WATER on true land (bleed) = ' + realBleed, 14, 40);
  ctx.fillStyle = '#ffaa00'; ctx.fillText('orange = near-coast band = ' + feather + '   (z ' + (+m.getZoom().toFixed(2)) + ')', 14, 56);
  const stats = { z: +m.getZoom().toFixed(2), coast, realBleed, feather, sdfOn, erode };
  window.__HALO_DBG_STATS__ = stats;
  return stats;
}

export function start() {
  const m = window.map;
  if (!m) return { err: 'no window.map yet' };
  if (_armed) { refresh(); return { on: true, already: true }; }
  _armed = true;
  _onMove = () => { clearTimeout(_throttle); _throttle = setTimeout(() => { if (_armed) refresh(); }, 350); };
  m.on('moveend', _onMove); m.on('zoomend', _onMove);
  refresh();
  return { on: true };
}

export function stop() {
  const m = window.map;
  if (m && _onMove) { try { m.off('moveend', _onMove); m.off('zoomend', _onMove); } catch (e) {} }
  _onMove = null; _armed = false;
  if (_cv && _cv.parentNode) _cv.parentNode.removeChild(_cv);
  _cv = null;
  return { on: false };
}

export function toggle() { return _armed ? stop() : start(); }
export function isOn() { return _armed; }

if (typeof window !== 'undefined') {
  window.__HALO_DEBUG__ = { start, stop, toggle, refresh, isOn, opts: OPTS };
  // Ctrl+Alt+H toggles (registered once; dev convenience — no effect until pressed).
  if (!window.__HALO_DEBUG_KEY__) {
    window.__HALO_DEBUG_KEY__ = true;
    try {
      window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.altKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); toggle(); }
      });
    } catch (e) { /* no window listener (SSR) */ }
  }
}

/**
 * maskFloodProbe.js — objective, repeatable diagnostic for the marine ocean-mask (2026-07-07).
 *
 * WHY: eyeballing single screenshots at one zoom can't (a) measure land-flood objectively,
 * (b) catch the mask flicker/oscillation over time, or (c) sweep the zoom range. This harness
 * scores the ACTUAL rendered mask (via WebGLMarineEngine.probeMaskGPU — a GPU read-back of the
 * live texture the shader samples) against Natural-Earth ground truth over a grid across the
 * viewport, and can sweep zooms + sample over time.
 *
 * GROUND TRUTH = the same NE land GeoJSON the mask is built from (engine._cachedMaskGeoJSON):
 * point-in-polygon says land/water authoritatively at the scale that matters (NE only drops
 * sub-~200 m cays, sub-pixel at these zooms). FLOOD = an NE-LAND grid point whose rendered mask
 * reads WATER (heatmap eligible). OVERMASK = an NE-WATER point the mask reads LAND.
 *
 * Console API (dev):
 *   __MASK_PROBE__.scoreFlood()        → { z, land, water, floodPct, overmaskPct, floodSample }
 *   await __MASK_PROBE__.sweep([4..12])→ per-zoom rows (jumps the map, waits for idle each stop)
 *   await __MASK_PROBE__.flicker(6)    → { samples, min, max, spread, glitchy } at the current view
 *   await __MASK_PROBE__.ab()          → floodPct with the island re-assert ON vs OFF (same view)
 *   __MASK_PROBE__.regions.bahamas / .keys / .greece / .indonesia → recenter helpers
 */

const norm = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

function bboxOf(feature) {
  if (feature._bbox) return feature._bbox;
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  const scan = (ring) => { for (const p of ring) { if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0]; if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1]; } };
  const g = feature.geometry;
  if (!g) { feature._bbox = { west: 0, east: 0, south: 0, north: 0 }; return feature._bbox; }
  if (g.type === 'Polygon') g.coordinates.forEach(scan);
  else if (g.type === 'MultiPolygon') g.coordinates.forEach((poly) => poly.forEach(scan));
  feature._bbox = { west: w, east: e, south: s, north: n };
  return feature._bbox;
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pointInPolygon(lng, lat, rings) {   // rings[0] = outer, rings[1..] = holes
  if (!rings.length || !pointInRing(lng, lat, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) if (pointInRing(lng, lat, rings[h])) return false;
  return true;
}

export function neIsLand(lng, lat, geo) {
  if (!geo || !geo.features) return false;
  const L = norm(lng);
  for (const f of geo.features) {
    const b = bboxOf(f);
    if (lat < b.south || lat > b.north || L < b.west || L > b.east) continue;
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : null);
    if (!polys) continue;
    for (const poly of polys) if (pointInPolygon(L, lat, poly)) return true;
  }
  return false;
}

function grid(cols, rows) {
  const m = window.map, b = m.getBounds();
  const W = b.getWest(), E = b.getEast(), S = b.getSouth(), N = b.getNorth();
  const pts = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    pts.push({ lng: W + (E - W) * (c + 0.5) / cols, lat: S + (N - S) * (r + 0.5) / rows });
  }
  return pts;
}

export function scoreFlood(opts = {}) {
  const m = window.map, eng = window.__MARINE_ENGINE__;
  if (!m || !eng || typeof eng.probeMaskGPU !== 'function') return { err: 'no map/engine' };
  const geo = eng._cachedMaskGeoJSON;
  if (!geo) return { err: 'no mask geojson (toggle a marine layer on first)' };
  const pts = grid(opts.cols || 28, opts.rows || 20);
  const probed = eng.probeMaskGPU(pts) || [];
  let land = 0, water = 0, flood = 0, overmask = 0;
  const floodPts = [];
  for (let i = 0; i < pts.length; i++) {
    const mv = probed[i] && probed[i].effective;
    if (mv == null) continue;
    const isLand = neIsLand(pts[i].lng, pts[i].lat, geo);
    const maskWater = mv >= 128;
    if (isLand) { land++; if (maskWater) { flood++; if (floodPts.length < 10) floodPts.push({ lng: +pts[i].lng.toFixed(2), lat: +pts[i].lat.toFixed(2), v: mv, src: probed[i].src }); } }
    else { water++; if (!maskWater) overmask++; }
  }
  const g = window.__RAW_GPU__ || {};
  return {
    z: +m.getZoom().toFixed(2),
    center: [+m.getCenter().lng.toFixed(2), +m.getCenter().lat.toFixed(2)],
    land, water,
    floodPct: land ? +(100 * flood / land).toFixed(1) : 0,
    overmaskPct: water ? +(100 * overmask / water).toFixed(1) : 0,
    overlay: g.overlayMask ? { on: g.overlayMask.on, replace: g.overlayMask.replace } : null,
    islandReassert: g.islandReassert,
    floodSample: floodPts,
  };
}

function idle(m, ms) {
  return new Promise((res) => {
    let done = false;
    const finish = () => { if (!done) { done = true; setTimeout(res, 700); } }; // +700ms for the mask repaint after idle
    const t = setTimeout(() => { if (!done) { done = true; res(); } }, ms);
    m.once('idle', () => { clearTimeout(t); finish(); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait until the resident mask actually COVERS the current viewport (a fresh fetch has committed)
// so a sweep stop measures loaded data, not the previous zoom's stale tile.
function waitForCoverage(m, eng, ms) {
  const start = Date.now();
  return new Promise((res) => {
    const check = () => {
      let covered = false;
      try {
        const b = m.getBounds(), mb = eng._cachedMaskBounds;
        covered = mb && mb.west <= b.getWest() + 0.05 && mb.east >= b.getEast() - 0.05 && mb.south <= b.getSouth() + 0.05 && mb.north >= b.getNorth() - 0.05;
      } catch (e) {}
      if ((covered && eng._waveData) || Date.now() - start > ms) { setTimeout(res, 600); return; }
      setTimeout(check, 250);
    };
    check();
  });
}

// VISUAL zoom-sweep — the primary "does it hold at every zoom" tool. At each zoom it recenters,
// waits for data to load, then scores the REAL visual flood (crest+wash on basemap-land) plus the
// mask flood. Restores your starting zoom at the end. Kill the crest/mask fixes via their window
// switches to A/B a whole sweep.
export async function sweepVisual(zlist = [5, 6, 7, 8, 9, 10, 11, 12], opts = {}) {
  const m = window.map, eng = window.__MARINE_ENGINE__;
  if (!m || !eng) return { err: 'no map/engine' };
  const c = m.getCenter(), z0 = m.getZoom();
  const rows = [];
  for (const z of zlist) {
    try { m.stop(); } catch (e) {}
    m.easeTo({ center: c, zoom: z, duration: 500 });
    await waitForCoverage(m, eng, 4500);
    const vis = await scoreVisual(opts);
    const g = window.__RAW_GPU__ || {};
    rows.push({ z: vis.z, landPts: vis.landPts, visualFloodPct: vis.visualFloodPct, crestOrWash: vis.marineOnLand, island: g.islandReassert ? (g.islandReassert.applied ? 'on' : g.islandReassert.reason) : '-', overlay: g.overlayMask ? (g.overlayMask.on + '/' + g.overlayMask.replace) : '-' });
  }
  try { m.stop(); } catch (e) {} m.easeTo({ center: c, zoom: z0, duration: 400 });
  console.table(rows);
  return rows;
}

export async function sweep(zlist = [4, 5, 6, 7, 8, 9, 10, 11, 12], opts = {}) {
  const m = window.map; if (!m) return { err: 'no map' };
  const c = m.getCenter();
  const rows = [];
  for (const z of zlist) {
    try { m.stop(); } catch (e) {}
    m.jumpTo({ center: c, zoom: z });
    await idle(m, 3000);
    rows.push(scoreFlood(opts));
  }
  console.table(rows.map((r) => ({ z: r.z, land: r.land, floodPct: r.floodPct, overmaskPct: r.overmaskPct, overlay: r.overlay && `${r.overlay.on}/${r.overlay.replace}`, island: r.islandReassert && (r.islandReassert.applied ? r.islandReassert.landFrac : r.islandReassert.reason) })));
  return rows;
}

export async function flicker(seconds = 6, hz = 4, opts = {}) {
  const n = Math.max(2, Math.round(seconds * hz));
  const s = [];
  for (let i = 0; i < n; i++) { const r = scoreFlood(opts); s.push(r.floodPct != null ? r.floodPct : -1); await sleep(1000 / hz); }
  const mn = Math.min(...s), mx = Math.max(...s), mean = +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1);
  return { samples: s, min: mn, max: mx, mean, spread: +(mx - mn).toFixed(1), glitchy: (mx - mn) > 4 };
}

// A/B the island re-assert at the CURRENT view: score OFF, force a mask rebuild, score ON.
export async function ab(opts = {}) {
  const m = window.map;
  const forceRebuild = async () => { try { m.stop(); } catch (e) {} m.panBy([30, 0], { duration: 200 }); await sleep(600); m.panBy([-30, 0], { duration: 200 }); await idle(m, 2500); };
  window.__RAW_DISABLE_ISLAND_REASSERT__ = true; await forceRebuild(); const off = scoreFlood(opts);
  window.__RAW_DISABLE_ISLAND_REASSERT__ = false; await forceRebuild(); const on = scoreFlood(opts);
  return { off: { floodPct: off.floodPct, overmaskPct: off.overmaskPct }, on: { floodPct: on.floodPct, overmaskPct: on.overmaskPct }, z: on.z };
}

// ── VISUAL score (what the eye sees): read the COMPOSITED framebuffer at basemap-land pixels and
// count marine colour (crest streaks + wash) — the mask-only score misses crests entirely. ─────
function waterLayerIds() {
  const style = window.map.getStyle();
  const bw = style.layers.find((l) => l.id === 'water');
  if (!bw) return [];
  return style.layers.filter((l) => l.type === 'fill' && l.source === bw.source && l['source-layer'] === bw['source-layer']).map((l) => l.id);
}
// Ask the engine's render pass to sample the composited framebuffer at these screen points.
export async function probeScreen(screenPts, tries = 3) {
  const eng = window.__MARINE_ENGINE__, m = window.map;
  if (!eng || !m) return null;
  eng._screenProbeResult = null;
  for (let t = 0; t < tries; t++) {
    eng._screenProbeRequest = screenPts;
    try { m.triggerRepaint(); } catch (e) {}
    await sleep(120 + t * 90);
    if (eng._screenProbeResult) return eng._screenProbeResult;
  }
  return eng._screenProbeResult;
}
// Marine colour = saturated (teal→green→yellow→magenta ramp) OR a bright crest/foam streak; land
// under the basemap is dark and desaturated. Tunable via window.__MASK_PROBE_SAT__/_VAL_.
function isMarineColor(rgba) {
  if (!rgba) return null;
  const r = rgba[0], g = rgba[1], b = rgba[2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const satT = (typeof window !== 'undefined' && +window.__MASK_PROBE_SAT__) || 38;
  const valT = (typeof window !== 'undefined' && +window.__MASK_PROBE_VAL__) || 145;
  return (mx - mn) > satT || mx > valT;
}
export async function scoreVisual(opts = {}) {
  const m = window.map, eng = window.__MARINE_ENGINE__;
  if (!m || !eng) return { err: 'no map/engine' };
  const ids = waterLayerIds();
  const b = m.getBounds(), cols = opts.cols || 48, rows = opts.rows || 36;
  const pts = [], screen = [], onLandFlag = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lng = b.getWest() + (b.getEast() - b.getWest()) * (c + 0.5) / cols;
    const lat = b.getSouth() + (b.getNorth() - b.getSouth()) * (r + 0.5) / rows;
    const px = m.project([lng, lat]);
    const water = (m.queryRenderedFeatures([px.x, px.y], { layers: ids }) || []).length > 0;
    pts.push({ lng, lat }); screen.push({ x: px.x, y: px.y }); onLandFlag.push(!water);
  }
  const cols_ = await probeScreen(screen) || [];
  let land = 0, onland = 0; const sample = [];
  for (let i = 0; i < pts.length; i++) {
    if (!onLandFlag[i]) continue;
    const mm = isMarineColor(cols_[i]);
    if (mm == null) continue;
    land++;
    if (mm) { onland++; if (sample.length < 14) sample.push({ lng: +pts[i].lng.toFixed(3), lat: +pts[i].lat.toFixed(3), rgba: cols_[i] }); }
  }
  return { z: +m.getZoom().toFixed(2), center: [+m.getCenter().lng.toFixed(2), +m.getCenter().lat.toFixed(2)], landPts: land, marineOnLand: onland, visualFloodPct: land ? +(100 * onland / land).toFixed(1) : 0, sample };
}
// Calibrate the classifier: sample rgba at explicit lng/lat you know are marine-water vs inland-land.
export async function calibVisual(marineWater, inlandLand) {
  const m = window.map;
  const scr = [marineWater, inlandLand].map((p) => { const px = m.project(p); return { x: px.x, y: px.y }; });
  const res = await probeScreen(scr) || [];
  return { marineWater: { at: marineWater, rgba: res[0], marine: isMarineColor(res[0]) }, inlandLand: { at: inlandLand, rgba: res[1], marine: isMarineColor(res[1]) } };
}

const regions = {
  bahamas: () => window.map.jumpTo({ center: [-77.9, 24.6], zoom: 7 }),
  keys: () => window.map.jumpTo({ center: [-81.2, 24.8], zoom: 8 }),
  caribbean: () => window.map.jumpTo({ center: [-73, 19], zoom: 6 }),
  greece: () => window.map.jumpTo({ center: [25.0, 37.5], zoom: 7 }),
  indonesia: () => window.map.jumpTo({ center: [117, -3], zoom: 6 }),
};

if (typeof window !== 'undefined') {
  window.__MASK_PROBE__ = { scoreFlood, scoreVisual, calibVisual, probeScreen, sweep, sweepVisual, flicker, ab, grid, regions, neIsLand: (lng, lat) => { const g = window.__MARINE_ENGINE__ && window.__MARINE_ENGINE__._cachedMaskGeoJSON; return g ? neIsLand(lng, lat, g) : null; } };
}

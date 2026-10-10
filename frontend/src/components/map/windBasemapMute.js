/**
 * BASEMAP MUTE UNDER THE WIND (2026-10-09, owner: "there is still some ambiguity to the wind color vs the color of the map
 * in light mode and beach modes").
 *
 * Light and beach draw the wind field as a per-channel MULTIPLY tint over the basemap, so every colour on screen is the
 * wind's hue times the map's hue: beach's 6-16 kn aqua-greens over its tan land come out vegetation green, light's
 * 16-21 kn sage over its cyan water comes out a teal sea, and the coast land takes the same green as the water beside it.
 * The map seems to change colour; it does not read as a wind layer. A multiply leaves the ground's contrast ratios
 * unchanged, which the eye reads as lighting or as the surface's own colour rather than as a layer (Singh & Anderson
 * 2002; research_notes/Wind overlay basemap colour separation/).
 * The leaders take hue out of the ground and keep it for the data. Mapbox's own wind-particle example runs on Standard's
 * 'monochrome' theme; MapTiler draws weather on its Dataviz style and veils the water; Esri's Light Gray Canvas exists for
 * this; earth.nullschool draws coastlines only.
 *
 * While the wind is on, this lowers the chroma of the basemap's AREA colours under the wind layer (fills, background,
 * extrusions, hillshade, and the water's own lines) in OKLab, keeping each colour's lightness. Land and water still
 * differ by lightness (plus the wind's coastline stroke), and the wind's hue is the only hue left on the ground. Borders,
 * labels and roads are not touched: roads are thin and carry the map's navigation colour, and borders and labels sit
 * above the wind. Satellite is not touched either: a style with imagery under the wind keeps its photo. The palette, the field, the particles and every served number are unchanged. Off again when the wind is
 * off; a theme change loads a fresh style, and the layer re-applies it.
 *
 * THE APP'S STACK (2026-10-09, live dev read { applied: true, layers: 0 }: nothing had ever been muted). The first build
 * stood down for ANY raster layer in the style, and the app keeps a satellite photo and 18 weather-wash slots mounted and
 * HIDDEN under the wind (MapWebGL.js); the path bench drew the basemap alone and never met them. getStyle() also leaves
 * custom layers out, so the wind layer's own slot was never found and "under the wind" meant the whole style. Now: only a
 * raster SHOWING under the wind (visible, opacity not 0) is imagery; the slot comes from the style's draw order; the ocean
 * mask's own layers are left to OceanMask; and the layer re-syncs when imagery appears or goes (windBasemapMuteStale).
 *
 * Read-back: window.__WIND_BASEMAP_MUTE__ = { applied, layers, amount, waterL, theme, at, reason? } after every sync;
 * applied is true only when layers > 0, and reason names the imagery that stood it down ('imagery:<layer id>').
 * Lever: window.__RAW_WIND_BASEMAP_MUTE__ (0-1, the share of chroma removed, any theme).
 * Kill: window.__RAW_DISABLE_WIND_BASEMAP_MUTE__ (the map keeps its own colours under the wind).
 */
export const WIND_BASEMAP_MUTE = Object.freeze({ amount: Object.freeze({ light: 0.85, beach: 0.85 }), waterL: Object.freeze({ light: 0.9, beach: 0.94 }) });

/** OKLab lightness factor for the water's own colours while muted (1 = as is; < 1 darker water, the coast's cue). */
export function windBasemapWaterL(theme, win = (typeof window !== 'undefined' ? window : null)) {
  const lev = (win || {}).__RAW_WIND_BASEMAP_WATER_L__;
  if (typeof lev === 'number' && lev >= 0.5 && lev <= 1.2) return lev;
  return WIND_BASEMAP_MUTE.waterL[theme] || 1;
}

/** Share of chroma to remove under the wind for this theme (0 = off). */
export function windBasemapMuteAmount(theme, win = (typeof window !== 'undefined' ? window : null)) {
  const w = win || {};
  if (w.__RAW_DISABLE_WIND_BASEMAP_MUTE__ === true) return 0;
  const lev = w.__RAW_WIND_BASEMAP_MUTE__;
  if (typeof lev === 'number' && lev >= 0 && lev <= 1) return lev;
  return WIND_BASEMAP_MUTE.amount[theme] || 0;
}

const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };
const num = (s, pct, scale) => { const v = parseFloat(s); return pct.test(s) ? v / 100 * scale : v; };

/** [r, g, b, a] (0-255, alpha 0-1) of a CSS colour string the styles use (hex, rgb[a], hsl[a], three names); else null. */
export function parseColor(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s].slice();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) return [...h].map((c, i) => (i < 3 ? parseInt(c + c, 16) : parseInt(c + c, 16) / 255)).concat(h.length === 3 ? [1] : []);
    if (h.length === 6 || h.length === 8) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat([h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1]);
    return null;
  }
  m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (!m) return null;
  const parts = m[2].split(/\s*,\s*|\s+/).filter(Boolean), pct = /%$/;
  if (parts.length < 3) return null;
  const a = parts.length > 3 ? num(parts[3], pct, 1) : 1;
  if (m[1].startsWith('rgb')) return [num(parts[0], pct, 255), num(parts[1], pct, 255), num(parts[2], pct, 255), a];
  const H = (((parseFloat(parts[0]) % 360) + 360) % 360) / 360, S = parseFloat(parts[1]) / 100, L = parseFloat(parts[2]) / 100;
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q;
  const ch = (t) => { t = (t + 1) % 1; return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p); };
  return [ch(H + 1 / 3), ch(H), ch(H - 1 / 3), a];
}

const toLin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const toSrgb = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** OKLab (Ottosson 2020) of an sRGB triple, and back. */
export function oklab([r, g, b]) {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
export function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  return lin.map((v) => Math.max(0, Math.min(255, toSrgb(Math.max(0, Math.min(1, v))))));
}

/**
 * The colour with `amount` of its OKLab chroma removed and its OKLab lightness times `lScale` (alpha kept), as an rgba()
 * string; anything that is not a colour comes back as is.
 */
export function muteColor(str, amount, lScale = 1) {
  const c = parseColor(str);
  if (!c || !(amount > 0)) return str;
  const [L, a, b] = oklab(c), k = 1 - Math.min(1, amount), out = fromOklab([Math.min(1, L * lScale), a * k, b * k]).map((v) => Math.round(v));
  return `rgba(${out[0]}, ${out[1]}, ${out[2]}, ${+c[3].toFixed(3)})`;
}

/** A paint value (literal, expression array or legacy {stops} function) with every colour literal muted. */
export function muteValue(value, amount, lScale = 1) {
  if (typeof value === 'string') return muteColor(value, amount, lScale);
  if (Array.isArray(value)) return value.map((v) => muteValue(v, amount, lScale));
  if (value && typeof value === 'object') { const o = {}; for (const k of Object.keys(value)) o[k] = muteValue(value[k], amount, lScale); return o; }
  return value;
}

const AREA_COLOR_PROPS = {
  background: ['background-color'], fill: ['fill-color', 'fill-outline-color'], 'fill-extrusion': ['fill-extrusion-color'],
  hillshade: ['hillshade-shadow-color', 'hillshade-highlight-color', 'hillshade-accent-color'],
};

// OceanMask.js repaints land and inland water in the theme's colours on its own sync, and shows them only while a marine
// layer is on: its layers are left to it (muting them here would be undone, or copied, by that sync).
const APP_OWNED = /^ocean-mask-/;
/** A raster layer that is on screen: visible, and not parked at opacity 0 (how the app holds its idle weather slots). */
const showing = (l) => !!l && l.type === 'raster' && (l.layout || {}).visibility !== 'none' && (l.paint || {})['raster-opacity'] !== 0;
const belowWind = (layers, windId) => { const end = layers.findIndex((l) => l && l.id === windId); return end >= 0 ? layers.slice(0, end) : layers; };

/** The id of the first raster layer SHOWING under the wind layer (a satellite photo, a weather wash), or null. */
export function windBasemapImagery(layers, windId) {
  const hit = Array.isArray(layers) ? belowWind(layers, windId).find(showing) : null;
  return hit ? hit.id : null;
}

/**
 * The paint changes for one style: every area colour of the layers BELOW the wind layer (before `windId` in the order;
 * the whole list when it is absent), plus the colours of line layers named water* (rivers and the water's own outlines).
 * Layers named water* also take `waterL` on their lightness. With imagery showing under the wind (windBasemapImagery)
 * the style is left alone: the photo is the map. [{ id, prop, from, to }] for properties the style sets.
 */
export function windBasemapMutePlan(layers, windId, amount, waterL = 1) {
  if (!Array.isArray(layers) || !(amount > 0) || windBasemapImagery(layers, windId)) return [];
  const plan = [];
  for (const l of belowWind(layers, windId)) {
    if (!l || !l.paint || APP_OWNED.test(l.id)) continue;
    const props = AREA_COLOR_PROPS[l.type] || (l.type === 'line' && /^water/.test(l.id) ? ['line-color'] : []);
    for (const prop of props) {
      if (l.paint[prop] === undefined) continue;
      const to = muteValue(l.paint[prop], amount, /^water/.test(l.id) ? waterL : 1);
      if (JSON.stringify(to) !== JSON.stringify(l.paint[prop])) plan.push({ id: l.id, prop, from: l.paint[prop], to });
    }
  }
  return plan;
}

const APPLIED = typeof WeakMap !== 'undefined' ? new WeakMap() : null;   // map -> { theme, amount, waterL, plan, layers }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Mute (active) or restore (inactive) the basemap under the wind layer `windId`. Idempotent. The record is kept per MAP
 * and checked against the live paint before anything is restored: a theme change may load a new style or diff the new
 * one into the same style object, and either way a colour that is no longer the one this wrote belongs to someone else
 * and is left alone (writing back a stale 'from' would paint the old theme's colour). Never mutes while the wind layer
 * is missing (the plan is "everything below it"). Returns { applied, layers, amount }.
 */
export function syncWindBasemapMute(map, theme, active, windId, win = (typeof window !== 'undefined' ? window : null)) {
  const r = syncOnce(map, theme, active, windId, win);
  if (win) win.__WIND_BASEMAP_MUTE__ = { ...r, waterL: r.applied ? windBasemapWaterL(theme, win) : 1, theme, at: Date.now() };
  return r;
}

/**
 * The style's layers in DRAW order. getStyle() leaves custom layers out (MapLibre's _serializedAllLayers), so the wind
 * layer's own slot comes from the style's order (as waterTempAnchor.js reads it), each custom layer kept as a stub.
 */
function orderedLayers(map) {
  const st = map.getStyle(), order = map.style._order;
  if (!st || !Array.isArray(st.layers)) throw new Error('style not loaded');
  if (!Array.isArray(order)) return st.layers;
  const byId = new Map(st.layers.map((l) => [l.id, l]));
  return order.map((id) => byId.get(id) || { id, type: 'custom' });
}

/** The raster layers under the wind as `showing` reads them, off the live map: no getStyle(), this runs on every styledata. */
function liveRasters(map, windId) {
  const order = map.style._order, out = [];
  if (!Array.isArray(order) || typeof map.getLayoutProperty !== 'function') return orderedLayers(map);
  for (const id of order) {
    if (id === windId) break;
    const l = map.getLayer(id);
    if (l && l.type === 'raster') out.push({ id, type: 'raster', layout: { visibility: map.getLayoutProperty(id, 'visibility') }, paint: { 'raster-opacity': map.getPaintProperty(id, 'raster-opacity') } });
  }
  return out;
}

/** What this map should have now: { amount (0 = unmuted), waterL, imagery (the id standing it down, or null) }. */
function wanted(map, theme, active, windId, win) {
  const base = active && map.getLayer(windId) ? windBasemapMuteAmount(theme, win) : 0;   // 0: wind off, dark, the kill
  const imagery = base > 0 ? windBasemapImagery(liveRasters(map, windId), windId) : null;
  return { amount: imagery ? 0 : base, waterL: windBasemapWaterL(theme, win), imagery };
}

/**
 * True when a sync would change something: the wind is on and the basemap is not muted, or the reverse (the wind went
 * off, a satellite photo or a weather wash came on under it), or the theme or a lever moved. Cheap (no getStyle()), for
 * the layer's styledata handler. It does not ask whether someone repainted a muted colour: a writer that re-asserts its
 * colour on every style change would then trade writes with this one for ever.
 */
export function windBasemapMuteStale(map, theme, active, windId, win = (typeof window !== 'undefined' ? window : null)) {
  if (!map || !map.style || !APPLIED || typeof map.getPaintProperty !== 'function') return false;
  try {
    const w = wanted(map, theme, active, windId, win), prev = APPLIED.get(map);
    if (!(w.amount > 0)) return !!prev;
    return !prev || prev.theme !== theme || prev.amount !== w.amount || prev.waterL !== w.waterL;
  } catch (e) {
    return false;
  }
}

function syncOnce(map, theme, active, windId, win) {
  if (!map || !map.style || !APPLIED || typeof map.getPaintProperty !== 'function') return { applied: false, layers: 0, amount: 0 };
  try {
    const { amount, waterL, imagery } = wanted(map, theme, active, windId, win);
    const prev = APPLIED.get(map);
    if (prev) {
      const mine = prev.plan.filter((p) => map.getLayer(p.id) && same(map.getPaintProperty(p.id, p.prop), p.to));
      if (mine.length === prev.plan.length && prev.theme === theme && prev.amount === amount && prev.waterL === waterL) return { applied: prev.layers > 0, layers: prev.layers, amount };
      for (const p of mine) map.setPaintProperty(p.id, p.prop, p.from);   // restore only what is still ours
      APPLIED.delete(map);
    }
    if (!(amount > 0)) return { applied: false, layers: 0, amount: 0, ...(imagery ? { reason: `imagery:${imagery}` } : {}) };
    const plan = windBasemapMutePlan(orderedLayers(map), windId, amount, waterL), layers = new Set(plan.map((p) => p.id)).size;
    APPLIED.set(map, { theme, amount, waterL, plan, layers });   // recorded BEFORE the writes: one that throws is undone by the next sync
    for (const p of plan) map.setPaintProperty(p.id, p.prop, p.to);
    return { applied: layers > 0, layers, amount };
  } catch (e) {
    return { applied: false, layers: 0, amount: 0, error: e.message };   // a style mid-load: the next styledata retries
  }
}

/**
 * waveLakes.js — a lake that a wave model carries renders as a lake (2026-10-23; the owner: "lakes should show as lakes").
 *
 * WHY. The wave mask is Natural Earth land (ne_50m_land fills the Great Lakes, Winnipeg and Victoria as land; the Caspian is its
 * only hole and the Black Sea lies outside it), refined at z4.4+ by basemap water, which the inland-water guard re-blacks beyond
 * ~10 km of NE water (the Salton Sea / Laguna Salada leak). So a lake value is hidden today. #497 makes EURO (ECMWF's wave model)
 * carry its own values on those lakes; GFS and ICON have none there (their nodes are invalid, and the encoder would extrapolate
 * them or draw height 0: a lake shown for them would be a fake calm sea).
 *
 * WHAT. withWaveLakes(land, grid) returns the land GeoJSON with each CARRIED lake cut as a hole in its containing land polygon,
 * the same mechanism as the Caspian. A lake is carried when the grid's model is in LAKE_MODELS AND one of its valid nodes has a
 * cell touching the lake. The variant is memoised per (land object, lake set, outline resolution) and is the SAME object for
 * every hour of the same model: every mask cache keys on land-object identity, so the mask repaints once when the lake set
 * changes (a model switch, #497's flip) and never per scrub step (#488's rule: the paint never depends on per-hour data).
 * Downstream, the lake is NE water to every pass: the world mask and the coarse wash show it; at z4.4+ the inland guard KEEPS
 * basemap water within 10 km of it (the basemap refines the shore) and the island re-assert leaves it; the sheltered classifier
 * releases it (releaseWaveLakes, called from marineMaskShelter). Water not on the list (Salton, Okeechobee, rivers, ponds) keeps
 * today's treatment.
 *
 * The outlines (public/wave_lakes.json, built by scripts/build_wave_lakes.py from Natural Earth): g50 for world-scale masks,
 * g10 (simplified 10 m) when the base is the 10 m land. Candidates are the lakes #497 confirms (the Great Lakes, Winnipeg,
 * Victoria); lakes near an ocean are left out on purpose (a 2-deg node there can be valid from sea cells).
 *
 * Kill: window.__RAW_DISABLE_WAVE_LAKES__ = true (the land is returned unchanged). Telemetry: window.__RAW_WAVE_LAKES__ (its own
 * global: never written into the engine's __RAW_GPU__, whose shape other code relies on).
 */
export const LAKE_MODELS = ['EURO'];
export const WAVE_LAKES_URL = '/wave_lakes.json';

const W = () => (typeof window !== 'undefined' ? window : {});
export const waveLakesOn = () => W().__RAW_DISABLE_WAVE_LAKES__ !== true;

let _asset = null;            // { lakes: [{ id, name, bbox, g50, g10, anchors }] }
let _loading = null;
let _current = [];            // the lakes of the last variant handed out (the sheltered-water exemption reads their anchors)

/** Load the outlines once (small: ~95 KB). Never throws; the lakes simply stay land until it lands. */
export function loadWaveLakes(url = WAVE_LAKES_URL) {
  if (_asset || _loading || typeof fetch !== 'function') return _loading;
  _loading = fetch(url).then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (j && Array.isArray(j.lakes)) _asset = j;
    return _asset;
  }).catch(() => null).finally(() => { _loading = null; });
  return _loading;
}
export const waveLakesLoaded = () => !!_asset;

const gridModel = (g) => String((g && (g.__sourceModel || g.model || (g.grid && g.grid.model))) || '').toUpperCase();

function nodeValid(v) {
  if (!v || v.is_valid === false || v.isOcean === false) return false;
  if (v.waves && v.waves.is_valid === false) return false;
  return Number.isFinite(v.lat) && Number.isFinite(v.lng);
}

function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi) c = !c;
  }
  return c;
}

/** Does the cell [lng +- hx, lat +- hy] touch the lake outline (outer ring)? */
function cellTouchesLake(lng, lat, hx, hy, outer) {
  if (inRing(lng, lat, outer)) return true;
  for (const [x, y] of outer) if (Math.abs(x - lng) <= hx && Math.abs(y - lat) <= hy) return true;
  return inRing(lng - hx, lat - hy, outer) || inRing(lng + hx, lat - hy, outer)
    || inRing(lng - hx, lat + hy, outer) || inRing(lng + hx, lat + hy, outer);
}

const _carried = new WeakMap();   // grid -> sorted lake ids
/** The ids of the lakes this grid carries (its model is a lake model AND a valid node's cell touches the lake). */
export function lakesCarried(grid) {
  if (!grid || !_asset || !Array.isArray(grid.vectors)) return [];
  if (!LAKE_MODELS.includes(gridModel(grid))) return [];
  if (_carried.has(grid)) return _carried.get(grid);
  const b = grid.bounds || (grid.grid && grid.grid.bounds);
  const cols = grid.cols || (grid.grid && grid.grid.cols); const rows = grid.rows || (grid.grid && grid.grid.rows);
  const hx = b && cols > 1 ? Math.abs(b.east - b.west) / (cols - 1) / 2 : 1;
  const hy = b && rows > 1 ? Math.abs(b.north - b.south) / (rows - 1) / 2 : 1;
  const ids = [];
  for (const lake of _asset.lakes) {
    const [w, s, e, n] = lake.bbox;
    const outer = lake.g50[0];
    for (const v of grid.vectors) {
      if (v.lng < w - hx || v.lng > e + hx || v.lat < s - hy || v.lat > n + hy || !nodeValid(v)) continue;
      if (cellTouchesLake(v.lng, v.lat, hx, hy, outer)) { ids.push(lake.id); break; }
    }
  }
  ids.sort();
  _carried.set(grid, ids);
  return ids;
}

const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * r[i][1]) - (r[i][0] * r[j][1]); return a / 2; };
const oriented = (ring, sign) => (Math.sign(ringArea(ring)) === sign ? ring : ring.slice().reverse());

const polysOf = (g) => (g && g.type === 'Polygon' ? [g.coordinates] : (g && g.type === 'MultiPolygon' ? g.coordinates : []));

/** The land with the lakes cut in: a new FeatureCollection; only the containing features are copied. */
export function cutLakes(land, lakes, res) {
  const features = land.features.slice();
  let cut = 0;
  for (const lake of lakes) {
    const geom = res === 10 ? lake.g10 : lake.g50;
    const [ax, ay] = lake.anchors[0] || [(lake.bbox[0] + lake.bbox[2]) / 2, (lake.bbox[1] + lake.bbox[3]) / 2];
    let done = false;
    for (let fi = 0; fi < features.length && !done; fi++) {
      const f = features[fi];
      const polys = polysOf(f && f.geometry);
      for (let pi = 0; pi < polys.length; pi++) {
        const outer = polys[pi][0];
        if (!outer || !inRing(ax, ay, outer) || polys[pi].slice(1).some((h) => inRing(ax, ay, h))) continue;
        const sign = Math.sign(ringArea(outer)) || 1;
        // The lake ring winds against the land (a hole under the renderer's nonzero fill); its islands wind with it (land again).
        const poly = [...polys[pi], oriented(geom[0], -sign), ...geom.slice(1).map((r) => oriented(r, sign))];
        const coords = f.geometry.type === 'Polygon' ? poly : polys.map((p, k) => (k === pi ? poly : p));
        features[fi] = { ...f, geometry: { type: f.geometry.type, coordinates: coords } };
        delete features[fi]._bbox;          // the renderer caches a bbox on the feature: let it recompute for the copy
        done = true; cut += 1;
        break;
      }
    }
  }
  return { type: 'FeatureCollection', features, __waveLakes: lakes.map((l) => l.id), __waveLakesCut: cut, __base: land };
}

const _variants = new WeakMap();   // land -> Map(key -> variant)
const lakeKey = (geo) => ((geo && geo.__waveLakes) || []).join(',');
const boxesTouch = (lake, b) => {
  if (!b) return true;
  const span = (b.east < b.west ? b.east + 360 : b.east) - b.west;
  if (span >= 340 || b.east < b.west) return true;                 // world / wrapped masks: every lake is in them
  const [w, s, e, n] = lake.bbox;
  return e >= b.west && w <= b.east && n >= b.south && s <= b.north;
};

/**
 * The land GeoJSON the wave mask should use with THIS grid over `bounds`: the land itself when no carried lake touches the mask
 * (or killed, or not loaded), else the memoised variant with those lakes cut. Same (land, lake set) -> same object, so identity-
 * keyed caches hold, and a mask whose bounds hold no carried lake keeps the plain land (a model switch there rebuilds nothing).
 * `engine` (the encoder's): when the resident mask's lake set differs from this commit's, the "retain the resident while the
 * basemap is loading" shortcut is withdrawn for this commit (it would keep the other model's lakes lit).
 */
export function withWaveLakes(land, grid, bounds, engine) {
  if (!land || !Array.isArray(land.features)) return land;
  if (!waveLakesOn() || !_asset) { _current = []; return land; }
  const ids = lakesCarried(grid);
  const lakes = _asset.lakes.filter((l) => ids.includes(l.id) && boxesTouch(l, bounds));
  if (engine && engine._cachedMaskGeoJSON && lakeKey(engine._cachedMaskGeoJSON) !== lakes.map((l) => l.id).join(',')) engine._maskRetainPatchedOk = false;
  _current = lakes;
  if (!lakes.length) return land;
  const hires = typeof window !== 'undefined' && window.__LAND_GEOJSON_HIRES_CACHE__ === land;
  const key = `${lakes.map((l) => l.id).join(',')}|${hires ? 10 : 50}`;
  let byKey = _variants.get(land);
  if (!byKey) { byKey = new Map(); _variants.set(land, byKey); }
  let v = byKey.get(key);
  if (!v) {
    v = cutLakes(land, lakes, hires ? 10 : 50);
    byKey.set(key, v);
    if (typeof window !== 'undefined') window.__RAW_WAVE_LAKES__ = { ...(window.__RAW_WAVE_LAKES__ || {}), lakes: v.__waveLakes, res: hires ? 10 : 50, cut: v.__waveLakesCut, model: gridModel(grid) };
  }
  return v;
}

/** The anchors of the lakes currently cut ([lng, lat] pairs). */
export function activeWaveLakeAnchors() {
  if (!waveLakesOn()) return [];
  const out = [];
  for (const l of _current) for (const a of (l.anchors || [])) out.push(a);
  return out;
}

/**
 * The sheltered-water exemption: a carried lake lies wholly inside many mask canvases and so cannot reach the canvas border,
 * which the classifier reads as "sheltered" (64: discarded by the shader). Release every sheltered component that holds a
 * carried lake's anchor. `sheltered` may be a cached array (shared), so a copy is returned when anything is released.
 * `project(lng, lat) -> [x, y]` maps into the downsampled grid. Returns { sheltered, count, released }.
 */
export function releaseWaveLakes(sheltered, w, h, count, project) {
  const anchors = activeWaveLakeAnchors();
  if (!anchors.length || !count) return { sheltered, count, released: 0 };
  let out = null; let released = 0;
  for (const [lng, lat] of anchors) {
    const [fx, fy] = project(lng, lat);
    const x = Math.floor(fx); const y = Math.floor(fy);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const src = out || sheltered;
    if (!src[y * w + x]) continue;
    if (!out) out = Uint8Array.from(sheltered);
    const stack = [y * w + x]; out[y * w + x] = 0;
    while (stack.length) {
      const i = stack.pop(); released += 1;
      const ix = i % w; const iy = (i - ix) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = ix + dx; const ny = iy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (out[j]) { out[j] = 0; stack.push(j); }
        }
      }
    }
  }
  if (!out) return { sheltered, count, released: 0 };
  if (typeof window !== 'undefined') window.__RAW_WAVE_LAKES__ = { ...(window.__RAW_WAVE_LAKES__ || {}), released };
  return { sheltered: out, count: Math.max(0, count - released), released };
}

/** The resident mask's carried lakes ([] for the plain land). */
export const maskLakes = (geo) => (geo && geo.__waveLakes) || [];

export function _setWaveLakesForTest(asset) { _asset = asset; _current = []; }

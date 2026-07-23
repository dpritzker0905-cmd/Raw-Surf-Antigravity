import { getCenterLng, wrapLngRelative, wrapLongitude } from './mapUtils';
import { applyInlandWaterGuard, snapshotNeTruth } from './inlandWaterGuard';

// --- Coordinate Projection and Land Mask Renderer ---

// Per-POLYGON bounding box (outer ring only — holes lie within it). Cached on the coordinates
// array. Exported for tests.
export function getPolygonBbox(polyCoords) {
  if (polyCoords.__bbox) return polyCoords.__bbox;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  const ring = polyCoords[0] || [];
  for (const pt of ring) {
    if (pt[0] < west) west = pt[0];
    if (pt[0] > east) east = pt[0];
    if (pt[1] < south) south = pt[1];
    if (pt[1] > north) north = pt[1];
  }
  polyCoords.__bbox = { west, east, south, north };
  return polyCoords.__bbox;
}

// True when a polygon's bbox overlaps the (wrapped) target bounds. Exported for tests.
// THE ALL-BLACK REGIONAL MASK ROOT (2026-07-03): the 10m land file has ~10 CONTINENT-scale
// MultiPolygon features, so the FEATURE-level bbox test passes for nearly all of them on any
// regional target. Their far-side member polygons (e.g. Eurasia for a Florida tile) then project
// through wrapLngRelative with lng jumps of ±360° near the anti-center meridian — the filled path
// sweeps across the ENTIRE canvas and paints it black. An all-black ocean mask makes the advect
// shader drop every particle and masks out the regional heatmap: the "crests dead at close zoom
// until any bounds-changing commit" state (live repro + isolated deterministic replica, FL tile:
// 9/10 features drawn → 0% ocean). Culling per member POLYGON keeps only genuinely nearby land.
export function polygonOverlapsTarget(bbox, wrappedWest, wrappedEast, south, north, center) {
  const pad = 1.0;
  if (bbox.south > north + pad || bbox.north < south - pad) return false;
  const pCenter = (bbox.west + bbox.east) * 0.5;
  const projected = wrapLngRelative(pCenter, center);
  const halfSpan = (bbox.east - bbox.west) * 0.5;
  return (projected - halfSpan <= wrappedEast + pad) && (projected + halfSpan >= wrappedWest - pad);
}

// ── ANTIMERIDIAN RING UNWRAP (2026-07-23 — the N-Pacific "RECTANGLE": heatmap AND crests blank) ──
// Both tracers here wrap every vertex INDEPENDENTLY (`wrapLngRelative(lng, center)`), so a ring that
// straddles the projector's ANTI-CENTER meridian (center ± 180) teleports 360° between two
// consecutive vertices and the `ctx.fill()` sweeps the whole canvas black.
//
// Live proof (viewport near ±180 ⇒ overlay bounds −183.6..−116.2, center −149.89 ⇒ seam at +30.1°E,
// straight through Africa/Eurasia): the NE-10m "Land" polygon (bbox −17.5..180 / −34.8..77.7) jumped
// **2732 px on a 512 px canvas** and painted **landFraction 1.0000** — an all-LAND overlay. That
// overlay is applied in REPLACE mode while a world grid is resident, so it overrides the (correct)
// base mask, and "land" suppresses the heatmap AND the crest particles TOGETHER — both read the same
// oceanFlag. GPU read-back at the time: base=255 water, overlay=0 land, effective=0, src=
// overlay_replace, across the entire open Pacific.
//
// This is the same FAMILY as the per-POLYGON cull in drawPolygon, but a cull cannot fix it: this
// polygon LEGITIMATELY reaches the target (Chukotka at +176..180 wraps to −184..−180). The cull is
// right to admit it; it is the TRACE that tears.
//
// Fix: walk each ring accumulating the SHORTEST delta between consecutive vertices, so the ring is
// continuous BY CONSTRUCTION (same live probe: max jump 2732 px → 13 px, landFraction 1.0 → 0.0009,
// with Hawaii still correctly drawn at −158.9/20.9). Then place the continuous ring into the target
// window at every 360° offset whose span actually overlaps — a ring straddling the window edge draws
// twice, which is what the per-vertex wrap was blindly (and destructively) approximating.
// Kill: `window.__RAW_DISABLE_MASK_RING_UNWRAP__ = true` restores the per-vertex wrap.
export function unwrapRingLngs(ring, center) {
  const lngs = new Array(ring.length);
  let prev = null, min = Infinity, max = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const raw = ring[i][0];
    let lng;
    if (prev === null) {
      lng = wrapLngRelative(raw, center);
    } else {
      // shortest step from the PREVIOUS (possibly already-unwrapped) vertex — never ±360
      let d = raw - wrapLongitude(prev);
      let wd = ((d + 180) % 360);
      if (wd < 0) wd += 360;
      wd -= 180;
      lng = prev + wd;
    }
    lngs[i] = lng;
    prev = lng;
    if (lng < min) min = lng;
    if (lng > max) max = lng;
  }
  return { lngs, min, max };
}

// Which 360° copies of a continuous ring [min,max] land inside the target window. Empty = the ring
// genuinely misses the window (a free, CORRECT cull — the span is authoritative once continuous).
// STRICTLY POSITIVE overlap: a copy that only touches the window edge fills zero area, and admitting
// it would make the GLOBAL world mask draw every ring twice (caught by the byte-identity test).
// Capped at 3 so a ring spanning >360° (Antarctica) cannot fan out unboundedly.
export function ringCopyOffsets(min, max, wrappedWest, wrappedEast) {
  if (!isFinite(min) || !isFinite(max)) return [];
  const kLo = Math.floor((wrappedWest - max) / 360) + 1;   // max + 360k >  wrappedWest
  const kHi = Math.ceil((wrappedEast - min) / 360) - 1;    // min + 360k <  wrappedEast
  const out = [];
  for (let k = kLo; k <= kHi && out.length < 3; k++) out.push(k * 360);
  return out;
}

export function maskRingUnwrapEnabled() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_RING_UNWRAP__ === true);
}

// Shared canvas projector for the mask renderers: Web-Mercator Y, wrap-relative X, scaled to the
// canvas. Same math renderMaskToCanvas uses internally — exported so the basemap-water overlay
// registers EXACTLY like the base mask.
export function makeMaskProjector(bounds, width, height) {
  const { west, south, east, north } = bounds;
  const latToMercatorY = (l) => {
    const latClamped = Math.max(-85.051129, Math.min(85.051129, l));
    const rad = latClamped * Math.PI / 180;
    return (1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0;
  };
  const center = getCenterLng(west, east);
  const wrappedWest = wrapLngRelative(west, center);
  const wrappedEast = wrapLngRelative(east, center);
  const mercMinX = (wrappedWest + 180.0) / 360.0;
  const mercMaxX = (wrappedEast + 180.0) / 360.0;
  const mercMinY = latToMercatorY(north);
  const mercMaxY = latToMercatorY(south);
  const mercXSpan = mercMaxX - mercMinX;
  const mercYSpan = mercMaxY - mercMinY;
  const project = (lng, lat) => {
    const projectedLng = wrapLngRelative(lng, center);
    const mx = (projectedLng + 180.0) / 360.0;
    const my = latToMercatorY(lat);
    return [((mx - mercMinX) / mercXSpan) * width, ((my - mercMinY) / mercYSpan) * height];
  };
  // RAW variant: the caller has ALREADY placed this longitude on a continuous ring (see
  // unwrapRingLngs) — re-wrapping it here would re-introduce the very 360° tear we just removed.
  project.raw = (lng, lat) => {
    const mx = (lng + 180.0) / 360.0;
    const my = latToMercatorY(lat);
    return [((mx - mercMinX) / mercXSpan) * width, ((my - mercMinY) / mercYSpan) * height];
  };
  project.center = center;
  project.wrappedWest = wrappedWest;
  project.wrappedEast = wrappedEast;
  return project;
}

// ── BASEMAP-WATER TRUTH OVERLAY (2026-07-04, "Gull Park / Pier 15-16 under water") ──────────────
// Natural Earth (any resolution) has NO man-made port landfill, piers, or inner-island detail, so
// an NE-based mask can never keep waves off Port-of-Long-Beach-class terrain. The BASEMAP's own
// vector water polygons are OSM-derived and meter-accurate. Within the (padded) viewport, repaint
// the mask from that truth: land-black everywhere, then ONLY ocean/sea-class water white. Two user
// reports fixed at once: port landfill stops reading "under water" (it isn't in the water polys),
// and ocean waves stop animating up NON-ocean waterways (canals/rivers/marina basins are water but
// not ocean-class, so they stay black for the WAVE mask — the basemap still renders them as water).
// Outside the viewport the NE mask remains (tiles there aren't loaded). Returns true when applied.
// Tile-readiness gate for the truth painters (2026-07-04, the "rectangle holes" report): a paint
// that runs while the water source is still parsing tiles bakes missing-tile rectangles into the
// mask as false land, and the repaint hysteresis then treats the bad paint as done. Callers skip
// the paint entirely when this returns false — the base mask serves until the map's `idle` event
// re-drives the refresh with every covering tile queryable. Fail-OPEN on any non-boolean answer
// (missing source / style mid-load): the old best-effort behavior is better than truth painting
// being dead forever.
export function isBasemapWaterSourceReady(mapInstance) {
  if (!mapInstance) return false;
  try {
    let waterSource = 'composite';
    const baseWater = mapInstance.getStyle()?.layers?.find(l => l.id === 'water');
    if (baseWater && baseWater.source) waterSource = baseWater.source;
    if (typeof mapInstance.isSourceLoaded === 'function') {
      const v = mapInstance.isSourceLoaded(waterSource);
      if (typeof v === 'boolean' && !v) return false;
    }
    // BELT-AND-BRACES (grey-rectangle class, 2026-07-06, El Salvador repro): isSourceLoaded
    // answers for REQUESTED tiles of one source, but mid-gesture the map can still be fetching —
    // areTilesLoaded() is the global tile-load truth. A paint that slips through here bakes
    // missing-tile rectangles into the mask as false land, and on a WIDE-grid residency the
    // overlay REPLACE renders that rect at every zoom until the repaint hysteresis escapes.
    if (typeof mapInstance.areTilesLoaded === 'function' && mapInstance.areTilesLoaded() === false) {
      return false;
    }
    return true;
  } catch (e) {
    return true;
  }
}

// ISLAND RE-ASSERT (2026-07-07, "islands/coastal land covered in heatmap at EVERY zoom"): wherever
// the mask texel is coarser than Natural Earth 10m (~90 m) — z5 through ~z11, NOT just low zoom
// (forensics: z9 mask 205 px/° floods Abaco 8-17%; re-assert → 0) — the basemap water polygons DROP
// small islands (no hole in the ocean polygon), so overlayBasemapWaterOnMask's ocean-white pass
// floods them and step-3's hole re-assert has nothing to restore. `neFull` is a FULL-mask-resolution
// copy of the pristine NE canvas captured before the paint; MULTIPLY it back: mask * NE / 255 →
// NE land (0) forces mask 0, NE water (255) leaves the mask untouched (open water, canals, sheltered
// 64, and port-landfill land — all NE=water or already black — survive). Full resolution so thin cays
// NE carries survive (the old 1024 snapshot averaged them to water). Exported for tests.
export function reassertNeLand(canvas, neFull) {
  if (!canvas || !neFull || typeof document === 'undefined') return { applied: false, reason: 'no_input' };
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const prevComp = ctx.globalCompositeOperation;
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = false;   // hard-edged — no gray coastline creep
    ctx.drawImage(neFull, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = prevComp;
    ctx.imageSmoothingEnabled = prevSmooth;
    return { applied: true, mode: 'multiply' };
  } catch (e) {
    return { applied: false, reason: 'error' };
  }
}

export function overlayBasemapWaterOnMask(canvas, bounds, mapInstance) {
  if (!canvas || !mapInstance || typeof mapInstance.querySourceFeatures !== 'function') return false;
  let waterSource = 'composite';
  let waterSourceLayer = 'water';
  try {
    const style = mapInstance.getStyle();
    const baseWater = style?.layers?.find(l => l.id === 'water');
    if (baseWater) {
      if (baseWater.source) waterSource = baseWater.source;
      if (baseWater['source-layer']) waterSourceLayer = baseWater['source-layer'];
    }
  } catch (e) { /* defaults */ }

  // FINEST-TILE TRUTH (2026-07-04, the Lido gap-island): querySourceFeatures returns polygons from
  // EVERY loaded tile LEVEL. An overzoomed PARENT tile's simplified ocean boundary cuts ACROSS
  // gap-islands — land that separates two water polygons (barrier islands: Lido) without being a
  // hole ring in either — so painting it white drowns them, and the hole-reassert pass below has
  // nothing to restore (live texel read at Venice z11.5: Venice hole 0 ✓, Lido 255 ✗ → crest
  // particles visibly ran over Lido). queryRenderedFeatures returns only the tiles actually being
  // RENDERED (the finest loaded), so a parent's wrong boundary never paints once the real tile is
  // in. Falls back to the source query when the render query fails or returns nothing (patch is
  // then parent-vulnerable but never blank; the painter re-runs on map events + wave uploads).
  let feats = null;
  // DEGRADED-PAINT tracking (grey-rectangle class, 2026-07-06): the source-query fallback is
  // PARENT-VULNERABLE (overzoomed tiles, simplified/partial water) — the original design assumed
  // "the painter re-runs on map events", but the repaint HYSTERESIS locks a fallback paint in
  // like a first-class one. Report the degradation so callers stamp it and let the next refresh
  // bypass the hysteresis (self-heal once finest tiles are queryable).
  let usedSourceFallback = false;
  try {
    if (typeof mapInstance.queryRenderedFeatures === 'function') {
      const layerIds = (mapInstance.getStyle()?.layers || [])
        .filter(l => l.type === 'fill' && l.source === waterSource && l['source-layer'] === waterSourceLayer)
        .map(l => l.id);
      if (layerIds.length) feats = mapInstance.queryRenderedFeatures({ layers: layerIds });
    }
  } catch (e) { feats = null; }
  if (!feats || !feats.length) {
    usedSourceFallback = true;
    try {
      feats = mapInstance.querySourceFeatures(waterSource, { sourceLayer: waterSourceLayer });
    } catch (e) {
      return false;
    }
  }
  if (!feats || !feats.length) return false;

  // STRICT viewport in geographic coords — the truth patch region. NO pad (was 40%): both tile
  // queries above can only see tiles covering the CURRENT viewport, so a padded rect black-fills
  // a ring the water polygons can never repaint white — a black land frame baked into the mask.
  // Panning/zooming inside the repaint hysteresis then scrolled it on screen as giant straight-
  // edged "rectangle holes" in the heatmap (live 2026-07-04 report). Outside the strict viewport
  // the canvas keeps the NE-rendered base truth, which is sane at every pixel; the engine tracks
  // this truth box and repaints when the view escapes it.
  let vb;
  try {
    const b = mapInstance.getBounds();
    vb = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  } catch (e) {
    return false;
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const project = makeMaskProjector(bounds, canvas.width, canvas.height);

  // NE-truth snapshot BEFORE any painting (the canvas is NE-only at entry): the inland-water
  // guard below limits basemap-water trust to ~10 km of this truth. See inlandWaterGuard.js —
  // Mapbox Streets v8 water is class-less, so the ocean/sea class filter is a no-op on this
  // basemap and inland seas (Salton, Laguna Salada) would otherwise whiten as "ocean".
  const neSnapshot = snapshotNeTruth(canvas);

  // FULL-RES NE capture for the island re-assert (step 3c): copy the pristine NE canvas BEFORE step
  // 1 destroys it, at full mask resolution. Gated by RESOLUTION, not zoom — re-assert only where the
  // mask texel (canvas.width / span, px per degree) is coarser than NE 10m's own resolution, so it
  // engages at every zoom the mask is coarse (z5-~z11) and self-disables where the basemap is
  // genuinely finer (z12+ meter tiles — re-asserting coarse NE there would blockify the coast).
  let neFull = null;
  try {
    const _raOff = typeof window !== 'undefined' && window.__RAW_DISABLE_ISLAND_REASSERT__ === true;
    const _span = (bounds.east < bounds.west ? bounds.east + 360 : bounds.east) - bounds.west;
    const _densityPxDeg = _span > 0 ? canvas.width / _span : 0;
    const _maxDensity = (typeof window !== 'undefined' && Number(window.__RAW_ISLAND_REASSERT_MAX_DENSITY__)) || 1200;
    if (!_raOff && _densityPxDeg > 0 && _densityPxDeg < _maxDensity) {
      neFull = document.createElement('canvas');
      neFull.width = canvas.width; neFull.height = canvas.height;
      neFull.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0);
    }
  } catch (e) { neFull = null; }

  // 1. Land-black the viewport patch (clipped to the canvas).
  const [px0, py0] = project(vb.west, vb.north);
  const [px1, py1] = project(vb.east, vb.south);
  const rx = Math.max(0, Math.min(px0, px1)), ry = Math.max(0, Math.min(py0, py1));
  const rw = Math.min(canvas.width, Math.max(px0, px1)) - rx;
  const rh = Math.min(canvas.height, Math.max(py0, py1)) - ry;
  if (rw <= 1 || rh <= 1) return false;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.clip();
  ctx.fillStyle = '#000000';
  ctx.fillRect(rx, ry, rw, rh);

  // 2. Paint ocean/sea-class water white inside the patch. Features without a class are treated
  //    as ocean (some styles omit class on the open-ocean polygon).
  const forEachPoly = (fn) => {
    for (const f of feats) {
      const cls = f.properties && f.properties.class;
      if (cls !== undefined && cls !== 'ocean' && cls !== 'sea') continue;
      const geom = f.geometry;
      if (!geom) continue;
      const polys = geom.type === 'Polygon' ? [geom.coordinates] : (geom.type === 'MultiPolygon' ? geom.coordinates : null);
      if (!polys) continue;
      for (const poly of polys) fn(poly);
    }
  };
  // ANTIMERIDIAN-SAFE ring tracing (see unwrapRingLngs): identical tear risk to the NE tracer — a
  // water polygon straddling the projector's anti-center meridian would sweep the canvas white.
  const unwrapEnabled = maskRingUnwrapEnabled();
  const traceRings = (rings, fillRule) => {
    if (!unwrapEnabled) {
      ctx.beginPath();
      for (const ring of rings) {
        if (!ring || !ring.length) continue;
        ring.forEach((pt, i) => {
          const [x, y] = project(pt[0], pt[1]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fill(fillRule || 'nonzero');
      return;
    }
    const prepared = [];
    let rMin = Infinity, rMax = -Infinity;
    for (const ring of rings) {
      if (!ring || !ring.length) continue;
      const u = unwrapRingLngs(ring, project.center);
      prepared.push({ ring, lngs: u.lngs });
      if (u.min < rMin) rMin = u.min;
      if (u.max > rMax) rMax = u.max;
    }
    if (!prepared.length) return;
    for (const off of ringCopyOffsets(rMin, rMax, project.wrappedWest, project.wrappedEast)) {
      ctx.beginPath();
      for (const r of prepared) {
        for (let i = 0; i < r.ring.length; i++) {
          const [x, y] = project.raw(r.lngs[i] + off, r.ring[i][1]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      ctx.fill(fillRule || 'nonzero');
    }
  };
  const tracePoly = (rings) => traceRings(rings, 'evenodd');

  ctx.fillStyle = '#ffffff';
  let painted = 0;
  forEachPoly((poly) => { tracePoly(poly); painted++; });

  // 3. RE-ASSERT LAND HOLES (the Venice regression, 2026-07-04): querySourceFeatures returns water
  //    polygons from EVERY loaded tile level — an overzoomed PARENT tile's simplified polygon has
  //    small land islands (Venice, Lido) simplified away, so painting it white erases the fine
  //    tile's correct hole. Second pass: every hole ring (land island) paints BLACK after all the
  //    whites, so the finest-detail land always wins regardless of tile paint order.
  ctx.fillStyle = '#000000';
  forEachPoly((poly) => {
    for (let h = 1; h < poly.length; h++) {
      const ring = poly[h];
      if (!ring || !ring.length) continue;
      traceRings([ring], undefined);   // antimeridian-safe (same unwrap as the white pass)
    }
  });

  // 3b. INLAND-WATER GUARD (2026-07-06, the Salton Sea / Laguna Salada leak): re-black painted
  //     water farther than ~10 km from NE water — the basemap refines the coastline, it cannot
  //     invent new seas. Runs BEFORE the wetland + sheltered passes so they classify the
  //     corrected water field. Kill: __RAW_DISABLE_INLAND_WATER_GUARD__; tune: __RAW_INLAND_WATER_KM__.
  {
    const gStats = applyInlandWaterGuard(canvas, neSnapshot, bounds);
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.inlandWaterGuard = gStats;
    }
  }

  // 3c. ISLAND RE-ASSERT (see reassertNeLand + the neFull capture above): multiply the pristine
  //     full-res NE land back wherever the mask is coarser than NE (neFull is non-null only then).
  //     Runs AFTER the inland guard so it overrides any island the basemap flooded; the wetland +
  //     sheltered passes below only ever darken, so they can't re-flood it. Only darkens → the
  //     port-landfill/canal/sheltered verdicts (NE=water) are all preserved.
  try {
    const _span = (bounds.east < bounds.west ? bounds.east + 360 : bounds.east) - bounds.west;
    const _dens = _span > 0 ? Math.round(canvas.width / _span) : null;
    if (neFull) {
      const rStats = reassertNeLand(canvas, neFull);
      if (typeof window !== 'undefined' && window.__RAW_GPU__) window.__RAW_GPU__.islandReassert = { ...rStats, densityPxDeg: _dens };
    } else if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      const off = window.__RAW_DISABLE_ISLAND_REASSERT__ === true;
      window.__RAW_GPU__.islandReassert = { applied: false, reason: off ? 'disabled' : 'fine_basemap', densityPxDeg: _dens };
    }
  } catch (e) { /* enhancement only — basemap patch stands */ }

  // 4. WETLAND/TIDAL-FLAT BLACK-OUT (2026-07-04, Venice lagoon marshes): OSM puts sea-connected
  //    lagoons on the WATER side of the coastline, so the whole lagoon arrives as ocean-class water
  //    and steps 2-3 leave it wave-eligible — but the tiles ALSO ship the marshes (barene) as
  //    WETLAND polygons drawn on top. They are visibly land; crest dashes marching over them was
  //    the live user report. Painted from querySourceFeatures, NOT queryRenderedFeatures: this
  //    app's style has no layer that renders wetlands, so a render query can never see them — and
  //    for painting land BLACK a parent tile's simplified wetland over-covers in the SAFE direction
  //    (a little less wave over marsh-adjacent water, never wave over marsh). Schema-agnostic:
  //    Mapbox Streets ships wetlands in `landuse_overlay` (class wetland/wetland_noveg),
  //    OpenMapTiles in `landcover` (class wetland, subclass incl. tidalflat).
  try {
    ctx.fillStyle = '#000000';
    // SUB-PIXEL CREEK-MESH CLOSE (2026-07-07, Andros / Mangrove Cay "heatmap over Moxey Town"):
    // the basemap DOES ship the marsh as discrete WETLAND polygons (Andros: 29 landuse_overlay/
    // wetland), and the fill above blacks them out — but the 100-300 m tidal creeks BETWEEN them
    // are < 1.5 px at the mask's ~200 m/px (mangrove marsh is a fine land/water mosaic both NE 10m
    // and the basemap water polygon generalise as ocean), so wash leaks through the gaps and the
    // island reads half-flooded. Dilate each wetland polygon by a small FIXED-PIXEL stroke to close
    // them. Fixed px self-scales in the right direction: ~300 m at z10 (where the leak lives) but
    // ~15 m at z14 (creeks already resolve → negligible over-cover of open coast). Strokes the same
    // path tracePoly just filled; the ctx.restore() below reverts the stroke state (no leak into the
    // sheltered pass). Only ever ADDS black over already-wetland-classified marsh → cannot flood.
    // Sized in METERS (clamped in px), not fixed px: the resident mask resolution swings ~200-800
    // m/px with the resident grid, so a fixed-px dilation over-covers on coarse builds and under-
    // covers on fine ones. A/B verified (Andros creek-gap flood): 0 px 22.1% → ~900 m 12.6%, open
    // ocean stays 100% water (wetland polys are interior, > clamp px from the open coast). Kill:
    // __RAW_DISABLE_WETLAND_DILATE__; tune: __RAW_WETLAND_DILATE_M__ (default 900) or hard px override
    // __RAW_WETLAND_DILATE_PX__.
    const _win = typeof window !== 'undefined' ? window : {};
    const _wetDilOff = _win.__RAW_DISABLE_WETLAND_DILATE__ === true;
    const _wlSpanDeg = (bounds.east < bounds.west ? bounds.east + 360 : bounds.east) - bounds.west;
    const _wlLatMid = (bounds.north + bounds.south) / 2;
    const _wlMPerPx = (_wlSpanDeg > 0 && canvas.width > 0)
      ? (111320 * Math.cos(_wlLatMid * Math.PI / 180) * _wlSpanDeg) / canvas.width : 0;
    const _pxOverride = Number(_win.__RAW_WETLAND_DILATE_PX__);
    const _targetM = Number(_win.__RAW_WETLAND_DILATE_M__) || 900;
    let _wetDilPx;
    if (_pxOverride > 0) _wetDilPx = _pxOverride;
    else if (_wlMPerPx > 0) _wetDilPx = Math.max(0.75, Math.min(5, _targetM / _wlMPerPx));
    else _wetDilPx = 1.5;
    const _wetDilate = !_wetDilOff && _wetDilPx > 0;
    if (_wetDilate) {
      ctx.strokeStyle = '#000000';
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = _wetDilPx * 2;   // stroke expands the filled region ~lineWidth/2 outward
    }
    let _wetPainted = 0;
    for (const sl of ['landuse_overlay', 'landcover']) {
      let fs = [];
      try { fs = mapInstance.querySourceFeatures(waterSource, { sourceLayer: sl }) || []; } catch (e) { fs = []; }
      for (const f of fs) {
        const cls = f.properties && f.properties.class;
        const sub = f.properties && f.properties.subclass;
        if (cls !== 'wetland' && cls !== 'wetland_noveg' && sub !== 'wetland' && sub !== 'tidalflat') continue;
        const geom = f.geometry;
        if (!geom) continue;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : (geom.type === 'MultiPolygon' ? geom.coordinates : null);
        if (!polys) continue;
        for (const poly of polys) { tracePoly(poly); if (_wetDilate) ctx.stroke(); _wetPainted++; }
      }
    }
    if (_win.__RAW_GPU__) {
      window.__RAW_GPU__.wetlandBlackout = {
        polys: _wetPainted,
        dilatePx: _wetDilate ? +_wetDilPx.toFixed(2) : 0,
        mPerPx: Math.round(_wlMPerPx),
      };
    }
  } catch (e) { /* wetland truth unavailable — water-only patch stands */ }

  ctx.restore();

  // 5. SHELTERED-WATER SUPPRESSION (2026-07-04, "waves shouldn't run up the intracoastal
  //    waterway"): sea-connected lagoons / enclosed harbor basins are OCEAN-class in the tiles
  //    (OSM coastline convention), so no class rule can exclude them — but ocean swell dies at a
  //    narrow entrance. Classify by CONNECTIVITY on the finished mask: water that cannot reach
  //    the canvas border through a channel wider than ~__RAW_SHELTERED_GAP_M__ (default 600 m)
  //    repaints to 0.25 — below BOTH the heatmap's 0.5 discard and the particle 0.3 cull, above
  //    land's 0 for mask-debug readability. Whole-canvas analysis so a bay whose entrance is off
  //    the viewport still classifies correctly. Kill: __RAW_DISABLE_SHELTERED_WATER__ = true.
  try {
    // Basin-scale canvases only (≥0.5° span): the classifier treats border-touching water as
    // OPEN, so a window smaller than a basin cuts through it and mis-classifies; and its
    // downsampled verdict upscales into mottled blocks on a crisp deep-zoom overlay (live z16
    // report). Regional grid canvases (1°+) qualify; small viewport overlays skip — their
    // sheltered truth arrives via the shader's min() combine with the regional base mask.
    const _spanForSheltered = (bounds.east < bounds.west ? bounds.east + 360 : bounds.east) - bounds.west;
    if (typeof window === 'undefined' || window.__RAW_DISABLE_SHELTERED_WATER__ !== true) {
      if (_spanForSheltered >= 0.5) {
        const stats = suppressShelteredWater(canvas, bounds);
        if (typeof window !== 'undefined' && window.__RAW_GPU__) {
          window.__RAW_GPU__.shelteredWater = stats || { applied: false };
        }
      } else {
        // Crisp deep-zoom canvas — too small to classify itself at BASIN scale (a sub-basin
        // window mis-reads connectivity). Two truth layers instead:
        // 1. Darken with the cached basin-scale verdict (lagoons/harbor basins).
        const stats = applyCachedShelteredVerdict(canvas, bounds);
        // 2. NARROW-WATER pass (2026-07-04, "heatmap on Canal Grande"): basin classification is
        //    only as good as the land truth it sees, and NE 10m drops sub-200 m barrier islands
        //    (live texel probe: Pellestrina reads WATER → the whole Venice lagoon classifies
        //    open → no basin verdict can suppress its canals). At crisp scale the basemap water
        //    polygons are meter-accurate, so the same classifier at CANAL gap (~120 m) kills
        //    swell in confined channels regardless of basin connectivity: canal border pixels
        //    are always within the erosion radius of land, so the border flood never enters
        //    them, while wide water (beaches, fairways, basins) stays fully open — this pass
        //    can only ever suppress water narrower than the gap. Kill:
        //    __RAW_DISABLE_NARROW_WATER__ = true; tune: __RAW_NARROW_WATER_M__ (default 120).
        let narrow = null;
        if (typeof window === 'undefined' || window.__RAW_DISABLE_NARROW_WATER__ !== true) {
          const narrowM = (typeof window !== 'undefined' && Number(window.__RAW_NARROW_WATER_M__)) || 120;
          narrow = suppressShelteredWater(canvas, bounds, { gapM: narrowM, stash: false });
        }
        if (typeof window !== 'undefined' && window.__RAW_GPU__) {
          window.__RAW_GPU__.shelteredWater = { basin: stats || { applied: false, fromCache: true }, narrow };
        }
      }
    }
  } catch (e) { /* classifier unavailable — open-water mask stands */ }

  // 6. OPEN-WATER PLAUSIBILITY VERDICT (2026-07-16, user live at z3.85: grey heatmap-hole STRIPS
  //    south of Louisiana + through the Yucatán/DR; GPU probe: overlay_min effective=0 over open
  //    Gulf/Caribbean water, hysteresis-locked, degraded=false): step 1 land-blacks the strict
  //    viewport and step 2 can only repaint water for tiles queryRenderedFeatures actually
  //    returned — a tile missing from the render (mid-load during a fast zoom-out's pyramid
  //    switch, cache eviction, a throttled pane) leaves a TILE-SHAPED FALSE-LAND STRIP over open
  //    ocean. usedSourceFallback only catches the all-tiles-missing case; a PARTIAL render query
  //    passed as first-class and the repaint hysteresis locked the strips in (the El Salvador
  //    grey-rectangle class, still reachable). Verdict: sample the painted viewport rect against
  //    the pristine NE truth — a pixel NE calls OPEN water (white here AND at a ring around it,
  //    i.e. not an NE coastline the basemap may legitimately refine to land) that the finished
  //    paint left hard-BLACK (<30 — sheltered suppression writes ~64 and stays exempt) is
  //    missing-tile damage, not truth. Above a small fraction the paint reports DEGRADED, the
  //    caller skips the hysteresis, and the next refresh repaints (self-heal once tiles render).
  //    Read-only sampling; never blocks the paint. neFull is non-null exactly on the coarse/wide
  //    paints where the strip class lives (density < 1200 px/°); crisp deep-zoom paints skip.
  //    Kill: __RAW_DISABLE_OPENWATER_PLAUSIBILITY__; tune: __RAW_OPENWATER_FALSELAND_FRAC__ (0.02).
  let openWaterDegraded = false;
  try {
    const _w2 = typeof window !== 'undefined' ? window : {};
    if (painted > 0 && neFull && _w2.__RAW_DISABLE_OPENWATER_PLAUSIBILITY__ !== true && rw > 8 && rh > 8) {
      const sx = Math.round(rx), sy = Math.round(ry), sw = Math.floor(rw), sh = Math.floor(rh);
      const cur = ctx.getImageData(sx, sy, sw, sh).data;
      const ne = neFull.getContext('2d', { willReadFrequently: true }).getImageData(sx, sy, sw, sh).data;
      const step = Math.max(4, Math.floor(Math.min(sw, sh) / 64));
      const ring = Math.max(4, step);                    // "open" = NE water with clear NE water around it
      let neOpen = 0, falseLand = 0;
      for (let y = ring; y < sh - ring; y += step) {
        for (let x = ring; x < sw - ring; x += step) {
          const i = (y * sw + x) * 4;
          if (ne[i] < 200) continue;                     // NE land/coast at the sample
          const iN = ((y - ring) * sw + x) * 4, iS = ((y + ring) * sw + x) * 4;
          const iW = (y * sw + (x - ring)) * 4, iE = (y * sw + (x + ring)) * 4;
          if (ne[iN] < 200 || ne[iS] < 200 || ne[iW] < 200 || ne[iE] < 200) continue; // near an NE coastline
          neOpen++;
          if (cur[i] < 30) falseLand++;                  // hard black over NE open water
        }
      }
      const frac = neOpen > 50 ? falseLand / neOpen : 0;
      const maxFrac = Number(_w2.__RAW_OPENWATER_FALSELAND_FRAC__) || 0.02;
      openWaterDegraded = frac > maxFrac;
      if (_w2.__RAW_GPU__) {
        _w2.__RAW_GPU__.openWaterVerdict = { neOpen, falseLand, frac: +frac.toFixed(4), degraded: openWaterDegraded };
      }
    }
  } catch (e) { /* verdict is best-effort — the paint stands, at worst hysteresis-locked as before */ }

  // Truthy result preserves every `if (!applied)` caller; `degraded` marks a parent-vulnerable
  // OR implausible (open-water false-land) paint that must NOT be hysteresis-locked or become a
  // patch-carry source.
  return painted > 0 ? { painted, degraded: usedSourceFallback || openWaterDegraded } : false;
}

// ── SHELTERED-WATER CLASSIFIER ──────────────────────────────────────────────────────────────────
// Pure grid core (exported for tests): given a binary water grid, mark water pixels that cannot
// reach the border through a channel of half-width > nPx. Erode water by nPx (Chebyshev distance
// to land), flood-fill the eroded core from the border, then re-dilate the flooded core by nPx —
// water not covered is enclosed. Two-pass chamfer transforms + one BFS: O(w·h).
export function classifySheltered(water, w, h, nPx) {
  const INF = 0x3fffffff;
  const size = w * h;
  // distance-to-LAND (Chebyshev, 8-neighbour chamfer)
  const dist = new Int32Array(size);
  for (let i = 0; i < size; i++) dist[i] = water[i] ? INF : 0;
  const chamfer = (d) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (d[i] === 0) continue;
        let m = d[i];
        if (x > 0 && d[i - 1] + 1 < m) m = d[i - 1] + 1;
        if (y > 0) {
          const up = i - w;
          if (d[up] + 1 < m) m = d[up] + 1;
          if (x > 0 && d[up - 1] + 1 < m) m = d[up - 1] + 1;
          if (x < w - 1 && d[up + 1] + 1 < m) m = d[up + 1] + 1;
        }
        d[i] = m;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (d[i] === 0) continue;
        let m = d[i];
        if (x < w - 1 && d[i + 1] + 1 < m) m = d[i + 1] + 1;
        if (y < h - 1) {
          const dn = i + w;
          if (d[dn] + 1 < m) m = d[dn] + 1;
          if (x > 0 && d[dn - 1] + 1 < m) m = d[dn - 1] + 1;
          if (x < w - 1 && d[dn + 1] + 1 < m) m = d[dn + 1] + 1;
        }
        d[i] = m;
      }
    }
  };
  chamfer(dist);
  // BFS the ERODED core (dist > nPx) from every border core pixel.
  const flooded = new Uint8Array(size);
  const queue = new Int32Array(size);
  let qh = 0, qt = 0;
  const push = (i) => { if (!flooded[i] && dist[i] > nPx) { flooded[i] = 1; queue[qt++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + (w - 1)); }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  // distance-to-FLOODED-core; open water = within nPx of the core. Water beyond it is enclosed.
  const dist2 = new Int32Array(size);
  for (let i = 0; i < size; i++) dist2[i] = flooded[i] ? 0 : INF;
  chamfer(dist2);
  const sheltered = new Uint8Array(size);
  let count = 0;
  for (let i = 0; i < size; i++) {
    if (water[i] && dist2[i] > nPx) { sheltered[i] = 1; count++; }
  }
  // MINIMUM-AREA FILTER (live calibration 2026-07-04, "breaks in the heatmap between islands"):
  // a long NARROW passage between islands also fails the erode-flood reachability test, but it is
  // open fairway, not an enclosed basin — suppressing it punched blocky gaps into the heatmap at
  // z12–16. Keep only basin-scale components: connected sheltered regions smaller than ~(4·nPx)²
  // pixels (≈ a few km² at the default gap) are released back to open water. True lagoons and
  // harbor basins are orders of magnitude larger.
  if (count) {
    const minArea = 16 * nPx * nPx;
    const nearOpen = 2 * nPx;   // "next to the open core" distance for the passage-vs-canal test
    const seen = new Uint8Array(size);
    const comp = new Int32Array(size);
    for (let s = 0; s < size; s++) {
      if (!sheltered[s] || seen[s]) continue;
      let ch = 0, ct = 0, near = 0;
      comp[ct++] = s; seen[s] = 1;
      while (ch < ct) {
        const i = comp[ch++];
        if (dist2[i] <= nearOpen) near++;
        const x = i % w, y = (i / w) | 0;
        if (x > 0 && sheltered[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; comp[ct++] = i - 1; }
        if (x < w - 1 && sheltered[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; comp[ct++] = i + 1; }
        if (y > 0 && sheltered[i - w] && !seen[i - w]) { seen[i - w] = 1; comp[ct++] = i - w; }
        if (y < h - 1 && sheltered[i + w] && !seen[i + w]) { seen[i + w] = 1; comp[ct++] = i + w; }
      }
      // Release a small component ONLY when it is genuinely a PASSAGE — most of it hugs the open
      // core (inter-island fairways, the round-3 "breaks between islands" catch). A long dead-end
      // urban canal (Canal Grande, live z16 catch) touches the core only at its mouth, so it stays
      // suppressed no matter how small its area is.
      if (ct < minArea && near > ct * 0.5) {
        for (let k = 0; k < ct; k++) sheltered[comp[k]] = 0;
        count -= ct;
      }
    }
  }
  return { sheltered, count };
}

// ── BASIN-VERDICT CACHE (2026-07-04, "heatmap on Canal Grande" with a REGIONAL grid resident) ────
// Sheltered truth can only be classified on basin-scale canvases (≥0.5° span), but the canvases
// that RESOLVE urban canals are the crisp deep-zoom overlays (≤0.1° span, classifier skipped by
// design — a window smaller than a basin mis-classifies). Bridge: every basin-scale classification
// stashes its downsampled verdict here; small canvases DARKEN themselves with the finest cached
// verdict that contains them. Darken = per-pixel min, so the verdict only ever REMOVES wash from
// water (land stays land, open water untouched) — the round-6 halo class cannot happen.
const _basinVerdicts = [];
const BASIN_VERDICT_MAX = 3;

// Pure selection: the finest-resolution cached verdict whose bounds CONTAIN the target bounds.
// Exported for tests.
export function pickBasinVerdict(entries, bounds) {
  let best = null;
  for (const e of entries) {
    if (!e || !e.bounds) continue;
    if (e.bounds.west <= bounds.west && e.bounds.east >= bounds.east &&
        e.bounds.south <= bounds.south && e.bounds.north >= bounds.north) {
      if (!best || e.mPerPx < best.mPerPx) best = e;
    }
  }
  return best;
}

function stashBasinVerdict(entry) {
  // Replace any older entry with identical bounds, newest first, cap the list.
  for (let i = _basinVerdicts.length - 1; i >= 0; i--) {
    const b = _basinVerdicts[i].bounds;
    if (b.west === entry.bounds.west && b.east === entry.bounds.east &&
        b.south === entry.bounds.south && b.north === entry.bounds.north) {
      _basinVerdicts.splice(i, 1);
    }
  }
  _basinVerdicts.unshift(entry);
  while (_basinVerdicts.length > BASIN_VERDICT_MAX) _basinVerdicts.pop();
}

// Darken a small (crisp) canvas with the cached basin verdict: the verdict's sheltered pixels are
// RGBA(64,64,64,255) and its open pixels are transparent, so a 'darken' draw min()s the sheltered
// blocks into the mask (water 255 → 64, below the 0.5 heatmap discard and 0.3 particle cull) and
// leaves everything else untouched. Blocky at the verdict's ds resolution — acceptable: it only
// dims water, never paints wash where truth says land.
export function applyCachedShelteredVerdict(canvas, bounds) {
  if (!canvas || !bounds) return { applied: false, fromCache: true, reason: 'no_canvas' };
  const hit = pickBasinVerdict(_basinVerdicts, bounds);
  if (!hit) return { applied: false, fromCache: true, reason: 'no_containing_verdict' };
  if (!hit.ds || !hit.count) return { applied: true, fromCache: true, shelteredFrac: 0, mPerPx: hit.mPerPx };
  try {
    const project = makeMaskProjector(hit.bounds, hit.dsW, hit.dsH);
    const [sx0, sy0] = project(bounds.west, bounds.north);
    const [sx1, sy1] = project(bounds.east, bounds.south);
    const sx = Math.min(sx0, sx1), sy = Math.min(sy0, sy1);
    const sw = Math.abs(sx1 - sx0), sh = Math.abs(sy1 - sy0);
    if (sw < 0.5 || sh < 0.5) return { applied: false, fromCache: true, reason: 'degenerate_subrect' };
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const prevSmooth = ctx.imageSmoothingEnabled;
    const prevComp = ctx.globalCompositeOperation;
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'darken';
    ctx.drawImage(hit.ds, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = prevComp;
    ctx.imageSmoothingEnabled = prevSmooth;
    return { applied: true, fromCache: true, mPerPx: hit.mPerPx, verdictBounds: hit.bounds };
  } catch (e) {
    return { applied: false, fromCache: true, reason: 'draw_failed' };
  }
}

// Canvas wrapper: downsample the finished mask, classify, and repaint enclosed water to 0.25.
// Close-zoom tiers only (<10° span) — coarser masks can't resolve entrance widths anyway.
// opts.gapM overrides the channel gap (the NARROW-WATER pass reuses this whole pipeline at
// canal scale); opts.stash=false keeps a non-basin verdict out of the basin cache.
export function suppressShelteredWater(canvas, bounds, opts) {
  if (!canvas || !bounds || typeof document === 'undefined') return false;
  const spanLon = (bounds.east < bounds.west) ? (bounds.east + 360) - bounds.west : bounds.east - bounds.west;
  if (spanLon >= 10 || spanLon <= 0) return false;
  // 1000 m default: seals every Venice inlet (widest ~900 m — at 600 the Porto di Lido stayed open
  // and its channel network kept animating, live user report) while Golden-Gate-class entrances
  // (≥1.6 km) stay open. Seas larger than the mask tile always touch the canvas border and are
  // open by construction, so the gap only ever decides basins smaller than ~1-2°.
  const gapM = (opts && opts.gapM) ||
    (typeof window !== 'undefined' && Number(window.__RAW_SHELTERED_GAP_M__)) || 1000;
  const dsW = Math.min(1024, canvas.width);
  const scale = dsW / canvas.width;
  const dsH = Math.max(2, Math.round(canvas.height * scale));
  const latMid = (bounds.north + bounds.south) / 2;
  const mPerPx = (spanLon * 111320 * Math.abs(Math.cos(latMid * Math.PI / 180))) / dsW;
  const nPx = Math.max(1, Math.round((gapM / 2) / Math.max(1e-6, mPerPx)));
  if (nPx > 48) return false;   // extreme zoom-in: entrances resolve wider than the analysis radius
  const ds = document.createElement('canvas');
  ds.width = dsW; ds.height = dsH;
  const dctx = ds.getContext('2d', { willReadFrequently: true });
  if (!dctx) return false;
  // Smoothing ON (2026-07-04, the Canal Grande mottle): nearest-sampling a sub-ds-pixel canal
  // (60 m canal vs 76 m/px ds) hits it only ~1 cell in 3 — the classifier sees a broken run and
  // the missed stretches re-open as wash at deep zoom. Area-averaging makes any cell that is
  // mostly water read ≥128 → thin canals become CONNECTED 1-px water lines and classify
  // coherently. The classify-time source holds only 0/255 (the sheltered stamp lands after), so
  // averaging never mixes verdict gray into the water grid.
  dctx.imageSmoothingEnabled = true;
  dctx.drawImage(canvas, 0, 0, dsW, dsH);
  const img = dctx.getImageData(0, 0, dsW, dsH);
  const px = img.data;
  const size = dsW * dsH;
  const water = new Uint8Array(size);
  for (let i = 0; i < size; i++) water[i] = px[i * 4] >= 128 ? 1 : 0;
  const doStash = !opts || opts.stash !== false;
  const { sheltered, count } = classifySheltered(water, dsW, dsH, nPx);
  if (!count) {
    // Stash the ALL-OPEN verdict too: a crisp canvas inside this region must prefer "nothing
    // sheltered here" over a coarser stale entry that might still contain it.
    if (doStash) stashBasinVerdict({ bounds: { ...bounds }, mPerPx: Math.round(mPerPx), ds: null, dsW, dsH, count: 0 });
    return { applied: true, shelteredFrac: 0, nPx, mPerPx: Math.round(mPerPx) };
  }
  // MORPHOLOGICAL CLOSE (dilate+erode by 1, 4-neighbour): a sub-pixel canal (Canal Grande is
  // ~60 m vs 76 m/px ds) samples as a BROKEN run — the gap pixels read as land, never classify,
  // and re-open as mottled wash blocks at deep zoom (live 2026-07-04). Closing bridges 1-2 px
  // gaps without moving the outer sheltered boundary (dilate-then-erode is identity on solid
  // blobs). Bridged pixels can lie on ds-land — harmless: 0.25 sits below every render threshold
  // and the crisp-canvas darken path min()s against true land anyway.
  {
    const dil = new Uint8Array(size);
    for (let y = 0; y < dsH; y++) {
      for (let x = 0; x < dsW; x++) {
        const i = y * dsW + x;
        if (!sheltered[i]) continue;
        dil[i] = 1;
        if (x > 0) dil[i - 1] = 1;
        if (x < dsW - 1) dil[i + 1] = 1;
        if (y > 0) dil[i - dsW] = 1;
        if (y < dsH - 1) dil[i + dsW] = 1;
      }
    }
    for (let y = 0; y < dsH; y++) {
      for (let x = 0; x < dsW; x++) {
        const i = y * dsW + x;
        if (!dil[i]) { sheltered[i] = 0; continue; }
        sheltered[i] = ((x === 0 || dil[i - 1]) && (x === dsW - 1 || dil[i + 1]) &&
                        (y === 0 || dil[i - dsW]) && (y === dsH - 1 || dil[i + dsW])) ? 1 : 0;
      }
    }
  }
  // Paint enclosed water 0.25 (64) and stamp back at full resolution, hard-edged.
  for (let i = 0; i < size; i++) {
    if (sheltered[i]) { px[i * 4] = 64; px[i * 4 + 1] = 64; px[i * 4 + 2] = 64; px[i * 4 + 3] = 255; }
    else { px[i * 4 + 3] = 0; }
  }
  dctx.putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(ds, 0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = prevSmooth;
  // Stash the verdict canvas (sheltered = gray, open = transparent) for crisp deep-zoom canvases.
  if (doStash) stashBasinVerdict({ bounds: { ...bounds }, mPerPx: Math.round(mPerPx), ds, dsW, dsH, count });
  return { applied: true, shelteredFrac: +(count / Math.max(1, size)).toFixed(4), nPx, mPerPx: Math.round(mPerPx) };
}

// Mask canvas width tier by the MASK BOUNDS' longitude span (pure; exported for tests).
// <10°-span tiles get 4096x2048 (2026-07-04, Long Beach report): at 2048 a ~6° tile is still
// ~330 m/px — harbor/inlet edges stair-step visibly at z10+ even with the 10m polygons.
// 10-30° (mid clips) keep 2048 (≤0.015°/px — already sub-pixel at those zooms).
// WORLD spans get 4096 too (2026-07-05, "land coastline shows over the heatmap below ~z5.8,
// corrects at z6.1"): while the GLOBAL grid is resident the mask bounds span 360°, so the old
// 1024x512 world tier = ~0.35°/px (~39 km) — the mask edge retreated a grey band (~15-25 px at
// z4.9) from every coastline and islands ballooned into blobs; the same view at mid/fine
// residency uses the finer tiers and adheres, which is why zooming past ~z6 "corrected" it.
// 4096 over 360° = ~0.088°/px (~10 km): the band shrinks to ~4 px at z4.9. Cost: one 32 MB
// texture + a 100-250 ms world polygon paint amortized by the pristine-canvas LRU below.
// Live override for the world tier: window.__RAW_WORLD_MASK_WIDTH__ (1024 restores legacy).
export function maskCanvasWidthForSpan(lonSpan) {
  if (lonSpan < 10) return 4096;
  if (lonSpan < 30) return 2048;
  const ov = typeof window !== 'undefined' ? Number(window.__RAW_WORLD_MASK_WIDTH__) : 0;
  return ov > 0 ? ov : 4096;
}

// MASK DENSITY HELPERS (2026-07-06, the mask no-downgrade retain — pure, exported for tests).
// Density = horizontal px per degree of a mask texture over its own bounds; the retain guard in
// the texture encoder compares the RESIDENT texture's density against what a rebuild for the
// incoming grid bounds WOULD produce (tier table above), so a mid-tier commit (span 10-30° →
// 2048 tier ≈ 870 m/px at span 16) can't replace a crisp coastal mask for the second before the
// fine grid returns — the Florida z9-10.5 "waves over land + intracoastal" transient.
export function maskDensityPxPerDeg(dims, b) {
  if (!dims || !dims.w || !b) return 0;
  const span = (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west;
  return span > 0 ? dims.w / span : 0;
}
export function incomingMaskDensityPxPerDeg(bounds) {
  if (!bounds) return 0;
  const span = (bounds.east < bounds.west) ? (bounds.east + 360) - bounds.west : bounds.east - bounds.west;
  return span > 0 ? maskCanvasWidthForSpan(span) / span : 0;
}

// Pristine-canvas LRU for renderMaskToCanvas (see comment at its cache-read site).
const _maskCanvasCache = new Map();
let _maskCanvasCacheGeo = null;
const MASK_CANVAS_CACHE_MAX = 3;

export function renderMaskToCanvas(geojson, bounds, opts) {
  // Base resolution 1024x512 avoids massive rendering/memory overhead on high-DPI (Retina) screens;
  // linear filtering (gl.LINEAR) keeps the clipping smooth. REGIONAL grids get 2048x1024 (2026-07-02):
  // on a ~3° coastal tile 1024px is ~340 m/px — too coarse for barrier islands/inlets, which is the
  // residual crest LAND-BLEED the user saw at z9.1 even with the 10m polygons loaded. 2048x1024 on a
  // small tile is ~170 m/px for one extra 8 MB texture — only paid when the tile is regional (<30°),
  // so the global mask keeps the cheap footprint.
  const _lonSpanFor = (b) => {
    if (!b) return 360;
    return (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west;
  };
  const lonSpan = _lonSpanFor(bounds);
  const isRegional = lonSpan < 30;
  let width = maskCanvasWidthForSpan(lonSpan);
  // opts.maxWidth: small viewport OVERLAY canvases cap at 2048 — the 4096 tier costs 4× the paint
  // + texImage2D upload and its extra density is wasted on a ≤1° box (stair-climb choppiness fix).
  if (opts && opts.maxWidth && width > opts.maxWidth) width = opts.maxWidth;
  const height = width / 2;
  // PRISTINE-CANVAS LRU (zoom-in/out choppiness): every commit re-renders this canvas — 100-250 ms
  // of main-thread polygon fill — and cycling zoom bands re-commits the SAME few bounds over and
  // over. A hit returns a fast BLIT COPY (callers mutate their canvas; the cached one stays
  // pristine). Keyed on geojson identity + bounds + size; 3 entries ≈ ≤96 MB worst-case, cleared
  // whenever the land geojson upgrades. Kill: window.__RAW_DISABLE_MASK_CANVAS_CACHE__ = true.
  const cacheOn = typeof window === 'undefined' || window.__RAW_DISABLE_MASK_CANVAS_CACHE__ !== true;
  const cacheKey = (bounds ? `${bounds.west}_${bounds.south}_${bounds.east}_${bounds.north}` : 'global') + `_${width}`;
  if (cacheOn) {
    if (_maskCanvasCacheGeo !== geojson) { _maskCanvasCache.clear(); _maskCanvasCacheGeo = geojson; }
    const hit = _maskCanvasCache.get(cacheKey);
    if (hit) {
      _maskCanvasCache.delete(cacheKey); _maskCanvasCache.set(cacheKey, hit); // LRU touch
      const copy = document.createElement('canvas');
      copy.width = hit.width; copy.height = hit.height;
      copy.getContext('2d', { willReadFrequently: true }).drawImage(hit, 0, 0);
      return copy;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  if (!geojson?.features?.length) return canvas;
  
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  
  const { west, south, east, north } = bounds;

  // Web Mercator projection helpers
  const latToMercatorY = (l) => {
    const latClamped = Math.max(-85.051129, Math.min(85.051129, l));
    const rad = latClamped * Math.PI / 180;
    return (1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0;
  };

  const center = getCenterLng(west, east);
  const wrappedWest = wrapLngRelative(west, center);
  const wrappedEast = wrapLngRelative(east, center);

  const mercMinX = (wrappedWest + 180.0) / 360.0;
  const mercMaxX = (wrappedEast + 180.0) / 360.0;
  const mercMinY = latToMercatorY(north); // North maps to smaller Mercator Y
  const mercMaxY = latToMercatorY(south); // South maps to larger Mercator Y
  
  const mercXSpan = mercMaxX - mercMinX;
  const mercYSpan = mercMaxY - mercMinY;
  
  function project(lng, lat) {
    const projectedLng = wrapLngRelative(lng, center);
    const mx = (projectedLng + 180.0) / 360.0;
    const my = latToMercatorY(lat);

    // Normalize and scale to canvas dimensions
    const x = ((mx - mercMinX) / mercXSpan) * width;
    const y = ((my - mercMinY) / mercYSpan) * height;
    return [x, y];
  }
  // Continuous-ring variant: the longitude is already placed (unwrapRingLngs) — do NOT re-wrap it.
  function projectRaw(lng, lat) {
    const mx = (lng + 180.0) / 360.0;
    const my = latToMercatorY(lat);
    return [((mx - mercMinX) / mercXSpan) * width, ((my - mercMinY) / mercYSpan) * height];
  }
  
  const isGlobalTarget = (east - west) >= 359.0;
  
  geojson.features.forEach(feature => {
    const geom = feature.geometry;
    if (!geom) return;

    // 1. Calculate & cache bounding box for this feature
    if (!feature._bbox) {
      let fWest = Infinity, fEast = -Infinity, fSouth = Infinity, fNorth = -Infinity;
      const updateBBox = (pt) => {
        const lng = pt[0];
        const lat = pt[1];
        if (lng < fWest) fWest = lng;
        if (lng > fEast) fEast = lng;
        if (lat < fSouth) fSouth = lat;
        if (lat > fNorth) fNorth = lat;
      };
      if (geom.type === 'Polygon') {
        geom.coordinates.forEach(ring => ring.forEach(updateBBox));
      } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach(poly => poly.forEach(ring => ring.forEach(updateBBox)));
      }
      feature._bbox = { west: fWest, south: fSouth, east: fEast, north: fNorth };
    }

    // 2. Perform bounding box intersection check
    if (!isGlobalTarget) {
      const fb = feature._bbox;
      const pad = 1.0;
      const fCenter = (fb.west + fb.east) * 0.5;
      const projectedFCenter = wrapLngRelative(fCenter, center);
      const halfSpan = (fb.east - fb.west) * 0.5;
      const fWestWrapped = projectedFCenter - halfSpan;
      const fEastWrapped = projectedFCenter + halfSpan;
      
      const overlapX = (fWestWrapped <= wrappedEast + pad) && (fEastWrapped >= wrappedWest - pad);
      const overlapY = (fb.south <= north + pad) && (fb.north >= south - pad);
      
      if (!overlapX || !overlapY) {
        return; // Skip rendering this feature completely
      }
    }
    
    const drawPolygon = (coords) => {
      // Per-POLYGON cull on regional targets (2026-07-03): the feature-level bbox test above is
      // useless against continent-scale 10m features — a member polygon on the far side of the
      // globe wraps its projected x by ±360° near the anti-center meridian and its fill sweeps the
      // whole canvas black (the dead-crest close-zoom state). Only draw member polygons whose own
      // bbox is actually near the target box.
      if (!isGlobalTarget && !polygonOverlapsTarget(getPolygonBbox(coords), wrappedWest, wrappedEast, south, north, center)) {
        return;
      }
      // ANTIMERIDIAN RING UNWRAP (see unwrapRingLngs): trace each ring CONTINUOUSLY and place it at
      // the 360° offsets that actually overlap the window. Without this, a ring straddling the
      // anti-center meridian (Afro-Eurasia when the viewport sits near ±180) teleports 360° mid-path
      // and floods the whole canvas black — the N-Pacific rectangle.
      if (maskRingUnwrapEnabled()) {
        const rings = [];
        let rMin = Infinity, rMax = -Infinity;
        coords.forEach((ring) => {
          if (!ring || !ring.length) return;
          const u = unwrapRingLngs(ring, center);
          rings.push({ ring, lngs: u.lngs });
          if (u.min < rMin) rMin = u.min;
          if (u.max > rMax) rMax = u.max;
        });
        if (!rings.length) return;
        const offsets = ringCopyOffsets(rMin, rMax, wrappedWest, wrappedEast);
        for (const off of offsets) {
          ctx.beginPath();
          for (const r of rings) {
            for (let i = 0; i < r.ring.length; i++) {
              const [px, py] = projectRaw(r.lngs[i] + off, r.ring[i][1]);
              if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        return;
      }
      ctx.beginPath();
      coords.forEach((ring) => {
        if (!ring || !ring.length) return;
        ring.forEach((pt, ptIdx) => {
          const [px, py] = project(pt[0], pt[1]);
          if (ptIdx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    if (geom.type === 'Polygon') {
      drawPolygon(geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(polyCoords => drawPolygon(polyCoords));
    }
  });

  // Store a PRISTINE copy for the LRU (the returned canvas gets mutated by the basemap/wetland/
  // sheltered painters); a later same-bounds render becomes a ~5-10 ms blit instead of a
  // 100-250 ms polygon fill.
  if (cacheOn) {
    try {
      const keep = document.createElement('canvas');
      keep.width = canvas.width; keep.height = canvas.height;
      keep.getContext('2d').drawImage(canvas, 0, 0);
      _maskCanvasCache.delete(cacheKey);
      _maskCanvasCache.set(cacheKey, keep);
      while (_maskCanvasCache.size > MASK_CANVAS_CACHE_MAX) {
        _maskCanvasCache.delete(_maskCanvasCache.keys().next().value);
      }
    } catch (e) { /* caching is an optimization only */ }
  }

  return canvas;
}

import { getCenterLng, wrapLngRelative } from './mapUtils';
import { applyInlandWaterGuard, snapshotNeTruth } from './inlandWaterGuard';
// ⚠️ Imported AND re-exported below. `export { x } from './y'` forwards a name without binding it
// in this module's scope, so the re-export block alone leaves every call site here undefined —
// ESLint no-undef caught exactly that on the first pass of this split.
import {
  makeMaskProjector, maskRingUnwrapEnabled, unwrapRingLngs, ringCopyOffsets,
  polygonOverlapsTarget, getPolygonBbox,
} from './marineMaskProjection';
import { suppressShelteredWater, applyCachedShelteredVerdict } from './marineMaskShelter';

// ── THE PUBLIC SURFACE IS UNCHANGED ──────────────────────────────────────────────────────────────
// This file was 1098 lines against the repo's 800-line governance limit. Two self-contained seams
// moved out (2026-07-29) — the projection/antimeridian geometry and the sheltered-water
// classifier — and everything they exported is re-exported here BY NAME. Nothing that imports
// this module had to change, and no test had to change, which is what makes the split provably
// behaviour-preserving rather than merely intended to be.
//
// New code should import from the specific module; these re-exports exist so the move cost
// nothing, not to make this the permanent front door.
export {
  getPolygonBbox, polygonOverlapsTarget, unwrapRingLngs, ringCopyOffsets,
  maskRingUnwrapEnabled, makeMaskProjector,
} from './marineMaskProjection';
export {
  classifySheltered, pickBasinVerdict, applyCachedShelteredVerdict, suppressShelteredWater,
} from './marineMaskShelter';


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
/**
 * ISLAND RE-ASSERT GATE — pure, exported so the threshold is testable rather than inline.
 *
 * ⭐ 1200 → 400 (2026-08-17), and this is the ISLAND-HALO fix. The re-assert MULTIPLIES coarse
 * Natural Earth land back over the accurate basemap-derived mask, so wherever NE's generalized
 * coastline bulges seaward of the real one it FORCES the mask to land and the marine field is
 * carved off real water. Measured at Madeira z9.30, per bearing, on the deployed build:
 *
 *     leg                       visible band    onset median   worst bearing
 *     stock (gate 1200)            15 px            5 px       75° @ 57 px
 *     re-assert DISABLED            3 px            0 px       255° @ 28 px
 *     gate = 400                    3 px            0 px       255° @ 28 px
 *
 * The waves-OFF baseline is 2 px, so gate=400 returns the coast to the basemap's own edge, and it
 * reproduces the fully-disabled result exactly while KEEPING the re-assert where it was justified.
 *
 * ⛔ WHY NOT SIMPLY DISABLE IT: it exists because the basemap's water polygons DROP small islands,
 * which the ocean-white pass then floods — forensics measured Abaco 8–17% flooded at a z9 mask of
 * **205 px/deg**, re-assert → 0. That evidence stands.
 *
 * ★ THE GATE WAS COMPARING THE WRONG PAIR. It asks whether the MASK's texel is coarser than NE, but
 * what decides whether NE HELPS is whether the BASEMAP is coarser than NE. At 205 px/deg the mask is
 * coarse and NE genuinely adds detail; the viewport overlay runs at ~850 px/deg (a 2048 canvas over
 * ~2.4°) where the basemap is far finer than NE 10m and NE only corrupts. 400 separates the two:
 * it keeps 205 (Abaco) and world masks (~11), and excludes the overlay (850) and the base (~1720).
 *
 * Tune/kill: `__RAW_ISLAND_REASSERT_MAX_DENSITY__`, `__RAW_DISABLE_ISLAND_REASSERT__`.
 */
export const ISLAND_REASSERT_MAX_DENSITY = 400;
export function islandReassertEnabled(opts) {
  const o = opts || {};
  if (o.killed) return false;
  const d = o.densityPxPerDeg;
  if (typeof d !== 'number' || !isFinite(d) || d <= 0) return false;   // unknown => do not corrupt
  const max = (typeof o.maxDensity === 'number' && isFinite(o.maxDensity) && o.maxDensity > 0)
    ? o.maxDensity : ISLAND_REASSERT_MAX_DENSITY;
  return d < max;
}

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
    const _maxDensity = (typeof window !== 'undefined') ? Number(window.__RAW_ISLAND_REASSERT_MAX_DENSITY__) : NaN;
    if (islandReassertEnabled({ densityPxPerDeg: _densityPxDeg, maxDensity: _maxDensity, killed: _raOff })) {
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

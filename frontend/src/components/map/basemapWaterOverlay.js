// BASEMAP-WATER TRUTH OVERLAY, moved out of WebGLMarineMaskRenderer.js (2026-10-20) byte for byte, so the painter
// could become a resumable step generator without pushing the renderer over the 800-line cap. The renderer
// re-exports every name below, so no importer changed.
import { applyInlandWaterGuardSteps, snapshotNeTruth } from './inlandWaterGuard';
import { makeMaskProjector, maskRingUnwrapEnabled, unwrapRingLngs, ringCopyOffsets } from './marineMaskProjection';
import { suppressShelteredWaterSteps, applyCachedShelteredVerdict } from './marineMaskShelter';
import { fastLandMaskOn, sampleOpenWaterDamage, rectRowReader, captureNeRows, ringCopiesTouchRect, latRangeOf } from './maskFastPaths';

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
    // No basemap water source at all (the A15-17 fallback style): fail open WITHOUT asking, because
    // isSourceLoaded fires a map `error` event for an unknown source id on every mask refresh.
    if (typeof mapInstance.getSource === 'function' && !mapInstance.getSource(waterSource)) return true;
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

// Resolve the existing finest-tile selection before allocating a refresh canvas. The packet is
// owned by one synchronous paint attempt; never cache it across tile arrivals or map events.
export function prepareBasemapWaterOverlay(mapInstance) {
  if (!mapInstance || typeof mapInstance.querySourceFeatures !== 'function') return null;
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
      return null;
    }
  }
  if (!feats || !feats.length) return null;
  return { waterSource, feats, usedSourceFallback };
}

// SLICED PAINT (2026-10-20, owner-gated prototype): the painter is a step GENERATOR over inputs read from the map ONCE
// (snapshotOverlayInputs: water features, strict viewport, wetland features). overlayBasemapWaterOnMask runs it to
// completion inside one call, so the default path makes the same canvas calls in the same order as before (a yield
// adds none). maskSliceScheduler.js runs the SAME steps across tasks; a yield of 1 follows a recorded draw, a string names the pass just finished.
export function snapshotOverlayInputs(mapInstance, preparedWater) {
  if (!mapInstance || typeof mapInstance.querySourceFeatures !== 'function') return null;
  const water = preparedWater || prepareBasemapWaterOverlay(mapInstance);
  if (!water) return null;

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
    return null;
  }
  // Step 4's wetland query, taken here with the others: same map state (one synchronous call), and a query has no side effect.
  const wetland = ['landuse_overlay', 'landcover'].map((sl) => {
    try { return mapInstance.querySourceFeatures(water.waterSource, { sourceLayer: sl }) || []; } catch (e) { return []; }
  });
  return { water, vb, wetland };
}

export function overlayBasemapWaterOnMask(canvas, bounds, mapInstance, preparedWater) {
  if (!canvas) return false;
  const inputs = snapshotOverlayInputs(mapInstance, preparedWater);
  if (!inputs) return false;
  const steps = overlayBasemapWaterSteps(canvas, bounds, inputs);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

// Ocean/sea-class water polygons in feature order (the old forEachPoly callback, as an iterator a generator can yield in).
function* waterPolys(feats) {
  for (const f of feats) {
    const cls = f.properties && f.properties.class;
    if (cls !== undefined && cls !== 'ocean' && cls !== 'sea') continue;
    const geom = f.geometry;
    if (!geom) continue;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : (geom.type === 'MultiPolygon' ? geom.coordinates : null);
    if (!polys) continue;
    for (const poly of polys) yield poly;
  }
}

export function* overlayBasemapWaterSteps(canvas, bounds, inputs) {
  const { feats, usedSourceFallback } = inputs.water;
  const vb = inputs.vb;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const project = makeMaskProjector(bounds, canvas.width, canvas.height);

  // NE-truth snapshot BEFORE any painting (the canvas is NE-only at entry): the inland-water
  // guard below limits basemap-water trust to ~10 km of this truth. See inlandWaterGuard.js —
  // Mapbox Streets v8 water is class-less, so the ocean/sea class filter is a no-op on this
  // basemap and inland seas (Salton, Laguna Salada) would otherwise whiten as "ocean".
  const neSnapshot = snapshotNeTruth(canvas);
  yield 'neSnapshot';

  // FULL-RES NE capture for the island re-assert (step 3c): copy the pristine NE canvas BEFORE step
  // 1 destroys it, at full mask resolution. Gated by RESOLUTION, not zoom — re-assert only where the
  // mask texel (canvas.width / span, px per degree) is coarser than NE 10m's own resolution, so it
  // engages at every zoom the mask is coarse (z5-~z11) and self-disables where the basemap is
  // genuinely finer (z12+ meter tiles — re-asserting coarse NE there would blockify the coast).
  let neFull = null;
  let checkOpenWaterDamage = false;
  let islandOn = false;
  const fastOn = fastLandMaskOn();   // maskFastPaths.js: same bytes, less main thread
  try {
    const _raOff = typeof window !== 'undefined' && window.__RAW_DISABLE_ISLAND_REASSERT__ === true;
    const _span = (bounds.east < bounds.west ? bounds.east + 360 : bounds.east) - bounds.west;
    const _densityPxDeg = _span > 0 ? canvas.width / _span : 0;
    const _maxDensity = (typeof window !== 'undefined') ? Number(window.__RAW_ISLAND_REASSERT_MAX_DENSITY__) : NaN;
    // The pristine snapshot has two consumers with different density limits. A fine-basemap
    // coast must not be overwritten by NE, but partial tile queries still need damage detection.
    // `islandOn` is the ONLY thing that lets step 3c multiply NE land back: owning a snapshot for
    // damage detection must never switch the re-assert on (it bypassed the 400 px/deg gate and the
    // __RAW_DISABLE_ISLAND_REASSERT__ kill switch, bringing back the Madeira island halo).
    checkOpenWaterDamage = _densityPxDeg > 0 && _densityPxDeg < 1200 &&
      !(typeof window !== 'undefined' && window.__RAW_DISABLE_OPENWATER_PLAUSIBILITY__ === true);
    islandOn = islandReassertEnabled({ densityPxPerDeg: _densityPxDeg, maxDensity: _maxDensity, killed: _raOff });
    if (islandOn || (checkOpenWaterDamage && !fastOn)) {
      neFull = document.createElement('canvas');
      neFull.width = canvas.width; neFull.height = canvas.height;
      neFull.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0);
    }
  } catch (e) { neFull = null; islandOn = false; }
  yield 'neFull';

  // 1. Land-black the viewport patch (clipped to the canvas).
  const [px0, py0] = project(vb.west, vb.north);
  const [px1, py1] = project(vb.east, vb.south);
  const rx = Math.max(0, Math.min(px0, px1)), ry = Math.max(0, Math.min(py0, py1));
  const rw = Math.min(canvas.width, Math.max(px0, px1)) - rx;
  const rh = Math.min(canvas.height, Math.max(py0, py1)) - ry;
  if (rw <= 1 || rh <= 1) return false;
  let neRows = null;   // fast path: the Natural-Earth rows step 6 samples, read before the paint (= the neFull copy's rows)
  if (fastOn && checkOpenWaterDamage && rw > 8 && rh > 8) {
    try { neRows = captureNeRows(ctx, Math.round(rx), Math.round(ry), Math.floor(rw), Math.floor(rh)); } catch (e) { neRows = null; }
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.clip();
  ctx.fillStyle = '#000000';
  ctx.fillRect(rx, ry, rw, rh);

  // 2. Paint ocean/sea-class water white inside the patch. Features without a class are treated
  //    as ocean (some styles omit class on the open-ocean polygon). Polygon order: waterPolys above.
  // ANTIMERIDIAN-SAFE ring tracing (see unwrapRingLngs): identical tear risk to the NE tracer — a
  // water polygon straddling the projector's anti-center meridian would sweep the canvas white.
  const unwrapEnabled = maskRingUnwrapEnabled();
  // Fast path: shapes that cannot reach the viewport clip are skipped (maskFastPaths.js). `curPathCulled` says whether the
  // path the ORIGINAL code would hold now is a skipped one, so a following stroke() of "the current path" stays exact.
  const clipRect = fastOn ? { x0: rx, y0: ry, x1: rx + rw, y1: ry + rh } : null;
  let curPathCulled = false;
  const traceRings = (rings, fillRule, close = true, margin = 0) => {
    if (!unwrapEnabled) {
      curPathCulled = false;
      ctx.beginPath();
      for (const ring of rings) {
        if (!ring || !ring.length) continue;
        ring.forEach((pt, i) => {
          const [x, y] = project(pt[0], pt[1]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        if (close) ctx.closePath();
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
    const offsets = ringCopyOffsets(rMin, rMax, project.wrappedWest, project.wrappedEast);
    if (!offsets.length) return;
    if (clipRect) {
      const [latMin, latMax] = latRangeOf(rings.filter((r) => r && r.length));
      curPathCulled = !ringCopiesTouchRect(project.raw, rMin, rMax, latMin, latMax, offsets, clipRect, 2 + margin);
      if (curPathCulled) return;
    }
    for (const off of offsets) {
      ctx.beginPath();
      for (const r of prepared) {
        for (let i = 0; i < r.ring.length; i++) {
          const [x, y] = project.raw(r.lngs[i] + off, r.ring[i][1]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        if (close) ctx.closePath();
      }
      ctx.fill(fillRule || 'nonzero');
    }
  };
  // Fill-only passes skip closePath on the fast path (maskFastPaths.js: O(n^2) in Chrome; fill() closes subpaths itself).
  const fillCloses = !fastOn;

  ctx.fillStyle = '#ffffff';
  let painted = 0;
  for (const poly of waterPolys(feats)) { traceRings(poly, 'evenodd', fillCloses); painted++; yield 1; }

  // 3. RE-ASSERT LAND HOLES (the Venice regression, 2026-07-04): querySourceFeatures returns water
  //    polygons from EVERY loaded tile level — an overzoomed PARENT tile's simplified polygon has
  //    small land islands (Venice, Lido) simplified away, so painting it white erases the fine
  //    tile's correct hole. Second pass: every hole ring (land island) paints BLACK after all the
  //    whites, so the finest-detail land always wins regardless of tile paint order.
  ctx.fillStyle = '#000000';
  for (const poly of waterPolys(feats)) {
    for (let h = 1; h < poly.length; h++) {
      const ring = poly[h];
      if (!ring || !ring.length) continue;
      traceRings([ring], undefined, fillCloses);   // antimeridian-safe (same unwrap as the white pass)
    }
    if (poly.length > 1) yield 1;
  }

  // 3b. INLAND-WATER GUARD (2026-07-06, the Salton Sea / Laguna Salada leak): re-black painted
  //     water farther than ~10 km from NE water — the basemap refines the coastline, it cannot
  //     invent new seas. Runs BEFORE the wetland + sheltered passes so they classify the
  //     corrected water field. Kill: __RAW_DISABLE_INLAND_WATER_GUARD__; tune: __RAW_INLAND_WATER_KM__.
  {
    const gStats = yield* applyInlandWaterGuardSteps(canvas, neSnapshot, bounds);
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.inlandWaterGuard = gStats;
    }
  }
  yield 'inlandGuard';

  // 3c. ISLAND RE-ASSERT: the independent 400 px/degree gate decides whether to multiply NE
  //     land back. The damage detector also owns a snapshot, without overriding this gate.
  //     Runs AFTER the inland guard so it overrides any island the basemap flooded; the wetland +
  //     sheltered passes below only ever darken, so they can't re-flood it. Only darkens → the
  //     port-landfill/canal/sheltered verdicts (NE=water) are all preserved.
  try {
    const _span = (bounds.east < bounds.west ? bounds.east + 360 : bounds.east) - bounds.west;
    const _dens = _span > 0 ? Math.round(canvas.width / _span) : null;
    if (neFull && islandOn) {
      const rStats = reassertNeLand(canvas, neFull);
      if (typeof window !== 'undefined' && window.__RAW_GPU__) window.__RAW_GPU__.islandReassert = { ...rStats, densityPxDeg: _dens };
    } else if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      const off = window.__RAW_DISABLE_ISLAND_REASSERT__ === true;
      window.__RAW_GPU__.islandReassert = { applied: false, reason: off ? 'disabled' : 'fine_basemap', densityPxDeg: _dens };
    }
  } catch (e) { /* enhancement only — basemap patch stands */ }
  yield 'islandReassert';

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
    // path traceRings just filled; the ctx.restore() below reverts the stroke state (no leak into the
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
    for (const fs of inputs.wetland) {
      for (const f of fs) {
        const cls = f.properties && f.properties.class;
        const sub = f.properties && f.properties.subclass;
        if (cls !== 'wetland' && cls !== 'wetland_noveg' && sub !== 'wetland' && sub !== 'tidalflat') continue;
        const geom = f.geometry;
        if (!geom) continue;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : (geom.type === 'MultiPolygon' ? geom.coordinates : null);
        if (!polys) continue;
        for (const poly of polys) { traceRings(poly, 'evenodd', true, _wetDilate ? _wetDilPx + 2 : 0); if (_wetDilate && !curPathCulled) ctx.stroke(); _wetPainted++; yield 1; }
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
  yield 'wetland';

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
        const stats = yield* suppressShelteredWaterSteps(canvas, bounds);
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
          narrow = yield* suppressShelteredWaterSteps(canvas, bounds, { gapM: narrowM, stash: false });
        }
        if (typeof window !== 'undefined' && window.__RAW_GPU__) {
          window.__RAW_GPU__.shelteredWater = { basin: stats || { applied: false, fromCache: true }, narrow };
        }
      }
    }
  } catch (e) { /* classifier unavailable — open-water mask stands */ }
  yield 'shelter';

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
    if (painted > 0 && (fastOn ? neRows : neFull) && checkOpenWaterDamage && _w2.__RAW_DISABLE_OPENWATER_PLAUSIBILITY__ !== true && rw > 8 && rh > 8) {
      const sx = Math.round(rx), sy = Math.round(ry), sw = Math.floor(rw), sh = Math.floor(rh);
      const readNe = fastOn ? neRows : rectRowReader(neFull.getContext('2d', { willReadFrequently: true }), sx, sy, sw, sh, true);
      const { neOpen, falseLand } = sampleOpenWaterDamage(sw, sh, rectRowReader(ctx, sx, sy, sw, sh, !fastOn), readNe);
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

/**
 * backendWeatherServiceClientCoverage.js
 * 
 * Extracted coverage and bounding box calculations for backend weather service.
 * Owns the manifest cache state to avoid circular dependencies with the main client.
 */

// Manifest cache state - owned here to prevent circular imports
let cachedManifest = null;

export function getCachedManifest() {
  return cachedManifest;
}

export function setCachedManifest(manifest) {
  cachedManifest = manifest;
}

export const PILOT_COVERAGE = {
  west: -85.0,
  south: 24.0,
  east: -79.0,
  north: 31.0
};

export const REGIONAL_TILES = [
  {
    id: "florida_east_coast",
    bounds: { west: -85.0, south: 24.0, east: -79.0, north: 31.0 }
  },
  {
    id: "us_west_coast_socal",
    bounds: { west: -125.0, south: 30.0, east: -115.0, north: 38.0 }
  }
];

/**
 * Extracts active tile definitions dynamically from the backend products manifest.
 * Falls back to hardcoded REGIONAL_TILES if manifest is empty or not yet loaded.
 */
export function getAvailableTilesFromManifest(modelName = null, domainName = null, layerName = null, targetValidTime = null) {
  const cachedManifest = getCachedManifest();
  if (!cachedManifest || !Array.isArray(cachedManifest.products) || cachedManifest.products.length === 0) {
    return { tiles: REGIONAL_TILES, fallbackReason: 'manifest_not_loaded', hasTimeMatch: false };
  }
  
  const seen = new Set();
  const tiles = [];
  const filterModel = modelName ? modelName.toUpperCase() : null;
  const filterDomain = domainName ? domainName.toLowerCase() : null;
  const filterLayer = layerName ? layerName.toLowerCase() : null;
  let hasTimeMatch = false;
  
  for (const p of cachedManifest.products) {
    if (filterModel && p.model.toUpperCase() !== filterModel) continue;
    if (filterDomain && p.domain.toLowerCase() !== filterDomain) continue;
    if (filterLayer && p.layer.toLowerCase() !== filterLayer) continue;

    // Check valid_time availability if requested
    if (targetValidTime) {
      try {
        const targetMs = new Date(targetValidTime).getTime();
        const startMs = new Date(p.valid_time_start).getTime();
        const endMs = new Date(p.valid_time_end).getTime();
        if (targetMs >= startMs - 3 * 3600000 && targetMs <= endMs + 3 * 3600000) {
          hasTimeMatch = true;
        }
      } catch (e) { /* invalid date — skip time check */ }
    }

    let regionId = p.region_id;
    if (!regionId && p.coverage) {
      const isFlorida = Math.abs(p.coverage.west - (-85.0)) < 0.1 &&
                        Math.abs(p.coverage.south - 24.0) < 0.1 &&
                        Math.abs(p.coverage.east - (-79.0)) < 0.1 &&
                        Math.abs(p.coverage.north - 31.0) < 0.1;
      if (isFlorida) {
        regionId = "florida_east_coast";
      }
    }
    
    if (regionId) {
      const key = `${regionId}`;
      if (!seen.has(key)) {
        seen.add(key);
        tiles.push({
          id: regionId,
          bounds: p.coverage
        });
      }
    }
  }
  
  if (tiles.length === 0) {
    return { tiles: [], fallbackReason: 'no_matching_products', hasTimeMatch: false };
  }
  
  return { tiles, fallbackReason: null, hasTimeMatch: targetValidTime ? hasTimeMatch : true };
}

/**
 * Resolves the dynamic product coverage bounds from cachedManifest.
 * Falls back to PILOT_COVERAGE if manifest is not loaded or has no matching product.
 * Returns metadata indicating whether dynamic coverage or fallback was used.
 */
export function getProductCoverage(model = 'GFS', domain = 'marine', layer = 'waves') {
  let isDynamic = false;
  let coverage = PILOT_COVERAGE;
  
  const filterModel = (model || 'GFS').toUpperCase();
  const filterDomain = (domain || 'marine').toLowerCase();
  const filterLayer = (layer || 'waves').toLowerCase();

  const cachedManifest = getCachedManifest();
  const hasEmptyProducts = cachedManifest && Array.isArray(cachedManifest.products) && cachedManifest.products.length === 0;

  if (cachedManifest && Array.isArray(cachedManifest.products) && !hasEmptyProducts) {
    const p = cachedManifest.products.find(prod =>
      prod.model.toUpperCase() === filterModel &&
      prod.domain.toLowerCase() === filterDomain &&
      prod.layer.toLowerCase() === filterLayer
    );
    if (p && p.coverage) {
      coverage = p.coverage;
      isDynamic = true;
    }
  }

  return {
    coverage,
    isDynamic,
    isFallback: !isDynamic
  };
}

/**
 * Clamps or intersects the requested viewport bbox coordinates with the dynamic coverage limits.
 */
export function clampViewportBbox(requestedBbox, layerName = "waves", modelName = "GFS", domainName = null) {
  const inferredDomain = domainName || (layerName === 'wind' ? 'wind' : 'marine');

  if (!requestedBbox) {
    return {
      isInside: false,
      clampedBbox: null,
      fallbackReason: "Missing requested bounding box coordinates",
      coverageBounds: PILOT_COVERAGE,
      selectedTileId: null,
      availableTileIds: REGIONAL_TILES.map(t => t.id),
      rejectedTileIds: [],
      tileFallbackReason: null
    };
  }

  let west = requestedBbox.west;
  let south = requestedBbox.south;
  let east = requestedBbox.east;
  let north = requestedBbox.north;

  const isViewportEnabled = ['GFS', 'ICON', 'EURO'].includes((modelName || '').toUpperCase()) && (
    (inferredDomain === 'marine' && ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes((layerName || '').toLowerCase())) ||
    (inferredDomain === 'wind' && (layerName || '').toLowerCase() === 'wind')
  );

  if (isViewportEnabled) {
    if ((modelName || '').toUpperCase() === 'EURO') {
      // NULL-ISLAND ROOT (2026-07-06, chip task_57426922 — log-proven bbox=-10,-10,10,10 at
      // z2.49): the 20° cost-cap below, fed a WORLD viewport, centers itself on (0,0) ±10 — a
      // Gulf-of-Guinea request the user never looked at (far-hour scrubs then 404-looped on it).
      // Wide spans want the pre-ingested euro global_coarse MANIFEST product — the exact branch
      // GFS/ICON take further down (cheap, no Copernicus subset cost). The 20° cap below remains
      // the guard for genuinely regional dynamic subsets. Same lever as the GFS/ICON branch:
      // __RAW_MARINE_GLOBAL_SPAN__.
      const _euroSpanLng = east < west ? (180 - west) + (east + 180) : east - west;
      const _euroSpanLat = Math.abs(north - south);
      const _euroGlobalSpan = (typeof window !== 'undefined' && Number(window.__RAW_MARINE_GLOBAL_SPAN__)) || 15.0;
      if (_euroSpanLng > _euroGlobalSpan || _euroSpanLat > _euroGlobalSpan) {
        // Globalize ONLY when the wide viewport actually intersects EURO coverage (same
        // manifest-tile test as the outside_coverage_clear check below) — a wide viewport wholly
        // OUTSIDE coverage falls through and keeps the honest clear contract (pinned test).
        const _tr = getAvailableTilesFromManifest(modelName, inferredDomain, layerName);
        const _wideIntersects = (_tr.tiles || []).some(t => {
          const cov = t.bounds;
          let sW = west, sE = east; if (sE < sW) sE += 360;
          let cW = cov.west, cE = cov.east; if (cE < cW) cE += 360;
          const oLng = Math.max(sW, cW) < Math.min(sE, cE) ||
                       Math.max(sW - 360, cW) < Math.min(sE - 360, cE) ||
                       Math.max(sW + 360, cW) < Math.min(sE + 360, cE);
          const oLat = Math.max(south, cov.south) < Math.min(north, cov.north);
          return oLng && oLat;
        });
        if (_wideIntersects) {
          return {
            isInside: true,
            clampedBbox: { west: -180, south: -80, east: 180, north: 85 },
            fallbackReason: null,
            coverageBounds: { west: -180, south: -80, east: 180, north: 85 },
            selectedTileId: 'global_coarse',
            availableTileIds: REGIONAL_TILES.map(t => t.id),
            rejectedTileIds: [],
            tileFallbackReason: null
          };
        }
        // fall through: the 20° clamp + the coverage check below produce the honest clear
      }
      // Cap the maximum query span to 20.0 degrees to prevent timeouts/expensive downloads on zoomed-out views.
      const maxSpan = 20.0;
      
      // Calculate longitude center & span
      let spanLng = east < west ? (180 - west) + (east + 180) : east - west;
      if (spanLng > maxSpan) {
        let centerLng;
        if (east < west) {
          centerLng = ((west + east + 360) / 2) % 360;
        } else {
          centerLng = (west + east) / 2;
        }
        west = centerLng - maxSpan / 2;
        east = centerLng + maxSpan / 2;
        // Normalize to [-180, 180]
        if (west < -180) west += 360;
        if (east > 180) east -= 360;
      }

      // Calculate latitude center & span
      let spanLat = Math.abs(north - south);
      if (spanLat > maxSpan) {
        const centerLat = (south + north) / 2;
        south = Math.max(-80, centerLat - maxSpan / 2);
        north = Math.min(85, centerLat + maxSpan / 2);
      }
    }

    // v3.15: For WIND domain, always request global coverage.
    // Wind particles must render across the entire map, so we need global data.
    // The backend's viewport_service expands to global when span > 180° and uses
    // coarse resolution (5°) for efficiency. Viewport-clipped wind grids cause
    // visible rectangular edges when panning.
    if (inferredDomain === 'wind') {
      // WIND VIEWPORT-FINE TIER (2026-07-19 — the circulation-centre data root).
      // The v3.15 rule above globalized EVERY wind request, and the global wind manifest product
      // is 37x17 = 10-DEGREE cells. A tropical circulation (~300-500 km, Invest 91L) is SUB-CELL
      // in that texture at ANY zoom — its rotation is averaged away before the shaders ever see
      // it, which is why a forming invest reads as still air. No particle treatment can render
      // rotation the data does not contain.
      // The backend has supported a finer lane all along: for requested spans <= 15.0 deg the
      // global manifest is REJECTED (grid_resolver_selection.decide_manifest_product) and the
      // dynamic viewport lane builds an adaptive 0.25-1.0 deg product — and when its upstream is
      // rate-limited it falls back BY ITSELF to the stale global product, so the failure mode of
      // asking is exactly the old behaviour. Marine has requested its viewport at spans <= 15 deg
      // since 2026-07-05 (the mid-res band right below); wind was the one domain never asking.
      // GEOMETRY: snap OUT to the 1-deg lattice (the server's own GFS t_sz snap — one snapped box
      // = one server-side product key) from viewport spans <= 13.0 deg only, so the snapped span
      // (< span + 2) can never cross the backend's 15.0-deg dynamic gate and silently degrade to
      // the 10-deg coarse product. Antimeridian-crossing viewports keep the global product.
      // CACHE: the tileId ENCODES the snapped bbox — windController keys WIND_CACHE by tileId,
      // and a constant fine id would cross-serve different regions' grids within the 10-min TTL.
      // ENGINE: no changes needed — regional wind grids already get edge feather + regional
      // respawn (isRegionalGrid keys on lngSpan < 350 in WebGLWindEngine.render).
      // Kill: __RAW_DISABLE_WIND_VIEWPORT_FINE__ = true -> the exact v3.15 always-global rule.
      // DEFAULT RESTORED TO ON (2026-07-19, after both structural prerequisites landed).
      // The 07-19-night opt-in flip was because the tier's single-texture integration produced
      // every day-2 regression (edge "clearing"/clamp, slow cold activation, commit races).
      // Those are now structurally closed: #5 wired the native quota-free upstreams as the
      // dynamic lane's background recovery (1bf55931), and #9 shipped the base+overlay
      // two-texture engine — the global base stays resident under every fine box, so a clamp is
      // geometrically impossible (639d5fce). Opt out: __RAW_WIND_VIEWPORT_FINE__ = false;
      // __RAW_DISABLE_WIND_VIEWPORT_FINE__ still hard-disables over everything.
      const fineEnabled = typeof window !== 'undefined'
        && window.__RAW_WIND_VIEWPORT_FINE__ !== false
        && window.__RAW_DISABLE_WIND_VIEWPORT_FINE__ !== true;
      if (fineEnabled && west <= east) {
        const wSpanLng = east - west;
        const wSpanLat = Math.abs(north - south);
        const FINE_MAX_VIEWPORT_SPAN = 13.0;
        if (wSpanLng > 0 && wSpanLat > 0 && wSpanLng <= FINE_MAX_VIEWPORT_SPAN && wSpanLat <= FINE_MAX_VIEWPORT_SPAN) {
          // PAD before snapping (2026-07-19, the "clamped wind heatmap" report): the engine
          // feathers the grid edge, and an unpadded box == the viewport puts that fade band ON
          // SCREEN. Up to 1 deg per side, shrinking as the viewport nears the tier limit so the
          // final snapped span (span + 2*pad + <2 snap) provably stays inside the backend's
          // 15.0-deg dynamic gate. The pad also buys pan headroom (fewer refetches, edge stays
          // off-screen mid-gesture).
          const wPad = Math.max(0, Math.min(1.0, (FINE_MAX_VIEWPORT_SPAN - Math.max(wSpanLng, wSpanLat)) / 2));
          const fw = Math.max(-180, Math.floor(west - wPad));
          const fe = Math.min(180, Math.ceil(east + wPad));
          const fs = Math.max(-80, Math.floor(south - wPad));
          const fn = Math.min(85, Math.ceil(north + wPad));
          if (fe > fw && fn > fs) {
            return {
              isInside: true,
              clampedBbox: { west: fw, south: fs, east: fe, north: fn },
              fallbackReason: null,
              coverageBounds: { west: -180, south: -80, east: 180, north: 85 },
              selectedTileId: `wind_viewport_fine_${fw}_${fs}_${fe}_${fn}`,
              availableTileIds: REGIONAL_TILES.map(t => t.id),
              rejectedTileIds: [],
              tileFallbackReason: null
            };
          }
        }
      }
      return {
        isInside: true,
        clampedBbox: { west: -180, south: -80, east: 180, north: 85 },
        fallbackReason: null,
        coverageBounds: { west: -180, south: -80, east: 180, north: 85 },
        selectedTileId: 'global_wind',
        availableTileIds: REGIONAL_TILES.map(t => t.id),
        rejectedTileIds: [],
        tileFallbackReason: null
      };
    }

    // For marine heatmaps, if the viewport span is wide, request global coverage
    // to prevent visible rectangular edges and clamping at zoomed-out views.
    // MID-RES BAND (2026-07-05, the z6.27 "clear then fix" + z7.44 color-flip report): the global
    // threshold was 5° — but the backend now serves a ~2° `global_mid` viewport grid for spans up to
    // 15° (grid_resolver Step 3.6, live-verified), so requesting the GLOBAL at 5-15° threw away the
    // mid tier exactly where the user zooms (z~5.1-7): the 10° coarse lattice + the color flip at the
    // 5° span crossing. Raised to 15° (= MARINE_MID_RES_MAX_SPAN + the backend's wide-request
    // boundary): spans 5-15° now request the viewport bbox → clipped mid → one consistent texture
    // across z5.1-8.8. Tune/restore: window.__RAW_MARINE_GLOBAL_SPAN__ (=5 reverts to old behavior).
    const spanLng = east < west ? (180 - west) + (east + 180) : east - west;
    const spanLat = Math.abs(north - south);
    const _globalSpan = (typeof window !== 'undefined' && Number(window.__RAW_MARINE_GLOBAL_SPAN__)) || 15.0;
    if ((modelName || '').toUpperCase() !== 'EURO' && (spanLng > _globalSpan || spanLat > _globalSpan)) {
      return {
        isInside: true,
        clampedBbox: { west: -180, south: -80, east: 180, north: 85 },
        fallbackReason: null,
        coverageBounds: { west: -180, south: -80, east: 180, north: 85 },
        // Must match the STORE key: _cacheMarineResult keys global grids by the backend region_id
        // ('global_coarse'), but cache LOOKUPS key by this selectedTileId. 'global_marine_coarse'
        // never matched the stored 'global_coarse' → every global cache lookup was exact_key_absent
        // (forced the O(N) containment fallback). Align it to 'global_coarse'.
        selectedTileId: 'global_coarse',
        availableTileIds: REGIONAL_TILES.map(t => t.id),
        rejectedTileIds: [],
        tileFallbackReason: null
      };
    }

    // FINE VIEWPORT TILE (2026-07-04, the "cleared/coarse at z9.22 Kvarner" root, curl-proven): the
    // backend serves a fine 0.25° viewport grid ONLY when the request fits within a SINGLE 2°-aligned
    // tile; a request that straddles a 2° boundary falls back to global_coarse (10°/cell). The old 1°
    // floor/ceil snap turned a ~1.5° viewport into e.g. 13→16, which spans the 12–14 AND 14–16 tiles
    // → global_coarse → the enclosed coast renders near-blank. Live curl: bbox 14,44,16,46 → viewport
    // 0.25°; 14,44,17,46 (two tiles wide) → global_coarse; 14,44,15,47 (two tiles tall) → global.
    // So when the viewport fits a fine tile (span ≤ 2° in BOTH dims — the z9+ close-zoom case that was
    // clearing), request the single 2°-aligned tile CONTAINING THE VIEWPORT CENTER. Guarantees a
    // one-tile request → the fine grid the user is looking at. Wider spans keep the 1° snap below
    // (the backend has no fine product beyond a 2° tile; 2–5° → 1° snap, > 5° → global above).
    if ((modelName || '').toUpperCase() === 'GFS' && spanLng <= 2.0 && spanLat <= 2.0) {
      const cLng = east < west ? (((west + east + 360) / 2) % 360) : (west + east) / 2;
      const cLat = (south + north) / 2;
      const tW = Math.floor(cLng / 2) * 2;
      const tS = Math.floor(cLat / 2) * 2;
      let bW = tW, bE = tW + 2;
      if (bW < -180) bW += 360;
      if (bE > 180) bE -= 360;
      // STRADDLE GUARD (2026-07-05, the Irvine report: "clamping below / cleared above" = the tile's
      // north+west edges cutting through the viewport): the single-center-tile shortcut is only right
      // when the viewport is FULLY INSIDE that tile — a straddling viewport (span ≤2° but crossing a
      // 2° boundary) got fine data over ~half the screen and a dead coarse-wash ring over the rest.
      // Straddlers fall through to the 1° snap below → a 2-4° covering request → the backend mid tier
      // serves a COVERING clipped grid instantly (and the SWR revalidation sharpens it to the fine
      // 0.25° viewport grid). Kill (restore center-tile-always): __RAW_DISABLE_STRADDLE_GUARD__.
      const _inTile = west >= bW - 0.001 && east <= bE + 0.001 && south >= tS - 0.001 && north <= tS + 2 + 0.001;
      const _straddleGuardOff = (typeof window !== 'undefined' && window.__RAW_DISABLE_STRADDLE_GUARD__ === true);
      if (_inTile || _straddleGuardOff) {
        return {
          isInside: true,
          clampedBbox: { west: bW, south: tS, east: bE, north: tS + 2 },
          fallbackReason: null,
          coverageBounds: PILOT_COVERAGE,
          // Match the backend region_id shape (viewport_W.00_S.00_E.00_N.00) so cache store/lookup keys align.
          selectedTileId: `viewport_${tW.toFixed(2)}_${tS.toFixed(2)}_${(tW + 2).toFixed(2)}_${(tS + 2).toFixed(2)}`,
          availableTileIds: REGIONAL_TILES.map(t => t.id),
          rejectedTileIds: [],
          tileFallbackReason: null
        };
      }
      // straddling → fall through to the snap path (covering request)
    }

    // GESTURE FETCH-PAD (2026-07-05, the "grid of animations toward the screen edges on pan/zoom-out"
    // report): requesting exactly the (snapped) viewport means every pan reveals an UNFETCHED ring —
    // coarse bridge cells until the refetch lands. Pad the request by ~30% of the span (min 0.5°) so
    // the committed grid OVERHANGS the screen: small pans/zooms land inside already-loaded fine data
    // with zero transient. CAPPED so the padded span never exceeds the backend's 15° mid-band ceiling
    // (padding past it would resolve to the 10° coarse — a regression). Payload cost at 0.25°: a 3°
    // viewport fetches ~4.8° ≈ 2.5× cells — trivial. Tune/kill: __RAW_MARINE_FETCH_PAD_FRAC__ (0 = off).
    let _padW = west, _padS = south, _padE = east, _padN = north;
    {
      // CLOSE-ZOOM PAD RAISE (2026-07-18, probe_band_pan step-4 total-blank: a 0.35°/s coastal pan
      // at z9.3 crossed the resident's north edge before the moveend refetch landed — the user's
      // "band doesn't paint until I'm halfway into the new area"). At spans ≤2.5° the fine tile is
      // 0.25°/cell, so ~¾-viewport headroom per side costs a trivial payload while keeping the
      // committed grid ≥2 pan-steps ahead; the manifest-tile clip below still guarantees the padded
      // request never crosses into the mid-tier demotion. Wider spans keep the legacy 0.3.
      const _frDefault = (spanLng <= 2.5 && spanLat <= 2.5) ? 0.75 : 0.3;
      const _fr = (typeof window !== 'undefined' && window.__RAW_MARINE_FETCH_PAD_FRAC__ !== undefined)
        ? Number(window.__RAW_MARINE_FETCH_PAD_FRAC__) : _frDefault;
      if (_fr > 0) {
        const _span = Math.max(spanLng, spanLat);
        let _pad = Math.max(0.5, _fr * _span);
        _pad = Math.min(_pad, Math.max(0, (15.0 - _span) / 2)); // never pad past the mid-band ceiling
        _padW = Math.max(-180, west - _pad);
        _padS = Math.max(-80, south - _pad);
        _padE = Math.min(180, east + _pad);
        _padN = Math.min(85, north + _pad);
      }
    }
    // MANIFEST-TILE CLIP (2026-07-18, the rating-toggle direction-shift root — Jupiter z9.31
    // live-pinned): the legacy pad+snap below turns a 1.4° viewport near a tile edge into e.g.
    // -82..-78 — CROSSING the florida_east_coast east edge (-79), which demotes the serve to the
    // 2°/cell global_mid... while the RATED surf lane requests viewport-scale and gets the 0.25°
    // tile. Result: toggling Rating swapped mid-block-mean directions/heights for fine ones
    // (measured 44-49° direction + 2-4x speed jumps) and the clamp backstop's re-drives inherited
    // the same crossing bbox ("no progress after 3 re-drives"). The 1°/2° snap models the 07-04
    // backend ("fine only within a single 2°-aligned tile") — SUPERSEDED by worldwide manifest
    // tiles (07-13): ladder probes prove a raw in-tile 1.4° bbox serves the covering fine tile at
    // 0.25°. So at close zoom, when a REGIONAL manifest tile fully contains the raw viewport,
    // request the padded bbox CLIPPED to that tile (0.25°-quantized for cache/product-cardinality
    // hygiene) — pan headroom kept on the inland sides, fine serve guaranteed. True straddlers of
    // real tile edges and cold-boot (manifest not loaded) keep the legacy path unchanged.
    // Kill: __RAW_DISABLE_MANIFEST_TILE_CLIP__.
    if (!(typeof window !== 'undefined' && window.__RAW_DISABLE_MANIFEST_TILE_CLIP__ === true) &&
        spanLng <= 2.5 && spanLat <= 2.5 && !(east < west)) {
      try {
        const _tr2 = getAvailableTilesFromManifest(modelName, inferredDomain, layerName);
        const _cover = (_tr2.tiles || []).find(t => {
          const b = t.bounds;
          if (!b || typeof b.west !== 'number') return false;
          const tSpan = (b.east < b.west) ? (b.east + 360 - b.west) : (b.east - b.west);
          if (tSpan >= 30 || (t.id && String(t.id).startsWith('global'))) return false;   // real regional tiles only
          if (t.id && String(t.id).startsWith('viewport_')) return false;                  // not prior dynamic crops
          return west >= b.west - 1e-6 && east <= b.east + 1e-6 &&
                 south >= b.south - 1e-6 && north <= b.north + 1e-6;
        });
        if (_cover) {
          const q = 0.25;
          const cW = Math.max(_cover.bounds.west, Math.floor(_padW / q) * q);
          const cS = Math.max(_cover.bounds.south, Math.floor(_padS / q) * q);
          const cE = Math.min(_cover.bounds.east, Math.ceil(_padE / q) * q);
          const cN = Math.min(_cover.bounds.north, Math.ceil(_padN / q) * q);
          const rq = v => Number(v).toFixed(2);
          return {
            isInside: true,
            clampedBbox: { west: cW, south: cS, east: cE, north: cN },
            fallbackReason: null,
            coverageBounds: PILOT_COVERAGE,
            selectedTileId: `viewport_${rq(cW)}_${rq(cS)}_${rq(cE)}_${rq(cN)}`,
            availableTileIds: (_tr2.tiles || []).map(t => t.id),
            rejectedTileIds: [],
            tileFallbackReason: null
          };
        }
      } catch (e) { /* registry unavailable — legacy path */ }
    }

    const tileSize = (modelName || '').toUpperCase() === 'GFS' ? 1.0 : 2.0;
    const snapW = Math.floor(_padW / tileSize) * tileSize;
    const snapS = Math.floor(_padS / tileSize) * tileSize;
    const snapE = Math.ceil(_padE / tileSize) * tileSize;
    const snapN = Math.ceil(_padN / tileSize) * tileSize;

    if ((modelName || '').toUpperCase() === 'EURO') {
      const tileResult = getAvailableTilesFromManifest(modelName, inferredDomain, layerName);
      const tiles = tileResult.tiles || [];
      let intersectsAny = false;
      for (const t of tiles) {
        const cov = t.bounds;
        let sW = snapW;
        let sE = snapE;
        if (sE < sW) sE += 360;
        let cW = cov.west;
        let cE = cov.east;
        if (cE < cW) cE += 360;

        const overlapLng = Math.max(sW, cW) < Math.min(sE, cE) ||
                          Math.max(sW - 360, cW) < Math.min(sE - 360, cE) ||
                          Math.max(sW + 360, cW) < Math.min(sE + 360, cE);
        const overlapLat = Math.max(snapS, cov.south) < Math.min(snapN, cov.north);
        if (overlapLng && overlapLat) {
          intersectsAny = true;
          break;
        }
      }
      if (!intersectsAny) {
        return {
          isInside: false,
          clampedBbox: null,
          fallbackReason: tileResult.fallbackReason && tileResult.fallbackReason !== 'manifest_not_loaded' ? tileResult.fallbackReason : "outside_coverage_clear",
          coverageBounds: PILOT_COVERAGE,
          selectedTileId: null,
          availableTileIds: tiles.map(t => t.id),
          rejectedTileIds: [],
          tileFallbackReason: tileResult.fallbackReason
        };
      }
    }

    const r = v => Number(v).toFixed(2);
    const selectedTileId = `viewport_${r(snapW)}_${r(snapS)}_${r(snapE)}_${r(snapN)}`;
    return {
      isInside: true,
      clampedBbox: { west: snapW, south: snapS, east: snapE, north: snapN },
      fallbackReason: null,
      coverageBounds: { west: -180, south: -80, east: 180, north: 85 },
      selectedTileId,
      availableTileIds: REGIONAL_TILES.map(t => t.id),
      rejectedTileIds: [],
      tileFallbackReason: null
    };
  }

  const tileResult = getAvailableTilesFromManifest(modelName, inferredDomain, layerName);
  const tiles = tileResult.tiles || [];
  const availableTileIds = tiles.map(t => t.id);
  const tileFallbackReason = tileResult.fallbackReason;
  
  // Find all intersecting tiles and calculate their intersection area with the requested viewport
  const intersectingTiles = [];
  
  for (const t of tiles) {
    const cov = t.bounds;
    const intWest = Math.max(west, cov.west);
    const intSouth = Math.max(south, cov.south);
    const intEast = Math.min(east, cov.east);
    const intNorth = Math.min(north, cov.north);
    
    if (intWest < intEast && intSouth < intNorth) {
      const area = (intEast - intWest) * (intNorth - intSouth);
      intersectingTiles.push({
        tile: t,
        area,
        clampedBbox: { west: intWest, south: intSouth, east: intEast, north: intNorth }
      });
    }
  }

  // If no intersection found, clear the visual layer cleanly
  if (intersectingTiles.length === 0) {
    return {
      isInside: false,
      clampedBbox: null,
      fallbackReason: tileFallbackReason || "outside_coverage_clear",
      coverageBounds: PILOT_COVERAGE,
      selectedTileId: null,
      availableTileIds,
      rejectedTileIds: [],
      tileFallbackReason
    };
  }

  // Sort intersecting tiles by area descending
  intersectingTiles.sort((a, b) => b.area - a.area);
  
  const bestMatch = intersectingTiles[0];
  const selectedTileId = bestMatch.tile.id;
  const rejectedTileIds = intersectingTiles.slice(1).map(item => item.tile.id);

  return {
    isInside: true,
    clampedBbox: bestMatch.clampedBbox,
    fallbackReason: null,
    coverageBounds: bestMatch.tile.bounds,
    selectedTileId,
    availableTileIds,
    rejectedTileIds,
    tileFallbackReason
  };
}

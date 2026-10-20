// The two basemap-water mask refreshes, moved out of WebGLMarineEngine.js (2026-10-20; that file is over the 800-line
// cap, so the sliced mode below could only land as a net-negative diff there). The engine's prototype methods
// refreshMaskWithBasemapWater / refreshViewportOverlayMask delegate here unchanged, and with no `opts.sliced` (every
// data-commit caller) every line runs as it did: same gates, same order, same canvas calls, same upload.
//
// opts.sliced (map-event refreshes only) + window.__RAW_SLICED_LAND_MASK__ === true (PROTOTYPE, default OFF): the gates
// still run now, the map is read now (snapshotOverlayInputs), and the paint + upload run as a job across short tasks
// (maskSliceScheduler.js). The job is dropped if the target changed meanwhile; a synchronous paint of the same target
// bumps its paint sequence, so an older job can never overwrite a newer mask.
import { measureMarineCpuPhase } from './marineCpuPhaseTiming';
import { writeCoastDistanceField } from './maskCoastSDF';
import { renderMaskToCanvas, overlayBasemapWaterOnMask, prepareBasemapWaterOverlay, isBasemapWaterSourceReady } from './WebGLMarineMaskRenderer';
import { snapshotOverlayInputs, overlayBasemapWaterSteps } from './basemapWaterOverlay';
import { measureMarineMaskPaint } from './marineMaskRefreshAttribution';
import { MIDZOOM_OVERLAY_CARVE_MIN_Z } from './marineOverlayMode';
import { shouldRejectMaskShrink } from './marineEngineDecisions';
import { withTextureState } from './WebGLMarineTextureState';
import { landMaskSlicingOn, maskJobInFlight, startMaskJob } from './maskSliceScheduler';

const boundsKey = (b) => (b ? `${b.west}_${b.south}_${b.east}_${b.north}` : '');

// Moved here with its only caller; WebGLMarineEngine.js re-exports it.
export function resolveDeliveredCoverage(cachedBounds, curView, gridKey, lastForcedFor, disabled) {
  const k = (v) => (typeof v === 'number' ? v.toFixed(4) : 'x');
  const forceKey = curView
    ? `${gridKey}|${k(curView.west)},${k(curView.south)},${k(curView.east)},${k(curView.north)}`
    : `${gridKey}|`;
  // Never skip on unknown delivery, nor on a WRAPPED box (east<west) that containment calls COVERED — C4-MR-09.
  const deliveredShort = !disabled && !!cachedBounds && !!curView
    && (curView.east < curView.west || cachedBounds.east < cachedBounds.west
      || !(cachedBounds.west <= curView.west && cachedBounds.east >= curView.east
        && cachedBounds.south <= curView.south && cachedBounds.north >= curView.north));
  return { deliveredShort, forceKey, forceRepaint: deliveredShort && lastForcedFor !== forceKey };
}

// BASEMAP-WATER TRUTH REFRESH (2026-07-04, "Gull Park / Pier 15-16 under water"): repaint the
// CACHED mask texture in place with the basemap's own water polygons inside the viewport (see
// overlayBasemapWaterOnMask). In-place texImage2D on the SAME texture object means the resident
// waveData (which binds that object) picks it up on the next frame — no re-encode, no commit.
// Regional grids only (a world mask can't hold viewport detail at 1024px anyway). Idempotent and
// throttle-friendly: cheap enough for moveend. Kill switch window.__RAW_BASEMAP_WATER_MASK__=false.
export function refreshRegionalMask(engine, gl, mapInstance, opts) {
  const sliced = !!(opts && opts.sliced) && landMaskSlicingOn();
  if (typeof window !== 'undefined' && window.__RAW_BASEMAP_WATER_MASK__ === false) return false;
  if (!gl || !mapInstance) return false;
  const geo = engine._cachedMaskGeoJSON;
  const tex = engine._cachedMaskTex;
  const bounds = engine._cachedMaskBounds;
  if (!geo || !bounds || !tex) { engine._lastMaskRepatchReason = 'no_cache'; return false; }
  engine._lastMaskRepatchReason = 'enter';
  const span = (bounds.east < bounds.west ? bounds.east + 360 : bounds.east) - bounds.west;
  // WIDE (world) grids: the grid's own 1024×512 mask (~39 km/texel) cannot hold viewport detail —
  // paint a SEPARATE viewport-truth OVERLAY texture instead (see refreshViewportOverlayMask). The
  // base mask is never touched, so a stale overlay can only ever fall back to base behavior.
  // (A first attempt retargeted THIS texture to viewport bounds in place: one pan later the
  // out-of-bounds samples clamped to edge-water and land masking died wholesale — Istria/Susak.)
  if (span >= 30) { engine._lastMaskRepatchReason = 'wide_delegate'; return engine.refreshViewportOverlayMask(gl, mapInstance, true, opts); }
  // Clear regional overlays only below their ACTIVE carve zone; clearing below the obsolete
  // z12 gate while midzoom carving is active discards clean truth and repaints every refresh.
  // The legacy carve/retention rollback keeps z12. Wide-grid REPLACE is delegated above.
  try {
    const overlayMinZoom = typeof window !== 'undefined' &&
      (window.__RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__ === true || window.__RAW_DISABLE_ACTIVE_OVERLAY_RETENTION__ === true)
      ? 12 : MIDZOOM_OVERLAY_CARVE_MIN_Z;
    if (mapInstance.getZoom() < overlayMinZoom && engine._overlayMaskBounds) {
      engine._overlayMaskBounds = null;
      engine._overlayMaskTruthBox = null;
    }
  } catch (e) { /* zoom unavailable — leave overlay untouched */ }
  // The resident frame must actually be USING the cached texture — otherwise refreshing it paints
  // a texture nothing binds (and skipping avoids fighting an in-flight commit).
  if (!engine._waveData || engine._waveData.u_oceanMaskTexture !== tex) { engine._lastMaskRepatchReason = 'tex_mismatch'; return false; }
  // HYSTERESIS (stair-climb choppiness fix): the painter patches the viewport padded 40%; while
  // the SAME grid is resident and the current viewport is still INSIDE the last patch, a repaint
  // adds nothing — skip the 50–250 ms canvas+upload. Deep-zoom crispness still refreshes via the
  // overlay branch below (its own hysteresis).
  let curView = null;
  try {
    const b = mapInstance.getBounds();
    curView = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  } catch (e) { curView = null; }
  const gridKey = boundsKey(bounds);
  const rp = engine._regionalPatchState;
  let _curZoom = 0; try { _curZoom = mapInstance.getZoom(); } catch (e) { _curZoom = 0; }
  // ZOOM-CHANGE REBUILD (2026-07-07, "intracoastal wash takes 30-60s to suppress at z9 on zoom-in"):
  // the base hysteresis used to skip ALL zoom-ins inside the patch box (its comment even said so), so
  // after a zoom-in the sheltered-water verdict + finest basemap holes for the closer view never
  // refreshed until the next data commit — the 30-60s the user saw. Now a zoom change ≥0.75 forces a
  // rebuild (fresh classify + finest tiles); pans inside the box and small zooms still skip, and the
  // layer's 700 ms throttle keeps it from churning. Kill: __RAW_DISABLE_ZOOM_REBUILD__.
  const _zoomRebuildOff = typeof window !== 'undefined' && window.__RAW_DISABLE_ZOOM_REBUILD__ === true;
  const _zoomStable = _zoomRebuildOff || typeof rp?.z !== 'number' || Math.abs(_curZoom - rp.z) < 0.75;
  // A DEGRADED previous paint (parent-vulnerable source-query fallback) never earns the
  // hysteresis skip — the next refresh repaints with finest-tile truth (grey-rect self-heal).
  // ── DELIVERED-COVERAGE CHECK (#11 root, measured live 2026-08-01) ──────────────────────────────
  // `rp.box` is the viewport we REQUESTED to paint (:2424 stores `{...curView}` — note the comment
  // above claiming a 40% pad describes the PAINTER, not what is stored). The texture actually ends
  // up at `_cachedMaskBounds`, which is snapped SMALLER. Measured at z8.03 on the reported coast:
  //
  //     view          -81.443 … -79.057   span 2.386
  //     rp.box        -81.443 … -79.057   span 2.386  -> hysteresis: COVERED  (skip granted)
  //     _cachedMask   -81.550 … -79.187   span 2.363  -> renderer:   coverage_gap, east short 0.13
  //
  // So the skip was granted on INTENT while the renderer simultaneously reported it could not cover
  // and haloed that edge, and `_lastMaskRepatchReason` read `hysteresis_covered` forever. The
  // coverage class exactly: a resource chosen with no requirement that it CONTAIN what it covers,
  // degrading silently. ⇒ test the DELIVERY, not the request.
  //
  // BOUNDED ON PURPOSE: at most ONE forced repaint per (gridKey, view). If a painter simply cannot
  // satisfy this viewport, the second pass degrades to today's behaviour instead of repainting on
  // every 700 ms throttle tick — a halo is better than a churn. Kill: __RAW_DISABLE_MASK_DELIVERED_COVER__.
  // Telemetry: __RAW_GPU__.maskDelivered.
  const _delivOff = typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_DELIVERED_COVER__ === true;
  const _cmb = engine._cachedMaskBounds;
  // __mb stamps WHICH mask this verdict judged — the render loop voids a verdict whose mask object is no longer the bound one (live-caught 2026-08-15: a frozen verdict reported safe_degraded across the wide-delegate window while the WORLD mask covered everything).
  const _dv = engine._maskDeliveredState = Object.assign(
    resolveDeliveredCoverage(_cmb, curView, gridKey, engine._maskDeliveredForcedFor, _delivOff), { __mb: _cmb });
  const _delivShort = _dv.deliveredShort;
  const _forceRepaint = _dv.forceRepaint;
  if (_forceRepaint) engine._maskDeliveredForcedFor = _dv.forceKey;
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.maskDelivered = {
      deliveredShort: _delivShort, forcedRepaint: _forceRepaint, alreadyForced: _delivShort && !_forceRepaint,
      eastGap: (_cmb && curView) ? +(curView.east - _cmb.east).toFixed(4) : null,
      westGap: (_cmb && curView) ? +(_cmb.west - curView.west).toFixed(4) : null,
    };
  }
  if (curView && rp && !rp.degraded && _zoomStable && rp.gridKey === gridKey && rp.box &&
      !_forceRepaint &&
      rp.box.west <= curView.west && rp.box.east >= curView.east &&
      rp.box.south <= curView.south && rp.box.north >= curView.north) {
    // Base patch still covers the view — only the deep-zoom overlay may need work.
    try {
      // MID-ZOOM COASTAL CARVE (2026-07-21): refresh the viewport overlay down to z>=9 so the render's
      // mid-zoom min-combine (see `overlayOn`) has a fresh viewport-truth mask to carve the coast across
      // the halo band. Kill → old z>=12 gate. __RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__.
      const _mzOverlayZ = (typeof window !== 'undefined' && window.__RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__ === true) ? 12 : MIDZOOM_OVERLAY_CARVE_MIN_Z;
      if (_curZoom >= _mzOverlayZ) return engine.refreshViewportOverlayMask(gl, mapInstance, undefined, opts);
    } catch (e3) { /* enhancement only */ }
    engine._lastMaskRepatchReason = 'hysteresis_covered';
    return false;
  }
  // TILE-READINESS GATE (the "rectangle holes" root, 2026-07-04): painting while the water source
  // is mid-load bakes missing-tile rectangles into the mask as false land, and the hysteresis
  // above then keeps the bad paint. Skip entirely — the resident mask (NE truth) serves, and the
  // layer's `idle` listener re-drives this refresh once every covering tile is queryable.
  if (!isBasemapWaterSourceReady(mapInstance)) { engine._lastMaskRepatchReason = 'source_not_ready'; return false; }
  if (sliced && maskJobInFlight(engine)) { engine._lastMaskRepatchReason = 'job_in_flight'; return false; }
  try {
    const water = measureMarineCpuPhase('maskFeatureQuery', () => prepareBasemapWaterOverlay(mapInstance));
    if (!water) { engine._lastMaskRepatchReason = 'overlay_not_applied'; return false; }
    // The paint's result lands here, in the same call (default) or in the last task of a sliced job (maskSliceScheduler.js).
    const commit = (canvas, applied) => {
      if (!applied) { engine._lastMaskRepatchReason = 'overlay_not_applied'; return false; }
      // COAST SDF: re-write the signed dist-to-coast into .b on the PATCHED base coast (this re-upload
      // would otherwise revert .b to a redundant .r). Opt-in; byte-identical when off. Keeps the flag live.
      engine._cachedMaskHasSDF = writeCoastDistanceField(canvas);
      measureMarineCpuPhase('maskUpload', () => withTextureState(gl, () => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      }));
      engine._regionalPaintSeq = (engine._regionalPaintSeq || 0) + 1;   // a sliced job begun before this upload is stale
      // Record the TRUTH box for the hysteresis above — the STRICT viewport the painter actually
      // repainted (the old 40%-padded box claimed truth over a ring the tile queries can never
      // cover; that ring was black land = the pan/zoom "rectangle holes"). Zoom-ins inside the box
      // still skip; any pan escaping it repaints (throttled + tile-gated at the layer).
      if (curView) {
        const degraded = !!(applied && applied.degraded);
        engine._regionalPatchState = { gridKey, box: { ...curView }, degraded, z: _curZoom };
        // PATCH CARRY-FORWARD source (2026-07-06, "bays flicker on rapid zoom"): retain the painted
        // canvas so the NEXT mask rebuild (bounds change / geojson swap) transplants this truth box
        // synchronously instead of flashing NE-only until the async repatch (see maskSmoothing.js).
        // The canvas is a fresh renderMaskToCanvas copy — nothing else aliases it. NEVER stash a
        // DEGRADED paint (grey-rectangle class): the carry would propagate a parent-vulnerable
        // paint into every rebuild until a good repaint replaced it.
        if (!degraded) {
          engine._lastPatchedMask = { canvas, bounds: { ...bounds }, box: { ...curView } };
        }
      }
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        window.__RAW_GPU__.basemapWaterMask = { applied: true, at: new Date().toISOString() };
      }
      // DEEP-ZOOM CRISPNESS (2026-07-04 round 6): past ~z12 the regional canvas (1° @ 4096 ≈ 27 m/
      // texel) halos the wash over waterfront roads — ALSO paint the crisp viewport overlay. The
      // shaders min()-combine it with the regional base for non-wide grids, so the regional
      // sheltered verdict and land truth both survive; the overlay only ever REMOVES wash.
      try {
        let _z2; try { _z2 = mapInstance.getZoom(); } catch (e2) { _z2 = 0; }
        const _mzOverlayZ2 = (typeof window !== 'undefined' && window.__RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__ === true) ? 12 : MIDZOOM_OVERLAY_CARVE_MIN_Z;
        if (_z2 >= _mzOverlayZ2) engine.refreshViewportOverlayMask(gl, mapInstance, undefined, opts);
      } catch (e2) { /* overlay is an enhancement */ }
      engine._lastMaskRepatchReason = 'applied';
      return true;
    };
    if (sliced) {
      engine._lastMaskRepatchReason = 'sliced';
      const isStale = () => engine._cachedMaskGeoJSON !== geo || engine._cachedMaskTex !== tex || !engine._waveData
        || engine._waveData.u_oceanMaskTexture !== tex || boundsKey(engine._cachedMaskBounds) !== gridKey;
      return sliceMaskPaint(engine, mapInstance, opts, water, 'regional', () => renderMaskToCanvas(geo, bounds), bounds, isStale, commit);
    }
    const canvas = measureMarineCpuPhase('maskBaseCanvas', () => renderMaskToCanvas(geo, bounds));
    const applied = measureMarineCpuPhase('maskWaterPaint', () => measureMarineMaskPaint(water, () => overlayBasemapWaterOnMask(canvas, bounds, mapInstance, water)));
    return commit(canvas, applied);
  } catch (e) {
    console.warn('[WebGLMarineEngine] basemap-water mask refresh skipped:', e && e.message);
    return false;
  }
}

// VIEWPORT-TRUTH OVERLAY MASK (2026-07-04): while a WIDE (world) grid is resident at close zoom,
// paint the basemap-truth mask for the PADDED VIEWPORT into a dedicated texture the shaders
// consult ONLY inside its bounds (u_overlayMask* uniforms). Per-pixel fallback to the grid's own
// mask makes staleness harmless: after a fast pan the overlay covers where the user WAS, those
// pixels are off-screen, and everything visible degrades to the coarse-but-sane base mask until
// the idle/zoomend refresh repaints. Kill switch rides __RAW_BASEMAP_WATER_MASK__ (caller-gated).
export function refreshOverlayMask(engine, gl, mapInstance, basinScale, opts) {
  const sliced = !!(opts && opts.sliced) && landMaskSlicingOn();
  const geo = engine._cachedMaskGeoJSON;
  if (!geo || !gl || !mapInstance) return false;
  let z;
  try { z = mapInstance.getZoom(); } catch (e) { return false; }
  // z≥4.4: world-mask texels stay visibly wide below z7, where this is the only crisp truth.
  // The fixed-resolution canvas does not grow with span; below z4.4 the base reads sub-pixel.
  if (z < 4.4) return false;
  let bounds;
  let view = null;
  let viewSpan = 0;
  try {
    const b = mapInstance.getBounds();
    view = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    viewSpan = b.getEast() - b.getWest();
    // 50% pad (was 15%): each paint survives several pan/zoom gestures before the hysteresis
    // below forces a repaint — the paint itself is the choppiness (stair-climb forensics: 38
    // paints × 50–250 ms main-thread each in a 22 s interaction).
    const padX = viewSpan * 0.5;
    const padY = (b.getNorth() - b.getSouth()) * 0.5;
    bounds = {
      west: b.getWest() - padX,
      south: Math.max(-85, b.getSouth() - padY),
      east: b.getEast() + padX,
      north: Math.min(85, b.getNorth() + padY),
    };
    // TWO SPANS by combine mode (live lagoon-bleed catch at z12.5): overlays for REGIONAL grids
    // min()-combine with a base that already carries the sheltered verdict, so they stay CRISP
    // (0.05° floor, ~1 m/texel — the 0.7° attempt haloed canal-side roads). Overlays for WIDE
    // grids REPLACE the base sample, so they must be basin-scale (0.7° ⇒ the painter's ≥0.5°
    // sheltered gate runs and enclosed lagoons stay suppressed through the world-grid window).
    const MIN_SPAN = basinScale ? 0.7 : 0.05;
    if (bounds.east - bounds.west < MIN_SPAN) {
      const cx = (bounds.east + bounds.west) / 2;
      bounds.west = cx - MIN_SPAN / 2; bounds.east = cx + MIN_SPAN / 2;
    }
    if (bounds.north - bounds.south < MIN_SPAN) {
      const cy = (bounds.north + bounds.south) / 2;
      bounds.south = Math.max(-85, cy - MIN_SPAN / 2); bounds.north = Math.min(85, cy + MIN_SPAN / 2);
    }
    // HYSTERESIS: reuse covering queried truth within 5× the view. Minimum-span reuse also
    // needs stable zoom: identical bounds add no density, but settled zooms bring finer tiles.
    // Combine-mode changes rebuild; the padded ring remains NE, not queried tile truth.
    const spanReuseOff = typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_MINIMUM_SPAN_REUSE__ === true;
    const prev = engine._overlayMaskBounds;
    const prevTruth = engine._overlayMaskTruthBox;
    // A DEGRADED previous paint (parent-vulnerable fallback) never earns the skip — this is the
    // Grey-rectangle self-heal: a bad box on a WIDE-grid residency
    // REPLACES the base at every zoom; a later attempt must retry with finest tile truth.
    if (prev && prevTruth && engine._overlayMaskTex && !engine._overlayPaintDegraded &&
        (spanReuseOff || engine._overlayMaskBasinScale === !!basinScale) &&
        prevTruth.west <= view.west && prevTruth.east >= view.east &&
        prevTruth.south <= view.south && prevTruth.north >= view.north &&
        ((prev.east - prev.west) <= Math.max(viewSpan, 0.001) * 5 ||
          (!spanReuseOff && Math.abs(z - engine._overlayMaskPaintZoom) < 0.75 &&
            (prev.east - prev.west) <= bounds.east - bounds.west))) {
      // #11 FORENSICS (read-only, 2026-08-01): the no-shrink guard below never fires in production
      // (proven INERT by kill-switch A/B, `50c74e33`). Its precondition is a COVERING incumbent —
      // and THIS skip also requires the previous box to contain the viewport. Since the padded
      // `prev` always contains `prevTruth`, every hysteresis skip is also a case where the guard's
      // precondition would have held. Recording the exit lets us prove whether the guard is starved
      // by this earlier `return` rather than by its own condition. Pure telemetry, no behaviour.
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        window.__RAW_GPU__.maskCommit = {
          exit: 'hysteresis_skip',
          prevSpan: +(prev.east - prev.west).toFixed(3),
          viewSpan: +viewSpan.toFixed(3),
          ratio: +((prev.east - prev.west) / Math.max(viewSpan, 0.001)).toFixed(2),
          prevCoversView: prev.west <= view.west && prev.east >= view.east
            && prev.south <= view.south && prev.north >= view.north,
        };
      }
      return false; // still fresh — no repaint, no upload
    }
  } catch (e) { return false; }
  // TILE-READINESS GATE (the "rectangle holes" root): never paint truth from a mid-load source —
  // skip and let the `idle`-driven refresh land the paint when every covering tile is queryable.
  if (!isBasemapWaterSourceReady(mapInstance)) return false;
  if (sliced && maskJobInFlight(engine)) return false;
  try {
    const water = measureMarineCpuPhase('maskFeatureQuery', () => prepareBasemapWaterOverlay(mapInstance));
    if (!water) return false;
    const commit = (canvas, applied) => {
      if (!applied) return false;
      // ── MASK NO-SHRINK (#11, the halo) ────────────────────────────────────────────────────────
      // Refuse a candidate mask that SHRINKS while failing to cover the viewport, when the incumbent
      // demonstrably DID cover it. Measured live 2026-07-31 one zoom step apart at the same
      // coordinate: z8.18 held -94,12,-64,44 (30 deg, covers TRUE) and rendered clean; z8.03 replaced
      // it with -83,26,-79,31 (4 deg, covers FALSE) and haloed. The viewport GREW while the mask
      // shrank ~7x, and in REPLACE mode the small rectangle overrides the ocean flag while its padded
      // ring floods.
      // ★ MUST RUN BEFORE THE TEXTURE UPLOAD BELOW. Rejecting after texImage2D would leave the texture
      //   updated and the bounds stale — a tex/bounds mismatch is strictly worse than the halo.
      // The engine already computes this coverage test at render time (_overlayCoversViewport, :811);
      // the same containment is applied here to the candidate and the incumbent. Kill:
      // __RAW_DISABLE_MASK_NO_SHRINK__. Telemetry: window.__RAW_GPU__.maskShrinkRejected.
      {
        const _cov = (b) => (b && b.west <= view.west && b.east >= view.east
          && b.south <= view.south && b.north >= view.north);
        const _incumbent = engine._overlayMaskBounds;
        // #11 FORENSICS (read-only): record the guard's ACTUAL inputs every time it is reached, so
        // "it never fires" can be attributed to a specific false precondition rather than inferred.
        // `reached_guard` appearing at all proves the earlier returns did not starve it; the flags
        // then say which half of "incumbent covered AND candidate does not" failed.
        if (typeof window !== 'undefined' && window.__RAW_GPU__) {
          window.__RAW_GPU__.maskCommit = {
            exit: 'reached_guard',
            hasIncumbentTex: !!engine._overlayMaskTex,
            incumbentCovered: !!(engine._overlayMaskTex && _cov(_incumbent)),
            candidateCovers: _cov(bounds),
            incumbentSpan: _incumbent ? +(_incumbent.east - _incumbent.west).toFixed(3) : null,
            candidateSpan: +(bounds.east - bounds.west).toFixed(3),
            viewSpan: +(view.east - view.west).toFixed(3),
          };
        }
        if (shouldRejectMaskShrink(_incumbent, bounds, view, {
          candidateCoversViewport: _cov(bounds),
          incumbentCoveredViewport: !!(engine._overlayMaskTex && _cov(_incumbent)),
          disabled: (typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_NO_SHRINK__ === true),
        })) {
          if (typeof window !== 'undefined' && window.__RAW_GPU__) {
            window.__RAW_GPU__.maskShrinkRejected = {
              incumbent: _incumbent, candidate: bounds, view,
              incumbentSpan: _incumbent ? _incumbent.east - _incumbent.west : null,
              candidateSpan: bounds.east - bounds.west,
            };
          }
          return false;   // keep the incumbent mask — it still covers the view
        }
      }
      // COAST SDF for the viewport-truth overlay (the band's min-combine mask). Opt-in; byte-identical off.
      engine._overlayMaskHasSDF = writeCoastDistanceField(canvas);
      // Capture before allocation binds anything; restore even when an upload throws.
      measureMarineCpuPhase('maskUpload', () => withTextureState(gl, () => {
        if (!engine._overlayMaskTex) {
          engine._overlayMaskTex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, engine._overlayMaskTex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }
        gl.bindTexture(gl.TEXTURE_2D, engine._overlayMaskTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      }));
      engine._overlayMaskTexDims = { w: canvas.width, h: canvas.height }; // probe follows uploaded size
      engine._overlayPaintSeq = (engine._overlayPaintSeq || 0) + 1;   // a sliced job begun before this upload is stale
      engine._overlayMaskBounds = bounds;
      engine._overlayMaskBasinScale = !!basinScale;
      engine._overlayMaskPaintZoom = z;
      // The region the painter truth-painted from tiles = the strict viewport at paint time; the
      // canvas ring outside it holds NE base truth (sane but coarser). Hysteresis keys on this box.
      engine._overlayMaskTruthBox = view;
      engine._overlayPaintDegraded = !!(applied && applied.degraded);
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        window.__RAW_GPU__.basemapWaterMask = { applied: true, at: new Date().toISOString(), overlay: true, bounds, truthBox: view, degraded: engine._overlayPaintDegraded };
      }
      return true;
    };
    // 2048 cap: an overlay spans ≤ ~1°, so 2048 px keeps ≤ ~3 m/texel at deep zoom while the
    // paint + texImage2D upload cost 4× less than the 4096 tier (8 MB vs 32 MB per refresh).
    const base = () => renderMaskToCanvas(geo, bounds, { maxWidth: 2048 });
    if (sliced) {
      const isStale = () => engine._cachedMaskGeoJSON !== geo || !engine._waveData;
      return sliceMaskPaint(engine, mapInstance, opts, water, 'overlay', base, bounds, isStale, commit);
    }
    const canvas = measureMarineCpuPhase('maskBaseCanvas', base);
    const applied = measureMarineCpuPhase('maskWaterPaint', () => measureMarineMaskPaint(water, () => overlayBasemapWaterOnMask(canvas, bounds, mapInstance, water)));
    return commit(canvas, applied);
  } catch (e) {
    console.warn('[WebGLMarineEngine] viewport overlay mask refresh skipped:', e && e.message);
    return false;
  }
}

// Start a sliced paint: read the map now, paint + upload later. `base()` builds the pristine canvas in the job's first
// slice; `commit(canvas, applied)` is the same closure the synchronous path calls. Returns true (work is under way), so
// the layer's throttle is consumed exactly as by a paint; the job asks for a repaint when it lands.
function sliceMaskPaint(engine, mapInstance, opts, water, kind, base, bounds, isStale, commit) {
  const inputs = snapshotOverlayInputs(mapInstance, water);
  if (!inputs) return false;
  const seqKey = kind === 'regional' ? '_regionalPaintSeq' : '_overlayPaintSeq';
  const seq0 = engine[seqKey] || 0;
  const holder = { canvas: null };
  const steps = (function* paint() {
    holder.canvas = base();
    yield 'baseCanvas';
    return yield* overlayBasemapWaterSteps(holder.canvas, bounds, inputs);
  })();
  return startMaskJob(engine, {
    kind, steps, holder,
    isStale: () => (engine[seqKey] || 0) !== seq0 || isStale(),
    commit: (applied) => commit(holder.canvas, applied),
    onEnd: (outcome, pending) => {
      if (outcome === 'committed') { try { mapInstance.triggerRepaint(); } catch (e) { /* map gone */ } }
      if (pending && opts && typeof opts.rerun === 'function') opts.rerun();
    },
  });
}

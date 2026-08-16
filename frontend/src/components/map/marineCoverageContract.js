/**
 * marineCoverageContract.js — the delivered-coverage TERMINAL-STATE contract (pure) plus the
 * heatmap gate/clip uniform setter with location caching and telemetry.
 *
 * WHY THIS FILE EXISTS (Audit 3.1, 2026-08-15):
 *
 * A3.1-02 — `resolveDeliveredCoverage` (WebGLMarineEngine.js) bounds its repair to ONE forced
 * repaint per (gridKey, view). Its own test proves the second identical short delivery returns
 * `deliveredShort:true, forceRepaint:false` — after which the renderer resumed ORDINARY rendering
 * from a known-invalid coverage state. Under GL_CLAMP_TO_EDGE that state can paint the land-mask
 * halo indefinitely until the view or grid changes. The bound is correct (an unbounded refuse
 * repaints every 700 ms throttle tick — churn is worse than the halo); what was missing is the
 * SAFE TERMINAL ACTION after the budget is spent. This file adds it:
 *
 *     COVERED                          -> render          (action 'render')
 *     SHORT, retry unused              -> repaint once    (action 'retry')
 *     SHORT, retry exhausted           -> SAFE_DEGRADED   (action 'clip')
 *     new view/grid                    -> re-arms via resolveDeliveredCoverage's forceKey
 *
 * The chosen safe action is CLIP-TO-VALID-INTERSECTION, per-pixel in the fragment shader
 * (u_maskClipEnabled): outside the DELIVERED mask bounds, where the viewport-truth overlay has no
 * say, the heatmap blanks instead of painting edge-clamped water. The blend wash (which carries its
 * OWN world mask and never clips) still paints underneath when engaged, so the strip degrades to
 * the honest coarse field — "coarsening, never clearing" — and to bare basemap only when no wash
 * exists, which is honest "no data".
 *
 * A3.1-03 — `u_dataMaskGate` (25fd7c18) was the halo's prime suspect, "untestable from a trace".
 * MEASURED 2026-08-15 (scripts/shaderlab-gate.js, real compiled shaders, SwiftShader): the uniform
 * is real, linked and ACTIVE — and changes ZERO of 262,144 pixels in every tested geometry,
 * including the live z8.03 delivered-short strip and an exact-fit boundary. The heatmap quad is
 * rasterized exactly over the DATA bounds, so no fragment center can be outside them, so the
 * gate's `_outData && _outMask` conjunction is unsatisfiable on every rasterized fragment. The
 * gate is left in place (kill-switch compatibility) but must never again be cited as a halo
 * defense. The clip below keys on the MASK bounds ALONE and runs AFTER the overlay block — the
 * two properties the measurement showed the gate lacks — so it actually reaches the halo strip.
 *
 * WebGL note (Khronos): uniform writes to a null location are silently ignored. The setter below
 * therefore CACHES getUniformLocation per program and reports location-activity in telemetry
 * (__RAW_GPU__.heatmapGate) so "the setter ran" can never again stand in for "the program has it".
 *
 * Kill switches: __RAW_DISABLE_MASK_SHORT_CLIP__ (terminal clip off — restores "known short,
 * render normally"), __RAW_DISABLE_HEATMAP_BOUNDS_GATE__ (legacy gate A/B, unchanged).
 * Telemetry: __RAW_GPU__.coverageTerminal, __RAW_GPU__.heatmapGate.{resident,coarse}.
 */

// Pure terminal-state resolver. `delivered` is the last resolveDeliveredCoverage verdict the
// engine stored ({ deliveredShort, forceRepaint }) or null/undefined when no verdict exists yet.
// UNKNOWN fails open (state 'unknown', no clip) — the 07-03 unknown-input lesson: a wrong clip
// on missing information would blank honest pixels, a wrong render just keeps today's behavior.
export function resolveCoverageTerminalState(delivered, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (!delivered || typeof delivered.deliveredShort !== 'boolean') {
    return { state: 'unknown', action: 'render', maskClip: false, reason: 'no_verdict' };
  }
  if (!delivered.deliveredShort) {
    return { state: 'covered', action: 'render', maskClip: false, reason: 'delivered_covers' };
  }
  if (delivered.forceRepaint) {
    // The one-repaint budget is being spent this cycle — render normally while the repaint lands
    // (clipping mid-retry would blink the strip for the common transient one-frame case).
    return { state: 'retry', action: 'retry', maskClip: false, reason: 'repaint_forced' };
  }
  if (w.__RAW_DISABLE_MASK_SHORT_CLIP__ === true) {
    return { state: 'safe_degraded', action: 'render', maskClip: false, reason: 'clip_killed' };
  }
  return { state: 'safe_degraded', action: 'clip', maskClip: true, reason: 'retry_exhausted' };
}

// === WASH OVERLAY MODE (2026-08-15, step-1 attribution: the WASH is the strip's painter) ===
// `_drawCoarseBasePass` has REPLACEd its own mask with the viewport overlay UNCONDITIONALLY since
// 2026-07-04 ("the 39 km base is too coarse to trust near a coast"). The MAIN pass retired that
// assumption on 2026-07-15 (computeWideOverlayMode): a DENSE (≥4096-wide) global base mask carves
// every continent correctly, and a basin overlay's 50%-padded ring is water-FLOODED past its truth
// box (live GPU probe: overlay=255 over Ohio where base=0) — under REPLACE the flood overrides the
// correct base and paints land. The wash kept unconditional REPLACE — the asymmetry the step-1
// isolation matrix flagged as the halo's top remaining face. This resolver applies the SAME
// dense-base policy to the wash's OWN mask: min-combine when it is the dense global (the overlay
// then only ever REMOVES wash — flood ring loses to the base, crisp island truth still wins
// inside); REPLACE only for the legacy coarse mask, where the old rationale still holds.
// ⚠️ The 4096/340 thresholds MIRROR computeWideOverlayMode's baseGlobalDense clause
// (WebGLMarineEngine.js) — importing it here would cycle engine↔contract, so the two literals must
// move together. Unknown dims/span fail to legacy REPLACE (never guess a min-combine).
// Kill: __RAW_DISABLE_WASH_NO_REPLACE__ (restores unconditional REPLACE — the wash-only A/B leg,
// deliberately independent of the main pass's __RAW_DISABLE_DENSE_BASE_NO_REPLACE__).
// Telemetry: __RAW_GPU__.washOverlayMode.
export function resolveWashOverlayMode(base, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  const dims = base && base.__maskCanvasDims;
  const b = base && base.bounds;
  const span = b && typeof b.east === 'number' && typeof b.west === 'number'
    ? ((b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west) : 0;
  const dense = !!(dims && typeof dims.w === 'number' && dims.w >= 4096 && span >= 340)
    && w.__RAW_DISABLE_WASH_NO_REPLACE__ !== true;
  const out = { replace: !dense, baseGlobalDense: dense };
  if (w.__RAW_GPU__) w.__RAW_GPU__.washOverlayMode = out;
  return out;
}

// Sets u_dataMaskGate (legacy, kill-switch controlled) and u_maskClipEnabled (terminal clip) on a
// heatmap program with CACHED locations, and records the applied values + location-activity per
// pass. `pass` is 'resident' (main + rating band) or 'coarse' (_drawCoarseBasePass — always
// clip 0: the wash draws WORLD bounds whose mask uv cannot leave [0,1], and its mask is its own).
// `maskIsCached` must be true only when the bound mask texture is _cachedMaskTex — the texture
// resolveDeliveredCoverage's verdict describes; any other mask (grid-own) never clips.
export function setHeatmapGateUniforms(gl, prog, pass, delivered, maskIsCached, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (prog.__gateLoc === undefined) prog.__gateLoc = gl.getUniformLocation(prog, 'u_dataMaskGate');
  if (prog.__clipLoc === undefined) prog.__clipLoc = gl.getUniformLocation(prog, 'u_maskClipEnabled');
  const gateValue = (w.__RAW_DISABLE_HEATMAP_BOUNDS_GATE__ !== true) ? 1.0 : 0.0;
  const term = (pass === 'resident' && maskIsCached)
    ? resolveCoverageTerminalState(delivered, w)
    : { state: pass === 'resident' ? 'mask_not_cached' : 'coarse_pass', action: 'render', maskClip: false, reason: 'not_applicable' };
  const clipValue = term.maskClip ? 1.0 : 0.0;
  if (prog.__gateLoc !== null) gl.uniform1f(prog.__gateLoc, gateValue);
  if (prog.__clipLoc !== null) gl.uniform1f(prog.__clipLoc, clipValue);
  if (w.__RAW_GPU__) {
    const t = w.__RAW_GPU__.heatmapGate = w.__RAW_GPU__.heatmapGate || {};
    t[pass] = {
      gateLocationActive: prog.__gateLoc !== null, clipLocationActive: prog.__clipLoc !== null,
      gateValue, clipValue, terminal: term.state, action: term.action, reason: term.reason,
    };
    w.__RAW_GPU__.coverageTerminal = term;
  }
  return term;
}

// OVERLAY TRUTH GATE (AV-01a, Audit 4.0 independent verification, 2026-08-16). The engine stores
// TWO overlay boxes: _overlayMaskBounds (PADDED texture-storage geography, 50%/side) and
// _overlayMaskTruthBox (the strict viewport where basemap-tile truth was actually painted). The
// shaders historically received only the storage bounds, so the pad ring — Natural-Earth base
// truth, UNVERIFIED against tiles, live-probed wrong (overlay=255 over Ohio where base=0) — was
// consumed as semantic truth and even suppressed the SAFE_DEGRADED clip via _ovApplied. This
// resolver expresses the truth box as a RECT IN OVERLAY-UV SPACE (u linear in degrees, v a
// mercator ratio — mirroring the shader's o_u/o_v mapping; ratios of mercator DIFFERENCES are
// invariant under any affine latToMercatorY variant, so CPU and GLSL agree by construction) for
// the shader's inner gate: the overlay may speak ONLY inside it; on the ring the base/wash/clip
// decide, exactly as if the overlay were absent. Fail-open at every miss: kill switch, missing or
// degenerate boxes all return enabled:false, and the shader's u_overlayTruthEnabled=0 path is
// byte-identical to legacy (GL zero-default also protects any call site that never sets it).
// Reuse safety: the caller must pass truth=null unless the bound overlay IS the viewport overlay
// (identity check against _overlayMaskBounds — the same __mb freshness discipline as the clip).
// Kill: __RAW_DISABLE_OVERLAY_TRUTH_GATE__. Telemetry: __RAW_GPU__.overlayTruthGate.
const _mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360));
export function resolveOverlayTruthUv(storage, truth, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  const tell = (r) => { if (w.__RAW_GPU__) w.__RAW_GPU__.overlayTruthGate = r; return r; };
  const open = (reason) => tell({ enabled: false, reason, min: [0, 0], max: [1, 1] });
  if (w.__RAW_DISABLE_OVERLAY_TRUTH_GATE__ === true) return open('killed');
  const num = (b) => !!b && ['west', 'south', 'east', 'north'].every((k) => Number.isFinite(b[k]));
  if (!num(storage)) return open('no_storage');
  if (!num(truth)) return open('no_truth');
  const uSpan = storage.east - storage.west;
  const vSpan = _mercY(storage.south) - _mercY(storage.north);
  if (!(uSpan > 1e-4) || !(vSpan < -1e-9)) return open('degenerate_storage');
  const u = (lng) => (lng - storage.west) / uSpan;
  const v = (lat) => (_mercY(storage.south) - _mercY(lat)) / vSpan;
  const rect = {
    enabled: true, reason: 'gated',
    min: [Math.max(0, u(truth.west)), Math.max(0, v(truth.south))],
    max: [Math.min(1, u(truth.east)), Math.min(1, v(truth.north))],
  };
  if (!(rect.min[0] < rect.max[0]) || !(rect.min[1] < rect.max[1])) return open('degenerate_truth');
  return tell(rect);
}

// Uploads the truth rect with CACHED locations (the Khronos null-location silent-ignore trap —
// same discipline as setHeatmapGateUniforms). enabled=0 writes ONLY the flag: below 0.5 the
// shader never reads the rect, so stale rect values can never act. Location activity is stamped
// onto the telemetry object so "the setter ran" can never stand in for "the program has it".
export function setOverlayTruthUniforms(gl, prog, rect) {
  if (prog.__otEnLoc === undefined) {
    prog.__otEnLoc = gl.getUniformLocation(prog, 'u_overlayTruthEnabled');
    prog.__otMinLoc = gl.getUniformLocation(prog, 'u_overlayTruth_min');
    prog.__otMaxLoc = gl.getUniformLocation(prog, 'u_overlayTruth_max');
  }
  if (rect && typeof rect === 'object') rect.locationActive = prog.__otEnLoc !== null;
  if (prog.__otEnLoc !== null) gl.uniform1f(prog.__otEnLoc, rect.enabled ? 1.0 : 0.0);
  if (rect.enabled && prog.__otMinLoc !== null) gl.uniform2f(prog.__otMinLoc, rect.min[0], rect.min[1]);
  if (rect.enabled && prog.__otMaxLoc !== null) gl.uniform2f(prog.__otMaxLoc, rect.max[0], rect.max[1]);
  return prog.__otEnLoc !== null;
}

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

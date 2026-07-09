/**
 * marineScrubHold.js — the "don't downgrade the heatmap mid-scrub" decision (2026-07-09).
 *
 * WHY: the user's "the heatmap CLEARS when I scrub" + the E-Atlantic grey rectangle is the marine
 * coarse↔regional grid FLIP during an active scrub. The multi-hour series doesn't hold a regional
 * (fine) frame for EVERY hour of the current viewport — some hours only have the coarse-GLOBAL frame
 * warmed. So dragging the scrubber across those hours commits a coarse-global grid, which at a
 * regional (zoomed-in) viewport renders as a blocky blob / coverage-boundary rectangle (block-means to
 * ~0 at the coast → reads as "cleared"), then the scrub-settle net sharpens it back on release. The
 * jarring flip is the defect.
 *
 * FIX: during an active scrub, HOLD the resident regional frame instead of uploading an incoming
 * COARSER grid — visual continuity over per-hour resolution churn (the correct scrub UX; the settle
 * net commits the right regional frame for the SETTLED hour on release). Deliberately NARROW so it
 * can't mask a real change: it holds ONLY when the incoming grid is coarse/global, a REGIONAL grid
 * that COVERS the viewport is already resident, and it's the same model+layer. Same/finer grids never
 * hold — the heatmap keeps tracking the scrubber (preserving the synchronous-scrub-upload guardrail
 * `6f173bc0`/`a9c30178`). It also self-selects by geometry (like the existing
 * `isResidentRegionalAtGlobalViewport` guard): at a zoomed-OUT viewport the resident is global (not
 * regional) so it never fires, and coarse-global uploads normally there (it's the correct product).
 *
 * Pure — all geometry is passed in — so it's unit-testable headless. Kill switch is applied by the
 * caller (`__RAW_MARINE_SCRUB_HOLD_DISABLED__`), threaded here as `disabled`.
 */

// Longitudinal width of a bounds in degrees, antimeridian-safe (east < west ⇒ wraps +360).
export function boundsWidth(b) {
  if (!b || typeof b.west !== 'number' || typeof b.east !== 'number') return 0;
  return (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west;
}

// True if grid bounds `gb` fully contain viewport bounds `vb` (small epsilon for float jitter).
// Antimeridian-safe by shifting east up by 360 where a bounds wraps.
export function coversViewport(gb, vb, eps = 1e-6) {
  if (!gb || !vb) return false;
  const gWest = gb.west, gEast = (gb.east < gb.west) ? gb.east + 360 : gb.east;
  const vWest = vb.west, vEast = (vb.east < vb.west) ? vb.east + 360 : vb.east;
  return gWest <= vWest + eps && gEast >= vEast - eps &&
         gb.south <= vb.south + eps && gb.north >= vb.north - eps;
}

// A grid is "coarse" (a downgrade target) when it spans ~the globe or is tagged as a global product.
export function isCoarseGrid(bounds, coverageScope) {
  return boundsWidth(bounds) >= 340 || coverageScope === 'global' || coverageScope === 'global_coarse';
}

/**
 * Decide whether to HOLD the resident frame rather than upload the incoming one, during a scrub.
 * Returns true ONLY for a regional→coarse downgrade over a viewport-covering resident, same target.
 * @returns {boolean}
 */
export function shouldHoldScrubDowngrade({
  scrubbing, disabled, sameTarget,
  incomingBounds, incomingScope, residentBounds, viewportBounds,
}) {
  if (disabled || !scrubbing || !sameTarget || !residentBounds) return false;
  // Same/finer incoming → let it upload so the heatmap keeps tracking the scrubber.
  if (!isCoarseGrid(incomingBounds, incomingScope)) return false;
  // Only hold OVER a resident REGIONAL grid — if the resident is already global, coarse IS correct.
  const resW = boundsWidth(residentBounds);
  if (!(resW > 0 && resW < 340)) return false;
  // And only when that resident actually covers the current viewport (else holding shows a partial
  // rectangle — worse than uploading). Null viewport (map mid-load) → don't hold (safe default).
  return coversViewport(residentBounds, viewportBounds);
}

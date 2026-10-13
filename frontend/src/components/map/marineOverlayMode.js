/**
 * marineOverlayMode.js — how the viewport-truth overlay combines with the base mask.
 *
 * Its own module rather than a few lines inside WebGLMarineEngine.js: that file is grandfathered
 * over the 800-LOC ratchet and may only SHRINK, and marineEngineDecisions.js is close enough to the
 * limit that adding this would push it over. The rationale below is load-bearing and must not be
 * compressed away to fit a budget — the repo's rule is to RELOCATE rationale, never delete it.
 */

/**
 * MID-CARVE REPLACE (2026-08-17) — the residual island halo, attributed and repaired.
 *
 * THE DEFECT. When the mid-zoom carve engages, the shader does `oceanAlpha = min(base, overlay)`.
 * Those two masks are built from DIFFERENT coastlines — the base from the grid's coastline geojson,
 * the overlay from basemap water truth — so wherever they disagree, min() takes the UNION of both
 * land areas and carves an extra strip of real water. Around an island that strip closes into a
 * ring, which is the halo the owner reported as "more visible on the islands".
 *
 * MEASURED by alpha matting (alpha-lever-isolated.js: one page load per leg, replicated), grouping
 * ten runs at Madeira by the compositing mode actually used rather than by the lever flipped:
 *     min_combine   (4 runs)  alpha spread 0.606 / 0.615 / 0.594 / 0.219   <- the halo
 *     REPLACE       (5 runs)  alpha spread 0.024 / 0.011 / 0.011 / 0.011 / 0.024   <- flat, no halo
 *     off           (1 run)   0.113
 * Alpha at the shoreline is 0.10 under min-combine and ~0.68 flat under REPLACE. The mode is the
 * whole story; every lever that appeared to "fix" it was only changing which mode the engine landed
 * in. ⭐ Grouping by lever gave contradictory answers twice; grouping by MODE is clean.
 *
 * WHY REPLACE IS SAFE **HERE** SPECIFICALLY, when it was not safe historically. The Istria/Susak
 * regression came from REPLACE with an overlay that did NOT contain the viewport: its padded ring
 * clamped to edge-water and flooded. `computeMidZoomOverlayEngage` already refuses unless the
 * overlay CONTAINS the viewport and is non-degraded — exactly the precondition whose absence caused
 * that flood. Those conditions are restated here rather than inherited, so this function is safe to
 * read on its own and cannot silently outlive them.
 *
 * Kill: `__RAW_DISABLE_MIDCARVE_REPLACE__` restores min-combine (the pre-2026-08-17 behaviour).
 */
export function computeMidCarveReplace(opts) {
  const o = opts || {};
  if (o.killed) return false;
  if (!o.midCarveEngage) return false;
  if (!o.overlayCoversViewport) return false;   // the padded-ring precondition, restated
  if (o.overlayPaintDegraded === true) return false;
  return true;
}

// MID-ZOOM COASTAL CARVE gate (2026-07-21). Below the z>=12 deep-zoom overlay gate the coarse
// coastline-geojson base mask haloes wash onto the coast (user live A/B off John Pennekamp, halo
// band z~8.75–12.13). The viewport-truth overlay min()-combines and ONLY EVER removes wash, so
// engaging it earlier can tighten the coast but never add bleed. Pure + exported so the render's
// engage decision is unit-tested. TRUE ⇒ min-combine the viewport overlay at mid zoom. Requires the
// overlay to CONTAIN the viewport (no padded-ring exposure — never a REPLACE-style ring flood) and
// to be non-degraded. Kill via midCarveOff (__RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__ at the call site).
export const MIDZOOM_OVERLAY_CARVE_MIN_Z = 8;   // 9->8 2026-08-16, LOP-0003 (repair half only)
export function computeMidZoomOverlayEngage(opts) {
  const o = opts || {};
  if (o.midCarveOff) return false;
  // Fail safe on an unknown zoom (undefined/null/NaN all fall here — typeof NaN === 'number' would
  // otherwise slip through): a wrong "engage" could flood, a wrong "skip" just leaves today's behavior.
  if (!Number.isFinite(o.z) || o.z < MIDZOOM_OVERLAY_CARVE_MIN_Z) return false;
  if (!o.overlayCoversViewport) return false;
  if (o.overlayPaintDegraded === true) return false;
  return true;
}

/**
 * The overlay-mask telemetry `reason`, as a pure function so its PRECEDENCE is testable.
 *
 * ⛔ THE BUG THIS FIXES (2026-08-17). The inline expression tested `_overlayReplace` BEFORE
 * `overlayOn`, so an overlay that was NOT APPLIED still reported a mode name. Observed live at
 * Madeira: `{on:false, replace:true, reason:'coverage_gap', bounds:null}` — a string that reads
 * "the overlay is active in coverage-gap mode" while nothing was applied and bounds were null.
 * It misled this session's own halo diagnosis in BOTH directions, and the question it exists to
 * answer — "is viewport truth reaching this coast?" — is exactly the question the island-halo
 * investigation turns on.
 *
 * ★ `on` is the ground truth for "is the overlay applied". A reason may only DESCRIBE that state,
 * never contradict it. Every label for the on-cases is preserved verbatim; only the off-cases
 * change, and they collapse to the drop reason or plain 'off'.
 */
export function overlayTelemetryReason(opts) {
  const o = opts || {};
  if (o.nonCoveringDrop) return 'noncovering_drop';
  if (o.degradedDrop) return 'degraded_drop';
  if (!o.overlayOn) return 'off';
  if (o.overlayReplace) {
    if (o.midCarveReplace && !o.overlayReplaceWide) return 'midcarve_replace';
    return (o.gwSpan >= 340) ? 'world_grid' : 'coverage_gap';
  }
  return o.baseGlobalDense ? 'dense_base_min_combine' : 'min_combine';
}

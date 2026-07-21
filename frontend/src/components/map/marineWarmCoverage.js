/**
 * #10 MARINE WARM-COMMIT COVERAGE GUARD (2026-07-21).
 *
 * The marine warm-commit lanes (scrub-cache instant re-index, cooldown fallback, series-frame
 * serve) re-display a cached grid without a live network round-trip. Several of them classify a
 * grid as "regional" and reject it only when the viewport is ZOOMED OUT — so when you are zoomed
 * IN over region A and a regional grid for region B is in cache, it commits anyway and paints a
 * floating rectangle at B's location (the render's regional cull only fires zoomed out). This is
 * the containment cluster (#10 + #13 Ecuador) mapped in scratchpad/marine_cluster_map.md.
 *
 * marineWarmCommitCovers is the coverage half of `regionalValidInPlace`
 * (useMarineOrchestrator.js:556): a width-regional grid may only warm-commit when it COVERS the
 * current viewport — at ANY zoom. A GLOBAL-width grid (or one flagged global scope) covers
 * everything. Fail-OPEN on any missing input (never suppress a commit we cannot judge), mirroring
 * the #11 `marineRefeedCovers` predicate it is modelled on.
 *
 * Kill switch: window.__RAW_DISABLE_MARINE_WARM_COVERAGE__ === true forces the legacy "always
 * covers" answer so every call site restores its exact prior behaviour for a clean A/B.
 *
 * @param {object} grid  a marineData-shaped object (bounds at grid.grid.bounds or grid.bounds).
 * @param {{west:number,south:number,east:number,north:number}|null} vb  the viewport bounds.
 * @param {object} [win]  window override (tests); defaults to the ambient window.
 * @returns {boolean} true if the grid covers the viewport (or coverage cannot be judged).
 */
export function marineWarmCommitCovers(grid, vb, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (w && w.__RAW_DISABLE_MARINE_WARM_COVERAGE__ === true) return true; // guard off -> legacy always-covers
  if (!grid) return true; // nothing to judge -> fail-open (callers already gate on grid presence)
  const gb = grid.grid?.bounds || grid.bounds;
  if (!gb) return true; // no bounds -> legacy behaviour
  const { west: gw, east: ge, south: gs, north: gn } = gb;
  if ([gw, ge, gs, gn].some((v) => typeof v !== 'number' || !isFinite(v))) return true; // malformed -> fail-open
  const cs = grid.coverage_scope || grid.coverageMode || grid.grid?.coverage_scope || grid.grid?.coverageMode;
  const span = gw > ge ? (ge + 360) - gw : ge - gw;
  if (span >= 340 || cs === 'global' || cs === 'global_coarse') return true; // global covers everything
  if (!vb) return true; // no viewport -> fail-open
  const { west: vw, east: veRaw, south: vs, north: vn } = vb;
  if ([vw, veRaw, vs, vn].some((v) => typeof v !== 'number' || !isFinite(v))) return true; // malformed vp -> fail-open
  const eps = 0.05; // sliver tolerance: a pan-edge grid ~0.05deg short still "covers" (no refetch churn, #11 lesson)
  // Antimeridian-aware longitudinal unwrap — mirrors useMarineOrchestratorScrubCache isContained
  // (lines 114-120): unwrap viewport and grid east independently against their own west.
  let vEast = veRaw; if (vEast < vw) vEast += 360;
  let gEast = ge; if (gEast < gw) gEast += 360;
  return gs <= vs + eps && gn >= vn - eps && gw <= vw + eps && gEast >= vEast - eps;
}

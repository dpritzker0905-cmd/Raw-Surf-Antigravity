/**
 * marineCommitArbiter.js — ARBITER PHASE B: the candidate decision function, running in SHADOW.
 *
 * Design: docs/runbooks/DESIGN-2026-07-18-marine-commit-arbiter.md. Phase A gave every commit a
 * {lane, tier, flavor, hour} descriptor; this module is the ONE priority-ordered rule list that
 * is intended to eventually replace the accumulated pairwise guards (no-downgrade, subcover,
 * rating-grace, flavor-mismatch…). In Phase B it decides NOTHING — the engine calls it alongside
 * the real guards, counts agreement, and ring-logs divergences (`arb_shadow_diverge`). The rules
 * are the DESIGN's ideal list, deliberately simpler than the guards: divergences are the data
 * that tunes this list (or proves a guard nuance load-bearing) before any flip.
 *
 * Pure and window-free: every input arrives via arguments. First match wins.
 */

const ZOOMED_OUT_MAX_ZOOM_DEFAULT = 6.5;

function cellDegOf(grid) {
  if (!grid || !grid.bounds || !(grid.cols > 0)) return null;
  const span = (grid.bounds.east < grid.bounds.west)
    ? (grid.bounds.east + 360) - grid.bounds.west
    : grid.bounds.east - grid.bounds.west;
  return span > 0 ? span / grid.cols : null;
}

function spanLngOf(grid) {
  if (!grid || !grid.bounds) return null;
  const b = grid.bounds;
  return (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west;
}

// Fractional viewport coverage of a grid's bounds; null when unknowable.
// viewportBounds is the engine's array form: [west, south, east, north].
function coverageFrac(grid, viewportBounds) {
  if (!grid || !grid.bounds || !Array.isArray(viewportBounds) || viewportBounds.length < 4) return null;
  const [vw, vs, ve, vn] = viewportBounds;
  const b = grid.bounds;
  const vpArea = (ve - vw) * (vn - vs);
  if (!(vpArea > 0)) return null;
  const ix = Math.max(0, Math.min(b.east, ve) - Math.max(b.west, vw));
  const iy = Math.max(0, Math.min(b.north, vn) - Math.max(b.south, vs));
  return (ix * iy) / vpArea;
}

/**
 * Decide whether `incoming` should replace `resident`.
 * ctx: { zoom, viewportBounds:[w,s,e,n], flavorWant, zoomedOutMaxZoom?, coverFrac? }
 * Returns { verdict: 'commit'|'reject', rule }.
 */
export function arbiterDecide(resident, incoming, ctx = {}) {
  const zMax = typeof ctx.zoomedOutMaxZoom === 'number' ? ctx.zoomedOutMaxZoom : ZOOMED_OUT_MAX_ZOOM_DEFAULT;
  const minCover = typeof ctx.coverFrac === 'number' ? ctx.coverFrac : 0.6;

  // 1. Nothing resident (or resident unrenderable/empty) — commit anything renderable.
  const residentLive = !!(resident && resident.vectors && resident.vectors.length && resident.__renderable !== false);
  if (!residentLive) return { verdict: 'commit', rule: 'empty_resident' };

  // 2. Cross-model replacement is deliberate; resolution comparison across models is meaningless.
  if ((resident.__sourceModel || 'GFS') !== (incoming.__sourceModel || 'GFS')) {
    return { verdict: 'commit', rule: 'model_switch' };
  }

  // 3. Layer switch — same reasoning.
  if ((resident.__componentLayer || 'waves') !== (incoming.__componentLayer || 'waves')) {
    return { verdict: 'commit', rule: 'layer_switch' };
  }

  // 4. Hour change — a scrub must always advance the clock.
  if (incoming.hourOffset !== undefined && resident.hourOffset !== undefined
      && incoming.hourOffset !== resident.hourOffset) {
    return { verdict: 'commit', rule: 'hour_change' };
  }

  // 5. Flavor rules (want = the surf-rating flag at decision time).
  const rRated = !!resident.ratingMode, iRated = !!incoming.ratingMode;
  if (ctx.flavorWant === true) {
    if (iRated && !rRated) return { verdict: 'commit', rule: 'flavor_upgrade' };
    if (!iRated && rRated) {
      // A rated resident that no longer covers the viewport must still release (stranding is
      // worse than a band blink) — the guards express this as coverage+grace; the ideal rule
      // releases on coverage alone.
      const frac = coverageFrac(resident, ctx.viewportBounds);
      if (frac !== null && frac < minCover) return { verdict: 'commit', rule: 'rated_uncovering_release' };
      return { verdict: 'reject', rule: 'flavor_downgrade' };
    }
  } else if (rRated && !iRated) {
    // Flag OFF: a rated resident renders scores-as-heights — any honest incoming is a truth upgrade.
    return { verdict: 'commit', rule: 'rated_release' };
  }

  // 6. Resident no longer covers the viewport — fresh data takes over (post-pan).
  const rFrac = coverageFrac(resident, ctx.viewportBounds);
  if (rFrac !== null && rFrac < minCover) return { verdict: 'commit', rule: 'resident_uncovering' };

  // 7. Tier downgrade over a still-covering resident: reject. SHADOW-TUNED (2026-07-18 EVE-2,
  //    first divergence data): v1 gated this on zoom > zoomed-out-max, but the shipped guard —
  //    validated by the zoom-out arc's "coarsening, never clearing" — keeps a finer COVERING mid
  //    into z5.5-6.1 (battery divergences ×2, both this class, guard right both times). Coverage
  //    is the honest release: when the viewport outgrows the resident, rule 6 commits the coarse.
  //    Unknown zoom still fails OPEN (a wrong accept self-heals via sharpen; a wrong reject
  //    strands — the 07-03 lesson) via the coverage check: unknown viewport → rFrac null → no
  //    rule-6 release data → this rule still requires a KNOWN covering resident to reject.
  const rc = cellDegOf(resident), ic = cellDegOf(incoming);
  if (rFrac !== null && rc !== null && ic !== null && ic >= rc * 2.0) {
    return { verdict: 'reject', rule: 'tier_downgrade' };
  }

  // 8. Sub-covering regional over a covering world grid at a wide view: churn, reject.
  const zoomedOut = typeof ctx.zoom === 'number' && ctx.zoom <= zMax;
  const rSpan = spanLngOf(resident), iSpan = spanLngOf(incoming);
  if (zoomedOut && rSpan !== null && rSpan >= 340 && iSpan !== null && iSpan < 340) {
    const iFrac = coverageFrac(incoming, ctx.viewportBounds);
    if (iFrac !== null && iFrac < minCover) return { verdict: 'reject', rule: 'subcover_at_wide' };
  }

  // 9. Same target, adequate resident — fresher data wins.
  return { verdict: 'commit', rule: 'fresh_same_target' };
}

export const _internal = { cellDegOf, spanLngOf, coverageFrac };

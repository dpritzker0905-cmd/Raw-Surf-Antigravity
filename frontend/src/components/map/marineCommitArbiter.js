/**
 * marineCommitArbiter.js — the marine commit ARBITER: ONE priority-ordered rule list replacing
 * the accumulated pairwise guards (no-downgrade, subcover, rating-grace, flavor-mismatch…).
 *
 * Design: docs/runbooks/DESIGN-2026-07-18-marine-commit-arbiter.md.
 * STATUS (2026-07-18 EVE-3, Phase C): wired at the single decision point
 * (`decideMarineCommit` in WebGLMarineEngine.js) and reachable behind `__RAW_MARINE_ARBITER__`;
 * the shipped DEFAULT is still the guard chain. In guard mode this module also runs in SHADOW,
 * ring-logging divergences as `arb_shadow_diverge`.
 *
 * ⚠️ THE RULES ARE NOT "the ideal simpler list" ANY MORE — that framing cost real time. Every
 * guard nuance this list once omitted turned out to encode a historical outage (07-01 coarse⇄
 * regional spin, 07-03 permanent wedge, 07-05 island shadow, round-12 §4f band blink). The list
 * now reproduces the guard chain on 3000/3000 enumerated fixtures. Before "simplifying" a rule,
 * read `marineCommitArbiter.differential.test.js` — it will tell you exactly which scar you are
 * about to reopen. Live shadow agreement is NOT sufficient evidence: a live trajectory only walks
 * the common path, which is how a 89/89 soak hid 166 divergences.
 *
 * Pure and window-free: every input (including time, and the caller-owned grace state) arrives
 * via arguments. First match wins.
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
 * ctx: { zoom, viewportBounds:[w,s,e,n], flavorWant, zoomedOutMaxZoom?, coverFrac?,
 *        graceState?, nowMs?, graceMs?, graceDisabled? }
 * `graceState` is a caller-owned mutable {key,startedAt,expired} — the rating-interlude bound.
 * The module stays window-free: every input (including time) arrives via arguments.
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
  const rCell = cellDegOf(resident), iCell = cellDegOf(incoming);
  // A ≥2× cell-size downgrade over a resident that still COVERS is the 07-01 coarse⇄regional
  // "spin" / 07-05 island-shadow geometry. Computed here because two flavor rules below must
  // respect it — a rating transition is not a licence to collapse resolution.
  const rFracEarly = coverageFrac(resident, ctx.viewportBounds);
  const tierCollapse = rFracEarly !== null && rFracEarly >= minCover
    && rCell !== null && iCell !== null && iCell >= rCell * 2.0;
  if (ctx.flavorWant === true) {
    // DIFFERENTIAL-SWEEP FIX (2026-07-18 EVE-3, 3000-fixture guard/arbiter sweep, 35 divergences
    // in this class): `flavor_upgrade` sat ABOVE the tier check, so ANY rated incoming — including
    // the WORLD coarse — displaced a covering finer unrated resident. At z9.3 that is a visible
    // blocky collapse, and it is exactly the ping-pong the no-downgrade guard was built to kill
    // (the guard rejects it; it was right). A rated upgrade still wins whenever it does not
    // collapse resolution over a still-covering resident.
    if (iRated && !rRated && !tierCollapse) return { verdict: 'commit', rule: 'flavor_upgrade' };
    if (iRated && !rRated) return { verdict: 'reject', rule: 'flavor_upgrade_tier_collapse' };
    if (!iRated && rRated) {
      // A rated resident that no longer covers the viewport must still release (stranding is
      // worse than a band blink) — but NOT instantly. PHASE C PRE-FLIP FIX (2026-07-18 EVE-3):
      // the Phase B soak reached 89/89 agreement WITHOUT ever exercising this class at a
      // zoomed-IN narrow viewport, because every non-covering fixture in the battery was ≥15°
      // wide — which trips the guard's wideView exemption, where guard and arbiter agree on an
      // immediate release. Unit-proven divergence (`marineCommitArbiter.test.js`, "rating-grace"):
      // guard=HOLD, arbiter=commit. Releasing instantly here re-opens round-12 §4f ("heatmap +
      // animations clear between zooms with the rating band ON"): the incoming that wins the
      // release is the UNRATED global, so ratingMode drops and the whole band blinks out until
      // the wider rated clip lands. Mirror the guard: a BOUNDED grace hold (the stash re-offers
      // every frame, so a rated incoming lands first with no blink, and expiry releases truth —
      // the stranded-rectangle class stays impossible BY THE BOUND, never by coverage).
      // WIDE-VIEW EXEMPTION (2026-07-16 pt3): at a wide viewport the display gate has ALREADY
      // hidden this non-covering rated resident, so there is no band left to protect — and
      // holding there WEDGED the zoom-out bridge promotion for the full grace window. Release
      // immediately, matching the guard.
      const frac = coverageFrac(resident, ctx.viewportBounds);
      if (frac !== null && frac < minCover) {
        const vb = ctx.viewportBounds;
        const wideView = (typeof ctx.zoom === 'number' && ctx.zoom <= zMax)
          || (Array.isArray(vb) && vb.length >= 4
              && ((vb[2] - vb[0]) > 15.0 || (vb[3] - vb[1]) > 15.0));
        const gs = ctx.graceState;
        if (!wideView && gs && ctx.graceDisabled !== true) {
          const graceMs = (typeof ctx.graceMs === 'number') ? ctx.graceMs : 4000;
          const t = (typeof ctx.nowMs === 'number') ? ctx.nowMs : Date.now();
          const rb = resident.bounds;
          const key = `${resident.__sourceModel || 'GFS'}|${resident.__componentLayer || 'waves'}`
            + `|${resident.hourOffset}|${rb ? [rb.west, rb.south, rb.east, rb.north].join(',') : 'nb'}`;
          if (gs.key !== key) { gs.key = key; gs.startedAt = t; gs.expired = false; }
          if (t - gs.startedAt < graceMs) return { verdict: 'reject', rule: 'rated_uncovering_grace' };
          gs.expired = true;
          // expired → fall through to the release (bounded, self-healing).
        }
        return { verdict: 'commit', rule: 'rated_uncovering_release' };
      }
      // DIFFERENTIAL-SWEEP FIX (2026-07-18 EVE-3; 75 divergences — the single largest class, 45%
      // of all of them): the hold must be SCOPED to a regional resident, mirroring the guard's
      // `isRegionalBounds(resident)` predicate. Unscoped, a rated WORLD-COARSE resident rejected
      // every unrated incoming forever while the flag was on — an UNBOUNDED hold with no coverage
      // release to end it (coverage can't drop: a world grid covers everything) and no grace bound
      // either, since the grace lives on the uncovering branch. That is the 07-03 permanent-wedge
      // shape, manufactured by a rule that reads as "protect the band".
      const rSpanF = spanLngOf(resident);
      const residentRegional = rSpanF !== null && rSpanF > 0 && rSpanF < 359.0;
      if (residentRegional) return { verdict: 'reject', rule: 'flavor_downgrade' };
      return { verdict: 'commit', rule: 'flavor_downgrade_world_resident' };
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
  // DIFFERENTIAL-SWEEP FIX (2026-07-18 EVE-3, 56 divergences across both directions — two
  // distinct defects in one rule):
  //  (a) the wide-view test gated on ZOOM ALONE, while the shipped guard's is
  //      `zoom <= max OR lngSpan > 15 OR latSpan > 15`. `_lastZoom` is written only by the render
  //      loop, so a commit racing a zoom change reads a STALE zoom (the 07-03 lesson) — a stale
  //      close zoom with a genuinely wide viewport skipped this rule entirely and fell through to
  //      `fresh_same_target`, committing the churn the rule exists to reject (32 cases).
  //  (b) the guard also requires the FLAVOR to match (`!!resident.ratingMode === !!incoming
  //      .ratingMode`); without it the rule rejected a RATED incoming during a rating transition,
  //      which the flavor rules above own (24 cases).
  const vbW = ctx.viewportBounds;
  // MID-BAND CEILING sync (2026-07-22/23, EURO zoom-out coarse-flash + far-zoom mask): mirror
  // shouldBridgeToCoarseGlobal / shouldRejectSubcoveringRegional's _midBandBridgeWide — the 2° mid
  // tier now serves to 120°, so a 15-120° viewport is NOT "wide" (the mid covers). The ceiling arrives
  // via CTX (decideMarineCommit passes it from the SAME `w` the guards read), keeping this module
  // window-free and byte-agreed with the guard (the differential/sequence harnesses enforce it).
  const _amcOff = ctx.midBandCeilOff === true;
  const _amc = typeof ctx.midBandCeil === 'number' ? ctx.midBandCeil : 120.0;
  const wideNow = _amcOff
    ? ((typeof ctx.zoom === 'number' && ctx.zoom <= zMax)
        || (Array.isArray(vbW) && vbW.length >= 4 && ((vbW[2] - vbW[0]) > 15.0 || (vbW[3] - vbW[1]) > 15.0)))
    : (Array.isArray(vbW) && vbW.length >= 4 && ((vbW[2] - vbW[0]) > _amc || (vbW[3] - vbW[1]) > _amc));
  const zoomedOut = wideNow && rRated === iRated;
  const rSpan = spanLngOf(resident), iSpan = spanLngOf(incoming);
  if (zoomedOut && rSpan !== null && rSpan >= 340 && iSpan !== null && iSpan < 340) {
    const iFrac = coverageFrac(incoming, ctx.viewportBounds);
    if (iFrac !== null && iFrac < minCover) return { verdict: 'reject', rule: 'subcover_at_wide' };
  }

  // 9. Same target, adequate resident — fresher data wins.
  return { verdict: 'commit', rule: 'fresh_same_target' };
}

export const _internal = { cellDegOf, spanLngOf, coverageFrac };

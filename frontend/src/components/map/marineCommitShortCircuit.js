/**
 * marineCommitShortCircuit.js — §7g-β "same-product clip" commit short-circuit (2026-07-14).
 *
 * WHY (round-12 §7g churn decode): at mid-tier zooms every pan/zoom gesture sends a new padded
 * bbox, the backend resolver clips the SAME product (e.g. `*_global_mid`) to it, and each landed
 * clip is a fresh commit → texture re-upload + mask rebuild + particle churn — for data the
 * resident grid already displays. The existing duplicate-commit dedup can't catch this: its
 * signature includes dims + content hash, and a different clip window of the same product has
 * different dims, so it always reads as "new data".
 *
 * FIX: skip the commit when the incoming grid is PROVABLY a spatial subset of the SAME data the
 * resident already shows. "Provably" is the load-bearing word — the §4.5 encode-dedup arc was
 * FALSIFIED precisely because an identity signature without a data-revision component risks
 * pinning a stale texture. Every check below must hold, or the commit proceeds untouched:
 *
 *   1. same model + layer + hourOffset;
 *   2. same productId — NON-NULL on both sides (the id embeds the frame's valid_time);
 *   3. same run_time — NON-NULL on both sides (the DATA-REVISION component: a re-ingested
 *      product keeps its id but advances run_time, and that fresher data must always commit;
 *      grids from paths that don't carry run_time simply never short-circuit — safe default);
 *   4. same validTime when both sides carry one, same ratingMode, same stale flag;
 *   5. resident bounds fully CONTAIN the incoming bounds (antimeridian-safe) — the incoming
 *      clip adds zero spatial coverage;
 *   6. incoming is not FINER-sampled than the resident (the resolver may subsample large
 *      windows; a smaller window can come back denser and must commit);
 *   7. the commit ledger still points at the resident (`prev.__committedSig ===
 *      lastCommittedSig`, non-null) — every recovery hatch that NULLs the ledger to force an
 *      identical re-commit through (engine-empty §2b, toggle re-feed, model switch) keeps
 *      working, because a nulled ledger disables the skip.
 *
 * Pure — everything is passed in — so it's unit-testable headless. Kill switch is applied by
 * the caller (`window.__RAW_DISABLE_COMMIT_SHORT_CIRCUIT__`), threaded here as `disabled`.
 * Telemetry at the call site: pipeline event + `__MARINE_COMMIT_SHORT_CIRCUIT__` + forensic ring.
 */

import { coversViewport, boundsWidth } from './marineScrubHold';

// run_time lives on the wrapper for some paths (series frames) and on the grid for others —
// same defensive chain as useMarineWindData.
function readRunTime(d) {
  return d?.run_time ?? d?.runTime ?? d?.grid?.run_time ?? d?.grid?.runTime ?? null;
}

function readHour(d) {
  const h = d?.hourOffset ?? d?.grid?.hourOffset;
  return typeof h === 'number' ? h : null;
}

// Grid spacing in degrees per cell step along each axis; null when degenerate (≤1 col/row —
// a 1-wide grid has no measurable spacing, and skipping on it would be a guess).
function gridSpacing(g) {
  if (!g?.bounds || !(g.cols > 1) || !(g.rows > 1)) return null;
  const lng = boundsWidth(g.bounds) / (g.cols - 1);
  const lat = (g.bounds.north - g.bounds.south) / (g.rows - 1);
  return (lng > 0 && lat > 0) ? { lng, lat } : null;
}

/**
 * Decide whether the incoming commit is a redundant same-product clip of the resident.
 * @returns {false | object} false = commit normally; object = skip detail for telemetry.
 */
export function shouldShortCircuitSameProductCommit({ disabled, prev, incoming, lastCommittedSig }) {
  if (disabled) return false;
  const pg = prev?.grid, ng = incoming?.grid;
  if (!pg?.vectors?.length || !ng?.vectors?.length) return false;
  if (ng.renderable === false) return false;

  // (7) Ledger agreement FIRST — a nulled/diverged ledger means someone upstream is forcing a
  // re-commit through (recovery hatch) or the engine may not actually display `prev`.
  if (!prev.__committedSig || prev.__committedSig !== lastCommittedSig) return false;

  // (1) Same target.
  if (pg.__sourceModel !== ng.__sourceModel || pg.__componentLayer !== ng.__componentLayer) return false;
  const ph = readHour(prev), nh = readHour(incoming);
  if (ph === null || nh === null || ph !== nh) return false;

  // (2)+(3) Same product AND same data revision — both ids required non-null.
  if (!pg.productId || !ng.productId || pg.productId !== ng.productId) return false;
  const prt = readRunTime(prev), nrt = readRunTime(incoming);
  if (!prt || !nrt || prt !== nrt) return false;

  // (4) Frame/flavor equality.
  const pvt = pg.validTime ?? prev.validTime ?? null;
  const nvt = ng.validTime ?? incoming.validTime ?? null;
  if (pvt && nvt && pvt !== nvt) return false;
  if (!!pg.ratingMode !== !!ng.ratingMode) return false;
  if (!!(prev.stale || pg.stale) !== !!(incoming.stale || ng.stale)) return false;

  // (5) Resident spatially contains the incoming clip.
  if (!coversViewport(pg.bounds, ng.bounds)) return false;

  // (6) Incoming not finer-sampled (5% tolerance for clip-window rounding).
  const ps = gridSpacing(pg), ns = gridSpacing(ng);
  if (!ps || !ns) return false;
  if (ns.lng < ps.lng * 0.95 || ns.lat < ps.lat * 0.95) return false;

  return {
    productId: ng.productId,
    hour: nh,
    runTime: nrt,
    residentDims: `${pg.cols}x${pg.rows}`,
    incomingDims: `${ng.cols}x${ng.rows}`,
  };
}

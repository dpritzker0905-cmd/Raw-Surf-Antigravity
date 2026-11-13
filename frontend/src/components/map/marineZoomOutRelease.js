/**
 * marineZoomOutRelease.js — the world frame takes over from a mid-zoom CLIP as soon as the clip stops covering the view
 * (2026-10-22; the owner's console on dev 8b396b11, reproduced offline by scn_zoom_out.js).
 *
 * THE DEFECT. Scrubbing at z3.5-4.5 keeps a viewport CLIP of the 2-degree global_mid resident (#459's crop show, by design). A zoom-out
 * then widens the view past the clip, and two old rules kept the clip on screen with part of the view empty:
 *   1. WebGLMarineLayer's duplicate-upload skip compares a commit with the layer's OWN last upload. A frame-store show (#427, #459)
 *      writes the engine directly, so after a show the layer's record no longer describes the engine: the zoom-out's world frame for
 *      the same hour matched the layer's earlier upload of that frame and was skipped while the engine held the clip (offline: the
 *      zoom-out's world commit reached the layer and never the engine, 40 s of a partial view; live: "chain died after
 *      orchestratorCommit (37s silent)").
 *   2. The no-downgrade guard (marineEngineDecisions.shouldRejectResolutionDowngrade) keeps a REGIONAL resident against a coarse world
 *      frame while it covers >= 60 % of the view (__RAW_DOWNGRADE_COVER_FRAC__). That is right for a 0.25-deg tile against the 10-deg
 *      or 2-deg world field (a real loss of detail). It is wrong for a clip OF the 2-degree field itself: the world frame of the same
 *      product carries the same node values plus the rest of the view, so keeping the clip only hides data (the owner's 35 s with the
 *      backstop re-driving, until coverage fell under 60 % at z3.0).
 *
 * THE RULES.
 *   - layerUploadIsStale: while the engine's resident came from a frame-store show, the layer's last upload is not what the engine
 *     holds, so no commit is a duplicate of it. The commit that follows a show then uploads, as the store's design says it does.
 *     Kill: window.__RAW_DISABLE_STORE_SHOW_RESYNC__ = true.
 *   - clipNeedsFullCover: a world frame no coarser than the resident clip (same lattice, within rounding) replaces it unless the clip
 *     covers the WHOLE view (CLIP_FULL_COVER). While scrubbing, the padded clip covers the view, so the same-hour world frame is still
 *     refused (no world/clip ping-pong per step, #459 section 4); the moment a zoom-out or a pan shows ground the clip lacks, the world
 *     frame lands. Tiles finer than the world frame, rating grids under the Surf flag and other models keep the 60 % rule.
 *     Kill: window.__RAW_DISABLE_CLIP_COVER_RELEASE__ = true.
 */
export const CLIP_FULL_COVER = 0.999;          // the whole view, less float noise in a bounds intersection
const SAME_CELL_SLACK = 1.25;                 // the world frame's cell within 25 % of the clip's: the same lattice

const W = (w) => w || (typeof window !== 'undefined' ? window : {});
const lonSpan = (b) => ((b && typeof b.west === 'number' && typeof b.east === 'number') ? ((b.east < b.west) ? b.east + 360 - b.west : b.east - b.west) : 0);
// marineEngineDecisions.gridCellDeg, repeated here: that module imports this one (no import cycle).
const cellDeg = (g) => { const s = lonSpan(g && g.bounds); return (g && g.cols >= 2 && s > 0) ? s / (g.cols - 1) : null; };

/** The layer's last-upload record is stale: the engine holds a frame-store show, not what the layer uploaded. */
export function layerUploadIsStale(engine, win) {
  const w = W(win);
  if (w.__RAW_DISABLE_STORE_SHOW_RESYNC__ === true) return false;
  const g = engine && engine._waveData && engine._waveData.waveGrid;
  return !!(g && g.__fromFrameStore);
}

/**
 * STALE REPLAY AFTER A STORE SHOW (2026-11-12, the ICON step after a blend hour; log 2026-11-12-opus-move3-six-misses.md). The upload
 * effect re-runs on every cursor change with the layer's LAST grid (dataRef). Normally that re-run is a duplicate and skipped; after a
 * store show `layerUploadIsStale` turns the skip off (rule 1 above), so a cursor move alone re-uploaded the old grid over the store's
 * frame. Traced: a PageDown run from h336 back to h126 re-committed the h336 ICON blend at cursor h144 and h130 (h128, h127), the map
 * was handed h336 data under the cursor's label, and each re-commit cleared the store's resident so its next steps waited for /grid.
 * True only for a REPLAY: the very grid object the layer last uploaded, whose own hour is not the cursor's, while the engine holds a
 * store show. Any new grid object (a zoom-out world frame, a fresh commit) still uploads.
 * SAME OBJECT, ANOTHER HOUR (advisor's question, 2026-11-13): the normal path CAN hand back the same object for a different cursor
 * hour (a cached grid may be shared; useMarineDataFetcherHelpers stamps `hourOffset` only when it is missing, the 53b1ec66
 * semantics). That re-delivery does not change `data` (same object, no re-render), so it is this very re-run, and it is refused on
 * purpose: with NO store show the same re-run is already skipped as a duplicate (computeVectorDiffAndLog,
 * `skipped_identical_content_across_hours`), so the guard only restores that behaviour while a show is up. What stays on screen is
 * the store's latest show, which is newer than that object (it was drawn after the object's upload).
 * Kill: window.__RAW_DISABLE_STALE_REPLAY_GUARD__ = true.
 */
export function isStaleReplayOverShow(engine, grid, lastUploadedGrid, cursorHour, win) {
  if (W(win).__RAW_DISABLE_STALE_REPLAY_GUARD__ === true || !grid || grid !== lastUploadedGrid) return false;
  if (!layerUploadIsStale(engine, win)) return false;
  const h = grid.hourOffset !== undefined ? grid.hourOffset : (grid.grid && grid.grid.hourOffset);
  return typeof h === 'number' && typeof cursorHour === 'number' && h !== cursorHour;
}

/**
 * True when the guard must hold a regional `resident` against `incoming` only while it covers the whole view: `incoming` is a world
 * grid of the same model and layer, no coarser than the resident (the clip's own field), and no rating protection applies.
 */
export function clipNeedsFullCover(resident, incoming, win) {
  const w = W(win);
  if (w.__RAW_DISABLE_CLIP_COVER_RELEASE__ === true || !resident || !incoming) return false;
  if (lonSpan(incoming.bounds) < 359 || !(lonSpan(resident.bounds) > 0 && lonSpan(resident.bounds) < 359)) return false;
  if ((resident.__sourceModel || 'GFS') !== (incoming.__sourceModel || 'GFS')) return false;
  if (!!resident.ratingMode !== !!incoming.ratingMode) return false;          // the rating rules decide those
  const rc = cellDeg(resident); const ic = cellDeg(incoming);
  return rc !== null && ic !== null && ic <= rc * SAME_CELL_SLACK;
}

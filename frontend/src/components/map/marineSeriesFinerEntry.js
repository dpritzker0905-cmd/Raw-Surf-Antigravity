// marineSeriesFinerEntry.js
// FINEST COVERING SERIES FRAME (2026-10-08, the paused heat map churn's series-entry half; marinePausedChurn.seriesEntry.test.js).
//
// getMarineSeriesFrame takes the EXACT viewport-key entry first and ran its "smallest containing" fallback only on a miss. A
// clamp-driven force load (runScrubSettleCheck: ensureMarineSeries force + currentPageOnly) stored a COARSE tile under the exact key
// (6 x 5 over 10 degrees, owner's console, GFS Waves z7.26 off Florida) while a neighbouring key held the 0.25-degree tile (23 x 13
// over 5.54 degrees) that also covered the view. Exact-key-first served the coarse one; the clamp sharpen committed it (it was finer
// than the 2-degree /grid clip it replaced, but still `regional_too_coarse`), and the clip, not a >= 2x downgrade of it, came back.
// The fix offers an exact-key hit to every other covering REGIONAL entry and keeps the finest.
// What it does not do: change the hour (nearest hour first), cross surf/swell flavour, or put a world grid on a regional view.
// Kill: window.__RAW_DISABLE_SERIES_FINER_ENTRY__ = true. Telemetry: __MARINE_SERIES_DIAG__.finerEntrySwaps.

import { bboxContains } from './marineBboxGeometry';

// A candidate must be this much finer to displace the exact-key frame: the clamp sharpen's own "meaningfully finer" bar
// (frameFinerEnough), so two near-identical tiles never trade places.
const FINER_FACTOR = 0.9;
const WORLD_SPAN_DEG = 340;

const lngArc = (b) => ((b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west);

// Cell size in degrees on the coarser axis (detectClamp's cellDeg), or NaN when the frame carries no usable grid.
export function seriesFrameCellDeg(frame) {
  const g = frame && frame.grid;
  const b = g && g.bounds;
  if (!b || !(g.cols > 0) || !(g.rows > 0)) return NaN;
  return Math.max(lngArc(b) / g.cols, (b.north - b.south) / g.rows);
}

// Nearest frame (within ±1.5h, 3-hourly) for an hour within one cache entry, or null.
export function nearestFrameInEntry(entry, hourOffset) {
  let best = null, bestDiff = Infinity;
  for (const h of entry.hours) {
    const d = Math.abs(h - hourOffset);
    if (d < bestDiff) { bestDiff = d; best = entry.frames.get(h) || null; }
  }
  return (best !== null && bestDiff <= 1.5) ? { frame: best, diff: bestDiff } : null;
}

/**
 * The frame to serve for a regional view given the exact-key hit `{ frame, diff }`: a meaningfully finer REGIONAL frame from another
 * live entry of the same model, layer and flavour that covers `want.bounds`, at an hour no farther than the hit's; otherwise the hit.
 * `want`: { model, layer, surf, bounds, hourOffset, now, ttlMs }.
 */
export function finestCoveringSeriesFrame(entries, hit, want) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_SERIES_FINER_ENTRY__ === true) return hit;
  const hitCell = seriesFrameCellDeg(hit.frame);
  if (!Number.isFinite(hitCell)) return hit;
  let best = hit, bestCell = hitCell * FINER_FACTOR;
  for (const entry of entries) {
    if (want.now - entry.ts >= want.ttlMs) continue;
    if (entry.model !== want.model || entry.layer !== want.layer) continue;
    if (!!entry.surf !== !!want.surf) continue;          // a swell page in surf mode would drop the rating band the hit carries
    const nf = nearestFrameInEntry(entry, want.hourOffset);
    if (!nf || nf.diff > hit.diff) continue;              // nearest hour first: never a farther hour for a finer grid
    // The SERVED frame decides, not entry.bounds (its first frame's: a page can mix bounds, #10 Source 3). A world grid on a
    // regional view is the clamp itself, however fine its cells.
    const fb = nf.frame.grid && nf.frame.grid.bounds;
    if (!fb || lngArc(fb) >= WORLD_SPAN_DEG || !bboxContains(fb, want.bounds)) continue;
    const cell = seriesFrameCellDeg(nf.frame);
    if (cell < bestCell) { bestCell = cell; best = nf; }
  }
  if (best !== hit && typeof window !== 'undefined' && window.__MARINE_SERIES_DIAG__) {
    window.__MARINE_SERIES_DIAG__.finerEntrySwaps = (window.__MARINE_SERIES_DIAG__.finerEntrySwaps || 0) + 1;
  }
  return best;
}

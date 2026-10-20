/**
 * marineSeriesStatic.js — seam B of the static frames (step 2b, 2026-10-20; DARK, see staticFrames.js).
 *
 * A WORLD series page (every viewport wider than 15 deg requests the world box) is filled from the pinned CDN
 * frames instead of one 48-frame /grid_series build on the 1-CPU box. WINDOWED: only the 2 * WINDOW_STEPS + 1
 * page hours nearest the viewed hour are fetched (that hour first, then +1, -1, +2, -2 ...; at most 4 in flight),
 * each committed to the page the moment it lands, and frames farther than KEEP_STEPS are dropped from the page.
 * A full-resolution world frame is ~15k vector objects (a few MB of heap), so whole 48-frame pages would cost
 * 100+ MB; the per-hour path (seam A, also static) covers any hour outside the window. The frames carry no
 * `decimated_stride`, so marineExactUpgrade has nothing to sharpen. Background (warm) pages are never
 * bulk-prefetched from the CDN: with an index pinned they are skipped. No index at all returns false, and
 * /grid_series runs exactly as before.
 */
import { getPinnedIndex, hasPinnedIndex, setKeyFor, staticEligible, staticSeriesFrames } from './staticFrames';
import { seriesAnchorTag } from './seriesAnchor';

export const WINDOW_STEPS = 4;
export const KEEP_STEPS = 6;
let _focus = null;

/** ensureMarineSeries records the hour being viewed, so a page fill starts there. */
export function noteStaticFocus(model, layer, hourOffset) {
  _focus = { model, layer, hourOffset: Number(hourOffset) };
}

function anchorMs() {
  const tag = seriesAnchorTag();
  const ms = tag ? Date.parse(tag.slice(1)) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function focusFor(model, layer, hours) {
  if (!_focus || _focus.model !== model || _focus.layer !== layer || !Number.isFinite(_focus.hourOffset)) return hours[0];
  const h = _focus.hourOffset;
  return (h >= hours[0] && h <= hours[hours.length - 1]) ? h : hours[0];
}

/** Page hours ordered nearest the focus first (forward before backward on a tie). */
export function nearestFirst(hours, focus) {
  return [...hours].sort((a, b) => (Math.abs(a - focus) - Math.abs(b - focus)) || (b - a));
}

/** The hour-0 mini load is redundant when the static page fill will fetch the viewed hour first. */
export function staticOwnsWorldPage(model, layer, reqBox, surf) {
  return staticEligible({ model, layer, bbox: reqBox, surf }) && hasPinnedIndex(setKeyFor(model, layer));
}

/**
 * Returns true when the static path owned this page (the caller must not fetch /grid_series), false otherwise.
 * `present()` -> Set of hours the page already holds; `commit(hour, seriesFrame)` stores one; `keepOnly(Set)` drops
 * the rest of the page's static frames.
 */
export async function loadWorldPageFromStatic({ model, layer, reqBox, surf, hours, signal, background, present, commit, keepOnly }) {
  if (!staticEligible({ model, layer, bbox: reqBox, surf })) return false;
  const anchor = anchorMs();
  if (anchor === null || !hours || hours.length === 0) return false;
  if (background) {
    const index = await getPinnedIndex(setKeyFor(model, layer)).catch(() => null);
    return !!index;                       // windowed: no whole-page CDN prefetch; the viewed page fills on demand
  }
  const ordered = nearestFirst(hours, focusFor(model, layer, hours));
  keepOnly(new Set(ordered.slice(0, 2 * KEEP_STEPS + 1)));
  const have = present();
  const todo = ordered.slice(0, 2 * WINDOW_STEPS + 1).filter((h) => !have.has(h));
  if (todo.length === 0) return true;
  const missing = await staticSeriesFrames({
    model, layer, bbox: reqBox, surf, hours: todo, anchorMs: anchor, focusHour: todo[0], signal,
    onFrames: (frames) => { for (const f of frames) commit(f.hour_offset, f); },
  });
  return missing !== null;                // null: no pinned index -> /grid_series, exactly as before
}

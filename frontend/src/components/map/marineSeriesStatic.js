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
 * REGIONAL pages (z7-9 inside a pilot box, 2026-10-23; staticRegional.js): the same seam reads the tile's bundle. A viewed page
 * of a small box fills EVERY hour (regionalFullPage), and a page decided while the products manifest is still loading waits for
 * it, bounded (regionalSeriesWait), so the map's opening pages are not sent to /grid_series only because they were early.
 */
import {
  getPinnedIndex, hasPinnedIndex, regionalPageServableSync, staticFramesBase, staticFramesEnabled, staticSeriesEligible, staticSeriesFrames,
  staticSetKeyForBox,
} from './staticFrames';
import { seriesAnchorTag } from './seriesAnchor';
import { isRegionalSetKey, regionalManifestPending, trace } from './staticRegional';
import { fetchProductsManifest } from './backendWeatherServiceClient';

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

/** The hour-0 mini load is redundant when the static page fill will fetch the viewed hour first: true = this page will not ask
 *  /grid_series. A regional page needs its index PINNED, the cover to hold on its lattice and its bundle out of any failure
 *  backoff (regionalPageServableSync); until then the mini goes (it is the first-paint lane and is never held back). */
export function staticOwnsWorldPage(model, layer, reqBox, surf) {
  if (!staticSeriesEligible({ model, layer, bbox: reqBox, surf })) return false;
  const key = staticSetKeyForBox({ model, layer, bbox: reqBox, surf });
  return isRegionalSetKey(key) ? regionalPageServableSync({ model, layer, bbox: reqBox, surf }) : hasPinnedIndex(key);
}

/**
 * A viewed REGIONAL page fills every hour, not the window: its frames are clips of a 0.25-deg tile (13 x 9 = 117 vectors at the
 * owner's z9 view) sliced from one bundle already in memory, so a day jump stays on the page (~30 ms, the series path) instead of
 * the per-hour path (~180 ms; the z9 Florida run, 2026-10-23). Only while the box is at most REGIONAL_FULL_PAGE_CELLS nodes a
 * frame (48 x 1,200 = 58k vectors a page at most) on the viewed layer, and every layer's background pages while the box is at
 * most REGIONAL_BACKGROUND_FILL_CELLS (88 at the owner's z9), so the next page is ready for a day jump; wider boxes keep the
 * window. Kill:
 * window.__RAW_DISABLE_REGIONAL_FULL_PAGE__ = true.
 */
export const REGIONAL_FULL_PAGE_CELLS = 1200;
export const REGIONAL_BACKGROUND_FILL_CELLS = 300;    // any layer's background page: 4 layers x 3 pages x 48 x 300 = 173k at most
export function regionalFullPage(model, layer, reqBox, surf, maxCells = REGIONAL_FULL_PAGE_CELLS) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_REGIONAL_FULL_PAGE__ === true) return false;
  if (!reqBox || !isRegionalSetKey(staticSetKeyForBox({ model, layer, bbox: reqBox, surf }))) return false;
  const cells = (Math.ceil((reqBox.east - reqBox.west) / 0.25) + 2) * (Math.ceil((reqBox.north - reqBox.south) / 0.25) + 2);
  return cells <= maxCells;
}

export const MANIFEST_WAIT_MS = 1500;
/**
 * null when a series page can decide now (the usual case: nothing is awaited, the timing is unchanged), else a promise that
 * settles when the products manifest has loaded or MANIFEST_WAIT_MS has passed (then the page decides as before: a miss ->
 * /grid_series). Only for a box a regional bundle could answer while the manifest is still loading (regionalManifestPending).
 * Kill: window.__RAW_DISABLE_REGIONAL_MANIFEST_WAIT__ = true.
 */
export function regionalSeriesWait(model, layer, reqBox, surf) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_REGIONAL_MANIFEST_WAIT__ === true) return null;
  if (!staticFramesEnabled() || !staticFramesBase()) return null;      // nothing static to wait for
  if (!regionalManifestPending({ model, layer, bbox: reqBox, surf })) return null;
  trace({ seam: 'wait', l: layer });
  return Promise.race([Promise.resolve().then(() => fetchProductsManifest()).catch(() => null),
    new Promise((r) => setTimeout(r, MANIFEST_WAIT_MS))]).then(() => true);
}

/**
 * Returns true when the static path owned this page (the caller must not fetch /grid_series), false otherwise.
 * `present()` -> Set of hours the page already holds; `commit(hour, seriesFrame)` stores one; `keepOnly(Set)` drops
 * the rest of the page's static frames.
 */
export async function loadWorldPageFromStatic({ model, layer, reqBox, surf, hours, signal, background, present, commit, keepOnly }) {
  if (!staticSeriesEligible({ model, layer, bbox: reqBox, surf })) return false;
  const anchor = anchorMs();
  trace({ seam: 'B', l: layer, background: !!background, anchor: anchor !== null, hours: hours ? hours.length : 0 });
  if (anchor === null || !hours || hours.length === 0) return false;
  // A small regional page fills whole, background pages too (the scrub prewarm decides every page at the map's opening, before
  // a focus exists), so a day jump onto the next page is on the page already; background pages of a wider box are only owned
  // (no /grid_series), as world pages are.
  const viewed = !!(_focus && _focus.model === model && _focus.layer === layer);
  const full = regionalFullPage(model, layer, reqBox, surf,
    !background || viewed ? REGIONAL_FULL_PAGE_CELLS : REGIONAL_BACKGROUND_FILL_CELLS);
  trace({ seam: 'B', l: layer, h0: hours[0], background: !!background, full });
  if (background && !full) {
    const key = staticSetKeyForBox({ model, layer, bbox: reqBox, surf });
    const index = await getPinnedIndex(key).catch(() => null);
    // windowed: no whole-page CDN prefetch; the viewed page fills on demand. A regional page is claimed only if it can be served.
    return !!index && (!isRegionalSetKey(key) || regionalPageServableSync({ model, layer, bbox: reqBox, surf }));
  }
  const ordered = nearestFirst(hours, focusFor(model, layer, hours));
  keepOnly(new Set(full ? ordered : ordered.slice(0, 2 * KEEP_STEPS + 1)));
  const have = present();
  const todo = (full ? ordered : ordered.slice(0, 2 * WINDOW_STEPS + 1)).filter((h) => !have.has(h));
  if (todo.length === 0) return true;
  const missing = await staticSeriesFrames({
    model, layer, bbox: reqBox, surf, hours: todo, anchorMs: anchor, focusHour: todo[0], signal,
    onFrames: (frames) => { for (const f of frames) commit(f.hour_offset, f); },
    priority: background ? 'low' : 'high',  // the viewed page's bundle first; a background page's never ahead of it
  });
  if (missing === null) return false;     // null: no pinned index or not servable -> /grid_series, exactly as before
  // An ALL-MISS regional page (nothing held, nothing served: every hour outside the run) is the backend's: /grid_series runs.
  if (have.size === 0 && missing.length === todo.length && isRegionalSetKey(staticSetKeyForBox({ model, layer, bbox: reqBox, surf }))) {
    trace({ seam: 'B', l: layer, h0: hours[0], allMiss: true });
    return false;
  }
  return true;
}

/**
 * Run the windowed fill of one world page as that page's flight (marineGridSeries keeps the flight in its in-flight map).
 * Frames are committed to the page's series entry as they land; `marine_series_revalidated` fires once at the first frame
 * and once at the end (not per frame: the scrub settle and #426's listener re-run on every event).
 * deps: { seriesCache, frameToMarineData, finish(flight), evict(key) }: `evict` runs when the flight adds a page entry, so static
 * pages are bounded like /grid_series pages (SERIES_MAX). A page holds frames of ONE run: a frame from another run index
 * (`static_index`) drops the page's earlier frames first.
 */
export function runStaticPageFlight(key, ctx, { seriesCache, frameToMarineData, finish, evict }) {
  let committed = 0;
  const revalidated = () => {
    if (typeof window !== 'undefined') { try { window.dispatchEvent(new Event('marine_series_revalidated')); } catch (e) { /* ignore */ } }
  };
  const staticEntry = () => { const e = seriesCache.get(key); return e && e.staticFrames ? e : null; };
  const commit = (h, f) => {
    let entry = staticEntry();
    const fresh = !entry;
    if (fresh) {
      entry = { ts: Date.now(), frames: new Map(), hours: [], bounds: f.bounds, model: ctx.model, layer: ctx.layer,
        page: ctx.page, surf: ctx.surf, coarsePreview: false, revalCount: 0, staticFrames: true };
    }
    if (f.static_index && entry.staticIndex && f.static_index !== entry.staticIndex) entry.frames.clear();   // a new run
    if (f.static_index) entry.staticIndex = f.static_index;
    entry.frames.set(h, frameToMarineData(f, ctx.model, ctx.layer));
    entry.hours = Array.from(entry.frames.keys()).sort((a, b) => a - b);
    if (fresh) { seriesCache.set(key, entry); if (typeof evict === 'function') evict(key); }
    committed += 1;
    if (committed === 1) revalidated();
  };
  const flight = (async () => {
    try {
      return await loadWorldPageFromStatic({
        ...ctx,
        present: () => new Set(staticEntry() ? staticEntry().frames.keys() : []),
        keepOnly: (keep) => {
          const e = staticEntry();
          if (!e) return;
          for (const h of Array.from(e.frames.keys())) if (!keep.has(h)) e.frames.delete(h);
          e.hours = Array.from(e.frames.keys()).sort((a, b) => a - b);
        },
        commit,
      });
    } catch (e) {
      trace({ seam: 'B', l: ctx.layer, error: String((e && e.message) || e).slice(0, 160) });
      return false;
    } finally {
      finish(flight);
      if (committed > 1) revalidated();
    }
  })();
  flight.seriesSignal = ctx.signal;
  return flight;
}

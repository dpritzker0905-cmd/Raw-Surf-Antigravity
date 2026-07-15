/**
 * marineSharpenTrace.js — sharpen-timeline instrument for the ZOOM-OUT EXPERIENCE ARC (2026-07-15).
 *
 * WHY (HANDOFF-2026-07-15 §1, the top open item): after the §0o data-layer bridge killed the
 * blank-flash + floating FL rectangle, the user still reports "clamping + slow expansion of the
 * animations + some quick clearing" on zoom-out. The handoff is emphatic that this is the
 * documented scrub/perf MINEFIELD and prescribes: "instrument the sharpen timeline FIRST (when
 * does the regional commit land after a zoom? measure _revalidate_fetch latency + the backstop
 * cadence), THEN decide" among (a) prewarm-on-zoom-start, (b) raise the mid-res sharpen span cap,
 * (c) tune the no-downgrade frac. This module is that instrument. It makes NO pipeline change and
 * changes NO behavior — it is a pure reporter over the forensic ring already recorded by
 * marineForensics.js (`commit`, `reject_downgrade`, `engine_clear`, `snap`, …) plus lightweight
 * zoom-gesture anchors, so a single console call self-reports the whole zoom-out timeline.
 *
 * "Slow expansion" = the coarse→fine SWR sharpen cadence: on a zoom-out the coarse/mid tier serves
 * instantly, then the regional viewport tile revalidates and commits over ~seconds. This tool
 * MEASURES that latency per gesture (t_end → first FINE covering commit) and prints the tier ladder
 * (coarse-global → global_mid → regional-fine) so a speculative timing change is never made blind.
 *
 * Console API (dev — inert until armed; matches maskFloodProbe.js / scrubPerfProbe.js house style):
 *   __SHARPEN_TRACE__.arm()          → start anchoring zoom gestures against the commit ring
 *   __SHARPEN_TRACE__.report(n=5)    → per-gesture sharpen timeline for the last n ZOOM-OUT gestures
 *   __SHARPEN_TRACE__.report({dir:'in'}) → same, for zoom-IN gestures (control)
 *   __SHARPEN_TRACE__.disarm()       → detach the zoom listeners
 *   __SHARPEN_TRACE__.copy()         → put the full report JSON on the clipboard (paste to Claude)
 *   __SHARPEN_TRACE__.classify(g)    → pure grid classifier (coarse-global | mid | regional | fine)
 *
 * Recording is fire-and-forget and exception-swallowing: the instrument must never break the map.
 */
import { recordMarineEvent, forensicDump } from './marineForensics';
import { MARINE_ZOOMED_OUT_MAX_ZOOM } from './marineZoomThresholds';

// Resolution classes, coarsest → finest. Thresholds mirror WebGLMarineEngine's own predicates so
// the tool labels a grid the same way the render pipeline treats it:
//   coarse-global : span ≥ 359° AND cell° > 1.0  (isCoarseGlobalGrid) — the 37×17 ~9.7°/cell world
//   mid           : global_mid tier (~1–4°/cell clipped/padded 2° product)
//   regional      : a real regional tile that is still slightly coarse (~0.5–1°/cell)
//   fine          : GFS-Wave 0.25° native (≤ ~0.35°/cell) — the sharpen TARGET
// A gesture is "sharpened" once a `fine` (or tight `regional`) grid commits and covers the view.
export const SHARPEN_CLASS = Object.freeze({
  COARSE: 'coarse-global',
  MID: 'mid',
  REGIONAL: 'regional',
  FINE: 'fine',
  UNKNOWN: 'unknown',
});

const CLASS_RANK = { 'coarse-global': 0, mid: 1, regional: 2, fine: 3, unknown: -1 };

/**
 * Pure classifier for a committed marine grid, from the fields the `commit` forensic event carries
 * (`dims` = "colsxrows", `spanLng` = data-grid lon span in °, optional `product`/`product_id`).
 * Returns { cols, rows, cellDeg, klass }. Product-id substrings override cell-size heuristics
 * (a padded global_mid clip can read >1°/cell but is still the MID tier, not a regional tile).
 */
export function classifyMarineGrid(commit = {}) {
  const dims = commit.dims || `${commit.cols || 0}x${commit.rows || 0}`;
  const m = /^(\d+)\s*x\s*(\d+)$/.exec(String(dims).trim());
  const cols = m ? parseInt(m[1], 10) : (commit.cols || 0);
  const rows = m ? parseInt(m[2], 10) : (commit.rows || 0);
  const spanLng = typeof commit.spanLng === 'number' ? commit.spanLng : null;
  const product = String(commit.product || commit.product_id || '').toLowerCase();
  const cellDeg = (spanLng && cols) ? spanLng / cols : null;

  let klass = SHARPEN_CLASS.UNKNOWN;
  if (product.includes('global_coarse')) klass = SHARPEN_CLASS.COARSE;
  else if (product.includes('global_mid')) klass = SHARPEN_CLASS.MID;
  else if (spanLng != null && cols) {
    if (spanLng >= 359.0 && cellDeg > 1.0) klass = SHARPEN_CLASS.COARSE;         // isCoarseGlobalGrid
    else if (cellDeg <= 0.35) klass = SHARPEN_CLASS.FINE;                        // 0.25° native
    else if (cellDeg <= 0.7) klass = SHARPEN_CLASS.REGIONAL;                     // near-native tile
    else if (cellDeg <= 4.0) klass = SHARPEN_CLASS.MID;                          // 2° mid clip/pad
    else klass = SHARPEN_CLASS.COARSE;                                           // very coarse
  }
  return { cols, rows, cellDeg: cellDeg != null ? +cellDeg.toFixed(3) : null, klass };
}

const isFineEnough = (klass) => klass === SHARPEN_CLASS.FINE || klass === SHARPEN_CLASS.REGIONAL;

/**
 * Pure analysis: given the forensic ring `events` (each { t, type, ... }) and a horizon cap, split
 * out every ZOOM gesture (from the injected `zoom_start`/`zoom_end` markers) and, for each, walk
 * the commits/rejects/clears that follow to reconstruct the sharpen timeline.
 *
 * opts: { dir: 'out'|'in'|'any' (default 'out'), horizonMs: window after zoom_end to watch
 *         (default 9000), limit: max gestures returned newest-first (default 5) }
 *
 * Per-gesture result:
 *   { at, fromZoom, toZoom, dir, spanDeg,
 *     residentAtEnd,            // class of the last commit AT/BEFORE zoom_end (the instant preview)
 *     firstCommitMs,           // Δt to the first commit strictly after zoom_end (null if none)
 *     sharpenMs,               // Δt to the first FINE/REGIONAL covering commit after zoom_end
 *                              //   → null = STUCK (never sharpened within the horizon = the bug)
 *     ladder,                  // [{dMs, klass, dims, cellDeg, scope, product}] commits in the window
 *     bridgeDelta,             // data-layer zoom-out bridge fires during the gesture (§0o)
 *     coarseActiveAtEnd,       // paint-layer coarse bridge on at zoom_end (Part 1-3)
 *     clearedMs,               // Δt to an engine_clear after zoom_end (the "quick clearing"), or null
 *     rejects }                // count of no-downgrade rejects in the window (resident held)
 */
export function analyzeSharpenTimeline(events, opts = {}) {
  const dir = opts.dir || 'out';
  const horizonMs = opts.horizonMs || 9000;
  const limit = opts.limit || 5;
  const evs = (events || []).slice().sort((a, b) => a.t - b.t);

  const ends = [];
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (e.type !== 'zoom_end') continue;
    if (dir !== 'any' && e.dir !== dir) continue;
    ends.push({ e, idx: i });
  }

  const out = [];
  for (const { e } of ends) {
    const t0 = e.t;
    // Watch window ends at the next zoom_start (a new gesture began) or the horizon, whichever first.
    let winEnd = t0 + horizonMs;
    const nextStart = evs.find((x) => x.type === 'zoom_start' && x.t > t0);
    if (nextStart && nextStart.t < winEnd) winEnd = nextStart.t;

    // Resident at end = last commit at/before t0 (the grid the instant preview shows).
    let residentAtEnd = null;
    for (const x of evs) {
      if (x.type === 'commit' && x.t <= t0) residentAtEnd = classifyMarineGrid(x).klass;
    }

    const ladder = [];
    let firstCommitMs = null;
    let sharpenMs = null;
    let clearedMs = null;
    let rejects = 0;
    for (const x of evs) {
      if (x.t <= t0 || x.t > winEnd) continue;
      if (x.type === 'commit') {
        const c = classifyMarineGrid(x);
        const dMs = x.t - t0;
        ladder.push({ dMs, klass: c.klass, dims: x.dims, cellDeg: c.cellDeg, scope: x.scope || null, product: x.product || null });
        if (firstCommitMs == null) firstCommitMs = dMs;
        if (sharpenMs == null && isFineEnough(c.klass)) sharpenMs = dMs;
      } else if (x.type === 'engine_clear') {
        if (clearedMs == null) clearedMs = x.t - t0;
      } else if (x.type === 'reject_downgrade') {
        rejects++;
      }
    }

    out.push({
      at: t0,
      fromZoom: e.from != null ? +e.from.toFixed(2) : null,
      toZoom: e.to != null ? +e.to.toFixed(2) : null,
      dir: e.dir,
      spanDeg: e.spanDeg != null ? +e.spanDeg.toFixed(2) : null,
      residentAtEnd,
      firstCommitMs,
      sharpenMs,
      ladder,
      bridgeDelta: typeof e.bridgeDelta === 'number' ? e.bridgeDelta : null,
      coarseActiveAtEnd: !!e.coarseActiveAtEnd,
      clearedMs,
      rejects,
    });
  }

  return out.slice(-limit).reverse();   // newest gesture first
}

// ---- runtime harness (browser only) -------------------------------------------------------------

let _armed = false;
let _startZoom = null;
let _startBridgeCount = 0;
const _onStart = () => {
  try {
    const map = window.map;
    if (!map) return;
    _startZoom = map.getZoom();
    _startBridgeCount = (window.__MARINE_ZOOMOUT_BRIDGE__ && window.__MARINE_ZOOMOUT_BRIDGE__.count) || 0;
    recordMarineEvent('zoom_start', { from: +_startZoom.toFixed(3) });
  } catch (e) { /* never fatal */ }
};
const _onEnd = () => {
  try {
    const map = window.map;
    if (!map) return;
    const to = map.getZoom();
    const from = _startZoom != null ? _startZoom : to;
    const b = map.getBounds ? map.getBounds() : null;
    const spanDeg = b ? Math.max(b.getEast() - b.getWest(), b.getNorth() - b.getSouth()) : null;
    const bridgeCount = (window.__MARINE_ZOOMOUT_BRIDGE__ && window.__MARINE_ZOOMOUT_BRIDGE__.count) || 0;
    const coarseActiveAtEnd = !!(window.__RAW_GPU__ && window.__RAW_GPU__.coarseBridgeActive);
    recordMarineEvent('zoom_end', {
      from: +from.toFixed(3),
      to: +to.toFixed(3),
      dir: to < from - 0.02 ? 'out' : (to > from + 0.02 ? 'in' : 'flat'),
      spanDeg,
      bridgeDelta: bridgeCount - _startBridgeCount,
      coarseActiveAtEnd,
      zoomedOut: to <= MARINE_ZOOMED_OUT_MAX_ZOOM || (spanDeg != null && spanDeg > 15.0),
    });
    _startZoom = null;
  } catch (e) { /* never fatal */ }
};

function arm(opts = {}) {
  if (typeof window === 'undefined') return 'no window';
  const map = window.map;
  if (!map || typeof map.on !== 'function') return 'no window.map yet — open the map, then arm() again';
  if (_armed) return 'already armed';
  map.on('zoomstart', _onStart);
  map.on('zoomend', _onEnd);
  _armed = true;
  return 'armed — zoom out across the z7 boundary a few times, then __SHARPEN_TRACE__.report()';
}

function disarm() {
  if (typeof window === 'undefined') return 'no window';
  const map = window.map;
  if (map && typeof map.off === 'function') {
    map.off('zoomstart', _onStart);
    map.off('zoomend', _onEnd);
  }
  _armed = false;
  return 'disarmed';
}

function report(arg) {
  const opts = (typeof arg === 'number') ? { limit: arg } : (arg || {});
  const dump = forensicDump();
  const gestures = analyzeSharpenTimeline(dump.events, opts);
  try {
    // eslint-disable-next-line no-console
    console.log(`[SHARPEN] build=${dump.build} armed=${_armed} gestures(${opts.dir || 'out'})=${gestures.length}`);
    for (const g of gestures) {
      const stuck = g.sharpenMs == null ? '  ⚠️ STUCK (never sharpened in horizon)' : '';
      // eslint-disable-next-line no-console
      console.log(
        `  z${g.fromZoom}→${g.toZoom} span${g.spanDeg}°  resident@end=${g.residentAtEnd}` +
        `  firstCommit=${g.firstCommitMs}ms  sharpen=${g.sharpenMs}ms  bridgeΔ=${g.bridgeDelta}` +
        `  coarseWash@end=${g.coarseActiveAtEnd}  cleared=${g.clearedMs}ms  rejects=${g.rejects}${stuck}`
      );
      if (g.ladder.length && typeof console.table === 'function') console.table(g.ladder);
    }
  } catch (e) { /* console optional */ }
  return gestures;
}

async function copy(opts) {
  const dump = forensicDump();
  const blob = JSON.stringify({
    build: dump.build,
    armed: _armed,
    out: analyzeSharpenTimeline(dump.events, { ...(opts || {}), dir: 'out' }),
    in: analyzeSharpenTimeline(dump.events, { ...(opts || {}), dir: 'in' }),
  });
  try {
    await navigator.clipboard.writeText(blob);
    return `copied sharpen report (build ${dump.build}) to clipboard`;
  } catch (e) {
    return blob;
  }
}

if (typeof window !== 'undefined') {
  window.__SHARPEN_TRACE__ = { arm, disarm, report, copy, classify: classifyMarineGrid, analyze: analyzeSharpenTimeline };
}

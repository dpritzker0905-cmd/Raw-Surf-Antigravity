/**
 * marineSettleLiveMap.js: the scrub-settle check sees the LIVE map, and its listeners arm when a marine layer switches on
 * (SETTLE_LIVE_MAP and SETTLE_ARM_ON_ACTIVATE, 2026-10-21), plus a trace of what each settle check did.
 *
 * THE STALE MAP. useMarineScrubSettle memoises checkScrubSettle on [marineData] alone. Until a layer's FIRST marine commit
 * marineData does not change, so the callback still holds the mapInstance of the render before the map existed: null. Every
 * branch of runScrubSettleCheck then sees no map at a layer's first load: detectClamp reads no clamp, tryExactUpgrade's
 * isWideView reads "not wide", the §2b zoom-out recovery is skipped, and the SERIES-FIRST lookup throws inside its try, so a
 * series frame that has landed is not committed and the check falls through to a /grid fetch. Found by an offline in-page trace
 * on 2026-10-20 (request diet, PR #426, which reads window.map in its own branch only).
 * FIX: the check reads the map through a ref synced on every render (`mapLiveRef`), the same object once the map exists.
 *
 * THE UNARMED LISTENERS. The effect that registers the scrub-end, marine_series_revalidated and moveend listeners returns early
 * while no marine layer is active and re-runs only when the map, marineData or the check change. A layer switched on after the
 * map exists changes none of them, so until that layer's first commit no listener re-ran the check.
 * FIX: the effect also depends on whether a marine layer is active (`settleArmKey`).
 *
 * Kill switches (read at call time; the arm key at the next render):
 *   window.__RAW_DISABLE_SETTLE_LIVE_MAP__ = true          the check uses the memoised map again AND the listeners ignore activation
 *                                                          again (both parts off: the behaviour before 2026-10-21)
 *   window.__RAW_DISABLE_SETTLE_ARM_ON_ACTIVATE__ = true   the listener effect alone ignores activation again (the live map stays)
 * Neither changes a served number: the branches that exist request and draw the same products; they now run with a map.
 *
 * TRACE (both arms): window.__MARINE_SETTLE_CHECK__ = { calls, counts, recent }. `counts` is keyed '<map>|<outcome>':
 *   map      'live'    the memoised map was null or older and the live one was used (the fix acted)
 *            'same'    the memoised map is the live map
 *            'closure' the memoised map was used (kill set, or no live map)
 *            'none'    no map at all
 *   outcome  the first commit lane the check made (commit:series_settle, commit:recovery_2b, commit:series_sharpen) or fetch
 *            reason it started (fetch:timeline_scrub, fetch:clamp_resharpen, fetch:exact_upgrade), else 'none'.
 * `recent` keeps the last 40 calls ({ t: ms since navigation, map, out, data, pending }). A call made while the memoised map is
 * null (the window this module is about) also logs one `[SETTLE-LIVE]` console line, in both arms.
 */

const TRACE_MAX = 40;

export function settleLiveMapOn() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_SETTLE_LIVE_MAP__ === true);
}

export function settleArmOnActivateOn() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_SETTLE_ARM_ON_ACTIVATE__ === true);
}

/**
 * The settle listener effect's extra dependency: whether a marine layer is active, so switching one on re-arms the listeners.
 * With either kill set it is a constant, which leaves the effect's dependencies exactly as before. The live-map kill disarms too:
 * listeners armed while the check still holds a null map only re-drive it into more /grid fetches (offline, every /grid failing:
 * 5 per map open against 4 with neither part, and no picture either way), so __RAW_DISABLE_SETTLE_LIVE_MAP__ alone restores the
 * old behaviour whole.
 */
export function settleArmKey(activeMarineLayersRef) {
  if (!settleArmOnActivateOn() || !settleLiveMapOn()) return 'legacy';
  return !!(activeMarineLayersRef && activeMarineLayersRef.current);
}

/** Which map the check reads: { map, src } (src as in the trace above). Pure. */
export function settleMapFor(closureMap, mapLiveRef) {
  const closure = closureMap || null;
  const live = (mapLiveRef && mapLiveRef.current) || null;
  if (settleLiveMapOn() && live) return { map: live, src: live === closure ? 'same' : 'live' };
  return { map: closure, src: closure ? 'closure' : 'none' };
}

function recordSettleCheck(rec) {
  if (typeof window === 'undefined') return;
  const s = window.__MARINE_SETTLE_CHECK__ || (window.__MARINE_SETTLE_CHECK__ = { calls: 0, counts: {}, recent: [] });
  s.calls++;
  const k = `${rec.map}|${rec.out}`;
  s.counts[k] = (s.counts[k] || 0) + 1;
  s.recent.push(rec);
  if (s.recent.length > TRACE_MAX) s.recent.shift();
}

/**
 * Run `check(ctx)` (runScrubSettleCheck) with the map settleMapFor picks, and record what it did. The commit and fetch callbacks
 * are passed through unchanged apart from noting the first one called; everything else in `ctx` is handed over as is.
 */
export function runSettleCheckLive(check, ctx, mapLiveRef) {
  const { map, src } = settleMapFor(ctx.mapInstance, mapLiveRef);
  const w = typeof window !== 'undefined' ? window : null;
  const rec = {
    t: Math.round(typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()),
    map: src, out: 'none', data: !!(ctx.marineData && ctx.marineData.grid), pending: !!(w && w.__MARINE_FETCH_PENDING__),
  };
  const note = (out) => { if (rec.out === 'none') rec.out = out; };
  const commit = ctx.setMarineData;
  const setMarineData = typeof commit === 'function'
    ? (frame) => { note(`commit:${(frame && frame.__commitLane) || 'unknown'}`); return commit(frame); }
    : commit;
  const fetchRef = ctx.updateMarineGridRef;
  const updateMarineGridRef = fetchRef ? {
    get current() {
      const f = fetchRef.current;
      return typeof f === 'function' ? (reason, ...rest) => { note(`fetch:${reason}`); return f(reason, ...rest); } : f;
    },
  } : fetchRef;
  try {
    check({ ...ctx, mapInstance: map, setMarineData, updateMarineGridRef });
  } finally {
    recordSettleCheck(rec);
    if (!ctx.mapInstance && w && w.console) {
      w.console.log(`[SETTLE-LIVE] memoised map null: used=${src} out=${rec.out} data=${rec.data ? 1 : 0} pending=${rec.pending ? 1 : 0}`);
    }
  }
}

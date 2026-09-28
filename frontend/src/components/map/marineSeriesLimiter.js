// marineSeriesLimiter.js — the in-flight budget for marine grid_series loads (A15-11).
// Split out of marineGridSeries.js on 2026-09-28 (that file sits at its LOC-ratchet ceiling). The page
// lanes below are the code #123 put there, moved unchanged; the hour-0 MINI lane is new.
//
// Concurrency gate for grid_series fetches. The backend is 1-CPU: firing N series requests at
// once (rapid model/layer toggling warms GFS+ICON+EURO × every layer × 3 pages) slams the box
// into 503s/timeouts so NOTHING completes — the "bottleneck after scrubbing." Cap concurrent
// fetches so the box serves them ~2 at a time and each finishes fast (no contention). Requests
// queue client-side; a request whose signal aborts while queued is dropped (never hits the box),
// so superseded model/layer warms don't pile up. Tune up once the backend has more CPU.
const MARINE_SERIES_MAX_CONCURRENT = 2;
// PRIORITY (A15-11, 2026-09-27). Background warms (sibling layers, the world series behind the zoom-out
// bridge, adjacent-page idle prefetch) shared ONE FIFO with the loads the user is waiting on, so an
// activation's own pages could queue behind them, and the world /grid warm bypassed the cap entirely.
// Visible loads are now always served first; background warms hold at most ONE of the two slots and
// never start while a visible load is waiting; a visible request for a page still QUEUED as a warm
// promotes it. Nothing is dropped: every warm still runs, after what is on screen.
// Kill: window.__RAW_DISABLE_FETCH_PRIORITY__ = true -> the single FIFO, every load treated as visible.
const MARINE_SERIES_BG_MAX = 1;
// THE HOUR-0 MINI LANE (A15-11 residual, 2026-09-28). A cold series page also fires a one-hour "mini"
// request that skips the page queue, so the first frame paints before the 48-frame page lands. For a
// page the user is looking at that is the point. But every BACKGROUND warm fired one too: after #123 the
// dev E2E (run 36361175283) still peaked at 5 in flight on both browsers, and every peak was the same
// burst, 10-16 s after activation — the world warm's mini, three sibling warms' minis and the world
// 48-frame page, launched within 3 ms (the page took 25 s on Chrome). The minis are what make a sibling
// toggle instant (in those runs the sibling PAGES never ran: queued behind the world page, then
// superseded), so they stay; a background mini now waits for this lane: one at a time, never while a
// visible load is waiting. A visible mini still skips every queue. Series in flight: <= 2 pages, 1
// background mini and the gesture's own mini.
const MARINE_BG_MINI_MAX = 1;

let _seriesActiveLoads = 0;
let _bgActiveLoads = 0;
let _bgMiniActive = 0;
const _seriesWaiters = []; // visible:    [{ resolve, signal, key, background: false }]
const _bgWaiters = [];     // background: same shape, background: true
const _miniWaiters = [];   // background minis: [{ resolve, signal }]

function _priorityOn() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_FETCH_PRIORITY__ === true);
}

function _canStart(background) {
  if (_seriesActiveLoads >= MARINE_SERIES_MAX_CONCURRENT) return false;
  return !background || _bgActiveLoads < MARINE_SERIES_BG_MAX;   // _pump serves waiting visible loads first
}

function _take(background) {
  _seriesActiveLoads++;
  if (background) _bgActiveLoads++;
  return background ? 'background' : 'visible';
}

function _dropOnAbort(entry, queueOf) {
  if (!entry.signal) return;
  try {
    entry.signal.addEventListener('abort', () => {
      const q = queueOf(entry);                            // it may have been promoted
      const i = q.indexOf(entry);
      if (i >= 0) { q.splice(i, 1); entry.resolve(false); _pump(); } // dropped while queued; no slot taken
    }, { once: true });                                    // (_pump: a mini may have waited on it)
  } catch (e) { /* ignore */ }
}

/** Resolves to the lane the slot was granted in ('visible' | 'background'), or false when dropped. */
export function acquireSeriesSlot(signal, background = false, key = null) {
  const bg = !!background && _priorityOn();
  if (_canStart(bg)) return Promise.resolve(_take(bg));
  return new Promise((resolve) => {
    const entry = { resolve, signal, key, background: bg };
    (bg ? _bgWaiters : _seriesWaiters).push(entry);
    _dropOnAbort(entry, (e) => (e.background ? _bgWaiters : _seriesWaiters));
  });
}

function _nextLive(q) {
  while (q.length) {
    const w = q.shift();
    if (w.signal && w.signal.aborted) { w.resolve(false); continue; } // drop aborted-while-queued
    return w;
  }
  return null;
}

function _pump() {
  while (_seriesActiveLoads < MARINE_SERIES_MAX_CONCURRENT) {
    const v = _nextLive(_seriesWaiters);
    if (v) { v.resolve(_take(false)); continue; }
    if (_bgActiveLoads >= MARINE_SERIES_BG_MAX) break;
    const b = _nextLive(_bgWaiters);
    if (!b) break;
    b.resolve(_take(true));
  }
  while (_bgMiniActive < MARINE_BG_MINI_MAX && !_seriesWaiters.length) {
    const m = _nextLive(_miniWaiters);
    if (!m) break;
    _bgMiniActive++;
    m.resolve('mini');
  }
}

export function releaseSeriesSlot(lane) {
  if (_seriesActiveLoads > 0) _seriesActiveLoads--;
  if (lane === 'background' && _bgActiveLoads > 0) _bgActiveLoads--;
  _pump();
}

/**
 * The lane for a background warm's hour-0 mini. Resolves 'mini' when it may fetch, or false when
 * dropped (its signal aborted while queued). With the kill switch on it resolves at once, as before.
 */
export function acquireBackgroundMiniSlot(signal) {
  if (!_priorityOn()) return Promise.resolve('bypass');
  if (_bgMiniActive < MARINE_BG_MINI_MAX && !_seriesWaiters.length) {
    _bgMiniActive++;
    return Promise.resolve('mini');
  }
  return new Promise((resolve) => {
    const entry = { resolve, signal };
    _miniWaiters.push(entry);
    _dropOnAbort(entry, () => _miniWaiters);
  });
}

export function releaseBackgroundMiniSlot(lane) {
  if (lane === 'mini' && _bgMiniActive > 0) _bgMiniActive--;
  _pump();
}

/** A visible request found its page still queued as a background warm: move it to the visible queue. */
export function promoteQueuedWarm(key) {
  const i = _bgWaiters.findIndex((w) => w.key === key);
  if (i < 0) return false;
  const [w] = _bgWaiters.splice(i, 1);
  w.background = false;
  _seriesWaiters.push(w);
  _pump();
  return true;
}

/**
 * Run a background warm that is not a series page (the world /grid behind the zoom-out bridge, the
 * zoom-out anticipation grid) under the same budget, so it can no longer bypass the cap. Resolves
 * undefined when dropped (its signal aborted while queued).
 */
export async function runBackgroundWarm(fn, signal) {
  const lane = await acquireSeriesSlot(signal, true, null);
  if (!lane) return undefined;
  try { return await fn(); } finally { releaseSeriesSlot(lane); }
}

/** Test/diagnostic view of the limiter. */
export function _seriesLimiterState() {
  return { active: _seriesActiveLoads, background: _bgActiveLoads, backgroundMini: _bgMiniActive,
    queuedVisible: _seriesWaiters.length, queuedBackground: _bgWaiters.length, queuedMini: _miniWaiters.length };
}

export function _resetSeriesLimiterForTest() {
  _seriesActiveLoads = 0;
  _bgActiveLoads = 0;
  _bgMiniActive = 0;
  _seriesWaiters.length = 0;
  _bgWaiters.length = 0;
  _miniWaiters.length = 0;
}

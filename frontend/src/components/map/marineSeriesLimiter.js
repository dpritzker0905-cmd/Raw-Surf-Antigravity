// marineSeriesLimiter.js — the in-flight budget for marine grid_series loads (A15-11).
// Split out of marineGridSeries.js on 2026-09-28 (that file sat 19 lines under the 800 cap).
//
// Concurrency gate for grid_series fetches. The backend is 1-CPU: firing N series requests at
// once (rapid model/layer toggling warms GFS+ICON+EURO × every layer × 3 pages) slams the box
// into 503s/timeouts so NOTHING completes — the "bottleneck after scrubbing." Cap concurrent
// fetches so the box serves them ~2 at a time and each finishes fast (no contention). Requests
// queue client-side; a request whose signal aborts while queued is dropped (never hits the box),
// so superseded model/layer warms don't pile up. Tune up once the backend has more CPU.
import { marineSeriesWorkBoundsEnabled } from './marineSeriesWorkPolicy';
const MARINE_SERIES_MAX_CONCURRENT = 2;
const MARINE_TOTAL_MAX = 3; // two pages plus one reserved foreground mini
// Qualified policy caps all limiter-owned transport at3, foreground minis at1;
// regional intents cancel stale queues in useMarineSeriesWarm. Legacy notes below
// describe the default-off behavior. Ordinary foreground /grid and point calls
// remain outside this limiter; this is not a server-wide admission budget.
// PRIORITY (A15-11, #123). Background warms (sibling layers, the world series behind the zoom-out bridge,
// adjacent-page idle prefetch, the world /grid) shared ONE FIFO with the loads the user is waiting on.
// Visible loads are always served first, and a visible request for a page still QUEUED as a warm promotes
// it. Nothing is dropped: every warm still runs, after what is on screen.
// Kill: window.__RAW_DISABLE_FETCH_PRIORITY__ = true -> the single FIFO, every load treated as visible.
//
// ONE BACKGROUND REQUEST, ONLY WHEN IDLE (A15-11, 2026-09-28, measured after #131). A cold page also fires
// a one-hour "mini" so its first frame paints early; a visible mini skips every queue, and that stays. #131
// gave background minis a lane of their own, which removed the activation burst (peak 5 -> 3/4; p90 Chrome
// 12.5 -> 7.6 s, Safari 5.9 -> 3.5 s, dev E2E 36364803932) — but the overall peak stayed 5, on toggles and
// model switches: a background PAGE and a background MINI ran together beside the visible page, the visible
// mini and the visible /grid (which is outside this limiter). So background work now shares ONE request in
// total (pages, minis and runBackgroundWarm alike, minis first: they are cheap and they are what make a
// sibling toggle instant), and starts only while nothing visible is loading or waiting, the audit's "defer
// sibling prefetch until idle". Worst case in flight: 2 visible pages + the gesture's mini + its /grid = 4.
const MARINE_BG_MAX = 1;

let _seriesActiveLoads = 0;  // pages in flight, visible and background
let _bgActiveLoads = 0;      // background pages in flight
let _bgMiniActive = 0;       // background minis in flight
let _visibleMinis = 0;       // visible minis in flight; qualified policy reserves one slot
const _seriesWaiters = [];   // visible pages:    [{ resolve, signal, key, background: false }]
const _bgWaiters = [];       // background pages: same shape, background: true
const _miniWaiters = [];     // background minis: [{ resolve, signal }]
const _visibleMiniWaiters = [];

function _totalHasSlot() {
  return !marineSeriesWorkBoundsEnabled() || _seriesActiveLoads + _bgMiniActive + _visibleMinis < MARINE_TOTAL_MAX;
}

function _priorityOn() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_FETCH_PRIORITY__ === true);
}

function _backgroundMayStart() {
  // Idle = no visible page or mini in flight. (A visible page can only be WAITING while one is loading:
  // background holds at most one of the two slots. And an idle limiter always has a free slot.)
  const visibleLoading = _seriesActiveLoads - _bgActiveLoads > 0 || _visibleMinis > 0;
  return !visibleLoading && _bgActiveLoads + _bgMiniActive < MARINE_BG_MAX &&
    (!marineSeriesWorkBoundsEnabled() || (_visibleMiniWaiters.length === 0 && _seriesWaiters.length === 0 && _totalHasSlot()));
}

function _canStart(background) {
  if (_seriesActiveLoads >= MARINE_SERIES_MAX_CONCURRENT) return false;
  if (!_totalHasSlot()) return false;
  return !background || _backgroundMayStart();
}

function _take(background) {
  _seriesActiveLoads++;
  if (background) _bgActiveLoads++;
  return background ? 'background' : 'visible';
}

function _dropOnAbort(entry, queueOf) {
  if (!entry.signal) return;
  try {
    entry.abortHandler = () => {
      const q = queueOf(entry);                            // it may have been promoted
      const i = q.indexOf(entry);
      if (i >= 0) { q.splice(i, 1); entry.resolve(false); } // dropped while queued; no slot taken
    };
    entry.signal.addEventListener('abort', entry.abortHandler, { once: true });
  } catch (e) { /* ignore */ }
}

/** Resolves to the lane the slot was granted in ('visible' | 'background'), or false when dropped. */
export function acquireSeriesSlot(signal, background = false, key = null) {
  if (signal?.aborted) return Promise.resolve(false);
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
    if (w.abortHandler) w.signal?.removeEventListener('abort', w.abortHandler);
    if (w.signal && w.signal.aborted) { w.resolve(false); continue; } // drop aborted-while-queued
    return w;
  }
  return null;
}

function _pump() {
  if (!marineSeriesWorkBoundsEnabled()) {
    let mini;
    while ((mini = _nextLive(_visibleMiniWaiters))) { _visibleMinis++; mini.resolve('visible-mini'); }
  }
  if (marineSeriesWorkBoundsEnabled() && _visibleMinis === 0 && _totalHasSlot()) {
    const mini = _nextLive(_visibleMiniWaiters);
    if (mini) { _visibleMinis++; mini.resolve('visible-mini'); }
  }
  while (_seriesActiveLoads < MARINE_SERIES_MAX_CONCURRENT && _totalHasSlot()) {
    const v = _nextLive(_seriesWaiters);
    if (!v) break;
    v.resolve(_take(false));
  }
  if (!_backgroundMayStart()) return;
  const m = _nextLive(_miniWaiters);
  if (m) { _bgMiniActive++; m.resolve('mini'); return; }
  const b = _nextLive(_bgWaiters);
  if (b) b.resolve(_take(true));
}

export function releaseSeriesSlot(lane) {
  if (_seriesActiveLoads > 0) _seriesActiveLoads--;
  if (lane === 'background' && _bgActiveLoads > 0) _bgActiveLoads--;
  _pump();
}

/**
 * The lane for an hour-0 mini. A visible mini starts at once ('visible-mini', counted so background work
 * waits for it); a background mini waits for the background request ('mini'), or resolves false when
 * dropped (its signal aborted while queued). With the kill switch on every mini starts at once, as before.
 */
export function acquireMiniSlot(signal, background) {
  if (signal?.aborted) return Promise.resolve(false);
  if (!background || !_priorityOn()) {
    if (!marineSeriesWorkBoundsEnabled() || (_visibleMinis === 0 && _totalHasSlot())) {
      _visibleMinis++; return Promise.resolve('visible-mini');
    }
    return new Promise(resolve => {
      const entry = { resolve, signal };
      _visibleMiniWaiters.push(entry); _dropOnAbort(entry, () => _visibleMiniWaiters);
    });
  }
  if (_backgroundMayStart()) { _bgMiniActive++; return Promise.resolve('mini'); }
  return new Promise((resolve) => {
    const entry = { resolve, signal };
    _miniWaiters.push(entry);
    _dropOnAbort(entry, () => _miniWaiters);
  });
}

export function releaseMiniSlot(lane) {
  if (lane === 'mini' && _bgMiniActive > 0) _bgMiniActive--;
  if (lane === 'visible-mini' && _visibleMinis > 0) _visibleMinis--;
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
    visibleMini: _visibleMinis, queuedVisible: _seriesWaiters.length, queuedBackground: _bgWaiters.length,
    queuedMini: _miniWaiters.length, queuedVisibleMini: _visibleMiniWaiters.length };
}

export function _resetSeriesLimiterForTest() {
  _seriesActiveLoads = 0;
  _bgActiveLoads = 0;
  _bgMiniActive = 0;
  _visibleMinis = 0;
  _seriesWaiters.length = 0;
  _bgWaiters.length = 0;
  _miniWaiters.length = 0;
  _visibleMiniWaiters.length = 0;
}

/**
 * marineSiblingWarm.js — an instant marine layer toggle without the hidden layers' series load on the box (2026-10-23).
 *
 * WHY. prewarmSiblingMarineSeries (marineController) warms every other marine layer at a regional view, so a toggle is an
 * instant getModelSafeMarine hit (the orchestrator's switch instant-commit). Each sibling cost its 1-hour mini AND its 48-frame
 * series page at once, and its frame was cached only after the PAGE landed. Live at the map's opening view (z9 Florida, dev
 * 5460d13b, the lead's read 2026-10-23): swell_1 6.3 s, swell_2 6.6 s, wind_waves 11.1 s of /grid_series for layers not shown,
 * ~24 s of the 1-CPU box's ~34 s of series work for one map load.
 *
 * WHAT, per sibling layer (ICON keeps its old rule: no swell_2; the caller picks the layers):
 *   1. A static source owns its page (marineSeriesStatic.staticOwnsWorldPage: world frames, or a regional bundle once that client
 *      is on): warm it now through the static seam. Zero /grid_series.
 *   2. Otherwise its 1-hour mini goes now (the background lane: it starts after visible work, as before), and its frame is cached
 *      the moment the mini lands. The toggle is ready from a 1-hour request instead of a 48-frame page.
 *   3. Its 48-frame page waits in a queue and runs one layer at a time, only in idle time (requestIdleCallback), once no series
 *      load has been in flight or queued (visible or background) for SIBLING_QUIET_MS, the tab is visible and no scrub runs, and
 *      only after the visible layer's own page has landed (or SIBLING_PAGE_MAX_WAIT_MS has passed). Same pages as before, so a
 *      scrub after the toggle *      is on the series; they just never compete with what the user is looking at.
 * SURF MODE: no sibling warm at all (2026-10-23). A surf page runs the rating chain per node: live (Render logs, 19:44Z) one
 * session in surf mode on ICON at z7-9 kept the 1-CPU box at 100% for 10+ min, each 16-frame surf page 10-25 s of CPU, and the
 * hidden layers' surf minis and pages came on top; static frames and bundles are swell only, so nothing static can answer them.
 * Kill: window.__RAW_DISABLE_SIBLING_SURF_GATE__ = true (surf mode warms as swell does).
 * Kill: window.__RAW_DISABLE_SIBLING_IDLE_PAGES__ = true -> each sibling's mini and page at once, its frame cached after the page.
 * ASKED ONCE (2026-10-24, SIBLING_ASK_ONCE). The warm runs after every network /grid of the visible layer (marineController), and a
 * sibling whose answer gave no frame to cache (no drawable cell in the box for this model, a coarse world frame, a frame for another
 * hour) stayed "not ready", so each /grid re-asked its mini and re-queued its page. The mid-zoom session's z8 Lake Michigan replay
 * (swell, GFS <-> EURO x3 and a PageUp, dev f6433615a): GFS swell_1 / swell_2 / wind_waves minis 13 / 13 / 12 times at the opening
 * hour and 12 / 11 / 12 at the next day, their pages 5 / 4 / 3 times. Now a sibling's mini (per hour) and page (per page) for one
 * model, layer, flavour and snapped request box are asked once per SIBLING_ASK_TTL_MS (the series TTL), answered or not; an aborted
 * ask (the view moved on) does not count. Kill: window.__RAW_DISABLE_SIBLING_ASK_ONCE__ = true.
 * Telemetry: window.__RAW_SIBLING_WARM__ = { static, minis, miniFrames, pages, dropped, surfGated, askedOnce, waitMs: [last 8] }.
 */
import { ensureMarineSeries, ensureMarineSeriesHour0, isMarineSeriesPageWarm, marineSeriesPageForHour } from './marineGridSeries';
import { _seriesLimiterState } from './marineSeriesLimiter';
import { staticOwnsWorldPage } from './marineSeriesStatic';
import { normalizeRequestBbox, padRegionalBbox } from './marineBboxGeometry';
import { seriesIdentityBounds } from './marineSeriesPanGuard';
import { getSurfModeFlag } from './backendWeatherServiceClient';

export const SIBLING_PAGE_POLL_MS = 400;        // re-check a closed gate this often
export const SIBLING_PAGE_MAX_WAIT_MS = 8000;   // the visible page is 2.5-5 s cold; past this, a quiet lane is enough
// The lanes must stay quiet this long first: the visible layer's adjacent pages are queued ~1.5 s AFTER its page lands
// (marineGridSeries.scheduleIdlePrefetch), so a sibling page started in that gap would run ahead of the visible layer's own scrub.
export const SIBLING_QUIET_MS = 2000;
export const SIBLING_ASK_TTL_MS = 5 * 60 * 1000;   // marineGridSeries' SERIES_TTL_MS: a page or mini answered this recently is not re-asked
const IDLE_TIMEOUT_MS = 2500;
const _asked = new Map();         // ask key (siblingAskKey) -> when its answer landed

/** One sibling ask: a 'mini' (per hour) or a 'page' (per page) of one model, layer, flavour and snapped request box. */
export function siblingAskKey(kind, { model, layer, bounds, hourOffset }) {
  const b = seriesIdentityBounds(bounds) || bounds;
  const f = (v) => Number(v).toFixed(2);
  const page = typeof marineSeriesPageForHour === 'function' ? marineSeriesPageForHour(hourOffset, model) : null;   // (a stubbed module: per hour)
  const which = kind === 'page' && Number.isFinite(page) ? `p${page}` : `h${hourOffset}`;
  return `${kind}|${model}|${layer}|${getSurfModeFlag() ? 'surf' : 'swell'}|${which}|${f(b.west)},${f(b.south)},${f(b.east)},${f(b.north)}`;
}

/** This sibling ask was answered within SIBLING_ASK_TTL_MS (and the kill switch is off): do not ask it again. */
export function siblingAskedRecently(key, now = Date.now()) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_SIBLING_ASK_ONCE__ === true) return false;
  const t = _asked.get(key);
  return t != null && now - t < SIBLING_ASK_TTL_MS;
}

function noteAsked(key) {
  _asked.delete(key); _asked.set(key, Date.now());
  if (_asked.size > 128) _asked.delete(_asked.keys().next().value);
}

const _queue = [];                // sibling pages: [{ model, layer, bounds, hourOffset, signal, visibleLayer, cache, queuedAt }]
const _inFlight = new Set();      // `${model}_${hourOffset}_${layer}`: a mini (or, killed, a whole warm) in flight
const _awaitingPage = new Set();  // `${model}_${layer}`: its frame came from the mini, its page has not run yet
let _running = false;
let _timer = null;
let _gen = 0;
let _quietSince = null;           // when the series lanes were last seen going quiet (ticks are SIBLING_PAGE_POLL_MS apart)
let _timing = { poll: SIBLING_PAGE_POLL_MS, quiet: SIBLING_QUIET_MS, maxWait: SIBLING_PAGE_MAX_WAIT_MS };

export function siblingIdlePagesOn() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_SIBLING_IDLE_PAGES__ === true);
}

const aborted = (signal) => !!(signal && signal.aborted);

function note(field, value) {
  if (typeof window === 'undefined') return;
  const t = (window.__RAW_SIBLING_WARM__ = window.__RAW_SIBLING_WARM__ || { static: 0, minis: 0, miniFrames: 0, pages: 0, dropped: 0, waitMs: [] });
  if (field === 'waitMs') { t.waitMs.push(value); if (t.waitMs.length > 8) t.waitMs.shift(); } else t[field] = (t[field] || 0) + 1;
}

/** Surf mode holds every sibling warm (see the header). */
export function siblingSurfGated() {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_SIBLING_SURF_GATE__ === true) return false;
  try { return !!getSurfModeFlag(); } catch (e) { return false; }
}

/** A static source answers this sibling's page (marineSeriesStatic's own test, so every static seam counts): no /grid_series. */
export function siblingStaticOwned(model, layer, bounds) {
  try { return staticOwnsWorldPage(model, layer, normalizeRequestBbox(padRegionalBbox(bounds)), getSurfModeFlag()); } catch (e) { return false; }
}

/** No series load in flight or queued anywhere in the limiter: nothing visible (or already warming) to compete with. */
export function seriesLanesQuiet() {
  const s = _seriesLimiterState();
  return s.active === 0 && s.visibleMini === 0 && s.backgroundMini === 0
    && s.queuedVisible === 0 && s.queuedVisibleMini === 0 && s.queuedMini === 0 && s.queuedBackground === 0;
}

/** The gate for one queued sibling page. */
export function siblingPageMayStart(entry, now = Date.now()) {
  const scrubbing = typeof window !== 'undefined' && window.isScrubbingTimeline;
  if (scrubbing || !seriesLanesQuiet()) { _quietSince = null; return false; }
  if (typeof document !== 'undefined' && document.hidden) return false;
  if (_quietSince === null) _quietSince = now;
  if (now - _quietSince < _timing.quiet) return false;
  return isMarineSeriesPageWarm(entry.model, entry.visibleLayer, entry.bounds, entry.hourOffset)
    || now - entry.queuedAt >= _timing.maxWait;
}

function schedule(delay = _timing.poll) {
  if (_timer !== null || _queue.length === 0) return;
  const gen = _gen;
  const run = () => { if (gen !== _gen) return; _timer = null; tick(); };
  _timer = setTimeout(() => {
    if (gen !== _gen) return;
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    else run();
  }, delay);
}

function tick() {
  for (let i = _queue.length - 1; i >= 0; i--) {
    if (aborted(_queue[i].signal) || siblingSurfGated()) { _queue.splice(i, 1); note('dropped'); }   // surf turned on: a surf page
  }
  while (!_running && _queue.length && isMarineSeriesPageWarm(_queue[0].model, _queue[0].layer, _queue[0].bounds, _queue[0].hourOffset)) {
    const done = _queue.shift();                                      // warmed meanwhile (the user showed that layer): no request
    done.cache(); _awaitingPage.delete(`${done.model}_${done.layer}`);
  }
  if (_running || _queue.length === 0) return;
  const entry = _queue[0];
  if (!siblingPageMayStart(entry)) { schedule(); return; }
  _queue.shift();
  _running = true;
  note('pages'); note('waitMs', Date.now() - entry.queuedAt);
  const gen = _gen;
  Promise.resolve()
    .then(() => ensureMarineSeries(entry.model, entry.layer, entry.bounds, entry.hourOffset, entry.signal, true /* current page */, false, true /* background */))
    .then(() => { if (!aborted(entry.signal)) { noteAsked(siblingAskKey('page', entry)); entry.cache(); _awaitingPage.delete(`${entry.model}_${entry.layer}`); } })
    .catch(() => { /* best effort: the toggle still works per layer */ })
    .finally(() => { if (gen !== _gen) return; _running = false; _quietSince = null; schedule(); });   // each page waits its own quiet window
}

function enqueuePage(entry) {
  const i = _queue.findIndex((q) => q.model === entry.model && q.layer === entry.layer);
  if (i >= 0) _queue[i] = { ...entry, queuedAt: _queue[i].queuedAt };   // the newest view and hour, the first wait
  else _queue.push(entry);
  schedule();
}

/** The whole warm at once (killed, or a static source owns the page): the page, then its frame. */
function warmNow({ model, layer, bounds, hourOffset, signal, cache }) {
  const key = `${model}_${hourOffset}_${layer}`;
  if (_inFlight.has(key)) return;
  _inFlight.add(key);
  Promise.resolve()
    .then(() => ensureMarineSeries(model, layer, bounds, hourOffset, signal, true /* current page */, false, true /* background */))
    .then(() => { if (!aborted(signal)) cache(); })
    .catch(() => { /* best effort */ })
    .finally(() => { _inFlight.delete(key); });
}

/**
 * Warm one sibling layer. `frameReady`: its regional frame is already cached for this hour. `cache()` caches its current-hour
 * series frame (the caller's _cacheMarineResult bridge) and returns whether it did; it runs after each load that can make one.
 */
export function warmSiblingLayer({ model, layer, bounds, hourOffset, signal, visibleLayer, frameReady, cache }) {
  if (aborted(signal) || !bounds) return;
  if (siblingSurfGated()) { note('surfGated'); return; }
  const job = { model, layer, bounds, hourOffset, signal, visibleLayer, cache };
  if (!siblingIdlePagesOn()) { if (!frameReady) warmNow(job); return; }            // before 2026-10-23
  const pageWarm = isMarineSeriesPageWarm(model, layer, bounds, hourOffset);
  if (frameReady && (pageWarm || !_awaitingPage.has(`${model}_${layer}`))) return; // as before: a ready frame earns no page
  if (!frameReady && siblingStaticOwned(model, layer, bounds)) { note('static'); warmNow(job); return; }
  if (!frameReady) {
    const key = `${model}_${hourOffset}_${layer}`;
    const miniKey = siblingAskKey('mini', job);
    // answered already: no second mini (ASKED ONCE); its frame, if it had one, is re-cached from the series cache (no request)
    if (siblingAskedRecently(miniKey)) { note('askedOnce'); cache(); }
    else if (!_inFlight.has(key)) {
      _inFlight.add(key); note('minis');
      Promise.resolve()
        .then(() => ensureMarineSeriesHour0(model, layer, bounds, hourOffset, signal, true /* background */))
        .then(() => { if (aborted(signal)) return; noteAsked(miniKey); if (cache() && !pageWarm) { note('miniFrames'); _awaitingPage.add(`${model}_${layer}`); } })
        .catch(() => { /* best effort: the page below still brings the frame */ })
        .finally(() => { _inFlight.delete(key); });
    }
  }
  if (!pageWarm && !siblingAskedRecently(siblingAskKey('page', job))) enqueuePage({ ...job, queuedAt: Date.now() });
}

/** Test/diagnostic view. */
export function _siblingWarmState() {
  return { queued: _queue.map((q) => `${q.model}_${q.layer}`), running: _running, inFlight: [..._inFlight], awaitingPage: [..._awaitingPage] };
}

/** Real-timer tests of the whole chain shrink the waits (the decisions are tested at the real values on fake timers). */
export function _setSiblingWarmTimingForTest(t) { _timing = { ..._timing, ...t }; }

export function _resetSiblingWarmForTest() {
  _gen += 1;
  _timing = { poll: SIBLING_PAGE_POLL_MS, quiet: SIBLING_QUIET_MS, maxWait: SIBLING_PAGE_MAX_WAIT_MS };
  if (_timer !== null) clearTimeout(_timer);
  _timer = null; _running = false; _quietSince = null;
  _queue.length = 0; _inFlight.clear(); _awaitingPage.clear(); _asked.clear();
  if (typeof window !== 'undefined') delete window.__RAW_SIBLING_WARM__;
}

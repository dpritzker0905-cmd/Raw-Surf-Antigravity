/**
 * marineRequestDiet.js — the CLIENT half of the 2026-10-20 scrub-lag fix: ask the 1-CPU backend only for what the map needs,
 * and draw what already landed instead of waiting on a request still in flight.
 *
 * WHY. The lead diagnosis of 2026-10-20 measured the browser at <= 152 ms of main-thread stall per scrub step: the waits are the
 * server (on-demand 48-frame JSON pages on one CPU shared with CI) and a client that asks for more than it needs. Each piece below
 * is one measured amplifier, with its own kill switch, and all of them share one umbrella switch for an A/B on one build:
 *   PRODUCTS_SHARE              a forced /products refresh reuses the download already in flight (10.75 MB, ~1.8 s of server event
 *                               loop each; 9-13 per map open in the live access logs), and a background refresh waits
 *                               MANIFEST_BACKGROUND_REFRESH_MIN_MS between attempts (backendWeatherServiceClient.fetchProductsManifest)
 *   GRID_INSTANT_KEY            an exact /grid is reused for every hour offset whose REQUEST is the same instant (3-hourly data:
 *                               offsets 2 and 3 ask for the same valid_time) (marineControllerCache.aliasMarineHourByInstant)
 *   EXACT_UPGRADE_SKIP          no exact world /grid when the engine already holds the exact frame of that instant
 *                               (marineExactUpgrade.planExactUpgrade)
 *   SERIES_PAINT_WHILE_PENDING  a landed series frame for the selected hour is drawn while the /grid for that hour is still in
 *                               flight (marineSeriesWhilePending.js), instead of being held until the /grid lands
 *   STEP_PAGE                   an hour step that misses every cache also asks for the 48-frame page holding that hour, the hour's
 *                               own frame first (useMarineOrchestratorScrubCache.js), not only one exact /grid per step.
 *                               OFF by default (measured no gain, see REQUEST_DIET_OPT_IN): window.__RAW_STEP_PAGE__ = true
 *   SWR_RETRY_CAP               the stale-grid revalidation keeps its retry count across its own re-drive, so its cap of 3 applies
 *                               (useMarineDataFetcherCore.js resets it on every run otherwise: a stale backend was re-polled forever)
 *
 * None of these changes a served number: the same products are requested and drawn, fewer times or sooner.
 * Kill one:   window.__RAW_DISABLE_<NAME>__ = true      (e.g. window.__RAW_DISABLE_PRODUCTS_SHARE__); opt-in parts: window.__RAW_<NAME>__
 * Kill all:   window.__RAW_DISABLE_REQUEST_DIET__ = true (the visual lab's A arm: LAB_KILLS=__RAW_DISABLE_REQUEST_DIET__)
 * Telemetry:  window.__MARINE_REQUEST_DIET__ = { counts: { <event>: n }, last: { <event>: detail } }
 * Pure (no imports), so every module on the request path can read it without an import cycle.
 */

export const REQUEST_DIET_PARTS = Object.freeze([
  'PRODUCTS_SHARE', 'GRID_INSTANT_KEY', 'EXACT_UPGRADE_SKIP', 'SERIES_PAINT_WHILE_PENDING', 'STEP_PAGE', 'SWR_RETRY_CAP',
]);

/**
 * Parts that ship OFF: turn one on with window.__RAW_<NAME>__ = true (its kill switch and the umbrella still win).
 * STEP_PAGE measured no gain in the offline A/B (2026-10-20, log/2026-10-20-claude-request-diet.md section 4: regional and EURO
 * one-hour steps across a page boundary, every other part on, 3 interleaved runs per arm: equal request counts and step times
 * within noise), because the activation and moveend warm (useMarineSeriesWarm) already queue those pages, and it added up to 2.3
 * series requests per erratic session on the 1-CPU box. Kept, tested and opt-in for the case it targets: steps two or more EURO
 * pages from where the layer was activated, at a regional zoom.
 * Lead ruling 2026-10-21: it STAYS OFF pending the static-frame path (#422) and GPU-resident frames, which make per-step page
 * requests moot. Do not turn it on to "finish" #426: that adds server load the A/B found no return for.
 */
export const REQUEST_DIET_OPT_IN = Object.freeze(['STEP_PAGE']);

/** True unless the umbrella switch or this part's own switch is set (an opt-in part: only when asked for). Never throws. */
export function requestDietOn(name) {
  try {
    const optIn = REQUEST_DIET_OPT_IN.includes(name);
    if (typeof window === 'undefined') return !optIn;
    if (window.__RAW_DISABLE_REQUEST_DIET__ === true || window[`__RAW_DISABLE_${name}__`] === true) return false;
    return optIn ? window[`__RAW_${name}__`] === true : true;
  } catch (e) {
    return false;
  }
}

/** Count one diet event (what was saved or drawn sooner), keeping its latest detail. Never throws. */
export function noteRequestDiet(event, detail) {
  try {
    if (typeof window === 'undefined') return;
    const t = window.__MARINE_REQUEST_DIET__ = window.__MARINE_REQUEST_DIET__ || { counts: {}, last: {} };
    t.counts[event] = (t.counts[event] || 0) + 1;
    if (detail !== undefined) t.last[event] = { ...detail, at: Date.now() };
  } catch (e) { /* telemetry is never fatal */ }
}

/**
 * SWR_RETRY_CAP: should this updateMarineGrid run keep the SWR retry count? Only its own re-drive does ('swr_revalidation'): any
 * other source is a new ask, which starts a fresh budget exactly as before. useMarineRevalidation increments the count when the
 * timer fires and caps at 3 (live-tunable), but useMarineDataFetcherCore reset it at the top of every run, so the re-drive always
 * saw 0 and a backend that kept answering stale was asked again every 1.5 s for as long as the view stayed put.
 */
export function keepSwrRetryCount(source) {
  return source === 'swr_revalidation' && requestDietOn('SWR_RETRY_CAP');
}

/** The minimum spacing of BACKGROUND /products refreshes (a manifest not loaded yet, or empty): one 10.75 MB download per 30 s. */
export const MANIFEST_BACKGROUND_REFRESH_MIN_MS = 30000;

/**
 * PRODUCTS_SHARE, pure: may a fetchProductsManifest call START a new download? `inFlight` = one is running, `force` = the caller
 * asked for a refresh, `background` = a fire-and-forget refresh (getSharedValidTime), `lastBackgroundStartMs` = when the last
 * background refresh started. Returns 'share' (await the running one), 'skip' (a background refresh inside the spacing window: keep
 * what is cached) or 'start'. With the kill switch: the old rule (a forced call always starts a new download).
 */
export function planManifestFetch({ inFlight, force, background, lastBackgroundStartMs, nowMs }) {
  if (!requestDietOn('PRODUCTS_SHARE')) return inFlight && !force ? 'share' : 'start';
  if (inFlight) return 'share';
  if (background && Number.isFinite(lastBackgroundStartMs) && nowMs - lastBackgroundStartMs < MANIFEST_BACKGROUND_REFRESH_MIN_MS) return 'skip';
  return 'start';
}

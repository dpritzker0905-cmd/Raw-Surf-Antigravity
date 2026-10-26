// The Surf Rating band toggle must be instant (2026-10-26, the owner's live test: "the surf rating band stays on for a few seconds, when its
// turned off"; his console: "[Abort-Gate] Preserving high-priority fetch (timeline_scrub) against low-priority request (flavor_toggle)", then an
// 18 s "[Marine] Stranded fetch-pending released" wedge).
//
// Three mechanisms, found offline (scn_band_toggle.js) and in the code:
//  1. PRIORITY. The toggle is a user action, like 'manual'. The abort gate ranked it BELOW an in-flight scrub, so the scrub fetch (the OLD flavor)
//     was preserved and the toggle was dropped (buffered) until the scrub finished. A toggle now SUPERSEDES: it releases the in-flight fetch and
//     asks for the current hour and the NEW flavor (the url builder reads the flag at request time), which is exactly what the scrub would have
//     needed after the flip anyway. isFlavorToggleSource() is the one predicate, kill: __RAW_DISABLE_FLAVOR_TOGGLE_PRIORITY__.
//  2. THE WEDGE (the owner's log: "[Release] Releasing active fetch (flavor_toggle_pending) ... for new source=flavor_toggle", then
//     "Stranded fetch-pending released (idle 18.0s ...)"). enqueueMarineUpdate / updateMarineGrid release the active fetch
//     (locks.isFetching = false) but the released fetch's __MARINE_FETCH_PENDING__ stamp stayed set: a detached fetch clears it only when it
//     FINISHES. When the new ask is then dropped (flip OFF then ON: the resident is rated and matches the flag again, so the dedupe returns), the
//     state is pending set, nothing fetching, nothing re-driving, and the settle check bypasses itself on a matching pending, until the
//     stranded-pending watchdog's 18 s lease. releasePendingStampOf() clears the stamp the moment its fetch is released. Same kill as 1.
//     (Not shown to matter: the 1200 ms rate limiter and the 3-failure cap; they are unchanged.)
//  3. THE RENDER. With the flag OFF and the resident still a RATING grid, the engine kept painting the band (its height channel holds SCORES, so the
//     honest ramp over it is garbage) until the honest grid committed, a backend round trip when no honest frame is cached (the band was on from
//     load). resolveBandOffNow() makes the hide a local render decision: band opacity 0 and the honest coarse base wash at full strength, in the
//     same frame as the flag, whenever that wash is engaged. Without a wash the old hold stays (a blank heatmap is worse). Kill:
//     __RAW_DISABLE_BAND_OFF_INSTANT__. The words while the band is switched ON and its grid is still loading: ratingBandLoadingText().

/** 'flavor_toggle' and its replays ('flavor_toggle_pending'): the user flipped the rating band. */
export function isFlavorToggleSource(src) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_FLAVOR_TOGGLE_PRIORITY__ === true) return false;
  return typeof src === 'string' && src.startsWith('flavor_toggle');
}

/** Clear the pending stamp of a fetch that has just been released (and only if it is still the current stamp). True when cleared. */
export function releasePendingStampOf(controller, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w || w.__RAW_DISABLE_FLAVOR_TOGGLE_PRIORITY__ === true || !controller || !controller.__fetchPendingStamp) return false;   // same kill as the priority
  if (w.__MARINE_FETCH_PENDING__ !== controller.__fetchPendingStamp) return false;
  w.__MARINE_FETCH_PENDING__ = null;
  return true;
}

/** Band OFF, resident still a rating grid, honest coarse wash engaged: the band is gone NOW (opacity 0) and the wash is full. null = not applicable. */
export function resolveBandOffNow(win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_DISABLE_BAND_OFF_INSTANT__ === true) return null;
  return { bandMult: 0, washStrength: 1, fade: 0, spanFade: 1, covFade: 1, resFade: 1, edgeFade: 1, heldBy: 'off' };
}

export const BAND_LOADING_MS = 20000;
/** While the band was just switched ON and the resident is not yet a rating grid: the words (never a blank, never colour alone). */
export function ratingBandLoadingText(forcedOff, toggledAtMs, nowMs) {
  const t = typeof nowMs === 'number' ? nowMs : Date.now();
  return forcedOff && typeof toggledAtMs === 'number' && t - toggledAtMs >= 0 && t - toggledAtMs < BAND_LOADING_MS
    ? 'Surf ratings loading for this view…' : null;
}

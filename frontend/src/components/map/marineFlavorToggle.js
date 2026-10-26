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
//     stranded-pending watchdog's 18 s lease. leasePendingStampOf() leases the stamp for 300 ms after the release (a first version that cleared it at once made the
//     orchestrator read 'model switch, no fetch pending' and blank the resident for the gap): cleared when the lease ends and nothing is fetching. Same kill as 1.
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

export const PENDING_LEASE_MS = 300;
/**
 * A fetch was just released for a toggle: its __MARINE_FETCH_PENDING__ stamp is LEASED for PENDING_LEASE_MS, not cleared at once. Clearing at
 * once made the orchestrator read "a model switch with no fetch pending" and clear the resident field for the gap before the replacement
 * ask starts (offline: ICON selected, GFS resident, +1d x12, OFF: a 6 s blank on the fix's first version). If a replacement fetch dispatches it
 * overwrites the stamp (a different object, so this does nothing); if the replacement is dropped (the dedupe: OFF then ON) the stamp is cleared
 * when the lease ends and nothing is fetching, instead of stranding for the 18 s watchdog. True when a lease was started.
 */
export function leasePendingStampOf(controller, locks, win, ms = PENDING_LEASE_MS) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w || w.__RAW_DISABLE_FLAVOR_TOGGLE_PRIORITY__ === true || !controller || !controller.__fetchPendingStamp) return false;   // same kill as the priority
  const stamp = controller.__fetchPendingStamp;
  if (w.__MARINE_FETCH_PENDING__ !== stamp) return false;
  setTimeout(() => { if (w.__MARINE_FETCH_PENDING__ === stamp && !(locks && locks.isFetching)) w.__MARINE_FETCH_PENDING__ = null; }, ms);
  return true;
}

/**
 * Band OFF while the resident is still a rating grid: the band is gone NOW (opacity 0). With the honest coarse wash engaged it shows through at
 * full strength (heldBy 'off', silent). Without one there is no honest field to show (a rating grid holds scores, not heights): the heatmap is
 * empty until the honest grid lands and the status line says so (heldBy 'off_loading'); that beats a band that outlives the toggle by the
 * length of a slow fetch (the owner's 6-8 s). null = the kill switch.
 */
export function resolveBandOffNow(win, washEngaged = true) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_DISABLE_BAND_OFF_INSTANT__ === true) return null;
  return { bandMult: 0, washStrength: 1, fade: 0, spanFade: 1, covFade: 1, resFade: 1, edgeFade: 1, heldBy: washEngaged ? 'off' : 'off_loading' };
}

export const BAND_LOADING_MS = 20000;
/** While the band was just switched ON and the resident is not yet a rating grid: the words (never a blank, never colour alone). */
export function ratingBandLoadingText(forcedOff, toggledAtMs, nowMs) {
  const t = typeof nowMs === 'number' ? nowMs : Date.now();
  return forcedOff && typeof toggledAtMs === 'number' && t - toggledAtMs >= 0 && t - toggledAtMs < BAND_LOADING_MS
    ? 'Surf ratings loading for this view…' : null;
}

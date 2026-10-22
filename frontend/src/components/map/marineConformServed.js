/**
 * marineConformServed.js — the SERVED frame identity that useMarineWindData's conform hands the marine engine (2026-10-21).
 *
 * The conform is the LAST rebuild before the engine and an EXPLICIT field list (it has eaten is_valid, dirConfidence, ratingMode
 * and the commit lane before). It also dropped the two fields that name the frame the backend actually served:
 *   served_valid_time   the instant of the served frame. On /grid, `valid_time` only ECHOES the ask (C-12); a series frame's is its own.
 *   __servedProductId   the STORED product a series frame came from (A15-09; on /grid, productId already names it).
 * So every reader of the engine's grid saw the ask's echo or nothing: marineFrameInstant() was null on every lane, the drawn-frame
 * record (publishMarineDrawn) had dataMs null for every /grid commit, and gridValidMs() (marineStaleHour.js) read the echo.
 *
 * __servedProductId: on the engine's grid only diagnostics read it (the upload diag, the resident frame receipt). Carried, ON.
 *   Kill: window.__RAW_DISABLE_CONFORM_SERVED_PRODUCT__ = true.
 * served_valid_time: DRAWN decisions read it on the engine's grid (the stale-hour base rules and dim, the base-aware bridge, the
 *   exact-upgrade skip; with REACT_APP_FORECAST_STATE_IDENTITY also the commit guards) and so does the "what is drawn" status line,
 *   so wherever the served instant differs from the ask's echo it changes what is drawn: DARK, default off (D-001).
 *   On: REACT_APP_MARINE_CONFORM_SERVED_TIME=true at build, or window.__RAW_MARINE_CONFORM_SERVED_TIME__ = true before the grid
 *   conforms (the visual lab's B arm). Kill, outranks both: window.__RAW_DISABLE_MARINE_CONFORM_SERVED_TIME__ = true.
 *   Read once per conform (the conform is memoized on the grid), so a toggle takes effect at the next grid.
 * Reader audit and the lab A/B: docs/weather-program/log/2026-10-21-claude-conform-served-time.md.
 */
const winOf = (win) => win || (typeof window !== 'undefined' ? window : null);

export function conformServedTimeOn(win) {
  const w = winOf(win);
  if (w && w.__RAW_DISABLE_MARINE_CONFORM_SERVED_TIME__ === true) return false;
  return process.env.REACT_APP_MARINE_CONFORM_SERVED_TIME === 'true' || !!(w && w.__RAW_MARINE_CONFORM_SERVED_TIME__ === true);
}

export function conformServedProductOn(win) {
  const w = winOf(win);
  return !(w && w.__RAW_DISABLE_CONFORM_SERVED_PRODUCT__ === true);
}

/**
 * The served identity fields for the conform's object, BY NAME. Only fields the source carries are added, so a frame without them
 * (and every frame while a switch is off) conforms to exactly the object it did before.
 */
export function conformServedIdentity(marineData, win) {
  const out = {};
  const grid = (marineData && marineData.grid) || {};
  if (conformServedTimeOn(win)) {
    const served = grid.served_valid_time || (marineData && marineData.served_valid_time) || null;
    if (served) out.served_valid_time = served;
  }
  if (conformServedProductOn(win) && grid.__servedProductId) out.__servedProductId = grid.__servedProductId;
  return out;
}

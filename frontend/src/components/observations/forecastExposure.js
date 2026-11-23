/**
 * forecastExposure - has this app session shown the person ANY forecast, rating or tide read yet?
 *
 * The blind surf-quality question (gates/surf-tide-v1.md section 0) is truth only if the surfer chose the level without
 * having seen what we predict. The report screens themselves show none (the server audits that per screen:
 * forecast_shown_before). This records the rest of the app: every surface that renders a forecast, a rating, a tide
 * read or a spot's best-tide text calls useNoteForecastShown on mount (a guard test,
 * src/tests/forecastExposureGuard.test.js, fails when a new forecast surface does not).
 *
 * It is deliberately SESSION-WIDE, not per spot: the map, the explore cards and the spot pages show many spots at once,
 * and a per-spot record would miss some. Once anything was shown, the quality question is not asked for the rest of the
 * session, and the app tells the server so (forecast_seen_for_spot: true), which then keeps no quality from it.
 *
 * Scope: one browser tab session (sessionStorage), with an in-memory copy for when storage is unavailable. It cannot
 * see another tab, another device or another app. That limit is written in the gate's evidence.
 */
import { useEffect } from 'react';

const KEY = 'rs_forecast_shown_v1';
let shownInMemory = false;

export function noteForecastShown(source = 'unknown') {
  shownInMemory = true;
  try {
    if (!window.sessionStorage.getItem(KEY)) {
      window.sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), source: String(source).slice(0, 40) }));
    }
  } catch (_err) {
    // Private mode or blocked storage: the in-memory flag still holds for this page's life.
  }
}

export function forecastShownThisSession() {
  if (shownInMemory) return true;
  try {
    return Boolean(window.sessionStorage.getItem(KEY));
  } catch (_err) {
    return false;
  }
}

/** Mark the session as exposed when this surface mounts (and `active` is true). */
export function useNoteForecastShown(source, active = true) {
  useEffect(() => {
    if (active) noteForecastShown(source);
  }, [source, active]);
}

export function _resetForecastExposureForTests() {
  shownInMemory = false;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch (_err) {
    // ignore
  }
}

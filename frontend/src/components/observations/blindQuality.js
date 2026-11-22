/**
 * blindQuality - whether the report screen asks "How good is it right now?" (gates/surf-tide-v1.md section 0).
 *
 * Asked only when ALL of these hold:
 *   - the server's flag is on (GET /surf-observations/features; SURF_TRUTH_BLIND_QUALITY, dark by default);
 *   - the screen is one of the blind ones (the caller passes askQuality only on CheckInModal / ConditionsModal);
 *   - this app session has shown no forecast, rating or tide read anywhere (forecastExposure);
 *   - the client kill switch is not set: window.__RAW_DISABLE_BLIND_QUALITY__ = true hides it at once.
 * The server re-checks the flag and the screen, and keeps no quality when the app says a forecast was shown.
 */
import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient';
import { forecastShownThisSession } from './forecastExposure';

let featuresPromise = null;

export function blindQualityKilled() {
  return typeof window !== 'undefined' && window.__RAW_DISABLE_BLIND_QUALITY__ === true;
}

export function fetchObservationFeatures() {
  if (!featuresPromise) {
    featuresPromise = apiClient.get('/surf-observations/features')
      .then((res) => res.data || {})
      .catch(() => ({ blind_quality: false, quality_levels: [] }));   // unknown = off
  }
  return featuresPromise;
}

export function _resetBlindQualityForTests() {
  featuresPromise = null;
}

/** { ask, levels } for a screen that may ask the blind quality question. */
export function useBlindQuality(askQuality) {
  const [state, setState] = useState({ ask: false, levels: [] });
  useEffect(() => {
    if (!askQuality || blindQualityKilled() || forecastShownThisSession()) {
      setState({ ask: false, levels: [] });
      return undefined;
    }
    let live = true;
    fetchObservationFeatures().then((f) => {
      const levels = Array.isArray(f.quality_levels) ? f.quality_levels : [];
      if (live) setState({ ask: Boolean(f.blind_quality) && levels.length === 7, levels });
    });
    return () => { live = false; };
  }, [askQuality]);
  return state;
}

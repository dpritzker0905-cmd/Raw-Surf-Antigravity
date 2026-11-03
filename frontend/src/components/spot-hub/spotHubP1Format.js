/**
 * spotHubP1Format.js: spot-hub phase 1's display helpers (2026-11-03), kept free of the tier resolver
 * so the map's point-rating client and card compiler can import them. See spotHubP1.js.
 * Kill switch: window.__RAW_DISABLE_SPOT_HUB_P1__ = true.
 */
import { formatWaveDirection } from '../spotConditionsFormat';

export function spotHubP1Enabled() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_SPOT_HUB_P1__ === true);
}

export const MISSING = '—';

/** A period of 0 or less is never a sea state: it is the backend's missing-value default. PURE. */
export function displayPeriod(period) {
  const p = Number(period);
  if (period == null || !Number.isFinite(p) || p <= 0) return MISSING;
  return `${Math.round(p * 10) / 10}s`;
}

/**
 * "66° ENE", or "—". A direction of exactly 0 with no period is the backend's missing-value pair
 * (safe_index_get(..., 0.0) for both), not a north swell; a 0 beside a real period is north. PURE.
 */
export function displayDirection(deg, period) {
  if (deg == null) return MISSING;
  const d = Number(deg);
  if (!Number.isFinite(d)) return MISSING;
  if (d === 0 && displayPeriod(period) === MISSING) return MISSING;
  return formatWaveDirection(d) || MISSING;
}

// ── Tides ───────────────────────────────────────────────────────────────────────────────────────
export const TIDE_MODEL_LABEL = 'Tide (model estimate, mean sea level)';
const TREND_WORD = { rising: 'Rising', falling: 'Falling', slack: 'Slack' };
const M_TO_FT = 3.28084;

/**
 * `/point-rating`'s `rating.tide` ({height_m, norm, trend}) as the infobox shows it, or null when it
 * carries no usable height. Absent is null, never 0: a 0 m tide is a real reading at mean sea level.
 */
export function sanitizePointTide(tide) {
  if (!tide || typeof tide !== 'object' || tide.height_m == null) return null;
  const m = Number(tide.height_m);
  if (!Number.isFinite(m)) return null;
  const trend = TREND_WORD[String(tide.trend || '').toLowerCase()] || null;
  return { heightM: m, heightFt: Math.round(m * M_TO_FT * 10) / 10, trend };
}

/** "+1.3 ft, Rising" (signed: mean sea level is the datum, so a low tide reads below zero). */
export function formatPointTide(t) {
  if (!t) return null;
  const ft = t.heightFt;
  const sign = ft > 0 ? '+' : ft < 0 ? '−' : '';
  return `${sign}${Math.abs(ft).toFixed(1)} ft${t.trend ? `, ${t.trend}` : ''}`;
}

/**
 * The tide block's source line. `/tides/{id}` reports `source: 'global'` (station
 * `open-meteo:sea_level_height_msl`) on its default path: Open-Meteo's modelled sea level, mean sea
 * level datum. Only the TIDES_GLOBAL_SOURCE=0 rollback still reads NOAA CO-OPS, and only then is the
 * NOAA line true.
 */
export function tideSourceLabel(tideData) {
  const global = tideData && (tideData.source === 'global'
    || String(tideData.station_id || '').startsWith('open-meteo'));
  return global
    ? 'Model estimate: Open-Meteo modelled sea level, mean sea level datum. Times in your time zone.'
    : 'Data from NOAA Tides & Currents';
}

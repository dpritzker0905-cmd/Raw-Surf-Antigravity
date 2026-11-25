/**
 * spotHubP1Format.js: spot-hub phase 1's display helpers (2026-11-03), kept free of the tier resolver
 * so the map's point-rating client and card compiler can import them. See spotHubP1.js.
 * Kill switch: window.__RAW_DISABLE_SPOT_HUB_P1__ = true.
 */
import { formatWaveDirection } from '../spotConditionsFormat';
import { tideDatumOf, ratingTide, minusTideWord } from '../map/tideDatum';

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
export const TIDE_MODEL_LABEL = 'Tide (model estimate, above local MSL)';   // ONE label set with map/tideDatum.js
const TREND_WORD = { rising: 'Rising', falling: 'Falling', slack: 'Slack' };
const M_TO_FT = 3.28084;

/**
 * `/point-rating`'s `rating.tide` ({height_m, norm, trend}) as the infobox shows it, or null when it
 * carries no usable height. Absent is null, never 0: a 0 m tide is a real reading at mean sea level.
 */
export function sanitizePointTide(tide) {
  if (!tide || typeof tide !== 'object' || tide.height_m == null) return null;
  // The DISPLAY height (tide_datum): `display_height_m` above MLLW at a US point, else `height_m` above local MSL.
  const { heightM: m, datum } = ratingTide({ ...tide, height_m: Number(tide.height_m),
    display_height_m: tide.display_height_m == null ? undefined : Number(tide.display_height_m) });
  if (m == null) return null;
  const trend = TREND_WORD[String(tide.trend || '').toLowerCase()] || null;
  const base = { heightM: m, heightFt: Math.round(m * M_TO_FT * 10) / 10, trend };
  return datum.isMllw ? { ...base, datum, minus: minusTideWord(m, datum) } : base;   // MSL keeps its old shape
}

/** The card row's note and accessible label for a sanitized tide: the datum is always named. */
export function pointTideNote(t) {
  const datum = (t && t.datum) || tideDatumOf(null);
  if (!datum.isMllw) return { note: 'model estimate, above local MSL', label: TIDE_MODEL_LABEL };
  const src = datum.sourceShort ? `, datum from ${datum.sourceShort}` : '';
  return { note: `model estimate, above MLLW${t && t.minus ? ` (${t.minus})` : ''}`,
    label: `Tide (model estimate, above MLLW, NOAA chart datum${src})` };
}

/**
 * "+1.3 ft, Rising" or, with unit 'm', "+0.4 m, Rising": the tide follows the ft/m button like every wave height
 * (owner 2026-11-15). Signed: mean sea level is the datum, so a low tide reads below zero. Default 'ft' keeps
 * callers that pass no unit unchanged.
 */
export function formatPointTide(t, unit = 'ft') {
  if (!t) return null;
  const metric = unit === 'm';
  const v = metric ? Math.round(t.heightM * 10) / 10 : t.heightFt;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(1)} ${metric ? 'm' : 'ft'}${t.trend ? `, ${t.trend}` : ''}`;
}

/**
 * The tide block's source line. `/tides/{id}` reports `source: 'global'` (station
 * `open-meteo:sea_level_height_msl`) on its default path: Open-Meteo's modelled sea level, mean sea
 * level datum. Only the TIDES_GLOBAL_SOURCE=0 rollback still reads NOAA CO-OPS, and only then is the
 * NOAA line true.
 */
export function tideSourceLabel(tideData) {
  // PR B: our own tide table names its source and carries the exact attribution its licences ask for (the AVISO
  // FES2022 acknowledgement + the Copernicus Marine credit); show that text, never an Open-Meteo line.
  if (tideData && String(tideData.station_id || '').startsWith('raw-surf:tide-own:')) {
    const credit = typeof tideData.credit === 'string' ? tideData.credit.trim() : '';
    // A US point above MLLW (tide_datum): the datum line replaces the series label, whose "above local mean sea level"
    // would contradict the numbers; it names the MLLW source and keeps the attribution.
    const datum = tideDatumOf(tideData.datum);
    if (datum.isMllw) {
      return `${datum.long} ${datum.negativeNote} ${credit ? `${credit} ` : ''}Times in your time zone.`;
    }
    const label = typeof tideData.tide_label === 'string' && tideData.tide_label.trim() ? `${tideData.tide_label.trim()}. ` : '';
    return `${label}${credit ? `${credit} ` : ''}Times in your time zone.`;
  }
  const global = tideData && (tideData.source === 'global'
    || String(tideData.station_id || '').startsWith('open-meteo'));
  return global
    ? 'Model estimate: Open-Meteo modelled sea level, mean sea level datum. Times in your time zone.'
    : 'Data from NOAA Tides & Currents';
}

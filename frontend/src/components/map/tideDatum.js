/**
 * tideDatum.js - PURE: the display datum of a tide height, the ONE client copy every tide surface reads (2026-11-22).
 *
 * The backend decides the datum per point (services/weather_pipeline/tide_datum.py, flag SURF_TIDE_MLLW_US): above MLLW
 * (NOAA's chart datum) at US points, above local mean sea level elsewhere, and it names the source of the MLLW offset
 * (a NOAA gauge sheet, our 19-year tide computation, or a gauge interpolation). Surfaces receive either the full block
 * (`datum_info` on /point-tide, `datum` on /tides) or the compact rating fields (`datum: 'MLLW'`, `datum_src`).
 * Every surface labels its number with the datum this module returns, so no screen shows an unlabelled height.
 *
 * Client kill switch: window.__RAW_DISABLE_TIDE_MLLW__ = true shows the served mean-sea-level level everywhere
 * (the server's own kill is SURF_TIDE_MLLW_US=0).
 */
export const MLLW_SHORT = 'above MLLW';
export const MSL_SHORT = 'above local MSL';
export const MINUS_TIDE = 'minus tide';
export const NEGATIVE_NOTE = '0 = mean lower low water (NOAA chart datum). A minus tide (below 0) is a lower-than-average low tide, not an error.';

const SOURCE_WORD = { gauge: 'NOAA gauge', model: 'Raw Surf 19-yr tide model', interpolated: 'NOAA gauges, interpolated' };

export function tideMllwDisabled() {
  return typeof window !== 'undefined' && window.__RAW_DISABLE_TIDE_MLLW__ === true;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Normalise any datum description to { isMllw, short, offsetM, source, sourceShort, long, negativeNote }.
 * Accepts the full backend block ({datum, label, offset_m, source, source_label, long_label}), or a compact pair
 * ('MLLW' | 'MSL' | undefined, 'gauge' | 'model' | 'interpolated'). Unknown or absent = local MSL (offset 0).
 */
export function tideDatumOf(info, src) {
  const block = info && typeof info === 'object' ? info : { datum: info, source: src };
  const isMllw = block.datum === 'MLLW' && !tideMllwDisabled();
  if (!isMllw) {
    return { isMllw: false, short: MSL_SHORT, offsetM: 0, source: null, sourceShort: null,
      long: 'Tide height above local mean sea level (2016-2025 mean level).', negativeNote: null };
  }
  const sourceKey = typeof block.source === 'string' ? block.source : null;
  const sourceShort = SOURCE_WORD[sourceKey] || null;
  const source = typeof block.source_label === 'string' && block.source_label ? block.source_label : sourceShort;
  return {
    isMllw: true, short: MLLW_SHORT, offsetM: num(block.offset_m) ?? 0, source, sourceShort,
    long: typeof block.long_label === 'string' && block.long_label
      ? block.long_label
      : `Tide plus average sea-level rise, above MLLW (NOAA chart datum). Excludes today's ocean anomaly and storm surge${source ? `. Datum from ${source}` : ''}.`,
    negativeNote: NEGATIVE_NOTE,
  };
}

/**
 * The height to SHOW for a value the server sent in display datum. When the client kill is on and the server sent an
 * MLLW value with its offset, the served MSL level is restored (value - offset), so the label and the number agree.
 */
export function shownHeight(valueM, info, src) {
  const v = num(valueM);
  if (v == null) return null;
  const block = info && typeof info === 'object' ? info : { datum: info, source: src };
  if (block.datum === 'MLLW' && tideMllwDisabled()) return Math.round((v - (num(block.offset_m) ?? 0)) * 1000) / 1000;
  return v;
}

/**
 * A /point-tide payload with every height in the datum the client will LABEL: unchanged normally; under the client
 * kill, an MLLW payload's series, events and heights shifted back to the served MSL level and its datum_info replaced.
 */
export function pointTideForDisplay(payload) {
  const info = payload && payload.datum_info;
  if (!info || info.datum !== 'MLLW' || !tideMllwDisabled()) return payload;
  const off = num(info.offset_m) ?? 0;
  const back = (v) => (num(v) == null ? v : Math.round((v - off) * 1000) / 1000);
  const ev = (e) => (e ? { ...e, height_m: back(e.height_m) } : e);
  return {
    ...payload, datum: 'MSL', datum_info: { datum: 'MSL', offset_m: 0 }, height_m: back(payload.height_m),
    series: Array.isArray(payload.series) ? payload.series.map((p) => (p ? { ...p, h: back(p.h) } : p)) : payload.series,
    events: Array.isArray(payload.events) ? payload.events.map(ev) : payload.events,
    next_high: ev(payload.next_high), next_low: ev(payload.next_low),
  };
}

/** The rating row's tide height and datum: display_height_m when the server sent one (a US MLLW point), else height_m. */
export function ratingTide(tide) {
  if (!tide || typeof tide !== 'object') return { heightM: null, datum: tideDatumOf(null) };
  const datum = tideDatumOf(tide.datum, tide.datum_src);
  const heightM = datum.isMllw ? num(tide.display_height_m) ?? num(tide.height_m) : num(tide.height_m);
  return { heightM, datum };
}

/** "minus tide" for a negative MLLW height, else null: a below-zero number must never read as an error. */
export function minusTideWord(heightM, datum) {
  return datum && datum.isMllw && num(heightM) != null && heightM < -0.005 ? MINUS_TIDE : null;
}

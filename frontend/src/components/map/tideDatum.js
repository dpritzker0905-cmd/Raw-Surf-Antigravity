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
/** The infobox chip at an MLLW point (2026-11-23, interim frame A + M + D); its title carries the full text. */
export const MLLW_CHIP = 'Tide + avg sea-level rise';
export const MSL_SHORT = 'above local MSL';
export const MINUS_TIDE = 'minus tide';
export const NEGATIVE_NOTE = '0 = mean lower low water (NOAA chart datum). A minus tide (below 0) is a lower-than-average low tide, not an error.';

const SOURCE_WORD = { gauge: 'NOAA gauge', model: 'Raw Surf 19-yr tide model', interpolated: 'NOAA gauges, interpolated' };

export function tideMllwDisabled() {
  return typeof window !== 'undefined' && window.__RAW_DISABLE_TIDE_MLLW__ === true;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Normalise any datum description to { isMllw, short, chip, offsetM, source, sourceShort, long, negativeNote }.
 * Accepts the full backend block ({datum, label, offset_m, source, source_label, long_label}), or a compact pair
 * ('MLLW' | 'MSL' | undefined, 'gauge' | 'model' | 'interpolated'). Unknown or absent = local MSL (offset 0).
 */
export function tideDatumOf(info, src) {
  const block = info && typeof info === 'object' ? info : { datum: info, source: src };
  const isMllw = block.datum === 'MLLW' && !tideMllwDisabled();
  if (!isMllw) {
    return { isMllw: false, short: MSL_SHORT, chip: MSL_SHORT, offsetM: 0, source: null, sourceShort: null,
      long: 'Tide height above local mean sea level (2016-2025 mean level).', negativeNote: null };
  }
  const sourceKey = typeof block.source === 'string' ? block.source : null;
  const sourceShort = SOURCE_WORD[sourceKey] || null;
  const source = typeof block.source_label === 'string' && block.source_label ? block.source_label : sourceShort;
  return {
    isMllw: true, short: MLLW_SHORT, chip: MLLW_CHIP, offsetM: num(block.offset_m) ?? 0, source, sourceShort,
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

// ---- PLAIN NUMBER + LEGEND (owner decision B, 2026-11-25) --------------------------------------------------------
// The visible line is a plain number: "Tide 1.2 ft, rising" / "Tide −0.4 ft, falling" (typographic minus, NO datum name).
// The datum is said ONCE per location in an info tip (TideDatumInfo), and the accessible name stays precise:
// "Tide 1.2 feet above mean lower low water, rising". Text only; the served numbers are unchanged.

export const TYPO_MINUS = '−';

/** Client kill for decision B: window.__RAW_DISABLE_TIDE_PLAIN_LINE__ = true puts the datum name back on every line. */
export function tidePlainLineDisabled() {
  return typeof window !== 'undefined' && window.__RAW_DISABLE_TIDE_PLAIN_LINE__ === true;
}

/** The pre-B line (the kill's fallback): "1.2 ft above MLLW (minus tide) rising". */
export function legacyTideText(heightText, heightM, datum, trend) {
  if (heightText == null) return null;
  const minus = minusTideWord(heightM, datum);
  const base = `${heightText} ${(datum || tideDatumOf(null)).short}${minus ? ` (${minus})` : ''}`;
  const t = typeof trend === 'string' && trend ? trend.toLowerCase() : null;
  return t ? `${base} ${t}` : base;
}
export const DATUMS_DIFFER_NOTE = 'Tide zero differs by country: US spots read from mean lower low water (NOAA chart datum), '
  + 'elsewhere from local mean sea level, so heights across a border are not comparable.';

/** "-0.4 ft" -> "−0.4 ft" (U+2212): the visible minus is typographic. Other text unchanged. */
export function typoMinus(text) {
  return typeof text === 'string' ? text.replace(/^-(?=\d)/, TYPO_MINUS) : text;
}

/** The plain visible tide line WITHOUT the leading "Tide": "1.2 ft, rising" / "−0.4 ft" (no or unknown trend). */
export function plainTideText(heightText, trend) {
  if (heightText == null) return null;
  const t = typeof trend === 'string' && trend ? trend.toLowerCase() : null;
  return t ? `${typoMinus(heightText)}, ${t}` : typoMinus(heightText);
}

const UNIT_WORD = { ft: 'feet', m: 'metres' };
const DATUM_WORDS = { MLLW: 'mean lower low water', MSL: 'local mean sea level' };

/** The datum in words for an accessible name: "mean lower low water" / "local mean sea level". */
export function datumWords(datum) {
  return datum && datum.isMllw ? DATUM_WORDS.MLLW : DATUM_WORDS.MSL;
}

/**
 * The PRECISE accessible tide text WITHOUT the leading "Tide": "1.2 feet above mean lower low water, rising";
 * below zero, "0.4 feet below mean lower low water, a minus tide, falling" (a minus tide is named, never an error).
 * `heightText` is the visible "1.2 ft" (its digits are reused so the name and the card agree to the tenth).
 */
export function preciseTideText(heightText, heightM, datum, trend) {
  if (heightText == null) return null;
  const m = /^[-−]?\s*([\d.]+)\s*(ft|m)$/.exec(String(heightText).trim());
  const below = num(heightM) != null && heightM < 0 && m && Number.parseFloat(m[1]) !== 0;
  const amount = m ? `${m[1]} ${UNIT_WORD[m[2]]}` : String(heightText);
  let text = `${amount} ${below ? 'below' : 'above'} ${datumWords(datum)}`;
  if (below && datum && datum.isMllw) text += `, a ${MINUS_TIDE}`;
  const t = typeof trend === 'string' && trend ? trend.toLowerCase() : null;
  return t ? `${text}, ${t}` : text;
}

/**
 * The info tip's text for one location: what zero means here and the minus-tide note. The cross-border note ("US spots
 * read from mean lower low water ...") is added ONLY where this location IS on MLLW: while SURF_TIDE_MLLW_US is "0" every
 * point is on local MSL, and the note would be untrue (the advisor's before-merge 1 on #1149 at b1ffc76a2).
 */
export function datumLegendText(datum) {
  const d = datum || tideDatumOf(null);
  return [d.long, d.negativeNote, d.isMllw ? DATUMS_DIFFER_NOTE : null].filter(Boolean).join(' ');
}

/** The info tip's short button label: "Tide zero: MLLW" / "Tide zero: local MSL". */
export function datumTipLabel(datum) {
  return datum && datum.isMllw ? 'Tide zero: MLLW' : 'Tide zero: local MSL';
}

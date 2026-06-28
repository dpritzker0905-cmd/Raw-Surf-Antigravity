/**
 * surfRating.js — JS MIRROR of backend services/weather_pipeline/surf_rating.py. KEEP IN SYNC.
 *
 * Multivariable surf-quality rating used for the infobox badge (the map/grid rating is computed backend-side
 * from the same model). Answers "how GOOD is it?" not just "how big?": a size gate * (0.60 wind + 0.40
 * period) composite -> 0..100 -> the 7-level Surfline-style scale. Grounded in Espejo et al. (2014)
 * multivariable surf index + Goda (2010) breaker statistics (see surf_rating.py).
 *
 * Degrades gracefully: no wind -> neutral wind quality; no shore-normal -> speed-only wind grading.
 */
export const RATING_LEVELS = ['very_poor', 'poor', 'poor_fair', 'fair', 'fair_good', 'good', 'epic'];
const MS_TO_KT = 1.943844;
const W_WIND = 0.60;
const W_PERIOD = 0.40;
const _clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

export function sizeScore(h) {
  if (h == null || h <= 0.2) return 0.0;
  if (h >= 1.2) return 1.0;
  return _clamp((h - 0.2) / 1.0, 0.0, 1.0);
}

export function periodQuality(tp) {
  if (tp == null || tp <= 0) return 0.5;
  if (tp <= 6.0) return 0.40;
  if (tp >= 15.0) return 1.0;
  return _clamp(0.40 + (tp - 6.0) * (0.60 / 9.0), 0.40, 1.0);
}

/** -1 (fully onshore) .. +1 (fully offshore); null if either bearing missing. shoreNormal points seaward. */
export function offshoreness(windFromDeg, shoreNormalDeg) {
  if (windFromDeg == null || shoreNormalDeg == null) return null;
  return -Math.cos(((windFromDeg - shoreNormalDeg) * Math.PI) / 180);
}

export function windQuality(speedMs, windFromDeg = null, shoreNormalDeg = null) {
  if (speedMs == null || speedMs < 0) return 0.6;
  const kt = speedMs * MS_TO_KT;
  if (kt < 3.0) return 1.0;
  const off = offshoreness(windFromDeg, shoreNormalDeg);
  if (off == null) {
    if (kt <= 6.0) return 0.85;
    if (kt <= 12.0) return 0.65;
    if (kt <= 20.0) return 0.45;
    if (kt <= 30.0) return 0.28;
    return 0.15;
  }
  const base = 0.60 + 0.40 * off;
  const tol = 8.0 + 14.0 * Math.max(0.0, off);
  const sf = _clamp(1.0 - Math.max(0.0, kt - 4.0) / (tol * 2.0), 0.10, 1.0);
  return _clamp(base * sf, 0.05, 1.0);
}

export function ratingScore(h, tp, speedMs, windFromDeg = null, shoreNormalDeg = null) {
  const sg = sizeScore(h);
  if (sg <= 0.0) return 0.0;
  const wq = windQuality(speedMs, windFromDeg, shoreNormalDeg);
  const pq = periodQuality(tp);
  return Math.round(100.0 * sg * (W_WIND * wq + W_PERIOD * pq) * 10) / 10;
}

const _BUCKETS = [[14, 'very_poor'], [28, 'poor'], [42, 'poor_fair'], [56, 'fair'], [70, 'fair_good'], [84, 'good']];
export function scoreToLevel(score) {
  if (score == null) return 'unknown';
  for (const [upper, name] of _BUCKETS) if (score < upper) return name;
  return 'epic';
}

/** -> { score: 0-100|null, level } where level in RATING_LEVELS (or 'unknown' if no surf height). */
export function computeSurfRating(surfHm, tpS, windSpeedMs, windFromDeg = null, shoreNormalDeg = null) {
  if (surfHm == null) return { score: null, level: 'unknown' };
  const score = ratingScore(surfHm, tpS, windSpeedMs, windFromDeg, shoreNormalDeg);
  return { score, level: scoreToLevel(score) };
}

export const RATING_LABEL = {
  very_poor: 'Very poor', poor: 'Poor', poor_fair: 'Poor–Fair', fair: 'Fair',
  fair_good: 'Fair–Good', good: 'Good', epic: 'Epic', unknown: '—',
};
export const RATING_COLOR = {
  very_poor: '#7f1d1d', poor: '#dc2626', poor_fair: '#f97316', fair: '#eab308',
  fair_good: '#84cc16', good: '#22c55e', epic: '#8b5cf6', unknown: '#6b7280',
};

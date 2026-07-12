/**
 * surfRating.js — JS MIRROR of backend services/weather_pipeline/surf_rating.py. KEEP IN SYNC.
 *
 * Multivariable surf-quality rating used for the infobox badge (the map/grid rating is computed backend-side
 * from the same model). Answers "how GOOD is it?" not just "how big?": a size gate * (0.60 wind + 0.40
 * period) composite -> 0..100 -> a 7-level surf-quality scale. Grounded in Espejo et al. (2014)
 * multivariable surf index + Goda (2010) breaker statistics (see surf_rating.py).
 *
 * Degrades gracefully: no wind -> neutral wind quality; no shore-normal -> speed-only wind grading.
 */
export const RATING_LEVELS = ['very_poor', 'poor', 'poor_fair', 'fair', 'fair_good', 'good', 'epic'];
const MS_TO_KT = 1.943844;
const W_WIND = 0.60;
const W_PERIOD = 0.40;
const _clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const HMIN_RIDEABLE_M = 0.2;     // absolute unsurfable floor (mirror surf_rating._HMIN_RIDEABLE_M)
const DEFAULT_REF_SIZE_M = 1.2;  // global chest-high default when no local reference (mirror _DEFAULT_REF_SIZE_M)
// LOCAL-reference curve shape (USER anchors 2026-07-12: FL 2-3ft clean = fair; 3-4ft+ = fair/fair-good;
// Indo 2-3ft = poor). The reference anchors the curve MIDDLE, not saturation (mirror of py constants).
const REF_ANCHOR_SCORE = 0.6;
const REF_SAT_MULT = 2.5;

/** Size gate [0,1] calibrated to the spot's LOCAL good-day size. The curve is ANCHORED (0.6), not
 *  saturated, at `referenceSizeM` (the spot's p80 good day), reaching 1.0 at 2.5× the reference — an
 *  ordinary good day rates mid-scale; only well-overhead-for-THIS-spot maxes the factor. null -> LEGACY
 *  global absolute curve unchanged (linear to 1.0 at 1.2 m — the live default). Below the absolute
 *  ~0.2 m floor = 0 (unsurfable anywhere). The two branches are intentionally different shapes. */
export function sizeScore(h, referenceSizeM = null) {
  if (h == null || h <= HMIN_RIDEABLE_M) return 0.0;
  if (referenceSizeM == null || referenceSizeM <= HMIN_RIDEABLE_M) {
    // LEGACY absolute curve (live behavior — byte-identical).
    if (h >= DEFAULT_REF_SIZE_M) return 1.0;
    return _clamp((h - HMIN_RIDEABLE_M) / (DEFAULT_REF_SIZE_M - HMIN_RIDEABLE_M), 0.0, 1.0);
  }
  const ref = referenceSizeM;
  if (h >= ref * REF_SAT_MULT) return 1.0;
  if (h >= ref) {
    return _clamp(REF_ANCHOR_SCORE + (1.0 - REF_ANCHOR_SCORE) * (h / ref - 1.0) / (REF_SAT_MULT - 1.0),
      REF_ANCHOR_SCORE, 1.0);
  }
  return _clamp(REF_ANCHOR_SCORE * (h - HMIN_RIDEABLE_M) / (ref - HMIN_RIDEABLE_M), 0.0, REF_ANCHOR_SCORE);
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
  // Direction's effect RAMPS IN with speed (mirror of py, forensic fix 2026-07-12): a 5-6 kt breeze
  // barely textures the face whichever way it blows; the onshore/cross penalty phases in 3 -> 12 kt.
  // OFFSHORE and speed-only grading are byte-identical to before.
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
  const dirW = _clamp((kt - 3.0) / 9.0, 0.0, 1.0);
  const effBase = 1.0 - dirW * (1.0 - base);
  const tol = 8.0 + 14.0 * Math.max(0.0, off);
  const sf = _clamp(1.0 - Math.max(0.0, kt - 4.0) / (tol * 2.0), 0.10, 1.0);
  return _clamp(effBase * sf, 0.05, 1.0);
}

/** Swell-ANGLE exposure [0..1]: can the swell reach this coast head-on (1) / grazing / blocked (->0.1)?
 *  shoreNormal points seaward; swell aligned with it arrives head-on. 1.0 when geometry unknown (no penalty). */
export function swellExposure(swellFromDeg, shoreNormalDeg) {
  if (swellFromDeg == null || shoreNormalDeg == null) return 1.0;
  const align = Math.cos(((swellFromDeg - shoreNormalDeg) * Math.PI) / 180);
  return _clamp(0.10 + 0.90 * Math.max(0.0, align), 0.0, 1.0);
}

// ── PARTITION-AWARE factors (rating plan Step 3; mirror of surf_rating.py) ──────────────────────────
// `partitions` = list of {h, tp, dir, kind} trains (kind 'swell' for SW1/SW2, 'windsea' for WW).
// Backward-compatible: absent/degenerate -> null/neutral and the caller keeps total-field behavior.
const SEA_CLEAN_K = 0.5;      // windsea-fraction penalty slope (fraction 0.8+ reaches the floor)
const SEA_CLEAN_FLOOR = 0.6;  // sea state REFINES the rating; even a fully windsea sea never zeroes it

/** Period of the most ENERGETIC swell train (h² weighting; wind waves excluded) — the surf-relevant
 *  period (recovers a 16 s groundswell hiding under an 8 s windsea). null -> caller uses the total period. */
export function dominantSwellPeriod(partitions) {
  let bestE = 0.0;
  let bestTp = null;
  for (const p of partitions || []) {
    if (!p || typeof p !== 'object' || p.kind === 'windsea') continue;
    const { h, tp } = p;
    if (h == null || tp == null || h <= 0 || tp <= 0) continue;
    const e = h * h;
    if (e > bestE) { bestE = e; bestTp = tp; }
  }
  return bestTp;
}

/** Energy-weighted swell exposure over the SWELL partitions: Σ(h²·exposure(dir)) / Σ(h²). A well-angled
 *  secondary swell lifts exposure; a shadowed dominant swell is penalized by its energy share. null when
 *  geometry/partitions unusable (caller falls back to the total-field exposure). */
export function effectiveSwellExposure(partitions, shoreNormalDeg) {
  if (shoreNormalDeg == null) return null;   // geometry unknown -> total-field path is already neutral
  let num = 0.0;
  let den = 0.0;
  for (const p of partitions || []) {
    if (!p || typeof p !== 'object' || p.kind === 'windsea') continue;
    const { h, dir } = p;
    if (h == null || dir == null || h <= 0) continue;
    const e = h * h;
    num += e * swellExposure(dir, shoreNormalDeg);
    den += e;
  }
  if (den <= 0.0) return null;
  return _clamp(num / den, 0.0, 1.0);
}

/** Sea-state cleanliness [SEA_CLEAN_FLOOR..1]: penalizes a windsea-DOMINATED sea even when the local wind
 *  reads light/offshore. windsea_fraction = h_WW² / Σh² over ALL partitions. Neutral 1.0 when absent. */
export function seaCleanliness(partitions) {
  let wwE = 0.0;
  let totE = 0.0;
  for (const p of partitions || []) {
    if (!p || typeof p !== 'object') continue;
    const h = p.h;
    if (h == null || h <= 0) continue;
    const e = h * h;
    totE += e;
    if (p.kind === 'windsea') wwE += e;
  }
  if (totE <= 0.0 || wwE <= 0.0) return 1.0;
  return _clamp(1.0 - SEA_CLEAN_K * (wwE / totE), SEA_CLEAN_FLOOR, 1.0);
}

// Preferred tide bands (0 = low water, 1 = high water) from a spot's free-text best_tide prior. Compound first.
const _TIDE_BANDS = [
  ['low to mid', [0.0, 0.60]], ['low-mid', [0.0, 0.60]], ['mid to low', [0.0, 0.60]],
  ['mid to high', [0.40, 1.0]], ['mid-high', [0.40, 1.0]], ['high to mid', [0.40, 1.0]],
  ['low', [0.0, 0.35]], ['high', [0.65, 1.0]], ['mid', [0.33, 0.67]], ['medium', [0.33, 0.67]],
];

/** Parse a free-text best_tide prior into a preferred normalized band [lo,hi] (0..1), or null (no level pref). */
export function parseBestTide(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim().toLowerCase();
  if (!t || t.includes('all') || t.includes('any')) return null;
  for (const [phrase, band] of _TIDE_BANDS) if (t.includes(phrase)) return band;
  return null;
}

/** Tide-quality factor [0.5..1.0]: 1.0 inside the preferred band, tapering outside, floored at 0.5. Neutral
 *  1.0 when tide level or preference is unknown — tide REFINES, never zeroes a good swell. */
export function tideFit(tideNorm, bestTideBand) {
  if (tideNorm == null || !bestTideBand) return 1.0;
  const [lo, hi] = bestTideBand;
  const dist = Math.max(0.0, lo - tideNorm, tideNorm - hi);
  return _clamp(1.0 - 1.3 * dist, 0.5, 1.0);
}

/** Breaker-TYPE quality [0.82..1.0] from the Iribarren number ξ0 (mirror of surf_rating.breaker_type_quality).
 *  Plunging (0.5..3.3) = ideal (1.0); spilling (<0.5) + surging (>3.3) lower. Neutral 1.0 when ξ0 unknown. */
export function breakerTypeQuality(xi) {
  if (xi == null) return 1.0;
  if (xi < 0.5) return _clamp(0.85 + 0.30 * xi, 0.82, 1.0);
  if (xi <= 3.3) return 1.0;
  return _clamp(1.0 - 0.06 * (xi - 3.3), 0.82, 1.0);
}

export function ratingScore(h, tp, speedMs, windFromDeg = null, shoreNormalDeg = null, swellFromDeg = null, tideNorm = null, bestTide = null, breakerXi = null, referenceSizeM = null, partitions = null) {
  const sg = sizeScore(h, referenceSizeM);
  if (sg <= 0.0) return 0.0;
  let ex = (partitions && partitions.length) ? effectiveSwellExposure(partitions, shoreNormalDeg) : null;
  if (ex == null) ex = swellExposure(swellFromDeg, shoreNormalDeg);
  if (ex <= 0.0) return 0.0;
  const sc = (partitions && partitions.length) ? seaCleanliness(partitions) : 1.0;
  const tf = tideFit(tideNorm, parseBestTide(bestTide));
  const bt = breakerTypeQuality(breakerXi);
  const wq = windQuality(speedMs, windFromDeg, shoreNormalDeg);
  const ptp = (partitions && partitions.length) ? dominantSwellPeriod(partitions) : null;
  const pq = periodQuality(ptp != null ? ptp : tp);
  return Math.round(100.0 * sg * ex * sc * tf * bt * (W_WIND * wq + W_PERIOD * pq) * 10) / 10;
}

const _BUCKETS = [[14, 'very_poor'], [28, 'poor'], [42, 'poor_fair'], [56, 'fair'], [70, 'fair_good'], [84, 'good']];
export function scoreToLevel(score) {
  if (score == null) return 'unknown';
  for (const [upper, name] of _BUCKETS) if (score < upper) return name;
  return 'epic';
}

// ── OBSERVATION GATE (mirror of rating_confirmation.py; Surfline hybrid) ──
// Good/Epic verdicts require confirmation: >=2-model backend agreement or a fresh user report. The
// backend stamps `confirmed` per spot (spot-ratings payload); this mirror lets the infobox apply the
// SAME ceiling when the feature ships there. Unconfirmed caps at the fair_good ceiling (69.9 — the
// documented Surfline model top), 'good' confirmation caps at 83.9, 'epic' uncaps.
export const OBS_CAP_UNCONFIRMED = 69.9;
export const OBS_CAP_GOOD = 83.9;
export function observationGate(score, confirm = null) {
  if (score == null) return null;
  if (confirm === 'epic') return score;
  const cap = confirm === 'good' ? OBS_CAP_GOOD : OBS_CAP_UNCONFIRMED;
  return Math.round(Math.min(score, cap) * 10) / 10;
}

/** -> { score: 0-100|null, level } where level in RATING_LEVELS (or 'unknown' if no surf height). */
export function computeSurfRating(surfHm, tpS, windSpeedMs, windFromDeg = null, shoreNormalDeg = null, swellFromDeg = null, tideNorm = null, bestTide = null, breakerXi = null, referenceSizeM = null, partitions = null) {
  if (surfHm == null) return { score: null, level: 'unknown' };
  const score = ratingScore(surfHm, tpS, windSpeedMs, windFromDeg, shoreNormalDeg, swellFromDeg, tideNorm, bestTide, breakerXi, referenceSizeM, partitions);
  return { score, level: scoreToLevel(score) };
}

export const RATING_LABEL = {
  very_poor: 'Very poor', poor: 'Poor', poor_fair: 'Poor to Fair', fair: 'Fair',
  fair_good: 'Fair to Good', good: 'Good', epic: 'Epic', unknown: '—',
};
// Industry-standard surf-rating palette (red→orange→yellow→green→teal, with the rare Good/Epic in purple).
export const RATING_COLOR = {
  very_poor: '#f0476b', poor: '#f59e2c', poor_fair: '#f7d038', fair: '#2fd07a',
  fair_good: '#14b8a6', good: '#7c3aed', epic: '#a855f7', unknown: '#6b7280',
};

"""
surf_rating.py — multivariable SURF-QUALITY rating (0-100 score -> 7-level rating).

Answers "how GOOD is it right now?" (not just "how big?"), as a coastal heatmap + infobox badge — the
thing a pure height layer can't tell you and the differentiator vs chart-only competitors.

Grounding: surf quality is a MULTIVARIABLE composite of breaking wave height, swell period and wind
(offshore vs onshore + speed) — the expert-judgment multivariable surf index of Espejo et al. (2014)
"Surfing wave climate variability" (Global and Planetary Change). Breaking-height physics come from the
bundled surf_transform (depth-limited breaking; Goda 2010 breaker statistics). Pure ``math`` only — no
I/O, no numpy — so it runs in-process on the serve-only box (cheap, per-cell + per-point) and is fully
unit-testable.

Model:
    rating = size_gate(surf_height) * (0.60 * wind_quality + 0.40 * period_quality)   -> 0..100
  - size_gate: there must be a rideable wave (0 when flat; saturates chest-high+). Bigger is NOT penalized
    here — a big CLEAN long-period wave is exactly what 'epic' means; wind + period grade it.
  - wind_quality: the dominant cleanliness factor. Offshore/light grooms the face (high); onshore/strong
    is blown out (low). Uses the shore-normal (offshore vs onshore) when known, else speed-only.
  - period_quality: long-period groundswell is powerful + organized (high); short windswell is chop (low).
mapped to the 7-level Surfline-style scale: very_poor, poor, poor_fair, fair, fair_good, good, epic.
"""
import math

LEVELS = ["very_poor", "poor", "poor_fair", "fair", "fair_good", "good", "epic"]
# (exclusive upper score bound, level) — last bucket is open-ended 'epic'.
_BUCKETS = [(14, "very_poor"), (28, "poor"), (42, "poor_fair"), (56, "fair"),
            (70, "fair_good"), (84, "good")]

MS_TO_KT = 1.943844

# Composite weights (wind dominates cleanliness; period grades power/organization).
W_WIND = 0.60
W_PERIOD = 0.40


def _clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def size_score(surf_h_m):
    """Rideability gate [0,1] from breaking height. 0 when flat (< ~0.7 ft); rises across the
    knee->chest range; 1.0 chest-high+ (bigger is graded by wind/period, never penalized here)."""
    if surf_h_m is None or surf_h_m <= 0.2:
        return 0.0
    if surf_h_m >= 1.2:
        return 1.0
    return _clamp((surf_h_m - 0.2) / 1.0, 0.0, 1.0)


def period_quality(tp_s):
    """Power/organization [0,1] from peak period. <=6 s = wind chop (0.40); >=15 s = clean groundswell
    (1.0); linear between. Unknown period -> neutral 0.5."""
    if tp_s is None or tp_s <= 0:
        return 0.5
    if tp_s <= 6.0:
        return 0.40
    if tp_s >= 15.0:
        return 1.0
    return _clamp(0.40 + (tp_s - 6.0) * (0.60 / 9.0), 0.40, 1.0)


def offshoreness(wind_from_deg, shore_normal_deg):
    """-1 (fully onshore) .. +1 (fully offshore), or None if either bearing is missing.

    ``shore_normal_deg`` points OUT TO SEA (seaward). Wind direction is meteorological (the direction wind
    blows FROM). Onshore wind comes FROM the sea -> its FROM-bearing ~= the seaward normal -> offshoreness
    -1. Offshore wind blows FROM the land -> FROM-bearing ~ opposite the seaward normal -> +1."""
    if wind_from_deg is None or shore_normal_deg is None:
        return None
    d = math.radians(wind_from_deg - shore_normal_deg)
    return -math.cos(d)


def wind_quality(wind_speed_ms, wind_from_deg=None, shore_normal_deg=None):
    """Cleanliness [0,1]. Glassy/light = clean (high); strong onshore = blown out (low). Uses the
    offshore/onshore component when a shore-normal is supplied (the dominant factor), else speed-only."""
    if wind_speed_ms is None or wind_speed_ms < 0:
        return 0.6  # unknown wind -> neutral
    spd_kt = wind_speed_ms * MS_TO_KT
    if spd_kt < 3.0:
        return 1.0  # glassy: clean regardless of direction
    off = offshoreness(wind_from_deg, shore_normal_deg)
    if off is None:
        # No coast orientation: grade on speed alone (conservative).
        if spd_kt <= 6.0:
            return 0.85
        if spd_kt <= 12.0:
            return 0.65
        if spd_kt <= 20.0:
            return 0.45
        if spd_kt <= 30.0:
            return 0.28
        return 0.15
    base = 0.60 + 0.40 * off  # onshore -> 0.20, cross -> 0.60, offshore -> 1.00
    tol_kt = 8.0 + 14.0 * max(0.0, off)  # offshore tolerates more speed (~22 kt) than onshore (~8 kt)
    sf = _clamp(1.0 - max(0.0, spd_kt - 4.0) / (tol_kt * 2.0), 0.10, 1.0)
    return _clamp(base * sf, 0.05, 1.0)


def rating_score(surf_h_m, tp_s, wind_speed_ms, wind_from_deg=None, shore_normal_deg=None):
    """Composite 0..100 surf-quality score: size_gate * (0.60*wind + 0.40*period). 0 when flat."""
    sg = size_score(surf_h_m)
    if sg <= 0.0:
        return 0.0
    wq = wind_quality(wind_speed_ms, wind_from_deg, shore_normal_deg)
    pq = period_quality(tp_s)
    return round(100.0 * sg * (W_WIND * wq + W_PERIOD * pq), 1)


def score_to_level(score):
    """Map a 0-100 score to one of the 7 levels (very_poor..epic). None -> 'unknown'."""
    if score is None:
        return "unknown"
    for upper, name in _BUCKETS:
        if score < upper:
            return name
    return "epic"


def compute_surf_rating(surf_h_m, tp_s, wind_speed_ms, wind_from_deg=None, shore_normal_deg=None):
    """Return ``(score, level)`` — score 0-100 (None if surf height missing), level in LEVELS.

    surf_h_m: nearshore BREAKING height (from surf_transform). tp_s: peak/swell period. wind_speed_ms +
    wind_from_deg: local wind (meteorological FROM). shore_normal_deg: seaward bearing (optional; enables
    offshore/onshore grading)."""
    if surf_h_m is None:
        return None, "unknown"
    score = rating_score(surf_h_m, tp_s, wind_speed_ms, wind_from_deg, shore_normal_deg)
    return score, score_to_level(score)


def rating_transform_grid(vectors, depth_fn, coastal_fn=None, width_fn=None, wind_fn=None, shore_normal_fn=None):
    """In-place RATING-BAND transform of a marine grid for the surf-quality MAP overlay (the on-map
    differentiator). Per COASTAL cell: derive the breaking height (surf_transform.estimate_surf) then the
    0-100 surf-quality SCORE (compute_surf_rating, with wind + shore-normal co-sampled via the injected fns),
    and write that score into ``speed`` so the heatmap colours by QUALITY (the frontend keys the 7-level
    rating colormap off the grid's rating mode). OPEN-OCEAN cells are transparency-masked (is_valid=False) ->
    a coastal RATING BAND, exactly like surf_transform_grid.

    Injected fns keep it pure/unit-testable (no I/O): depth_fn(lat,lng)->m|None, coastal_fn(lat,lng)->bool,
    width_fn(lat,lng)->km, wind_fn(lat,lng)->(speed_ms, from_deg)|None, shore_normal_fn(lat,lng)->bearing|None.
    Returns (n_rated, n_masked). Mutates each vector: ``speed`` becomes the score, ``u``/``v`` are zeroed
    (rating is scalar — no direction arrows), and ``rating_level`` is set when the attribute exists. Truly
    flat cells (size gate 0 -> score 0) are left untouched/non-rendered (no wave to rate)."""
    from services.weather_pipeline.surf_transform import estimate_surf
    n_rated = 0
    n_masked = 0
    for vec in vectors:
        sp = getattr(vec, "speed", 0) or 0
        if sp <= 0:
            continue
        lat = getattr(vec, "lat", None)
        lng = getattr(vec, "lng", None)
        if coastal_fn is not None:
            try:
                coastal = bool(coastal_fn(lat, lng))
            except Exception:
                coastal = True
            if not coastal:
                if hasattr(vec, "is_valid"):
                    vec.is_valid = False
                n_masked += 1
                continue
        try:
            depth = depth_fn(lat, lng)
        except Exception:
            depth = None
        width = 0.0
        if width_fn is not None:
            try:
                width = width_fn(lat, lng) or 0.0
            except Exception:
                width = 0.0
        period = getattr(vec, "period", None)
        surf, regime = estimate_surf(sp, period, depth, coastal=True, shelf_width_km=width)
        if surf is None or regime in ("open_ocean", "calm", "unknown"):
            continue
        wind_speed = wind_from = None
        if wind_fn is not None:
            try:
                w = wind_fn(lat, lng)
                if w:
                    wind_speed, wind_from = w
            except Exception:
                pass
        shore_normal = None
        if shore_normal_fn is not None:
            try:
                shore_normal = shore_normal_fn(lat, lng)
            except Exception:
                shore_normal = None
        score, level = compute_surf_rating(surf, period, wind_speed, wind_from, shore_normal)
        if score is None or score <= 0:
            continue                                   # no rideable wave -> nothing to rate
        vec.speed = round(float(score), 1)             # 0-100 rating score -> heatmap value
        if hasattr(vec, "rating_level"):
            vec.rating_level = level
        if getattr(vec, "u", None) is not None:
            vec.u = 0.0
        if getattr(vec, "v", None) is not None:
            vec.v = 0.0
        n_rated += 1
    return n_rated, n_masked

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
    rating = size_gate(surf_height) * swell_exposure(angle) * (0.60 * wind_quality + 0.40 * period_quality)  -> 0..100
  - size_gate: there must be a rideable wave (0 when flat; saturates chest-high+). Bigger is NOT penalized
    here — a big CLEAN long-period wave is exactly what 'epic' means; wind + period grade it.
  - swell_exposure: the swell ANGLE must be able to reach this coast. Head-on (swell FROM the seaward
    shore-normal) = full; grazing/along-shore = reduced; from behind the coast = blocked (->0.1 floor). Uses
    the shore-normal when known, else neutral 1.0 (no penalty).
  - wind_quality: the dominant cleanliness factor. Offshore/light grooms the face (high); onshore/strong
    is blown out (low); sideshore/cross is moderate. Uses the shore-normal when known, else speed-only.
  - period_quality: long-period groundswell is powerful + organized (high); short windswell is chop (low).
mapped to a 7-level surf-quality scale: very_poor, poor, poor_fair, fair, fair_good, good, epic.
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


# Rideability floor: below this breaking height there is no surfable wave ANYWHERE (ankle-high can't be
# ridden regardless of the spot) — kept ABSOLUTE. The saturation height is LOCAL (see reference_size_m).
_HMIN_RIDEABLE_M = 0.2
# Global default "fully-working" height (chest-high) used when a spot has no local size reference yet —
# makes size_score identical everywhere until per-spot climatology is supplied (backward compatible).
_DEFAULT_REF_SIZE_M = 1.2


def size_score(surf_h_m, reference_size_m=None):
    """Rideability gate [0,1] from breaking height, calibrated to the spot's LOCAL size expectation.

    ``reference_size_m`` is the breaking height at which THIS spot is "fully working" (size factor
    saturates to 1.0) — the spot's own good-day size. Below the absolute ~0.2 m rideability floor the
    score is 0 (unsurfable anywhere); it rises linearly to 1.0 at the reference. Bigger than the
    reference is NOT penalized here (wind/period grade it). When ``reference_size_m`` is None the global
    default 1.2 m (chest-high) is used → the gate is IDENTICAL everywhere, so behavior is unchanged until
    a per-spot reference is wired.

    This is what makes surf quality RELATIVE to a spot's potential (Surfline's principle): a clean 2-3 ft
    day saturates the size gate at a small-wave spot (e.g. Florida, ref ~0.6 m) but scores low at a
    big-wave spot (e.g. Pipeline, ref ~2.5 m) — the same swell, different local rating."""
    if surf_h_m is None or surf_h_m <= _HMIN_RIDEABLE_M:
        return 0.0
    ref = reference_size_m if (reference_size_m is not None and reference_size_m > _HMIN_RIDEABLE_M) else _DEFAULT_REF_SIZE_M
    if surf_h_m >= ref:
        return 1.0
    return _clamp((surf_h_m - _HMIN_RIDEABLE_M) / (ref - _HMIN_RIDEABLE_M), 0.0, 1.0)


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


def swell_exposure(swell_from_deg, shore_normal_deg):
    """Swell-ANGLE factor [0..1]: can this swell actually reach the coast, head-on or grazing? ``shore_normal_deg``
    points OUT TO SEA; a swell whose FROM-bearing aligns with it arrives head-on (best energy). Beyond ~90° off
    the shore-normal the swell travels along/behind the coast and can't build a rideable wave. Softened incidence
    projection (refraction bends swell shore-normal, so gentler than a hard cosine) with a small floor so coarse
    shore-normal noise can't fully zero a real swell. Returns 1.0 when geometry is unknown (no penalty)."""
    if swell_from_deg is None or shore_normal_deg is None:
        return 1.0
    align = math.cos(math.radians(swell_from_deg - shore_normal_deg))  # +1 head-on, 0 at 90°, -1 from behind
    return _clamp(0.10 + 0.90 * max(0.0, align), 0.0, 1.0)


# Preferred tide bands (normalized tide level: 0 = low water, 1 = high water) parsed from a spot's free-text
# ``best_tide`` prior. Compound phrases first so "low to mid" wins over "low".
_TIDE_BANDS = [
    ("low to mid", (0.0, 0.60)), ("low-mid", (0.0, 0.60)), ("mid to low", (0.0, 0.60)),
    ("mid to high", (0.40, 1.0)), ("mid-high", (0.40, 1.0)), ("high to mid", (0.40, 1.0)),
    ("low", (0.0, 0.35)), ("high", (0.65, 1.0)), ("mid", (0.33, 0.67)), ("medium", (0.33, 0.67)),
]


def parse_best_tide(best_tide_text):
    """Parse a spot's free-text ``best_tide`` prior into a preferred normalized tide band (lo, hi) in 0..1
    (0 = low water, 1 = high water), or None when there's no usable LEVEL preference ('all tides', empty, or a
    trend-only note like 'incoming'/'rising'). Compound phrases match first so 'low to mid' beats 'low'."""
    if not best_tide_text or not isinstance(best_tide_text, str):
        return None
    t = best_tide_text.strip().lower()
    if not t or "all" in t or "any" in t:
        return None
    for phrase, band in _TIDE_BANDS:
        if phrase in t:
            return band
    return None


def tide_fit(tide_norm, best_tide_band):
    """Tide-quality factor [0.5..1.0]: 1.0 inside the spot's preferred band, tapering with distance outside,
    FLOORED at 0.5 — tide REFINES a rating (a wrong tide knocks it down) but never zeroes a good swell. Neutral
    1.0 when the tide level (``tide_norm``) or the preference (``best_tide_band``) is unknown."""
    if tide_norm is None or not best_tide_band:
        return 1.0
    lo, hi = best_tide_band
    dist = max(0.0, lo - tide_norm, tide_norm - hi)   # 0 inside the band; grows outside
    return _clamp(1.0 - 1.3 * dist, 0.5, 1.0)


def breaker_type_quality(xi):
    """Breaker-TYPE quality factor [0.82..1.0] from the Iribarren number ξ0 (surf_transform.iribarren).
    PLUNGING waves (hollow, powerful — ξ0 ~0.5..3.3) are the prized type → 1.0; SPILLING (mushy, ξ0<0.5) and
    SURGING/closeout (ξ0>3.3) score lower. Bounded + gentle (breaker type REFINES, never dominates). Neutral
    1.0 when ξ0 is unknown — so this is a no-op until a finer slope asset feeds a real Iribarren."""
    if xi is None:
        return 1.0
    if xi < 0.5:                                  # spilling: ramps 0.85 (ξ→0) up to 1.0 at the plunging edge
        return _clamp(0.85 + 0.30 * xi, 0.82, 1.0)
    if xi <= 3.3:                                 # plunging: the ideal
        return 1.0
    return _clamp(1.0 - 0.06 * (xi - 3.3), 0.82, 1.0)  # surging/closeout: gentle taper


def rating_score(surf_h_m, tp_s, wind_speed_ms, wind_from_deg=None, shore_normal_deg=None, swell_from_deg=None,
                 tide_norm=None, best_tide=None, breaker_xi=None, reference_size_m=None):
    """Composite 0..100 surf-quality score:
    size_gate * swell_exposure * tide_fit * breaker_type_quality * (0.60*wind + 0.40*period).
    0 when flat OR when the swell angle can't reach the coast. Each factor degrades gracefully to neutral when
    its geometry/inputs are unknown (no shore-normal -> speed-only wind + full exposure; no tide / no Iribarren
    -> neutral). ``reference_size_m`` calibrates the size gate to the spot's LOCAL good-day size (None ->
    global 1.2 m default, no change)."""
    sg = size_score(surf_h_m, reference_size_m)
    if sg <= 0.0:
        return 0.0
    ex = swell_exposure(swell_from_deg, shore_normal_deg)
    if ex <= 0.0:
        return 0.0
    tf = tide_fit(tide_norm, parse_best_tide(best_tide))
    bt = breaker_type_quality(breaker_xi)
    wq = wind_quality(wind_speed_ms, wind_from_deg, shore_normal_deg)
    pq = period_quality(tp_s)
    return round(100.0 * sg * ex * tf * bt * (W_WIND * wq + W_PERIOD * pq), 1)


def score_to_level(score):
    """Map a 0-100 score to one of the 7 levels (very_poor..epic). None -> 'unknown'."""
    if score is None:
        return "unknown"
    for upper, name in _BUCKETS:
        if score < upper:
            return name
    return "epic"


def compute_surf_rating(surf_h_m, tp_s, wind_speed_ms, wind_from_deg=None, shore_normal_deg=None, swell_from_deg=None,
                        tide_norm=None, best_tide=None, breaker_xi=None, reference_size_m=None):
    """Return ``(score, level)`` — score 0-100 (None if surf height missing), level in LEVELS.

    surf_h_m: nearshore BREAKING height (from surf_transform). tp_s: peak/swell period. wind_speed_ms +
    wind_from_deg: local wind (meteorological FROM). shore_normal_deg: seaward bearing (optional; enables
    offshore/onshore wind grading AND the swell-angle exposure gate). swell_from_deg: dominant swell FROM
    bearing (optional; with shore_normal gates whether the swell angle can reach the coast). tide_norm:
    normalized tide level 0..1 (optional; with best_tide applies the tide_fit factor). best_tide: the spot's
    free-text tide preference prior (optional). breaker_xi: Iribarren number (optional; applies the breaker-type
    quality factor — neutral when None). reference_size_m: the spot's local "fully-working" breaking height
    (optional; calibrates the size gate to local expectation — None keeps the global 1.2 m default)."""
    if surf_h_m is None:
        return None, "unknown"
    score = rating_score(surf_h_m, tp_s, wind_speed_ms, wind_from_deg, shore_normal_deg, swell_from_deg,
                         tide_norm, best_tide, breaker_xi, reference_size_m)
    return score, score_to_level(score)


def rating_transform_grid(vectors, depth_fn, coastal_fn=None, width_fn=None, wind_fn=None, shore_normal_fn=None,
                          reference_fn=None):
    """In-place RATING-BAND transform of a marine grid for the surf-quality MAP overlay (the on-map
    differentiator). Per COASTAL cell: derive the breaking height (surf_transform.estimate_surf) then the
    0-100 surf-quality SCORE (compute_surf_rating, with wind + shore-normal co-sampled via the injected fns),
    and write that score into ``speed`` so the heatmap colours by QUALITY (the frontend keys the 7-level
    rating colormap off the grid's rating mode). OPEN-OCEAN cells are transparency-masked (is_valid=False) ->
    a coastal RATING BAND, exactly like surf_transform_grid.

    Injected fns keep it pure/unit-testable (no I/O): depth_fn(lat,lng)->m|None, coastal_fn(lat,lng)->bool,
    width_fn(lat,lng)->km, wind_fn(lat,lng)->(speed_ms, from_deg)|None, shore_normal_fn(lat,lng)->bearing|None,
    reference_fn(lat,lng)->m|None (the LOCAL good-day size reference — P-local band half; None per cell or
    fn absent keeps the global 1.2 m size-gate default, byte-identical to before).
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
        # The cell's wave/swell FROM bearing → swell-angle exposure gate (paired with shore_normal).
        swell_from = getattr(vec, "direction", None)
        reference = None
        if reference_fn is not None:
            try:
                reference = reference_fn(lat, lng)
            except Exception:
                reference = None
        score, level = compute_surf_rating(surf, period, wind_speed, wind_from, shore_normal, swell_from,
                                           reference_size_m=reference)
        if score is None or score <= 0:
            continue                                   # no rideable wave -> nothing to rate
        # Encode score/10 into the height channel: the marine texture packs height as clamp(h/10,0,1), and the
        # shader recovers the score as waveHeight*10 -> getRatingColor(score). Keeps the existing encode/decode
        # untouched (the rating overlay is just a different colormap on the same 0-10 channel).
        vec.speed = round(float(score) / 10.0, 4)
        if hasattr(vec, "rating_level"):
            vec.rating_level = level
        # u/v are KEPT (2026-07-12; previously zeroed as "rating is scalar"): the frontend
        # animates wave crests/particles from the u/v motion vector, so zeroing froze every
        # animation over the rating band ("the band clamps the wave animations"). The color
        # channel is `speed` (the score); u/v carry the real swell motion under the colors.
        n_rated += 1
    return n_rated, n_masked

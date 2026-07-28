"""Unit tests for the multivariable surf-quality rating (surf_rating.py)."""
import pytest
from services.weather_pipeline.surf_rating import (
    compute_surf_rating, rating_score, size_score, period_quality,
    wind_quality, offshoreness, swell_exposure, score_to_level, LEVELS,
    parse_best_tide, tide_fit, breaker_type_quality,
    oversize_gate, oversize_thresholds, OVERSIZE_FLOOR, OVERSIZE_ABS_START_M,
    OVERSIZE_ABS_FLOOR_M, OVERSIZE_GAMMA, OVERSIZE_MAX_BREAK_DEPTH_M, OVERSIZE_MIN_START_M,
)


def test_breaker_type_quality():
    assert breaker_type_quality(None) == 1.0                 # unknown -> neutral
    assert breaker_type_quality(1.5) == 1.0                  # plunging = ideal
    assert breaker_type_quality(3.0) == 1.0
    assert breaker_type_quality(0.1) < 1.0                   # spilling (mushy) lower
    assert breaker_type_quality(8.0) < 1.0                   # surging/closeout lower
    assert 0.82 <= breaker_type_quality(0.0) <= 1.0         # bounded floor
    assert breaker_type_quality(0.4) > breaker_type_quality(0.1)  # toward plunging -> better


def test_breaker_type_factor_lowers_spilling_not_plunging():
    base = compute_surf_rating(1.5, 14.0, 1.0, 200.0, 270.0, 270.0)[0]                 # no ξ0 -> neutral
    plunging = compute_surf_rating(1.5, 14.0, 1.0, 200.0, 270.0, 270.0, breaker_xi=1.5)[0]
    spilling = compute_surf_rating(1.5, 14.0, 1.0, 200.0, 270.0, 270.0, breaker_xi=0.1)[0]
    assert plunging == pytest.approx(base)                  # plunging factor 1.0 == neutral
    assert spilling < base                                  # mushy spilling knocks it down
    assert spilling > 0


def test_parse_best_tide_bands():
    assert parse_best_tide("Low") == (0.0, 0.35)
    assert parse_best_tide("Mid") == (0.33, 0.67)
    assert parse_best_tide("High") == (0.65, 1.0)
    assert parse_best_tide("Low to mid") == (0.0, 0.60)     # compound beats 'low'
    assert parse_best_tide("Mid to high") == (0.40, 1.0)
    assert parse_best_tide("All tides") is None             # no level preference
    assert parse_best_tide("") is None and parse_best_tide(None) is None
    assert parse_best_tide("incoming") is None              # trend-only -> neutral


def test_tide_fit_band_and_taper():
    band = (0.65, 1.0)                                       # prefers high tide
    assert tide_fit(0.8, band) == 1.0                       # inside the band
    assert tide_fit(0.65, band) == 1.0                      # on the edge
    assert tide_fit(0.0, band) == pytest.approx(max(0.5, 1.0 - 1.3 * 0.65))  # far low -> floored taper
    assert tide_fit(0.5, band) == pytest.approx(1.0 - 1.3 * 0.15)            # just below the band
    assert tide_fit(None, band) == 1.0 and tide_fit(0.5, None) == 1.0        # unknown -> neutral
    assert tide_fit(0.0, band) >= 0.5                       # never below the floor


def test_tide_lowers_score_when_wrong_tide():
    # Identical good conditions; wrong tide vs neutral. Wrong tide must score LOWER but not zero.
    base = compute_surf_rating(1.5, 14.0, 1.0, 200.0, 270.0, 270.0)[0]                 # no tide -> neutral
    wrong = compute_surf_rating(1.5, 14.0, 1.0, 200.0, 270.0, 270.0, tide_norm=0.0, best_tide="High")[0]
    right = compute_surf_rating(1.5, 14.0, 1.0, 200.0, 270.0, 270.0, tide_norm=0.9, best_tide="High")[0]
    assert wrong < base                                      # wrong tide knocks it down
    assert right == pytest.approx(base)                     # right tide == neutral (factor 1.0)
    assert wrong > 0                                         # but never zeroed


def test_swell_exposure_head_on_grazing_blocked_unknown():
    # shore faces west: seaward normal 270. Swell FROM the west (270) arrives head-on.
    assert swell_exposure(270, 270) == 1.0
    # along-shore (90° off the normal) -> grazing, floored low.
    assert abs(swell_exposure(180, 270) - 0.10) < 0.02
    # from behind the coast (FROM the east) -> can't reach, floored at 0.10.
    assert swell_exposure(90, 270) <= 0.11
    # unknown geometry -> neutral, no penalty.
    assert swell_exposure(None, 270) == 1.0
    assert swell_exposure(220, None) == 1.0


def test_swell_angle_gates_the_rating():
    # Identical size/period/wind; a head-on swell must rate well above a poorly-angled (along-shore) one.
    head_on = compute_surf_rating(1.5, 14.0, 3.0, wind_from_deg=90, shore_normal_deg=270, swell_from_deg=270)[0]
    grazing = compute_surf_rating(1.5, 14.0, 3.0, wind_from_deg=90, shore_normal_deg=270, swell_from_deg=180)[0]
    assert head_on > grazing
    # Unknown swell angle must not change the score vs the prior (no-exposure) behavior.
    neutral = compute_surf_rating(1.5, 14.0, 3.0, wind_from_deg=90, shore_normal_deg=270)[0]
    assert neutral == head_on


def test_levels_scale_is_the_seven_surfline_buckets():
    assert LEVELS == ["very_poor", "poor", "poor_fair", "fair", "fair_good", "good", "epic"]


def test_flat_is_very_poor_regardless_of_wind_and_period():
    # No rideable wave -> size gate 0 -> score 0 -> very_poor, even with perfect wind + long period.
    score, level = compute_surf_rating(0.1, 16.0, 1.0, wind_from_deg=270, shore_normal_deg=270)
    assert score == 0.0
    assert level == "very_poor"


def test_big_clean_long_period_offshore_is_epic():
    # Overhead+ (2 m), 15 s groundswell, light offshore -> epic.
    # shore faces west (seaward normal 270); offshore wind blows from land (east) -> FROM ~090.
    score, level = compute_surf_rating(2.0, 15.0, 3.0, wind_from_deg=90, shore_normal_deg=270)
    assert score >= 84
    assert level == "epic"


def test_strong_onshore_blows_it_out():
    # Head-high but 18 kt straight onshore + short period -> poor / very_poor.
    onshore_ms = 18 / 1.943844
    score, level = compute_surf_rating(1.5, 8.0, onshore_ms, wind_from_deg=270, shore_normal_deg=270)
    assert score < 28
    assert level in ("very_poor", "poor")


def test_offshoreness_sign_convention():
    # seaward normal = 270 (coast faces west). Onshore wind FROM the sea (270) -> -1; offshore FROM land (90) -> +1.
    assert offshoreness(270, 270) < -0.99   # onshore
    assert offshoreness(90, 270) > 0.99      # offshore
    assert abs(offshoreness(0, 270)) < 0.01  # cross-shore
    assert offshoreness(None, 270) is None


def test_glassy_is_clean_regardless_of_direction():
    assert wind_quality(1.0) == 1.0                       # <3 kt glassy
    assert wind_quality(1.0, wind_from_deg=270, shore_normal_deg=270) == 1.0


def test_offshore_tolerates_more_speed_than_onshore():
    moderate_ms = 14 / 1.943844
    off = wind_quality(moderate_ms, wind_from_deg=90, shore_normal_deg=270)   # offshore 14 kt
    on = wind_quality(moderate_ms, wind_from_deg=270, shore_normal_deg=270)   # onshore 14 kt
    assert off > on
    assert off > 0.6 and on < 0.4


def test_period_quality_monotonic_short_to_long():
    assert period_quality(5) == 0.40
    assert period_quality(16) == 1.0
    assert period_quality(11) > period_quality(8) > period_quality(6)


def test_size_score_gates_then_saturates():
    assert size_score(0.1) == 0.0
    assert 0.0 < size_score(0.6) < 1.0
    assert size_score(1.5) == 1.0
    assert size_score(5.0) == 1.0   # big is not penalized (graded by wind/period)


def test_size_score_reference_none_is_backward_compatible():
    # No reference must reproduce the pre-calibration curve EXACTLY (this is the LIVE default path).
    # NOTE: an EXPLICIT reference now selects the local-relative curve (anchored 0.6 at ref) — only
    # None is the legacy absolute curve (user anchor recalibration 2026-07-12).
    for h in (0.05, 0.2, 0.3, 0.6, 0.9, 1.2, 1.5, 5.0):
        legacy = 0.0 if h <= 0.2 else (1.0 if h >= 1.2 else (h - 0.2) / 1.0)
        assert size_score(h) == pytest.approx(legacy)
        assert size_score(h, None) == pytest.approx(legacy)


def test_size_score_local_reference_anchors_not_saturates():
    # USER anchors (2026-07-12): the local reference is the spot's ORDINARY good day — it anchors the
    # curve middle (0.6), not saturation. Only well-overhead-for-this-spot (2.5x ref) maxes the factor.
    assert size_score(0.6, reference_size_m=0.6) == pytest.approx(0.6)   # at ref = the anchor, not 1.0
    assert size_score(0.6, reference_size_m=2.5) < 0.25                  # same 2 ft is tiny at Pipeline
    assert size_score(0.6, reference_size_m=0.6) > size_score(0.6, reference_size_m=2.5)
    assert size_score(0.15, reference_size_m=0.6) == 0.0                 # absolute unrideable floor
    assert size_score(1.5, reference_size_m=0.6) == 1.0                  # 2.5x ref saturates
    assert size_score(3.0, reference_size_m=0.6) == 1.0                  # beyond never penalized here
    # Monotonic, continuous at the anchor: just-below vs just-above the reference.
    assert size_score(0.699, reference_size_m=0.7) < size_score(0.701, reference_size_m=0.7)


def test_local_reference_lifts_small_clean_surf_rating():
    # Clean 2-3 ft with a small-wave local ref still edges ABOVE the global default (0.638 vs 0.6 size
    # factor at 0.8 m / ref 0.7) — locally-working beats globally-mediocre, just no longer by 2 levels.
    args = (0.8, 11.0, 2.0, 90.0, 270.0, 90.0)  # 0.8 m surf, 11 s, 2 m/s offshore-ish
    global_score, global_level = compute_surf_rating(*args)                       # ref None -> 1.2 m default
    fl_score, fl_level = compute_surf_rating(*args, reference_size_m=0.7)         # small-wave spot
    assert fl_score > global_score
    assert LEVELS.index(fl_level) >= LEVELS.index(global_level)


def test_user_calibration_anchors_florida_and_indo():
    """THE user acceptance spec (2026-07-12): FL 2-3 ft clean = FAIR; FL 3-4 ft+ = fair or fair-good;
    the same small day at a big-wave coast = poor-class. Perfect-clean composite (11 s, light dead-
    offshore, head-on swell) is the CEILING case — typical days land lower in the same bucket."""
    clean = (11.0, 2.0, 90.0, 270.0, 270.0)                    # tp, wind 2 m/s FROM land, head-on swell
    fl_ref = 0.7                                               # FL p80 good-day breaking height
    s25, l25 = compute_surf_rating(0.75, *clean, reference_size_m=fl_ref)   # ~2.5 ft
    assert s25 == pytest.approx(55.3, abs=0.05) and l25 == "fair"
    s35, l35 = compute_surf_rating(1.05, *clean, reference_size_m=fl_ref)   # ~3.5 ft
    assert s35 == pytest.approx(65.5, abs=0.05) and l35 == "fair_good"
    # Typical-clean (9 s, 4 m/s offshore) 2-3 ft stays FAIR, not fair_good.
    s_typ, l_typ = compute_surf_rating(0.75, 9.0, 4.0, 90.0, 270.0, 270.0, reference_size_m=fl_ref)
    assert l_typ == "fair"
    # Indo/Hawaii-class coast (ref 2.5): the same 2.5 ft perfect-clean day is poor-class.
    s_indo, l_indo = compute_surf_rating(0.75, *clean, reference_size_m=2.5)
    assert s_indo < 20.0 and l_indo in ("very_poor", "poor")


def test_speed_only_path_when_no_shore_normal():
    # Without a shore normal, grade on speed alone (conservative): light good, strong bad.
    light = compute_surf_rating(1.5, 12.0, 4 / 1.943844)[0]   # ~4 kt
    strong = compute_surf_rating(1.5, 12.0, 28 / 1.943844)[0]  # ~28 kt
    assert light > strong


def test_score_to_level_buckets():
    assert score_to_level(0) == "very_poor"
    assert score_to_level(20) == "poor"
    assert score_to_level(35) == "poor_fair"
    assert score_to_level(50) == "fair"
    assert score_to_level(64) == "fair_good"
    assert score_to_level(78) == "good"
    assert score_to_level(95) == "epic"
    assert score_to_level(None) == "unknown"


def test_missing_surf_height_is_unknown():
    score, level = compute_surf_rating(None, 12.0, 5.0)
    assert score is None and level == "unknown"


def test_rating_transform_grid_writes_score_masks_open_ocean_zeros_vectors():
    from types import SimpleNamespace
    from services.weather_pipeline.surf_rating import rating_transform_grid

    def vec(speed, lat, lng):
        return SimpleNamespace(speed=speed, period=12.0, lat=lat, lng=lng, u=1.0, v=1.0,
                               is_valid=True, rating_level=None)

    coastal = vec(1.5, 34.0, -120.0)
    open_ocean = vec(2.0, 0.0, -140.0)
    n_rated, n_masked = rating_transform_grid(
        [coastal, open_ocean],
        depth_fn=lambda la, ln: 30.0,
        coastal_fn=lambda la, ln: la == 34.0,        # only the coastal cell is coastal
        width_fn=lambda la, ln: 0.0,
        wind_fn=lambda la, ln: (5.0, 90.0),          # light, offshore vs the 270 shore-normal
        shore_normal_fn=lambda la, ln: 270.0,
    )
    assert n_rated == 1 and n_masked == 1
    assert 0 < coastal.speed <= 10                   # speed holds score/10 (fits the 0-10 texture channel)
    # u/v KEPT since 2026-07-12 (was zeroed): the frontend animates crests/particles from the
    # motion vector — zeroing froze every animation over the rating band.
    assert coastal.u == 1.0 and coastal.v == 1.0
    assert coastal.rating_level in (
        "very_poor", "poor", "poor_fair", "fair", "fair_good", "good", "epic")
    assert open_ocean.is_valid is False              # open ocean transparency-masked


def test_rating_transform_preserves_honest_height_in_phys_speed():
    """§0e ANIM-PHYS (2026-07-14, user directive "animations identical rating-on/off"): the
    transform overwrites `speed` with score/10 (rated) or masks is_valid (open ocean) — both
    cells must carry the ORIGINAL honest height in phys_speed so the frontend animates crest
    size/drift from physics while the band colors from the score."""
    from types import SimpleNamespace
    from services.weather_pipeline.surf_rating import rating_transform_grid

    def vec(speed, lat, lng):
        return SimpleNamespace(speed=speed, period=12.0, lat=lat, lng=lng, u=1.0, v=1.0,
                               is_valid=True, rating_level=None, phys_speed=None)

    coastal = vec(1.5, 34.0, -120.0)
    open_ocean = vec(2.0, 0.0, -140.0)
    rating_transform_grid(
        [coastal, open_ocean],
        depth_fn=lambda la, ln: 30.0,
        coastal_fn=lambda la, ln: la == 34.0,
        width_fn=lambda la, ln: 0.0,
        wind_fn=lambda la, ln: (5.0, 90.0),
        shore_normal_fn=lambda la, ln: 270.0,
    )
    assert coastal.phys_speed == 1.5                 # honest height preserved beside the score
    assert coastal.speed != 1.5                      # speed now carries score/10
    assert open_ocean.phys_speed == 2.0              # masked cell carries it too (uniform field)


def test_grid_vector_serialization_omits_phys_speed_when_none():
    """§0e bloat guard: phys_speed must NOT serialize as null on the millions of non-surf cells
    (every /grid response + every L2 product would grow otherwise)."""
    from services.weather_pipeline.schemas import GridVector
    plain = GridVector(lat=1.0, lng=2.0, speed=0.5).model_dump()
    assert "phys_speed" not in plain
    surf = GridVector(lat=1.0, lng=2.0, speed=0.3, phys_speed=1.5).model_dump()
    assert surf["phys_speed"] == 1.5


# ───────────────────── partition-aware factors (rating plan Step 3, seam) ─────────────────────
def test_dominant_swell_period_recovers_groundswell_under_windsea():
    from services.weather_pipeline.surf_rating import dominant_swell_period
    parts = [{"h": 1.2, "tp": 16.0, "dir": 270.0, "kind": "swell"},
             {"h": 0.8, "tp": 8.0, "dir": 250.0, "kind": "windsea"}]
    assert dominant_swell_period(parts) == 16.0              # windsea excluded; energy picks the train
    assert dominant_swell_period([]) is None
    assert dominant_swell_period(None) is None
    assert dominant_swell_period([{"h": None, "tp": 12.0, "kind": "swell"}]) is None


def test_effective_swell_exposure_energy_weighted():
    from services.weather_pipeline.surf_rating import effective_swell_exposure
    # Dominant swell FROM 90 arrives from BEHIND a west-facing coast (shore-normal 270) -> 0.1 floor;
    # a smaller secondary FROM 270 is head-on -> 1.0. Energy weights: 4:1.
    parts = [{"h": 2.0, "tp": 14.0, "dir": 90.0, "kind": "swell"},
             {"h": 1.0, "tp": 10.0, "dir": 270.0, "kind": "swell"},
             {"h": 3.0, "tp": 5.0, "dir": 200.0, "kind": "windsea"}]   # windsea excluded from exposure
    ex = effective_swell_exposure(parts, 270.0)
    assert abs(ex - (4 * 0.1 + 1 * 1.0) / 5.0) < 1e-9        # 0.28
    assert effective_swell_exposure(parts, None) is None      # geometry unknown -> caller neutral
    assert effective_swell_exposure([{"h": 1.0, "tp": 9.0, "kind": "swell"}], 270.0) is None  # no dir


def test_sea_cleanliness_fraction_and_floor():
    from services.weather_pipeline.surf_rating import sea_cleanliness
    assert sea_cleanliness(None) == 1.0
    assert sea_cleanliness([{"h": 1.0, "kind": "swell"}]) == 1.0            # clean groundswell
    half = sea_cleanliness([{"h": 1.0, "kind": "swell"}, {"h": 1.0, "kind": "windsea"}])
    assert abs(half - 0.75) < 1e-9                                          # 50% energy windsea
    pure = sea_cleanliness([{"h": 1.0, "kind": "windsea"}])
    assert pure == 0.6                                                      # floored, never zeroes


def test_partitions_none_is_byte_identical():
    args = (1.5, 11.0, 2.0, 90.0, 270.0, 270.0)
    base = rating_score(*args)
    assert rating_score(*args, partitions=None) == base
    assert rating_score(*args, partitions=[]) == base
    # A degenerate partition list (nothing usable) must fall back to total-field behavior too.
    assert rating_score(*args, partitions=[{"h": None, "tp": None, "dir": None, "kind": "swell"}]) == base


def test_partition_aware_composite_parity_values():
    """Golden values shared with the JS mirror test — clean groundswell lifts (period), windsea mess drops
    (cleanliness + honest period), both through the full composite."""
    args = (1.5, 11.0, 2.0, 90.0, 270.0, 270.0)              # offshore light wind, head-on total swell
    base = rating_score(*args)
    assert base == 89.3
    clean = rating_score(*args, partitions=[{"h": 1.2, "tp": 16.0, "dir": 270.0, "kind": "swell"}])
    assert clean == 100.0                                     # 16 s groundswell recovered -> pq 1.0
    messy = rating_score(*args, partitions=[
        {"h": 0.4, "tp": 14.0, "dir": 270.0, "kind": "swell"},
        {"h": 1.2, "tp": 5.0, "dir": 250.0, "kind": "windsea"}])
    assert messy == 58.4                                      # windsea-dominated: sea_clean floors at 0.6
    assert messy < base < clean


def test_wind_direction_penalty_ramps_with_speed():
    """Forensic fix (2026-07-12): light onshore is textured, NOT blown out — guidance puts the wind-
    matters threshold near 6-7 kt. The direction penalty phases in 3->12 kt; offshore is unchanged."""
    KT = 1.943844
    # 6 kt dead-onshore (wind FROM the sea = FROM the seaward normal): surfable, not blown out.
    on6 = wind_quality(6.0 / KT, wind_from_deg=270.0, shore_normal_deg=270.0)
    assert on6 == pytest.approx(0.6417, abs=0.001)            # was 0.175 (blown-out class)
    assert on6 > 0.5
    # 12 kt onshore: full penalty — blown out as before.
    on12 = wind_quality(12.0 / KT, wind_from_deg=270.0, shore_normal_deg=270.0)
    assert on12 == pytest.approx(0.10, abs=0.001)
    # Offshore byte-identical at every speed (committed goldens depend on it).
    off6 = wind_quality(6.0 / KT, wind_from_deg=90.0, shore_normal_deg=270.0)
    assert off6 == pytest.approx(1.0 - (6.0 - 4.0) / 44.0, abs=1e-9)
    # Monotonic: more onshore wind is never better.
    speeds = [4.0, 6.0, 8.0, 10.0, 12.0, 16.0]
    vals = [wind_quality(k / KT, 270.0, 270.0) for k in speeds]
    assert all(a >= b for a, b in zip(vals, vals[1:]))


def test_partition_secondary_swell_recovered_when_dominant_shadowed():
    """A total-field direction of the SHADOWED dominant swell under-rates; per-partition exposure credits
    the well-angled secondary train."""
    args = (1.5, 11.0, 2.0, 90.0, 270.0, 90.0)               # total dir = the blocked train
    parts = [{"h": 2.0, "tp": 14.0, "dir": 90.0, "kind": "swell"},
             {"h": 1.0, "tp": 10.0, "dir": 270.0, "kind": "swell"}]
    assert rating_score(*args, partitions=parts) > rating_score(*args)


# ── BLOWN-OUT VETO (wind_gate, 2026-07-26) ──────────────────────────────────────────────────────────
# Measured before the gate: at 2.0 m head-on, DEAD onshore, the score was IDENTICAL at 16/30/60/100 kt
# (19.0 / 35.0 / 43.0 for tp 6 / 12 / 16 s) because the wind term is an ADDEND — and the ordering
# INVERTED, a longer period scoring higher in a 100 kt gale.
import os as _os
from services.weather_pipeline.surf_rating import wind_gate as _wind_gate

_KT = 1.943844


def test_wind_gate_is_inert_where_it_must_be():
    """It may only ever remove score from strong ONSHORE wind — never anything else."""
    assert _wind_gate(40 / _KT, 90.0, 270.0) == 1.0      # dead offshore, gale
    assert _wind_gate(40 / _KT, 180.0, 270.0) == 1.0     # exactly cross-shore
    assert _wind_gate(40 / _KT, None, None) == 1.0       # unknown geometry
    assert _wind_gate(10 / _KT, 270.0, 270.0) == 1.0     # onshore but light
    assert _wind_gate(2.0, 90.0, 270.0) == 1.0           # the pinned calibration anchor's wind
    assert _wind_gate(None, 270.0, 270.0) == 1.0         # missing speed


def test_wind_gate_vetoes_a_blown_out_day_regardless_of_period():
    """A 100 kt dead-onshore gale is unsurfable at EVERY period. Was 19.0-43.0 'poor'..'fair'."""
    scores = [rating_score(2.0, float(tp), 100 / _KT, 270.0, 270.0, 270.0) for tp in (6, 9, 12, 16, 20)]
    assert scores == [0.0] * 5, scores


def test_wind_gate_removes_the_period_inversion():
    """Before: at 100 kt onshore, score ROSE with period. After: never rises as wind worsens."""
    for tp in (6, 12, 16, 20):
        prev = None
        for kt in (12, 16, 25, 40, 100):
            s = rating_score(2.0, float(tp), kt / _KT, 270.0, 270.0, 270.0)
            if prev is not None:
                assert s <= prev, f"tp={tp}s score rose as wind grew: {prev} -> {s} at {kt} kt"
            prev = s


def test_wind_gate_kill_switch_restores_prior_behaviour():
    prior = _os.environ.get("RATING_WIND_GATE")
    try:
        _os.environ["RATING_WIND_GATE"] = "0"
        assert rating_score(2.0, 16.0, 100 / _KT, 270.0, 270.0, 270.0) == 43.0
        _os.environ["RATING_WIND_GATE"] = "1"
        assert rating_score(2.0, 16.0, 100 / _KT, 270.0, 270.0, 270.0) == 0.0
    finally:
        if prior is None:
            _os.environ.pop("RATING_WIND_GATE", None)
        else:
            _os.environ["RATING_WIND_GATE"] = prior


# ── OVERSIZE VETO (2026-07-29) ───────────────────────────────────────────────────────────────────
# The defect: size_score is monotonic and clamps at 1.0, so 4 / 6 / 12 / 25 / 35 / 100 ft ALL scored
# 97.3 "epic" — a closeout rated identically to a groomed head-high day, at every spot.

def test_oversize_gate_is_inert_where_it_must_be():
    assert oversize_gate(None) == 1.0                       # no height -> no opinion
    assert oversize_gate(0.0) == 1.0
    assert oversize_gate(-1.0) == 1.0
    assert oversize_gate(2.0) == 1.0                        # 6.6 ft: an ordinary good day
    assert oversize_gate(7.9) == 1.0                        # just under the absolute taper
    assert oversize_gate(OVERSIZE_ABS_START_M) == 1.0       # the taper STARTS here, it does not bite
    assert oversize_gate(30.0, enabled=False) == 1.0        # explicit disable, no env read
    # Spot-relative: below 3.5x the local reference it is inert no matter how big in absolute terms.
    assert oversize_gate(8.0, reference_size_m=4.0) == 1.0   # 26 ft at Mavericks: still Mavericks


def test_oversize_gate_tapers_monotonically_and_never_zeroes():
    prev = 1.0
    for h in (8.0, 8.5, 9.0, 10.0, 12.0, 14.0, 20.0, 40.0):
        g = oversize_gate(h)
        assert 0.0 < g <= prev, f"gate rose or hit zero at {h} m: {prev} -> {g}"
        prev = g
    assert oversize_gate(OVERSIZE_ABS_FLOOR_M) == pytest.approx(OVERSIZE_FLOOR)
    # ⚠️ NEVER 0: rating_transform_grid skips cells scoring <= 0, so a zeroing veto would ERASE the
    # coastal rating band from the map on the biggest swells of the year.
    assert oversize_gate(1000.0) == pytest.approx(OVERSIZE_FLOOR)
    assert OVERSIZE_FLOOR > 0.0


def test_oversize_is_spot_relative():
    """Surfline's principle: the same height is a closeout at a beach break and a good day at a
    big-wave spot. 20 ft of surf at a 2.3 ft-good-day beach vs at Mavericks."""
    h = 6.0                                                  # ~19.7 ft of breaking surf
    assert oversize_gate(h, reference_size_m=0.7) == pytest.approx(OVERSIZE_FLOOR)   # Cocoa Beach: closed out
    assert oversize_gate(h, reference_size_m=2.5) == 1.0                             # Pipeline: fine
    assert oversize_gate(h, reference_size_m=4.0) == 1.0                             # Mavericks: fine
    assert oversize_gate(h, reference_size_m=0.7) < oversize_gate(h, reference_size_m=4.0)
    # Tier 2 (bathymetry) must separate them too, with NO climatology at all.
    assert oversize_gate(h, break_depth_m=5.9) < 1.0     # Cocoa Beach reads 5.9 m
    assert oversize_gate(h, break_depth_m=22.1) == 1.0   # Mavericks reads 22.1 m


def test_a_closeout_no_longer_rates_like_a_groomed_head_high_day():
    """THE reported defect, pinned. Clean offshore wind, head-on swell, 14 s."""
    clean = (14.0, 2.0, 90.0, 270.0, 270.0)                  # tp, wind m/s FROM land, head-on swell
    good = compute_surf_rating(1.22, *clean)                 # 4 ft — genuinely epic
    huge = compute_surf_rating(10.8, *clean)                 # 35.5 ft — a closeout
    assert good[1] == "epic"
    assert huge[0] > 0.0                                     # still rendered on the band

    # (a) KNOWING NOTHING about the spot, the claim is only that it is no longer epic. The absolute
    # pair is deliberately late (26 ft) because real big-wave spots — Puerto Escondido-Zicatela,
    # Todos Santos, Dungeons, Mullaghmore, Punta de Lobos, Cloudbreak — carry NO break depth, and
    # crushing them would be a worse error than under-penalising an anonymous closeout.
    assert huge[1] not in ("good", "epic")
    assert huge[0] < good[0] - 25.0, f"35 ft barely moved: {huge} vs {good}"

    # (b) KNOWING the spot, the verdict is decisive in BOTH directions from the same 35.5 ft.
    at_cocoa = compute_surf_rating(10.8, *clean, break_depth_m=5.9)     # closes out ~15 ft
    at_mavericks = compute_surf_rating(10.8, *clean, break_depth_m=22.1)
    assert at_cocoa[0] < good[0] - 60.0 and at_cocoa[1] in ("very_poor", "poor", "poor_fair")
    assert at_mavericks[1] == "epic", "Mavericks crushed on a 35 ft day"
    assert at_mavericks[0] > at_cocoa[0] + 60.0


def test_oversize_leaves_the_user_calibration_anchors_untouched():
    """The 2026-07-12 acceptance spec lives at 2-4 ft; the veto must be PROVABLY inert there."""
    for h, ref in ((0.75, 0.7), (1.05, 0.7), (0.75, 2.5), (0.75, None), (1.05, None)):
        assert oversize_gate(h, reference_size_m=ref) == 1.0


def test_oversize_kill_switch_restores_prior_behaviour():
    clean = (14.0, 2.0, 90.0, 270.0, 270.0)
    prior = _os.environ.get("RATING_OVERSIZE")
    try:
        _os.environ["RATING_OVERSIZE"] = "0"
        # Byte-identical to the pre-fix engine: every size at/above saturation collapses to one score.
        assert compute_surf_rating(1.22, *clean)[0] == compute_surf_rating(10.8, *clean)[0]
        _os.environ["RATING_OVERSIZE"] = "1"
        assert compute_surf_rating(1.22, *clean)[0] > compute_surf_rating(10.8, *clean)[0]
    finally:
        if prior is None:
            _os.environ.pop("RATING_OVERSIZE", None)
        else:
            _os.environ["RATING_OVERSIZE"] = prior


def test_oversize_does_not_disturb_the_live_catalogue_range():
    """Measured 2026-07-28 against production /spot-ratings: 428 spots, 6 regions, max 3.73 m. The
    absolute taper starts at 6.0 m, so it is inert across the entire observed live range."""
    for h_cm in range(20, 500, 5):
        assert oversize_gate(h_cm / 100.0) == 1.0


# ── TIER 2: BATHYMETRIC CAPACITY — "big wave surf spots are for big wave surfers" (owner) ─────────

def test_oversize_gamma_mirrors_the_transform():
    """OVERSIZE_GAMMA is a COPY of surf_transform.GAMMA (surf_rating cannot import it at module
    level — rating_transform_grid imports surf_transform lazily to avoid the cycle). Pin them so the
    two constants cannot silently drift apart."""
    from services.weather_pipeline.surf_transform import GAMMA
    assert OVERSIZE_GAMMA == GAMMA


def test_break_depth_gives_a_big_wave_spot_its_own_ceiling():
    """THE owner's point, pinned with the REAL measured break depths (2026-07-29, ETOPO asset).
    A single absolute ceiling knocked Mavericks out of 'epic' at 24.7 ft — the day it exists for."""
    mavericks, cocoa = 22.1, 5.9                     # metres, measured
    h = 7.5                                          # ~24.6 ft of breaking surf
    assert oversize_gate(h, break_depth_m=mavericks) == 1.0, "Mavericks crushed at 24.6 ft"
    assert oversize_gate(h, break_depth_m=cocoa) == pytest.approx(OVERSIZE_FLOOR)
    # And the ordering must hold across the measured ladder, deepest = most capacity.
    depths = [("Cocoa Beach", 5.9), ("Jeffreys", 9.0), ("Uluwatu", 9.5), ("Pipeline", 11.1),
              ("Waimea", 11.9), ("Nazare-Norte", 21.0), ("Mavericks", 22.1), ("Jaws", 24.5)]
    starts = [oversize_thresholds(None, d)[0] for _, d in depths]
    assert starts == sorted(starts), f"capacity ladder not monotonic in depth: {list(zip(depths, starts))}"


def test_absurd_break_depth_fails_open_instead_of_inventing_capacity():
    """A 15 arc-second grid cannot resolve a reef pass: Teahupo'o samples the deep water outside it
    and reads 273 m. Unbounded that is a 699 ft 'capacity'. The clamp must make it finite — and the
    failure direction must be OPEN (a bad reading never crushes a spot)."""
    start_teahupoo, _ = oversize_thresholds(None, 273.0)
    start_clamped, _ = oversize_thresholds(None, OVERSIZE_MAX_BREAK_DEPTH_M)
    assert start_teahupoo == start_clamped
    assert start_teahupoo < 20.0                      # finite, not 213 m
    for bad in (1e6, float("inf")):
        s, f = oversize_thresholds(None, bad)
        assert s == start_clamped and f > s


def test_shallow_or_wrong_depth_cannot_crush_an_ordinary_day():
    """The floor on the depth tier: a 1 m depth reading must not declare a 5 ft day 'too big'."""
    for shallow in (0.3, 1.0, 2.0, 4.0):
        start, _ = oversize_thresholds(None, shallow)
        assert start >= OVERSIZE_MIN_START_M
    assert oversize_gate(1.5, break_depth_m=0.5) == 1.0    # ~5 ft on a junk depth -> untouched
    assert oversize_gate(1.5, break_depth_m=None) == 1.0


def test_capacity_tier_order_climatology_beats_bathymetry_beats_absolute():
    """Tier precedence, and that each falls through when absent."""
    # Climatology present -> bathymetry ignored.
    assert oversize_thresholds(0.7, 22.1) == (0.7 * 3.5, 0.7 * 6.0)
    # No climatology -> bathymetry used.
    assert oversize_thresholds(None, 22.1)[0] > OVERSIZE_ABS_START_M
    # Neither -> the absolute pair.
    assert oversize_thresholds(None, None) == (OVERSIZE_ABS_START_M, OVERSIZE_ABS_FLOOR_M)


def test_break_depth_threads_through_the_public_composite():
    """A wiring pin: the parameter must actually reach the gate from compute_surf_rating, and it is
    appended LAST so every existing positional call site is unaffected."""
    clean = (14.0, 2.0, 90.0, 270.0, 270.0)
    deep = compute_surf_rating(7.5, *clean, break_depth_m=22.1)      # Mavericks
    shallow = compute_surf_rating(7.5, *clean, break_depth_m=5.9)    # Cocoa Beach
    assert deep[0] > shallow[0]
    assert deep[1] == "epic" and shallow[1] not in ("good", "epic")
    # Positional back-compat: the pre-existing 10-positional-arg form still means what it meant.
    assert compute_surf_rating(1.5, 14.0, 2.0, 90.0, 270.0, 270.0, None, None, None, None) == \
           compute_surf_rating(1.5, *clean)

"""Unit tests for the multivariable surf-quality rating (surf_rating.py)."""
import pytest
from services.weather_pipeline.surf_rating import (
    compute_surf_rating, rating_score, size_score, period_quality,
    wind_quality, offshoreness, swell_exposure, score_to_level, LEVELS,
    parse_best_tide, tide_fit, breaker_type_quality,
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


def test_partition_secondary_swell_recovered_when_dominant_shadowed():
    """A total-field direction of the SHADOWED dominant swell under-rates; per-partition exposure credits
    the well-angled secondary train."""
    args = (1.5, 11.0, 2.0, 90.0, 270.0, 90.0)               # total dir = the blocked train
    parts = [{"h": 2.0, "tp": 14.0, "dir": 90.0, "kind": "swell"},
             {"h": 1.0, "tp": 10.0, "dir": 270.0, "kind": "swell"}]
    assert rating_score(*args, partitions=parts) > rating_score(*args)

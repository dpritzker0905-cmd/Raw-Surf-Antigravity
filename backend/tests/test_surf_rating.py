"""Unit tests for the multivariable surf-quality rating (surf_rating.py)."""
from services.weather_pipeline.surf_rating import (
    compute_surf_rating, rating_score, size_score, period_quality,
    wind_quality, offshoreness, score_to_level, LEVELS,
)


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

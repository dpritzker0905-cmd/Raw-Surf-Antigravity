"""Ensemble spread is a CONFIDENCE axis. The score must not move — that is the whole contract.

Uncertainty is not quality. A high-spread 6 ft is the same wave as a low-spread 6 ft, forecast less
confidently. Folding spread into the 0-100 would make a groomed swell score lower merely for being
five days out — a rating measuring the calendar rather than the surf.

★ THE REPO REACHED THIS VERDICT TWICE ALREADY: `RATING_LOCAL_SIZE` was rejected as a score
multiplier (it inverts ordering: 1.39 m -> `poor`, 0.42 m -> `fair_good`) in favour of a separate
rarity axis; and the rating payload already carries `confidence` (grades the PIN) and
`geometry_readiness` (grades the INPUTS) as explicitly different things. This is a third, orthogonal
question and gets a third field.
"""
import os

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

from services.weather_pipeline.forecast_spread import (          # noqa: E402
    confidence_level, describe, relative_spread)


# ── the refusal contract ────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("spread,height", [
    (None, 2.0), (0.2, None), (None, None),
    (float("nan"), 2.0), (0.2, float("nan")),
    (-0.1, 2.0),
])
def test_unanswerable_inputs_return_None_never_zero(spread, height):
    """0.0 would read as 'the members agree perfectly' — the most confident answer the scale can
    express — when the truth is that nothing was sampled."""
    assert relative_spread(spread, height) is None
    assert confidence_level(spread, height) is None
    assert describe(spread, height) is None


def test_zero_height_is_refused_not_divided():
    """Flat water with 0.2 m of disagreement is 100% uncertain, not 0% — and not infinite either.
    An undefined ratio must be refused rather than produced."""
    assert relative_spread(0.2, 0.0) is None
    assert confidence_level(0.2, 0.0) is None


def test_absence_means_no_ensemble_not_low_confidence():
    """Every deterministic product has no spread. If absence rendered as 'low', this would libel
    every GFS and ICON forecast in the system."""
    assert confidence_level(None, 3.0) is None, "absent must stay absent, never degrade to a level"
    assert describe(None, 3.0) is None


# ── the levels ──────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("spread,height,expect", [
    (0.10, 2.0, "high"),        # 5%
    (0.30, 2.0, "high"),        # 15% — on the boundary, inclusive
    (0.50, 2.0, "moderate"),    # 25%
    (0.70, 2.0, "low"),         # 35% — on the boundary, inclusive
    (1.40, 2.0, "low"),         # 70%
])
def test_levels_follow_relative_not_absolute_spread(spread, height, expect):
    """0.5 m of disagreement is huge on a 1 m sea and modest on a 5 m one. Grading the ABSOLUTE
    spread would call every big-swell forecast uncertain and every small one confident."""
    assert confidence_level(spread, height) == expect


def test_the_same_absolute_spread_grades_differently_by_height():
    assert confidence_level(0.5, 1.0) == "low"       # 50% of the sea
    assert confidence_level(0.5, 5.0) == "high"      # 10% of the sea


def test_the_payload_states_that_it_is_uncalibrated():
    """Nothing here has been scored against buoys or against the served forecast's own error. A
    consumer must be able to tell a legible number from a validated one WITHOUT reading this file."""
    d = describe(0.5, 2.0)
    assert d["calibrated"] is False
    assert d["basis"] == "ecmwf_waef_member_spread"
    assert "does not change the rating" in d["means"]


def test_the_kill_switch_silences_it(monkeypatch):
    monkeypatch.setenv("FORECAST_SPREAD_CONFIDENCE", "0")
    assert confidence_level(0.5, 2.0) is None
    assert describe(0.5, 2.0) is None


# ── THE CONTRACT THAT MATTERS: the score does not move ──────────────────────────────────────────

def test_the_rating_score_is_IDENTICAL_regardless_of_spread():
    """THE point of this whole module. compute_surf_rating takes no spread argument and must not —
    this asserts the rating chain is structurally incapable of being moved by it."""
    from services.weather_pipeline.surf_rating import compute_surf_rating
    import inspect

    params = set(inspect.signature(compute_surf_rating).parameters)
    for forbidden in ("spread", "spread_m", "speed_spread", "forecast_confidence", "ensemble"):
        assert forbidden not in params, (
            f"compute_surf_rating grew a `{forbidden}` parameter — uncertainty is being folded into "
            "quality, so a groomed swell now scores lower merely for being further out")

    a = compute_surf_rating(1.5, 12.0, 5.0, wind_from_deg=100.0, shore_normal_deg=280.0,
                            swell_from_deg=280.0)
    b = compute_surf_rating(1.5, 12.0, 5.0, wind_from_deg=100.0, shore_normal_deg=280.0,
                            swell_from_deg=280.0)
    assert a == b


def test_rate_one_spot_omits_the_block_entirely_when_there_is_no_ensemble():
    """ABSENT, not null — mirroring `directional_conflict`. A field present on every spot with a
    null value is a caveat nobody reads and bytes everybody downloads."""
    import ast
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "services", "weather_pipeline", "spot_ratings.py")
    src = open(p, encoding="utf-8").read()
    assert '**({"forecast_confidence": _fc} if _fc else {})' in src, (
        "the block is no longer conditionally spread into the payload — it will now appear as null "
        "on every deterministic spot")
    ast.parse(src)


def test_the_spread_is_paired_with_the_OFFSHORE_height():
    """⚠️ marine `point.speed` IS the offshore significant wave height, not the breaking height.
    Pairing the spread with the breaking height would inflate the ratio by whatever the nearshore
    transform did — the repo's loudest recorded landmine, in a new place."""
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "services", "weather_pipeline", "spot_ratings.py")
    src = open(p, encoding="utf-8").read()
    assert 'offshore_h = getattr(marine.point, "speed", None)' in src
    assert "_spread_describe(spread_m, offshore_h)" in src, (
        "the spread is no longer paired with the offshore height it was measured against")
    assert "_spread_describe(spread_m, surf_h)" not in src, (
        "the spread is being divided by the BREAKING height — that ratio is inflated by the "
        "nearshore transform and means nothing")

"""THE FORECAST MUST SAY HOW MUCH THE MODELS DISAGREE — and must refuse to when it cannot know.

Guards `rating_confirmation.model_agreement`, that `apply_gate_to_frames` STAMPS it, and that it
SURVIVES `SpotRatingItem` — three separate things, and this repo has shipped a field that passed the
first two and was dropped by the third ("declaring a field is not surviving `response_model`").

⭐ THE LOAD-BEARING BEHAVIOUR IS THE REFUSAL. With one model there is no spread. Publishing 0.0
would render as PERFECT AGREEMENT on exactly the spots where a peer frame is missing — the inverse
of the truth, and the same shape as the bug that had the obs gate capping 59.9% of good/epic for
want of a peer. `None` is the only honest answer, and it is tested at every layer.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline.rating_confirmation import (          # noqa: E402
    AGREEMENT_MODERATE_MAX, AGREEMENT_TIGHT_MAX, apply_gate_to_frames, model_agreement,
)


# ── the statistic ───────────────────────────────────────────────────────────────────────────────

def test_three_models_report_spread_median_and_band():
    a = model_agreement({"GFS": 90.2, "ICON": 72.4, "EURO": 5.6})   # measured at Majestics
    assert a["n_models"] == 3
    assert a["spread"] == pytest.approx(84.6)
    assert a["median"] == pytest.approx(72.4)
    assert a["min"] == pytest.approx(5.6) and a["max"] == pytest.approx(90.2)
    assert a["agreement"] == "wide"


def test_two_models_are_enough():
    a = model_agreement({"GFS": 71.0, "EURO": 68.6})
    assert a["n_models"] == 2 and a["spread"] == pytest.approx(2.4)
    assert a["median"] == pytest.approx(69.8)          # even count -> midpoint
    assert a["agreement"] == "tight"


@pytest.mark.parametrize("scores", [
    {"GFS": 50.0},                       # one lane
    {"GFS": 50.0, "ICON": None},         # a peer that did not score
    {"GFS": None, "ICON": None},
    {},
    None,
])
def test_fewer_than_two_members_REFUSES_rather_than_reporting_zero_spread(scores):
    """The whole point. 0.0 spread from one lane would read as unanimity."""
    assert model_agreement(scores) is None


def test_bands_sit_exactly_on_the_measured_population_boundaries():
    """`tight` is the measured median (10.2) and `wide` begins past the measured p90 (25.7),
    n=725 spots, 2026-08-04. Boundaries are inclusive on the lower band."""
    assert model_agreement({"a": 0.0, "b": AGREEMENT_TIGHT_MAX})["agreement"] == "tight"
    assert model_agreement({"a": 0.0, "b": AGREEMENT_TIGHT_MAX + 0.1})["agreement"] == "moderate"
    assert model_agreement({"a": 0.0, "b": AGREEMENT_MODERATE_MAX})["agreement"] == "moderate"
    assert model_agreement({"a": 0.0, "b": AGREEMENT_MODERATE_MAX + 0.1})["agreement"] == "wide"


def test_identical_models_are_tight_with_zero_spread():
    """The known-good control: real unanimity DOES report 0.0 — which is why the one-member case
    must not, or the two are indistinguishable."""
    a = model_agreement({"GFS": 60.0, "ICON": 60.0, "EURO": 60.0})
    assert a["spread"] == 0.0 and a["agreement"] == "tight" and a["n_models"] == 3


# ── reachability: does the precompute actually stamp it? ────────────────────────────────────────

def _frames():
    """Two models at the same hour for spot A; spot B is served by ONE model only."""
    return [
        {"model": "GFS", "valid_time": "2026-08-04T15:00:00Z", "spots": [
            {"spot_id": "A", "score": 90.2}, {"spot_id": "B", "score": 40.0}]},
        {"model": "ICON", "valid_time": "2026-08-04T15:00:00Z", "spots": [
            {"spot_id": "A", "score": 72.4}]},
    ]


def test_apply_gate_to_frames_stamps_model_agreement():
    frames = _frames()
    apply_gate_to_frames(frames, reports_by_spot={})
    a = frames[0]["spots"][0]
    assert a["spot_id"] == "A"
    assert a["model_agreement"] is not None, "the gate judged these two lanes and published nothing"
    assert a["model_agreement"]["n_models"] == 2
    assert a["model_agreement"]["spread"] == pytest.approx(17.8)
    assert a["model_agreement"]["agreement"] == "moderate"


def test_a_spot_with_one_lane_gets_None_not_a_fake_unanimity():
    frames = _frames()
    apply_gate_to_frames(frames, reports_by_spot={})
    b = frames[0]["spots"][1]
    assert b["spot_id"] == "B"
    assert b["model_agreement"] is None


def test_stamping_is_stable_when_the_gate_is_re_applied():
    """The precompute re-gates at every checkpoint; a second pass must not change the answer."""
    frames = _frames()
    apply_gate_to_frames(frames, reports_by_spot={})
    first = dict(frames[0]["spots"][0]["model_agreement"])
    apply_gate_to_frames(frames, reports_by_spot={})
    assert frames[0]["spots"][0]["model_agreement"] == first


# ── ⭐ SERIALIZATION: declaring a field is not the same as it reaching the client ────────────────

def test_model_agreement_survives_the_response_model():
    """`SpotRatingItem` is a strict pydantic model and the route builds items with
    `SpotRatingItem(**sp)` — pydantic DROPS undeclared keys silently, so a field stamped by the
    precompute can be computed correctly and never reach anyone. That is a shipped-inert defect this
    repo has had before, and only this assertion catches it."""
    from routes.weather import SpotRatingItem

    payload = {
        "spot_id": "A", "latitude": 1.0, "longitude": 2.0, "score": 69.9,
        "model_agreement": {"n_models": 3, "spread": 84.6, "median": 72.4,
                            "min": 5.6, "max": 90.2, "agreement": "wide"},
    }
    item = SpotRatingItem(**payload)
    assert item.model_agreement is not None, "the field was dropped by the response model"
    assert item.model_agreement["agreement"] == "wide"
    assert item.model_dump()["model_agreement"]["spread"] == pytest.approx(84.6)


def test_an_older_frame_without_the_field_still_deserialises():
    """Optional, so a precomputed blob written before this change must not 500 the endpoint."""
    from routes.weather import SpotRatingItem

    item = SpotRatingItem(spot_id="A", latitude=1.0, longitude=2.0, score=50.0)
    assert item.model_agreement is None


def test_the_field_is_not_confused_with_pin_confidence():
    """`confidence` grades the PIN (accuracy_flag/is_verified_peak); this grades the FORECAST. They
    must not share a vocabulary, or a reader cannot tell which is which."""
    from routes.weather import SpotRatingItem

    item = SpotRatingItem(spot_id="A", latitude=1.0, longitude=2.0, confidence="high",
                          model_agreement={"n_models": 3, "spread": 84.6, "median": 72.4,
                                           "min": 5.6, "max": 90.2, "agreement": "wide"})
    assert item.confidence == "high"
    assert item.model_agreement["agreement"] == "wide"
    assert item.model_agreement["agreement"] not in ("low", "medium", "high")

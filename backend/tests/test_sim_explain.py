"""WHY is it that score?

`services/weather_pipeline/sim_explain.py`. Born from a real owner question on 2026-07-29 —
*"offshore wind on the FL east coast early next week and waves, but only poor to fair on the
glyphs"* — which took twenty minutes of bespoke scripting against the engine internals to answer,
and about four seconds of reading once the nine factors were on screen. The answer was that the
period was 7.4-7.9 s and the surf 2-3 ft, which NDBC buoys confirmed; the rating was right.

The properties that must not quietly break:
  1. The explanation must RECONSTRUCT the engine's own score. If it ever drifts it must SAY so,
     because a breakdown that describes a different composition is worse than none (CLAUDE.md:
     ONE FORECAST COMPOSITION).
  2. It must never change a score, and never raise.
  3. The LIMITER must be the factor actually holding the score down — that is the whole product.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import sim_explain, sim_rating          # noqa: E402
from services.weather_pipeline.surf_rating import (                    # noqa: E402
    MS_TO_KT, rating_score, wind_quality,
)

# The measured FL east-coast case from 2026-08-03, Sebastian Inlet: 2.9 ft of 7.9 s wind swell,
# 4 kt offshore. Scored 53.6 "fair" — on the owner's own anchor (FL 2-3 ft clean = fair).
FL = dict(surf_h_m=0.884, tp_s=7.9, wind_speed_knots=3.9, wind_from_deg=280.0,
          shore_normal_deg=76.0, swell_from_deg=85.0)


def test_the_explanation_reconstructs_the_engine_score():
    """THE honesty property. Same inputs, same public factor functions, same product."""
    # The engine's OWN constant — not a literal. A hardcoded 1.94384 here is the very divergence
    # this file's boundary test below exists to catch, and it would hide it at the fixture level.
    engine = rating_score(FL["surf_h_m"], FL["tp_s"], FL["wind_speed_knots"] / MS_TO_KT,
                          wind_from_deg=FL["wind_from_deg"],
                          shore_normal_deg=FL["shore_normal_deg"],
                          swell_from_deg=FL["swell_from_deg"])
    exp = sim_explain.explain(engine_score=engine, **FL)
    assert exp["score"] == pytest.approx(engine, abs=0.15)
    assert abs(exp["reconstruction_error"]) <= 0.15
    assert "warning" not in exp


def test_a_drifted_reconstruction_WARNS_instead_of_lying():
    """If the factor list ever misses something the engine applies, the breakdown must say the
    engine is authoritative — not quietly present a second opinion."""
    exp = sim_explain.explain(engine_score=99.0, **FL)
    assert "warning" in exp
    assert "trust the engine" in exp["warning"]
    assert exp["reconstruction_error"] != 0


@pytest.mark.parametrize("wind_kt", [6.0, 12.0, 20.0, 30.0])
def test_the_reconstruction_is_EXACT_on_the_speed_only_wind_tier_boundaries(wind_kt):
    """The knots constant must be the ENGINE's, and the boundaries are the only place it shows.

    Regression for the 2026-07-30 measurement: `sim_explain` carried its own `MS_TO_KT = 1.94384`
    against the engine's 1.943844. `sim_rating` converts the caller's knots with the ENGINE's
    constant, so the engine's round-trip lands EXACTLY on `wind_quality`'s speed-only tier edges
    (`<= 6.0 / 12.0 / 20.0 / 30.0 kt`, taken whenever `shore_normal_deg` is None). The short
    constant round-tripped to 6.000012346695201 kt — strictly greater — so the breakdown read a
    full tier low (0.65 vs 0.85), reconstructed 11-12 points under a CORRECT engine score, and
    fired the "trust the engine's score, not this breakdown" warning at the reader.

    ★ THE BOUNDARY IS THE INSTRUMENT. At 7.3 kt the error was 0.0 and every existing test passed —
    a near-zero error away from the tier edge is exactly what let this survive. `abs(err) <= 0.15`
    would ALSO pass here on a correct build; assert EXACT so a re-divergence cannot hide in the
    tolerance.
    """
    kwargs = dict(surf_h_m=1.2, tp_s=12.0, wind_speed_knots=wind_kt, shore_normal_deg=None)
    engine = rating_score(kwargs["surf_h_m"], kwargs["tp_s"], wind_kt / MS_TO_KT,
                          shore_normal_deg=None)
    exp = sim_explain.explain(engine_score=engine, **kwargs)

    assert exp["reconstruction_error"] == 0.0, (
        f"{wind_kt} kt: engine {engine} vs reconstruction {exp['score']} — the breakdown is "
        f"describing a different composition than the score it annotates")
    assert "warning" not in exp, "the honesty warning fired on a correct engine score"
    # The factor that actually moved: the breakdown must report the SAME wind tier the engine read.
    assert exp["blend"]["wind_quality"] == pytest.approx(
        wind_quality(wind_kt / MS_TO_KT), abs=1e-9)


def test_the_limiter_is_the_factor_actually_holding_the_score_down():
    """Short period is the classic FL suppressor: a 3 s ripple must be limited by period_gate."""
    exp = sim_explain.explain(surf_h_m=0.9, tp_s=3.0, wind_speed_knots=4.0,
                              wind_from_deg=280.0, shore_normal_deg=76.0, swell_from_deg=85.0)
    assert exp["limiting_factor"]["factor"] == "period_gate"
    assert exp["limiting_factor"]["value"] < 0.5


def test_an_onshore_gale_is_limited_by_the_wind_gate():
    exp = sim_explain.explain(surf_h_m=1.2, tp_s=12.0, wind_speed_knots=35.0,
                              wind_from_deg=76.0, shore_normal_deg=76.0, swell_from_deg=85.0)
    assert exp["limiting_factor"]["factor"] == "wind_gate"


def test_a_small_day_is_limited_by_size():
    exp = sim_explain.explain(surf_h_m=0.35, tp_s=12.0, wind_speed_knots=3.0,
                              wind_from_deg=280.0, shore_normal_deg=76.0, swell_from_deg=76.0)
    assert exp["limiting_factor"]["factor"] == "size_gate"


def test_a_clean_day_with_nothing_vetoing_names_the_blend_not_a_false_veto():
    """Every multiplier at 1.0 means nothing is limiting; calling one of them 'the limiter' would
    invent a problem. The honest answer is that the blend is the ceiling."""
    exp = sim_explain.explain(surf_h_m=1.6, tp_s=14.0, wind_speed_knots=3.0,
                              wind_from_deg=256.0, shore_normal_deg=76.0, swell_from_deg=76.0)
    assert exp["limiting_factor"]["factor"] == "wind_and_period_blend"
    assert "nothing is vetoing" in exp["limiting_factor"]["means"]


def test_the_actionable_number_is_reported():
    """'Fix that one factor and it would score X' is what makes the limiter useful."""
    exp = sim_explain.explain(surf_h_m=0.9, tp_s=3.0, wind_speed_knots=4.0,
                              wind_from_deg=280.0, shore_normal_deg=76.0, swell_from_deg=85.0)
    lim = exp["limiting_factor"]
    assert lim["score_if_this_were_1_0"] > exp["score"]


def test_it_never_raises_on_nonsense():
    """An explanation must not be able to break the answer it annotates."""
    for bad in ({"surf_h_m": None, "tp_s": 10.0, "wind_speed_knots": 5.0},
                {"surf_h_m": 1.0, "tp_s": None, "wind_speed_knots": 5.0},
                {"surf_h_m": 1.0, "tp_s": 10.0, "wind_speed_knots": "x"}):
        out = sim_explain.explain(**bad)
        assert isinstance(out, dict)


def test_the_kill_switch_makes_it_inert(monkeypatch):
    monkeypatch.setenv("SIM_EXPLAIN", "0")
    assert sim_explain.explain(**FL) == {}


# ── wiring into the sim's payload ───────────────────────────────────────────────────────────────

SPOT = {"name": "Sebastian Inlet", "latitude": 27.8608, "longitude": -80.4464,
        "orientation": 76.0}


def test_the_sim_payload_carries_why_and_it_matches_quality_rating():
    calc = sim_rating.calculate_surf_rating(SPOT, 0.5, 7.9, 85.0, 3.9, 280.0)
    assert "why" in calc and "why_summary" in calc
    # ⚠️ `explain()` catches broadly so it can never break the answer it annotates — which is the
    # exact shape of `8ce65c95`, where a broad `except Exception` swallowed a NameError and left the
    # surf transform silently OFF while every response still validated. Assert the ERROR PATH is not
    # the one being exercised, or a typo inside explain() would ship as a quietly missing breakdown.
    assert "error" not in calc["why"], f"explain() fell into its own except: {calc['why']}"
    assert calc["why"]["score"] == pytest.approx(calc["quality_rating"], abs=0.15)
    assert "warning" not in calc["why"], "the payload's own breakdown disagrees with its score"


def test_the_explanation_does_not_change_the_score(monkeypatch):
    """Read-only: turning it off must leave every other field byte-identical."""
    on = sim_rating.calculate_surf_rating(SPOT, 0.5, 7.9, 85.0, 3.9, 280.0)
    monkeypatch.setenv("SIM_EXPLAIN", "0")
    off = sim_rating.calculate_surf_rating(SPOT, 0.5, 7.9, 85.0, 3.9, 280.0)
    assert "why" not in off
    for key in off:
        assert on[key] == off[key], f"{key} changed when the explanation was enabled"

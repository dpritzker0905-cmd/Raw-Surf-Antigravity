"""THE OWNER'S CALIBRATION ANCHORS — the acceptance spec for the surf rating.

These are not derived from physics. They are the product owner's stated judgements about what a
given day at a given coast should READ AS, and any change to the rating must keep them green.

    2026-07-12  "FL 2-3 ft clean = FAIR"
                "the same small day at a big-wave coast = poor-class"
    2026-07-29  "Maybe a clean offshore 3-4ft could read fair-good or good."
    2026-07-29  "I wouldn't say 4ft @ 9 sec is epic. We need pumping 6-8ft or 8-10ft
                 surf in FL to be EPIC."

★★★ THE RESULT THIS FILE EXISTS TO PIN. Solved with `backend/scripts/calibration_solver.py`
(2026-07-29): a size reference in **R_FL ∈ [0.65, 0.85] m** satisfies ALL FIVE Florida anchors
simultaneously, and the big-wave counter-anchor passes at its own R = 2.5 m. The GLOBAL 1.2 m
reference does NOT — it scores a 4 ft Florida day at exactly 84.0, the first value in the `epic`
bucket, which is precisely the owner's complaint.

⇒ **`RATING_LOCAL_SIZE` is what makes these anchors green.** It has been built and gated since
`95c5f04a` (2026-07-11) and the climatology blob it needs has been live and refreshing 6x/day the
whole time. This file is the proof that flipping it is the right call, expressed so it cannot rot.

⚠️ UNITS. Feet here are the number the APP DISPLAYS. Today that is a significant breaking height;
the published surf-forecasting standard is H1/10 (see docs/research/SURF-FORECASTING-SCIENCE.md §1).
If that convention is ever corrected, these anchors do NOT change — the REFERENCE moves with it
(the solver reports R_FL ∈ [0.50, 0.65] under H1/10, exactly the same window / 1.27). The
climatology derives R from the same heights the engine emits, so it self-corrects.

⚠️ These are CLEAN-CONDITION anchors: light dead-offshore wind, head-on swell. Every gate is 1.0 so
the composite reduces to size x blend. A day with real wind or angle scores lower, correctly.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline.surf_rating import (           # noqa: E402
    compute_surf_rating, score_to_level,
)

FT = 0.3048
# Clean: 2 m/s (~4 kt) wind FROM 270 at a shore facing 90 = dead offshore; swell FROM 90 = head-on.
# ⚠️ swell_from must EQUAL the shore normal for head-on — passing the opposite bearing floors
# swell_exposure at 0.10 and silently makes every number in this file ~10x too small.
WIND_MS, WIND_FROM, SHORE_NORMAL, SWELL_FROM = 2.0, 270.0, 90.0, 90.0

FL_REF = 0.75        # inside the solved feasible window [0.65, 0.85]; the climatology's FL p80
BIG_WAVE_REF = 2.5   # Pipeline-class p80


def rate(ft, tp, ref):
    return compute_surf_rating(ft * FT, tp, WIND_MS, WIND_FROM, SHORE_NORMAL, SWELL_FROM,
                               reference_size_m=ref)


# ── THE ANCHORS, AT A LOCAL FLORIDA REFERENCE (what RATING_LOCAL_SIZE will supply) ───────────────

@pytest.mark.parametrize("label,ft,tp,allowed", [
    ("FL 2-3 ft clean = FAIR",            2.5,  9.0, {"fair"}),
    ("FL 3-4 ft clean = fair_good/good",  3.5,  9.0, {"fair_good", "good"}),
    ("FL 4 ft @ 9 s is NOT epic",         4.0,  9.0, {"fair", "fair_good", "good"}),
    ("FL 6-8 ft pumping = EPIC",          7.0, 11.0, {"epic"}),
    ("FL 8-10 ft pumping = EPIC",         9.0, 12.0, {"epic"}),
])
def test_florida_anchors_at_a_local_reference(label, ft, tp, allowed):
    score, level = rate(ft, tp, FL_REF)
    assert level in allowed, (
        f"{label}: {ft} ft @ {tp} s at R={FL_REF} scored {score} = {level}, "
        f"owner expects one of {sorted(allowed)}")


def test_the_big_wave_counter_anchor():
    """The same small day at a big-wave coast must NOT read well — the anchor that stops local
    calibration from simply being 'be nicer to everyone'."""
    score, level = rate(2.5, 14.0, BIG_WAVE_REF)
    assert level in {"very_poor", "poor", "poor_fair"}, (
        f"2.5 ft at a big-wave spot scored {score} = {level}; must be poor-class")


def test_the_anchors_are_monotonic_in_size():
    """Bigger surf, same period and conditions, must never score lower. A curve retune that breaks
    this is broken regardless of where the anchors land."""
    scores = [rate(ft, 9.0, FL_REF)[0] for ft in (2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 8.0)]
    assert scores == sorted(scores), f"size monotonicity violated: {scores}"


# ── WHY THE GLOBAL REFERENCE IS NOT ENOUGH — the owner's complaint, pinned ───────────────────────

def test_CHARACTERISATION_the_global_reference_calls_a_4ft_florida_day_epic():
    """⛔ THE OWNER'S COMPLAINT, as an executable fact.

    "I wouldn't say 4ft @ 9 sec is epic." On the global 1.2 m reference it scores exactly 84.0 —
    the FIRST value in the `epic` bucket — because `size_score` has already saturated at 1.2 m
    (~3.9 ft), so a 4 ft day gets full size credit and the blend alone decides the level.

    Replace this test when RATING_LOCAL_SIZE ships; it is the before-picture, not a spec."""
    score, level = rate(4.0, 9.0, None)
    assert level == "epic" and score == pytest.approx(84.0, abs=0.2), (
        f"global reference now gives {score} {level} for 4 ft @ 9 s — if that was intentional, "
        f"replace this characterisation test")


def test_a_local_reference_fixes_it_without_breaking_the_small_end():
    """The pair that matters: the same change must pull 4 ft OUT of epic and leave 2-3 ft at fair."""
    _, four_global = rate(4.0, 9.0, None)
    _, four_local = rate(4.0, 9.0, FL_REF)
    _, small_local = rate(2.5, 9.0, FL_REF)
    assert four_global == "epic" and four_local != "epic"
    assert small_local == "fair", f"the small-end anchor regressed to {small_local}"


# ── THE STRUCTURAL FACT THE SOLVER SURFACED ─────────────────────────────────────────────────────

def test_epic_is_unreachable_below_9s_at_any_size():
    """★ A property of the functional form, not of tuning: score <= 100 x blend(Tp), and the blend
    is 0.60*wind + 0.40*period_quality. With PERFECT wind and ANY size, a short-period sea cannot
    reach `epic`. This is why the owner's epic anchors are pinned at 11-12 s — a 6-8 ft Florida day
    is a hurricane/nor'easter swell, not a 9 s windswell.

    If someone later re-weights W_WIND/W_PERIOD or retunes period_quality, this test says out loud
    what that changes."""
    for tp in (5.0, 6.0, 7.0, 8.0):
        best_possible = max(rate(ft, tp, FL_REF)[0] for ft in (4, 6, 8, 10, 15, 20))
        assert score_to_level(best_possible) != "epic", (
            f"Tp {tp} s can now reach epic (best {best_possible}) — the blend ceiling moved")
    # ...and at a genuine groundswell period it is reachable, so this is a ceiling not a wall.
    assert score_to_level(max(rate(ft, 12.0, FL_REF)[0] for ft in (6, 8, 10))) == "epic"

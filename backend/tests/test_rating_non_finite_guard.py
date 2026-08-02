"""A non-finite score must never render as a rating — least of all as the TOP one.

THE FAILURE DIRECTION IS THE WHOLE POINT
----------------------------------------
`score_to_level` maps by `score < upper` over six ascending buckets. NaN is never `<` anything, so
a NaN score falls past ALL of them into the open-ended top bucket and renders **'epic'** — the
maximum possible error on a 0-100 scale, produced by an ABSENT input. A surfer is told the best
conditions of the year because a number was missing.

Measured at HEAD before this guard, TWO input paths reached it:

    rating_score(surf_h_m=NaN, 14, 5)  -> nan -> 'epic'
    rating_score(1.5, tp_s=NaN, 5)     -> nan -> 'epic'      (survives size_score, poisons period_quality)

★★ THE TWO NON-FINITE SHAPES FAIL IN OPPOSITE DIRECTIONS, which is why the obvious guards miss:
      NaN  defeats `not x` AND `x <= 0` (self-inequality is the only cheap catch) -> reads 'epic'
      inf  is BOUNDED here by the multiplicative gates -> reads 'poor', not a leak
So a positivity check would not have caught NaN, and a self-inequality check alone would not be a
complete statement about non-finiteness. `math.isfinite` is the guard; both shapes are asserted
below so a future "simplification" to one of the weaker forms fails.

★ THE INVARIANT LIVES WHERE EVERY PATH PASSES. Today `estimate_surf`'s `Hs_m != Hs_m` guard and the
sim's input validator both hold, so this was LATENT — but that is exactly the distributed-guard
shape the 2026-07-19 wind lesson says leaks, and a new caller is how it comes back. The guard is
therefore in `rating_score` (the producer) AND `score_to_level` (the terminal mapper every surface
ends at: map band, hub, sim, live route, precompute).
"""
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.surf_rating import (  # noqa: E402
    compute_surf_rating, rating_score, score_to_level,
)

NAN = float("nan")
INF = float("inf")


# ── THE LEAK, both paths ────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("label,args", [
    ("surf height", (NAN, 14.0, 5.0)),
    ("period", (1.5, NAN, 5.0)),
])
def test_a_nan_input_never_produces_a_score_at_all(label, args):
    score = rating_score(*args)
    assert score is None, f"{label}=NaN produced {score!r}; None is the established sentinel"


@pytest.mark.parametrize("label,args", [
    ("surf height", (NAN, 14.0, 5.0)),
    ("period", (1.5, NAN, 5.0)),
])
def test_a_nan_input_never_renders_as_epic(label, args):
    """The regression this file exists for. Named explicitly so a failure reads as what it is."""
    assert score_to_level(rating_score(*args)) != "epic", (
        f"{label}=NaN rendered as the TOP rating — the bucket loop fell through"
    )


# ── THE TERMINAL MAPPER ─────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [NAN, INF, -INF])
def test_score_to_level_refuses_every_non_finite_value(bad):
    assert score_to_level(bad) == "unknown"


def test_score_to_level_still_maps_real_scores():
    """CONTROL. A guard that refuses everything would pass the tests above and break the product."""
    assert score_to_level(0) == "very_poor"
    assert score_to_level(76.3) == "good"
    assert score_to_level(90) == "epic"
    assert score_to_level(None) == "unknown"


def test_compute_surf_rating_propagates_the_refusal_as_a_pair():
    assert compute_surf_rating(NAN, 14.0, 5.0) == (None, "unknown")


# ── WHAT MUST *NOT* CHANGE ──────────────────────────────────────────────────────────────────────

def test_infinity_is_bounded_by_the_gates_and_is_not_treated_as_missing():
    """`inf` is NOT a leak: the multiplicative gates bound it to a real, low score. Asserting this
    keeps the guard honest — if someone later "simplifies" `isfinite` into a NaN-only check the
    behaviour here is unchanged, but if they widen it into `if not score: return None` this fails,
    because a legitimate 0.0 would start reading as missing."""
    s = rating_score(INF, 14.0, 5.0)
    assert s is not None and math.isfinite(s) and 0.0 < s < 50.0, f"got {s!r}"


def test_a_flat_but_valid_sea_still_scores_zero_not_none():
    """0.0 and None mean different things: 'there is no rideable wave' vs 'the input was unusable'.
    Collapsing them would erase the distinction the refusal above depends on."""
    assert rating_score(0.05, 14.0, 5.0) == 0.0


def test_a_normal_day_is_untouched():
    """Byte-identical to the pre-guard value — the change must be inert on every real input."""
    assert rating_score(1.5, 14.0, 5.0) == 76.3

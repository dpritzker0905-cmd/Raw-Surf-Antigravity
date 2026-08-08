"""`size_score` HAS TWO CURVES, AND THE DEFAULT IS NOT THE ONE PRODUCTION SERVES.

⭐⭐⭐ THE LESSON THIS FILE EXISTS FOR (2026-08-07). A Jacobian sweep over every input of
`compute_surf_rating` reported TWO inputs as identically inert across 2,064 evaluations, and both
"findings" were artefacts of the probe calling the function with its DEFAULTS:

    measurement                       probed with defaults      on the production branch
    size factor saturated             ~half of served spots     2.0%  (1 of 50)
    a +25% height moves size_score    51.2%                     94.0%
    oversize gate binds               0.0%                      2.0%  (min gate 0.892)

⇒ ★★★ **DEFAULT ARGUMENTS ARE A BRANCH.** `reference_size_m=None` selects the LEGACY absolute curve
(linear to 1.0 at 1.2 m, flat above); production supplies a per-spot reference and gets the LOCAL
curve (0.6 at the reference, 1.0 at 2.5x it). Probing with defaults measured a path nobody is
served. Measured live the same day: 5 of 5 sampled spots and 50 of 50 in a wider sweep carried a
`reference_size_m`, so the local curve is the served one.

WHAT THIS GUARDS. If `reference_size_m` ever stopped reaching the rating, every spot would silently
fall back to the legacy curve and the size factor would SATURATE AT 1.2 m — going blind to any
difference above roughly head-high, on a served distribution whose p90 breaking height is 1.66 m.
That is a large behaviour change with no error and no log line, so it is asserted here rather than
assumed.

⚠️ NOT a claim that either curve is right — that is the `RATING_LOCAL_SIZE` product decision the
memory records as owner-gated. This pins only that the two are DIFFERENT and which one is live.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.surf_rating import (  # noqa: E402
    _DEFAULT_REF_SIZE_M, oversize_thresholds, size_score,
)


def test_the_legacy_default_curve_saturates_at_the_global_reference():
    """The `reference_size_m=None` branch: linear to 1.0 at 1.2 m, flat for ever after."""
    assert size_score(_DEFAULT_REF_SIZE_M) == pytest.approx(1.0)
    for h in (1.4, 2.0, 3.0, 6.0):
        assert size_score(h) == pytest.approx(1.0), (
            f"the legacy curve no longer saturates at {_DEFAULT_REF_SIZE_M} m — re-measure the "
            f"reach numbers in this file's docstring before trusting them")
    assert size_score(0.6) < size_score(1.0) < 1.0, "the legacy curve should rise below the anchor"


def test_the_LOCAL_curve_is_a_DIFFERENT_shape__not_a_rescaling_of_the_default():
    """⛔ THE TWO BRANCHES ARE INTENTIONALLY DIFFERENT SHAPES (surf_rating's own docstring). A
    'simplification' that collapses them into one would change every served score."""
    ref = 0.8
    assert size_score(ref, ref) == pytest.approx(0.6, abs=0.05), (
        "the local curve should ANCHOR near 0.6 at the spot's typical day, not max out there")
    assert size_score(2.5 * ref, ref) == pytest.approx(1.0), "local curve should reach 1.0 at 2.5x"
    # and at the same physical height the two branches disagree — which is the whole point
    h = 1.2
    assert abs(size_score(h, ref) - size_score(h)) > 0.05, (
        "the local and legacy curves agree at 1.2 m, so one of the two branches has been "
        "collapsed into the other")


def test_a_SMALL_reference_saturates_far_below_the_legacy_curve():
    """The case that makes this load-bearing. Florida's live reference is ~0.4 m, so its size factor
    maxes at 1.0 m — while the legacy curve would still be climbing to 1.2 m. Which branch is taken
    changes the served score for exactly the spots with the smallest surf."""
    small = 0.4
    assert size_score(1.0, small) == pytest.approx(1.0)
    assert size_score(1.0) < 1.0, "the legacy curve must still be below 1.0 at 1.0 m"


def test_the_oversize_taper_start_also_switches_branch():
    """The same default-is-a-branch trap one function over: `oversize_thresholds(None, None)` starts
    the taper at 8.0 m, but with a local reference it starts at 3.5x it — measured p50 4.39 m over
    50 live spots, which is where the 0.0% vs 2.0% reach difference came from."""
    legacy_start, _ = oversize_thresholds(None, None)
    local_start, _ = oversize_thresholds(0.8, None)
    assert legacy_start == pytest.approx(8.0)
    assert local_start == pytest.approx(2.8), "3.5x the reference"
    assert local_start < legacy_start, (
        "a local reference must be able to start the taper EARLIER than the know-nothing absolute "
        "pair — otherwise the capacity tiers are decorative")

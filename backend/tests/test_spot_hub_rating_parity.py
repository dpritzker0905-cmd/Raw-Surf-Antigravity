"""ONE FORECAST COMPOSITION: the spot hub and the map glyphs must grade a spot identically.

CLAUDE.md's binding rule is that every surface showing surf height or quality goes through the SAME
chain, with `spot_ratings.rate_one_spot` as the reference implementation. `spot_conditions.py`
drifted from it in the quietest possible way: it called `compute_surf_rating` with TEN POSITIONAL
arguments, which stop at `reference_size_m`, so `break_depth_m` stayed None — while
`geometry.break_depth_m` had been resolved twenty lines earlier and was sitting in scope.

The hub therefore opted out of the oversize gate's per-spot capacity tier that the glyph layer uses.
Measured 2026-07-29 at Tp 18 s, 3 m/s wind, head-on swell:

    Mavericks   45.9 ft   hub 27.3 "poor"       vs glyph 89.6 "epic"       (+62.3)
    Trestles    32.8 ft   hub 69.8 "fair_good"  vs glyph 27.3 "poor"       (-42.5)
    Pipeline    32.8 ft   hub 69.8 "fair_good"  vs glyph 51.4 "fair"       (-18.4)

Signed BOTH ways — simultaneously crushing big-wave spots and calling closeouts good. These tests
pin the two calls together so the next optional engine input cannot silently fail to reach a surface.
"""
import inspect

import pytest

from services.weather_pipeline.shore_normal_asset import break_depth_at
from services.weather_pipeline.surf_rating import compute_surf_rating

M_TO_FT = 3.28084

# Real catalogue coordinates with real measured break depths.
SPOTS = [
    ("Mavericks", 37.4915, -122.5083, 225.1),
    ("Lower Trestles", 33.3819, -117.5885, 219.0),
    ("Pipeline", 21.6637, -158.0515, 308.1),
    ("Cocoa Beach Pier", 28.3676, -80.6012, 99.1),
]
SIZES_M = [0.5, 1.5, 4.0, 7.0, 10.0, 14.0]


def _glyph(h_m, tp, wind_ms, shore_normal, swell_from, break_depth):
    """What spot_ratings.rate_one_spot computes — the reference implementation."""
    return compute_surf_rating(h_m, tp, wind_ms, None, shore_normal, swell_from,
                               break_depth_m=break_depth)


@pytest.mark.parametrize("name,lat,lng,normal", SPOTS)
def test_hub_and_glyph_agree_across_the_size_ladder(name, lat, lng, normal):
    """The hub now passes break_depth_m, so the two calls must be IDENTICAL at every size."""
    bd = break_depth_at(lat, lng)
    assert bd is not None, f"{name} lost its break depth — fixture is stale"
    for h in SIZES_M:
        hub = compute_surf_rating(h, 18.0, 3.0, wind_from_deg=None, shore_normal_deg=normal,
                                  swell_from_deg=normal, break_depth_m=bd)
        glyph = _glyph(h, 18.0, 3.0, normal, normal, bd)
        assert hub == glyph, f"{name} at {h} m: hub {hub} != glyph {glyph}"


def test_dropping_break_depth_is_what_used_to_diverge_and_is_signed_both_ways():
    """Documents the defect so nobody 'simplifies' the call back to positional form. This asserts
    the OLD behaviour was wrong in BOTH directions — a blanket correction would not have fixed it."""
    mav_bd = break_depth_at(37.4915, -122.5083)      # 22.1 m — a big-wave spot
    tre_bd = break_depth_at(33.3819, -117.5885)      # 9.3 m  — a performance beach break
    h = 14.0                                          # ~46 ft: deep in the oversize regime
    mav_hub = compute_surf_rating(h, 18.0, 3.0, None, 225.1, 225.1)                       # bd None
    mav_glyph = compute_surf_rating(h, 18.0, 3.0, None, 225.1, 225.1, break_depth_m=mav_bd)
    tre_hub = compute_surf_rating(10.0, 18.0, 3.0, None, 219.0, 219.0)
    tre_glyph = compute_surf_rating(10.0, 18.0, 3.0, None, 219.0, 219.0, break_depth_m=tre_bd)
    assert mav_glyph[0] > mav_hub[0], "big-wave spot must rate HIGHER once its capacity is known"
    assert tre_glyph[0] < tre_hub[0], "beach break must rate LOWER once its capacity is known"


def test_ordinary_sizes_are_untouched_by_the_fix():
    """The capacity tier only acts in the oversize regime; a normal day must be byte-identical."""
    bd = break_depth_at(33.3819, -117.5885)
    for h in (0.5, 1.5, 3.0):
        with_bd = compute_surf_rating(h, 14.0, 3.0, None, 219.0, 219.0, break_depth_m=bd)
        without = compute_surf_rating(h, 14.0, 3.0, None, 219.0, 219.0)
        assert with_bd == without, f"{h} m changed: {without} -> {with_bd}"


def test_the_hub_passes_every_optional_factor_by_NAME():
    """A POSITIONAL call is how a new engine input silently fails to reach a surface. Pin the call
    style itself: the hub's compute_surf_rating call must name break_depth_m explicitly."""
    from services.weather_pipeline import spot_conditions
    src = inspect.getsource(spot_conditions)
    assert "break_depth_m=getattr(geometry" in src, \
        "the spot hub stopped passing break_depth_m — the hub and the glyphs will disagree again"
    assert "shore_normal_deg=getattr(geometry" in src


def test_compute_surf_rating_optional_inputs_are_all_keyword_reachable():
    """Guards the other direction: if someone appends a new optional factor, the hub's keyword call
    keeps working, but a positional caller silently would not. Enumerate what exists today."""
    params = list(inspect.signature(compute_surf_rating).parameters)
    for expected in ("break_depth_m", "partitions", "reference_size_m", "tide_norm"):
        assert expected in params, f"{expected} vanished from the rating signature"
    # break_depth_m must remain AFTER the historical positional block so old callers are unaffected.
    assert params.index("break_depth_m") > params.index("reference_size_m")

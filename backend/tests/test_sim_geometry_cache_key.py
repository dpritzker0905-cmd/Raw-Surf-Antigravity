"""The sim's per-coordinate geometry cache key must stay fine enough to separate neighbouring spots.

WHY THIS EXISTS
---------------
`sim_rating.spot_geometry` memoises resolved geometry on `(round(lat,6), round(lng,6))`. That
precision is ~0.1 m and is the ONLY thing keeping two nearby breaks from sharing one shore normal —
and the shore normal is the highest-leverage input in the whole forecast (measured: a coarse bearing
is median 24.7 deg off and the rating LEVEL differs at 58.1% of spots).

Nothing pinned it. Measured 2026-08-01: coarsening the key to 2 dp (~1.1 km) left the entire sim
guard set at **601 passed, 0 failed**. Over the 1,587-spot catalogue that coarsening collapses

    distinct keys at 6 dp : 1584      <- current
    distinct keys at 3 dp : 1571
    distinct keys at 2 dp : 1470      <- 114 spots lose their own geometry

so 114 breaks would silently be scored with a neighbour's bearing. The symptom — nearby spots
agreeing — reads as plausible, which is why it needs a test rather than a reviewer.

★ NO `dev.db`. The recorded lesson is that a test naming a real spot asserts something about the
machine it runs on (`test_sim_whatif_baseline` went red in Actions on a spot that existed only in a
developer's gitignored database). These coordinates are synthetic and chosen for their SEPARATION,
so the test means the same thing on every machine.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import services.weather_pipeline.sim_rating as SR  # noqa: E402

# ⚠️ THESE COORDINATES ARE CHOSEN TO COLLIDE, and my first attempt did not — the mutation test
# caught it. 34.0000 and 34.0100 look "1.1 km apart" but they round to 34.0 and 34.01, i.e. they
# stay DISTINCT at 2 dp, so the headline test passed under the very defect it was written for.
# A separation is only a regression test if it lands INSIDE one cell of the coarser key.
# Both of these round to (34.0, -119.5) at 2 dp and are ~333 m apart — two peaks on one beach.
_A = {"name": "synthetic-a", "latitude": 34.0010, "longitude": -119.5000}
_B = {"name": "synthetic-b", "latitude": 34.0040, "longitude": -119.5000}
# ~11 m apart — far below a 2 dp cell, still distinct at 6 dp.
_C = {"name": "synthetic-c", "latitude": 34.0011, "longitude": -119.5000}


def _fresh():
    SR._GEOMETRY_CACHE.clear()


def test_two_peaks_on_one_beach_do_not_share_a_cache_entry():
    """THE REGRESSION. ~333 m apart; at 2 dp both round to (34.0, -119.5) and the second spot
    silently inherits the first spot's shore normal, shelf depth and break depth."""
    _fresh()
    SR.spot_geometry(_A)
    SR.spot_geometry(_B)
    assert len(SR._GEOMETRY_CACHE) == 2, (
        f"~333 m apart collapsed to {len(SR._GEOMETRY_CACHE)} cache entry/entries — the key is too "
        f"coarse, and the second spot is being scored on the first spot's geometry"
    )


def test_the_key_separates_coordinates_far_finer_than_a_kilometre():
    """11 m apart. Two peaks on the same beach are routinely closer than a 2 dp cell."""
    _fresh()
    SR.spot_geometry(_A)
    SR.spot_geometry(_C)
    assert len(SR._GEOMETRY_CACHE) == 2, "the key must separate same-beach peaks, not just spots"


def test_the_same_coordinate_still_hits_the_cache():
    """CONTROL. A key so fine that nothing ever hits would pass the tests above and destroy the
    memo's whole purpose — the sweep at one spot across many hours is what it exists for."""
    _fresh()
    SR.spot_geometry(_A)
    SR.spot_geometry(dict(_A))          # same coordinate, different dict object
    assert len(SR._GEOMETRY_CACHE) == 1, "an identical coordinate must reuse the memo"


def test_the_key_precision_is_pinned_in_source():
    """Belt-and-braces on the literal, so a refactor that changes the rounding is visible in a diff
    even if the behavioural tests above are ever weakened or skipped."""
    import inspect
    src = inspect.getsource(SR.spot_geometry)
    assert "round(float(lat), 6)" in src and "round(float(lng), 6)" in src, (
        "geometry cache key precision changed; 2 dp collapses 1584 catalogue keys to 1470, so 114 "
        "spots would share a neighbour's shore normal — the #1 Jacobian input"
    )

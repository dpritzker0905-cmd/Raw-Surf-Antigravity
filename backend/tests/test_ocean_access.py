"""
Guards the ocean-access placement test (2026-07-27).

ORIGIN: the owner reported by eye that three Volusia County spots sat inland — Bethune Beach at the
city centre, New Smyrna Beach - Flagler Avenue in the town, and a duplicate New Smyrna Beach Inlet.
All three had passed the placement gate, and all three were ACCEPTED into the shore-normal asset,
shipping a bearing fitted to the Intracoastal's bank (Flagler Avenue: 84.8 deg, against 50-65 deg
for its correctly-placed neighbours).

The reason is that `nearest_shoreline_km` measures distance to any land/water boundary, and on a
barrier-island coast that boundary is the lagoon. The fix measures distance to water deep enough to
be the sea.

Synthetic rasters, no network — these run anywhere.
"""
import os
import sys

import numpy as np
import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline.ocean_access import (  # noqa: E402
    DEEP_M, MAX_OCEAN_KM, ocean_access_km, placement_verdict)


def barrier_island_profile():
    """A New Smyrna cross-section, west to east, from the measured ETOPO transect at 29.028 N:

        mainland  |  lagoon (-2.7 m)  |  barrier island  |  Atlantic (-3 .. -16.6 m)
    """
    row = ([8.7, 8.6, 7.3, 6.8, 6.0, 3.6, 1.3, 0.9, 0.9, 1.1, 1.1, 1.5, 2.1, 1.8, 2.1, 2.2, 1.5]
           + [-2.7, -0.8]                              # the lagoon — never reaches 3 m
           + [0.3, 0.6, 0.6, 1.0, 2.7, 2.7]            # the barrier island
           + [-3.0, -7.4, -10.8, -12.7, -14.0, -15.2, -16.6])   # the Atlantic
    elev = np.tile(np.array(row, dtype=float), (9, 1))
    lats = np.linspace(29.028 - 0.017, 29.028 + 0.017, 9)
    lons = np.linspace(-80.9896, -80.9896 + 0.00416 * (len(row) - 1), len(row))
    return elev, lats, lons


def test_lagoon_is_not_mistaken_for_the_sea():
    """THE regression. The Flagler Avenue pin sits on the mainland beside the lagoon."""
    elev, lats, lons = barrier_island_profile()
    v = placement_verdict(elev, lats, lons, 29.028, -80.9229)
    assert v["verdict"] == "INLAND", v
    assert v["ocean_km"] > MAX_OCEAN_KM, v
    # and it must point at the real water, so the editor has somewhere to move it to
    assert v["ocean_lng"] > -80.89, v


def test_a_pin_in_the_lagoon_itself_is_still_inland():
    """Being IN the wrong water is no better than being beside it — the old test called this
    0.0 km from shore."""
    elev, lats, lons = barrier_island_profile()
    v = placement_verdict(elev, lats, lons, 29.028, -80.9188)   # the -2.7 m lagoon cell
    assert v["verdict"] == "INLAND", v


def test_a_pin_on_the_ocean_side_passes():
    elev, lats, lons = barrier_island_profile()
    v = placement_verdict(elev, lats, lons, 29.028, -80.8896)   # barrier island, ocean-facing edge
    assert v["verdict"] == "ON_OCEAN", v
    assert v["ocean_km"] <= MAX_OCEAN_KM, v


def test_a_landlocked_window_is_reported_not_guessed():
    """No sea in the window is NO_OCEAN — explicitly unknown-and-wrong, never silently fine."""
    elev = np.full((9, 9), 120.0)
    lats = np.linspace(17.90, 17.99, 9)
    lons = np.linspace(-76.45, -76.36, 9)
    v = placement_verdict(elev, lats, lons, 17.95, -76.40)
    assert v["verdict"] == "NO_OCEAN", v
    assert v["ocean_km"] is None and v["ocean_lat"] is None


def test_shallow_water_alone_never_counts_as_ocean():
    """A wide but shallow body (an estuary, a flooded flat) must not qualify at any width."""
    elev = np.full((9, 40), -1.5)
    elev[:, :5] = 6.0
    lats = np.linspace(29.0, 29.08, 9)
    lons = np.linspace(-81.0, -80.84, 40)
    km, target = ocean_access_km(elev, lats, lons, 29.04, -80.95)
    assert km is None and target is None


def test_depth_threshold_is_the_documented_one():
    """DEEP_M is measured against the Indian River bottoming at 2.7 m — if someone lowers it below
    that, the lagoon qualifies again and the whole test silently reverts."""
    assert DEEP_M >= 3.0, "the measured lagoon floor is 2.7 m; below 3.0 m this test stops working"
    assert MAX_OCEAN_KM == pytest.approx(1.5)


def test_nan_cells_do_not_crash_or_count_as_water():
    elev, lats, lons = barrier_island_profile()
    elev = elev.copy()
    elev[0, :] = np.nan
    v = placement_verdict(elev, lats, lons, 29.028, -80.9229)
    assert v["verdict"] == "INLAND", v


def test_verdict_reports_the_pin_elevation():
    """The elevation is the human-legible proof — '+1.5 m in a town' is what convinced the owner."""
    elev, lats, lons = barrier_island_profile()
    v = placement_verdict(elev, lats, lons, 29.028, -80.9229)
    assert v["elev_m"] == pytest.approx(1.5, abs=0.6), v


def test_the_build_gate_rejects_an_inland_spot():
    """`accepted()` must refuse to ship a shore normal for a spot that is not on the ocean —
    a confident wrong bearing is used as-is, while a miss safely falls back to the coarse grid."""
    from scripts.build_shore_normals import accepted
    base = {"normal": 84.8, "spread": 5.0, "n_windows": 4, "shoreline_km": 0.24}
    ok, why = accepted({**base, "ocean_verdict": "ON_OCEAN"})
    assert ok and why == "accepted"
    ok, why = accepted({**base, "ocean_verdict": "INLAND"})
    assert not ok and why == "not_on_open_ocean_inland", why
    ok, why = accepted({**base, "ocean_verdict": "NO_OCEAN"})
    assert not ok and why == "not_on_open_ocean_no_ocean", why


def test_the_build_gate_is_backward_compatible_when_the_field_is_absent():
    """An older review row without the column must not start failing."""
    from scripts.build_shore_normals import accepted
    ok, why = accepted({"normal": 60.0, "spread": 5.0, "n_windows": 4, "shoreline_km": 0.2})
    assert ok and why == "accepted"

"""
test_shore_normal_fit.py — pin the shore-normal estimator on SYNTHETIC coastlines.

The truth is known exactly here (a straight coast running north-south with ocean to the west faces
due west, 270°, by construction), so these tests need no network, no fixture, and no bathymetry
asset — and they fail loudly if the estimator's orientation convention or seaward sign ever flips.

The spread assertions are the important ones: MAX_SPREAD_DEG only means something if a clean coast
really does produce a near-zero spread and an ambiguous one really does produce a large one.
"""
import math
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.shore_normal_fit import (  # noqa: E402
    MAX_SPREAD_DEG, angular_diff, circular_mean, coast_pca_bearing, crop,
    fit_shore_normal, max_spread, nearest_shoreline_km, shoreline_mask,
)

N = 40
# Equator-centred so metres-per-degree of longitude == metres-per-degree of latitude and the
# synthetic 45° diagonal really is 45° on the ground.
LATS = np.linspace(-0.09, 0.09, N)
LONS = np.linspace(-0.09, 0.09, N)
OCEAN, LAND = -100.0, 50.0


def _blank():
    return np.full((N, N), LAND)


def _ocean_west():
    e = _blank(); e[:, : N // 2] = OCEAN; return e


def _ocean_east():
    e = _blank(); e[:, N // 2:] = OCEAN; return e


def _ocean_north():
    e = _blank(); e[N // 2:, :] = OCEAN; return e


def _ocean_south():
    e = _blank(); e[: N // 2, :] = OCEAN; return e


def _ocean_northwest():
    """Ocean where col < row — a 45° coast with the sea to the north-west."""
    e = _blank()
    rows, cols = np.indices(e.shape)
    e[cols < rows] = OCEAN
    return e


@pytest.mark.parametrize("build,expected", [
    (_ocean_west, 270.0),
    (_ocean_east, 90.0),
    (_ocean_north, 0.0),
    (_ocean_south, 180.0),
    (_ocean_northwest, 315.0),
])
def test_straight_coast_faces_the_sea(build, expected):
    """A straight synthetic coast must return the bearing that points at the water."""
    got = coast_pca_bearing(build(), LATS, LONS)
    assert got is not None
    assert angular_diff(got, expected) < 5.0, f"expected ~{expected}, got {got}"


def test_all_ocean_and_all_land_return_none():
    """No shoreline in view -> no bearing. The caller must fall back, not invent a direction."""
    assert coast_pca_bearing(np.full((N, N), OCEAN), LATS, LONS) is None
    assert coast_pca_bearing(np.full((N, N), LAND), LATS, LONS) is None


def test_seaward_sign_is_not_reversible():
    """Mirroring the ocean to the opposite side must flip the bearing by 180°, not repeat it."""
    west = coast_pca_bearing(_ocean_west(), LATS, LONS)
    east = coast_pca_bearing(_ocean_east(), LATS, LONS)
    assert angular_diff(west, east) > 170.0


def test_clean_coast_has_a_small_spread():
    """The confidence instrument: an unambiguous coast must land far inside MAX_SPREAD_DEG."""
    bearing, spread, n = fit_shore_normal(_ocean_west(), LATS, LONS, 0.0, 0.0)
    assert n >= 3
    assert angular_diff(bearing, 270.0) < 5.0
    assert spread < 5.0
    assert spread < MAX_SPREAD_DEG


def test_ambiguous_corner_has_a_large_spread():
    """A coastline that BENDS inside the window has no single normal — the spread must say so.

    Without this the gate would be vacuous: it must be possible to exceed MAX_SPREAD_DEG.

    A small ISLAND sitting wholly inside the larger windows is the honest case. Its shoreline is a
    closed loop, so there is no single seaward direction at all and the fit swings ~90° across
    scales. Note that a mere coastal BEND is NOT enough any more: measured against OSM, a bend
    (spread 25-40°) still yields a bearing that beats the coarse value 76% of the time, which is
    exactly why the gate sits at 40° and not 25°."""
    e = np.full((N, N), OCEAN)
    rows, cols = np.indices(e.shape)
    e[(rows >= 17) & (rows < 23) & (cols >= N // 2) & (cols < N // 2 + 6)] = LAND
    _, spread, n = fit_shore_normal(e, LATS, LONS, 0.0, 0.0)
    assert n >= 3
    assert spread is not None and spread > MAX_SPREAD_DEG, (
        f"a bending coast must exceed the gate, got spread={spread}")


def test_barrier_island_faces_the_deep_side_not_the_lagoon():
    """A barrier island has water on BOTH sides — the sign test must pick the ocean, not the sound.

    Measured at Waves on the Outer Banks: a ±5 km window held 210 water cells on each side, Pamlico
    Sound (mean 0.9 m) to the west and the Atlantic (mean 11.1 m) to the east. With an unweighted
    water centroid the estimator faced the lagoon — 273.7° instead of ~90° — and reported a spread
    of 4.5°, so the confidence gate gave no warning at all. Only depth weighting separates them."""
    e = np.full((N, N), LAND)
    e[:, : N // 2 - 1] = -1.0          # shallow lagoon to the WEST (1 m)
    e[:, N // 2 + 1:] = -12.0          # deep open ocean to the EAST (12 m)
    got = coast_pca_bearing(e, LATS, LONS)
    assert got is not None
    assert angular_diff(got, 90.0) < 15.0, (
        f"must face the deep ocean (~90°), got {got} — the lagoon side won")


def test_equal_depth_water_on_both_sides_is_unchanged_by_weighting():
    """Sanity check on the weighting: when both sides are equally deep it must not bias the answer,
    so the ordinary single-coast cases stay exactly as they were."""
    assert angular_diff(coast_pca_bearing(_ocean_west(), LATS, LONS), 270.0) < 5.0


def test_circular_mean_wraps():
    """359° and 1° average to 0°, not to 180°."""
    assert angular_diff(circular_mean([359.0, 1.0]), 0.0) < 1e-6
    assert circular_mean([]) is None
    assert angular_diff(circular_mean([90.0, 90.0, 90.0]), 90.0) < 1e-6


def test_max_spread_semantics():
    assert max_spread([10.0]) is None
    assert max_spread([]) is None
    assert abs(max_spread([350.0, 10.0]) - 20.0) < 1e-6
    assert abs(max_spread([0.0, 30.0, 10.0]) - 30.0) < 1e-6


def test_angular_diff_is_symmetric_and_bounded():
    assert abs(angular_diff(10.0, 350.0) - 20.0) < 1e-9
    assert abs(angular_diff(350.0, 10.0) - 20.0) < 1e-9
    assert angular_diff(0.0, 180.0) == 180.0
    assert angular_diff(None, 5.0) is None


def test_nearest_shoreline_km_measures_placement():
    """On-shore reads ~0 km; a point far inland reads the real distance (the placement signal)."""
    e = _ocean_west()
    on_coast = nearest_shoreline_km(e, LATS, LONS, 0.0, float(LONS[N // 2 - 1]))
    assert on_coast is not None and on_coast < 1.0
    inland = nearest_shoreline_km(e, LATS, LONS, 0.0, float(LONS[-1]))
    assert inland is not None and inland > 4.0
    assert nearest_shoreline_km(np.full((N, N), LAND), LATS, LONS, 0.0, 0.0) is None


def test_shoreline_mask_selects_ocean_cells_touching_land():
    sh = shoreline_mask(_ocean_west())
    assert sh.any()
    # every flagged cell must itself be ocean
    assert bool((_ocean_west()[sh] < 0).all())
    # and they must all sit on the boundary column, not smeared across the window
    cols = np.argwhere(sh)[:, 1]
    assert cols.min() == cols.max() == N // 2 - 1


def test_crop_rejects_a_window_too_small_to_fit():
    sub_e, _, _ = crop(_ocean_west(), LATS, LONS, 0.0, 0.0, 0.0001)
    assert sub_e is None


def test_fit_returns_none_without_a_shoreline():
    bearing, spread, n = fit_shore_normal(np.full((N, N), OCEAN), LATS, LONS, 0.0, 0.0)
    assert bearing is None and spread is None and n == 0

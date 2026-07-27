"""
test_spot_placement_proposals.py — pin the placement-triage thresholds on synthetic terrain.

The whole value of this tool is that it REFUSES to propose a coordinate it cannot justify. So the
tests that matter are the refusals: an isthmus must come back ambiguous, and a spot that merely
"passes the shore-normal gate after snapping" must not thereby be treated as correct.
"""
import math
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.propose_spot_placements import (  # noqa: E402
    MAX_OPPOSED_FRAC, MAX_PROPOSE_KM, snap_target,
)

N = 60
# ~0.005 deg per cell (~550 m), so the synthetic distances are in the same range as ETOPO's 463 m.
LATS = np.linspace(-0.15, 0.15, N)
LONS = np.linspace(-0.15, 0.15, N)
OCEAN, LAND = -100.0, 50.0


def _straight_coast():
    """Ocean to the west of column N//2; everything east is land."""
    e = np.full((N, N), LAND)
    e[:, : N // 2] = OCEAN
    return e


def _isthmus():
    """A narrow land bridge: ocean on BOTH sides, so 'nearest coast' is arbitrary."""
    e = np.full((N, N), LAND)
    e[:, : N // 2 - 3] = OCEAN
    e[:, N // 2 + 3:] = OCEAN
    return e


def test_straight_coast_gives_one_clear_direction():
    """A spot inland of a straight coast: no candidate coast lies on the opposite side.

    Regression guard: the first version of this metric used the circular CONCENTRATION of the
    candidate bearings, and a straight coast scored 0.847 — just under the 0.85 threshold — because
    the candidates fan out ALONG the shore. It would have refused to propose on exactly the terrain
    the tool exists to handle."""
    e = _straight_coast()
    lat = 0.0
    lon = float(LONS[N // 2 + 4])                      # ~2 km inland of the shore
    got = snap_target(e, LATS, LONS, lat, lon)
    assert got is not None
    slat, slon, km, opposed = got
    assert opposed <= MAX_OPPOSED_FRAC, f"a straight coast must be unambiguous, got {opposed}"
    assert km < 5.0
    assert slon < lon, "the snap must move toward the water (west), not away"


def test_isthmus_is_reported_as_ambiguous():
    """Ocean on both sides -> a large share of the nearby coast is on the opposite side.

    This is the Twin Rocks case (a 13.9 km move between several equidistant coasts) — and it PASSED
    the shore-normal gate, which is exactly why the gate cannot be the only check."""
    e = _isthmus()
    got = snap_target(e, LATS, LONS, 0.0, 0.0)
    assert got is not None
    _, _, _, opposed = got
    assert opposed > MAX_OPPOSED_FRAC, (
        f"a spot between two coasts must be flagged ambiguous, got opposed_frac {opposed}")


def test_no_coastline_returns_none():
    assert snap_target(np.full((N, N), LAND), LATS, LONS, 0.0, 0.0) is None
    assert snap_target(np.full((N, N), OCEAN), LATS, LONS, 0.0, 0.0) is None


def test_snap_target_lands_on_water():
    """The proposal must be a water cell — a break is in the sea, not on the beach."""
    e = _straight_coast()
    slat, slon, _, _ = snap_target(e, LATS, LONS, 0.0, float(LONS[N // 2 + 4]))
    i = int(np.argmin(np.abs(LATS - slat)))
    j = int(np.argmin(np.abs(LONS - slon)))
    assert e[i, j] < 0


def test_distance_is_measured_in_real_metres():
    """A spot ~2 cells from the shore must report a sane distance, not degrees."""
    e = _straight_coast()
    lon = float(LONS[N // 2 + 2])
    _, _, km, _ = snap_target(e, LATS, LONS, 0.0, lon)
    expected = abs(lon - float(LONS[N // 2 - 1])) * 111.32
    assert km == pytest.approx(expected, rel=0.25)


def test_thresholds_are_the_measured_ones():
    """These came from measuring 54 placement failures; changing them silently would relax the
    refusal logic that is the point of the tool."""
    assert MAX_PROPOSE_KM == 3.0
    assert MAX_OPPOSED_FRAC == 0.15

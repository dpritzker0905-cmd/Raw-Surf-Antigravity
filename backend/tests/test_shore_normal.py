"""Unit tests for the seaward-bearing (shore-normal) helper used by the surf rating."""
import numpy as np
from services.weather_pipeline.bathymetry import _seaward_bearing

# ETOPO is stored north-down: dlat < 0 (row 0 = highest latitude), dlon > 0 (col increases eastward).
DLAT, DLON = -0.25, 0.25


def test_east_facing_coast_seaward_is_east():
    # land on the west (cols 0-1), ocean on the east (cols 2-4) -> seaward points East (~90).
    sub = np.array([[-5, -5, 10, 12, 15]] * 5)
    b = _seaward_bearing(sub, DLAT, DLON)
    assert abs(b - 90.0) < 1.0


def test_west_facing_coast_seaward_is_west():
    # ocean on the west (cols 0-2), land on the east (cols 3-4) -> seaward points West (~270).
    sub = np.array([[20, 15, 10, -5, -5]] * 5)
    b = _seaward_bearing(sub, DLAT, DLON)
    assert abs(b - 270.0) < 1.0


def test_south_facing_coast_seaward_is_south():
    # ocean to the south. With dlat<0, row 0 = north; ocean in the higher (southern) rows.
    sub = np.array([
        [-5, -5, -5],
        [-5, -5, -5],
        [10, 10, 10],
        [12, 12, 12],
    ])
    b = _seaward_bearing(sub, DLAT, DLON)
    assert abs(b - 180.0) < 1.0


def test_all_ocean_or_all_land_has_no_normal():
    assert _seaward_bearing(np.array([[10, 10], [10, 10]]), DLAT, DLON) is None
    assert _seaward_bearing(np.array([[-1, -1], [-1, -1]]), DLAT, DLON) is None

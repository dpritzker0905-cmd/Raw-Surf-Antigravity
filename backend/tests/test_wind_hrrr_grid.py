"""The HRRR grid, its edge, its winds' rotation and the lane's two weights (services/_hrrr_grid.py, D-017).

Pinned to MEASURED facts, not to the module's own arithmetic:
  * NOAA's published corners of the HRRR CONUS grid (and `gribberish`'s lat/lon of the decoded 2026-10-09 12Z f03
    message, which matched `inverse` to 1e-5 deg);
  * where Open-Meteo's `gfs_hrrr` goes null on two transects (2026-10-09): 87W between 23.75N and 24.0N, 30N between
    69.5W and 69.0W -- `edge_km` must change sign at exactly those steps;
  * the rotation's sign: east of 97.5W the unrotated field read 16.4 deg anticlockwise of GFS, the rotated one 2.5.
"""
import math
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from services import _hrrr_grid as hg


@pytest.mark.parametrize("i,j,lat,lon", [
    (0, 0, 21.138, -122.720), (1798, 0, 21.141, -72.290), (0, 1058, 47.839, -134.095), (1798, 1058, 47.842, -60.917),
])
def test_the_corners_are_noaas(i, j, lat, lon):
    la, lo = hg.inverse(i, j)
    assert la == pytest.approx(lat, abs=2e-3) and lo == pytest.approx(lon, abs=2e-3)


def test_grid_ij_inverts_inverse():
    for i, j in [(0.0, 0.0), (899.0, 529.0), (1500.25, 300.5), (12.0, 1040.0)]:
        assert hg.grid_ij(*hg.inverse(i, j)) == pytest.approx((i, j), abs=1e-6)


@pytest.mark.parametrize("outside,inside", [((23.75, -87.0), (24.0, -87.0)), ((30.0, -69.0), (30.0, -69.5))])
def test_the_edge_is_where_open_meteo_hrrr_goes_null(outside, inside):
    assert hg.edge_km(*outside) <= 0.0 < hg.edge_km(*inside)
    assert not hg.inside(*outside) and hg.inside(*inside)


def test_the_gulf_storm_and_the_owners_boxes_are_deep_inside():
    assert hg.edge_km(27.8, -87.6) > 400.0                         # the 2026-10-09 eye
    assert hg.space_weight(27.8, -87.6, 200.0) == 1.0


def test_numpy_forms_match_the_scalar_ones():
    rng = np.random.default_rng(3)
    lat = rng.uniform(15, 56, 400)
    lon = rng.uniform(-140, -55, 400)
    e = hg.edge_km_np(lat, lon)
    w = hg.space_weight_np(lat, lon, 200.0)
    for k in range(0, 400, 37):
        assert e[k] == pytest.approx(hg.edge_km(lat[k], lon[k]), abs=1e-6)
        assert w[k] == pytest.approx(hg.space_weight(lat[k], lon[k], 200.0), abs=1e-9)


def test_the_feather_is_zero_in_hrrrs_own_relaxation_rows_and_smooth_at_both_ends():
    # Walk north along 97.5W from the south edge (24.37N): weight 0 through the first 15 km, then cos^2 to 1.
    lats = np.linspace(24.36, 27.5, 3000)
    lon = np.full_like(lats, -97.5)
    d = hg.edge_km_np(lats, lon)
    w = hg.space_weight_np(lats, lon, 200.0)
    assert (w[d <= hg.RELAXATION_KM] == 0.0).all()
    assert (w[d >= hg.RELAXATION_KM + 200.0] == 1.0).all()
    assert (np.diff(w) >= -1e-12).all()                             # monotone
    slope = np.diff(w) / np.diff(d)
    assert slope.max() == pytest.approx(math.pi / (2 * 200.0), rel=0.02)   # the cos^2 ramp's peak slope
    assert slope[:5].max() < 1e-3 and slope[-5:].max() < 1e-3        # zero slope at both ends: no kink


def test_a_zero_feather_is_a_hard_cut():
    assert hg.space_weight(24.0, -87.0, 0.0) == (1.0 if hg.edge_km(24.0, -87.0) > hg.RELAXATION_KM else 0.0)


def test_rotation_is_zero_on_lov_and_turns_the_right_way():
    assert hg.rotation_rad(-97.5) == pytest.approx(0.0)
    # A wind toward grid +y at 70W (east of LoV): earth-relative it veers EAST (u > 0), by n * 27.5 deg.
    ue, ve = hg.rotate_to_earth(np.array([0.0]), np.array([10.0]), np.array([-70.0]))
    alpha = math.sin(math.radians(38.5)) * math.radians(27.5)
    assert ue[0] == pytest.approx(10.0 * math.sin(alpha)) and ve[0] == pytest.approx(10.0 * math.cos(alpha))
    assert math.degrees(alpha) == pytest.approx(17.1, abs=0.1)
    # West of LoV it backs: the same vector at 120W gets u < 0.
    ue, _ = hg.rotate_to_earth(np.array([0.0]), np.array([10.0]), np.array([-120.0]))
    assert ue[0] < 0.0
    # Speed is preserved.
    u, v = hg.rotate_to_earth(np.array([3.0]), np.array([-4.0]), np.array([-80.0]))
    assert math.hypot(u[0], v[0]) == pytest.approx(5.0)


H = datetime(2026, 10, 11, 12, tzinfo=timezone.utc)


@pytest.mark.parametrize("hours_before,weight", [(5, 1.0), (3, 1.0), (2, 0.75), (1, 0.5), (0, 0.25), (-1, 0.0)])
def test_the_time_taper_is_open_meteos_seamless_hand_off(hours_before, weight):
    assert hg.time_weight(H - timedelta(hours=hours_before), H, 3) == pytest.approx(weight)


def test_a_zero_taper_is_a_hard_switch():
    assert hg.time_weight(H, H, 0) == 1.0
    assert hg.time_weight(H + timedelta(hours=1), H, 0) == 0.0


def test_horizons_follow_the_cycle():
    assert hg.hrrr_horizon_hours(12) == 48 and hg.hrrr_horizon_hours(13) == 18
    assert hg.horizon_of("2026-10-09T12:00:00Z") == H

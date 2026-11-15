"""The long-range wind extension's numeric core (services/weather_pipeline/ens_wind_core.py). Pre-registered gate:
docs/weather-program/log/2026-11-15-wind-long-range.md."""
import json

import numpy as np
import pytest

from services.weather_pipeline import ens_wind_core as ec


def test_speed_is_mean_of_member_speeds_not_the_shrunk_vector_mean():
    # two members, 10 m/s each, opposite-ish directions: the vector mean shrinks to ~1.7 m/s, ours keeps 10
    u = np.array([[10.0], [-8.0]])
    v = np.array([[0.0], [6.0]])
    out = ec.reduce_members(u, v)
    assert out["speed"][0] == pytest.approx(10.0)
    assert np.hypot(out["u"][0], out["v"][0]) == pytest.approx(10.0)
    # direction follows the member-mean vector (1, 3)
    assert np.arctan2(out["v"][0], out["u"][0]) == pytest.approx(np.arctan2(3.0, 1.0))
    assert out["spread"][0] == pytest.approx(0.0)


def test_calm_vector_mean_takes_the_control_direction():
    u = np.array([[5.0], [-5.0]])
    v = np.array([[0.0], [0.0]])
    out = ec.reduce_members(u, v)
    assert out["u"][0] == pytest.approx(5.0) and out["v"][0] == pytest.approx(0.0)


def test_gust_is_member_median_and_control_arm():
    u = np.ones((5, 2))
    v = np.zeros((5, 2))
    g = np.array([[1.0, 9], [2, 9], [3, 9], [40, 9], [50, 9]])
    out = ec.reduce_members(u, v, g)
    assert out["gust"].tolist() == [3.0, 9.0]
    cf = ec.control_only(u, v, g)
    assert cf["gust"].tolist() == [1.0, 9.0]
    with pytest.raises(ValueError):
        ec.reduce_members(u, v, g[:3])


def test_interp_within_run_keeps_speed_through_a_turn():
    f0 = {"u": np.array([10.0]), "v": np.array([0.0]), "speed": np.array([10.0]), "gust": np.array([12.0])}
    f1 = {"u": np.array([0.0]), "v": np.array([10.0]), "speed": np.array([10.0]), "gust": np.array([16.0])}
    mid = ec.interp_step(f0, f1, 186, 192, 189)
    assert np.hypot(mid["u"], mid["v"])[0] == pytest.approx(10.0)  # a plain vector lerp would give 7.07
    assert mid["gust"][0] == pytest.approx(14.0)
    same = ec.interp_step(f0, f0, 186, 186, 186)
    assert same["u"][0] == 10.0
    with pytest.raises(ValueError):
        ec.interp_step(f0, f1, 186, 192, 195)


def test_speed_factor_fit_and_apply():
    assert ec.fit_speed_factor([2, 4, np.nan], [1, 2, 5]) == pytest.approx(2.0)
    assert ec.fit_speed_factor([], []) == 1.0
    f = ec.apply_speed_factor({"u": np.array([3.0]), "v": np.array([4.0]), "speed": np.array([5.0]),
                               "gust": np.array([9.0])}, 1.2)
    assert f["speed"][0] == pytest.approx(6.0) and f["gust"][0] == 9.0
    s, d = ec.to_speed_dir(f["u"], f["v"])
    s0, d0 = ec.to_speed_dir([3.0], [4.0])
    assert d[0] == pytest.approx(d0[0])


def test_direction_is_where_the_wind_comes_from():
    _, d = ec.to_speed_dir([0.0, -5.0], [-5.0, 0.0])  # blowing toward south = from north; toward west = from east
    assert d.tolist() == pytest.approx([0.0, 90.0])


def test_bilinear_wraps_longitude_and_propagates_nan():
    meta = {"ni": 4, "nj": 3, "lat_south": -10.0, "dlat": 10.0, "lon_west": 0.0, "dlon": 90.0}
    arr = np.arange(12, dtype=float).reshape(3, 4)
    assert ec.bilinear(arr, meta, [-10.0], [0.0])[0] == 0.0
    assert ec.bilinear(arr, meta, [-5.0], [45.0])[0] == pytest.approx((0 + 1 + 4 + 5) / 4)
    assert ec.bilinear(arr, meta, [-10.0], [315.0])[0] == pytest.approx(1.5)  # between col 3 and col 0
    assert ec.bilinear(arr, meta, [-10.0], [-45.0])[0] == pytest.approx(1.5)
    arr[0, 0] = np.nan
    assert np.isnan(ec.bilinear(arr, meta, [-5.0], [45.0])[0])


def test_index_selection_and_coalesce():
    lines = [{"type": "cf", "param": "10u", "step": "186", "levtype": "sfc", "_offset": 0, "_length": 10},
             {"type": "pf", "number": "1", "param": "10u", "step": "186", "levtype": "sfc", "_offset": 10, "_length": 10},
             {"type": "pf", "number": "1", "param": "t", "step": "186", "levtype": "pl", "_offset": 20, "_length": 10},
             {"type": "pf", "number": "2", "param": "10fg", "step": "186", "levtype": "sfc", "_offset": 50, "_length": 5},
             {"type": "pf", "number": "2", "param": "10u", "step": "192", "levtype": "sfc", "_offset": 60, "_length": 5}]
    entries = ec.parse_ecmwf_index("\n".join(json.dumps(x) for x in lines) + "\n")
    sel = ec.select_members(entries, ("10u", "10fg"), 186)
    assert sel == {("10u", 0): (0, 10), ("10u", 1): (10, 10), ("10fg", 2): (50, 5)}
    spans = ec.coalesce(list(sel.values()))
    assert [(s, e) for s, e, _ in spans] == [(0, 20), (50, 55)]


def test_step_lattices():
    steps = ec.ens_archived_steps()
    assert 144 in steps and 147 not in steps and 150 in steps and steps[-1] == 360
    assert ec.native_bracket(189, steps) == (186, 192)
    assert ec.native_bracket(186, steps) == (186, 186)
    assert ec.extension_steps(180, 192) == [183, 186, 189, 192]
    assert ec.extension_steps(181, 186) == [183, 186]
    with pytest.raises(ValueError):
        ec.native_bracket(363, steps)

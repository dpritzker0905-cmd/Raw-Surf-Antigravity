"""currents-skill-v1 arm readers, the shared 25 h filter, M1 and M2 rows (registration sections 1, 4): known answers on
synthetic frames, radar fields and drifters."""
import math
import os
import sys

import numpy as np
import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BACKEND, "scripts"))
sys.path.insert(0, BACKEND)

import currents_skill_arms as A  # noqa: E402
import currents_skill_geo as G  # noqa: E402
import currents_skill_metrics as M  # noqa: E402
import currents_skill_truth as T  # noqa: E402
from services import frame_binary as fb  # noqa: E402

KN = 3600.0 / 1852.0
BOUNDS = (-120.0, 30.0, -117.0, 33.0)                 # west, south, east, north: a 13 x 13 grid at 0.25 deg


def frame(u, v, one_byte=False, h=6):
    spd = np.hypot(u, v) * KN
    to = np.degrees(np.arctan2(u, v)) % 360.0
    if one_byte:
        planes = {fb.CURRENT_KN_BAND: spd, fb.FLOW_DIR_BYTE: fb.flow_dir_anchors(spd, to)}
    else:
        planes = {fb.SPEED: spd, fb.DIRECTION: to}
    return fb.encode_planes(planes, BOUNDS, f"2026-12-01T{h:02d}:00:00Z", "2026-12-01T00:00:00Z", uv_convention=1)


def field(u, v, shape=(13, 13)):
    return np.full(shape, u, float), np.full(shape, v, float)


def arm_const(u, v, name="X", hours=range(6, 181, 6), land=None):
    frames = {}
    for h in hours:
        uu, vv = field(u, v)
        if land is not None:
            uu[land], vv[land] = np.nan, np.nan
        frames[h] = frame(uu, vv, h=h % 24)
    return A.ArmField.from_frames(name, frames)


# ---- arms -------------------------------------------------------------------------------------------------------------
def test_two_byte_frame_decodes_to_u_v_toward():
    la, lo, u, v, _vt, _rt = A.decode_frame_uv(frame(*field(0.3, -0.4)))
    assert la[0] == 30.0 and la[-1] == 33.0 and lo[0] == -120.0 and u.shape == (13, 13)
    assert np.allclose(u, 0.3, atol=1e-3) and np.allclose(v, -0.4, atol=1e-3)


def test_one_byte_frame_uses_the_band_speed_along_the_block_direction():
    u, v = field(0.0, 0.5)
    u[1::2, :] = 0.5                                     # odd rows point north-east: their block's anchor row says north
    _la, _lo, du, dv, *_ = A.decode_frame_uv(frame(u, v, one_byte=True))
    block = np.degrees(np.arctan2(du, dv)) % 360.0
    assert np.allclose(block[0], block[1])                # one direction per 2 x 2 block (the particles' own reading)
    assert np.allclose(np.hypot(du[0], dv[0]), 0.5, atol=0.006)      # the 0.02 kn band
    with pytest.raises(ValueError, match="no current vector"):
        A.decode_frame_uv(fb.encode_planes({fb.CURRENT_KN_BAND: np.full((3, 3), 1.0)}, BOUNDS, "2026-12-01T06:00:00Z",
                                           "2026-12-01T00:00:00Z"))


def test_steps_before_6h_are_ignored_and_persistence_holds_the_first():
    frames = {h: frame(*field(0.1 * (h // 6 + 1), 0.0)) for h in range(0, 31, 6)}
    arm = A.ArmField.from_frames("X", frames)
    assert list(arm.steps_h) == [6, 12, 18, 24, 30]
    p = A.persistence(arm)
    assert p.name == "PERSIST_X" and np.allclose(p.u, arm.u[0]) and np.allclose(p.u[0], 0.2, atol=1e-3)


def test_bilinear_is_exact_on_a_linear_field_and_strict_drops_land_corners():
    lats = np.arange(30.0, 33.01, 0.25)
    lons = np.arange(-120.0, -116.99, 0.25)
    U = np.add.outer(2 * lats, lons)[None]
    arm = A.ArmField("L", [6], lats, lons, U, U * 0)
    us, _ = arm.sample_steps(31.1, -118.3)
    assert us[0, 0] == pytest.approx(2 * 31.1 - 118.3)
    U2 = U.copy()
    U2[0, 4, 6] = np.nan                                  # lat 31.0, lon -118.5: a corner of the cell holding (31.1, -118.3)
    arm2 = A.ArmField("L", [6], lats, lons, U2, U2 * 0)
    assert np.isnan(arm2.sample_steps(31.1, -118.4, strict=True)[0][0, 0])
    assert np.isfinite(arm2.sample_steps(31.1, -118.4, strict=False)[0][0, 0])
    assert arm2.is_land(31.0, -118.5) and not arm2.is_land(31.5, -118.0) and arm2.is_land(40.0, -118.0)


def test_global_grid_wraps_the_antimeridian():
    lats = np.arange(-1.0, 1.01, 0.25)
    lons = -180.0 + 0.25 * np.arange(1440)
    U = np.tile(np.where(lons < 0, 1.0, 3.0), (lats.size, 1))[None]
    arm = A.ArmField("G", [6], lats, lons, U, U * 0)
    assert arm.global_lon
    assert arm.sample_steps(0.0, 179.875)[0][0, 0] == pytest.approx(2.0)     # halfway between 179.75 (3) and -180 (1)


def test_hourly_and_window_weights_known_answers():
    W = A.hourly_weights([6, 12, 18], [6, 9, 12, 20])
    assert np.allclose(W[1], [0.5, 0.5, 0.0]) and np.allclose(W[2], [0, 1, 0]) and np.isnan(W[3]).all()
    w, n = A.window_weights(range(6, 181, 6), 24)
    assert n == 25 and w.sum() == pytest.approx(1.0)
    hours = np.arange(12, 37)
    assert np.dot(w, np.arange(6, 181, 6)) == pytest.approx(hours.mean())    # a linear-in-time field averages to its centre
    assert A.window_weights(range(6, 181, 6), 24, mask=np.arange(25) < 19)[0] is None   # 19 < 20 hours
    assert A.window_weights(range(6, 181, 6), 6)[0] is None                  # only 13 defined hours at the first step


def test_lowpassed_velocity_of_a_constant_field_is_that_field():
    arm = arm_const(0.3, -0.2)
    vel = A.lowpassed_velocity_fn(arm)
    u, v = vel(np.array([31.0]), np.array([-118.0]), 0.5)
    assert u[0] == pytest.approx(0.3, abs=1e-3) and v[0] == pytest.approx(-0.2, abs=1e-3)


# ---- truth ------------------------------------------------------------------------------------------------------------
class Truth(T.HfrTruth):
    pass


def truth_const(u, v, hours, lats=np.arange(30.5, 32.51, 0.5), lons=np.arange(-119.5, -117.49, 0.5), fn=None):
    nh = len(hours)
    U = np.full((nh, lats.size, lons.size), u, float)
    V = np.full_like(U, v)
    if fn is not None:
        U, V = fn(np.asarray(hours), U, V)
    return T.HfrTruth("uswc", hours, lats, lons, U, V)


INIT = 495000                                            # an epoch hour at 00Z (495000 % 24 == 0)


def test_init_is_00z():
    assert INIT % 24 == 0


def test_m1_constant_fields_give_the_exact_vector_error():
    hours = list(range(INIT - 30, INIT + 200))
    tr = truth_const(0.3, 0.0, hours)
    cells = np.arange(25)
    out = M.m1_rows(tr, cells, INIT, 0, {"CMEMS_025": arm_const(0.4, 0.0), "GIOPS_025": arm_const(0.3, 0.1)})
    assert sorted(out) == [1, 3, 5, 7]
    for d in out.values():
        assert d["uo"].size == 25
        # 0.01 kn frame quantisation: |speed error| <= 0.0026 m/s, so e^2 = 0.01 +- 6e-4
        assert np.allclose(M.err2(d, "CMEMS_025"), 0.01, atol=6e-4) and np.allclose(M.err2(d, "GIOPS_025"), 0.01, atol=6e-4)


def test_the_25h_filter_removes_tides_from_the_truth():
    hours = list(range(INIT - 30, INIT + 200))
    tide = lambda h, U, V: (U + 0.5 * np.cos(2 * math.pi * h / 12.42)[:, None, None], V)   # noqa: E731
    tr = truth_const(0.2, 0.0, hours, fn=tide)
    d = M.m1_rows(tr, np.arange(25), INIT, 0, {"CMEMS_025": arm_const(0.2, 0.0)})[1]
    assert np.allclose(d["uo"], 0.2, atol=0.03)          # M2 tide amplitude 0.5 -> < 0.03 after the 25 h mean
    assert np.allclose(M.err2(d, "CMEMS_025"), 0.0, atol=1e-3)


def test_shared_mask_rows_dropped_for_all_arms_and_the_20h_rule():
    hours = list(range(INIT - 30, INIT + 200))

    def holes(h, U, V):
        U = U.copy()
        U[(h >= INIT + 12) & (h <= INIT + 17), 0, 0] = np.nan     # cell 0 misses 6 of the D1 window's hours: 19 < 20
        return U, V
    tr = truth_const(0.3, 0.0, hours, fn=holes)
    land = (slice(0, 13), slice(0, 3))                    # the arm's west columns (to -119.5) are land: those cells drop
    out = M.m1_rows(tr, np.arange(25), INIT, 0, {"CMEMS_025": arm_const(0.4, 0.0), "GIOPS_025": arm_const(0.3, 0.0, land=land)})
    d1 = out[1]
    assert 0 not in d1["cell"]                            # truth below the 20 h rule
    assert not any(c % 5 == 0 for c in d1["cell"])        # GIOPS land at the westmost cells: dropped for ALL arms
    assert d1["missing"]["GIOPS_025"] == 4 and d1["missing"]["CMEMS_025"] == 0
    assert out[3]["uo"].size == 20


def test_rotation_plant_rows_and_absent_arms():
    hours = list(range(INIT - 30, INIT + 200))
    tr = truth_const(0.0, 0.3, hours)
    arms = {"CMEMS_025": arm_const(0.0, 0.3), "GIOPS_025": arm_const(0.0, 0.3)}
    out = M.m1_rows(tr, np.arange(25), INIT, 7, arms, rotations={"GIOPS_025_rot60": ("GIOPS_025", 60.0)},
                    all_arms=["RTOFS_025"])
    d = out[1]
    m = M.plant_mask(7, 25)
    de = M.signed_dir_err(d, "GIOPS_025_rot60")
    assert np.allclose(de[m], 60.0, atol=0.5) and np.allclose(de[~m], 0.0, atol=0.5)
    assert np.isnan(d["fc"]["RTOFS_025"][0]).all() and d["uo"].size == 25      # an absent arm drops no rows


def test_speed_plant_is_along_the_vector():
    col = {"fc": {"G": (np.array([0.3]), np.array([0.4]))}, "uo": np.array([0.3]), "vo": np.array([0.4])}
    col = M.speed_plant(col, "G", 0.1, "G+")
    assert M.speed_err(col, "G+")[0] == pytest.approx(0.1)
    assert M.signed_dir_err(col, "G+")[0] == pytest.approx(0.0, abs=1e-9)


# ---- M2 ---------------------------------------------------------------------------------------------------------------
def test_advect_uniform_flow_and_beaching():
    vel = lambda la, lo, t: (np.full(np.size(la), 0.5), np.zeros(np.size(la)))   # noqa: E731
    res = M.advect(vel, [0.0], [0.0], 72)
    assert G.distance_km(0, 0, res["lat"][72, 0], res["lon"][72, 0]) == pytest.approx(0.5 * 72 * 3.6, rel=1e-3)
    wall = lambda la, lo: np.asarray(lo) > 0.5                                    # noqa: E731
    res = M.advect(vel, [0.0], [0.0], 72, is_land=wall)
    assert res["beached"][0] and 0.4 < res["lon"][72, 0] <= 0.5                  # stops at its last wet position


def _drifter(u_ms, hours, lat0=31.0, lon0=-118.5, missing=()):
    hourly = {}
    for h in hours:
        if h in missing:
            continue
        la, lo = G.from_local(u_ms * (h - hours[0]) * 3.6, 0.0, lat0, lon0)
        hourly[h] = (float(la), float(lo))
    return T.Track("D1", hourly)


def test_m2_perfect_field_still_and_the_20h_rule():
    hours = list(range(INIT - 30, INIT + 110))
    tracks = [_drifter(0.2, hours), _drifter(0.2, hours, missing=set(range(INIT + 60, INIT + 66)))]
    arms = {"CMEMS_025": arm_const(0.2, 0.0), "GIOPS_025": arm_const(0.0, 0.0)}
    rows = M.m2_rows(tracks, INIT, arms)
    assert len(rows) == 1                                  # the second drifter has 19 of 25 hours around +72 h
    r = rows[0]
    assert r["still_km"] == pytest.approx(0.2 * 72 * 3.6, rel=0.01)
    assert r["sep_km"]["CMEMS_025"] < 0.5                  # the field moves the particle with the drifter
    assert r["sep_km"]["GIOPS_025"] == pytest.approx(r["still_km"], rel=1e-6)      # a still field = STILL
    assert r["lw_skill"]["CMEMS_025"] > 0.95 and r["lw_skill"]["GIOPS_025"] == pytest.approx(0.0, abs=1e-5)


def test_m2_seed_off_an_arms_grid_scores_missing_not_still():
    hours = list(range(INIT - 30, INIT + 110))
    rows = M.m2_rows([_drifter(0.2, hours, lat0=10.0)], INIT, {"CMEMS_083": arm_const(0.2, 0.0)})
    assert rows[0]["sep_km"]["CMEMS_083"] is None and rows[0]["stalled"]["CMEMS_083"]


def test_zone_order_and_boxes():
    deep = G.Bathy(np.full((721, 1441), 4000.0))
    assert G.zone_of(35.0, -70.0, deep) == "WBC" and G.zone_of(30.0, 140.0, deep) == "WBC"
    assert G.zone_of(2.0, -140.0, deep) == "EQ" and G.zone_of(-30.0, -140.0, deep) == "OPEN"
    shelf = G.Bathy(np.full((721, 1441), 150.0))
    assert G.zone_of(-30.0, -140.0, shelf) == "SHELF"
    dep = np.full((721, 1441), 4000.0)
    dep[int((35.0 + 90) / 0.25), int((-70.25 + 180) / 0.25)] = 0.0                # land 23 km west: COAST50 wins over WBC
    assert G.zone_of(35.0, -70.0, G.Bathy(dep)) == "COAST50"

"""CONSENSUS_DIRECTION_VECTOR (DARK, 2026-11-03; HYBRID per the owner ~15:34Z): GFS's direction where the members
agree (R >= R_AGREE), their unit-vector mean where they disagree, GFS's again where they have no common direction.

The served direction is GFS's alone today, and the dark consensus product carried GFS's direction too
(`carried_from_primary`). Offline (lane B's l5 panel, 110 NDBC buoys, 108,651 buoy-hours, 2026-09-18..11-02, truth
NDBC MWD), the unweighted three-member vector mean reads 22.3 deg MAE against GFS's 27.0; held out by buoy half x week
half, +4.92 deg [+4.13, +5.86], but it LOSES to GFS where the members agree; the hybrid keeps GFS there (held out
+5.60 deg [+4.90, +6.33], no band worse). These pin what the flag must never get wrong: off is byte-identical to the
build before it existed; on, the threshold rule (just above / just below R_AGREE, and >= not >); the mean is circular (359 and 1 average to 0, never 180), every u/v pair is REBUILT so the
bearing it encodes is the consensus bearing and its length the consensus height, three bearings with no common
direction (R < R_MIN) keep GFS's, a missing member never yields a two-member direction under the consensus name, and
the metadata says which field is no longer GFS's.
"""
import hashlib
import math
import random

import pytest

from services.weather_pipeline import consensus_product as cp
from services.weather_pipeline import nearshore_validation
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.schemas import GridVector
from tests.test_consensus_product import LAND, _product, _spread_trio, _trio, _uniform

_FLAGS = ("CONSENSUS_DIRECTION_VECTOR", "CONSENSUS_PERIOD_MEDIAN", "ICON_PEAK_PERIOD")
GFS_E_I = ("GFS", "EURO", "ICON")


@pytest.fixture(autouse=True)
def _flags_unset(monkeypatch):
    for f in _FLAGS:
        monkeypatch.delenv(f, raising=False)
    monkeypatch.setattr(cp, "_SKIP_LOGGED", set())


def _on(monkeypatch):
    monkeypatch.setenv("CONSENSUS_DIRECTION_VECTOR", "1")


def _members(*dirs, hs=(1.0, 1.0, 1.0), tp=(9.0, 10.0, 11.0)):
    return {m: {"hs": h, "tp": t, "dir": d} for m, h, t, d in zip(GFS_E_I, hs, tp, dirs)}


def _circ_diff(a, b):
    return abs((a - b + 180.0) % 360.0 - 180.0)


def _uv_bearing(v):
    return math.degrees(math.atan2(-v.u, -v.v)) % 360.0


def _dir_trio(dirs, hs=(0.8, 1.0, 1.2), land=LAND, **kw):
    return tuple(_product(m, _uniform(h, d, 9.0 + i), land=land, **kw)
                 for i, (m, h, d) in enumerate(zip(GFS_E_I, hs, dirs)))


# ── off: byte-identical to the build before the flag existed ─────────────────────────────────────────────────────────

# sha256[:16] of build_equal_mean(...).model_dump_json() for test_consensus_product's fixtures, computed on origin/dev
# 12fdcd228 BEFORE this flag existed (scratch golden.py; same hashes after the change with the flag off). A deliberate
# change to the flag-off build must re-derive these, and say so in its log: that is the point of pinning them.
_PRE_FLAG_SHA = {("trio", "keep"): "d6b7ee79410e1c82", ("trio", "mask"): "16275be403e88fff",
                 ("spread", "keep"): "d0dc014c0ddedfbc", ("spread", "mask"): "60e79620f4b26857"}


@pytest.mark.parametrize("env", [None, "0", "", "true", "yes", "on", " 1"])
def test_flag_off_the_build_is_byte_identical_to_the_pre_flag_build(monkeypatch, env):
    if env is not None:
        monkeypatch.setenv("CONSENSUS_DIRECTION_VECTOR", env)
    assert cp.direction_mode() == "primary"
    for (name, unblended), want in _PRE_FLAG_SHA.items():
        trio = _trio() if name == "trio" else _spread_trio()
        got = cp.build_equal_mean(*trio, unblended=unblended).model_dump_json()
        assert hashlib.sha256(got.encode()).hexdigest()[:16] == want, (name, unblended)
        assert "dir_agreement" not in got and '"direction":{' not in got


def test_flag_off_equal_consensus_is_todays_three_keys():
    m = _members(90.0, 0.0, 0.0)
    assert cp.equal_consensus(m) == {"hs": 1.0, "tp": 9.0, "dir": 90.0}
    assert cp.equal_consensus(m, direction="primary") == {"hs": 1.0, "tp": 9.0, "dir": 90.0}
    with pytest.raises(ValueError, match="consensus: direction"):
        cp.equal_consensus(m, direction="median")


def test_grid_vector_omits_dir_agreement_when_none_and_carries_it_when_set():
    v = GridVector(lat=0.0, lng=0.0, speed=1.0, direction=10.0, u=-0.17, v=-0.98)
    assert "dir_agreement" not in v.model_dump() and "dir_agreement" not in v.model_dump_json()
    v.dir_agreement = 0.75
    assert v.model_dump()["dir_agreement"] == 0.75


# ── the mean itself: circular, unweighted, convention-exact ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("dirs,want", [
    ((359.0, 1.0, 0.0), 0.0), ((350.0, 10.0, 0.0), 0.0), ((355.0, 359.0, 3.0), 359.0),     # wraparound at north
    ((1.0, 359.0, 2.0), 0.6667), ((179.0, 181.0, 180.0), 180.0),                            # and at south
    ((80.0, 90.0, 100.0), 90.0), ((10.0, 10.0, 10.0), 10.0), ((0.0, 0.0, 90.0), 26.5651),
])
def test_the_mean_is_circular_across_north(dirs, want):
    d, r = cp.member_vector_direction(_members(*dirs))
    assert _circ_diff(d, want) < 1e-3, (d, want)
    assert 0.0 <= d < 360.0 and 0.0 <= r <= 1.0
    c = cp.equal_consensus(_members(*dirs), direction="vector")
    assert c["dir_agreement"] == pytest.approx(r)
    if r >= cp.R_AGREE:                    # they agree: GFS's own bearing, not their mean
        assert c["dir_from"] == "members_agree" and c["dir"] == dirs[0]
    else:
        assert c["dir_from"] == "vector_mean" and _circ_diff(c["dir"], want) < 1e-3


@pytest.mark.parametrize("dirs,want", [
    ((330.0, 30.0, 0.0), 0.0), ((300.0, 20.0, 340.0), 340.0), ((20.0, 300.0, 340.0), 340.0),   # disagree across north
    ((150.0, 210.0, 180.0), 180.0),
])
def test_where_members_disagree_the_mean_is_circular_across_north(dirs, want):
    """The arithmetic mean of 330, 30 and 0 is 120: in the regime where the hybrid USES the mean it must be circular."""
    c = cp.equal_consensus(_members(*dirs), direction="vector")
    assert cp.R_MIN <= c["dir_agreement"] < cp.R_AGREE
    assert c["dir_from"] == "vector_mean" and _circ_diff(c["dir"], want) < 1e-6, c


def _rotated_pair(t, x=40.0):
    """GFS = x + t, EURO = x, ICON = x - t: R = (1 + 2 cos t) / 3 and the mean is x, never GFS's bearing."""
    return _members(x + t, x, x - t)


def test_just_below_r_agree_uses_the_mean_and_just_above_keeps_gfs():
    t = math.degrees(math.acos((3 * cp.R_AGREE - 1) / 2))          # R == R_AGREE at t = 28.36 deg
    below = cp.equal_consensus(_rotated_pair(t + 0.05), direction="vector")
    above = cp.equal_consensus(_rotated_pair(t - 0.05), direction="vector")
    assert below["dir_agreement"] < cp.R_AGREE <= above["dir_agreement"]
    assert below["dir_from"] == "vector_mean" and _circ_diff(below["dir"], 40.0) < 1e-6
    assert above["dir_from"] == "members_agree" and above["dir"] == 40.0 + t - 0.05     # GFS's, not the mean (40)


def test_r_agree_is_inclusive_and_frozen(monkeypatch):
    assert cp.R_AGREE == 0.92 and cp.R_MIN < cp.R_AGREE < 1.0
    m = _rotated_pair(20.0)
    r = cp.member_vector_direction(m)[1]
    monkeypatch.setattr(cp, "R_AGREE", r)                             # exactly at the threshold: agree (>=)
    assert cp.equal_consensus(m, direction="vector")["dir_from"] == "members_agree"
    monkeypatch.setattr(cp, "R_AGREE", r + 1e-12)
    assert cp.equal_consensus(m, direction="vector")["dir_from"] == "vector_mean"


def test_agreeing_members_keep_gfs_even_when_the_mean_differs():
    c = cp.equal_consensus(_members(10.0, 20.0, 25.0), direction="vector")     # R ~ 0.98
    assert c["dir_from"] == "members_agree" and c["dir"] == 10.0
    assert c["dir_agreement"] > cp.R_AGREE


def test_359_and_1_never_average_to_180():
    """The arithmetic mean of 359, 1 and 0 is 120 and of (359, 1) 180: the mutant this pins."""
    d, r = cp.member_vector_direction(_members(359.0, 1.0, 0.0))
    assert _circ_diff(d, 0.0) < 1e-9 and r > 0.999


def test_the_mean_is_unweighted_by_height_or_period():
    assert (1 + 2 * math.cos(math.radians(60))) / 3 < cp.R_AGREE        # 0, 60, 120 disagree: the mean is used
    a = cp.equal_consensus(_members(0.0, 60.0, 120.0, hs=(0.2, 3.0, 9.0), tp=(5.0, 9.0, 20.0)), direction="vector")
    b = cp.equal_consensus(_members(0.0, 60.0, 120.0), direction="vector")
    assert a["dir"] == pytest.approx(60.0) == pytest.approx(b["dir"])
    assert a["dir_agreement"] == pytest.approx(b["dir_agreement"]) == pytest.approx((1 + 2 * math.cos(math.radians(60))) / 3)


def test_the_from_to_convention_cancels():
    """Mean of FROM bearings + 180 == mean of the TO bearings, with the same R: the convention is never flipped."""
    rng = random.Random(3)
    for _ in range(200):
        dirs = [rng.uniform(0, 360) for _ in range(3)]
        d_from, r_from = cp.member_vector_direction(_members(*dirs))
        d_to, r_to = cp.member_vector_direction(_members(*[(x + 180.0) % 360.0 for x in dirs]))
        assert r_from == pytest.approx(r_to, abs=1e-12)
        if r_from > 1e-6:
            assert _circ_diff(d_to, d_from + 180.0) < 1e-6


def test_two_agree_and_one_is_an_outlier():
    """A 2-vs-1 split never falls back (R >= 1/3) and lands between the pair and the outlier, nearer the pair."""
    c = cp.equal_consensus(_members(270.0, 270.0, 90.0), direction="vector")      # exactly opposite outlier
    assert c["dir_from"] == "vector_mean" and _circ_diff(c["dir"], 270.0) < 1e-6
    assert c["dir_agreement"] == pytest.approx(1 / 3)
    c = cp.equal_consensus(_members(250.0, 255.0, 30.0), direction="vector")
    assert c["dir_from"] == "vector_mean" and 252.5 < c["dir"] < 300.0              # 30 is 137.5 deg clockwise of 252.5
    assert _circ_diff(c["dir"], 252.5) < _circ_diff(c["dir"], 30.0)
    c = cp.equal_consensus(_members(10.0, 20.0, 100.0), direction="vector")
    assert c["dir_from"] == "vector_mean" and 15.0 < c["dir"] < 45.0                                                 # pulled toward the outlier, not to it


@pytest.mark.parametrize("dirs", [(0.0, 120.0, 240.0), (90.0, 210.0, 330.0), (0.0, 110.0, 250.0), (45.0, 165.0, 285.0)])
def test_opposite_members_have_no_mean_and_keep_gfs(dirs):
    d, r = cp.member_vector_direction(_members(*dirs))
    assert r < cp.R_MIN
    c = cp.equal_consensus(_members(*dirs), direction="vector")
    assert c["dir"] == dirs[0] and c["dir_from"] == "low_agreement"             # GFS's bearing, and why
    assert c["dir_agreement"] == pytest.approx(r) and c["hs"] == 1.0


def test_r_min_is_the_named_threshold():
    assert cp.R_MIN == 0.2
    # symmetric spread 0, +-t: R = (1 + 2 cos t) / 3 crosses 0.2 at cos t = -0.2, t = 101.54 deg
    t = math.degrees(math.acos(-0.2))
    below = cp.equal_consensus(_members(0.0, t + 0.5, -(t + 0.5)), direction="vector")
    above = cp.equal_consensus(_members(10.0 + t - 0.5, 10.0, 10.0 - (t - 0.5)), direction="vector")
    assert below["dir_from"] == "low_agreement" and below["dir"] == 0.0
    assert above["dir_from"] == "vector_mean" and _circ_diff(above["dir"], 10.0) < 1e-6


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), "x"])
@pytest.mark.parametrize("who", ["EURO", "ICON"])
def test_a_member_without_a_direction_gives_no_consensus_direction(bad, who):
    m = _members(10.0, 20.0, 30.0)
    m[who]["dir"] = bad
    c = cp.equal_consensus(m, direction="vector")
    assert c["dir"] == 10.0 and c["dir_from"] == "member_dir_invalid" and "dir_agreement" not in c


def test_a_missing_member_is_never_a_two_member_direction():
    m = _members(10.0, 20.0, 200.0)
    del m["ICON"]
    assert cp.equal_consensus(m, direction="vector") is None                     # no ICON: not a consensus at all
    pair = cp.equal_consensus(_members(10.0, 20.0, 200.0), nearshore_validation.PAIR_MEMBERS, direction="vector")
    assert pair == {"hs": 1.0, "tp": 9.0, "dir": 10.0}                          # the pair arm keeps GFS's direction


def test_equal_consensus_reads_the_flag_at_call_time(monkeypatch):
    m = _members(320.0, 40.0, 0.0)
    assert cp.equal_consensus(m)["dir"] == 320.0
    _on(monkeypatch)
    assert cp.direction_mode() == "vector"
    c = cp.equal_consensus(m)
    assert _circ_diff(c["dir"], 0.0) < 1e-9 and c["dir_from"] == "vector_mean"
    assert nearshore_validation.equal_consensus(m) == c                         # the judge's arm: same definition


# ── the build ────────────────────────────────────────────────────────────────────────────────────────────────────────

def _wrap_trio():
    """Members that DISAGREE across north everywhere (R ~ 0.84, below R_AGREE), with varying heights, so a
    non-circular mean would show as ~120-180 deg."""
    f = lambda a, d0: (lambda lat, lng: (a + 0.3 * math.sin(3 * lat), (d0 + 4 * math.cos(lng)) % 360,   # noqa: E731
                                         9 + math.cos(lat)))
    return tuple(_product(m, f(a, d0), land=LAND) for m, a, d0 in (("GFS", 0.9, 320.0), ("EURO", 1.1, 40.0),
                                                                   ("ICON", 1.4, 1.0)))


def test_flag_on_every_blended_cell_carries_the_vector_mean_and_consistent_uv(monkeypatch):
    _on(monkeypatch)
    gfs, euro, icon = _wrap_trio()
    out = cp.build_equal_mean(gfs, euro, icon)
    by = {m: {(v.lat, v.lng): v for v in p.grid.vectors} for m, p in zip(GFS_E_I, (gfs, euro, icon))}
    n = 0
    for before, after in zip(gfs.grid.vectors, out.grid.vectors):
        if not before.is_valid:
            assert after.model_dump() == before.model_dump()
            continue
        mv = {m: {"dir": by[m][(before.lat, before.lng)].direction} for m in GFS_E_I}
        want, r = cp.member_vector_direction(mv)
        assert cp.R_MIN <= r < cp.R_AGREE
        hs = sum(math.hypot(by[m][(before.lat, before.lng)].u, by[m][(before.lat, before.lng)].v) for m in GFS_E_I) / 3
        assert _circ_diff(after.direction, want) < 0.006                         # rounded to 2 decimals
        assert _circ_diff(after.direction, 0.0) < 20.0                           # never the arithmetic 180-ish
        assert _circ_diff(_uv_bearing(after), want) < 0.02                       # u/v ENCODE the consensus bearing
        assert math.hypot(after.u, after.v) == pytest.approx(after.speed, abs=2e-4) == pytest.approx(hs, abs=5e-4)
        assert after.dir_agreement == pytest.approx(r, abs=5e-5)
        assert after.period == before.period                                     # period untouched by this flag
        n += 1
    d = out.grid.diagnostics["consensus"]
    assert n == d["cells"]["blended"] > 0
    assert d["direction"]["cells"] == {"vector_mean": n, "members_agree": 0, "low_agreement": 0, "member_dir_invalid": 0}


def test_flag_on_the_product_answers_at_a_point_what_the_judges_arm_computes(monkeypatch):
    """ONE definition with the flag on: at every GFS node /point on the built product gives the direction
    equal_consensus computes from the three members' /point answers there."""
    _on(monkeypatch)
    wavy = lambda a, d0: (lambda lat, lng: (a + 0.4 * math.sin(3 * lat), (d0 + 50 * math.sin(lat + lng)) % 360,  # noqa: E731
                                            8 + 3 * math.cos(lat)))
    gfs, euro, icon = (_product(m, wavy(a, d0), land=LAND) for m, a, d0 in (("GFS", 0.9, 200.0), ("EURO", 1.1, 240.0),
                                                                            ("ICON", 1.4, 300.0)))
    out = cp.build_equal_mean(gfs, euro, icon)
    s = PointSampler()
    for v in random.Random(11).sample([v for v in gfs.grid.vectors if v.is_valid], 25):
        members = {m: cp.member_answer(s, p, v.lat, v.lng) for m, p in zip(GFS_E_I, (gfs, euro, icon))}
        want = nearshore_validation.equal_consensus(members)
        got = s.sample_point(out, v.lat, v.lng).point
        assert want["dir_from"] == "vector_mean"
        assert _circ_diff(got.direction, want["dir"]) < 0.01 and got.speed == pytest.approx(want["hs"], abs=3e-4)
        assert _circ_diff(math.degrees(math.atan2(-got.u, -got.v)), want["dir"]) < 0.02


def test_flag_on_interpolated_points_between_nodes_read_the_consensus_bearing(monkeypatch):
    """Off the node /point interpolates (u, v), not `direction`: with u/v only SCALED the bearing there would stay
    GFS's. Uniform members make the expected bearing exact everywhere."""
    _on(monkeypatch)
    out = cp.build_equal_mean(*_dir_trio((320.0, 40.0, 10.0), land=lambda lat, lng: False))
    want, r = cp.member_vector_direction(_members(320.0, 40.0, 10.0))
    assert r < cp.R_AGREE
    s = PointSampler()
    for lat, lng in ((27.13, -80.61), (28.4, -79.9), (27.9, -80.07)):
        pt = s.sample_point(out, lat, lng).point
        assert pt.interpolation_method not in ("exact_match", "unavailable")
        assert _circ_diff(pt.direction, want) < 0.02 and pt.speed == pytest.approx(1.0, abs=5e-4)


def test_flag_on_opposite_members_keep_gfs_bearing_scaled_and_are_counted(monkeypatch):
    _on(monkeypatch)
    gfs, euro, icon = _dir_trio((0.0, 120.0, 240.0))
    out = cp.build_equal_mean(gfs, euro, icon)
    blended = [(a, b) for a, b in zip(gfs.grid.vectors, out.grid.vectors) if a.is_valid]
    for before, after in blended:
        assert after.direction == before.direction == 0.0 and _circ_diff(_uv_bearing(after), 0.0) < 0.01
        assert after.speed == pytest.approx(1.0) and after.dir_agreement == pytest.approx(0.0, abs=1e-4)
    d = out.grid.diagnostics["consensus"]["direction"]
    assert d["cells"] == {"vector_mean": 0, "members_agree": 0, "low_agreement": len(blended), "member_dir_invalid": 0}
    assert d["dir_agreement"]["median"] == 0.0 and d["r_min"] == cp.R_MIN


def test_flag_on_a_member_that_cannot_answer_leaves_the_gfs_cell_untouched(monkeypatch):
    _on(monkeypatch)
    gfs = _product("GFS", _uniform(0.8, 320.0, 9.0))
    euro = _product("EURO", _uniform(1.0, 40.0, 10.0), box=(-81.0, 27.0, -80.0, 29.0))   # covers the west half only
    icon = _product("ICON", _uniform(1.2, 10.0, 11.0))
    out = cp.build_equal_mean(gfs, euro, icon)
    want, _ = cp.member_vector_direction(_members(320.0, 40.0, 10.0))
    for before, after in zip(gfs.grid.vectors, out.grid.vectors):
        if before.lng > -80.0:
            assert after.model_dump() == before.model_dump()                     # never a GFS/ICON two-member bearing
            assert after.dir_agreement is None
        else:
            assert _circ_diff(after.direction, want) < 0.006
    masked = cp.build_equal_mean(gfs, euro, icon, unblended="mask")
    assert all((not a.is_valid) if b.lng > -80.0 else _circ_diff(a.direction, want) < 0.006
               for b, a in zip(gfs.grid.vectors, masked.grid.vectors))


def test_flag_on_metadata_drops_direction_from_carried_and_reports_agreement(monkeypatch):
    """_trio's members (90, 100, 110 deg) AGREE (R 0.99): every cell keeps GFS's bearing, scaled exactly as today, and
    the metadata still says the direction is the hybrid's choice, with R on every cell."""
    base = cp.build_equal_mean(*_trio())
    _on(monkeypatch)
    out = cp.build_equal_mean(*_trio())
    d = out.grid.diagnostics["consensus"]
    assert d["carried_from_primary"] == ["period"] and d["method"] == "equal_mean"
    assert set(d) == set(base.grid.diagnostics["consensus"]) | {"direction"}
    r = cp.member_vector_direction(_members(90.0, 100.0, 110.0))[1]
    assert r >= cp.R_AGREE
    assert d["direction"] == {"method": "hybrid_vector_mean", "flag": "CONSENSUS_DIRECTION_VECTOR",
                              "members": list(GFS_E_I), "weights": "equal", "r_min": 0.2, "r_agree": 0.92,
                              "cells": {"vector_mean": 0, "members_agree": d["cells"]["blended"], "low_agreement": 0,
                                        "member_dir_invalid": 0},
                              "dir_agreement": {q: round(r, 3) for q in ("p10", "median", "p90")}}
    for a, b in zip(base.grid.vectors, out.grid.vectors):     # agree: today's cell, plus R
        assert (b.direction, b.u, b.v, b.speed) == (a.direction, a.u, a.v, a.speed)
        assert b.dir_agreement == (round(r, 4) if a.is_valid else None)


def test_with_the_period_median_both_fields_leave_carried(monkeypatch):
    _on(monkeypatch)
    monkeypatch.setenv("CONSENSUS_PERIOD_MEDIAN", "1")
    monkeypatch.setenv("ICON_PEAK_PERIOD", "1")
    out = cp.build_equal_mean(*_spread_trio())
    d = out.grid.diagnostics["consensus"]
    assert d["carried_from_primary"] == [] and d["period"]["method"] == "member_median"
    assert d["direction"]["cells"]["members_agree"] == d["cells"]["blended"] > 0     # identical member bearings
    monkeypatch.setenv("CONSENSUS_DIRECTION_VECTOR", "0")
    assert cp.build_equal_mean(*_spread_trio()).grid.diagnostics["consensus"]["carried_from_primary"] == ["direction"]


def test_the_flag_is_registered_and_declared_dark():
    from pathlib import Path
    repo = Path(__file__).resolve().parents[2]
    reg = (repo / "backend" / "routes" / "admin" / "surf_forecast.py").read_text("utf-8")
    assert '"CONSENSUS_DIRECTION_VECTOR": ("0",' in reg
    pilots = (repo / ".github" / "workflows" / "forecast-ingest-pilots.yml").read_text("utf-8")
    assert "          CONSENSUS_DIRECTION_VECTOR: '0'" in pilots
    assert cp.DIRECTION_VECTOR_FLAG == "CONSENSUS_DIRECTION_VECTOR"

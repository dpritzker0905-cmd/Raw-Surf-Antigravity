"""Mask, rows, seam, gates, controls and the whole scored decision for the long-range wind v2 registration, on SYNTHETIC
rows with a known answer. No network, no real data."""
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_lr2_geo as G  # noqa: E402
import wind_lr2_rows as W  # noqa: E402
import wind_lr2_runs as R  # noqa: E402
import wind_lr2_score as SC  # noqa: E402
import wind_lr2_stats as S  # noqa: E402

UTC = timezone.utc


# ------------------------------------------------------------------------------------------------ mask
def _coast():
    lats = np.arange(33.5, 34.5, 0.002)
    lons = np.arange(-120.6, -119.6, 0.002)
    elev = np.where(lons[None, :] > -120.0, 10.0, -50.0) * np.ones((len(lats), 1))     # land east of -120, sea west
    return G.EtopoMask([(elev, lats, lons)])


def test_mask_land_and_segment_crossing():
    m = _coast()
    assert m.is_land(34.0, -119.9) and not m.is_land(34.0, -120.3)
    assert not G.segment_crosses_land(m.is_land, 34.0, -120.3, 34.0, -120.1)
    assert G.segment_crosses_land(m.is_land, 34.0, -120.3, 34.0, -119.8)
    with pytest.raises(LookupError):
        m.elevation(10.0, 10.0)                       # never a guess outside a fetched window


def test_marine_exposed_rule():
    m = _coast()
    buoy = {"id": "b", "kind": "ndbc", "type": "buoy", "lat": 34.0, "lon": -120.5}
    assert G.marine_exposed(buoy, None, m.is_land)                                  # a buoy always qualifies
    pier = {"id": "p", "kind": "ndbc", "type": "fixed", "lat": 34.0, "lon": -120.004}
    assert G.marine_exposed(pier, 270.0, m.is_land)                                 # on the shoreline, sea to the west
    assert not G.marine_exposed(pier, 90.0, m.is_land)                              # sector pointing at the land
    assert not G.marine_exposed(pier, None, m.is_land)                              # no paired spot: sector rule unmet
    inland = {"id": "i", "kind": "asos", "lat": 34.0, "lon": -119.85}
    assert not G.marine_exposed(inland, 270.0, m.is_land)                           # not within 1 km of the shoreline


def test_destination_roundtrip():
    la, lo = G.destination(34.0, -120.0, 90.0, 10.0)
    assert G.distance_km(34.0, -120.0, la, lo) == pytest.approx(10.0, abs=0.01)


# ------------------------------------------------------------------------------------------------ wind factor
def test_wind_factor_is_the_ratings_own_function():
    from services.weather_pipeline import surf_rating as SR
    f = W.wind_factor(np.array([8.0]), np.array([270.0]), np.array([270.0]))        # strong onshore (from the sea)
    assert f[0] == pytest.approx(SR.wind_quality(8.0, 270.0, 270.0) * SR.wind_gate(8.0, 270.0, 270.0))
    assert np.isnan(W.wind_factor(np.array([8.0]), np.array([270.0]), np.array([np.nan]))[0])
    off = W.wind_factor(np.array([3.0]), np.array([90.0]), np.array([270.0]))[0]
    assert off > f[0]                                                                # light offshore beats onshore blow-out


def test_from_dir_and_vec_roundtrip():
    u, v = W.vec_from_obs(5.0, 270.0)                                                # wind FROM the west blows toward +u
    assert (round(u, 6), round(v, 6)) == (5.0, 0.0)
    assert float(W.from_dir(u, v)) == pytest.approx(270.0)


# ------------------------------------------------------------------------------------------------ seam
def test_seam_rule_compares_p95_to_native_changes():
    native = np.abs(np.random.default_rng(1).normal(0, 1.0, 500))
    assert SC.seam_ok(np.full(100, 1.0), np.full(100, 0.5), native)["ok"]            # a 0.5 m/s step sits inside native noise
    assert not SC.seam_ok(np.full(100, 9.0), np.full(100, 0.5), native)["ok"]        # an 8.5 m/s jump does not
    assert not SC.seam_ok(np.array([]), np.array([]), native)["ok"]


def _edge_rows(jump_at_216):
    rows = {k: [] for k in ("run", "hour", "st", "lead", "X_s")}
    rng = np.random.default_rng(2)
    for r in range(20):
        v = 5.0
        for L in range(186, 337, 6):
            v += 0.5
            if jump_at_216 and L == 216:
                v += 6.0
            for k, x in (("run", r), ("hour", 0), ("st", 0), ("lead", L), ("X_s", v)):
                rows[k].append(x)
    return {k: np.array(v) for k, v in rows.items()}


def test_edge_check_catches_a_step_at_a_bin_edge():
    assert SC.edge_ok(_edge_rows(False), "X")["ok"]
    assert not SC.edge_ok(_edge_rows(True), "X")["ok"]


def test_halves_split_by_run_not_by_calendar():
    rows = {"init_ts": np.repeat(np.arange(90) * 12.0, 3)}
    h = SC.halves(rows)
    assert h.sum() == 135 and h[:135].all() and not h[135:].any()


# ------------------------------------------------------------------------------------------------ whole decision
NST = 12
C_U, C_V = 1.0, 0.5
STATIONS = [{"id": f"S{i}", "lat": [34.0, 40.0, 21.0][i % 3], "lon": [-120.5, -70.0, -157.0][i % 3], "kind": "ndbc", "type": "buoy"}
            for i in range(NST)]
PAIRING = {f"S{i}": {"marine": True, "shore_normal": 270.0, "spot": f"sp{i}"} for i in range(NST)}


def _anom(valid, i):
    h6 = int(valid.timestamp() // 21600)
    g = np.random.default_rng(h6 * 31 + i).normal(0, 2.5, 2)
    return g[0], g[1]


def _truth(i, valid):
    au, av = _anom(valid, i)
    u, v = C_U + au, C_V + av
    sp = float(np.hypot(u, v))
    d = float(W.from_dir(u, v))
    return u, v, sp, d, sp * 1.3


def _clim_at(valid):
    return np.full(NST, C_U), np.full(NST, C_V), np.full(NST, 3.5)


def _coefs(alpha=1.0):
    k = {"alpha": alpha, "beta": 1.0, "gamma": 0.0, "gf": 1.3, "borrowed": False}
    one = {"center": 0.0, "regions": {"POOLED": k}}
    return {arm: {"bins": {b: dict(one, center=c) for b, c in R.CENTRES.items()}} for arm in W.CAL_SETS}


def _make_runs(n_runs, skilled, seed=0):
    rng = np.random.default_rng(seed)
    inits = R.test_window_runs()[:n_runs]
    runs = {}
    for init in inits:
        z = {}
        for step in R.STEPS:
            valid = init + timedelta(hours=step)
            for sysname, n in (("aigefs", 31), ("gefs", 31), ("ifs", 51)):
                au = np.array([_anom(valid, i)[0] for i in range(NST)])
                av = np.array([_anom(valid, i)[1] for i in range(NST)])
                sig = 0.6 if skilled else 0.0
                bu = C_U + (au if skilled else rng.normal(0, 2.5, NST))
                bv = C_V + (av if skilled else rng.normal(0, 2.5, NST))
                u = bu + rng.normal(0, 0.4, (n, NST))
                v = bv + rng.normal(0, 0.4, (n, NST))
                key = (("ifs_10u_%d", "ifs_10v_%d") if sysname == "ifs" else (sysname + "_u_%d", sysname + "_v_%d"))
                z[key[0] % step], z[key[1] % step] = u + sig * 0, v
        for k in range(18, 337, 6):                                  # HRES native leads, correlated to their OWN valid time
            valid = init + timedelta(hours=k)
            z[f"cmp_hres_10u_{k}"] = np.array([C_U + _anom(valid, i)[0] + rng.normal(0, 0.4) for i in range(NST)])
            z[f"cmp_hres_10v_{k}"] = np.array([C_V + _anom(valid, i)[1] + rng.normal(0, 0.4) for i in range(NST)])
        for L in R.SCORED_LEADS:
            z[f"cmp_gfs_u_{L}"] = rng.normal(C_U, 2.5, NST)
            z[f"cmp_gfs_v_{L}"] = rng.normal(C_V, 2.5, NST)
            z[f"cmp_gfs_g_{L}"] = np.full(NST, 5.0)
        runs[init] = z
    return runs


@pytest.fixture(scope="module")
def skilled_doc():
    runs = _make_runs(90, True)
    rows = W.build_rows(runs, STATIONS, PAIRING, _clim_at, _coefs(), _truth)
    doc = SC.score_rows(rows, W.native_changes(runs, NST), 90, {"US_PACIFIC": 12, "US_ATLANTIC_GULF": 12, "HAWAII": 12},
                        [], SC.fit_test_disjoint(R.fit_runs(), R.test_window_runs()), reps=2000, control_reps=300)
    return doc, rows


def test_rows_have_registered_columns_and_comparator_rules(skilled_doc):
    _doc, rows = skilled_doc
    for k in ("run", "st", "lead", "vday", "region", "marine", "sn", "o_u", "o_s", "o_s_p7", "o_s_p48", "GRAND_CAL_s",
              "AIGEFS_CAL_s", "CLIM_SERVE_s", "LOOP_PROXY_s", "GFS_s", "IFS_RAW_s", "hres240_s"):
        assert k in rows, k
    assert np.all(np.isnan(rows["GFS_s"][rows["lead"] <= 240])) and np.isfinite(rows["GFS_s"][rows["lead"] > 240]).all()
    assert np.isfinite(rows["LOOP_PROXY_s"]).all()
    assert np.allclose(rows["CLIM_SERVE_s"], rows["CLIM_s"])
    assert len(rows["lead"]) == 90 * len(R.SCORED_LEADS) * NST


def test_skilled_arms_beat_loop_gfs_and_climatology_and_all_controls_hold(skilled_doc):
    doc, _ = skilled_doc
    assert doc["void_reasons"] == [] and all(v["ok"] for v in doc["controls"].values()), doc["controls"]
    assert len(doc["f1"]) == 20 and len(doc["f3"]) == 6
    assert doc["f1"]["GRAND_CAL|M1|LOOP_PROXY|B1"]["sig"] and doc["f1"]["GRAND_CAL|M1|GFS|B3"]["sig"]
    assert doc["f3"]["GRAND_CAL|B1"]["sig"] and doc["f3"]["GRAND_CAL|B2"]["sig"]
    assert doc["verdict"] == "PASS"
    assert doc["tails"]["ICON"]["decision"].startswith("GRAND_CAL") and doc["tails"]["ICON"]["decision"].endswith("PENDING_ICON_SEAM")
    assert "CLIM_SERVE" not in doc["tails"]["ICON"]                       # gatekeeping: not tested when a calibrated arm passes


def test_a_short_collection_is_void_not_fail():
    runs = _make_runs(70, True, seed=4)
    rows = W.build_rows(runs, STATIONS, PAIRING, _clim_at, _coefs(), _truth)
    doc = SC.score_rows(rows, W.native_changes(runs, NST), 70, {"US_PACIFIC": 12, "US_ATLANTIC_GULF": 12, "HAWAII": 12}, [],
                        SC.fit_test_disjoint(R.fit_runs(), R.test_window_runs()), reps=100, control_reps=100)
    assert doc["verdict"] == "VOID" and any("kept TEST runs" in v for v in doc["void_reasons"])


def test_a_freeze_mismatch_voids_and_shared_init_dates_void():
    runs = _make_runs(90, True, seed=5)
    rows = W.build_rows(runs, STATIONS, PAIRING, _clim_at, _coefs(), _truth)
    ft = SC.fit_test_disjoint(R.fit_runs(), R.test_window_runs())
    doc = SC.score_rows(rows, W.native_changes(runs, NST), 90, {"A": 12, "B": 12, "C": 12}, ["coefficients:GRAND_CAL"], ft,
                        reps=100, control_reps=100)
    assert doc["verdict"] == "VOID" and any("freeze mismatch" in v for v in doc["void_reasons"])
    assert not SC.fit_test_disjoint([datetime(2026, 12, 1, tzinfo=UTC)], R.test_window_runs())["ok"]


def test_unskilled_arms_fail_and_open_the_clim_serve_gate():
    runs = _make_runs(90, False, seed=6)
    rows = W.build_rows(runs, STATIONS, PAIRING, _clim_at, _coefs(), _truth)
    doc = SC.score_rows(rows, W.native_changes(runs, NST), 90, {"A": 12, "B": 12, "C": 12}, [],
                        SC.fit_test_disjoint(R.fit_runs(), R.test_window_runs()), reps=200, control_reps=200)
    assert doc["verdict"] in ("FAIL", "VOID")                                 # never PASS on noise
    for tail in ("ICON", "EURO"):
        assert not doc["tails"][tail]["GRAND_CAL"]["pass"] and not doc["tails"][tail]["AIGEFS_CAL"]["pass"]
        assert "CLIM_SERVE" in doc["tails"][tail]                             # both calibrated arms failed: climatology is tested
    assert len(doc["tails"]["ICON"]["CLIM_SERVE"]["F1c"]) == 6 and len(doc["tails"]["EURO"]["CLIM_SERVE"]["F1c"]) == 4


def test_a_leaky_shuffle_control_voids(skilled_doc):
    _doc, rows = skilled_doc
    leaky = dict(rows, o_s_p7=rows["o_s"])                                     # an instrument that did not actually shift truth
    ctl = SC.controls(leaky, reps=200)
    assert not ctl["shuffled"]["ok"]
    unshifted = dict(rows, o_s_p48=rows["o_s"])
    assert not SC.controls(unshifted, reps=200)["shifted"]["ok"]


def test_great_lakes_buoys_are_never_marine_exposed():
    lats = np.arange(41.5, 42.3, 0.002)
    lons = np.arange(-88.2, -87.0, 0.002)
    elev = np.where(lons[None, :] > -87.5, 10.0, -50.0) * np.ones((len(lats), 1))       # a lake west of a shore at -87.5
    mask = G.EtopoMask([(elev, lats, lons)])
    buoy = {"id": "45007", "kind": "ndbc", "type": "buoy", "lat": 41.9, "lon": -87.8}
    assert not G.marine_exposed(buoy, None, mask.is_land)                                # a lake buoy never qualifies
    assert G.marine_exposed(dict(buoy, lat=34.0, lon=-120.5), None, _coast().is_land)    # the same buoy type at sea does
    spots = [{"id": "s", "lat": 41.9, "lon": -87.79, "shore_normal": 270.0}]
    assert G.pair_list([buoy], spots, mask)["45007"]["marine"] is False                  # the region rule excludes the lake


def test_wind_factor_does_not_depend_on_the_ci_environment(monkeypatch):
    args = (np.array([8.0, 3.0]), np.array([270.0, 90.0]), np.array([270.0, 270.0]))
    monkeypatch.delenv("RATING_WIND_GATE", raising=False)
    on = W.wind_factor(*args)
    monkeypatch.setenv("RATING_WIND_GATE", "0")                                          # a CI environment that disables the veto
    assert np.array_equal(W.wind_factor(*args), on)


def test_controls_default_to_the_registered_bootstrap_size():
    import inspect
    assert inspect.signature(SC.controls).parameters["reps"].default == S.REPS == 10_000
    assert inspect.signature(SC.score_rows).parameters["control_reps"].default == 10_000

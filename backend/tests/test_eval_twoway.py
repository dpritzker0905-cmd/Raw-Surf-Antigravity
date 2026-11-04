"""D-065: the binding two-way (spatial block x UTC day) bootstrap and its null self-test. PURE, offline, seeded."""
import dataclasses
import math
import os
import random
import statistics
import sys
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import eval_gate as eg
from services.weather_pipeline import eval_scoring as sc
from services.weather_pipeline import eval_twoway as tw

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(os.path.dirname(HERE), "scripts")
T0 = datetime(2026, 10, 1, tzinfo=timezone.utc)
CFG = dataclasses.replace(eg.harness_config(), bootstrap_reps=400)


# ---- geometry ---------------------------------------------------------------------------------------------------
def test_haversine_one_degree_of_latitude():
    assert tw.hav_km((33.0, -118.0), (34.0, -118.0)) == pytest.approx(111.195, abs=0.01)


def test_complete_linkage_does_not_chain_and_is_order_free():
    # three stations 60 km apart in a row: single linkage at 100 km would make ONE block (0-60-120 km); complete
    # linkage keeps every block's diameter <= 100 km, so the far one stands alone. A fourth station 300 km away too.
    step = 60.0 / 111.195
    coords = {"a": (33.0, -118.0), "b": (33.0 + step, -118.0), "c": (33.0 + 2 * step, -118.0), "z": (36.0, -118.0)}
    blk = tw.spatial_blocks(coords)
    assert blk == {"a": "a", "b": "a", "c": "c", "z": "z"}
    rev = tw.spatial_blocks(dict(reversed(list(coords.items()))))
    assert rev == blk
    assert len(set(tw.spatial_blocks(coords, km=200).values())) == 2
    assert tw.spatial_blocks({"x": None, "a": (33.0, -118.0)}) == {"a": "a", "x": tw.UNLOCATED}


def test_the_committed_station_list_makes_three_blocks():
    import json
    with open(os.path.join(SCRIPTS, "eval_harness_stations.json"), encoding="utf-8") as f:
        st = json.load(f)["stations"]
    blk = tw.spatial_blocks({s["id"]: (s["lat"], s["lng"]) for s in st})
    # Santa Monica Bay (103p1 + 46025), the Golden Gate (142p1), San Diego (153p1, 262p1 and 46086, 87-92 km off):
    # pinned so a change of the rule shows up here.
    assert blk == {"103p1": "103p1", "46025": "103p1", "142p1": "142p1", "153p1": "153p1", "262p1": "153p1",
                   "46086": "153p1"}


# ---- t quantile -------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("df,q", [(1, 12.7062), (3, 3.18245), (13, 2.16037), (30, 2.04227), (1e6, 1.95997)])
def test_t_quantile_matches_tables(df, q):
    assert tw.t_quantile(0.975, df) == pytest.approx(q, abs=2e-4)


# ---- the bootstrap: known answers -------------------------------------------------------------------------------
def _items(gain_of, days=14, stations=(("A", 33.0, -118.0), ("B", 33.1, -118.1)), per_day=4):
    out = []
    for d in range(days):
        for k in range(per_day):
            t = T0 + timedelta(days=d, hours=6 * k)
            for sid, lat, lng in stations:
                g = gain_of(sid, d, k)
                out.append({"buoy": sid, "t": t, "lead": 24, "obs": 1.0, "f_ref": 6.0 + g, "f_cand": 6.0,  # d = g
                            "lat": lat, "lng": lng})
    return out


def test_one_block_reduces_to_the_classic_t_interval_over_days():
    # gain = a day effect only (every station, every hour of the day): one block, so the two-way CI must be the
    # Student t interval of the 14 day means: m +/- t(13) s / sqrt(14).
    eff = [0.3, -0.1, 0.5, 0.2, 0.0, 0.4, 0.1, 0.6, -0.2, 0.3, 0.2, 0.1, 0.5, 0.0]
    r = tw.two_way_ci(_items(lambda s, d, k: eff[d]), reps=20000, seed=5)
    m, s = statistics.mean(eff), statistics.stdev(eff)
    half = tw.t_quantile(0.975, 13) * s / math.sqrt(14)
    assert r["computable"] and r["blocks"] == 1 and r["days"] == 14
    assert r["mean"] == pytest.approx(m, abs=1e-12)
    assert r["df"] == pytest.approx(13.0) and r["factor"] == pytest.approx(14 / 13)
    assert (r["ci"][1] - r["ci"][0]) / 2 == pytest.approx(half, rel=0.03)


def test_constant_and_zero_gains():
    # an unchanged candidate: every station untouched, nothing left to judge (never a PASS)
    z = tw.two_way_ci(_items(lambda s, d, k: 0.0), reps=200)
    assert z["computable"] is False and z["ci"] is None and z["untouched_stations"] == ["A", "B"]
    # a station the arm never changes leaves the binding CI (its gain is 0 by construction), the others stay
    part = tw.two_way_ci(_items(lambda s, d, k: 0.2 if s == "A" else 0.0, stations=(("A", 33, -118), ("B", 37, -122))),
                         reps=200)
    assert part["untouched_stations"] == ["B"] and part["blocks"] == 1 and part["mean"] == pytest.approx(0.2)
    c = tw.two_way_ci(_items(lambda s, d, k: 0.25), reps=200)
    assert c["ci"][0] == pytest.approx(0.25) and c["ci"][1] == pytest.approx(0.25)


def test_fewer_than_14_utc_days_is_not_computable():
    r = tw.two_way_ci(_items(lambda s, d, k: 0.2, days=13), reps=100)
    assert r["computable"] is False and r["ci"] is None and r["days"] == 13 and "13 UTC target days < 14" in r["reason"]
    assert tw.two_way_ci(_items(lambda s, d, k: 0.2, days=14), reps=100)["computable"] is True
    assert tw.two_way_ci([], reps=10)["computable"] is False


def test_rows_without_coordinates_share_one_block():
    its = [dict(i, lat=None, lng=None) for i in _items(lambda s, d, k: 0.1,
                                                         stations=(("A", 33, -118), ("B", 40, -124)))]
    r = tw.two_way_ci(its, reps=50)
    assert r["blocks"] == 1 and r["unlocated"] == ["A", "B"]


def test_the_two_way_ci_is_seeded():
    its = _items(lambda s, d, k: (d % 3) * 0.1 + (0.05 if s == "A" else 0.0))
    assert tw.two_way_ci(its, reps=300, seed=1)["ci"] == tw.two_way_ci(its, reps=300, seed=1)["ci"]


# ---- why: the station-cluster CI falsely passes correlated nulls; the two-way one does not ----------------------
def _day_null(rng, stations=11, days=14):
    """One null panel: a day shock shared by every station (rho ~0.75 of daily gains, as round 6 measured)."""
    out = []
    for d in range(days):
        a = rng.gauss(0, 1.0)
        for s in range(stations):
            for k in range(2):
                out.append({"buoy": f"S{s}", "t": T0 + timedelta(days=d, hours=12 * k), "obs": 1.0,
                            "f_ref": 1.0 + a + rng.gauss(0, 0.6), "f_cand": 1.0,
                            "lat": 33.0 + 0.05 * s, "lng": -118.0})
    return out


def test_day_correlated_nulls_fool_the_station_cluster_ci_but_not_the_two_way_ci():
    rng = random.Random(11)
    st_fp = tw_fp = 0
    sets = 80
    for k in range(sets):
        its = _day_null(rng)
        # the gain series as rows: d = |f_ref - obs| - |f_cand - obs| needs a signed gain, so recentre on f_ref
        its = [dict(i, f_ref=i["obs"] + 5.0 + (i["f_ref"] - i["obs"]), f_cand=i["obs"] + 5.0) for i in its]
        st_fp += sc.station_cluster_boot(its, reps=200, seed=k)["ci"][0] > 0
        tw_fp += tw.two_way_ci(its, reps=200, seed=k)["ci"][0] > 0
    assert st_fp / sets > 0.25           # the retired rule: round 6 measured 31-35%
    assert tw_fp / sets <= 0.05


# ---- the self-test (pinned) -------------------------------------------------------------------------------------
def test_the_canonical_self_test_is_pinned():
    r = tw.self_test()
    assert r["layout"] == {"stations": 12, "blocks": 4, "days": 14, "rows": 2016}
    assert r["false_pass"] == {"day": 0.025, "block_x_day": 0.0025, "daily_field": 0.0, "mixed": 0.0225}
    assert r["advisory_nulls"] == {"block": 0.0625, "persistent_field": 0.065}      # the stated LIMIT, reported
    assert r["power"]["rate"] == 0.915 and r["power"]["effect_in_null_sd"] == 4.0
    assert r["worst_false_pass"] <= tw.MAX_FALSE_PASS == 0.05 and r["power"]["rate"] >= tw.MIN_POWER == 0.80
    assert r["ok"] is True and tw.require_calibrated() is r


def test_a_failed_self_test_refuses_the_harness_before_any_download(monkeypatch, tmp_path):
    monkeypatch.setattr(tw, "self_test", lambda: {"ok": False, "reasons": ["null day falsely passes 9.0% > 5%"]})
    with pytest.raises(tw.CalibrationFailed, match="null day falsely passes"):
        tw.require_calibrated()
    if SCRIPTS not in sys.path:
        sys.path.insert(0, SCRIPTS)
    import eval_harness as eh

    def no_network(*a, **k):
        raise AssertionError("the harness touched the network before its self-test")
    args = eh.parser().parse_args(["run", "--start", "2026-10-20T00:00Z", "--end", "2026-10-21T00:00Z",
                                   "--cache-dir", str(tmp_path / "c"), "--out", str(tmp_path / "o")])
    with pytest.raises(tw.CalibrationFailed):
        eh.run(args, get=no_network, fields_fn=no_network)
    assert eh.main(["run", "--start", "2026-10-20T00:00Z", "--end", "2026-10-21T00:00Z", "--cache-dir",
                    str(tmp_path / "c"), "--out", str(tmp_path / "o")]) == 2


def test_persistent_nulls_are_reported_not_binding():
    lay = tw.Layout.from_items(_items(lambda s, d, k: 0.0, days=14))
    r = tw.null_calibration(lay, n_sets=60, reps=100, n_power=40)
    assert "block" in r["advisory_nulls"] and "block" not in r["false_pass"]
    assert set(r["false_pass"]) == {"day", "block_x_day", "daily_field", "mixed"}
    assert tw.calibrate_items(_items(lambda s, d, k: 0.0, days=13)) is None


# ---- the gate rule ----------------------------------------------------------------------------------------------
def _panel(days=15, cand_err=0.7, seed=1, day_shock=0.0):
    rng = random.Random(seed)
    out = []
    shock = 0.0
    for h in range(days * 4):
        t = T0 + timedelta(hours=6 * h)
        shock = rng.gauss(0, day_shock) if h % 4 == 0 else shock
        for j, s in enumerate("ABCDEF"):
            obs = 1.0 + 0.6 * math.sin(h / 5.0 + j) + rng.random() * 0.2
            e = rng.gauss(-0.1, 0.25)
            for lead in (24, 48, 72):
                out.append({"buoy": s, "t": t, "lead": lead, "obs": obs, "f_ref": obs + e, "f_cand": obs + cand_err * e,
                            "obs_hs": obs, "hull": "waverider", "hull_inferred": False, "dpd": 12.0, "multi": None,
                            "persistence": obs + 0.3, "lat": 33.0 + 0.8 * j, "lng": -118.0})
    return out


def test_the_gate_passes_a_real_gain_and_refuses_a_short_window():
    good = _panel()
    thr = sc.quantile([i["obs"] for i in good], 0.9)
    s = eg.summarize(good, CFG, thr)
    assert s["two_way"]["computable"] and s["two_way"]["ci"][0] > 0 and s["two_way"]["blocks"] >= 3
    assert eg.rules(s, CFG, True)["verdict"] == "PASS"
    short = _panel(days=12)
    r = eg.rules(eg.summarize(short, CFG, thr), CFG, True)
    assert r["verdict"] == "REFUSED" and "two-way CI not computable" in r["reasons"][0]


def test_the_gate_fails_when_only_the_two_way_ci_includes_zero():
    s = eg.summarize(_panel(), CFG, 1.5)
    s["two_way"] = dict(s["two_way"], ci=[-0.004, 0.08])
    r = eg.rules(s, CFG, True)
    assert r["verdict"] == "FAIL" and any("binding two-way" in x for x in r["reasons"])
    s["two_way"] = dict(s["two_way"], ci=[0.0, 0.08])          # a lower bound AT 0 does not exclude 0
    assert eg.rules(s, CFG, True)["verdict"] == "FAIL"
    assert any("advisory: station-cluster" in w for w in eg.rules(eg.summarize(_panel(), CFG, 1.5), CFG, True)["warnings"])


def test_the_controls_carry_the_layout_calibration():
    base = _panel(cand_err=1.0)
    ctl = eg.run_controls(base, CFG, sc.quantile([i["obs"] for i in base], 0.9))
    cal = ctl["two_way_calibration"]
    assert cal and cal["ok"] is True and cal["layout"]["days"] == 15 and ctl["ok"] is True
    assert ctl["positive"]["verdict"] == "PASS" and ctl["negative"]["verdict"] == "FAIL"


def test_a_positive_control_held_back_only_by_the_two_way_ci_is_underpowered_not_broken(monkeypatch):
    real = eg.rules

    def rules(s, cfg, ok):
        r = real(s, cfg, ok)
        if r["verdict"] == "PASS":                    # the positive control: 20% less error, blocked by the CI only
            return {"verdict": "FAIL", "reasons": ["the binding two-way (block x day) CI of the gain [-0.003, 0.11] "
                                                    "includes 0 (4 blocks x 14 days)"], "warnings": []}
        return r
    monkeypatch.setattr(eg, "rules", rules)
    base = _panel(cand_err=1.0)
    ctl = eg.run_controls(base, CFG, sc.quantile([i["obs"] for i in base], 0.9), calibrate=False)
    assert ctl["positive"]["verdict"] == "REFUSED" and ctl["positive"]["reasons"][0].startswith("underpowered")
    assert ctl["ok"] == "underpowered"


@pytest.mark.parametrize("worst,power,expect", [(0.01, 0.55, "underpowered"), (0.20, 0.95, False), (0.01, 0.95, True)])
def test_the_layout_calibration_maps_to_the_control_state(monkeypatch, worst, power, expect):
    cal = {"layout": {"stations": 2, "blocks": 2, "days": 14, "rows": 200}, "false_pass": {"day": worst},
           "advisory_nulls": {}, "power": {"rate": power}, "worst_false_pass": worst, "reasons": [],
           "ok": worst <= tw.MAX_FALSE_PASS and power >= tw.MIN_POWER, "n_sets": 1, "reps": 1}
    monkeypatch.setattr(tw, "calibrate_items", lambda items: cal)
    base = _panel(cand_err=1.0)
    ctl = eg.run_controls(base, CFG, sc.quantile([i["obs"] for i in base], 0.9))
    assert ctl["ok"] == expect if expect is not True else ctl["ok"] is True

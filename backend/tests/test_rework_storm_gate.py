"""rework_storm_gate.py (protocol storm-v1, the #727 fresh-window re-test, 2026-11-05): days split into runs at gaps;
the storm-block interval PASSES a candidate that halves the error, FAILS one that doubles it, REFUSES an identical one
and fewer than 14 days; persistence between storm blocks widens the interval; the pre-registered decision fails on a
worse Rodeo, on a worse stratum after Holm and on misbehaving controls; the synthetic calibration holds its rate."""
import math
import random
from datetime import datetime, timezone

from scripts import rework_storm_gate as SG
from tests.test_rework_gate import STATIONS, window  # noqa: F401 - the shared synthetic harness panels

CAL_OK = {"ok": True, "layouts": {}}
T1 = datetime(2025, 1, 15, tzinfo=timezone.utc)
T2 = datetime(2025, 11, 1, tzinfo=timezone.utc)
T3 = datetime(2026, 9, 22, tzinfo=timezone.utc)


def _stations(tmp_path):
    import json
    p = tmp_path / "stations.json"
    p.write_text(json.dumps(STATIONS))
    return str(p)


def _run(tmp_path, fn, days=(16, 16, 14)):
    wins = [(t, window(str(tmp_path), t, t0, n, fn, seed=k + 1))
            for k, (t, t0, n) in enumerate((("F1", T1, days[0]), ("F2", T2, days[1]), ("F3", T3, days[2])))]
    return SG.run(wins, "served", "cand", _stations(tmp_path), reps=300, rodeo="153p1", calibration=CAL_OK)


def test_day_runs_split_at_gaps_and_count_storm_blocks():
    days = ["2025-01-15", "2025-01-16", "2025-01-17", "2025-11-01", "2025-11-02"]
    assert SG.day_runs(days) == [days[:3], days[3:]]
    assert SG.n_storm_blocks([f"2025-01-{d:02d}" for d in range(1, 15)], L=5) == 3


def test_halving_the_error_passes_and_the_untouched_station_is_left_out(tmp_path):
    res = _run(tmp_path, lambda sid, e, d: e / 2 if sid == "285p1" else e)
    hs = res["quantities"]["hs_station"]
    assert hs["computable"] and hs["ci"][0] > 0 and hs["stations_moved"] == ["285p1"]
    assert hs["storm_blocks"] == 4 + 4 + 3 and hs["days"] == 46
    assert res["controls"]["hs_station"]["ok"] is True
    assert res["controls"]["hs_station"]["cases"]["sign_flip_null"]["false_pass"] <= SG.MAX_FALSE_PASS
    assert res["verdict"] == "PASS", res["reasons"]


def test_doubling_fails_identical_and_short_windows_are_refused(tmp_path):
    assert _run(tmp_path / "a", lambda sid, e, d: 2 * e)["verdict"] == "FAIL"
    assert _run(tmp_path / "b", lambda sid, e, d: e)["verdict"] == "REFUSED"
    assert _run(tmp_path / "c", lambda sid, e, d: e / 2, days=(4, 4, 4))["verdict"] == "REFUSED"


def test_persistence_between_storm_blocks_widens_the_interval():
    rng = random.Random(3)
    days = [f"2025-01-{d:02d}" for d in range(1, 31)] + [f"2025-02-{d:02d}" for d in range(1, 29)]
    x, persistent, iid = 0.0, {}, {}
    for d in days:
        x = 0.95 * x + math.sqrt(1 - 0.95 ** 2) * rng.gauss(0, 1)
        persistent[("b0", d)] = (12 * x, 12)
        iid[("b0", d)] = (12 * rng.gauss(0, 1), 12)
    rp = SG._storm_cells_ci(persistent, 300, random.Random(1))
    ri = SG._storm_cells_ci(iid, 300, random.Random(1))
    assert rp["block_lag1"] > 0.3 and rp["inflation"] > 1.3
    assert ri["inflation"] < rp["inflation"]
    assert rp["se"] == rp["se_bootstrap"] * rp["inflation"]


def _res(**over):
    q = {"computable": True, "ci": [0.1, 0.3], "gain": 0.2, "p_worse": 0.9, "reason": ""}
    res = {"calibration": CAL_OK, "controls": {"hs_station": {"ok": True}, "hb_proxy": {"ok": True}},
           "quantities": {"hs_station": dict(q), "hb_proxy": dict(q)}, "holm_worse": [],
           "rodeo": {"p_worse": 0.9}}
    for k, v in over.items():
        res[k] = v
    return res


def test_the_preregistered_decision():
    assert SG.verdict(_res(), "142p1") == ("PASS", [])
    v, why = SG.verdict(_res(rodeo={"p_worse": 0.04}), "142p1")
    assert v == "FAIL" and "Rodeo (142p1)" in why[0]
    assert SG.verdict(_res(holm_worse=["hb_proxy:lead=72h"]), "142p1")[0] == "FAIL"
    hb_worse = _res()
    hb_worse["quantities"]["hb_proxy"]["p_worse"] = 0.01
    assert SG.verdict(hb_worse, "142p1")[0] == "FAIL"
    no_hs = _res()
    no_hs["quantities"]["hs_station"] = {"computable": False, "reason": "13 UTC target days < 14"}
    assert SG.verdict(no_hs, "142p1")[0] == "REFUSED"
    assert SG.verdict(_res(controls={"hs_station": {"ok": False}, "hb_proxy": {"ok": True}}), "x")[0] == "INVALID"
    assert SG.verdict(_res(calibration={"ok": False}), "x")[0] == "INVALID"


def test_the_synthetic_calibration_holds_on_the_shortest_layout():
    from datetime import date, timedelta
    run = [(date(2026, 9, 22) + timedelta(days=k)).isoformat() for k in range(14)]
    r = SG.calibrate({"14d": (["b0"], [run], 12, False)}, n_sets=120, reps=120)
    lay = r["layouts"]["14d"]
    assert max(lay["false_pass"].values()) <= 0.06 and lay["power"] >= 0.6 and lay["ok"] is True

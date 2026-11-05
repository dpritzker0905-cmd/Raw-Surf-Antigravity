"""rework_gate.py (the pooled multi-window rework gate, 2026-11-04): on synthetic harness outputs it PASSES a
candidate that halves the error, FAILS one that doubles it, REFUSES an identical one, refuses fewer than 14 UTC days,
leaves unmoved stations out of the binding CI, and flags a season that is significantly worse even when the pool
gains."""
import json
import os
import random
from datetime import datetime, timedelta, timezone

import pytest

from scripts import rework_gate as G

STATIONS = {"stations": [
    {"id": "285p1", "source": "cdip", "role": "nearshore", "lat": 35.16, "lng": -120.74, "depth_m": 15.0},
    {"id": "153p1", "source": "cdip", "role": "nearshore", "lat": 32.96, "lng": -117.28, "depth_m": 17.0}]}


def _write(d, name, obj):
    with open(os.path.join(d, name), "w", encoding="utf-8") as f:
        json.dump(obj, f)


def window(tmp, tag, t0, days, cand_fn, seed=1):
    """A harness-shaped output dir: truth.json + replay_served.json + replay_cand.json. cand_fn(station, err, day)
    returns the candidate's error given served's."""
    d = os.path.join(tmp, tag)
    os.makedirs(d)
    rng = random.Random(seed)
    truth, served, cand = {}, [], []
    for st in STATIONS["stations"]:
        sid = st["id"]
        truth[sid] = []
        for h in range(-24 * 40, 24 * days, 1):
            t = t0 + timedelta(hours=h)
            truth[sid].append({"time": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "hs_m": 1.0 + 0.3 * rng.random(),
                               "tp_s": 12.0, "dp_deg": 280.0, "qc": "good"})
        obs = {o["time"]: o["hs_m"] for o in truth[sid]}
        for k in range(days * 4):
            t = t0 + timedelta(hours=6 * k)
            o = obs[t.strftime("%Y-%m-%dT%H:%M:%SZ")]
            err = -0.3 + 0.1 * rng.gauss(0, 1)
            base = {"station": sid, "role": "nearshore", "anchor": True, "spot": sid, "lat": st["lat"],
                    "lng": st["lng"], "valid": t.strftime("%Y-%m-%dT%H:%MZ"),
                    "cycle": (t - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%MZ"), "lead_h": 24, "fh": 24,
                    "outputs": {"surf_height_m": 1.0}}
            served.append(dict(base, hs_station_m=round(o + err, 4)))
            cand.append(dict(base, hs_station_m=round(o + cand_fn(sid, err, k // 4), 4)))
    _write(d, "truth.json", {"stations": {}, "records": truth})
    _write(d, "replay_served.json", {"rows": served})
    _write(d, "replay_cand.json", {"rows": cand})
    return d


@pytest.fixture
def stations(tmp_path):
    p = tmp_path / "stations.json"
    p.write_text(json.dumps(STATIONS))
    return str(p)


T1 = datetime(2024, 12, 1, tzinfo=timezone.utc)
T2 = datetime(2025, 10, 1, tzinfo=timezone.utc)


def _run(tmp_path, stations, fn, days=(16, 16), arms=("cand",)):
    wins = [("W1", window(str(tmp_path), "W1", T1, days[0], fn)), ("W4", window(str(tmp_path), "W4", T2, days[1], fn, 2))]
    return G.run(wins, "served", list(arms), ["hs_station"], stations, reps=400)


def test_halving_the_error_at_one_station_passes_and_the_other_station_is_left_out(tmp_path, stations):
    res = _run(tmp_path, stations, lambda sid, e, d: e / 2 if sid == "285p1" else e)
    g = res["arms"]["cand|hs_station"]
    assert res["controls"]["hs_station"]["ok"] is True
    assert g["verdict"] == "PASS" and g["twoway_ci"][0] > 0
    assert g["stations_moved"] == ["285p1"] and g["untouched_stations"] == ["153p1"]
    assert g["days"] == 32 and g["holm_across_arms_survives"] is True


def test_doubling_the_error_fails_and_identical_is_refused(tmp_path, stations):
    assert _run(tmp_path, stations, lambda sid, e, d: 2 * e)["arms"]["cand|hs_station"]["verdict"] == "FAIL"
    assert _run(tmp_path / "b", stations, lambda sid, e, d: e)["arms"]["cand|hs_station"]["verdict"].startswith(
        "REFUSED")


def test_fewer_than_14_days_is_refused_never_passed(tmp_path, stations):
    res = _run(tmp_path, stations, lambda sid, e, d: e / 2, days=(6, 6))
    assert res["arms"]["cand|hs_station"]["verdict"].startswith(("REFUSED", "INVALID"))


def test_a_season_significantly_worse_fails_even_when_the_pool_gains(tmp_path, stations):
    wins = [("W1", window(str(tmp_path), "W1", T1, 16, lambda s, e, d: e * 1.15)),
            ("W4", window(str(tmp_path), "W4", T2, 16, lambda s, e, d: e * 0.2, 2))]
    g = G.run(wins, "served", ["cand"], ["hs_station"], stations, reps=400)["arms"]["cand|hs_station"]
    assert g["gain"] > 0 and "season=W1" in g["holm_worse"] and g["verdict"] == "FAIL"


def test_holm_is_step_down():
    assert G.holm([("a", 0.01), ("b", 0.04), ("c", 0.5)]) == ["a"]
    assert G.holm([("a", 0.01), ("b", 0.02)]) == ["a", "b"]
    assert G.holm([("a", 0.03), ("b", 0.04)]) == []

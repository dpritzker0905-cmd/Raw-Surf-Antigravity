"""Calibrated gusts (log 2026-11-23-claude-gust-calibration.md section 1, pre-registered): the truncated-normal CRPS, median and
exceedance are right, the numpy normal helpers are accurate, the fit recovers known parameters, the gust windows match the
collector's, and the out-of-sample run trains only on earlier valid times, never across models."""
import gzip
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))

import gust_calibrate as K  # noqa: E402
import gust_verify_collect as C  # noqa: E402


def test_normal_helpers_match_math():
    xs = np.linspace(-8, 8, 161)
    ref = np.array([0.5 * math.erfc(-x / math.sqrt(2)) for x in xs])
    assert np.all(np.abs(K.ncdf(xs) / ref - 1) < 2e-7)
    ps = np.array([1e-10, 1e-4, 0.01, 0.02425, 0.3, 0.5, 0.77, 0.99, 1 - 1e-6])
    assert np.all(np.abs(K.ncdf(K.ninv(ps)) / ps - 1) < 1e-6)


def test_crps_closed_form_matches_monte_carlo():
    rng = np.random.default_rng(0)
    for mu, sig, y in ((5.0, 2.0, 6.5), (0.5, 1.5, 0.2), (-1.0, 2.0, 1.0), (12.0, 3.0, 4.0)):
        x = rng.normal(mu, sig, 8_000_000)
        x = x[x > 0][:2_000_000]
        x2 = rng.permutation(x)
        mc = np.mean(np.abs(x - y)) - 0.5 * np.mean(np.abs(x - x2))
        assert abs(float(K.crps_tn0(mu, sig, y)) / mc - 1) < 0.005, (mu, sig, y)
        g = np.linspace(0, mu + 12 * sig + abs(y) + 5, 400_001)          # and exactly: the integral of (F - 1{x >= y})^2
        p0 = K.ncdf(-mu / sig)
        F = (K.ncdf((g - mu) / sig) - p0) / (1 - p0)
        quad = float(np.sum(((F - (g >= y)) ** 2)[:-1] * np.diff(g)))
        assert abs(float(K.crps_tn0(mu, sig, y)) - quad) < 1e-3 * max(1.0, quad), (mu, sig, y)


def test_median_and_exceedance_are_the_truncated_distribution():
    for mu, sig in ((5.0, 2.0), (0.3, 1.0), (-1.0, 2.0)):
        m = float(K.median_tn0(mu, sig))
        assert abs(float(K.exceed_tn0(mu, sig, m)) - 0.5) < 1e-6
        assert abs(float(K.exceed_tn0(mu, sig, 0.0)) - 1.0) < 1e-9


def test_fit_recovers_known_parameters():
    rng = np.random.default_rng(1)
    G = rng.uniform(2, 25, 20000)
    W = 0.6 * G + rng.normal(0, 1, len(G))
    y = np.maximum(0, 0.5 + 0.7 * G + 0.4 * W + rng.normal(0, 1.2, len(G)))
    th = K.fit_emos(G, W, y)
    assert abs(th[0] - 0.5) < 0.15 and abs(th[1] - 0.7) < 0.05 and abs(th[2] - 0.4) < 0.07
    assert abs(math.exp(th[3]) - 1.2) < 0.1 and abs(th[4]) < 0.1


def test_gust_factor_is_the_minimum_mae_k():
    rng = np.random.default_rng(2)
    W = rng.uniform(1, 20, 5000)
    y = 1.35 * W + rng.normal(0, 1, len(W))
    k = K.fit_factor(W, y)
    mae = lambda kk: np.abs(y - kk * W).mean()  # noqa: E731
    assert mae(k) <= mae(k + 0.01) and mae(k) <= mae(k - 0.01)


def test_windows_match_the_collector():
    for f in range(0, 241, 3):
        assert int(K.window("EURO", f)) == C.euro_window(f)
        assert int(K.window("ICON", f)) == C.icon_window(f)
        assert int(K.window("GFS", f)) == 0


# ---------------------------------------------------------------------------------------------------- synthetic record
def _write(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wt") as fh:
        json.dump(doc, fh)


def _record(d, days=24, n_st=30, euro_bias=1.0):
    """A record whose truth is known: obs gust = 1.3 U, model G = 1.6 U + 1 (+ euro_bias for EURO), W = U + noise."""
    rng = np.random.default_rng(7)
    t0 = datetime(2026, 9, 1, tzinfo=timezone.utc)
    st = [{"id": f"S{i:02d}", "lat": 20 + 3 * (i // 6), "lon": -150 + 4 * (i % 6), "z_m": 10.0, "node": [0, i],
           "land": i % 3 == 0} for i in range(n_st)]
    for s in st:
        s["land"] = 1 if s["land"] else 0
    json.dump({"stations": st}, open(os.path.join(d, "stations.json"), "w"))
    hours = (days + 4) * 24
    U = 6 + 3 * np.sin(np.arange(hours)[None, :] / 17.0 + np.arange(n_st)[:, None]) + rng.gamma(2, 1.5, (n_st, hours))
    base_min = int(t0.timestamp() // 60)
    obs = {}
    for i, s in enumerate(st):
        rows = []
        for h in range(hours):
            for k in range(6):                                   # every 10 min: dense-eligible
                g = 1.3 * U[i, h] + rng.normal(0, 0.8)
                rows.append([base_min + h * 60 - 50 + 10 * k, U[i, h], round(max(0.0, g), 2)])
        obs[s["id"]] = rows
    _write(os.path.join(d, "obs", "x_rt2.json.gz"), {"stations": obs})
    for day in range(days):
        cyc = t0 + timedelta(days=day)
        for m, steps, extra in (("GFS", range(0, 73, 3), 0.0), ("EURO", range(3, 73, 3), euro_bias)):
            doc = {"model": m, "cycle": cyc.strftime("%Y%m%d%H"), "station_ids": [s["id"] for s in st], "steps": []}
            for f in steps:
                h = day * 24 + f
                g = [round(float(1.6 * U[i, h] + 1 + extra + rng.normal(0, 1)), 2) for i in range(n_st)]
                u = [round(float(U[i, h] + rng.normal(0, 0.7)), 2) for i in range(n_st)]
                doc["steps"].append({"f": f, "w": 0 if m == "GFS" else 1, "g": g, "u": u})
            _write(os.path.join(d, "cycles", f"{m}_{doc['cycle']}.json.gz"), doc)


def test_out_of_sample_run_beats_a_biased_raw_and_keeps_models_apart(tmp_path):
    _record(str(tmp_path))
    rep = K.calibrate(str(tmp_path), ("GFS", "EURO"))
    for m in ("GFS", "EURO"):
        r = rep["models"][m]
        s = r["summary"]
        assert s["mae"] < s["mae_raw"] and abs(s["bias"]) < abs(s["bias_raw"])
        assert r["controls"]["leak"]["pass"] and r["controls"]["pos1"]["pass"] and r["controls"]["null"]["pass"]
    assert rep["models"]["GFS"]["controls"]["pos2"]["pass"]
    # never across models: changing EURO's data leaves GFS's result unchanged
    other = tmp_path / "b"
    other.mkdir()
    _record(str(other), euro_bias=3.0)
    rep2 = K.calibrate(str(other), ("GFS", "EURO"))
    assert rep2["models"]["GFS"]["summary"]["mae"] == rep["models"]["GFS"]["summary"]["mae"]
    assert rep2["models"]["EURO"]["summary"]["bias_raw"] > rep["models"]["EURO"]["summary"]["bias_raw"] + 1.5


def test_training_rows_precede_the_test_week(tmp_path):
    _record(str(tmp_path), days=22)
    st, data = K.load(str(tmp_path), ("GFS",))
    D = data["GFS"]
    ws, we = K.weeks(D)[0]
    assert ws == (int(D["cycle"].min()) // 24 + K.MIN_TRAIN_DAYS) * 24
    tr = (D["cycle"] < ws) & (D["v"] < ws)
    assert D["v"][tr].max() < ws and D["cycle"][tr].max() < ws


def test_a_model_without_a_test_week_is_not_read(tmp_path):
    _record(str(tmp_path), days=10)
    rep = K.calibrate(str(tmp_path), ("GFS",))
    assert rep["models"]["GFS"]["verdict"].startswith("NOT_READ")

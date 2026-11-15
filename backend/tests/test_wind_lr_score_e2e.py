"""End to end on a synthetic cache: scripts/wind_lr_score.main_score reads run files, NDBC/ASOS truth and
climatology from the cache (no network), forms all 8 arms and writes report.json + rows.csv. Pins the plumbing the
Actions score job depends on (a crash there is found only after hours of collection)."""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_lr_hindcast as H  # noqa: E402
import wind_lr_score as S  # noqa: E402

RUNS = [datetime(2025, 10, d, h, tzinfo=timezone.utc) for d in (14, 15) for h in (0, 12)]


def _ndbc_text(start, hours, speed, gust, wdir):
    lines = ["#YY  MM DD hh mm WDIR WSPD GST", "#yr  mo dy hr mn degT m/s  m/s"]
    for k in range(hours):
        t = start + timedelta(hours=k)
        lines.append(f"{t:%Y %m %d %H} 00 {wdir:.0f} {speed:.1f} {gust:.1f}")
    return "\n".join(lines) + "\n"


def _asos_csv(start, hours, kt):
    rows = ["station,valid,sknt,drct,gust"]
    for k in range(hours):
        t = start + timedelta(hours=k, minutes=56)
        rows.append(f"TST,{t:%Y-%m-%d %H:%M},{kt:.2f},270.00,M")
    return "\n".join(rows) + "\n"


def test_main_score_runs_end_to_end(tmp_path):
    cache = str(tmp_path)
    stations = [{"id": "TB001", "lat": 30.0, "lon": -80.0, "kind": "ndbc", "anemometer_m": 10.0},
                {"id": "TST", "lat": 21.3, "lon": -157.9, "kind": "asos"}]
    os.makedirs(os.path.join(cache, "ndbc"))
    os.makedirs(os.path.join(cache, "asos"))
    t25 = datetime(2025, 9, 1, tzinfo=timezone.utc)
    open(os.path.join(cache, "ndbc", "TB001h2025.txt"), "w").write(_ndbc_text(t25, 24 * 120, 6.0, 8.0, 270))
    for y in range(2016, 2025):
        open(os.path.join(cache, "ndbc", f"TB001h{y}.txt"), "w").write(
            _ndbc_text(datetime(y, 9, 1, tzinfo=timezone.utc), 24 * 120, 5.0, 7.0, 270))
    s, e = H.WINDOW[0], H.WINDOW[1] + timedelta(days=15)
    open(os.path.join(cache, "asos", f"TST_{s:%Y%m%d}_{e:%Y%m%d}.csv"), "w").write(_asos_csv(t25, 24 * 120, 12.0))
    open(os.path.join(cache, "asos", "TST_20160101_20241231.csv"), "w").write(
        "".join("".join(_asos_csv(datetime(y, 9, 1, tzinfo=timezone.utc), 24 * 120, 10.0).splitlines(True)[(1 if y > 2016 else 0):])
                for y in range(2016, 2025)))
    run_dir = os.path.join(cache, "runs")
    os.makedirs(run_dir)
    rng = np.random.default_rng(0)
    for run in RUNS:
        arr = {}
        for step in H.ENS_STEPS:
            arr[f"ens_10u_{step}"] = (-6.0 + rng.normal(0, 1, (51, 2))).astype(np.float32)
            arr[f"ens_10v_{step}"] = rng.normal(0, 1, (51, 2)).astype(np.float32)
            arr[f"ens_10fg_{step}"] = (9.0 + rng.normal(0, 1, (51, 2))).astype(np.float32)
        for step in H.HRES_LEADS:
            arr[f"hres_10u_{step}"] = np.array([-4.0, -4.0], np.float32)
            arr[f"hres_10v_{step}"] = np.array([2.0, 2.0], np.float32)
            arr[f"hres_10fg_{step}"] = np.array([np.nan if step == 0 else 7.0] * 2, np.float32)
        for L in H.SCORED_LEADS:
            for k, v in (("gfs_u", -5.0), ("gfs_v", 1.0), ("gfs_g", 8.0), ("gefs_u", -5.5), ("gefs_v", 0.5)):
                arr[f"{k}_{L}"] = np.array([v, v], np.float32)
        np.savez_compressed(os.path.join(run_dir, f"{run:%Y%m%d%H}.npz"), **arr)
    out = os.path.join(cache, "report")
    assert S.main_score(None, cache, stations, out) == 0
    rep = json.load(open(os.path.join(out, "report.json")))
    assert rep["fit_runs"] == 2 and rep["test_runs"] == 2
    assert rep["verdict"] == "VOID" and rep["void_reasons"]          # 2 stations / 2 test runs: VOID, never PASS
    assert set(rep["metrics"]["pooled"]["B1_180_216"]) == set(S.ARMS)
    assert rep["metrics"]["pooled"]["B2_216_264"]["ens_mean_raw"]["n"] > 0
    assert rep["lines"]["P4_seam_euro"]["n_seam"] == 4                  # 2 test runs x 2 stations
    rows = open(os.path.join(out, "rows.csv")).read().splitlines()
    assert len(rows) > 1 and rows[0].startswith("run,station")

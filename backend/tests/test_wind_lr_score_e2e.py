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

RUNS = [datetime(2026, m, 15, h, tzinfo=timezone.utc) for m in (9, 10) for h in (0, 12)] + [
    datetime(2026, 10, 14, 0, tzinfo=timezone.utc), datetime(2026, 10, 13, 0, tzinfo=timezone.utc)]   # lag 24 h / 48 h


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
    t25 = datetime(2026, 9, 1, tzinfo=timezone.utc)
    open(os.path.join(cache, "ndbc", "TB001_202609.txt"), "w").write(_ndbc_text(t25, 24 * 30, 6.0, 8.0, 270))
    open(os.path.join(cache, "ndbc", "TB001_realtime2.txt"), "w").write(
        _ndbc_text(t25 + timedelta(days=30), 24 * 90, 6.0, 16.0, 270))
    for y in range(2016, 2026):
        open(os.path.join(cache, "ndbc", f"TB001h{y}.txt"), "w").write(
            _ndbc_text(datetime(y, 9, 1, tzinfo=timezone.utc), 24 * 120, 5.0, 7.0, 270))
    s, e = H.WINDOW[0], H.OBS_END
    open(os.path.join(cache, "asos", f"TST_{s:%Y%m%d}_{e:%Y%m%d}.csv"), "w").write(_asos_csv(t25, 24 * 120, 12.0))
    open(os.path.join(cache, "asos", "TST_20160101_20251231.csv"), "w").write(
        "".join("".join(_asos_csv(datetime(y, 9, 1, tzinfo=timezone.utc), 24 * 120, 10.0).splitlines(True)[(1 if y > 2016 else 0):])
                for y in range(2016, 2026)))
    run_dir = os.path.join(cache, "runs")
    os.makedirs(run_dir)
    rng = np.random.default_rng(0)
    for run in RUNS:
        arr = {}
        for L in H.SCORED_LEADS:
            arr[f"aifs_10u_{L}"] = (-5.0 + rng.normal(0, 1, (51, 2))).astype(np.float32)
            arr[f"aifs_10v_{L}"] = rng.normal(0, 1, (51, 2)).astype(np.float32)
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
    # FILL mode: a reused run's stale drop marker for a run that now exists is NOT a drop; a real one still is
    open(os.path.join(run_dir, f"{RUNS[0]:%Y%m%d%H}.npz.failed.json"), "w").write("{}")
    open(os.path.join(run_dir, "2026102000.npz.failed.json"), "w").write("{}")     # no file: a real drop
    out = os.path.join(cache, "report")
    assert S.main_score(None, cache, stations, out) == 0
    rep = json.load(open(os.path.join(out, "report.json")))
    assert rep["fit_runs"] == 2 and rep["test_runs"] == 4          # 09-15 runs are inside the 09-01..09-24 fit block
    assert rep["dropped_runs"] == ["2026102000"]        # the stale marker of an existing run is not a drop
    assert rep["verdict"] == "VOID" and rep["void_reasons"]          # 2 stations / 2 test runs: VOID, never PASS
    assert set(rep["metrics"]["pooled"]["B1_180_216"]) == set(S.ARMS)
    assert rep["metrics"]["pooled"]["B2_216_264"]["ens_mean_raw"]["n"] > 0
    assert rep["lines"]["P4_seam_euro"]["n_seam"] == 8                  # 4 test runs x 2 stations
    for arm in ("grand_ifs_gefs", "grand_ifs_gefs_aifs", "ens_lag24", "ens_lag48"):
        assert rep["metrics"]["pooled"]["B1_180_216"][arm]["n"] > 0, arm
        assert "vs_loop_B2_216_264" in rep["reported_arms"][arm]
    assert "P5_gust_peak" in rep["lines"] and "aifs_ens_mean" in rep["csi_ge15"]
    assert all(f"C3_{b}" in rep["lines"] and f"C4_{b}" in rep["lines"] and f"R_C1_{b}" in rep["lines"] for b in S.BINS)
    assert rep["lines"]["P1_B2_216_264"]["n"] == rep["lines"]["P2_B2_216_264"]["n"]
    assert set(rep["debias_by_network"]) == {f"{n}_{b}" for n in ("asos", "ndbc") for b in S.BINS}
    assert rep["metrics"]["pooled"]["B3_264_336"]["aifs_ens_mean"]["n"] > 0
    assert rep["metrics"]["pooled"]["B1_180_216"]["climatology"]["n"] > 0
    rows = open(os.path.join(out, "rows.csv")).read().splitlines()
    assert len(rows) > 1 and rows[0].startswith("run,station")


def test_fill_mode_skips_runs_the_reused_run_already_has(tmp_path, monkeypatch):
    prior = tmp_path / "prior"
    prior.mkdir()
    (prior / "2026100100.npz").write_bytes(b"x")
    monkeypatch.setattr(H.ef, "run_available", lambda *a, **k: (_ for _ in ()).throw(AssertionError("fetched")))
    got = H.collect_run(None, datetime(2026, 10, 1, tzinfo=timezone.utc), np.zeros(1), np.zeros(1),
                        str(tmp_path), prior_dir=str(prior))
    assert got == "prior"


def test_named_run_mode_takes_only_the_listed_runs_and_refuses_outside_ones():
    pool = H.runs_in_window()
    got = H.named_runs("2026101300, 2026100112,2026103100", pool)
    assert [f"{r:%Y%m%d%H}" for r in got] == ["2026100112", "2026101300", "2026103100"]
    import pytest
    with pytest.raises(SystemExit):
        H.named_runs("2026110100", pool)


def test_mirror_is_s3_by_default_and_only_known_mirrors_are_allowed(monkeypatch):
    import importlib
    import pytest
    monkeypatch.delenv("WLR_ENS_BASE", raising=False)
    assert importlib.reload(H).ENS_BASE == H.ef.AWS_BASE
    monkeypatch.setenv("WLR_ENS_BASE", "https://storage.googleapis.com/ecmwf-open-data")
    assert importlib.reload(H).ENS_BASE.startswith("https://storage.googleapis.com/")
    monkeypatch.setenv("WLR_ENS_BASE", "https://example.com/x")
    with pytest.raises(SystemExit):
        importlib.reload(H)
    monkeypatch.delenv("WLR_ENS_BASE")
    importlib.reload(H)


def test_collect_reads_the_chosen_mirror(tmp_path, monkeypatch):
    monkeypatch.setattr(H, "ENS_BASE", "https://storage.googleapis.com/ecmwf-open-data")
    seen = {}

    def fake_available(session, run, step, base=None):
        seen["base"] = base
        return False
    monkeypatch.setattr(H.ef, "run_available", fake_available)
    assert H.collect_run(None, datetime(2026, 10, 13, tzinfo=timezone.utc), np.zeros(1), np.zeros(1),
                         str(tmp_path)) == "missing"
    assert seen["base"] == "https://storage.googleapis.com/ecmwf-open-data"


class _Resp:
    def __init__(self, content, code=200):
        self.content, self.status_code = content, code


def _fake_session_factory(differ_on=None):
    """Serves an identical tiny index and GRIB span from both mirrors, or different bytes for one URL substring."""
    import wind_lr_mirror_check as M
    index = b'{"param": "10u", "levtype": "sfc", "step": "336", "_offset": 0, "_length": 4}\n'

    def get(session, url, headers=None, **_k):
        body = index if url.endswith(".index") else b"GRIB"
        if differ_on and differ_on in url and url.startswith(M.GCS):
            body = body[:-1] + b"x"                  # same length, different bytes
        return _Resp(body)
    return get


def test_mirror_sameness_control_passes_on_identical_bytes_and_stops_on_any_difference(monkeypatch):
    import wind_lr_mirror_check as M
    monkeypatch.setattr(M.ef, "_get", _fake_session_factory())
    rows = M.compare(None)
    assert len(rows) == 5 and all(a == b for _, a, b in rows)
    monkeypatch.setattr(M.ef, "_get", _fake_session_factory(differ_on=".grib2"))
    rows = M.compare(None)
    assert [lbl for lbl, a, b in rows if a != b] == ["ens ef 336 grib 10u message"]


def test_mirror_sameness_control_never_passes_on_a_failed_or_throttled_read(monkeypatch):
    import pytest
    import wind_lr_mirror_check as M
    good = _fake_session_factory()

    def throttled(session, url, headers=None, **k):
        if url.startswith(M.ef.AWS_BASE) and url.endswith(".grib2"):
            raise RuntimeError("HTTP 503 SlowDown")
        return good(session, url, headers, **k)

    def missing(session, url, headers=None, **k):
        return _Resp(b"", 404) if url.startswith(M.GCS) else good(session, url, headers, **k)

    for fake in (throttled, missing):
        monkeypatch.setattr(M.ef, "_get", fake)
        with pytest.raises(RuntimeError):
            M.compare(None)
    monkeypatch.setattr(M, "compare", lambda s: (_ for _ in ()).throw(RuntimeError("HTTP 503")))
    assert M.main() == 2

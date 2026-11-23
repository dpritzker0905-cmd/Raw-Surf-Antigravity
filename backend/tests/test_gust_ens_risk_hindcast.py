"""Gate gust-ens-risk-v1 instrument (scripts/gust_ens_risk_hindcast.py): truth windows, coverage, METAR PK WND, the cell lines
and the controls on synthetic rows. Offline."""
import os
import sys
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))

import gust_ens_risk_hindcast as h  # noqa: E402
from services.weather_pipeline import ens_gust_risk_core as gr  # noqa: E402


def test_bins_follow_the_window_changes():
    for b, leads in h.BINS.items():
        assert len({gr.gust_window_h(L) for L in leads}) == 1, b
    assert len(h.LEADS) == 21 and len(h.RUNS) == 42
    assert h.RUNS[0] == datetime(2026, 10, 10, tzinfo=timezone.utc) and h.RUNS[-1] == datetime(2026, 11, 20, tzinfo=timezone.utc)
    assert max(h.BINS["B3"]) <= h.HRES_MAX < min(h.BINS["B4"])


def test_parse_metar_keeps_the_peak_at_its_own_minute():
    text = ("station,valid,sknt,gust,peak_wind_gust,peak_wind_time\n"
            "BOS,2026-11-05 15:54,20.00,28.00,30.00,2026-11-05 15:45\n"
            "BOS,2026-11-05 16:54,18.00,M,M,M\n")
    rows = h.parse_metar(text)
    t0 = h._ep(datetime(2026, 11, 5, 15, 54, tzinfo=timezone.utc))
    assert rows[0][0] == t0 and abs(rows[0][2] - 28 * h.KT) < 1e-9 and abs(rows[0][3] - 30 * h.KT) < 1e-9
    assert rows[0][4] == h._ep(datetime(2026, 11, 5, 15, 45, tzinfo=timezone.utc))
    assert np.isnan(rows[1][2]) and rows[1][4] is None


def test_coverage_needs_a_record_in_every_hour():
    cov = np.array([10, 70, 130])                          # minutes
    assert h.covered(cov, 180, 3)
    assert not h.covered(np.array([10, 130]), 180, 3)       # nothing in (60, 120]
    assert not h.covered(np.array([]), 60, 1)


def test_truth_row_is_nan_without_coverage_and_max_within_the_window():
    tr = {"t": np.array([30, 90, 150]), "g": np.array([5.0, 14.0, 9.0]), "cov": np.array([30, 90, 150])}
    assert h.truth_row(tr, 180, 3) == 14.0
    assert h.truth_row(tr, 180, 1) == 9.0
    assert np.isnan(h.truth_row(dict(tr, cov=np.array([150])), 180, 3))


def _rows(n_days=20, per=60, skill=True, seed=0):
    rng = np.random.default_rng(seed)
    n = n_days * per
    truth = rng.gamma(4.0, 2.6, n)                                  # m/s; ~15-25% above 12.861
    noise = rng.normal(0, 1.5 if skill else 8.0, (n, gr.MEMBERS))
    ens = (truth[:, None] if skill else rng.gamma(4.0, 2.6, n)[:, None]) + noise
    day = np.repeat(np.arange(n_days) + 739000, per)
    run = np.repeat(np.arange(n_days) + 2026101000, per)
    return {"run": run, "lead": np.full(n, 24), "sta": np.tile(np.arange(per), n_days), "day": day, "obs": truth,
            "obs_shift": np.roll(truth, per), "obs_w6": truth + 1.0, "hres": truth + rng.normal(0, 2.0, n),
            "net": np.array(["ndbc"] * n), "ens": ens.astype(np.float32)}


def test_a_skilful_ensemble_passes_its_cell_and_the_controls_behave():
    rows = _rows()
    sel = np.ones(rows["obs"].size, bool)
    c, *_ = h.score_cell(rows, sel, gr.THRESHOLDS_MS[0])
    ln = h.lines(c, True)
    assert c["bss_clim"] > 0.3 and ln["P1_day"] and ln["P1_station"] and ln["reported"]["G4_auc"] and ln["verdict"] == "PASS"
    ctl = h.controls(rows)
    assert ctl["C1"]["pass"] and ctl["C2"]["pass"] and ctl["C3"]["pass"] and ctl["C4"]["pass"], ctl


def test_an_unskilful_ensemble_fails_g1():
    rows = _rows(skill=False, seed=3)
    c, *_ = h.score_cell(rows, np.ones(rows["obs"].size, bool), gr.THRESHOLDS_MS[0])
    assert h.lines(c, True)["verdict"] == "FAIL"


def test_too_few_events_is_underpowered():
    rows = _rows(n_days=5, per=10)
    c, *_ = h.score_cell(rows, np.ones(rows["obs"].size, bool), gr.THRESHOLDS_MS[2])
    assert h.lines(c, True)["verdict"] == "UNDERPOWERED"


# ---- amendment 1 (A2-A4, A8) ---------------------------------------------------------------------------------------
def test_p1_needs_both_bootstraps_and_reliability():
    c = {"ens_minus_clim": {1: (-0.01, -0.02, -0.001), 5: (-0.01, -0.03, 0.001)}, "ens_minus_clim_station": (-0.01, -0.02, 0.002),
         "murphy": {"rel": 0.001, "res": 0.01, "mean_p": 0.1, "obar": 0.1}, "auc": (0.8, 0.75, 0.85),
         "n": 5000, "n_events": 200, "event_days": 20}
    assert h.lines(c, False)["verdict"] == "FAIL"                       # the station-cluster CI crosses 0
    c["ens_minus_clim_station"] = (-0.01, -0.02, -0.001)
    ln = h.lines(c, False)
    assert ln["verdict"] == "PASS" and ln["reported"]["fragile_5d"] is True     # 5-day blocks are reported, not deciding
    c["murphy"] = dict(c["murphy"], rel=0.02)
    assert h.lines(c, False)["verdict"] == "FAIL"                       # REL >= RES
    c["murphy"] = dict(c["murphy"], rel=0.001)
    assert h.lines(dict(c, n=999), False)["verdict"] == "UNDERPOWERED"  # A3: < 1,000 rows


def _cache(tmp_path, n_runs=2):
    """A tiny cache: 2 NDBC stations (one LOCKED), 1 ASOS, hourly 10-min truth, and run files holding the B1 leads."""
    import json
    st = {"ndbc": [{"id": "AAA01", "kind": "ndbc", "anemometer_m": 10.0, "lat": 0, "lon": 0},
                   {"id": "LCK01", "kind": "ndbc", "anemometer_m": 10.0, "lat": 0, "lon": 0}],
          "asos": [{"id": "KXYZ", "kind": "asos", "lat": 0, "lon": 0}]}
    (tmp_path / "stations.json").write_text(json.dumps(st))
    (tmp_path / "ndbc").mkdir()
    lines_ = ["#YY  MM DD hh mm WDIR WSPD GST", "#yr  mo dy hr mn degT m/s m/s"]
    t = datetime(2026, 10, 10, tzinfo=timezone.utc)
    while t < datetime(2026, 10, 16, tzinfo=timezone.utc):
        lines_.append(f"{t:%Y %m %d %H %M} 200 8.0 14.0")
        t = t.replace() + (datetime(2026, 1, 1, 0, 10) - datetime(2026, 1, 1))
    (tmp_path / "ndbc" / "AAA01_realtime2.txt").write_text("\n".join(lines_))
    (tmp_path / "metar").mkdir()
    rows = ["station,valid,sknt,gust,peak_wind_gust,peak_wind_time"]
    t = datetime(2026, 10, 10, tzinfo=timezone.utc)
    while t < datetime(2026, 10, 16, tzinfo=timezone.utc):
        rows.append(f"KXYZ,{t:%Y-%m-%d %H}:54,10.00,M,M,M")
        t = t + (datetime(2026, 1, 1, 1) - datetime(2026, 1, 1))
    (tmp_path / "metar" / "KXYZ_rt3.csv").write_text("\n".join(rows))
    (tmp_path / "metar" / "KXYZ_rt4.csv").write_text("station,valid,sknt,gust,peak_wind_gust,peak_wind_time\n")
    (tmp_path / "runs").mkdir()
    for k in range(n_runs):
        arrs = {f"ens_{L}": np.full((50, 3), 13.0, np.float32) for L in (12, 24, 36)}
        arrs["ens_24"][:, 2] = np.nan                                     # a non-finite member column drops that slot
        np.savez(tmp_path / "runs" / f"202610{10 + k:02d}00.npz", **arrs)
    return tmp_path


def test_locked_station_file_is_never_opened(tmp_path, monkeypatch):
    c = _cache(tmp_path)
    opened = []
    real = open

    def spy(p, *a, **k):
        opened.append(str(p))
        return real(p, *a, **k)
    monkeypatch.setattr("builtins.open", spy)
    import json
    st = json.loads((c / "stations.json").read_text())
    tr = h.station_truth(str(c), st, skip=frozenset({"LCK01"}))
    assert tr[1] is None and not any("LCK01" in p for p in opened)


def test_n_table_counts_exactly_the_rows_the_score_builds(tmp_path):
    c = _cache(tmp_path)
    locked, fit = frozenset({"LCK01"}), frozenset({"KXYZ"})
    tab = h.n_table(str(c), locked, fit)
    rows, _s, _d = h.build_rows(str(c), locked, fit)
    keep = ~rows["fit_used"]
    assert tab["B1"]["rows"] == int(np.isin(rows["lead"][keep], h.BINS["B1"]).sum()) == 6   # AAA01: 2 runs x 3 leads
    assert tab["B1"]["rows_fit_used"] == int(rows["fit_used"].sum()) == 4   # KXYZ: 6 slots minus its 2 NaN member columns
    assert tab["B1"]["stations"] == 1 and set(rows["sta"][keep]) == {0}
    assert 1 not in set(rows["sta"])                                      # the LOCKED station is in no row


def test_read_id_list_shapes(tmp_path):
    import json
    p = tmp_path / "l.json"
    p.write_text(json.dumps({"locked": ["aaa01", {"id": "B2"}]}))
    assert h.read_id_list(str(p), "locked") == frozenset({"AAA01", "B2"})
    p.write_text(json.dumps(["x"]))
    assert h.read_id_list(str(p), "locked") == frozenset({"X"})
    assert h.read_id_list(None, "locked") == frozenset()


def test_score_and_count_refuse_without_the_locked_list(tmp_path, capsys):
    assert h.main(["score", "--cache", str(tmp_path)]) == 2
    assert h.main(["count", "--cache", str(tmp_path)]) == 2
    assert "LOCKED list is required" in capsys.readouterr().err


def test_message_bytes_sums_only_the_read_messages():
    import json
    idx = "\n".join(json.dumps(d) for d in (
        {"param": "10fg", "step": "24", "type": "pf", "number": "1", "_offset": 0, "_length": 100},
        {"param": "10fg", "step": "24", "type": "pf", "number": "2", "_offset": 100, "_length": 50},
        {"param": "10u", "step": "24", "type": "pf", "number": "1", "_offset": 150, "_length": 999},
        {"param": "10fg", "step": "24", "type": "cf", "_offset": 1200, "_length": 7}))
    assert h.message_bytes(idx, "10fg", 24, "pf") == (150, 2)
    assert h.message_bytes(idx, "10fg", 24, "cf") == (7, 1)

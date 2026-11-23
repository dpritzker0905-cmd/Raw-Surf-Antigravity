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
    assert c["bss_clim"] > 0.3 and ln["G1"] and ln["G4"] and ln["verdict"] in ("PASS", "FRAGILE")
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

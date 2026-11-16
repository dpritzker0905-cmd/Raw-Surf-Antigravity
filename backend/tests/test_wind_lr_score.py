"""The long-range wind hindcast scorer (scripts/wind_lr_score.py) on synthetic rows: the pre-registered PASS lines,
the low-skill label and both controls. Pre-registration: docs/weather-program/log/2026-11-15-wind-long-range.md."""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_lr_score as S  # noqa: E402


def test_bins_are_left_open():
    assert S.bins_of([180, 186, 216, 222, 264, 270, 336, 342]) == [None, "B1_180_216", "B1_180_216", "B2_216_264",
                                                                      "B2_216_264", "B3_264_336", "B3_264_336", None]


def test_day_block_ci_brackets_a_known_shift():
    rng = np.random.default_rng(1)
    days = np.repeat(np.arange(30), 20)
    diff = -0.5 + rng.normal(0, 1, days.size)
    m, lo, hi = S.day_block_ci(diff, days)
    assert lo < m < hi and hi < 0
    _m0, lo0, hi0 = S.day_block_ci(diff + 0.5, days)
    assert lo0 < 0 < hi0
    assert np.isnan(S.day_block_ci(np.array([np.nan]), np.array([1]))[0])


def _rows(chosen_err=1.0, loop_err=2.0, gfs_err=1.5, clim_err=1.2, n_days=30, per_day=40, seed=3):
    rng = np.random.default_rng(seed)
    n = n_days * per_day
    days = np.repeat(np.arange(n_days), per_day)
    leads = rng.choice(np.arange(186, 337, 6), size=n)
    obs_s = rng.uniform(2, 12, n)
    obs_d = rng.uniform(0, 360, n)
    obs_g = obs_s * 1.4

    def arm(scale, gust_extra):
        spd = obs_s + rng.normal(0, scale, n)
        u = -spd * np.sin(np.radians(obs_d))
        v = -spd * np.cos(np.radians(obs_d))
        return S.errors(u, v, spd, obs_g + rng.normal(0, gust_extra, n), obs_s, obs_d, obs_g)
    E = {"ens_mean_raw": arm(chosen_err, 1.0), "loop": arm(loop_err, 2.5), "gfs_standin": arm(gfs_err, 1.5),
         "climatology": arm(clim_err, 1.0)}
    shift = {b: {"shift_mae": 3.0, "clim_mae": 2.0, "n": 100} for b in S.BINS}
    return {"E": E, "days": days, "bin": np.array(S.bins_of(leads), dtype=object), "E_shift": shift}


def test_pass_when_the_chosen_arm_beats_loop_and_gfs_everywhere():
    rep = S.verdict(_rows(), "ens_mean_raw", {"seam_p95": 1.0, "within_p95": 1.5})
    assert rep["verdict"] == "PASS" and rep["controls_ok"]
    assert all(rep["lines"][f"P1_{b}"]["pass"] for b in S.BINS)
    assert rep["lines"]["P3_gust_pooled"]["pass"]
    assert rep["lines"]["R1_B1_180_216"]["label"] == "skill"


def test_fail_when_gfs_is_as_good_and_low_skill_is_labelled_not_hidden():
    rep = S.verdict(_rows(gfs_err=1.0, clim_err=0.6), "ens_mean_raw", {"seam_p95": 1.0, "within_p95": 1.5})
    assert rep["verdict"] == "FAIL"
    assert any(not rep["lines"][f"P2_{b}"]["pass"] for b in S.BINS)
    assert all(rep["lines"][f"R1_{b}"]["label"] == "low skill" for b in S.BINS)


def test_seam_line_fails_a_big_jump():
    rep = S.verdict(_rows(), "ens_mean_raw", {"seam_p95": 3.0, "within_p95": 1.5})
    assert rep["verdict"] == "FAIL" and not rep["lines"]["P4_seam_euro"]["pass"]


def test_negative_control_failure_voids_the_instrument():
    rows = _rows()
    rows["E_shift"]["B3_264_336"] = {"shift_mae": 1.0, "clim_mae": 2.0, "n": 100}
    rep = S.verdict(rows, "ens_mean_raw", {"seam_p95": 1.0, "within_p95": 1.5})
    assert rep["verdict"] == "VOID" and not rep["controls_ok"]


def test_positive_control_finds_the_seeded_bias():
    rep = S.verdict(_rows(), "ens_mean_raw", {"seam_p95": 1.0, "within_p95": 1.5})
    c2 = rep["lines"]["C2_B2_216_264"]
    assert c2["pass"] and c2["bias_diff"] == pytest.approx(1.0)


def test_direction_error_only_counted_at_or_above_3_ms():
    e = S.errors(np.array([0.0, 0.0]), np.array([-5.0, -5.0]), np.array([5.0, 5.0]), np.array([1.0, 1.0]),
                 np.array([2.0, 4.0]), np.array([90.0, 90.0]), np.array([1.0, 1.0]))
    assert np.isnan(e["dae"][0]) and e["dae"][1] == pytest.approx(90.0)


def test_gust_peak_line_blocks_only_with_enough_events():
    rows = _rows()
    n = len(rows["days"])
    rng = np.random.default_rng(7)
    obs_ev = (rng.uniform(0, 1, n) < 0.1).astype(float)
    good = np.clip(obs_ev * 0.8 + 0.05, 0, 1)
    for a, p in (("ens_mean_raw", good), ("loop", 1 - obs_ev), ("gfs_standin", np.zeros(n))):
        rows["E"][a]["brier"] = (p - obs_ev) ** 2
    rows["n_events"] = int(obs_ev.sum())
    rep = S.verdict(rows, "ens_mean_raw", {"seam_p95": 1.0, "within_p95": 1.5})
    assert rep["lines"]["P5_gust_peak"]["pass"] and rep["verdict"] == "PASS"
    rows["E"]["ens_mean_raw"]["brier"] = (1 - obs_ev - obs_ev) ** 2 * 0 + 1.0   # always wrong
    assert S.verdict(rows, "ens_mean_raw", {"seam_p95": 1.0, "within_p95": 1.5})["verdict"] == "FAIL"
    rows["n_events"] = 5
    rep2 = S.verdict(rows, "ens_mean_raw", {"seam_p95": 1.0, "within_p95": 1.5})
    assert rep2["lines"]["P5_gust_peak"]["status"].startswith("UNDERPOWERED") and rep2["verdict"] == "PASS"


def test_csi_counts():
    c = S.csi(np.array([16.0, 16.0, 10.0, np.nan]), np.array([20.0, 5.0, 18.0, 30.0]))
    assert (c["hits"], c["false_alarms"], c["misses"]) == (1, 1, 1) and c["csi"] == pytest.approx(1 / 3)

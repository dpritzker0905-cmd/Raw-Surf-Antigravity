"""Gate gust-ens-risk-v1: the shared numeric core (exceedance counts, windows, Brier / Murphy / ROC, controls' maths)."""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import ens_gust_risk_core as gr  # noqa: E402


def test_thresholds_are_the_briefs_knots():
    assert gr.THRESHOLDS_KN == (25, 34, 48)
    assert gr.THRESHOLDS_MS == (12.861, 17.491, 24.693)


@pytest.mark.parametrize("step,param,win", [(3, "10fg", 1), (24, "10fg", 1), (90, "10fg", 1), (93, "10fg3", 3),
                                            (144, "10fg3", 3), (150, "10fg", 6), (360, "10fg", 6)])
def test_window_table_matches_the_decoded_headers(step, param, win):
    assert gr.gust_param(step) == param
    assert gr.gust_window_h(step) == win


def test_native_steps():
    s = gr.native_steps()
    assert s[0] == 3 and 144 in s and 147 not in s and 150 in s and s[-1] == 360 and len(s) == 48 + 36


def test_exceed_counts_counts_members_at_or_above():
    m = np.array([[12.86, 17.5, 30.0], [12.861, 0.0, np.nan], [20.0, 25.0, 1.0]], dtype=np.float32)
    c = gr.exceed_counts(m)
    assert c.dtype == np.uint8 and c.shape == (3, 3)
    assert c[0].tolist() == [2, 2, 1]          # 25 kn: 12.861 counts (>=), 12.86 not; NaN never counts
    assert c[1].tolist() == [1, 2, 1]
    assert c[2].tolist() == [0, 1, 1]


def test_brier_and_murphy_identity():
    rng = np.random.default_rng(0)
    p = np.round(rng.uniform(0, 1, 5000) * 50) / 50
    o = (rng.uniform(0, 1, 5000) < p).astype(float)
    mu = gr.murphy(p, o)
    # BS = REL - RES + UNC holds up to the within-bin variance term; tiny for 0.1-wide bins
    assert abs(gr.brier(p, o) - (mu["rel"] - mu["res"] + mu["unc"])) < 0.01
    assert mu["rel"] < 0.005                  # p is calibrated by construction
    const = np.full(o.size, o.mean())
    assert gr.murphy(const, o)["rel"] < 1e-12


def test_prob_bins():
    assert gr.prob_bin(np.array([0.0, 0.02, 0.1, 0.12, 0.5, 0.98, 1.0])).tolist() == [0, 1, 1, 2, 5, 10, 10]


def test_auc_perfect_random_and_ties():
    o = np.array([0, 0, 1, 1], bool)
    assert gr.roc_auc(np.array([0.1, 0.2, 0.8, 0.9]), o) == 1.0
    assert gr.roc_auc(np.array([0.9, 0.8, 0.2, 0.1]), o) == 0.0
    assert gr.roc_auc(np.full(4, 0.3), o) == 0.5
    assert np.isnan(gr.roc_auc(np.array([0.1, 0.2]), np.array([0, 0], bool)))


def test_block_ci_brackets_the_mean_and_is_zero_width_for_zero():
    d = np.r_[np.full(10, -0.1), np.full(10, -0.05)]
    days = np.repeat(np.arange(4), 5)
    m, lo, hi = gr.block_ci_mean(d, days, reps=500)
    assert lo <= m <= hi < 0
    assert gr.block_ci_mean(np.zeros(20), days, reps=50) == (0.0, 0.0, 0.0)


def test_loo_climatology_excludes_the_rows_day():
    sta = np.array([0] * 30)
    day = np.repeat(np.arange(3), 10)
    o = np.r_[np.ones(10), np.zeros(20)]
    c = gr.loo_day_climatology(sta, day, o, min_n=5)
    assert c[0] == 0.0 and c[10] == 0.5 and c[25] == 0.5


def test_loo_climatology_pools_thin_stations():
    sta = np.array([0, 0, 1, 1])
    day = np.array([0, 1, 0, 1])
    o = np.array([1.0, 0.0, 1.0, 1.0])
    c = gr.loo_day_climatology(sta, day, o, min_n=20)
    assert c.tolist() == [0.5, 1.0, 0.5, 1.0]       # pooled over the other day's rows


def test_cell_verdicts():
    assert gr.cell_verdict(29, 12, True, True, True, True, True, True) == "UNDERPOWERED"
    assert gr.cell_verdict(40, 9, True, True, True, True, True, True) == "UNDERPOWERED"
    assert gr.cell_verdict(40, 12, True, True, True, True, True, True) == "PASS"
    assert gr.cell_verdict(40, 12, True, False, True, True, True, True) == "FRAGILE"
    assert gr.cell_verdict(40, 12, True, True, None, None, True, True) == "PASS"      # B4: G2 not applicable
    assert gr.cell_verdict(40, 12, True, True, False, True, True, True) == "FAIL"
    assert gr.cell_verdict(40, 12, True, True, True, True, True, False) == "FAIL"


def test_window_max_is_left_open_right_closed():
    t = np.array([0, 60, 120, 180])
    v = np.array([5.0, 9.0, 7.0, np.nan])
    assert gr.window_max(t, v, 120, 1) == 7.0       # (60, 120]
    assert gr.window_max(t, v, 120, 2) == 9.0       # (0, 120]
    assert np.isnan(gr.window_max(t, v, 180, 0))
    assert np.isnan(gr.window_max(t, v, 200, 0))

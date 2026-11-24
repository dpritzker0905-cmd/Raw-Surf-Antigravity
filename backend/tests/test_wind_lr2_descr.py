"""The four DESCRIPTIVE checks of the long-range wind v2 amendment 2 (reported only, never a gate). Synthetic rows."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_lr2_descr as D  # noqa: E402
import wind_lr2_fit as F  # noqa: E402
import wind_lr2_runs as R  # noqa: E402


def _rows(n=900, alpha_true=0.4, seed=7):
    rng = np.random.default_rng(seed)
    c_u, c_v = rng.normal(0, 1, n), rng.normal(0, 1, n)
    m_u, m_v = c_u + rng.normal(0, 3, n), c_v + rng.normal(0, 3, n)
    o_u = c_u + alpha_true * (m_u - c_u) + rng.normal(0, 0.5, n)
    o_v = c_v + alpha_true * (m_v - c_v) + rng.normal(0, 0.5, n)
    day = rng.integers(0, 60, n)
    return {"m_u": m_u, "m_v": m_v, "s": np.hypot(m_u, m_v) + 2, "c_u": c_u, "c_v": c_v, "c_s": np.full(n, 5.0),
            "o_u": o_u, "o_v": o_v, "o_s": np.hypot(o_u, o_v), "o_gust": np.hypot(o_u, o_v) * 1.4, "block": day // 5,
            "day": day, "station": rng.integers(0, 12, n), "lead": np.full(n, 198.0),
            "region": np.array(["US_PACIFIC"] * n), "month": np.where(np.arange(n) % 2 == 0, 1, 7)}


def test_l1_speed_fit_resists_outliers_where_least_squares_does_not():
    rng = np.random.default_rng(0)
    xs = rng.normal(0, 2, 400)
    ys = 0.6 * xs + 0.5 + rng.normal(0, 0.2, 400)
    ys[:20] += 40.0
    b1, g1 = D.fit_l1_speed(xs, ys)
    _b2, g2 = F.fit_beta_gamma(xs, ys, 0.0)
    assert abs(b1 - 0.6) < 0.05 and abs(g1 - 0.5) < 0.1
    assert abs(g2 - 0.5) > abs(g1 - 0.5)


def test_report_is_labelled_reported_only_and_covers_the_checks():
    rep = D.descriptive_report(_rows())
    assert rep["label"].startswith("DESCRIPTIVE") and "no effect on any verdict" in rep["label"]
    b1 = rep["bins"]["B1"]
    for k in ("l2_ridge", "l1", "one_alpha_damped", "raw_pool", "climatology", "winter_rows_all_year_fit",
              "winter_rows_winter_only_fit"):
        assert np.isfinite(b1[k]["mae"]) and b1[k]["n"] > 0, k
    assert b1["n_winter"] > 0 and rep["bins"]["B2"]["note"] == "too few rows"


def test_calibration_beats_the_raw_pool_on_a_shrinking_truth():
    b1 = D.descriptive_report(_rows())["bins"]["B1"]
    assert b1["l2_ridge"]["mae"] <= b1["raw_pool"]["mae"] + 1e-9
    assert b1["one_alpha_damped"]["mae"] <= b1["raw_pool"]["mae"] + 1e-9


def test_spread_skill_ratio_is_about_one_for_a_reliable_ensemble():
    rng = np.random.default_rng(3)
    nst = 6
    init = R.test_window_runs()[0]
    z, truth = {}, {}
    for step in R.SCORED_LEADS:
        t = rng.normal(5.0, 1.0, nst)
        truth[step] = t + rng.normal(0, 1.0, nst)          # truth is one more draw from the members' distribution
        for name, n in (("aigefs", 31), ("gefs", 31), ("ifs", 51)):
            ku, kv = (("ifs_10u_%d", "ifs_10v_%d") if name == "ifs" else (name + "_u_%d", name + "_v_%d"))
            z[ku % step] = t[None, :] + rng.normal(0, 1.0, (n, nst))
            z[kv % step] = rng.normal(0, 0.001, (n, nst))

    def tf(i, valid):
        return (0.0, 0.0, float(truth[int((valid - init).total_seconds() // 3600)][i]), 0.0, 0.0)
    out = D.spread_skill({init: z}, [{"id": i} for i in range(nst)], tf)["cells"]
    assert {k.split("|")[0] for k in out} == {"aigefs", "gefs", "ifs"}
    assert all(0.6 < v["ratio"] < 1.5 for v in out.values()), out

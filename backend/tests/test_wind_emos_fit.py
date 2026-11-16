"""The long-range wind EMOS evaluation (scripts/wind_emos_fit.py) on synthetic data: truth matching equal to the
hindcast's, the rolling windows, G1-G5 and the three controls. Pre-registration:
docs/weather-program/log/2026-11-16-wind-emos-preregistration.md."""
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import emos_core as E  # noqa: E402
import wind_emos_fit as F  # noqa: E402
import wind_lr_obs as O  # noqa: E402


def test_fastobs_equals_the_hindcast_matching():
    rng = np.random.default_rng(0)
    t0 = datetime(2026, 3, 1, tzinfo=timezone.utc)
    o = {}
    for k in range(400):
        t = t0 + timedelta(minutes=int(k * 37 + rng.integers(0, 9)))
        g = float(rng.uniform(5, 15)) if rng.uniform() > 0.3 else float("nan")
        w = float(rng.uniform(1, 10)) if rng.uniform() > 0.05 else float("nan")
        o[t] = (w, g, float(rng.uniform(0, 360)))
    for asos in (False, True):
        fo = F.FastObs(o, gust_absent_is_wind=asos)
        for h in range(6, 200, 7):
            V = t0 + timedelta(hours=h)
            a, b = fo.wind_at(V), O.wind_at(o, V)
            assert (a is None) == (b is None)
            if a:
                assert a[0] == pytest.approx(b[0])
            assert fo.gust_window(V, 6) == O.gust_window(o, V, 6, gust_absent_is_wind=asos)


def test_regions():
    assert F.region_of({"lat": 21.3, "lon": -157.9}) == "hawaii"
    assert F.region_of({"lat": 57.0, "lon": -152.0}) == "alaska"
    assert F.region_of({"lat": 34.0, "lon": -119.0}) == "us_west"
    assert F.region_of({"lat": 28.5, "lon": -80.2}) == "us_east_gulf"
    assert F.region_of({"lat": 18.4, "lon": -66.0}) == "other"


def _synthetic_rows(monkeypatch, n_st=6, seed=5):
    """Runs 2025-11-01..2026-03-31; truth = 1 + 0.8*m + N(0, 1.5); the members claim sd 0.6 (under-dispersive)."""
    monkeypatch.setattr(F, "TEST", (datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 3, 31, tzinfo=timezone.utc)))
    monkeypatch.setattr(F, "FIXED_FIT", (datetime(2025, 11, 1, tzinfo=timezone.utc), datetime(2025, 12, 17, tzinfo=timezone.utc)))
    monkeypatch.setattr(F, "MIN_ROWS", 60)
    rng = np.random.default_rng(seed)
    R = {k: [] for k in ("run", "lead", "st", "valid_day", "m", "s2", "raw_crps", "y", "gm", "gs2", "graw_crps", "yg",
                         "clim_crps", "net", "region")}
    t = datetime(2025, 11, 1, tzinfo=timezone.utc)
    while t <= datetime(2026, 3, 31, tzinfo=timezone.utc):
        for L in F.C.LEADS:
            V = t + timedelta(hours=L)
            for i in range(n_st):
                m = float(rng.uniform(2, 13))
                members = m + rng.normal(0, 0.6, 51)
                y = max(1.0 + 0.8 * m + float(rng.normal(0, 1.5)), 0.0)
                clim = rng.normal(6.0, 3.0, 200).clip(0)
                for k, v in (("run", t.strftime("%Y%m%d%H")), ("lead", L), ("st", i), ("valid_day", V.strftime("%Y%m%d")),
                             ("m", float(members.mean())), ("s2", float(members.var())),
                             ("raw_crps", float(E.crps_ensemble(members[:, None], np.array([y]))[0])), ("y", y),
                             ("gm", 0.0), ("gs2", 0.0), ("graw_crps", np.nan), ("yg", np.nan),
                             ("clim_crps", float(E.crps_ensemble(clim[:, None], np.array([y]))[0])),
                             ("net", "ndbc"), ("region", "us_east_gulf")):
                    R[k].append(v)
        t += timedelta(days=1)
    return {k: np.array(v) for k, v in R.items()}


def test_score_passes_a_correctable_ensemble_and_the_controls_hold(monkeypatch):
    R = _synthetic_rows(monkeypatch)
    rep = F.score(R)
    assert rep["controls_ok"], {k: v for k, v in rep["lines"].items() if k.startswith("C")}
    for b in F.BINS:
        assert rep["lines"][f"G1_crps_vs_raw_{b}"]["pass"]
        assert rep["lines"][f"G2_median_mae_vs_mean_{b}"]["pass"]
        assert rep["lines"][f"G5_crps_vs_clim_{b}"]["label"] == "beats climatology"
        assert 0.7 <= rep["lines"][f"R_cover80_{b}"]["coverage"] <= 0.9
    shifts = rep["lines"]["C2_seeded_bias"]["intercept_shift_by_cell"]
    assert shifts and all(v == pytest.approx(1.0, abs=0.2) for v in shifts.values())
    assert rep["lines"]["C3_leak_plumbing"]["pass"]
    slopes = rep["slope_b_by_cell"]
    assert slopes and all(0.6 < v["median"] < 1.0 and not v["climatology_equivalent"] for v in slopes.values())
    assert rep["verdict"] in ("PASS", "FAIL")       # G3 may or may not resolve on this small sample; never VOID


def test_rolling_training_never_reaches_past_t_minus_14_days(monkeypatch):
    R = _synthetic_rows(monkeypatch, n_st=3)
    seen = []
    real = E.fit_emos

    def spy(m, s2, y, *a, **k):
        seen.append(len(y))
        return real(m, s2, y, *a, **k)
    monkeypatch.setattr(F.E, "fit_emos", spy)
    run_ts = np.array([F._run_dt(r).timestamp() for r in R["run"]])
    bins = F._cells(R)
    cells, _p = F._cell_index(R, bins, run_ts)
    T = datetime(2026, 2, 1, tzinfo=timezone.utc).timestamp()
    for key, idx_ts in cells.items():
        tr = F._window(idx_ts, T - 59 * 86400.0, T - 14 * 86400.0)
        assert tr.size and run_ts[tr].max() <= T - 14 * 86400.0 and run_ts[tr].min() >= T - 59 * 86400.0

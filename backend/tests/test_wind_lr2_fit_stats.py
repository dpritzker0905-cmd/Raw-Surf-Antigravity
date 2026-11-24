"""Calibration fit, statistics, families, gatekeeping, floors and controls for the long-range wind v2 registration
(docs/weather-program/gates/wind-long-range-v2.md). Synthetic rows only; nothing is read from any network or any
earlier hindcast."""
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_lr2_fit as F  # noqa: E402
import wind_lr2_runs as R  # noqa: E402
import wind_lr2_stats as S  # noqa: E402

UTC = timezone.utc


# ------------------------------------------------------------------------------------------------ runs
def test_fit_run_list_is_registered():
    runs = R.fit_runs()
    assert runs[0] == datetime(2025, 12, 17, tzinfo=UTC)
    assert runs[-1] <= datetime(2026, 9, 30, tzinfo=UTC)
    assert all((b - a).days == 4 for a, b in zip(runs, runs[1:]))
    assert 65 <= len(runs) <= 75 and all(r.hour == 0 for r in runs)


def test_test_window_is_90_runs_00z_and_12z():
    runs = R.test_window_runs()
    assert len(runs) == 90 and runs[0] == datetime(2026, 12, 1, 0, tzinfo=UTC)
    assert runs[-1] == datetime(2027, 1, 14, 12, tzinfo=UTC)
    assert [r.hour for r in runs[:4]] == [0, 12, 0, 12]
    assert R.last_valid(runs) == datetime(2027, 1, 28, 12, tzinfo=UTC)
    assert R.snapshot_end(runs) == datetime(2027, 2, 4, tzinfo=UTC)


def test_missed_freeze_starts_at_first_00z_after_the_commit_and_keeps_90():
    ft = datetime(2026, 12, 3, 9, 30, tzinfo=UTC)
    runs = R.test_window_runs(ft)
    assert runs[0] == datetime(2026, 12, 4, 0, tzinfo=UTC) and len(runs) == 90
    assert all(r >= ft for r in runs)                      # nothing initialised before the freeze is ever TEST
    assert R.test_window_runs(datetime(2026, 11, 28, tzinfo=UTC))[0] == R.TEST_FIRST      # an early freeze does not move it
    assert R.test_window_runs(datetime(2026, 12, 4, 0, tzinfo=UTC))[0] == datetime(2026, 12, 4, 0, tzinfo=UTC)


def test_test_window_never_touches_the_3b_window():
    assert min(R.test_window_runs()) > datetime(2026, 11, 15, 23, tzinfo=UTC)
    assert max(R.fit_runs()) + __import__("datetime").timedelta(hours=336) < datetime(2026, 10, 16, tzinfo=UTC)


def test_bins_and_regions():
    assert [R.bin_of(L) for L in (186, 216, 217, 264, 270, 336)] == ["B1", "B1", "B2", "B2", "B3", "B3"]
    assert R.bin_of(180) is None and R.bin_of(342) is None
    assert R.region_of(21.6, -158.0) == "HAWAII"
    assert R.region_of(34.0, -120.5) == "US_PACIFIC"
    assert R.region_of(40.0, -70.0) == "US_ATLANTIC_GULF"
    assert R.region_of(50.0, -5.0) == "EUROPE_ATLANTIC"
    assert R.region_of(40.0, 15.0) == "MEDITERRANEAN"
    assert R.region_of(-30.0, 150.0) == "OTHER"


@pytest.mark.parametrize("name,lat,lon,want", [
    ("Hossegor", 43.67, -1.44, "EUROPE_ATLANTIC"), ("Mundaka", 43.41, -2.70, "EUROPE_ATLANTIC"),
    ("Biarritz", 43.48, -1.56, "EUROPE_ATLANTIC"), ("Santander", 43.46, -3.80, "EUROPE_ATLANTIC"),
    ("Peniche", 39.36, -9.38, "EUROPE_ATLANTIC"), ("Newquay", 50.41, -5.08, "EUROPE_ATLANTIC"),
    ("Marseille", 43.30, 5.37, "MEDITERRANEAN"), ("Malaga", 36.72, -4.42, "MEDITERRANEAN"),
    ("Genoa", 44.40, 8.93, "MEDITERRANEAN"), ("Venice", 45.44, 12.33, "MEDITERRANEAN"), ("Haifa", 32.82, 34.99, "MEDITERRANEAN"),
    ("Varna (Black Sea)", 43.20, 27.92, "BLACK_SEA"),
    ("Chicago (Lake Michigan)", 41.88, -87.63, "GREAT_LAKES"), ("Duluth (Lake Superior)", 46.79, -92.10, "GREAT_LAKES"),
    ("Buffalo (Lake Erie)", 42.88, -78.88, "GREAT_LAKES"),
    ("Hawaii as 203 E", 21.6, 203.0, "HAWAII"), ("Huntington Beach as 242 E", 33.66, 242.0, "US_PACIFIC"),
    ("Halifax (Maritimes)", 44.65, -63.57, "US_ATLANTIC_GULF"), ("Bermuda", 32.30, -64.75, "US_ATLANTIC_GULF"),
    ("Azores", 38.70, -27.20, "OTHER"), ("Sea of Marmara", 40.80, 28.90, "BLACK_SEA"),
    ("Montauk", 41.04, -71.95, "US_ATLANTIC_GULF"), ("Cape Hatteras", 35.25, -75.53, "US_ATLANTIC_GULF"),
    ("Galveston", 29.30, -94.80, "US_ATLANTIC_GULF"), ("Huntington Beach", 33.66, -118.0, "US_PACIFIC")])
def test_named_points_land_in_the_right_region(name, lat, lon, want):
    assert R.region_of(lat, lon) == want, name


def test_great_lakes_are_excluded_and_black_sea_is_not_a_gated_region():
    assert "GREAT_LAKES" in R.EXCLUDED_REGIONS and "GREAT_LAKES" not in R.REGIONS and "BLACK_SEA" not in R.REGIONS


# ------------------------------------------------------------------------------------------------ fit
def _rows(n=600, alpha_true=0.4, seed=1, days=60, noise=0.5):
    rng = np.random.default_rng(seed)
    c_u, c_v = rng.normal(0, 1, n), rng.normal(0, 1, n)
    m_u, m_v = c_u + rng.normal(0, 3, n), c_v + rng.normal(0, 3, n)
    o_u = c_u + alpha_true * (m_u - c_u) + rng.normal(0, noise, n)
    o_v = c_v + alpha_true * (m_v - c_v) + rng.normal(0, noise, n)
    c_s = np.full(n, 5.0)
    s = np.hypot(m_u, m_v) + 2
    o_s = np.hypot(o_u, o_v)
    day = rng.integers(0, days, n)
    return {"m_u": m_u, "m_v": m_v, "s": s, "c_u": c_u, "c_v": c_v, "c_s": c_s, "o_u": o_u, "o_v": o_v, "o_s": o_s,
            "o_gust": o_s * 1.4, "block": day // 5, "day": day, "station": rng.integers(0, 12, n),
            "lead": rng.choice([198, 240, 300], n), "region": np.array(["US_PACIFIC"] * n)}


def test_ridge_extremes_are_ols_and_raw_pool():
    x = np.array([1.0, 2.0, -1.0, 0.5])
    y = 0.3 * x
    assert F.fit_alpha(x, y, 0.0) == pytest.approx(0.3)
    assert F.fit_alpha(x, y, math.inf) == 1.0
    assert 0.3 < F.fit_alpha(x, y, 1.0) < 1.0           # a finite lambda lies between (target is the RAW pool, alpha = 1)
    assert F.fit_alpha(np.zeros(4), np.zeros(4), 0.1) == 1.0       # no signal: stay raw


def test_speed_ridge_shrinks_toward_one_zero():
    xs = np.array([1.0, 2.0, 3.0, -1.0, -2.0])
    ys = 0.5 * xs + 1.0
    b0, g0 = F.fit_beta_gamma(xs, ys, 0.0)
    assert b0 == pytest.approx(0.5) and g0 == pytest.approx(1.0)
    assert F.fit_beta_gamma(xs, ys, math.inf) == (1.0, 0.0)
    b1, g1 = F.fit_beta_gamma(xs, ys, 1.0)
    assert 0.5 < b1 < 1.0 and 0.0 < g1 < 1.0


def test_fit_recovers_a_shrinking_alpha_and_cv_chooses_to_move_off_raw():
    cell = F.fit_cell(_rows())
    assert 0.3 < cell["alpha"] < 0.55
    assert cell["lambda_vec"] != "inf"


def test_cv_keeps_the_raw_pool_when_the_model_is_already_right():
    cell = F.fit_cell(_rows(alpha_true=1.0, noise=0.2))
    assert cell["alpha"] == pytest.approx(1.0, abs=0.05)


def test_single_block_cannot_validate_so_stays_raw():
    r = _rows(days=4)
    r["block"] = np.zeros(len(r["s"]), dtype=int)
    cell = F.fit_cell(r)
    assert cell["alpha"] == 1.0 and cell["lambda_vec"] == "inf"


def test_thin_cells_borrow_the_pooled_fit_and_are_flagged():
    r = _rows(n=900)
    r["region"] = np.array(["US_PACIFIC"] * 880 + ["HAWAII"] * 20)
    coefs = F.fit_all(r, "GRAND_CAL")
    regs = coefs["bins"]["B2"]["regions"]
    assert regs["HAWAII"]["borrowed"] is True
    assert regs["HAWAII"]["alpha"] == regs["POOLED"]["alpha"]
    assert regs["US_PACIFIC"]["borrowed"] is False


def test_coefficients_interpolate_in_lead_with_no_step_at_the_bin_edges():
    coefs = {"bins": {"B1": {"center": 198.0, "regions": {"POOLED": {"alpha": 0.8, "beta": 1.0, "gamma": 0.0, "gf": 1.3}}},
                      "B2": {"center": 240.0, "regions": {"POOLED": {"alpha": 0.5, "beta": 0.9, "gamma": 0.1, "gf": 1.3}}},
                      "B3": {"center": 300.0, "regions": {"POOLED": {"alpha": 0.1, "beta": 0.7, "gamma": 0.2, "gf": 1.3}}}}}
    assert F.coef_at(coefs, "X", 180)["alpha"] == 0.8 and F.coef_at(coefs, "X", 336)["alpha"] == 0.1      # flat outside
    assert F.coef_at(coefs, "X", 240)["alpha"] == pytest.approx(0.5)
    assert F.coef_at(coefs, "X", 219)["alpha"] == pytest.approx(0.8 + (0.5 - 0.8) * 21 / 42)
    jump = abs(F.coef_at(coefs, "X", 217)["alpha"] - F.coef_at(coefs, "X", 216)["alpha"])
    assert jump < 0.01 and abs(F.coef_at(coefs, "X", 265)["alpha"] - F.coef_at(coefs, "X", 264)["alpha"]) < 0.01


def test_apply_cal_identity_and_climatology_limits():
    m_u, m_v, s = np.array([3.0]), np.array([4.0]), np.array([5.0])
    c_u, c_v, c_s = np.array([1.0]), np.array([0.0]), np.array([3.0])
    raw = {"alpha": 1.0, "beta": 1.0, "gamma": 0.0, "gf": 1.4}
    u, v, sp, g = F.apply_cal(m_u, m_v, s, c_u, c_v, c_s, raw)
    assert sp[0] == pytest.approx(5.0) and np.hypot(u, v)[0] == pytest.approx(5.0)
    assert (u[0] / sp[0], v[0] / sp[0]) == pytest.approx((0.6, 0.8)) and g[0] == pytest.approx(7.0)
    clim = {"alpha": 0.0, "beta": 0.0, "gamma": 0.0, "gf": 1.0}
    u, v, sp, g = F.apply_cal(m_u, m_v, s, c_u, c_v, c_s, clim)
    assert sp[0] == pytest.approx(3.0) and (u[0], v[0]) == pytest.approx((3.0, 0.0))     # direction from c, speed c_s
    u, v, sp, _ = F.apply_cal(np.array([0.0]), np.array([0.0]), np.array([0.0]), np.array([0.0]), np.array([0.0]),
                              np.array([0.0]), raw)
    assert (u[0], v[0], sp[0]) == (0.0, 0.0, 0.0)


def test_freeze_hash_detects_any_change(tmp_path):
    coefs = {"GRAND_CAL": {"a": 1.0}, "AIGEFS_CAL": {"a": 0.5}}
    f = tmp_path / "clim.bin"
    f.write_bytes(b"era5")
    man = F.freeze_manifest(coefs, {"clim": str(f)})
    assert F.verify_freeze(man, coefs, {"clim": str(f)}) == []
    assert F.verify_freeze(man, {"GRAND_CAL": {"a": 1.0}, "AIGEFS_CAL": {"a": 0.51}}, {"clim": str(f)}) == ["coefficients:AIGEFS_CAL"]
    f.write_bytes(b"era5!")
    assert F.verify_freeze(man, coefs, {"clim": str(f)}) == ["files:clim"]
    assert F.sha256_doc({"b": 1, "a": 2}) == F.sha256_doc({"a": 2, "b": 1})        # canonical, key-order free


# ------------------------------------------------------------------------------------------------ stats
def _diff(n_days=50, per_day=20, shift=-0.2, sd=0.5, seed=3):
    rng = np.random.default_rng(seed)
    days = np.repeat(np.arange(n_days) + 739000, per_day)
    return rng.normal(shift, sd, days.size), days


def test_null_line_is_exactly_zero_with_zero_width_ci():
    d, days = _diff()
    r = S.paired_line(np.zeros_like(d), days)
    assert r["mean"] == 0.0 and r["ci"] == [0.0, 0.0]


def test_clear_gain_is_significant_and_no_gain_is_not():
    d, days = _diff(shift=-0.3)
    r = S.paired_line(d, days)
    assert r["ci"][1] < 0 and r["p"] < 0.01
    d0, days0 = _diff(shift=0.0, seed=9)
    r0 = S.paired_line(d0, days0)
    assert r0["ci"][0] < 0 < r0["ci"][1]


def test_bootstrap_is_reproducible_and_seeded():
    d, days = _diff()
    assert S.paired_line(d, days) == S.paired_line(d, days)
    assert S.paired_line(d, days, seed=1)["ci"] != S.paired_line(d, days, seed=2)["ci"]
    assert S.SEED == 20261122 and S.REPS == 10_000 and S.BLOCK_DAYS == 5


def test_blocks_widen_the_interval_for_autocorrelated_days():
    rng = np.random.default_rng(5)
    base = np.cumsum(rng.normal(0, 0.15, 60))            # slowly varying day effect
    days = np.repeat(np.arange(60) + 739000, 10)
    diff = np.repeat(base - base.mean(), 10) - 0.1 + rng.normal(0, 0.05, 600)
    five = S.paired_line(diff, days)
    one = S.moving_block_means(*S.day_arrays(diff, days), block=1)
    assert (five["ci"][1] - five["ci"][0]) > (np.percentile(one, 97.5) - np.percentile(one, 2.5))


def test_holm_is_monotone_and_matches_known_values():
    adj = S.holm_adjust([0.01, 0.04, 0.03, 0.005])
    assert adj == pytest.approx([0.03, 0.06, 0.06, 0.02])
    assert all(0 <= a <= 1 for a in adj)
    assert S.holm_adjust([]) == []


def test_family_sizes_are_the_registered_counts():
    assert len(S.f1_lines()) == 20 and len(set(S.f1_lines())) == 20
    assert len(S.f3_lines()) == 6
    assert len(S.f1c_lines("ICON")) == 6 and len(S.f1c_lines("EURO")) == 4
    assert all(a != "CLIM_SERVE" for a, *_ in S.f1_lines())          # CLIM_SERVE never enters F1 or F3
    assert all(a != "CLIM_SERVE" for a, _ in S.f3_lines())
    assert {c for _, _, c, _ in S.f1_lines()} == {"LOOP_PROXY", "GFS"}


def _sig(keys, sig=True):
    return {k: {"sig": sig, "p": 0.001} for k in keys}


def test_tail_passes_needs_every_line_g3_and_the_gates():
    f1 = _sig(S.f1_lines())
    f3 = _sig([(a, b) for a, b in S.f3_lines() if b != "B3"])
    f3.update({(a, "B3"): {"sig": False, "p": 0.6} for a in S.CAL_ARMS})          # B3: not significantly worse = ok
    assert S.tail_passes("GRAND_CAL", "ICON", f1, f3, True, True, True)
    assert not S.tail_passes("GRAND_CAL", "ICON", f1, f3, False, True, True)       # G4 seam fail
    assert not S.tail_passes("GRAND_CAL", "ICON", f1, f3, True, False, True)       # G5
    assert not S.tail_passes("GRAND_CAL", "ICON", f1, f3, True, True, False)       # G6
    f1b = dict(f1)
    f1b[("GRAND_CAL", "M2", "LOOP_PROXY", "B3")] = {"sig": False, "p": 0.2}
    assert not S.tail_passes("GRAND_CAL", "ICON", f1b, f3, True, True, True)
    assert S.tail_passes("GRAND_CAL", "EURO", f1b, f3, True, True, True)           # the other tail is decided on its own lines
    f3w = dict(f3)
    f3w[("GRAND_CAL", "B3")] = {"sig": True, "p": 0.001}                            # significantly worse than CLIM in B3
    assert not S.tail_passes("GRAND_CAL", "ICON", f1, f3w, True, True, True)


def test_gatekeeping_and_ship_order():
    assert S.gate_open_for_clim_serve({"GRAND_CAL": False, "AIGEFS_CAL": False})
    assert not S.gate_open_for_clim_serve({"GRAND_CAL": False, "AIGEFS_CAL": True})
    assert S.tail_decision("ICON", {"GRAND_CAL": True, "AIGEFS_CAL": True}, None) == "GRAND_CAL"
    assert S.tail_decision("ICON", {"GRAND_CAL": False, "AIGEFS_CAL": True}, None) == "AIGEFS_CAL"
    assert S.tail_decision("EURO", {"GRAND_CAL": False, "AIGEFS_CAL": False}, True) == "CLIM_SERVE"
    assert S.tail_decision("EURO", {"GRAND_CAL": False, "AIGEFS_CAL": False}, False) == "NONE"
    assert S.tail_decision("EURO", {"GRAND_CAL": True, "AIGEFS_CAL": False}, True) == "GRAND_CAL"     # never ships beside a pass


def test_b3_not_worse_line_flags_a_significantly_worse_arm():
    d, days = _diff(shift=+0.3)                      # arm minus CLIM positive = worse
    assert S.b3_not_worse(d, days)["p"] < 0.025
    d, days = _diff(shift=-0.3)
    assert S.b3_not_worse(d, days)["p"] > 0.5


def test_floors_void_not_fail():
    days = np.repeat(np.arange(52) + 739000, 5)
    st = {"US_PACIFIC": 12, "US_ATLANTIC_GULF": 15, "HAWAII": 10}
    assert S.check_floors(90, days, st) == []
    assert any("kept TEST runs" in x for x in S.check_floors(79, days, st))
    assert any("dropped" in x for x in S.check_floors(80, days, st))        # 10 of 90 dropped is exactly 11% > 10%
    assert S.check_floors(81, days, st) == []                                # 9 of 90 = 10.0% is allowed
    assert any("valid days" in x for x in S.check_floors(90, days[:200], st))
    assert any("regions" in x for x in S.check_floors(90, days, {"US_PACIFIC": 12, "HAWAII": 3}))
    assert S.block_count(np.arange(739000, 739000 + 45)) in (9, 10)


def test_controls_plant_and_shuffle():
    spd = np.array([3.0, 5.0])
    assert list(S.plant_speed(spd)) == [4.0, 6.0]
    d = np.arange(1000) % 360.0
    d2, mask = S.plant_direction(d, 60.0)
    assert 0.10 < mask.mean() < 0.20 and np.all(d2[~mask] == d[~mask])
    assert np.allclose((d2[mask] - d[mask]) % 360.0, 60.0)
    d3, mask3 = S.plant_direction(d, 30.0)
    assert np.array_equal(mask, mask3)                                         # the SAME 15% of rows for 1x and 2x
    obs_spd = np.full(1000, 6.0)
    assert S.signed_dir_me(d2, d, obs_spd) > 5.0 > abs(S.signed_dir_me(d, d, obs_spd))
    assert list(S.shuffled_pairing_index(np.array([10, 11]), 7)) == [17, 18]

"""Gust family FG of amendment G1: CLIM_GUST, FG1/FG2 (margin 0.10 m/s), GG4-GG6, gust controls, serial verdict, FIT-only
power note. Synthetic rows only; no network, no real data, nothing run on collected runs."""
import math
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_lr2_gust as G  # noqa: E402
import wind_lr2_rows as W  # noqa: E402
import wind_lr2_stats as S  # noqa: E402

UTC = timezone.utc
REPS = 2000      # p resolution 1/(REPS+1) must clear Holm over 20 lines at 0.025
LEADS = (186, 210, 246, 258, 270, 330)          # B1, B1, B2>240, B2>240, B3, B3
REGIONS = ("HAWAII", "US_PACIFIC", "US_ATLANTIC_GULF")


# ------------------------------------------------------------------------------------------------ frozen constants
def test_frozen_constants():
    assert (G.DELTA_FG2, G.FIX140_FACTOR, G.CLIM_YEARS, G.HALF_DAYS, G.MIN_RECORDS) == (0.10, 1.40, (2016, 2025), 15, 20)
    assert G.CLIM_HOURS == (0, 6, 12, 18) and len(G.CELLS) == 5 and G.MIN_GUST_REGIONS == 3
    assert G.MG_CELLS == {"ICON": ("B1", "B2", "B3"), "EURO": ("B2>240", "B3")}
    keys = G.fg_lines()
    assert len(keys) == 20 and len(set(keys)) == 20
    assert {k[1] for k in keys} == {"FG1", "FG2"} and {k[2] for k in keys} == {"CLIM_GUST", "FIX140"}


# ------------------------------------------------------------------------------------------------ CLIM_GUST
def _recs(n, hour=12, year=2020, base_day=100, val=10.0):
    d0 = datetime(year, 1, 1, tzinfo=UTC) + timedelta(days=base_day - 1)
    return [(d0 + timedelta(days=i % 31, hours=hour), val + (i % 2)) for i in range(n)]


def test_clim_gust_needs_twenty_records_and_is_the_mean():
    recs = [(datetime(2016 + i % 10, 4, 10 + i // 10, 12, tzinfo=UTC), 8.0 + i) for i in range(20)]
    c = G.ClimGust.build({"A": recs})
    ask = datetime(2026, 4, 12, 12, tzinfo=UTC)
    assert c.get("A", ask) == pytest.approx(np.mean([8.0 + i for i in range(20)]))
    assert c.get("A", datetime(2026, 12, 1, 12, tzinfo=UTC)) is None
    assert G.ClimGust.build({"A": recs[:19]}).get("A", ask) is None       # 19 < 20: no cell, never filled
    assert c.stations_without(["A", "B"], ask) == ["B"]


def test_clim_gust_window_is_plus_minus_15_days_and_circular_and_hour_specific():
    c = G.ClimGust.build({"A": [(datetime(2018, 4, 10, 6, tzinfo=UTC), 5.0)] * 20})      # doy 100, hour 6
    assert c.get("A", datetime(2026, 4, 25, 6, tzinfo=UTC)) == 5.0       # +15 d
    assert c.get("A", datetime(2026, 4, 26, 6, tzinfo=UTC)) is None      # +16 d
    assert c.get("A", datetime(2026, 3, 26, 6, tzinfo=UTC)) == 5.0       # -15 d
    assert c.get("A", datetime(2026, 4, 10, 12, tzinfo=UTC)) is None     # another hour
    ny = G.ClimGust.build({"A": [(datetime(2017, 1, 3, 0, tzinfo=UTC), 7.0)] * 20})
    assert ny.get("A", datetime(2026, 12, 25, 0, tzinfo=UTC)) == 7.0     # circular across the year end


def test_clim_gust_years_are_frozen_to_2016_2025():
    inside = [(datetime(2016, 4, 10, 6, tzinfo=UTC), 5.0)] * 10 + [(datetime(2025, 4, 10, 6, tzinfo=UTC), 5.0)] * 10
    outside = [(datetime(2015, 4, 10, 6, tzinfo=UTC), 99.0)] * 30 + [(datetime(2026, 4, 10, 6, tzinfo=UTC), 99.0)] * 30
    c = G.ClimGust.build({"A": inside + outside})
    assert c.get("A", datetime(2026, 4, 10, 6, tzinfo=UTC)) == 5.0       # 2015 and 2026 records never enter


def test_clim_gust_hash_is_deterministic_and_value_sensitive():
    a = {"A": _recs(30), "B": _recs(25, hour=6)}
    h1 = G.ClimGust.build(a).sha256()
    assert h1 == G.ClimGust.build(dict(reversed(list(a.items())))).sha256() and len(h1) == 64
    b = {"A": _recs(30), "B": _recs(25, hour=6)}
    b["A"][0] = (b["A"][0][0], b["A"][0][1] + 0.5)
    assert G.ClimGust.build(b).sha256() != h1


def _obs_full(year, base=8.0):
    """Every hour of `year` has a GST record (wspd 5, gust base + hour-of-day/10, wdir 90)."""
    t, end, out = datetime(year, 1, 1, tzinfo=UTC), datetime(year + 1, 1, 1, tzinfo=UTC), {}
    while t < end:
        out[t] = (5.0, base + t.hour / 10.0, 90.0)
        t += timedelta(hours=1)
    return out


def test_clim_gust_records_follow_the_gust_truth_rules():
    obs = _obs_full(2020)
    ident = lambda g, z: g  # noqa: E731
    r = G.clim_gust_records(obs, 4.0, ident, W.gust_window_gst, years=(2020, 2020))
    assert len(r) >= 366 * 4 - 4 and {t.hour for t, _ in r} == {0, 6, 12, 18}
    assert dict(r)[datetime(2020, 6, 1, 12, tzinfo=UTC)] == pytest.approx(8.0 + 12 / 10.0)      # max of hours 7..12
    for z in (0.5, 60.0, None):                                         # outside 1-50 m or no height: no gust truth
        assert G.clim_gust_records(obs, z, ident, W.gust_window_gst, years=(2020, 2020)) == []
    gap = dict(obs)
    del gap[datetime(2020, 6, 1, 9, tzinfo=UTC)]
    r2 = dict(G.clim_gust_records(gap, 4.0, ident, W.gust_window_gst, years=(2020, 2020)))
    assert datetime(2020, 6, 1, 12, tzinfo=UTC) not in r2 and datetime(2020, 6, 1, 18, tzinfo=UTC) in r2


def test_clim_gust_applies_the_log_law_adjustment():
    import wind_lr_obs as O
    r = dict(G.clim_gust_records(_obs_full(2020), 4.0, O.to_10m, W.gust_window_gst, years=(2020, 2020)))
    assert r[datetime(2020, 6, 1, 12, tzinfo=UTC)] == pytest.approx(float(O.to_10m(9.2, 4.0)))


def test_attach_clim_gust_maps_valid_hour_station_and_day():
    recs = [(datetime(2018, 4, 10, 6, tzinfo=UTC), 5.0)] * 20 + [(datetime(2018, 4, 10, 12, tzinfo=UTC), 9.0)] * 20
    c = G.ClimGust.build({"S0": recs})
    rows = {"lead": np.array([246, 240]), "hour": np.array([6, 6]), "st": np.array([0, 0]),
            "vday": np.array([datetime(2026, 4, 12).toordinal()] * 2)}
    out = G.attach_clim_gust(rows, c, ["S0"])
    assert out["vhour"].tolist() == [12, 6]                              # (init hour 6 + lead) mod 24
    assert out["CLIM_GUST_g"].tolist() == [9.0, 5.0]
    out2 = G.attach_clim_gust(dict(rows, st=np.array([0, 1])), c, ["S0", "NOPE"])
    assert math.isnan(out2["CLIM_GUST_g"][1])                            # no station record: NaN, never filled


# ------------------------------------------------------------------------------------------------ synthetic row table
def _table(skill=0.9, arm_sd=0.5, clim_sd=0.3, fix_sd=2.0, n_days=60, n_st=12, seed=1, arms=S.CAL_ARMS):
    """One row per (day, station, lead). Truth gust = 10 + anomaly (N(0, 3)). The arm tracks `skill` of the anomaly plus
    N(0, arm_sd); CLIM_GUST is the level 10 plus N(0, clim_sd) (it knows nothing about the day); the FIX140 error is
    controlled through arm_s (1.40 * arm_s = truth + N(0, fix_sd)). The shifted truths are independent days."""
    rng = np.random.default_rng(seed)
    cols = {k: [] for k in ("run", "hour", "init_ts", "st", "lead", "vday", "region", "marine", "o_g", "o_g_p7", "o_g_p48",
                            "CLIM_GUST_g")}
    for a in arms:
        cols[f"{a}_g"], cols[f"{a}_s"] = [], []
    base = datetime(2026, 12, 1).toordinal()
    for d in range(n_days):
        for st in range(n_st):
            for lead in LEADS:
                anom = rng.normal(0, 3.0)
                truth = 10.0 + anom
                cols["run"].append(base + d - 12), cols["hour"].append(0), cols["init_ts"].append(float(d))
                cols["st"].append(st), cols["lead"].append(lead), cols["vday"].append(base + d)
                cols["region"].append(REGIONS[st % 3]), cols["marine"].append(True)
                cols["o_g"].append(truth)
                cols["o_g_p7"].append(10.0 + rng.normal(0, 3.0)), cols["o_g_p48"].append(10.0 + rng.normal(0, 3.0) + 4.0)
                cols["CLIM_GUST_g"].append(10.0 + rng.normal(0, clim_sd))
                for a in arms:
                    cols[f"{a}_g"].append(10.0 + skill * anom + rng.normal(0, arm_sd))
                    cols[f"{a}_s"].append((truth + rng.normal(0, fix_sd)) / G.FIX140_FACTOR)
    return {k: np.array(v) for k, v in cols.items()}


@pytest.fixture(scope="module")
def skilled():
    return _table()


def test_family_has_twenty_lines_even_with_one_arm_missing():
    rows = _table(arms=("GRAND_CAL",), n_days=40, n_st=4)
    rows["AIGEFS_CAL_g"] = np.full(len(rows["lead"]), np.nan)
    rows["AIGEFS_CAL_s"] = np.full(len(rows["lead"]), np.nan)
    fg = G.compute_fg(rows, reps=REPS)
    assert len(fg) == 20
    assert all(fg[k]["p_adj"] == 1.0 and not fg[k]["sig"] for k in fg if k[0] == "AIGEFS_CAL")   # empty lines stay in


def test_skilled_arm_passes_fg_in_every_cell(skilled):
    fg = G.compute_fg(skilled, reps=REPS)
    for arm in S.CAL_ARMS:
        assert G.fg_pass(arm, "ICON", fg) and G.fg_pass(arm, "EURO", fg), arm
        assert fg[(arm, "FG1", "CLIM_GUST", "ICON:B1")]["mean"] < 0 and fg[(arm, "FG1", "CLIM_GUST", "ICON:B1")]["sig"]


def test_arm_that_only_draws_with_clim_gust_fails_fg1_in_b1():
    fg = G.compute_fg(_table(skill=0.0, arm_sd=0.3, clim_sd=0.3), reps=REPS)
    assert not fg[("GRAND_CAL", "FG1", "CLIM_GUST", "ICON:B1")]["sig"]
    assert not G.fg_pass("GRAND_CAL", "ICON", fg)
    assert not fg[("GRAND_CAL", "FG1", "CLIM_GUST", "ICON:B3")]["sig"]         # the B3 "not worse" reading holds on a draw


def test_fg2_margin_is_an_upper_bound_not_a_no_difference_test():
    n = 40
    base = {"lead": np.array([186] * n), "vday": np.arange(n) + 739000, "marine": np.ones(n, bool),
            "region": np.array(["HAWAII"] * n), "st": np.zeros(n, int), "o_g": np.full(n, 10.0)}

    def rows_with(offset):
        r = dict(base)
        r["GRAND_CAL_s"] = np.full(n, 12.0 / G.FIX140_FACTOR)                 # FIX140 error is exactly 2.0
        r["GRAND_CAL_g"] = np.full(n, 12.0 + offset)                          # arm error 2.0 + offset
        r["CLIM_GUST_g"] = np.full(n, 99.0)
        return r
    key = ("GRAND_CAL", "FG2", "FIX140", "ICON:B1")
    ok_rows, bad_rows = rows_with(0.05), rows_with(0.15)
    ok = S.paired_line(G._line_diff(ok_rows, key), ok_rows["vday"], REPS)
    bad = S.paired_line(G._line_diff(bad_rows, key), bad_rows["vday"], REPS)
    assert ok["ci"][1] < 0 < bad["ci"][0]          # 0.05 m/s worse is inside the 0.10 margin; 0.15 worse is outside it
    assert ok["mean"] == pytest.approx(-0.05) and bad["mean"] == pytest.approx(0.05)


def test_arm_clearly_worse_than_fix140_fails_fg2():
    fg = G.compute_fg(_table(arm_sd=4.0, fix_sd=1.0, n_days=50), reps=REPS)
    assert not fg[("GRAND_CAL", "FG2", "FIX140", "ICON:B1")]["sig"]
    assert not G.fg_pass("GRAND_CAL", "ICON", fg)


def test_gg5_needs_the_effect_in_both_halves(skilled):
    assert G.gg5_halves(skilled, G.compute_fg(skilled, reps=REPS), "GRAND_CAL", "ICON")["ok"]
    rows = dict(skilled)
    first = rows["init_ts"] < np.median(rows["init_ts"])
    rows["GRAND_CAL_g"] = np.where(first, rows["o_g"], rows["CLIM_GUST_g"] + 5.0)      # skilled only in the first half
    out = G.gg5_halves(rows, G.compute_fg(rows, reps=REPS), "GRAND_CAL", "ICON")
    assert not out["ok"] and out["failed"]


def test_gg6_flags_a_significantly_worse_region_and_reports_thin_ones(skilled):
    assert G.gg6_regions(skilled, "GRAND_CAL", "ICON", REPS, min_stations=2)["ok"]
    rows = dict(skilled)
    rows["GRAND_CAL_g"] = np.where(rows["region"] == "HAWAII", rows["o_g"] + 9.0, rows["GRAND_CAL_g"])
    out = G.gg6_regions(rows, "GRAND_CAL", "ICON", REPS, min_stations=2)
    assert not out["ok"] and any(f.startswith("HAWAII:") for f in out["flagged"])
    thin = G.gg6_regions(skilled, "GRAND_CAL", "ICON", REPS, min_stations=99)
    assert thin["ok"] and thin["insufficient"] and not thin["flagged"]          # insufficient is never a verdict


def test_gg4_is_not_measurable_without_the_hres_gust_column(skilled):
    assert not G.gg4_seam(skilled, "GRAND_CAL", np.array([1.0]))["ok"]
    out = G.gg4_seam(dict(skilled, hres240_g=skilled["o_g"] + 0.1), "GRAND_CAL", np.array([5.0, 6.0, 7.0]))
    assert "icon_seam" in out and ("p95_seam" in out or "reason" in out)


def test_floors_void_not_fail():
    assert G.check_gust_floors({"A": 10, "B": 12, "C": 30}) == []
    assert G.check_gust_floors({"A": 10, "B": 9, "C": 30})                # only two regions reach 10 stations
    assert G.check_gust_floors({"EUROPE_ATLANTIC": 0, "HAWAII": 10})      # Europe has no GST stations


def test_controls_hold_on_clean_rows_and_flag_a_leak_or_a_dead_shift(skilled):
    ctl = G.gust_controls(skilled, reps=REPS)
    assert all(v["ok"] for v in ctl.values()), ctl
    assert not G.gust_controls(dict(skilled, o_g_p7=skilled["o_g"]), reps=REPS)["shuffled"]["ok"]     # shifted truth = truth: leak
    assert not G.gust_controls(dict(skilled, o_g_p48=skilled["o_g"]), reps=REPS)["shifted"]["ok"]      # shift changes nothing


# ------------------------------------------------------------------------------------------------ serial verdict
def test_gust_is_tested_only_for_an_arm_that_passed_wind(skilled):
    sbr = {"HAWAII": 12, "US_PACIFIC": 12, "US_ATLANTIC_GULF": 12}
    wp = {"ICON": {"GRAND_CAL": True, "AIGEFS_CAL": False}, "EURO": {"GRAND_CAL": False, "AIGEFS_CAL": False}}
    doc = G.gust_verdict(skilled, wp, np.array([5.0, 6.0]), sbr, reps=REPS, control_reps=REPS)
    assert doc["void_reasons"] == [] and doc["verdict"] == "READ"
    assert doc["tails"]["ICON"]["GRAND_CAL"]["evaluated"]
    assert not doc["tails"]["ICON"]["AIGEFS_CAL"]["evaluated"] and not doc["tails"]["EURO"]["GRAND_CAL"]["evaluated"]
    assert len(doc["fg"]) == 20                                         # adjusted over all 20 whether or not evaluated


def test_icon_gust_pass_is_pending_the_live_seam_read_and_never_ships_gust_by_default(skilled):
    sbr = {"HAWAII": 12, "US_PACIFIC": 12, "US_ATLANTIC_GULF": 12}
    wp = {"ICON": {"GRAND_CAL": True, "AIGEFS_CAL": False}, "EURO": {"GRAND_CAL": False, "AIGEFS_CAL": False}}
    a = G.gust_verdict(skilled, wp, np.array([5.0, 6.0]), sbr, reps=REPS, control_reps=REPS)["tails"]["ICON"]["GRAND_CAL"]
    assert a["FG"] and a["GG5"]["ok"] and a["GG6"]["ok"]                 # every other line holds
    assert a["status"] == "PASS_PENDING_SEAM" and a["ships"] == "WIND_ONLY" and a["pass"] is False
    assert a["GG4"]["measurable"] is False and "PENDING" in a["GG4"]["reason"]


def test_an_all_nan_hres_gust_is_not_measurable_not_a_seam_failure(skilled):
    rows = dict(skilled, hres240_g=np.full(len(skilled["lead"]), np.nan))
    out = G.gg4_seam(rows, "GRAND_CAL", np.array([5.0, 6.0]))
    assert out["measurable"] is False and out["ok"] is False and "NOT MEASURABLE" in out["reason"] and "p95_seam" not in out
    sbr = {"HAWAII": 12, "US_PACIFIC": 12, "US_ATLANTIC_GULF": 12}
    wp = {"ICON": {}, "EURO": {"GRAND_CAL": True, "AIGEFS_CAL": False}}
    a = G.gust_verdict(rows, wp, np.array([5.0, 6.0]), sbr, reps=REPS, control_reps=REPS)["tails"]["EURO"]["GRAND_CAL"]
    assert a["status"] == "PASS_PENDING_SEAM" and a["ships"] == "WIND_ONLY"          # not "FAIL": a missing read, not a measured failure


def test_a_measured_euro_seam_pass_ships_and_a_measured_seam_fail_is_a_fail(skilled):
    sbr = {"HAWAII": 12, "US_PACIFIC": 12, "US_ATLANTIC_GULF": 12}
    wp = {"ICON": {}, "EURO": {"GRAND_CAL": True, "AIGEFS_CAL": False}}
    good = dict(skilled, hres240_g=skilled["GRAND_CAL_g"])                              # seam difference 0
    a = G.gust_verdict(good, wp, np.array([1.0, 2.0]), sbr, reps=REPS, control_reps=REPS)["tails"]["EURO"]["GRAND_CAL"]
    assert a["status"] == "PASS" and a["ships"] == "WIND_AND_GUST"
    bad = dict(skilled, hres240_g=skilled["GRAND_CAL_g"] + 50.0)                         # a 50 m/s step at the seam
    b = G.gust_verdict(bad, wp, np.array([1.0, 2.0]), sbr, reps=REPS, control_reps=REPS)["tails"]["EURO"]["GRAND_CAL"]
    assert b["status"] == "FAIL" and b["ships"] == "WIND_ONLY"


def test_a_gust_fail_ships_wind_only_and_never_rewrites_the_wind_verdict():
    rows = _table(skill=0.0, arm_sd=0.3, clim_sd=0.3)
    sbr = {"HAWAII": 12, "US_PACIFIC": 12, "US_ATLANTIC_GULF": 12}
    wp = {"ICON": {"GRAND_CAL": True, "AIGEFS_CAL": True}, "EURO": {"GRAND_CAL": True, "AIGEFS_CAL": True}}
    doc = G.gust_verdict(rows, wp, np.array([5.0, 6.0]), sbr, reps=REPS, control_reps=REPS)
    assert doc["tails"]["ICON"]["GRAND_CAL"]["ships"] == "WIND_ONLY"
    assert wp["ICON"]["GRAND_CAL"] is True                              # the wind decision is an input, never rewritten


def test_a_floor_voids_the_gust_verdict_only(skilled):
    doc = G.gust_verdict(skilled, {"ICON": {"GRAND_CAL": True}}, np.array([5.0]), {"HAWAII": 3}, reps=REPS, control_reps=REPS)
    assert doc["verdict"] == "VOID" and any("regions" in r for r in doc["void_reasons"])


# ------------------------------------------------------------------------------------------------ power note
def test_power_note_is_arithmetic_on_fit_blocks():
    rows = _table(n_days=50, n_st=6, seed=7)
    note = G.power_note(rows)
    assert note["delta_fg2"] == 0.10 and note["n_blocks_assumed"] == 10 and "FIT rows only" in note["basis"]
    assert len(note["lines"]) == 20
    line = note["lines"]["GRAND_CAL|FG1|CLIM_GUST|ICON:B1"]
    m = W.cell_mask(rows, "B1", np.ones(len(rows["lead"]), bool))
    d = np.abs(rows["GRAND_CAL_g"] - rows["o_g"]) - np.abs(rows["CLIM_GUST_g"] - rows["o_g"])
    blk = rows["vday"] // 5
    means = [d[m & (blk == b)].mean() for b in np.unique(blk[m])]
    assert line["sd_block"] == pytest.approx(np.std(means, ddof=1))
    assert line["mde_80"] == pytest.approx((1.959964 + 0.841621) * line["sd_block"] / math.sqrt(10))
    assert G.MDE_Z == pytest.approx(2.801585, abs=1e-5)


def test_power_note_marks_thin_cells_insufficient():
    note = G.power_note(_table(n_days=6, n_st=3))
    assert any(v.get("insufficient") for v in note["lines"].values())


# ------------------------------------------------------------------------------------------------ the one-time build
def _stations():
    return [{"id": "S1", "kind": "ndbc", "anemometer_m": 4.0}, {"id": "S2", "kind": "ndbc", "anemometer_m": 80.0},
            {"id": "S3", "kind": "ndbc"}, {"id": "A1", "kind": "asos", "anemometer_m": 10.0}]


def test_build_clim_gust_uses_only_gust_eligible_ndbc_stations_and_reports_the_rest():
    calls = []

    def reader(sid, y):
        calls.append((sid, y))
        return _obs_full(y) if y == 2020 else {}
    clim, rep = G.build_clim_gust(_stations(), reader, lambda g, z: g, years=(2019, 2021))
    assert {s for s, _ in calls} == {"S1"}                              # S2 (80 m), S3 (no height), A1 (ASOS): never read
    assert set(rep["skipped"]) == {"S2", "S3", "A1"} and rep["stations"]["S1"]["empty_years"] == [2019, 2021]
    assert rep["sha256_table"] == clim.sha256() and rep["n_stations_with_records"] == 1
    assert clim.get("S1", datetime(2026, 6, 1, 12, tzinfo=UTC)) == pytest.approx(9.2)      # max of hours 7..12 (8.0 + 1.2)
    assert clim.get("S1", datetime(2026, 6, 1, 6, tzinfo=UTC)) == pytest.approx(8.6)


def test_cli_writes_a_table_whose_file_hash_equals_the_reported_hash(tmp_path, monkeypatch):
    import hashlib
    import json
    import wind_lr_obs as O
    stations = tmp_path / "st.json"
    stations.write_text(json.dumps({"ndbc": _stations()}))
    monkeypatch.setattr(O, "ndbc_year", lambda s, cache, sid, y: _obs_full(y) if 2016 <= y <= 2025 and y % 2 == 0 else {})
    assert G.main(["build-clim", "--stations", str(stations), "--cache", str(tmp_path / "c"), "--out", str(tmp_path / "o")]) == 0
    body = (tmp_path / "o" / "wind_lr2_clim_gust.json").read_bytes()
    assert (tmp_path / "o" / "wind_lr2_clim_gust.json.sha256").read_text().split()[0] == hashlib.sha256(body).hexdigest()
    assert json.loads((tmp_path / "o" / "wind_lr2_clim_gust_report.json").read_text())["sha256_table"] == hashlib.sha256(body).hexdigest()


def test_the_dispatch_workflow_has_a_clim_gust_mode_that_needs_the_owner_word_and_the_frozen_list():
    import yaml
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".github", "workflows",
                        "wind-lr2-clim.yml")
    text = open(path, encoding="utf-8").read()
    doc = yaml.safe_load(text)
    on = doc.get(True, doc.get("on"))
    assert "clim_gust" in on["workflow_dispatch"]["inputs"]["what"]["options"]
    step = [s for s in doc["jobs"]["run"]["steps"] if "build-clim" in s.get("run", "")][0]
    assert 'test -n "$OWNER_WORD_REF"' in step["run"] and "wind_lr2_stations.json" in step["run"]
    assert "secrets." not in str(step) and "clim_gust.json.sha256" in text

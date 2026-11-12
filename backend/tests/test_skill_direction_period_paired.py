"""S8/S7 v2 (skill_direction_period_paired): circular statistics, period definitions never mixed, pairing, the null
controls and the consensus verdict, on synthetic scored ledger rows. Pure: no network, no storage."""
import ast
import os
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import skill_direction_period_paired as s8

NOW = datetime(2026, 11, 11, 0, tzinfo=timezone.utc)
BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _row(src, buoy, t, lead, dir_deg, tp, obs, **extra):
    r = {"source": src, "buoy_id": buoy, "target_time": t.strftime("%Y-%m-%dT%H:00:00Z"), "lead_h": float(lead),
         "dir_deg": dir_deg, "tp_s": tp, "obs_time": t.isoformat(), "obs_hs_m": obs["hs"],
         "obs_mwd_deg": obs["mwd"], "obs_dpd_s": obs["dpd"], "obs_apd_s": obs["apd"]}
    r.update(extra)
    return r


def _ledger(buoys=("46042", "41008"), days=14, offsets=None, icon_tp="apd", lead=24):
    """Scored rows over `days` days ending at NOW: obs MWD 270 / DPD 14 / APD 9; GFS/EURO periods exactly DPD and ICON
    exactly APD (its Tm-1,0 stand-in), directions offset per member."""
    offsets = offsets or {"raw_surf": 20.0, "raw_surf:EURO": -20.0, "raw_surf:ICON": 10.0}
    rows = []
    for b in buoys:
        for h in range(0, days * 24, 6):
            t = NOW - timedelta(hours=days * 24) + timedelta(hours=h)
            obs = {"hs": 1.5, "mwd": 270.0, "dpd": 14.0, "apd": 9.0}
            for src, off in offsets.items():
                tp = obs["apd"] if (src == "raw_surf:ICON" and icon_tp == "apd") else obs["dpd"]
                rows.append(_row(src, b, t, lead, (obs["mwd"] + off) % 360, tp, obs))
            rows.append(_row("persistence", b, t, lead, 300.0, 11.0, obs, tp_mean_s=8.0, tp_mean_kind="obs_apd"))
    return rows


def test_signed_circular_difference_wraps_both_ways():
    assert s8.signed_circular_diff(10, 350) == pytest.approx(20)
    assert s8.signed_circular_diff(350, 10) == pytest.approx(-20)
    assert s8.signed_circular_diff(180, 0) == pytest.approx(-180)
    assert s8.signed_circular_diff(None, 10) is None


def test_circular_bias_is_not_the_arithmetic_mean():
    # +170 and -170 are both 10 degrees from 180: the arithmetic mean (0) would call this unbiased
    st = s8.direction_stats([170.0, -170.0] * 10)
    assert abs(abs(st["circ_bias_deg"]) - 180.0) < 1e-6
    assert st["mae_deg"] == 170.0
    st = s8.direction_stats([20.0] * 12)
    assert st["circ_bias_deg"] == 20.0 and st["resultant"] == 1.0


def test_refuses_below_min_n():
    assert s8.direction_stats([5.0] * 3)["mae_deg"] is None
    assert s8.period_stats([1.0] * 3)["mae_s"] is None


def test_lane_kinds_follow_definitions_and_flags():
    assert s8.lane_kinds("GFS", {}) == ("peak", "peak")
    assert s8.lane_kinds("EURO", {}) == ("peak", "mean")
    assert s8.lane_kinds("ICON", {}) == ("tm10", "mean")
    assert s8.lane_kinds("ICON", {"ICON_PEAK_PERIOD": "1"}) == ("peak", "mean")
    assert s8.lane_kinds("ICON_SCALAR", {}) == ("tm10", "mean")
    assert s8.lane_kinds("CONSENSUS", {}) == ("peak", "blend")
    assert s8.lane_kinds("open_meteo_marine", {}) == (None, None)


def test_flag_defaults_off(monkeypatch):
    monkeypatch.delenv(s8.FLAG, raising=False)
    assert s8.enabled() is False
    monkeypatch.setenv(s8.FLAG, "1")
    assert s8.enabled() is True


def test_tagging_stamps_kinds_and_persistence_apd():
    rows = s8.tag_lane_rows([{"tp_s": 9.0, "dir_deg": 200.0}], "ICON", env={})
    assert rows[0]["tp_kind"] == "tm10" and rows[0]["dir_kind"] == "mean"
    report = {"spots": [{"buoy_id": "46042", "residual": {"buoy_apd_s": 8.5}}]}
    p = s8.tag_persistence_rows([{"source": "persistence", "buoy_id": "46042", "tp_s": 14.0, "dir_deg": 270.0}], report)
    assert p[0]["tp_mean_s"] == 8.5 and p[0]["tp_kind"] == "peak" and p[0]["dir_kind"] == "obs"


def test_period_kinds_are_never_pooled():
    rep = s8.paired_direction_period_report(_ledger(), NOW, env={})
    peak, tm10 = rep["by_lead"]["24"]["period_peak"], rep["by_lead"]["24"]["period_tm10"]
    assert peak["members"] == ["raw_surf", "raw_surf:EURO"] and peak["truth"] == "DPD"
    assert tm10["members"] == ["raw_surf:ICON"] and tm10["truth"] == "APD" and tm10["definition_exact"] is False
    # graded against its own definition each lane is exact; pooled against DPD, ICON would read -5 s
    assert peak["all"]["raw_surf"]["mae_s"] == 0.0 and peak["all"]["raw_surf:EURO"]["mae_s"] == 0.0
    assert tm10["all"]["raw_surf:ICON"]["mae_s"] == 0.0
    assert "consensus_equal" not in tm10["all"]            # one member of that kind: no consensus
    assert peak["all"]["persistence"]["bias_s"] == -3.0    # persistence peak = 11 vs DPD 14
    assert tm10["all"]["persistence"]["bias_s"] == -1.0    # persistence mean = its APD 8 vs APD 9


def test_icon_peak_flag_moves_icon_into_the_peak_table():
    rep = s8.paired_direction_period_report(_ledger(icon_tp="dpd"), NOW, env={"ICON_PEAK_PERIOD": "1"})
    assert rep["by_lead"]["24"]["period_peak"]["members"] == ["raw_surf", "raw_surf:EURO", "raw_surf:ICON"]
    assert "period_tm10" not in rep["by_lead"]["24"]


def test_direction_paired_consensus_nulls_and_regions():
    rep = s8.paired_direction_period_report(_ledger(), NOW, env={})
    d = rep["by_lead"]["24"]["direction"]
    a = d["all"]
    assert a["raw_surf"]["circ_bias_deg"] == 20.0 and a["raw_surf:EURO"]["circ_bias_deg"] == -20.0
    assert d["best_member"] == "raw_surf:ICON"
    assert a["consensus_equal"]["mae_deg"] < a["raw_surf:ICON"]["mae_deg"]   # +20, -20, +10 -> ~+3.3
    assert d["consensus_beats_best"] is True and d["consensus_win_rate_vs_best"] == 1.0
    assert a["persistence"]["mae_deg"] == 30.0
    assert a["climatology"]["mae_deg"] == 0.0             # constant sea: the buoy's own mean is exact
    assert set(d["by_region"]) == {"pacific_ne", "atlantic_se"}
    n = {c: v["n"] for c, v in a.items()}
    assert len(set(n.values())) == 1                      # every candidate on the same keys
    assert d["skill_vs_persistence"]["consensus_equal"] > 0.8


def test_mismatched_observation_and_missing_persistence_are_dropped_not_graded():
    rows = _ledger()
    t = NOW - timedelta(hours=6)
    key_rows = [r for r in rows if r["buoy_id"] == "46042" and r["target_time"] == t.strftime("%Y-%m-%dT%H:00:00Z")]
    key_rows[1]["obs_time"] = (t + timedelta(minutes=40)).isoformat()      # EURO verified against another obs
    t2 = NOW - timedelta(hours=12)
    rows = [r for r in rows if not (r["source"] == "persistence" and r["buoy_id"] == "41008"
                                    and r["target_time"] == t2.strftime("%Y-%m-%dT%H:00:00Z"))]
    d = s8.paired_direction_period_report(rows, NOW, env={})["by_lead"]["24"]["direction"]
    assert d["dropped"]["obs_mismatch"] == 1 and d["dropped"]["no_persistence"] == 1


def test_climatology_needs_training_history():
    rep = s8.paired_direction_period_report(_ledger(days=7), NOW, env={})   # everything inside the held-out week
    d = rep["by_lead"]["24"]["direction"]
    assert d["n"] == 0 and d["dropped"]["no_climatology"] > 0 and rep["status"] == "insufficient"


def test_consensus_member_is_raw_gfs_when_the_consensus_serves():
    rows = _ledger(offsets={"raw_surf": 0.0, "raw_surf:GFS_RAW": 20.0, "raw_surf:EURO": -20.0, "raw_surf:ICON": 10.0})
    rep = s8.paired_direction_period_report(rows, NOW, env={})
    assert rep["members"] == ["raw_surf:GFS_RAW", "raw_surf:EURO", "raw_surf:ICON"]


def test_flag_is_registered_default_off():
    src = open(os.path.join(BACKEND, "routes", "admin", "surf_forecast.py"), encoding="utf-8").read()
    tree = ast.parse(src)
    reg = next(n.value for n in ast.walk(tree) if isinstance(n, ast.Assign)
               and any(getattr(t, "id", None) == "_RATING_FLAGS" for t in n.targets))
    entries = {k.value: v for k, v in zip(reg.keys, reg.values)}
    assert ast.literal_eval(entries[s8.FLAG])[0] == "0"

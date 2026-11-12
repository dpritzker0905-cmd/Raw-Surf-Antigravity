"""The OCF-style shadow (skill_ocf, move 4): bias per coast removed from each member, then an equal mean, scored on the
same held-out pairs as served / equal / pooled MOS. These pin the pairing, the time split, the causal rolling window,
the per-coast fallback, the refusal on thin data, determinism of the interval, and that the kill switch adds nothing."""
import asyncio
import copy
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from services.weather_pipeline import buoy_calibration as bc
from services.weather_pipeline import forecast_skill as fs
from services.weather_pipeline.skill_consensus import MEMBERS
from services.weather_pipeline.skill_ocf import ROLL_DAYS, VARIANTS, _Rolling, ocf_report

NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)
A, B = "41001", "46232"                    # atlantic_se, pacific_ne
BIAS = {A: {"raw_surf": 0.3, "raw_surf:ICON": 0.3, "raw_surf:EURO": 0.3},
        B: {"raw_surf": -0.3, "raw_surf:ICON": -0.3, "raw_surf:EURO": -0.3}}


def _rows(days, hours, buoys=(A, B), bias=BIAS, lead=48.0, members=MEMBERS):
    out = []
    for d in days:
        for h in range(hours):
            t = NOW - timedelta(days=d, hours=h)
            for bi, buoy in enumerate(buoys):
                obs = 1.0 + 0.1 * ((d + h + bi) % 7)
                for m in members:
                    out.append({"source": m, "buoy_id": buoy, "target_time": t.strftime("%Y-%m-%dT%H:00:00Z"),
                                "lead_h": lead, "hs_m": obs + bias[buoy][m], "obs_hs_m": obs})
    return out


def _data():
    return _rows(range(8, 30), 3) + _rows(range(0, 7), 3)


def _lead(rep, lead=48):
    return next(e for e in rep["by_lead"] if e["lead_h"] == lead)


def test_a_bias_that_changes_sign_by_coast_is_removed_per_coast_but_not_by_the_pooled_correction():
    e = _lead(ocf_report(_data(), NOW))
    v = e["variants"]
    assert e["status"] == "scored" and e["n_test"] > 0
    assert v["served"]["mae_m"] == pytest.approx(0.3, abs=1e-3)
    assert v["ocf_pooled"]["mae_m"] == pytest.approx(0.3, abs=2e-2)      # +0.3 and -0.3 average to ~0 pooled
    assert v["ocf_region"]["mae_m"] == pytest.approx(0.0, abs=1e-3)
    assert v["ocf_rolling"]["mae_m"] == pytest.approx(0.0, abs=1e-3)
    assert set(v) == set(VARIANTS)


def test_the_gain_interval_is_over_days_and_is_deterministic():
    r1, r2 = ocf_report(_data(), NOW), ocf_report(_data(), NOW)
    assert json.dumps(r1, sort_keys=True) == json.dumps(r2, sort_keys=True)
    g = _lead(r1)["gain_over_served"]["ocf_region"]
    assert g["n_days"] == 7 and g["n_buoys"] == 2 and g["gain_m"] == pytest.approx(0.3, abs=1e-3)
    assert g["ci95_m"][0] <= g["gain_m"] <= g["ci95_m"][1]


def test_the_gate_needs_every_lead_and_every_coast():
    rep = ocf_report(_data(), NOW)
    assert rep["gate"]["ocf_region"]["gate_met"] is True
    assert rep["gate"]["ocf_pooled"]["gate_met"] is False                # not better than served on either coast


def test_a_perfect_served_lane_is_not_beaten():
    perfect = {A: {m: 0.0 for m in MEMBERS}, B: {m: 0.0 for m in MEMBERS}}
    perfect[A]["raw_surf:ICON"] = 0.5
    rep = ocf_report(_rows(range(8, 30), 3, bias=perfect) + _rows(range(0, 7), 3, bias=perfect), NOW)
    assert rep["gate"]["ocf_region"]["gate_met"] is False


def test_the_rolling_window_only_sees_errors_observable_at_issue_time():
    pairs = [{"t": NOW - timedelta(hours=h), "region": "x", "fc": {m: 1.0 + h for m in MEMBERS}, "obs": 1.0}
             for h in range(50, 0, -1)]
    roll = _Rolling(pairs, MEMBERS)
    hi = NOW - timedelta(hours=10)
    b, n = roll.bias("x", hi - timedelta(hours=5), hi)
    assert n == 5 and b["raw_surf"] == pytest.approx(12.0)               # errors of the pairs 14..10 h before NOW
    assert roll.bias("x", NOW, NOW)[0] is None and roll.bias("nope", NOW - timedelta(days=1), NOW)[0] is None


def test_a_thin_coast_falls_back_to_the_pooled_bias_and_says_so():
    rows = _rows(range(8, 30), 3, buoys=(A,)) + _rows(range(0, 7), 3, buoys=(A,)) \
        + _rows(range(8, 10), 1, buoys=(B,)) + _rows(range(0, 7), 1, buoys=(B,))
    e = _lead(ocf_report(rows, NOW))
    assert e["coasts_with_own_bias"] == ["atlantic_se"] and e["fallback_to_pooled_bias"] > 0


def test_thin_data_refuses_instead_of_printing_a_number():
    e = _lead(ocf_report(_rows(range(0, 2), 1), NOW))
    assert e["status"] == "insufficient" and "variants" not in e
    big = _lead(ocf_report(_data(), NOW))["big_swell"]
    assert big["paired_n"] == 0 and big.get("status") == "insufficient" and big["by_observation"] == {}


def test_a_pair_missing_a_member_and_unusable_rows_are_ignored():
    rows = _data()
    rows = [r for r in rows if not (r["source"] == "raw_surf:ICON" and r["buoy_id"] == A)]
    rows.append({"source": "raw_surf", "buoy_id": A, "target_time": "garbage", "lead_h": 48, "hs_m": float("nan"), "obs_hs_m": 1})
    rep = ocf_report(rows, NOW)
    assert set(_lead(rep)["gain_over_served"]["ocf_region"]) >= {"n_buoys"} and _lead(rep)["gain_over_served"]["ocf_region"]["n_buoys"] == 1
    assert rep["depth_split"].startswith("unavailable")


@pytest.fixture
def ledger(monkeypatch):
    months = {fs.SKILL_SCORED_PREFIX + "2026-11.json": _data(), fs.SKILL_PENDING_L2_KEY: []}
    monkeypatch.setenv("FORECAST_SKILL_COMPARE_MODELS", "")
    monkeypatch.setenv("FORECAST_SKILL", "1")
    monkeypatch.setenv("FORECAST_SKILL_PERSISTENCE", "0")
    monkeypatch.setenv("FORECAST_SKILL_OM_CONTROL", "0")
    monkeypatch.delenv("FORECAST_SKILL_MOS", raising=False)
    monkeypatch.delenv("FORECAST_SKILL_OCF", raising=False)
    monkeypatch.setattr(bc, "calibrate_spots", AsyncMock(return_value={}))
    monkeypatch.setattr(bc, "fetch_ndbc_station_coords", AsyncMock(return_value={}))
    monkeypatch.setattr(bc, "load_calibration_rows_l2", lambda key: (list(months.get(key, [])), key in months))
    monkeypatch.setattr(bc, "upload_calibration_l2", lambda *a, **k: True)
    monkeypatch.setattr(fs, "fetch_om_forecast_rows", lambda *a, **k: [])
    return lambda: asyncio.run(fs.run_skill_ledger(None, None, [], "GFS", {"spots": []}, now=NOW))


def test_the_ocf_block_is_published_on_the_report(ledger):
    skill = ledger()
    report = {}
    fs.attach_to_report(report, skill)
    assert report["forecast_skill_ocf"]["variants"] == list(VARIANTS)


def test_the_kill_switch_leaves_every_other_block_byte_identical_and_adds_nothing(ledger, monkeypatch):
    on = ledger()
    monkeypatch.setenv("FORECAST_SKILL_OCF", "0")
    off = ledger()
    assert "ocf" not in off
    r_on, r_off = {}, {}
    fs.attach_to_report(r_on, copy.deepcopy(on))
    fs.attach_to_report(r_off, off)
    assert "forecast_skill_ocf" not in r_off
    r_on.pop("forecast_skill_ocf")
    assert json.dumps(r_on, sort_keys=True, default=str) == json.dumps(r_off, sort_keys=True, default=str)


def test_an_ocf_failure_costs_only_its_own_block(ledger, monkeypatch):
    import services.weather_pipeline.skill_ocf as ocf

    def boom(*a, **k):
        raise RuntimeError("x")
    monkeypatch.setattr(ocf, "ocf_report", boom)
    skill = ledger()
    assert "ocf" not in skill and skill["consensus"] is not None and skill["mos_shadow"] is not None

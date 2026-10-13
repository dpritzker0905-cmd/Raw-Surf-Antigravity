"""The shadow MOS correction on the skill ledger (roadmap stage 5, step 1, 2026-09-26).

Measurement only: fit obs = a + b * forecast per (source, lead) on ledger rows older than the held-out
week, score it on that week, and publish raw vs corrected MAE/bias on the calibration report
(/api/weather/buoy-calibration). These tests pin the time split, the refusal on thin data, and that the
shadow can never cost the ledger a run.
"""
import asyncio
import math
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from services.weather_pipeline import buoy_calibration as bc
from services.weather_pipeline import forecast_skill as fs
from services.weather_pipeline.skill_mos import fit_linear, shadow_report

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)


def _row(days_ago, fcst, obs, source="raw_surf", lead=48.0):
    t = NOW - timedelta(days=days_ago)
    return {"source": source, "buoy_id": "46232", "target_time": t.strftime("%Y-%m-%dT%H:00:00Z"),
            "lead_h": lead, "hs_m": fcst, "obs_hs_m": obs}


def _biased(days, n, a=0.3, b=0.8, source="raw_surf", lead=48.0):
    """obs = a + b * fcst, with a small deterministic wobble so the fit is not exact."""
    out = []
    for i in range(n):
        fcst = 0.6 + (i % 17) * 0.25
        out.append(_row(days[i % len(days)], fcst, a + b * fcst + 0.05 * math.sin(i), source, lead))
    return out


def _by(report, source="raw_surf", lead=48):
    return next(e for e in report["by_source_lead"] if e["source"] == source and e["lead_h"] == lead)


# ── the pure measurement ──────────────────────────────────────────────────────────────────────

def test_a_real_bias_is_learned_and_beats_the_raw_forecast_on_the_held_out_week():
    rows = _biased(range(8, 50), 200) + _biased(range(0, 7), 60)
    e = _by(shadow_report(rows, NOW))
    assert e["status"] == "scored" and (e["n_train"], e["n_test"]) == (200, 60)
    assert e["a"] == pytest.approx(0.3, abs=0.05) and e["b"] == pytest.approx(0.8, abs=0.02)
    assert e["mae_mos_m"] < e["mae_raw_m"] / 3, "a learnable bias must be removed on unseen data"


def test_the_split_is_by_time_and_the_held_out_week_never_trains():
    train = _biased(range(8, 50), 200)
    a = _by(shadow_report(train + _biased(range(0, 7), 60), NOW))
    wild = [_row(d, 1.0, 9.0) for d in range(0, 7) for _ in range(9)]
    b = _by(shadow_report(train + wild, NOW))
    assert (a["a"], a["b"]) == (b["a"], b["b"]), "held-out rows leaked into the fit"


def test_thin_groups_refuse_instead_of_printing_a_number():
    e = _by(shadow_report(_biased(range(8, 20), 12) + _biased(range(0, 7), 12), NOW))
    assert e["status"] == "insufficient" and "mae_mos_m" not in e


def test_big_swell_bias_is_reported_raw_and_corrected():
    rows = _biased(range(8, 50), 200, a=0.9, b=0.9) + _biased(range(0, 7), 60, a=0.9, b=0.9)
    e = _by(shadow_report(rows, NOW))
    assert e["big_swell_n"] > 0
    assert e["big_swell_bias_raw_m"] < 0, "the synthetic sea under-forecasts big swell, like the ledger"
    assert abs(e["big_swell_bias_mos_m"]) < abs(e["big_swell_bias_raw_m"])


def _calibrated(days, reps=1, under_big=1.0, offset=0.0):
    """A sea whose forecast is CALIBRATED: every forecast x meets obs x - 0.5 .. x + 0.5 in equal measure,
    so E[obs | forecast] = forecast exactly. Big seas are rarer, as in the ledger: x = 0.5 m occurs 17
    times for every once x = 4.5 m does. `under_big` > 1 makes it genuinely under-read big swell;
    `offset` makes it read low by that much everywhere (a bias a correction can learn)."""
    out, i = [], 0
    for _ in range(reps):
        for k in range(17):
            x = 0.5 + 0.25 * k                                  # 0.5 .. 4.5 m
            for _copy in range(17 - k):
                for e in (-0.5, -0.25, 0.0, 0.25, 0.5):
                    y = (x * under_big if x >= 3.0 else x) + offset + e
                    out.append(_row(days[i % len(days)], x, y))
                    i += 1
    return out


def test_a_calibrated_forecast_reads_low_selected_by_obs_and_true_selected_by_forecast():
    """The trap (2026-09-28): picking pairs by the OBSERVED height picks the positive errors."""
    e = _by(shadow_report(_calibrated(range(8, 50), 3) + _calibrated(range(0, 7)), NOW))
    assert e["big_swell_bias_raw_m"] < -0.1, "selected by obs, even a calibrated forecast reads low"
    assert e["big_swell_by_forecast_bias_raw_m"] == 0.0, "selected by the forecast, it is exact"
    assert e["big_swell_by_forecast_n_raw"] == 5 * (7 + 6 + 5 + 4 + 3 + 2 + 1)   # x = 3.0 .. 4.5


def test_a_real_under_read_of_big_swell_shows_when_selected_by_the_forecast():
    e = _by(shadow_report(_calibrated(range(8, 50), 3, 1.2) + _calibrated(range(0, 7), 1, 1.2), NOW))
    assert e["big_swell_by_forecast_bias_raw_m"] < -0.5         # x vs 1.2x at 3-4.5 m: about -0.75 m


def test_the_correction_is_judged_on_its_own_corrected_forecast():
    """A sea read 0.4 m low everywhere: the correction learns +0.4, so ITS big-swell hours are its own."""
    test = _calibrated(range(0, 7), offset=0.4)
    e = _by(shadow_report(_calibrated(range(8, 50), 3, offset=0.4) + test, NOW))
    a, b = e["a"], e["b"]
    assert a == pytest.approx(0.4, abs=0.02) and b == pytest.approx(1.0, abs=0.01)
    want = sum(1 for r in test if a + b * r["hs_m"] >= 3.0)
    assert e["big_swell_by_forecast_n_mos"] == want > e["big_swell_by_forecast_n_raw"]
    assert e["big_swell_by_forecast_bias_raw_m"] == pytest.approx(-0.4, abs=0.01)   # the raw reads low
    assert abs(e["big_swell_by_forecast_bias_mos_m"]) < 0.02                       # the correction does not


def test_both_selections_are_named_on_the_report():
    r = shadow_report(_biased(range(8, 50), 60) + _biased(range(0, 7), 20), NOW)
    assert set(r["big_swell_selection"]) == {"big_swell_*", "big_swell_by_forecast_*"}
    e = _by(r)
    assert "OBSERVED" in r["big_swell_selection"]["big_swell_*"]
    assert {"big_swell_by_forecast_n_raw", "big_swell_by_forecast_n_mos"} <= set(e)


def test_groups_are_per_source_and_per_lead():
    rows = (_biased(range(8, 50), 120) + _biased(range(0, 7), 30)
            + _biased(range(8, 50), 120, a=0.0, b=1.0, source="open_meteo_marine", lead=72.0)
            + _biased(range(0, 7), 30, a=0.0, b=1.0, source="open_meteo_marine", lead=72.0))
    r = shadow_report(rows, NOW)
    assert {(e["source"], e["lead_h"]) for e in r["by_source_lead"]} == {
        ("raw_surf", 48), ("open_meteo_marine", 72)}
    assert _by(r, "open_meteo_marine", 72)["b"] == pytest.approx(1.0, abs=0.02)


@pytest.mark.parametrize("bad", [
    {"hs_m": float("nan")}, {"obs_hs_m": None}, {"hs_m": 0.0}, {"obs_hs_m": -0.1},
    {"target_time": "not a time"}, {"lead_h": None}, {"target_time": "2026-10-30T00:00:00Z"},
])
def test_unusable_rows_are_ignored(bad):
    rows = _biased(range(8, 50), 60) + _biased(range(0, 7), 20)
    base = shadow_report(rows, NOW)
    assert shadow_report(rows + [{**_row(3, 1.0, 1.0), **bad}], NOW)["rows_used"] == base["rows_used"]


def test_a_constant_forecast_falls_back_to_bias_only():
    assert fit_linear([(1.0, 1.4), (1.0, 1.6)]) == pytest.approx((0.5, 1.0))


# ── wired into the ledger run, and never able to cost it ──────────────────────────────────────

@pytest.fixture
def ledger(monkeypatch):
    months = {fs.SKILL_SCORED_PREFIX + "2026-08.json": _biased(range(27, 50), 160),
              fs.SKILL_SCORED_PREFIX + "2026-09.json": _biased(range(8, 26), 60) + _biased(range(0, 7), 40),
              fs.SKILL_PENDING_L2_KEY: []}
    state = {"reads": [], "fail": set()}

    def load(key):
        state["reads"].append(key)
        if key in state["fail"]:
            raise RuntimeError("synthetic unreadable archive")
        return (list(months[key]), True) if key in months else ([], False)

    for env in ("FORECAST_SKILL_COMPARE_MODELS",):
        monkeypatch.setenv(env, "")
    monkeypatch.setenv("FORECAST_SKILL", "1")
    monkeypatch.setenv("FORECAST_SKILL_PERSISTENCE", "0")
    monkeypatch.setenv("FORECAST_SKILL_OM_CONTROL", "0")
    monkeypatch.delenv("FORECAST_SKILL_MOS", raising=False)
    monkeypatch.setattr(bc, "calibrate_spots", AsyncMock(return_value={}))
    monkeypatch.setattr(bc, "fetch_ndbc_station_coords", AsyncMock(return_value={}))
    monkeypatch.setattr(bc, "load_calibration_rows_l2", load)
    monkeypatch.setattr(bc, "upload_calibration_l2", lambda *a, **k: True)
    monkeypatch.setattr(fs, "fetch_om_forecast_rows", lambda *a, **k: [])
    state["run"] = lambda: asyncio.run(fs.run_skill_ledger(None, None, [], "GFS", {"spots": []}, now=NOW))
    return state


def test_the_ledger_run_publishes_the_shadow_on_the_report(ledger):
    skill = ledger["run"]()
    e = _by(skill["mos_shadow"])
    assert (e["n_train"], e["n_test"]) == (220, 40), "both months must feed the shadow"
    report = {}
    fs.attach_to_report(report, skill)
    assert report["forecast_skill_mos_shadow"]["by_source_lead"][0]["status"] == "scored"


def test_an_unreadable_month_skips_the_shadow_and_nothing_else(ledger):
    ledger["fail"].add(fs.SKILL_SCORED_PREFIX + "2026-08.json")
    skill = ledger["run"]()
    assert skill["mos_shadow"] is None and "ledgered" in skill and "scored" in skill
    report = {}
    fs.attach_to_report(report, skill)
    assert "forecast_skill_mos_shadow" not in report and "forecast_skill" in report


def test_the_kill_switch_turns_the_shadow_off_without_reading(ledger, monkeypatch):
    monkeypatch.setenv("FORECAST_SKILL_MOS", "0")
    skill = ledger["run"]()
    assert skill["mos_shadow"] is None
    assert fs.SKILL_SCORED_PREFIX + "2026-08.json" not in ledger["reads"]

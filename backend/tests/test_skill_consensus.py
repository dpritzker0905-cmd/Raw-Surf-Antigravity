"""The three-model consensus, scored at the buoys (roadmap stage 5, measurement only, 2026-09-28).

The skill ledger forecasts every buoy from all three of our lanes on the same target hours; a consensus of them
should beat the best single model if their errors are partly independent. Measured on rows the ledger already
scored: pairs where all three were scored, a plain mean and a mean with each member's training-window bias
removed, graded on the held-out week against each member. These pin the pairing, the time split, the
debiasing, the refusal on thin data, and the wiring onto the calibration report.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from services.weather_pipeline import buoy_calibration as bc
from services.weather_pipeline import forecast_skill as fs
from services.weather_pipeline.skill_consensus import MEMBERS, consensus_report

NOW = datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc)
ERR = {"raw_surf": (0.3, -0.3, 0.0), "raw_surf:ICON": (-0.3, 0.0, 0.3), "raw_surf:EURO": (0.0, 0.3, -0.3)}


def _rows(days, n, bias=None, errs=ERR, lead=48.0, members=MEMBERS, buoy="46232"):
    """n target hours per day list; each member's error cycles through its tuple (+ a constant bias), so the
    three errors cancel exactly in the mean while every member alone is off by 0.2 m on average."""
    bias = bias or {}
    out = []
    for i in range(n):
        t = NOW - timedelta(days=days[i % len(days)], hours=i % 24)
        obs = 1.0 + 0.1 * (i % 7)
        for m in members:
            out.append({"source": m, "buoy_id": buoy, "target_time": t.strftime("%Y-%m-%dT%H:00:00Z"),
                        "lead_h": lead, "hs_m": obs + errs[m][i % 3] + bias.get(m, 0.0), "obs_hs_m": obs})
    return out


def _lead(report, lead=48):
    return next(e for e in report["by_lead"] if e["lead_h"] == lead)


def test_errors_that_cancel_make_the_consensus_beat_every_member():
    e = _lead(consensus_report(_rows(range(8, 40), 90) + _rows(range(0, 7), 30), NOW))
    assert e["status"] == "scored" and (e["n_train"], e["n_test"]) == (90, 30)
    assert all(v["mae_m"] == pytest.approx(0.2, abs=1e-3) for v in e["members"].values())
    assert e["equal"]["mae_m"] == pytest.approx(0.0, abs=1e-3) and e["equal_beats_best"]


def test_a_members_bias_is_learned_on_the_older_rows_and_removed():
    bias = {"raw_surf": 0.0, "raw_surf:ICON": 0.3, "raw_surf:EURO": 0.15}
    e = _lead(consensus_report(_rows(range(8, 40), 90, bias) + _rows(range(0, 7), 30, bias), NOW))
    assert e["member_bias_train_m"] == {"raw_surf": 0.0, "raw_surf:ICON": 0.3, "raw_surf:EURO": 0.15}
    assert e["equal"]["bias_m"] == pytest.approx(0.15, abs=1e-3)       # the plain mean inherits them
    assert e["debiased"]["bias_m"] == pytest.approx(0.0, abs=1e-3)     # the debiased mean does not
    assert e["debiased_beats_best"]


def test_a_noisy_member_counts_for_less_in_the_weighted_consensus():
    """ICON-like: one member's errors are six times the others' (the held-out week read ICON ~40% worse)."""
    errs = {"raw_surf": (0.1, -0.1, 0.0), "raw_surf:EURO": (0.0, 0.1, -0.1), "raw_surf:ICON": (0.6, -0.6, 0.0)}
    bias = {"raw_surf:ICON": 0.3, "raw_surf:EURO": 0.1}
    e = _lead(consensus_report(_rows(range(8, 40), 90, bias, errs) + _rows(range(0, 7), 30, bias, errs), NOW))
    w = e["member_weight"]
    assert w["raw_surf:ICON"] < 0.05 and w["raw_surf"] == pytest.approx(w["raw_surf:EURO"], abs=1e-3)
    assert e["weighted"]["mae_m"] < e["equal"]["mae_m"] and e["weighted"]["mae_m"] < e["debiased"]["mae_m"]
    assert e["weighted_beats_best"] and not e["equal_beats_best"]
    assert abs(e["weighted"]["bias_m"]) < 0.02, "the weighted mean is of the DEBIASED members"


def test_members_of_equal_skill_get_equal_weight():
    e = _lead(consensus_report(_rows(range(8, 40), 90) + _rows(range(0, 7), 30), NOW))
    assert sum(e["member_weight"].values()) == pytest.approx(1.0, abs=1e-3)
    assert all(v == pytest.approx(1 / 3, abs=1e-3) for v in e["member_weight"].values())


def test_the_held_out_week_never_trains_the_bias():
    bias = {"raw_surf:ICON": 0.3}
    wild = {"raw_surf:ICON": 5.0}
    a = _lead(consensus_report(_rows(range(8, 40), 90, bias) + _rows(range(0, 7), 30, bias), NOW))
    b = _lead(consensus_report(_rows(range(8, 40), 90, bias) + _rows(range(0, 7), 30, wild), NOW))
    assert a["member_bias_train_m"] == b["member_bias_train_m"]
    assert a["member_weight"] == b["member_weight"], "weights are learned on the older rows only"


def test_a_pair_missing_a_member_is_not_compared():
    rows = _rows(range(8, 40), 90) + _rows(range(0, 7), 30)
    rows += _rows(range(0, 7), 40, members=("raw_surf", "raw_surf:ICON"), buoy="41009")   # no EURO row
    e = _lead(consensus_report(rows, NOW))
    assert (e["n_train"], e["n_test"]) == (90, 30)


def test_thin_leads_refuse_instead_of_printing_a_number():
    e = _lead(consensus_report(_rows(range(8, 40), 30) + _rows(range(0, 7), 5), NOW))
    assert e["status"] == "insufficient" and "equal" not in e


@pytest.mark.parametrize("bad", [{"hs_m": float("nan")}, {"obs_hs_m": None}, {"hs_m": 0.0},
                                 {"target_time": "not a time"}, {"source": "open_meteo_marine"}])
def test_unusable_rows_are_ignored(bad):
    rows = _rows(range(8, 40), 60) + _rows(range(0, 7), 20)
    base = consensus_report(rows, NOW)["paired_keys"]
    extra = [{**r, **bad} for r in _rows(range(0, 7), 5, buoy="51201")]
    assert consensus_report(rows + extra, NOW)["paired_keys"] == base


@pytest.fixture
def ledger(monkeypatch):
    months = {fs.SKILL_SCORED_PREFIX + "2026-08.json": [],
              fs.SKILL_SCORED_PREFIX + "2026-09.json": _rows(range(8, 26), 60) + _rows(range(0, 7), 20),
              fs.SKILL_PENDING_L2_KEY: []}
    monkeypatch.setenv("FORECAST_SKILL_COMPARE_MODELS", "")
    monkeypatch.setenv("FORECAST_SKILL", "1")
    monkeypatch.setenv("FORECAST_SKILL_PERSISTENCE", "0")
    monkeypatch.setenv("FORECAST_SKILL_OM_CONTROL", "0")
    monkeypatch.delenv("FORECAST_SKILL_MOS", raising=False)
    monkeypatch.setattr(bc, "calibrate_spots", AsyncMock(return_value={}))
    monkeypatch.setattr(bc, "fetch_ndbc_station_coords", AsyncMock(return_value={}))
    monkeypatch.setattr(bc, "load_calibration_rows_l2", lambda key: (list(months.get(key, [])), key in months))
    monkeypatch.setattr(bc, "upload_calibration_l2", lambda *a, **k: True)
    monkeypatch.setattr(fs, "fetch_om_forecast_rows", lambda *a, **k: [])
    return lambda: asyncio.run(fs.run_skill_ledger(None, None, [], "GFS", {"spots": []}, now=NOW))


def test_the_ledger_run_publishes_the_consensus_on_the_report(ledger):
    skill = ledger()
    assert _lead(skill["consensus"])["status"] == "scored"
    report = {}
    fs.attach_to_report(report, skill)
    assert report["forecast_skill_consensus"]["members"] == list(MEMBERS)

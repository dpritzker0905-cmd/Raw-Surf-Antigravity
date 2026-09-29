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
from services.weather_pipeline.skill_consensus import MEMBERS, PAIR, consensus_report, region_of

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


def _big_rows(n, errs, obs=3.5, buoy="46086"):
    """n held-out BIG hours (obs >= 3 m) with a FIXED error per member (no rotation)."""
    out = []
    for i in range(n):
        t = NOW - timedelta(days=i % 7, hours=3 + i % 20)
        for m in MEMBERS:
            out.append({"source": m, "buoy_id": buoy, "target_time": t.strftime("%Y-%m-%dT%H:00:00Z"),
                        "lead_h": 48.0, "hs_m": obs + errs[m], "obs_hs_m": obs})
    return out


def test_a_consensus_that_wins_overall_but_shaves_the_big_days_is_caught():
    """Small days: errors cancel (the mean is exact). Big days: GFS and EURO are right, ICON reads 0.9 m low, so the
    mean reads 0.3 m low exactly where surf matters. The all-sea grade says 'consensus wins'; the big-swell grade
    must say it loses to the best member."""
    shave = {"raw_surf": 0.0, "raw_surf:ICON": -0.9, "raw_surf:EURO": 0.0}
    e = _lead(consensus_report(_rows(range(8, 40), 90) + _rows(range(0, 7), 30) + _big_rows(12, shave), NOW))
    assert e["weighted_beats_best"], "overall, the mean still wins"
    b = e["big_swell"]
    assert b["paired_n"] == 12 and b["paired_best_member"] in ("raw_surf", "raw_surf:EURO")
    assert b["paired"]["weighted"]["bias_m"] == pytest.approx(-0.3, abs=1e-3)
    assert b["paired"]["raw_surf:ICON"]["mae_m"] == pytest.approx(0.9, abs=1e-3)
    assert b["weighted_beats_best"] is False


def test_big_swell_by_forecast_selects_each_forecasts_own_big_calls():
    """ICON over-calls: it says >= 3 m on 12 hours the others (and the sea) put at ~2.6 m."""
    over = {"raw_surf": 0.0, "raw_surf:ICON": 0.9, "raw_surf:EURO": 0.0}
    e = _lead(consensus_report(_rows(range(8, 40), 90) + _rows(range(0, 7), 30) + _big_rows(12, over, obs=2.6), NOW))
    bf = e["big_swell"]["by_forecast"]
    assert bf["raw_surf:ICON"]["n"] == 12 and bf["raw_surf:ICON"]["bias_m"] == pytest.approx(0.9, abs=1e-3)
    assert bf["raw_surf"]["n"] == 0 and "bias_m" not in bf["raw_surf"]
    assert bf["equal"]["n"] == 0, "the mean (2.9 m) does not call it big"
    assert e["big_swell"]["paired_n"] == 0 and e["big_swell"]["status"] == "insufficient"


def test_thin_big_swell_refuses_the_paired_grade():
    e = _lead(consensus_report(_rows(range(8, 40), 90) + _rows(range(0, 7), 30)
                               + _big_rows(4, {m: 0.0 for m in MEMBERS}), NOW))
    assert e["big_swell"]["paired_n"] == 4 and "paired" not in e["big_swell"]


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


def test_the_gfs_euro_pair_is_graded_on_the_same_pairs_as_the_equal_mean():
    """ICON-like noise (the nearshore judge's #155 finding: ICON 0.203 m vs EURO 0.102 on identical hours): the pair
    without ICON must be scored on exactly the equal mean's pairs and must beat it when ICON is the noisy member."""
    errs = {"raw_surf": (0.1, -0.1, 0.0), "raw_surf:EURO": (-0.1, 0.1, 0.0), "raw_surf:ICON": (0.9, 0.9, 0.9)}
    e = _lead(consensus_report(_rows(range(8, 40), 90, errs=errs) + _rows(range(0, 7), 30, errs=errs), NOW))
    assert PAIR == ("raw_surf", "raw_surf:EURO")
    assert e["pair_gfs_euro"]["mae_m"] == pytest.approx(0.0, abs=1e-3), "GFS and EURO errors cancel exactly"
    assert e["equal"]["bias_m"] == pytest.approx(0.3, abs=1e-3), "ICON drags the three-model mean high"
    assert e["pair_beats_equal"] and e["pair_beats_best"]
    missing = _rows(range(0, 7), 30, errs=errs, members=("raw_surf", "raw_surf:EURO"))   # no ICON: not paired
    e2 = _lead(consensus_report(_rows(range(8, 40), 90, errs=errs) + _rows(range(0, 7), 30, errs=errs) + missing, NOW))
    assert e2["n_test"] == 30, "hours without ICON are not scored, so pair and equal share every pair"


def test_the_pair_is_graded_on_the_big_swell_days_too():
    shave = {"raw_surf": 0.0, "raw_surf:ICON": -0.9, "raw_surf:EURO": 0.0}
    e = _lead(consensus_report(_rows(range(8, 40), 90) + _rows(range(0, 7), 30) + _big_rows(12, shave), NOW))
    b = e["big_swell"]
    assert b["paired"]["pair_gfs_euro"]["bias_m"] == pytest.approx(0.0, abs=1e-3), "no ICON, no shaved peak"
    assert b["paired"]["equal"]["bias_m"] == pytest.approx(-0.3, abs=1e-3)
    assert b["pair_beats_best"] is False, "ties the best member (GFS/EURO are exact), never beats it"
    assert b["by_forecast"]["pair_gfs_euro"]["n"] == 12


@pytest.mark.parametrize("bid,region", [("41113", "atlantic_se"), ("42035", "gulf"), ("44025", "atlantic_ne"),
                                        ("46232", "pacific_ne"), ("51201", "hawaii"), ("52200", "other"),
                                        ("LJPC1", "other"), ("4623", "other"), (None, "other"), (46232, "pacific_ne")])
def test_a_buoy_region_comes_from_its_ndbc_id(bid, region):
    assert region_of(bid) == region


def test_a_bias_that_changes_sign_by_coast_is_reported_per_coast_not_averaged_away():
    """GFS-Wave reads HIGH on Florida's east coast and LOW in SoCal (2026-09-28): pooled, the two cancel and GFS looks
    unbiased; per coast each sign stands, and the member that wins can differ."""
    east = {"raw_surf": (0.3, 0.3, 0.3), "raw_surf:ICON": (0.0, 0.1, -0.1), "raw_surf:EURO": (0.1, 0.1, 0.1)}
    west = {"raw_surf": (-0.3, -0.3, -0.3), "raw_surf:ICON": (0.0, 0.1, -0.1), "raw_surf:EURO": (-0.1, -0.1, -0.1)}
    rows = (_rows(range(8, 40), 90, errs=east, buoy="41113") + _rows(range(0, 7), 30, errs=east, buoy="41113")
            + _rows(range(8, 40), 90, errs=west, buoy="46232") + _rows(range(0, 7), 30, errs=west, buoy="46232"))
    rep = consensus_report(rows, NOW)
    reg = rep["by_region"]
    assert _lead(rep)["members"]["raw_surf"]["bias_m"] == pytest.approx(0.0, abs=1e-3), "pooled, the signs cancel"
    assert reg["atlantic_se"]["members"]["raw_surf"]["bias_m"] == pytest.approx(0.3, abs=1e-3)
    assert reg["pacific_ne"]["members"]["raw_surf"]["bias_m"] == pytest.approx(-0.3, abs=1e-3)
    assert reg["atlantic_se"]["n"] == reg["pacific_ne"]["n"] == 30, "held-out pairs only, never the training weeks"
    assert reg["atlantic_se"]["best_member"] == "raw_surf:ICON"
    assert reg["pacific_ne"]["pair_gfs_euro"]["bias_m"] == pytest.approx(-0.2, abs=1e-3)


def test_a_thin_region_refuses_instead_of_printing_a_number():
    rows = (_rows(range(8, 40), 90) + _rows(range(0, 7), 30)
            + _rows(range(0, 7), 4, buoy="42035"))
    reg = consensus_report(rows, NOW)["by_region"]
    assert reg["gulf"] == {"n": 4, "status": "insufficient"}
    assert reg["pacific_ne"]["status"] == "scored"

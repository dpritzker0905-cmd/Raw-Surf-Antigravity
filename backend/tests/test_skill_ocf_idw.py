"""The `ocf_idw` arm (skill_ocf_idw): rule docs/weather-program/log/2026-11-15-fable-idw-bias-arm-prereg.md.

These pin what the rule fixed: the bias for a buoy comes from OTHER same-coast buoys by inverse squared distance within
500 km and never from the buoy itself; the fallback is counted and a mostly-fallback lead is NOT TESTED; a gain that
survives shuffling is NOT SHOWN; a coast made worse by more than 0.01 m blocks a PASS; the planted +0.30 m must come back
or the run is INVALID; hole buoys are out of the fit; and the block is published only when station positions exist."""
import inspect
import json
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import forecast_skill as fs
from services.weather_pipeline import skill_ocf, skill_ocf_idw as idw
from services.weather_pipeline.skill_consensus import MEMBERS

NOW = datetime(2026, 11, 30, 12, 0, tzinfo=timezone.utc)
LEADS = (24.0, 48.0, 72.0)
# eight buoys up one coast, one degree of latitude apart; the model's error grows smoothly northward
COAST = {f"4600{i}": (30.0 + i, -125.0) for i in range(1, 9)}
GRADIENT = {b: 0.05 * (lat - 34.5) for b, (lat, _lon) in COAST.items()}


def _rows(bias, days=tuple(range(8, 30)) + tuple(range(0, 7)), hours=3, leads=LEADS):
    out = []
    for lead in leads:
        for d in days:
            for h in range(hours):
                t = NOW - timedelta(days=d, hours=h)
                for bi, buoy in enumerate(sorted(bias)):
                    obs = 1.5 + 0.1 * ((d + h + bi) % 7)
                    for m in MEMBERS:
                        out.append({"source": m, "buoy_id": buoy, "target_time": t.strftime("%Y-%m-%dT%H:00:00Z"),
                                    "lead_h": lead, "hs_m": obs + bias[buoy], "obs_hs_m": obs})
    return out


def _lead(rep, lead=48):
    return next(e for e in rep["by_lead"] if e["lead_h"] == lead)


def test_distance_is_great_circle_km():
    assert idw.km_between((0.0, 0.0), (1.0, 0.0)) == pytest.approx(111.195, abs=0.01)
    assert idw.km_between((33.0, -118.0), (33.0, -118.0)) == 0.0


def test_a_smooth_error_along_a_coast_is_recovered_from_neighbours_and_passes():
    rep = idw.idw_report(_rows(GRADIENT), NOW, COAST)
    assert rep["verdict"] == "PASS" and rep["leads_scored"] == [24, 48, 72] and rep["added_late"] == "2026-11-15"
    e = _lead(rep)
    # the coast mean of this error is zero, so the coast correction does nothing and the neighbours do the work
    assert e["mae_m"]["ocf_region"] == pytest.approx(e["mae_m"]["served"], abs=1e-4)
    assert e["mae_m"]["ocf_idw"] < 0.6 * e["mae_m"]["served"]
    assert e["interval_above_zero"] and e["null_beaten"] and e["worse_regions"] == [] and e["fallback_to_region_bias"] == 0
    assert e["gain_over_ocf_region"]["gain_m"] > 0 and rep["positive_control"]["recovered"] is True
    assert rep["exclude_buoys"] == sorted(skill_ocf.HOLE_BUOYS) and rep["buoys_without_a_position"] == []


def test_the_bias_never_comes_from_the_buoy_itself():
    # one buoy alone reads +0.60 m high; its neighbours read true. Its own training error must not reach its forecast.
    bias = {b: 0.0 for b in COAST}
    bias["46004"] = 0.6
    train, test = idw._split(skill_ocf._pairs(_rows(bias), NOW, MEMBERS)[48], NOW, 7)
    biases = idw.buoy_biases(train, MEMBERS)
    regions = {b: "pacific_ne" for b in COAST}
    own = idw.predict_bias("46004", "pacific_ne", biases, regions, COAST, MEMBERS)
    assert biases["46004"][MEMBERS[0]] == pytest.approx(0.6) and own[MEMBERS[0]] == pytest.approx(0.0, abs=1e-9)
    # and the neighbour one degree away takes most of its weight from that buoy: 1 / d^2
    near = idw.predict_bias("46005", "pacific_ne", biases, regions, COAST, MEMBERS)[MEMBERS[0]]
    assert 0.15 < near < 0.6


def test_neighbours_beyond_reach_or_on_another_coast_or_thin_are_not_used():
    biases = {"46001": {m: 0.4 for m in MEMBERS}, "46002": {m: 0.2 for m in MEMBERS}, "41001": {m: 9.0 for m in MEMBERS}}
    regions = {"46001": "pacific_ne", "46002": "pacific_ne", "41001": "atlantic_se"}
    pos = {"46001": (30.0, -125.0), "46002": (30.0 + 600 / 111.195, -125.0), "41001": (30.1, -125.0), "46003": (30.5, -125.0)}
    # 46002 is 600 km from 46001: out of reach, so 46001 has no neighbour; the other-coast buoy next door is ignored
    assert idw.predict_bias("46001", "pacific_ne", biases, regions, pos, MEMBERS) is None
    assert idw.predict_bias("46003", "pacific_ne", biases, regions, pos, MEMBERS)[MEMBERS[0]] == pytest.approx(0.4, abs=0.01)
    assert idw.predict_bias("46009", "pacific_ne", biases, regions, pos, MEMBERS) is None          # no position
    # a buoy under the training minimum gives no bias, so it is nobody's neighbour
    short = [{"buoy": "46001", "obs": 1.0, "fc": {m: 1.4 for m in MEMBERS}}] * (idw.MIN_BUOY_TRAIN - 1)
    assert idw.buoy_biases(short, MEMBERS) == {} and "46001" in idw.buoy_biases(short + short[:1], MEMBERS)


def test_a_lead_that_mostly_falls_back_is_not_tested_and_the_count_is_printed():
    far = {b: (30.0 + 8 * i, -125.0) for i, b in enumerate(sorted(COAST))}            # ~890 km apart: nobody in reach
    rep = idw.idw_report(_rows(GRADIENT), NOW, far)
    e = _lead(rep)
    assert e["verdict"] == "NOT TESTED" and e["status"] == "mostly_fallback" and e["fallback_to_region_bias"] == e["n_test"]
    assert rep["verdict"] == "NOT TESTED" and rep["leads_scored"] == [] and "mae_m" not in e
    assert rep["positive_control"]["status"] == "not_runnable"


def test_an_error_with_no_spatial_structure_does_not_beat_the_shuffled_null():
    # every buoy +0.20 m: the coast mean already has it, so a shuffle changes nothing and the arm is NOT SHOWN
    rep = idw.idw_report(_rows({b: 0.2 for b in COAST}), NOW, COAST)
    e = _lead(rep)
    assert e["mae_m"]["ocf_idw"] < e["mae_m"]["served"] and e["interval_above_zero"]
    assert e["null_beaten"] is False and e["verdict"] == "NOT SHOWN" and rep["verdict"] == "NOT SHOWN"
    assert e["gain_over_ocf_region"]["gain_m"] == pytest.approx(0.0, abs=1e-4)


def test_a_coast_made_worse_by_more_than_the_tolerance_blocks_the_pass():
    # a second coast whose error alternates sign buoy to buoy: a neighbour's error is the wrong sign there
    east = {f"4100{i}": (30.0 + i, -75.0) for i in range(1, 7)}
    bias = {**GRADIENT, **{b: (0.2 if i % 2 else -0.2) for i, b in enumerate(sorted(east))}}
    rep = idw.idw_report(_rows(bias), NOW, {**COAST, **east})
    e = _lead(rep)
    assert e["worse_regions"] == ["atlantic_se"] and e["by_region"]["atlantic_se"]["worse_than_served_m"] > idw.REGION_TOLERANCE_M
    assert e["by_region"]["pacific_ne"]["worse_than_served_m"] < 0 and e["verdict"] == "NOT SHOWN" and rep["verdict"] == "NOT SHOWN"


def test_the_planted_bias_must_come_back_or_the_run_is_invalid(monkeypatch):
    ok = idw.idw_report(_rows(GRADIENT), NOW, COAST)["positive_control"]
    assert ok["coast"] == "pacific_ne" and set(ok["by_lead"]) == {"24", "48", "72"}
    assert all(v["recovered"] and v["removed_m"] == pytest.approx(0.30, abs=0.01) for v in ok["by_lead"].values())
    monkeypatch.setattr(idw, "POS_MIN_REMOVED_M", 0.31)                   # a bar the arm cannot reach
    bad = idw.idw_report(_rows(GRADIENT), NOW, COAST)
    assert bad["positive_control"]["recovered"] is False and bad["verdict"] == "INVALID"


def test_a_hole_buoy_is_out_of_the_fit_and_the_score():
    hole = "46267"
    assert hole in skill_ocf.HOLE_BUOYS
    pos = {**COAST, hole: (34.4, -125.0)}                                   # right beside the others, +1.5 m high
    with_hole = idw.idw_report(_rows({**GRADIENT, hole: 1.5}), NOW, pos)
    without = idw.idw_report(_rows(GRADIENT), NOW, pos)
    assert json.dumps(with_hole, sort_keys=True, default=str) == json.dumps(without, sort_keys=True, default=str)
    # control: let it in and the neighbours' forecasts are poisoned
    let_in = idw.idw_report(_rows({**GRADIENT, hole: 1.5}), NOW, pos, exclude_buoys=())
    assert _lead(let_in)["mae_m"]["ocf_idw"] > 2 * _lead(without)["mae_m"]["ocf_idw"]


def test_a_missing_lead_or_thin_data_gives_no_verdict_number():
    rep = idw.idw_report(_rows(GRADIENT, leads=(24.0, 48.0)), NOW, COAST)
    assert rep["missing_leads"] == [72] and rep["verdict"] == "NOT TESTED"
    thin = idw.idw_report(_rows(GRADIENT, days=(9, 1), hours=1), NOW, COAST)
    assert all(e["status"] == "insufficient" and "mae_m" not in e for e in thin["by_lead"]) and thin["verdict"] == "NOT TESTED"
    assert idw.idw_report([], NOW, COAST)["by_lead"] == []


def test_the_report_is_deterministic():
    a, b = idw.idw_report(_rows(GRADIENT), NOW, COAST), idw.idw_report(_rows(GRADIENT), NOW, COAST)
    assert json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)
    assert _lead(a)["null"]["shuffles"] == idw.NULL_SHUFFLES == 200 and idw.DRAWS == 2000 and idw.REACH_KM == 500.0


def test_the_block_is_published_only_with_station_positions_and_a_failure_costs_only_its_key(monkeypatch):
    rows = _rows(GRADIENT)
    base = skill_ocf.ocf_block(rows, NOW)
    assert "idw_arm" not in base and "idw_arm" not in skill_ocf.ocf_block(rows, NOW, {})
    full = skill_ocf.ocf_block(rows, NOW, COAST)
    assert full["idw_arm"]["verdict"] == "PASS"
    full.pop("idw_arm")
    assert json.dumps(full, sort_keys=True, default=str) == json.dumps(base, sort_keys=True, default=str)
    monkeypatch.setenv("FORECAST_SKILL_OCF_IDW", "0")                 # the kill switch: the key is absent, nothing else moves
    assert json.dumps(skill_ocf.ocf_block(rows, NOW, COAST), sort_keys=True, default=str) == json.dumps(base, sort_keys=True, default=str)
    monkeypatch.delenv("FORECAST_SKILL_OCF_IDW")
    monkeypatch.setattr(idw, "idw_report", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    broken = skill_ocf.ocf_block(rows, NOW, COAST)
    assert broken["idw_arm"] == {"status": "failed", "error": "RuntimeError"} and broken["variants"] == base["variants"]
    assert 'ocf_block(history, now, locals().get("coords"))' in inspect.getsource(fs.run_skill_ledger)

"""The nearshore judge's SHELF ARM: our chain with its cross-shelf friction off, on wide shelves (2026-09-28).

On a wide shelf the served field at the spot is already a shelf-water value: /point at the spot read 0.44 of
/point at the shelf edge at Duck (90 km shelf), 0.60 at Wrightsville (124 km) and 0.66 at Cape Canaveral (74 km),
against 0.93-0.99 on California's narrow shelves. The chain then applies cross-shelf friction (0.67-0.80 there)
as if the input came from the shelf edge, and the Kr study never tested it (its 10 pairs are all narrow-shelf
California, friction 1.0). First live run, 10 wide-shelf station-hours: MAE 0.235 m as served, 0.146 m with the
friction off (bias -0.235 -> -0.100), closer on 78%; Cape Canaveral 0.167 -> 0.085 m.
"""
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from services.weather_pipeline import surf_point
from services.weather_pipeline.nearshore_validation import (
    build_report, model_hs_at_station, model_hs_from_nearshore_input)

STATION, SPOT = (28.40, -80.53), (28.41, -80.59)
WIDE = SimpleNamespace(shore_normal_deg=90.0, depth_m=24.0, shelf_width_km=74.0)      # Cape Canaveral's shelf
NARROW = SimpleNamespace(shore_normal_deg=90.0, depth_m=641.5, shelf_width_km=23.3)   # deep: no bed feel


def _runner():
    path = Path(__file__).resolve().parents[1] / "scripts" / "run_nearshore_validation.py"
    spec = importlib.util.spec_from_file_location("run_nearshore_validation", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run(monkeypatch, tmp_path, geometry):
    runner = _runner()
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    table = {"generated_at": now.isoformat(), "pairs": [{
        "station": "143p1", "station_lat": STATION[0], "station_lng": STATION[1], "station_depth_m": 9.8,
        "spots": [{"name": "Jetty Park", "lat": SPOT[0], "lng": SPOT[1]}]}]}
    monkeypatch.setattr(runner, "load_pairs", lambda: table)
    monkeypatch.setattr(runner, "probe_stations", lambda pairs, hours: (
        {"143p1": [{"time": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "hs_m": 0.8, "flag": 1}]}, [], []))
    monkeypatch.setattr(runner, "_fetch_json", lambda url, timeout=60.0: {
        "point": {"speed": 0.8, "period": 9.0, "direction": 90.0}, "upstream_provider": "noaa"})
    monkeypatch.setattr(surf_point, "resolve_surf_geometry", lambda lat, lng: geometry)
    for k in ("NEARSHORE_VAL_TRAINS", "NEARSHORE_VAL_MOP", "NEARSHORE_VAL_NWPS", "NEARSHORE_VAL_MOP_GRID_DIR",
              "NEARSHORE_VAL_BACKFILL_H"):
        monkeypatch.delenv(k, raising=False)
    out = tmp_path / "report.json"
    monkeypatch.setattr(sys, "argv", ["run_nearshore_validation.py", "--json", str(out)])
    assert runner.main() == 0
    return json.loads(out.read_text(encoding="utf-8"))


def test_on_a_wide_shelf_the_arm_is_the_chain_without_its_friction(monkeypatch, tmp_path):
    report = _run(monkeypatch, tmp_path, WIDE)
    served = model_hs_at_station(0.8, 9.0, 90.0, 90.0, 9.8, 24.0, 74.0)
    no_friction = model_hs_at_station(0.8, 9.0, 90.0, 90.0, 9.8, 24.0, 0.0)
    assert no_friction > served, "the fixture's shelf must carry friction"
    ab = report["no_friction_ab"]
    assert ab["n"] == 1
    assert ab["bulk"]["bias_m"] == pytest.approx(served - 0.8, abs=1e-4)
    assert ab["arm"]["bias_m"] == pytest.approx(no_friction - 0.8, abs=1e-4)


def test_where_friction_does_not_apply_there_is_nothing_to_grade(monkeypatch, tmp_path):
    report = _run(monkeypatch, tmp_path, NARROW)
    assert report["available"] and "no_friction_ab" not in report


def test_the_nearshore_input_is_shoaled_from_its_own_depth_and_nothing_else():
    """Deep input -> the station's own Ks; input AT the station's depth -> unchanged; no depth -> no number."""
    from services.weather_pipeline.surf_transform import shoaling_coefficient
    assert model_hs_from_nearshore_input(1.0, 9.0, 4000.0, 9.8) == pytest.approx(shoaling_coefficient(9.0, 9.8))
    assert model_hs_from_nearshore_input(0.8, 9.0, 9.8, 9.8) == pytest.approx(0.8)
    assert model_hs_from_nearshore_input(0.8, 9.0, 24.0, 9.8) > 0.8     # shoals from 24 m in to 9.8 m
    assert model_hs_from_nearshore_input(0.8, 9.0, None, 9.8) is None
    assert model_hs_from_nearshore_input(0.8, 9.0, 0.0, 9.8) is None


def test_on_a_wide_shelf_the_nearshore_input_arm_rides_the_same_rows(monkeypatch, tmp_path):
    report = _run(monkeypatch, tmp_path, WIDE)
    ab = report["nearshore_input_ab"]
    assert ab["n"] == report["no_friction_ab"]["n"] == 1
    assert ab["arm"]["bias_m"] == pytest.approx(model_hs_from_nearshore_input(0.8, 9.0, 24.0, 9.8) - 0.8, abs=1e-4)
    assert "nearshore_input_ab" not in _run(monkeypatch, tmp_path, NARROW)


def test_the_report_carries_the_arm_only_when_rows_do():
    rows = [{"station": "143p1", "obs_time": "t", "obs_hs_m": 0.8, "model_hs_m": 0.5}]
    assert "no_friction_ab" not in build_report(rows, n_stations=1, n_obs=1, n_preds=1)
    rows[0]["model_hs_no_friction_m"] = 0.75
    ab = build_report(rows, n_stations=1, n_obs=1, n_preds=1)["no_friction_ab"]
    assert ab["arm_closer_share"] == 1.0 and ab["arm"]["mae_m"] == pytest.approx(0.05)

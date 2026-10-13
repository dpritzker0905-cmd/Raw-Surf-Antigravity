"""The nearshore judge grades the transform with the BUOY's geometry (2026-09-28).

The judge evaluates our chain at the buoy's depth and compares it with the buoy. It used the SPOT's shore normal,
so the spot's swell exposure: at 153p1 the buoy's exposure factor was 0.892 while its spots used 0.74-0.85
(Blacks Beach faces 26 deg away), which charged the chain for the beach's exposure while MOP and NWPS, read at the
buoy, never paid it. Live, all 8 stations: MAE 0.241 m with the buoy's geometry vs 0.265 m with the spot's,
observed/modelled 1.36 vs 1.46. The input stays the served offshore field at the spot; the spot-geometry number
rides beside the graded one on the same hours.
"""
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from services.weather_pipeline import surf_point
from services.weather_pipeline.nearshore_validation import build_report, transform_factors

STATION = (33.0, -117.3)
SPOT = (33.02, -117.32)
SWELL_FROM = 270.0
# The buoy faces the swell square-on; the spot faces 80 deg away from it.
GEOMETRY = {STATION: SimpleNamespace(shore_normal_deg=270.0, depth_m=None, shelf_width_km=0.0),
            SPOT: SimpleNamespace(shore_normal_deg=190.0, depth_m=None, shelf_width_km=0.0)}


def _runner():
    path = Path(__file__).resolve().parents[1] / "scripts" / "run_nearshore_validation.py"
    spec = importlib.util.spec_from_file_location("run_nearshore_validation", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.GRADED_MIN_STATION_HOURS = 1   # a fresh copy: these grade the arms' plumbing on a few rows, not the VA-03 floor
    return mod


def _run(monkeypatch, tmp_path):
    runner = _runner()
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    table = {"generated_at": now.isoformat(), "pairs": [{
        "station": "153p1", "station_lat": STATION[0], "station_lng": STATION[1], "station_depth_m": 17.0,
        "spots": [{"name": "Beach", "lat": SPOT[0], "lng": SPOT[1]}]}]}
    resolved = []

    def resolve(lat, lng):
        resolved.append((lat, lng))
        return GEOMETRY[(lat, lng)]

    monkeypatch.setattr(runner, "load_pairs", lambda: table)
    monkeypatch.setattr(runner, "probe_stations", lambda pairs, hours: (
        {"153p1": [{"time": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "hs_m": 1.0, "flag": 1}]}, [], []))
    monkeypatch.setattr(runner, "_fetch_json", lambda url, timeout=60.0: {
        "point": {"speed": 1.5, "period": 12.0, "direction": SWELL_FROM}, "upstream_provider": "noaa"})
    monkeypatch.setattr(surf_point, "resolve_surf_geometry", resolve)
    for k in ("NEARSHORE_VAL_TRAINS", "NEARSHORE_VAL_MOP", "NEARSHORE_VAL_NWPS", "NEARSHORE_VAL_MOP_GRID_DIR",
              "NEARSHORE_VAL_BACKFILL_H"):
        monkeypatch.delenv(k, raising=False)
    out = tmp_path / "report.json"
    monkeypatch.setattr(sys, "argv", ["run_nearshore_validation.py", "--json", str(out)])
    assert runner.main() == 0
    return json.loads(out.read_text(encoding="utf-8")), resolved


def test_the_transform_is_graded_with_the_buoys_geometry(monkeypatch, tmp_path):
    report, resolved = _run(monkeypatch, tmp_path)
    buoy = transform_factors(12.0, SWELL_FROM, 270.0, 17.0, None, 0.0)
    beach = transform_factors(12.0, SWELL_FROM, 190.0, 17.0, None, 0.0)
    assert buoy["exposure"] > beach["exposure"], "the fixture must make the two geometries disagree"
    assert report["factors_median"]["exposure"] == buoy["exposure"]
    assert set(resolved) == {STATION, SPOT}


def test_the_spot_geometry_number_rides_beside_it_on_the_same_hours(monkeypatch, tmp_path):
    report, _ = _run(monkeypatch, tmp_path)
    sg = report["spot_geometry"]
    assert sg["n"] == report["n_matched"] == 1
    # the beach faces away from the swell, so its transform reads lower: further below the buoy's 1.0 m
    assert sg["spot"]["bias_m"] < sg["station"]["bias_m"]
    assert sg["station"]["mae_m"] == report["stations"]["153p1"]["mae_m"]


def test_the_block_appears_only_when_rows_carry_the_spot_number():
    rows = [{"station": "s", "obs_hs_m": 1.0, "model_hs_m": 0.8, "obs_time": "t"}]
    assert "spot_geometry" not in build_report(rows, n_stations=1, n_obs=1, n_preds=1)
    rows[0]["model_hs_spot_geometry_m"] = 0.6
    sg = build_report(rows, n_stations=1, n_obs=1, n_preds=1)["spot_geometry"]
    assert sg["station"]["bias_m"] == -0.2 and sg["spot"]["bias_m"] == -0.4

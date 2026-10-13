"""The nearshore judge reaches the Gulf (NDBC 42035) and keeps grading the friction it just turned off (2026-09-28).

Two gaps #146 left. (1) Cross-shelf friction went off by default on evidence from the Atlantic's wide shelves; the
judge's only Gulf station (CDIP 129p1) answers 404, so Galveston's 166 km shelf, the widest we serve, had no
instrument. NDBC 42035 sits on it in 15.5 m of water. (2) With friction off, served == no-friction, so the shelf arm
went silent by design; the legacy-friction arm keeps the comparison running both ways.
"""
import importlib.util
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from services.weather_pipeline import ndbc_nearshore as NB
from services.weather_pipeline import nearshore_validation as NV
from services.weather_pipeline import surf_point
from services.weather_pipeline.surf_transform import shelf_dissipation

NOW = datetime(2026, 9, 28, 20, 0, tzinfo=timezone.utc)
SAMPLE = """#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
2026 09 28 19 30 100  6.0  7.0    MM    MM    MM  MM 1012.4  29.2  30.4  22.3   MM   MM    MM
2026 09 28 19 20 100  6.0  8.0   0.5     4   3.1 144 1012.4  29.2  30.4  22.2   MM   MM    MM
2026 09 28 18 50 100  6.0  8.0   0.6    MM   3.1 144 1012.5  29.2  30.3  22.1   MM   MM    MM
2026 09 26 18 50 100  6.0  8.0   2.0    MM   3.1 144 1012.5  29.2  30.3  22.1   MM   MM    MM
"""
WIDE = SimpleNamespace(shore_normal_deg=90.0, depth_m=24.0, shelf_width_km=74.0)
NARROW = SimpleNamespace(shore_normal_deg=90.0, depth_m=641.5, shelf_width_km=23.3)


def test_ndbc_wvht_parses_by_header_skips_missing_and_windows_by_time():
    rows = NB.parse_ndbc_wvht(SAMPLE, hours=26.0, now=NOW)
    assert [r["hs_m"] for r in rows] == [0.6, 0.5], "MM skipped, the 2-day-old row cut, oldest first"
    assert rows[-1] == {"time": "2026-09-28T19:20:00Z", "hs_m": 0.5, "flag": 1}
    assert NB.parse_ndbc_wvht("2026 09 28 19 20 0.5", 26.0, NOW) == [], "no header, no guessing at columns"
    assert NB.parse_ndbc_wvht("", 26.0, NOW) == []


def test_an_ndbc_station_is_fetched_from_ndbc_and_a_cdip_one_is_not(monkeypatch):
    seen = []
    monkeypatch.setattr(NB, "fetch_ndbc_hs", lambda st, hours=26.0, timeout=60.0: seen.append(st) or ["x"])
    assert NV.fetch_station_hs("ndbc:42035", hours=5) == ["x"] and seen == ["ndbc:42035"]
    assert NB.is_ndbc("ndbc:42035") and not NB.is_ndbc("143p1")


# The two widest graded shelves, from their NDBC station pages: 42035 Galveston (166 km at the cell) and 42098 Egmont
# Channel = CDIP 214 (185 km, West Florida: where #146 raised heights most, x2.1-2.25 at Fort Myers/Sanibel/Naples).
NDBC_EXPECTED = {"ndbc:42035": (29.235, -94.41, 15.5), "ndbc:42098": (27.59, -82.931, 14.0)}


@pytest.mark.parametrize("station", sorted(NDBC_EXPECTED))
def test_the_committed_ndbc_table_puts_each_buoy_on_its_shelf_at_its_own_cell(station):
    lat, lng, depth = NDBC_EXPECTED[station]
    p = next(p for p in NB.load_ndbc_pairs() if p["station"] == station)
    assert p["station_depth_m"] == depth and (p["station_lat"], p["station_lng"]) == (lat, lng)
    assert [(s["lat"], s["lng"]) for s in p["spots"]] == [(lat, lng)], "paired with its own cell"


def test_the_ndbc_table_is_optional_and_only_ever_ndbc(tmp_path):
    assert NB.load_ndbc_pairs(str(tmp_path / "absent.json")) == []
    f = tmp_path / "t.json"
    f.write_text(json.dumps({"pairs": [{"station": "143p1"}, {"station": "ndbc:1"}]}), encoding="utf-8")
    assert [p["station"] for p in NB.load_ndbc_pairs(str(f))] == ["ndbc:1"]


def test_the_cf_scale_override_is_the_env_lever_exactly(monkeypatch):
    monkeypatch.setenv("SURF_SHELF_CF_SCALE", "0.25")
    via_env = shelf_dissipation(9.0, 24.0, 74.0)
    monkeypatch.delenv("SURF_SHELF_CF_SCALE")
    assert shelf_dissipation(9.0, 24.0, 74.0) == 1.0, "served default: no cross-shelf friction"
    assert shelf_dissipation(9.0, 24.0, 74.0, NV.LEGACY_SHELF_CF_SCALE) == pytest.approx(via_env)
    assert via_env < 1.0


def _runner():
    path = Path(__file__).resolve().parents[1] / "scripts" / "run_nearshore_validation.py"
    spec = importlib.util.spec_from_file_location("run_nearshore_validation", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.GRADED_MIN_STATION_HOURS = 1   # a fresh copy: these grade the arms' plumbing on a few rows, not the VA-03 floor
    return mod


def _run(monkeypatch, tmp_path, geometry, ndbc_pairs=(), argv=(), seen=None):
    runner = _runner()
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    table = {"generated_at": now.isoformat(), "pairs": [
        {"station": s, "station_lat": 28.40, "station_lng": -80.53, "station_depth_m": 9.8,
         "spots": [{"name": "Jetty Park", "lat": 28.41, "lng": -80.59}]} for s in ("143p1", "134p1")]}
    monkeypatch.delenv("SURF_SHELF_CF_SCALE", raising=False)
    monkeypatch.setattr(runner, "load_pairs", lambda: table)
    monkeypatch.setattr(runner, "load_ndbc_pairs", lambda: list(ndbc_pairs))

    def probe(pairs, hours):
        if seen is not None:
            seen.extend(p["station"] for p in pairs)
        return ({"143p1": [{"time": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "hs_m": 0.8, "flag": 1}]}, [], [])
    monkeypatch.setattr(runner, "probe_stations", probe)
    monkeypatch.setattr(runner, "_fetch_json", lambda url, timeout=60.0: {
        "point": {"speed": 0.8, "period": 9.0, "direction": 90.0}, "upstream_provider": "noaa"})
    monkeypatch.setattr(surf_point, "resolve_surf_geometry", lambda lat, lng: geometry)
    for k in ("NEARSHORE_VAL_TRAINS", "NEARSHORE_VAL_MOP", "NEARSHORE_VAL_NWPS", "NEARSHORE_VAL_MOP_GRID_DIR",
              "NEARSHORE_VAL_BACKFILL_H"):
        monkeypatch.delenv(k, raising=False)
    out = tmp_path / "report.json"
    monkeypatch.setattr(sys, "argv", ["run_nearshore_validation.py", "--json", str(out), *argv])
    assert runner.main() == 0
    return json.loads(out.read_text(encoding="utf-8"))


def test_on_a_wide_shelf_the_legacy_friction_rides_beside_the_friction_off_chain(monkeypatch, tmp_path):
    report = _run(monkeypatch, tmp_path, WIDE)
    ab = report["legacy_friction_ab"]
    served = NV.model_hs_at_station(0.8, 9.0, 90.0, 90.0, 9.8, 24.0, 74.0)
    legacy = NV.model_hs_at_station(0.8, 9.0, 90.0, 90.0, 9.8, 24.0, 74.0, cf_scale=0.25)
    assert legacy < served, "the fixture's shelf must carry legacy friction"
    assert ab["bulk"]["bias_m"] == pytest.approx(served - 0.8, abs=1e-4)
    assert ab["arm"]["bias_m"] == pytest.approx(legacy - 0.8, abs=1e-4)
    assert "no_friction_ab" not in report, "served is already friction-free: that arm stays silent"


def test_where_legacy_friction_would_not_apply_there_is_nothing_to_grade(monkeypatch, tmp_path):
    assert "legacy_friction_ab" not in _run(monkeypatch, tmp_path, NARROW)


def test_ndbc_pairs_ride_after_the_station_cap(monkeypatch, tmp_path):
    seen = []
    ndbc = [{"station": "ndbc:42035", "station_lat": 29.235, "station_lng": -94.41, "station_depth_m": 15.5,
             "spots": [{"name": "cell", "lat": 29.235, "lng": -94.41}]}]
    _run(monkeypatch, tmp_path, NARROW, ndbc_pairs=ndbc, argv=("--max-stations", "1"), seen=seen)
    assert seen == ["143p1", "ndbc:42035"], "a full CDIP table must never crowd the hand-listed NDBC buoys out"

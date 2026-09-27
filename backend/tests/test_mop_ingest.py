"""Each CDIP MOP sea+swell run is archived at the spot AND buoy cells (roadmap stage 4, 2026-09-27).

The regional sea+swell grids are ECMWF-driven and hold only future hours, so nothing can grade the product
stage 4 would serve unless each run is kept. The ingest keeps it: every cell in data/mop_spot_cells.json
(77 spots, 13 CDIP buoys at a cell of the buoy's own depth) with the grid's current forecast, as one
gzipped L2 blob, latest plus a per-run archive. First local run: 88/88 cells in 17 s, 16.5 KB gzipped.
"""
import importlib.util
import json
from pathlib import Path

import pytest

from services.weather_pipeline import mop_nearshore as MOP

# The shape THREDDS returns for one cell (SC_0.002_seaswellfc.nc, 2026-09-27 21Z run), trimmed to 3 steps.
CELL = """Dataset {
    Int32 waveTime[waveTime = 3];
} cdip/model/MOP_grids/SC_0.002_seaswellfc.nc;
---------------------------------------------
waveTime[3]
1790542800, 1790564400, 1790586000
waveHs.waveHs[3][1][1]
[0][0], 0.62310827
[1][0], 0.61604697
[2][0], -999.99

waveHs.waveTime[3]
1790542800, 1790564400, 1790586000
waveTp.waveTp[3][1][1]
[0][0], 12.300123
[1][0], 11.111111
[2][0], 16.666666

waveDp.waveDp[3][1][1]
[0][0], 166.16821
[1][0], 165.09221
[2][0], 172.30858
"""


def test_a_cell_series_parses_with_missing_values_as_none():
    s = MOP.parse_cell_series(CELL)
    assert s["times"] == ["2026-09-27T21:00:00Z", "2026-09-28T03:00:00Z", "2026-09-28T09:00:00Z"]
    assert s["hs"] == [0.6231, 0.616, None]
    assert s["tp"] == [12.3001, 11.1111, 16.6667] and s["dp"][0] == 166.1682


def test_the_run_is_read_from_the_net_model_history():
    das = 'String history "2026-09-27T21:55:12Z: dataset created; ... net_model_gf -s 2026092721 -c 36.800 ..."'
    assert MOP.run_stamp(das) == "2026-09-27T21:00:00Z"
    assert MOP.run_stamp("no history") is None


SC = {"file": "SC_0.002_seaswellfc.nc", "lat0": 36.8, "lng0": -122.398, "step": 0.002, "nlat": 200, "nlng": 300}


def test_a_buoy_gets_a_cell_of_its_own_depth_not_the_spot_band():
    i, j = MOP.grid_index(SC, 36.93, -122.0)
    cells = {(i, j + 1): 9.5, (i + 1, j): 17.0, (i - 2, j): 20.4}      # 9.5 m is closest, but a spot depth
    c = MOP.station_cell(SC, lambda a, b: cells.get((a, b), -999.99), 36.93, -122.0, 20.0)
    assert c["depth_m"] == 20.4                                          # within +-10% beats merely +-30%
    assert MOP.station_cell(SC, lambda a, b: {(i, j + 1): 9.5}.get((a, b), -999.99), 36.93, -122.0, 20.0) is None


def _table():
    cell = lambda i, j: {"i": i, "j": j, "lat": 36.9, "lng": -122.0, "depth_m": 10.0, "km": 0.2}  # noqa: E731
    return {"cells": [{"spot_id": "a", "grid": "G", "cell": cell(1, 1)}, {"spot_id": "b", "grid": "G", "cell": cell(1, 1)},
                      {"spot_id": "c", "grid": "G", "cell": cell(2, 2)}],
            "stations": [{"station": "153p1", "grid": "G", "cell": cell(3, 3)}]}


def _ingest():
    path = Path(__file__).resolve().parents[1] / "scripts" / "ingest_mop_spot_series.py"
    spec = importlib.util.spec_from_file_location("ingest_mop_spot_series", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_shared_cells_are_fetched_once_spots_and_buoys_together():
    assert _ingest().cell_keys(_table()) == [("G", 1, 1), ("G", 2, 2), ("G", 3, 3)]


def test_the_blob_carries_what_answered_and_says_how_much_that_is():
    s = MOP.parse_cell_series(CELL)
    blob = MOP.series_blob(_table(), {("G", 1, 1): s, ("G", 3, 3): s}, {"G": {"run": "2026-09-27T21:00:00Z"}},
                           "2026-09-27T23:10:00+00:00")
    assert sorted(blob["spots"]) == ["a", "b"] and sorted(blob["stations"]) == ["153p1"]
    assert blob["coverage"] == {"spots": "2/3", "stations": "1/1"}
    assert blob["spots"]["a"]["depth_m"] == 10.0 and blob["spots"]["a"]["hs"] == [0.6231, 0.616, None]
    assert blob["grids"]["G"]["run"] == "2026-09-27T21:00:00Z"


def test_the_archive_key_sorts_by_ingest_time():
    assert _ingest().archive_key("2026-09-27T23:10:05.123+00:00") == "point_cache/mop_runs/20260927T2310Z.json.gz"


def test_the_committed_table_maps_the_buoys_at_their_own_depth():
    d = json.loads((Path(__file__).resolve().parents[1] / "data" / "mop_spot_cells.json").read_text(encoding="utf-8"))
    assert d["stations"], "the buoys are what archived runs are graded against"
    for s in d["stations"]:
        assert s["cell"]["depth_m"] == pytest.approx(s["depth_m"], rel=MOP.STATION_DEPTH_TOLERANCE)
        assert s["cell"]["km"] <= MOP.STATION_MAX_KM

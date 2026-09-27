"""Which CDIP MOP cell stands for each California spot (roadmap stage 4, 2026-09-27).

#124 measured MOP at 0.101 m MAE against our chain's 0.246 m at the same CDIP buoys and hours. Stage 4
serves it as the input to the breaking step where it exists; the first piece is the spot -> cell table,
built from CDIP's 15 regional SEA+SWELL grids (the `_forecast` grids are swell-only, and the 1 km
California grid turns Malibu's coast to land). First build: 77 of 78 catalogue spots matched (Bolinas
not), median 0.58 km, cell depth p10/p50/p90 8.1/9.2/14.9 m. Nearest-only picked 5-6 m cells everywhere,
inside the surf zone on a big day, which is why the 8-15 m band is preferred over mere closeness.
"""
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from services.weather_pipeline import mop_nearshore as MOP

LAND = -999.99
SC = {"file": "SC_0.002_seaswellfc.nc", "lat0": 36.8, "lng0": -122.398, "step": 0.002, "nlat": 200, "nlng": 300}
SM = {"file": "SM_0.002_seaswellfc.nc", "lat0": 37.0, "lng0": -122.698, "step": 0.002, "nlat": 400, "nlng": 250}
FINE = {"file": "X_0.001_seaswellfc.nc", "lat0": 36.9, "lng0": -122.1, "step": 0.001, "nlat": 100, "nlng": 100}


def _depths(cells):
    return lambda i, j: cells.get((i, j), LAND)


def test_the_grid_index_is_the_containing_cell_and_none_outside():
    assert MOP.grid_index(SC, 36.9514, -122.0263) == (76, 186)
    assert MOP.cell_center(SC, 75, 187) == (36.95, -122.024)
    assert MOP.grid_index(SC, 36.7, -122.0) is None


def test_overlapping_grids_offer_the_finest_first():
    assert [g["file"] for g in MOP.grids_containing([SC, SM, FINE], 36.95, -122.02)] == [FINE["file"], SC["file"]]


def test_a_cell_in_the_preferred_band_beats_a_closer_shallow_one():
    i, j = MOP.grid_index(SC, 36.9514, -122.0263)
    cells = {(i, j + 1): 5.9, (i - 1, j + 1): 9.9}           # the 5.9 m cell is closer
    assert MOP.nearest_cell(SC, _depths(cells), 36.9514, -122.0263)["depth_m"] == 9.9


def test_outside_the_band_the_closest_cell_wins_and_land_or_distance_never_qualify():
    i, j = MOP.grid_index(SC, 36.9514, -122.0263)
    cells = {(i, j): LAND, (i, j + 1): 3.0, (i - 3, j): 24.0, (i - 6, j): 20.0}
    c = MOP.nearest_cell(SC, _depths(cells), 36.9514, -122.0263)
    assert (c["i"], c["depth_m"]) == (i - 3, 24.0)
    far = {(i - 8, j): 10.0}              # inside the square search window, but ~1.8 km: past CELL_MAX_KM
    assert MOP.nearest_cell(SC, _depths(far), 36.9514, -122.0263) is None


def test_equally_close_band_cells_prefer_mops_reference_depth():
    i, j = 76, 186
    lat, lng = MOP.cell_center(SC, i, j)                # a spot AT a cell centre: +-2 rows are equidistant
    for near, far_ in (((i + 2, j), (i - 2, j)), ((i - 2, j), (i + 2, j))):
        cells = {near: 14.0, far_: 10.5}
        assert MOP.nearest_cell(SC, _depths(cells), lat, lng)["depth_m"] == 10.5


def _builder():
    path = Path(__file__).resolve().parents[1] / "scripts" / "build_mop_spot_cells.py"
    spec = importlib.util.spec_from_file_location("build_mop_spot_cells", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_parsers_read_rows_and_geometry_not_the_map_vectors():
    b = _builder()
    txt = """metaWaterDepth.metaWaterDepth[2][3]
[0], 52.0, 53.2, -999.99
[1], 6.6, -999.99, 14.9

metaWaterDepth.metaLatitude[2]
34.0, 34.01
"""
    assert b.parse_depth_grid(txt) == [[52.0, 53.2, -999.99], [6.6, -999.99, 14.9]]
    dds = "Float32 metaLatitude[metaLatitude = 200];\nFloat32 metaLongitude[metaLongitude = 300];"
    assert b.parse_grid_geometry(dds, [36.8, 36.802], [-122.398, -122.396], "SC_0.002_seaswellfc.nc") == SC


def test_the_committed_table_is_fresh_sea_and_swell_and_every_cell_meets_the_criteria():
    d = json.loads((Path(__file__).resolve().parents[1] / "data" / "mop_spot_cells.json").read_text(encoding="utf-8"))
    age_d = (datetime.now(timezone.utc) - datetime.fromisoformat(d["generated_at"])).days
    assert age_d <= 180, "rebuild with backend/scripts/build_mop_spot_cells.py"
    grids = {g["file"]: g for g in d["grids"]}
    assert grids and all(f.endswith(MOP.SEASWELL_SUFFIX) for f in grids), "only the sea+swell grids are served"
    assert d["cells"] and d["n_spots_in_grids"] == len(d["cells"]) + len(d["uncovered"])
    for c in d["cells"]:
        cell, g = c["cell"], grids[c["grid"]]
        assert MOP.CELL_MIN_DEPTH_M <= cell["depth_m"] <= MOP.CELL_MAX_DEPTH_M
        assert cell["km"] <= MOP.CELL_MAX_KM
        assert MOP.cell_center(g, cell["i"], cell["j"]) == (pytest.approx(cell["lat"]), pytest.approx(cell["lng"]))

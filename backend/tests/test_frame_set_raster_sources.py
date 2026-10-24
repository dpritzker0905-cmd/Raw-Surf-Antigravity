"""Per-model pressure sources (2026-10-23; the owner, 20:13 EDT: "Yes start it", answering "start the per-model pressure route?"
after "We want each models pressure showing"): services/frame_set_raster_sources.py and the EURO set in frame_set_raster."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import publish_frame_images as pub  # noqa: E402
from services import frame_binary as fb  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_raster as fsr  # noqa: E402
from services import frame_set_raster_sources as srcs  # noqa: E402

EURO = fsr.SPECS["pressure_euro"]
CYCLE = datetime(2026, 10, 23, 0, tzinfo=timezone.utc)
INDEX = "\n".join(json.dumps(e) for e in [
    {"param": "10u", "levtype": "sfc", "type": "fc", "_offset": 0, "_length": 100},
    {"param": "msl", "levtype": "sfc", "type": "fc", "_offset": 302968, "_length": 529445},
    {"param": "msl", "levtype": "sfc", "type": "pf", "_offset": 9, "_length": 9},
])


def test_the_index_gives_the_deterministic_msl_range():
    assert srcs.index_entry(INDEX, "msl") == (302968, 529445)
    assert srcs.index_entry(INDEX, "2t") is None
    assert srcs.index_entry("not json\n\n" + INDEX, "10u") == (0, 100)


def test_an_180w_first_grid_is_turned_to_gfs_order():
    lon_ecmwf = (-180.0 + 0.25 * np.arange(1440)) % 360.0           # ECMWF open data: column 0 = 180W
    a = np.tile(lon_ecmwf, (721, 1))
    got = srcs.to_gfs_order(a, 180.0)
    assert np.array_equal(got[0], 0.25 * np.arange(1440))           # column 0 = 0E, as GRIB from NOAA
    assert np.array_equal(srcs.to_gfs_order(got, 0.0), got)          # already 0E-first: unchanged
    plane = fsr.to_frame_plane(got * 0 + 1013.0)
    assert plane.shape == (361, 720)


def test_euro_steps_and_cycle_choice():
    assert EURO["hours"][:3] == (0, 3, 6) and EURO["hours"][48] == 144 and EURO["hours"][49] == 150 and EURO["hours"][-1] == 240
    assert len(EURO["hours"]) == 65

    class Head:
        def __init__(self, ok):
            self.ok = ok

        def head(self, url, timeout=60):
            return type("R", (), {"status_code": 200 if any(k in url for k in self.ok) else 404})()
    # the 12Z run lacks 240 h yet; the 00Z run has both ends -> 00Z
    src = srcs.EcmwfOpenDataSource(EURO, session=Head(["20261023000000-0h", "20261023000000-240h", "20261023120000-0h"]))
    assert src.complete_cycle(datetime(2026, 10, 23, 22, 5, tzinfo=timezone.utc)) == CYCLE
    assert src.url(CYCLE, 150).endswith("/20261023/00z/ifs/0p25/oper/20261023000000-150h-oper-fc.grib2")


class _EuroSource:
    def complete_cycle(self, now):
        return CYCLE

    def url(self, cycle, f):
        return srcs.EcmwfOpenDataSource(EURO, session=object()).url(cycle, f)

    def fetch(self, cycle, f):
        lat = 90.0 - 0.25 * np.arange(721)[:, None]
        lon = 0.25 * np.arange(1440)[None, :]
        return 1012.0 + 20.0 * np.sin(np.radians(lat) * 2) * np.cos(np.radians(lon) - f * 0.02)


def test_the_euro_set_publishes_under_its_own_key_with_ecmwf_credit(tmp_path, monkeypatch):
    monkeypatch.delenv("FRAME_RASTER_PRESSURE_EURO", raising=False)
    assert not fsr.enabled("pressure_euro")                          # opt-in
    monkeypatch.setenv("FRAME_RASTER_PRESSURE_EURO", "1")
    assert fsr.enabled("pressure_euro")
    sink = pub.LocalSink(tmp_path)
    report = fsr.publish(_EuroSource(), sink, pub._uploader(sink), log=lambda *_: None, spec=EURO)
    assert report["status"] == "published" and report["built"] == 65
    latest = json.loads((tmp_path / fs.LATEST).read_text())
    rec = latest["sets"]["EURO/weather/pressure/global_0p5"]
    index = json.loads((tmp_path / rec["index"]).read_text())
    assert index["model"] == "EURO" and index["common_meta"]["model"] == "EURO" and index["common_meta"]["upstream_provider"] == "ecmwf"
    assert "ECMWF" in index["credit"] and "CC BY 4.0" in index["license"]
    assert [f["source"]["forecast_hour"] for f in index["frames"]][-3:] == [228, 234, 240]
    f = index["frames"][50]
    _h, fields = fb.decode_plane((tmp_path / f["path"]).read_bytes())
    want = fsr.to_frame_plane(_EuroSource().fetch(CYCLE, 156))
    assert np.nanmax(np.abs(fields[fb.PRESSURE_HPA] - want)) <= fb.TOLERANCE[fb.PRESSURE_HPA]
    assert "GFS/weather/pressure/global_0p5" not in latest["sets"]


# ── ICON: icosahedral cells box-averaged onto the lattice ─────────────────────────────────────────────────────────────
ICON = fsr.SPECS["pressure_icon"]


def _cloud(n=400000, seed=3):
    rng = np.random.default_rng(seed)
    z = rng.uniform(-1, 1, n); lon = rng.uniform(-180, 180, n)
    return np.degrees(np.arcsin(z)), lon                    # uniform on the sphere, like the ICON cell centres


def test_box_mean_is_the_mean_of_the_cells_in_each_box_and_fills_empty_boxes_along_the_row():
    clat, clon = _cloud()
    node, counts = srcs.box_assignment(clat, clon)
    assert counts.sum() == clat.size
    def smooth(la, lo):                                                   # smooth ON THE SPHERE (no pole or seam artefact), as pressure is
        la, lo = np.radians(la), np.radians(lo)
        return 1010.0 + 8.0 * np.cos(la) * np.cos(lo) + 5.0 * np.cos(la) * np.sin(lo) + 12.0 * np.sin(la)
    field = smooth(clat, clon)
    plane = srcs.box_mean(field, node, counts)
    assert plane.shape == (361, 720) and np.isfinite(plane).all()
    r, c = 200, 300                                                       # a box with cells: exactly their mean
    sel = node == r * 720 + c
    assert sel.any() and np.isclose(plane[r, c], field[sel].mean())
    assert np.allclose(plane[0], plane[0, 0]) and np.allclose(plane[360], plane[360, 0])   # pole rows: one value
    lat_nodes = -90.0 + 0.5 * np.arange(361)
    lon_nodes = -180.0 + 0.5 * np.arange(720)
    expect = smooth(lat_nodes[:, None], lon_nodes[None, :])
    assert np.nanmax(np.abs(plane - expect)) < 0.1                       # a box mean of a smooth field is near the node value


def test_radians_are_accepted_and_nan_cells_are_left_out():
    clat, clon = _cloud(50000)
    a = srcs.box_assignment(clat, clon)[0]
    b = srcs.box_assignment(np.radians(clat), np.radians(clon))[0]
    assert np.array_equal(a, b)
    v = np.full(clat.size, 1010.0); v[::7] = np.nan
    assert np.nanmax(np.abs(srcs.box_mean(v, *srcs.box_assignment(clat, clon)) - 1010.0)) < 1e-9


class _IconSource:
    def __init__(self):
        self.clat, self.clon = _cloud(300000, seed=9)
        self.pick = srcs.nearest_pick(self.clat, self.clon, srcs.box_assignment(self.clat, self.clon)[0])

    def complete_cycle(self, now):
        return CYCLE

    def url(self, cycle, f):
        return f"https://opendata.dwd.de/weather/nwp/icon/grib/00/pmsl/x_{f:03d}_PMSL.grib2.bz2"

    def fetch(self, cycle, f):
        return srcs.nearest_plane(1010.0 + 15 * np.sin(np.radians(self.clat) * 3 + f * 0.01), self.pick)


def test_the_icon_set_publishes_lattice_planes_with_dwd_credit(tmp_path, monkeypatch):
    monkeypatch.setenv("FRAME_RASTER_PRESSURE_ICON", "1")
    assert ICON["hours"][-1] == 180 and len(ICON["hours"]) == 61
    sink = pub.LocalSink(tmp_path)
    report = fsr.publish(_IconSource(), sink, pub._uploader(sink), log=lambda *_: None, spec=ICON)
    assert report["status"] == "published" and report["built"] == 61
    index = json.loads((tmp_path / json.loads((tmp_path / fs.LATEST).read_text())["sets"]["ICON/weather/pressure/global_0p5"]["index"]).read_text())
    assert "Deutscher Wetterdienst" in index["credit"] and index["common_meta"]["upstream_provider"] == "dwd"
    assert index["parity_max_abs_err"]["pressure_hpa"] <= fb.TOLERANCE[fb.PRESSURE_HPA]



def test_nearest_pick_takes_the_cell_nearest_each_node_and_one_point_per_pole():
    clat, clon = _cloud(200000, seed=11)
    node, _ = srcs.box_assignment(clat, clon)
    pick = srcs.nearest_pick(clat, clon, node)
    r, c = 200, 300                                                       # a node with cells
    cand = np.nonzero(node == r * 720 + c)[0]
    nl, no = np.radians(-90 + 0.5 * r), np.radians(-180 + 0.5 * c)
    dots = np.cos(np.radians(clat[cand])) * np.cos(nl) * np.cos(np.radians(clon[cand]) - no) + np.sin(np.radians(clat[cand])) * np.sin(nl)
    assert pick[r * 720 + c] == cand[np.argmax(dots)]
    assert len(set(pick[:720])) == 1 and len(set(pick[-720:])) == 1     # each pole row: one cell
    assert clat[pick[0]] == clat.min() and clat[pick[-1]] == clat.max()   # the cells nearest each pole
    plane = srcs.nearest_plane(1010.0 + 0.1 * clat, pick)
    assert plane.shape == (361, 720) and np.isfinite(plane).all()
    assert plane[r, c] == 1010.0 + 0.1 * clat[pick[r * 720 + c]]       # a point sample: the cell's own value


def test_a_sharp_peak_survives_nearest_but_the_box_mean_flattens_it():
    clat, clon = _cloud(1500000, seed=5)                               # ~ICON's density (0.17 degrees apart)
    node, counts = srcs.box_assignment(clat, clon)
    peak = 1000.0 + 40.0 * np.exp(-((clat - 45.0) ** 2 + ((clon - 90.0) * np.cos(np.radians(45.0))) ** 2) / 0.15)   # a high a few cells wide
    near = srcs.nearest_plane(peak, srcs.nearest_pick(clat, clon, node))
    box = srcs.box_mean(peak, node, counts)
    assert near.max() > box.max() + 1.0

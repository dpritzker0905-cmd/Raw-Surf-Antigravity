"""Raster static frames from NOAA GRIB (2026-10-23, phase 1: GFS PRMSL): services/frame_set_raster.py.

Offline only: a fake GRIB source (no network, no pygrib) + LocalSink. Pins the contract agreed with the raster client
(raster-instant session, 2026-10-23): set key GFS/weather/pressure/global_0p5; 720 x 361, row 0 = south, column 0 = 180W,
bounds = outer cell centres, no wrap column; f000-f336 every 3 h; field 6 pressure_hpa u16 scale 0.1 offset 799.9, code 0 =
no data; credit/license/source_url in the index. Also: frames before the index and latest.json LAST; an unchanged cycle
uploads nothing; a coverage refusal uploads nothing; retention keeps two runs; the kill switch; and that every node the
box's own 10-deg pressure product samples equals the frame's value (both read the same pgrb2.0p25 field).
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
import publish_raster_frames as script  # noqa: E402
from services import frame_binary as fb  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_raster as fsr  # noqa: E402

LAT25 = 90.0 - 0.25 * np.arange(721)            # GRIB order: row 0 = 90N
LON25 = 0.25 * np.arange(1440)                  # column 0 = 0E
CYCLE = datetime(2026, 10, 23, 6, tzinfo=timezone.utc)


def _field(f, lat=LAT25[:, None], lon=LON25[None, :]):
    """A smooth, position-unique hPa field: lows and highs that move with the forecast hour."""
    return 1010.0 + 25.0 * np.sin(np.radians(lat) * 2.0) * np.cos(np.radians(lon) - f * 0.01) + lat * 0.05 + lon * 0.001


class _Source:
    def __init__(self, cycle=CYCLE, fail=(), poison=None):
        self.cycle, self.fail, self.poison, self.fetched = cycle, set(fail), poison, []

    def complete_cycle(self, now):
        return self.cycle

    def url(self, cycle, f):
        return f"https://example.invalid/gfs.t{cycle:%H}z.pgrb2.0p25.f{f:03d}"

    def fetch(self, cycle, f):
        self.fetched.append(f)
        if f in self.fail:
            raise RuntimeError("range GET -> HTTP 503")
        a = _field(f)
        if self.poison is not None and f == self.poison:
            a[100, 100] = 1200.0 * 100                  # an impossible value: must become no-data, not a code
        return a


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("FRAME_RASTER_PRESSURE", "FRAME_RASTER_BUDGET_S", "FRAME_MIN_COVERAGE"):
        monkeypatch.delenv(k, raising=False)


def _publish(out, source=None, **kw):
    sink = pub.LocalSink(out)
    return fsr.publish(source or _Source(), sink, pub._uploader(sink), log=lambda *_: None, **kw), sink


def _latest(out):
    return json.loads((out / fs.LATEST).read_text())


def test_the_plane_is_south_first_from_180w_every_second_point_and_drops_impossible_values():
    a = _field(0)
    a[0, 0] = 700.0                                   # 90N 0E: below the physical range -> no data
    plane = fsr.to_frame_plane(a)
    assert plane.shape == (fsr.ROWS, fsr.COLS) == (361, 720)
    for r, c in ((0, 0), (360, 719), (180, 360), (100, 37), (261, 600)):
        lat, lon = fsr.node_lat_lon(r, c)
        assert plane[r, c] == pytest.approx(_field(0, lat, lon % 360.0)) or (lat, lon % 360) == (90.0, 0.0)
    assert np.isnan(plane[360, 360]) and np.isfinite(plane).sum() == plane.size - 1   # 90N, 0E is row 360, column 360
    with pytest.raises(ValueError, match="0.25-deg"):
        fsr.to_frame_plane(np.zeros((361, 720)))


def test_the_frame_is_field_6_at_0_1_hpa_and_the_generic_decoder_reads_it():
    plane = fsr.to_frame_plane(_field(12))
    raw, gz, check = fsr.build_frame(plane, CYCLE, CYCLE)
    assert check["bad"] == 0 and check["max_abs_err"] <= 0.05 + 1e-9
    generic = fb.decode_frame(gz)                     # the per-node decoder the browser's codec twins
    assert (generic["cols"], generic["rows"], generic["field_mask"]) == (720, 361, 1 << fb.PRESSURE_HPA)
    assert generic["bounds"] == fsr.BOUNDS == (-180.0, -90.0, 179.5, 90.0) and generic["row_order"] == 0
    desc = fb.DESCRIPTOR.unpack_from(raw, fb.HEADER_FIXED)
    assert desc[:5] == (6, 2, 1, 0, 0) and desc[5] == pytest.approx(0.1) and desc[6] == pytest.approx(799.9)
    vals = np.array(generic["fields"][fb.PRESSURE_HPA], dtype=float).reshape(361, 720)
    assert np.allclose(vals, fb.decode_plane(gz)[1][fb.PRESSURE_HPA]) and np.max(np.abs(vals - plane)) <= 0.05 + 1e-9


def test_every_node_the_box_pressure_product_samples_equals_the_frame():
    """noaa_gfs_pressure_fetcher (the box's global_coarse product) reads the SAME pgrb2.0p25 PRMSL at the nearest grid index
    of each 10-deg node; the frame keeps every second 0.25-deg point, so each such node is a frame node with that value."""
    from services.noaa_gfs_pressure_fetcher import _coarse_axis
    a = _field(48)
    plane = fsr.to_frame_plane(a)
    for la in _coarse_axis(-90.0, 90.0, 10.0):
        for lo in _coarse_axis(-180.0, 180.0, 10.0):
            gr, gc = int(np.abs(LAT25 - la).argmin()), int(np.abs(LON25 - lo % 360.0).argmin())   # the fetcher's idx_map
            r, c = int(round((la + 90) / 0.5)), int(round((lo + 180) / 0.5))
            assert plane[r, c] == a[gr, gc] / 1.0


def test_a_cycle_publishes_113_frames_then_its_index_then_latest_last(tmp_path):
    report, sink = _publish(tmp_path / "out")
    assert (report["status"], report["built"], report["uploaded"], report["failed"]) == ("published", 113, 113, 0)
    rec = _latest(tmp_path / "out")["sets"][fsr.KEY]
    assert fsr.KEY == "GFS/weather/pressure/global_0p5" and rec["run"] == rec["cycle"] == "2026-10-23T06:00:00Z"
    index = json.loads((tmp_path / "out" / rec["index"]).read_text())
    assert sink.order[-1] == fs.LATEST and sink.order[-2] == rec["index"] and len(sink.order) == 115
    assert [f["valid_time"] for f in index["frames"]][:2] == ["2026-10-23T06:00:00Z", "2026-10-23T09:00:00Z"]
    assert index["frames"][-1]["valid_time"] == "2026-11-06T06:00:00Z" and len(index["frames"]) == 113   # f336
    assert index["grid"] == {"cols": 720, "rows": 361, "bounds": {"west": -180.0, "south": -90.0, "east": 179.5, "north": 90.0},
                             "row0": "south", "col0": "west", "wrap_column": False}
    assert index["credit"].startswith("Contains modified NOAA GFS data") and index["license"] and index["source_url"]
    assert index["common_meta"]["value_unit"] == "hPa" and index["cycle"] == index["run"]
    f = index["frames"][4]
    assert f["path"].startswith(fsr.PREFIX + "/20261023T060000Z/20261023T180000Z-") and f["meta"] == {"forecast_hour": 12}
    assert sink.headers[f["path"]] == {"content-type": "application/octet-stream", "cache-control": fs.IMMUTABLE}
    got = fb.decode_plane((tmp_path / "out" / f["path"]).read_bytes())[1][fb.PRESSURE_HPA]
    assert np.max(np.abs(got - fsr.to_frame_plane(_field(12)))) <= 0.05 + 1e-9


def test_an_unchanged_cycle_uploads_nothing(tmp_path):
    _publish(tmp_path / "out")
    before = (tmp_path / "out" / fs.LATEST).read_bytes()
    src = _Source()
    report, sink = _publish(tmp_path / "out", src)
    assert report["status"] == "unchanged" and sink.order == [] and src.fetched == []
    assert (tmp_path / "out" / fs.LATEST).read_bytes() == before


def test_failed_hours_are_listed_unbuilt_and_too_many_refuse_the_cycle(tmp_path):
    report, _sink = _publish(tmp_path / "a", _Source(fail={9, 12, 300}, poison=24))
    index = json.loads((tmp_path / "a" / _latest(tmp_path / "a")["sets"][fsr.KEY]["index"]).read_text())
    gaps = {f["source"]["forecast_hour"]: f["unbuilt"] for f in index["frames"] if not f.get("path")}
    assert gaps == {9: "failed", 12: "failed", 300: "failed"} and report["built"] == 110
    assert report["missing_nodes"] == 1               # the impossible value at GRIB (100, 100), a kept node, became no data
    f24 = next(f for f in index["frames"] if f["source"]["forecast_hour"] == 24)
    plane = fb.decode_plane((tmp_path / "a" / f24["path"]).read_bytes())[1][fb.PRESSURE_HPA]
    assert np.isnan(plane[360 - 50, 50 + 360]) and np.isfinite(plane).sum() == plane.size - 1   # 65N 25E: row 310, column 410
    report, sink = _publish(tmp_path / "b", _Source(fail=set(range(0, 60, 3))))   # 20 of 113 fail: coverage 0.82
    assert report["status"] == "coverage_refused" and sink.order == [] and not (tmp_path / "b" / fs.LATEST).exists()


def test_hours_not_started_inside_the_budget_are_unbuilt_and_refuse_the_cycle(tmp_path):
    ticks = iter([0.0] + [0.0] * 5 + [10_000.0] * 500)
    report, sink = _publish(tmp_path / "out", budget_s=60, clock=lambda: next(ticks))
    assert report["status"] == "coverage_refused" and report["skipped_budget"] > 100 and sink.order == []


def test_retention_keeps_the_current_and_previous_run(tmp_path):
    out, recs = tmp_path / "out", []
    for h in (0, 6, 12):
        _publish(out, _Source(cycle=datetime(2026, 10, 23, h, tzinfo=timezone.utc)))
        recs.append(_latest(out)["sets"][fsr.KEY])
    runs = {p.split("/")[5] for p in pub.LocalSink(out).list(fsr.PREFIX) if "/index/" not in p}
    assert runs == {"20261023T060000Z", "20261023T120000Z"} and recs[2]["previous_index"] == recs[1]["index"]
    assert len(pub.LocalSink(out).list(fsr.PREFIX + "/index")) == 2


def test_the_kill_switch_and_the_other_sets_records(tmp_path, monkeypatch):
    out = tmp_path / "out"
    (out / "v1").mkdir(parents=True)
    other = {"index": "v1/gfs/marine/waves/global_mid/index/x.json", "run": "2026-10-23T00:00:00Z"}
    (out / fs.LATEST).write_text(json.dumps({"version": 1, "sets": {"GFS/marine/waves/global_mid": other}}))
    _publish(out)
    assert _latest(out)["sets"]["GFS/marine/waves/global_mid"] == other   # a raster publish changes only its own record
    monkeypatch.setenv("FRAME_RASTER_PRESSURE", "0")
    monkeypatch.setattr(fsr, "GfsPrmslSource", lambda: pytest.fail("the kill switch must not fetch"))
    assert script.main(["--out-dir", str(tmp_path / "killed")]) == 0 and not (tmp_path / "killed").exists()

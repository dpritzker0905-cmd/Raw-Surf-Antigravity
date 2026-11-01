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


# ── raster phase 2 (2026-10-23): GFS 2 m temperature and total cloud cover, the same contract ──────────────────────────
IDX = """1:0:d=2026102318:PRMSL:mean sea level:3 hour fcst:
2:1000:d=2026102318:TMP:2 m above ground:3 hour fcst:
3:2500:d=2026102318:TCDC:entire atmosphere:3 hour fcst:
4:3100:d=2026102318:TCDC:entire atmosphere:0-3 hour ave fcst:
5:3900:d=2026102318:APCP:surface:0-3 hour acc fcst:
"""


def test_the_idx_selector_takes_the_instantaneous_message_never_a_mean_or_an_accumulation():
    rows = fsr.idx_rows(IDX)
    assert fsr.select_message(rows, ("TCDC", "entire atmosphere")) == (2500, 3099)        # not the 0-3 h mean at 3100
    assert fsr.select_message(rows, ("PRMSL", "mean sea level")) == (0, 999)
    assert fsr.select_message(rows, ("TMP", "2 m above ground")) == (1000, 2499)
    assert fsr.select_message(rows, ("APCP", "surface")) is None                          # only an accumulation exists
    anl = fsr.idx_rows("1:0:d=2026102318:TCDC:entire atmosphere:anl:\n2:900:d=2026102318:HGT:surface:anl:\n")
    assert fsr.select_message(anl, ("TCDC", "entire atmosphere")) == (0, 899)


def test_pressure_frames_are_byte_identical_to_the_first_publisher():
    import hashlib
    raw, _gz, _check = fsr.build_frame(fsr.to_frame_plane(_field(12)), CYCLE, CYCLE)
    assert hashlib.sha256(raw).hexdigest() == "986fe4ebd9954615f51104d2ed228020a184ceea87a1ba6a1bbdea46c92c0618"


def test_the_new_sets_are_off_unless_switched_on_and_pressure_stays_on(monkeypatch):
    assert fsr.enabled() and fsr.enabled("pressure")
    assert not fsr.enabled("temperature") and not fsr.enabled("cloud_cover")
    monkeypatch.setenv("FRAME_RASTER_TEMPERATURE", "1")
    monkeypatch.setenv("FRAME_RASTER_CLOUD", "1")
    assert fsr.enabled("temperature") and fsr.enabled("cloud_cover")
    with pytest.raises(ValueError):
        fsr.spec_for("rain")


class _KelvinSource(_Source):
    def fetch(self, cycle, f):
        self.fetched.append(f)
        return fsr.SPECS["temperature"]["convert"]((_field(f) - 1010.0) * 0.8 + 288.15)   # 268-308 K, as degC


class _CloudSource(_Source):
    def fetch(self, cycle, f):
        self.fetched.append(f)
        a = np.clip((_field(f) - 990.0) * 2.5, 0.0, 100.0)
        a[0, :8] = [100.0000001, -0.0000002, 37.4, 37.6, 0.0, 100.0, 50.5, 101.0]   # GRIB float noise; 101 = impossible
        return a


def test_temperature_set_publishes_degC_frames_under_its_own_key(tmp_path):
    report, _sink = _publish(tmp_path / "t", source=_KelvinSource(), spec=fsr.SPECS["temperature"])
    assert report["status"] == "published" and report["built"] == len(fsr.F_HOURS)
    key = "GFS/weather/temperature/global_0p5"
    rec = _latest(tmp_path / "t")["sets"][key]
    index = json.loads((tmp_path / "t" / rec["index"]).read_text())
    assert index["set"] == key and index["layer"] == "temperature" and index["common_meta"]["value_unit"] == "degC"
    assert index["quantisation"] == {"temp_c": {"tolerance": fb.TOLERANCE[fb.TEMP_C]}}
    f = index["frames"][4]
    assert f["path"].startswith("v1/gfs/weather/temperature/global_0p5/")
    _head, fields = fb.decode_plane((tmp_path / "t" / f["path"]).read_bytes())
    want = fsr.to_frame_plane(_KelvinSource().fetch(CYCLE, 12), fsr.SPECS["temperature"]["valid"])
    assert np.nanmax(np.abs(fields[fb.TEMP_C] - want)) <= fb.TOLERANCE[fb.TEMP_C] == 0.025 + 1e-9
    assert fsr.KEY not in _latest(tmp_path / "t")["sets"]                                   # pressure's record untouched


def test_cloud_set_is_u8_percent_clipping_grib_noise_and_dropping_impossible_values(tmp_path):
    sp = fsr.SPECS["cloud_cover"]
    plane = fsr.to_frame_plane(_CloudSource().fetch(CYCLE, 0), sp["valid"], sp["clip"])
    raw, _gz, check = fsr.build_frame(plane, CYCLE, CYCLE, sp["field"])
    assert check["bad"] == 0 and check["max_abs_err"] <= 0.5
    _head, fields = fb.decode_plane(raw)
    got = fields[fb.CLOUD_PCT]
    assert np.nanmin(got) >= 0.0 and np.nanmax(got) <= 100.0
    assert len(raw) == 72 + 24 + 720 * 361                                                   # one byte per node
    # the noisy row (GRIB row 0 = 90N, every second point -> frame row 360, columns from 180W): 101 % is no data
    row = fsr.to_frame_plane(_CloudSource().fetch(CYCLE, 0), sp["valid"], sp["clip"])[360]
    src = _CloudSource().fetch(CYCLE, 0)[0, ::2]
    src = np.concatenate([src[360:], src[:360]])
    for c in range(len(src)):
        if src[c] > 100.5:
            assert np.isnan(row[c])
    report, _sink = _publish(tmp_path / "c", source=_CloudSource(), spec=sp)
    assert report["status"] == "published"
    assert "GFS/weather/cloud_cover/global_0p5" in _latest(tmp_path / "c")["sets"]


def test_the_script_runs_one_set_and_skips_a_set_that_is_off(tmp_path, capsys):
    assert script.main(["--set", "temperature", "--out-dir", str(tmp_path)]) == 0
    assert "temperature: off (FRAME_RASTER_TEMPERATURE); skipped" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        script.main(["--set", "rain"])


def test_pressure_index_and_paths_are_identical_to_the_first_publisher():
    frames, _uploads, stats = fsr.build_set(_Source(), CYCLE, log=lambda *_: None)
    index = fsr.make_index(CYCLE, frames, stats)
    assert index["path"] == "v1/gfs/weather/pressure/global_0p5/index/20261023T060000Z-1a58a2171302.json"
    assert index["common_meta"]["source_dataset"] == "gfs.pgrb2.0p25 PRMSL, every second point"
    assert all(f["path"].startswith("v1/gfs/weather/pressure/global_0p5/20261023T060000Z/") for f in index["frames"])


class _OnlyMeanSource(_Source):
    """An hour whose .idx carries only the 0-N hour MEAN of TCDC (no instantaneous message): never substituted."""

    def __init__(self, only_mean_at):
        super().__init__()
        self.only_mean_at = only_mean_at

    def fetch(self, cycle, f):
        idx = IDX if f != self.only_mean_at else IDX.replace("3:2500:d=2026102318:TCDC:entire atmosphere:3 hour fcst:\n", "")
        if fsr.select_message(fsr.idx_rows(idx), fsr.SPECS["cloud_cover"]["idx"]) is None:
            raise RuntimeError("idx has no TCDC:entire atmosphere message")
        return np.full((721, 1440), 42.0)


def test_an_hour_with_only_the_tcdc_mean_is_left_unbuilt_never_substituted(tmp_path):
    report, _sink = _publish(tmp_path / "m", source=_OnlyMeanSource(only_mean_at=6), spec=fsr.SPECS["cloud_cover"])
    assert report["status"] == "published" and report["failed"] == 1
    index = json.loads((tmp_path / "m" / _latest(tmp_path / "m")["sets"]["GFS/weather/cloud_cover/global_0p5"]["index"]).read_text())
    hour6 = [f for f in index["frames"] if f["source"]["forecast_hour"] == 6][0]
    assert hour6["path"] is None and hour6["unbuilt"] == "failed"


def test_real_f003_idx_lines_pick_the_instantaneous_tcdc_not_the_mean():
    """The two TCDC lines exactly as NOAA's GFS 18Z 2026-10-23 pgrb2.0p25.f003.idx carries them (read 2026-10-23; static-frames'
    review): the instantaneous message (636) ends where the 0-3 h mean (637) starts."""
    real = ("636:447842631:d=2026102318:TCDC:entire atmosphere:3 hour fcst:\n"
            "637:448681869:d=2026102318:TCDC:entire atmosphere:0-3 hour ave fcst:\n")
    assert fsr.select_message(fsr.idx_rows(real), ("TCDC", "entire atmosphere")) == (447842631, 448681868)


def test_cloud_0p25_set_is_every_point_of_the_0p25_grid_south_first_from_180w_and_off_by_default(tmp_path, monkeypatch):
    # The owner, 2026-10-25: "Go with your recommendation if that is state of the art" (cloud at 0.25 deg).
    sp = fsr.SPECS["cloud_cover_0p25"]
    g = fsr.grid_of(sp)
    assert (g["cols"], g["rows"], g["stride"]) == (1440, 721, 1) and g["bounds"] == (-180.0, -90.0, 179.75, 90.0)
    assert fsr.grid_of(fsr.SPECS["cloud_cover"]) == fsr.GRIDS["0p5"] and fsr.grid_of(None)["cols"] == 720
    src = _CloudSource().fetch(CYCLE, 0)
    plane = fsr.to_frame_plane(src, sp["valid"], sp["clip"], g["stride"])
    assert plane.shape == (721, 1440)
    for r, c in ((0, 0), (720, 1439), (360, 720), (101, 37), (500, 1000)):
        lat, lon = -90.0 + 0.25 * r, -180.0 + 0.25 * c
        want = src[int(round((90.0 - lat) / 0.25)), int(round((lon % 360.0) / 0.25))]
        assert (np.isnan(plane[r, c]) and want > 100.5) or plane[r, c] == pytest.approx(min(max(want, 0.0), 100.0))
    raw, _gz, check = fsr.build_frame(plane, CYCLE, CYCLE, sp["field"], g["bounds"])
    assert check["bad"] == 0 and len(raw) == 72 + 24 + 1440 * 721                          # one byte per node
    head, _fields = fb.decode_plane(raw)
    assert (head["cols"], head["rows"]) == (1440, 721)
    report, _sink = _publish(tmp_path / "c25", source=_CloudSource(), spec=sp)
    assert report["status"] == "published"
    sets = _latest(tmp_path / "c25")["sets"]
    assert "GFS/weather/cloud_cover/global_0p25" in sets
    index = json.loads((tmp_path / "c25" / sets["GFS/weather/cloud_cover/global_0p25"]["index"]).read_text())
    assert index["grid"]["cols"] == 1440 and index["grid"]["rows"] == 721 and index["grid"]["bounds"]["east"] == 179.75
    monkeypatch.delenv("FRAME_RASTER_CLOUD_0P25", raising=False)
    assert not fsr.enabled("cloud_cover_0p25")
    monkeypatch.setenv("FRAME_RASTER_CLOUD_0P25", "1")
    assert fsr.enabled("cloud_cover_0p25")

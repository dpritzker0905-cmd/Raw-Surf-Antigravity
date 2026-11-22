"""NOAA Global RTOFS surface currents raster set (2026-11-22): services/frame_set_raster_rtofs.py + SPECS['currents_rtofs'].

Offline only: a tiny RTOFS-shaped HDF5 file built here, served by a fake HTTP that honours Range, and LocalSink. Pins: the set
key, switch (dark) and hours; the nearest-node vector mean (alignment, land / fill / bad cells excluded, longitude wrap past 180,
the poles); the range reader (8 MB blocks, request count, a server without ranges); the file-time check; the cycle choice; one
publish end to end; the pilots-workflow step and the monitor's switch.
"""
import io
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
import publish_raster_frames as script  # noqa: E402
from services import frame_binary as fb  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_raster as fsr  # noqa: E402
from services import frame_set_raster_rtofs as rt  # noqa: E402

h5py = pytest.importorskip("h5py")
CYCLE = datetime(2026, 11, 21, tzinfo=timezone.utc)
WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
FILLV = np.float32(1.2676506e30)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("FRAME_RASTER_CURRENTS_RTOFS", "FRAME_RASTER_BUDGET_S", "FRAME_MIN_COVERAGE", "FRAME_RASTER_ONE_BYTE"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(rt.RtofsCurrentsSource, "MIN_GAP_S", 0.0)


def rtofs_file(lat, lon, u, v, valid):
    """Bytes of an HDF5 file shaped like rtofs_glo_2ds_fHHH_prog.nc (the fields this source reads)."""
    buf = io.BytesIO()
    with h5py.File(buf, "w") as h:
        h["MT"] = np.array([(valid - rt.MT_EPOCH).total_seconds() / 86400.0])
        h.create_dataset("Latitude", data=np.asarray(lat, np.float32), compression="gzip")
        h.create_dataset("Longitude", data=np.asarray(lon, np.float32), compression="gzip")
        for n, a in (("u_velocity", u), ("v_velocity", v)):
            h.create_dataset(n, data=np.asarray(a, np.float32)[None, None], compression="gzip", chunks=True)
    return buf.getvalue()


class _Resp:
    def __init__(self, status, content=b"", headers=None):
        self.status_code, self.content, self.headers = status, content, headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _Http:
    """Serves {url: bytes}; honours `Range: bytes=lo-hi` with 206 unless ranges=False. Counts GETs."""

    def __init__(self, files, ranges=True):
        self.files, self.ranges, self.gets = files, ranges, 0

    def head(self, url, timeout=None):
        return _Resp(200 if url in self.files else 404)

    def get(self, url, headers=None, timeout=None):
        self.gets += 1
        if url not in self.files:
            return _Resp(404)
        body = self.files[url]
        if not self.ranges or not headers or "Range" not in headers:
            return _Resp(200, body)
        lo, hi = (int(x) for x in headers["Range"].split("=")[1].split("-"))
        part = body[lo:hi + 1]
        return _Resp(206, part, {"Content-Range": f"bytes {lo}-{lo + len(part) - 1}/{len(body)}"})


def _grid():
    """A 1/12-degree patch: 24 x 24 cells over 1-3 N, 179-181 E (crossing the antimeridian, as RTOFS' 74-434 E longitudes)."""
    lat = 1.0 + (np.arange(24) + 0.5) / 12.0
    lon = 179.0 + (np.arange(24) + 0.5) / 12.0
    return np.meshgrid(lat, lon, indexing="ij")


def _world(hours, u0=0.5, v0=0.0):
    lat, lon = _grid()
    u = np.full(lat.shape, u0)
    v = np.full(lat.shape, v0)
    u[:2, :2] = FILLV                                  # land (fill) cells
    return {rt.RtofsCurrentsSource.BASE + f"/rtofs.{CYCLE:%Y%m%d}/rtofs_glo_2ds_f{f:03d}_prog.nc":
            rtofs_file(lat, lon, u, v, CYCLE + timedelta(hours=f)) for f in hours}


def test_nomads_is_asked_at_most_100_times_a_minute(monkeypatch):
    # The advisor's gate (2026-11-22): NOMADS blocks above ~120 hits a minute and runner addresses are shared.
    assert rt.MIN_GAP_S >= 0.6 and rt.MAX_INFLIGHT <= 2               # >= 0.5 keeps it under 120 a minute; 0.6 = 100
    import inspect                                                    # the class takes the module's gap (the fixture zeroes it)
    assert "BASE, MAX_INFLIGHT, MIN_GAP_S = BASE, MAX_INFLIGHT, MIN_GAP_S" in inspect.getsource(rt.RtofsCurrentsSource)
    slept = []
    monkeypatch.setattr(rt.time, "sleep", slept.append)
    monkeypatch.setattr(rt.time, "monotonic", lambda: 100.0)      # every call at the same instant: each waits its turn
    p = rt._Pacer(rt.MIN_GAP_S)
    for _ in range(4):
        p.wait()
    assert slept == pytest.approx([0.6, 1.2, 1.8])


def test_the_rtofs_set_contract():
    sp = fsr.spec_for("currents_rtofs")
    assert fs.set_key(sp["target"]) == "RTOFS/marine/currents/global_0p25"
    assert sp["fields"] == (fb.SPEED, fb.DIRECTION) and sp["field"] == fb.SPEED and sp["uv_convention"] == 1
    assert sp["band_field"] == fsr.spec_for("currents")["band_field"] and fsr.grid_of(sp)["cols"] == 1440
    assert tuple(sp["hours"]) == tuple(range(0, 193, 6))          # the Copernicus set's 6-hour cadence, to RTOFS' f192
    assert sp["env"] == "FRAME_RASTER_CURRENTS_RTOFS" and sp["default_on"] is False and not fsr.enabled("currents_rtofs")
    assert "RTOFS" in sp["credit"] and "public domain" in sp["license"] and sp["value_unit"] == "kn"
    assert isinstance(fsr.make_source(sp, session=object()), rt.RtofsCurrentsSource)


def test_dark_until_its_variable_is_1(monkeypatch, capsys):
    assert script.main(["--set", "currents_rtofs", "--out-dir", "unused"]) == 0 and "skipped" in capsys.readouterr().out
    monkeypatch.setenv("FRAME_RASTER_CURRENTS_RTOFS", "1")
    assert fsr.enabled("currents_rtofs")


def test_node_index_wraps_longitude_and_clamps_the_poles():
    idx = rt.node_index(np.array([0.0, 0.1, 89.99, -90.0, np.nan]), np.array([434.0, -180.0, 180.12, 74.16, 0.0]))
    assert idx[0] == 360 * 1440 + (74 + 180) * 4                  # 434 E = 74 E
    assert idx[1] == 360 * 1440 + 0                               # 0.1 N rounds to the equator row, 180 W column 0
    assert idx[2] == 720 * 1440 + 0                               # 180.12 E = 179.88 W -> column 0 (nearest node is 180)
    assert idx[3] == 0 * 1440 + (74 + 180) * 4 + 1                # 74.16 E: column of 74.25 E
    assert idx[4] == -1


def test_bin_mean_is_a_vector_mean_over_ocean_cells_only():
    idx = np.array([5, 5, 5, 7, 7, -1])
    u = np.array([1.0, 3.0, np.nan, FILLV, 12.0, 9.0])            # NaN, fill and > 10 m/s are not ocean values
    v = np.array([0.0, 2.0, 1.0, 0.0, 0.0, 9.0])
    mu, mv = rt.bin_mean(idx, u, v)
    assert mu.ravel()[5] == pytest.approx(2.0) and mv.ravel()[5] == pytest.approx(1.0)
    assert np.isnan(mu.ravel()[7]) and np.isnan(mu.ravel()[6]) and np.isfinite(mu).sum() == 1


def test_fetch_builds_speed_and_direction_on_the_lattice():
    http = _Http(_world([0]))
    src = rt.RtofsCurrentsSource(fsr.spec_for("currents_rtofs"), session=http)
    got = src.fetch(CYCLE, 0)
    spd, to = got[fb.SPEED], got[fb.DIRECTION]
    assert spd.shape == (721, 1440)
    ok = np.isfinite(spd)
    assert ok.any() and np.allclose(spd[ok], 0.5 * 3600 / 1852)
    assert np.allclose(to[ok], 90.0)                              # u > 0, v = 0: flowing toward the east
    rows, cols = np.nonzero(ok)
    assert set(rows) == set(range(364, 373))                       # 1.04-2.96 N -> nodes 1.0-3.0 N
    assert {0, 1439}.issubset(set(cols))                           # both sides of the antimeridian
    assert src.requests >= 1 and src.bytes > 0


def test_a_file_whose_own_time_is_wrong_is_refused():
    files = _world([6])
    files[rt.RtofsCurrentsSource.BASE + f"/rtofs.{CYCLE:%Y%m%d}/rtofs_glo_2ds_f012_prog.nc"] = next(iter(files.values()))
    src = rt.RtofsCurrentsSource(fsr.spec_for("currents_rtofs"), session=_Http(files))
    with pytest.raises(RuntimeError, match="file time"):
        src.fetch(CYCLE, 12)


def test_range_file_reads_in_blocks_and_works_without_ranges():
    body = bytes(range(256)) * 100
    for ranges in (True, False):
        http = _Http({"u": body}, ranges=ranges)
        rf = rt.RangeFile(http, "u", block=1000)
        rf.seek(2500)
        assert rf.read(10) == body[2500:2510] and rf.size == len(body)
        rf.seek(-5, 2)
        assert rf.read(100) == body[-5:]
        assert http.gets == (3 if ranges else 1) and rf.bytes == (2600 if ranges else len(body))   # 1000 + 1000 + the last 600


def test_the_cycle_is_the_newest_day_with_its_first_and_last_hour():
    spec = fsr.spec_for("currents_rtofs")
    files = {rt.RtofsCurrentsSource.BASE + f"/rtofs.{CYCLE:%Y%m%d}/rtofs_glo_2ds_f{f:03d}_prog.nc": b"x" for f in (0, 192)}
    src = rt.RtofsCurrentsSource(spec, session=_Http(files))
    assert src.complete_cycle(CYCLE + timedelta(hours=20)) == CYCLE
    assert src.complete_cycle(CYCLE + timedelta(days=1, hours=5)) == CYCLE   # today's not written yet: yesterday's
    assert src.complete_cycle(CYCLE + timedelta(days=2, hours=5)) is None    # NOMADS keeps two days


@pytest.mark.parametrize("one_byte", ["1", "0"])
def test_a_published_rtofs_frame(tmp_path, monkeypatch, one_byte):
    monkeypatch.setenv("FRAME_RASTER_ONE_BYTE", one_byte)
    sp = dict(fsr.SPECS["currents_rtofs"], hours=(0, 6))
    files = _world((0, 6))
    sink = pub.LocalSink(tmp_path)
    report = fsr.publish(rt.RtofsCurrentsSource(sp, session=_Http(files)), sink, pub._uploader(sink), log=print, spec=sp,
                         now=CYCLE + timedelta(hours=14))
    assert report["status"] == "published" and report["built"] == 2 and report["refused"] == 0
    rec = json.loads((tmp_path / fs.LATEST).read_text())["sets"]["RTOFS/marine/currents/global_0p25"]
    index = json.loads((tmp_path / rec["index"]).read_text())
    assert index["common_meta"]["upstream_provider"] == "noaa" and "RTOFS" in index["credit"]
    assert index["license"] == fsr.SPECS["currents_rtofs"]["license"] and "public domain" in index["license"]
    assert index["source_url"].startswith("https://nomads.ncep.noaa.gov/")
    _h, f = fb.decode_plane((tmp_path / index["frames"][1]["path"]).read_bytes())
    fid = fb.CURRENT_KN_BAND if one_byte == "1" else fb.SPEED
    assert np.nanmax(f[fid]) == pytest.approx(0.5 * 3600 / 1852, abs=0.011)


def test_a_failed_publish_exits_1_and_no_cycle_exits_0(monkeypatch, capsys):
    monkeypatch.setenv("FRAME_RASTER_CURRENTS_RTOFS", "1")
    monkeypatch.setattr(script.fsr, "publish", lambda *a, **k: {"status": "coverage_refused"})
    assert script.main(["--set", "currents_rtofs", "--out-dir", "unused"]) == 1
    assert "::error title=Raster set currents_rtofs not published::" in capsys.readouterr().out
    monkeypatch.setattr(script.fsr, "publish", lambda *a, **k: {"status": "no_cycle"})
    assert script.main(["--set", "currents_rtofs", "--out-dir", "unused"]) == 0


def test_the_pilots_workflow_has_one_dark_rtofs_step_and_the_monitor_reads_its_switch():
    yml = (WORKFLOWS / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    steps = [s for s in yml.split("\n      - name: ")[1:] if "--set currents_rtofs\n" in s + "\n"]
    assert len(steps) == 1
    step = steps[0]
    assert "vars.FRAME_IMAGES_PUBLISH == '1' && vars.FRAME_RASTER_CURRENTS_RTOFS == '1'" in step
    assert "continue-on-error" not in step and "timeout-minutes: 20" in step     # a failed publish turns the run red
    after = yml.split("--set currents_rtofs\n", 1)[1].split("\n      - name: ")[1:]
    ifs = [ln.strip() for s in after for ln in s.splitlines()[1:2] if ln.strip().startswith("if:")]
    assert ifs and all("!cancelled()" in i for i in ifs)                  # the steps after still run on a red step
    mon = (WORKFLOWS / "data-health-monitor.yml").read_text(encoding="utf-8")
    assert "FRAME_RASTER_CURRENTS_RTOFS: ${{ vars.FRAME_RASTER_CURRENTS_RTOFS }}" in mon

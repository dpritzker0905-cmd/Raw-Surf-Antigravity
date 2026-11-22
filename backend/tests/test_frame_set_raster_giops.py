"""Canada GIOPS surface-currents raster set (2026-11-22): services/frame_set_raster_giops.py + SPECS['currents_giops'].

Offline only (a fake Datamart serving NetCDF files this test writes, LocalSink, no network). Pins: the set key, its own
switch (dark), the ECCC credit and licence (never "ICON"); the Datamart file names; the reader (fill -> NaN, the 0.2-degree
grid checked); the bilinear vector regrid onto 0.25 deg (aligned nodes exact, land corners renormalised away, south of 80S
no data); the cycle pick, the retry, a published two-field frame; the pilots-workflow step (dark, non-empty file).
"""
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
from services import frame_set_raster_giops as gi  # noqa: E402

CYCLE = datetime(2026, 11, 22, tzinfo=timezone.utc)
KEY = "GIOPS/marine/currents/global_0p25"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("FRAME_RASTER_CURRENTS_GIOPS", "FRAME_RASTER_BUDGET_S", "FRAME_MIN_COVERAGE", "FRAME_RASTER_ONE_BYTE"):
        monkeypatch.delenv(k, raising=False)


def _nc_bytes(tmp_path, var, values, lat0=-80.0):
    """A GIOPS-shaped NetCDF-4 file (850 x 1800, float32, fill 1e20 where `values` is NaN) as bytes."""
    import netCDF4
    p = tmp_path / f"{var}-{abs(hash(values.tobytes()))}.nc"
    with netCDF4.Dataset(p, "w", format="NETCDF4") as d:
        d.createDimension("time", 1)
        d.createDimension("latitude", gi.SRC_ROWS)
        d.createDimension("longitude", gi.SRC_COLS)
        d.createVariable("latitude", "f4", ("latitude",))[:] = lat0 + 0.2 * np.arange(gi.SRC_ROWS)
        d.createVariable("longitude", "f4", ("longitude",))[:] = 0.2 * np.arange(gi.SRC_COLS)
        v = d.createVariable(var, "f4", ("time", "latitude", "longitude"), fill_value=np.float32(1e20), zlib=True)
        v[0] = np.ma.masked_invalid(values.astype("f4"))
    return p.read_bytes()


class _Resp:
    def __init__(self, status, content=b""):
        self.status_code, self.content = status, content

    def raise_for_status(self):
        if self.status_code != 200:
            raise RuntimeError(f"HTTP {self.status_code}")


class _Datamart:
    """Serves {url: bytes}; `drops` urls fail once with a connection error before answering."""

    def __init__(self, files, drops=()):
        self.files, self.drops, self.gets = files, set(drops), []

    def head(self, url, timeout=None):
        return _Resp(200 if url in self.files else 404)

    def get(self, url, timeout=None):
        self.gets.append(url)
        if url in self.drops:
            self.drops.discard(url)
            raise ConnectionError("Remote end closed connection without response")
        return _Resp(200, self.files[url]) if url in self.files else _Resp(404)


def test_the_giops_set_contract_is_dark_and_credits_eccc_not_icon():
    sp = fsr.spec_for("currents_giops")
    assert fs.set_key(sp["target"]) == KEY
    assert sp["fields"] == (fb.SPEED, fb.DIRECTION) and sp["field"] == fb.SPEED and sp["uv_convention"] == 1
    assert sp["band_field"] == fb.CURRENT_KN_BAND and fsr.grid_of(sp)["cols"] == 1440
    assert tuple(sp["hours"]) == tuple(range(6, 241, 6))                  # the Copernicus cadence; P000 has no currents
    assert sp["env"] == "FRAME_RASTER_CURRENTS_GIOPS" and sp["default_on"] is False and not fsr.enabled("currents_giops")
    assert "Environment and Climate Change Canada" in sp["credit"] and "End-use Licence" in sp["license"]
    assert sp["credit"].startswith("Contains information licensed under the Open Government Licence – Canada.")
    assert "open.canada.ca/en/open-government-licence-canada" in sp["license"] and sp["strict"] is True
    base = fsr.SPECS["currents"]                          # the frame layout follows the Copernicus set's
    assert all(sp[k] == base[k] for k in ("field", "fields", "band_field", "uv_convention") if k in base)
    assert "ICON" not in sp["credit"] + sp["license"] + sp["source_dataset"] and sp["upstream_provider"] == "eccc"
    assert isinstance(fsr.make_source(sp, session=object()), gi.GiopsCurrentsSource)


def test_dark_until_its_variable_is_1(monkeypatch, capsys):
    assert script.main(["--set", "currents_giops", "--out-dir", "unused"]) == 0 and "skipped" in capsys.readouterr().out
    monkeypatch.setenv("FRAME_RASTER_CURRENTS_GIOPS", "1")
    assert fsr.enabled("currents_giops")


def test_the_pilots_workflow_has_one_dark_giops_step_that_turns_the_run_red():
    path = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-ingest-pilots.yml"
    yml = path.read_text(encoding="utf-8")
    assert len(yml) > 10000, "the pilots workflow file is missing or emptied"
    assert "  ingest-pilots:\n    environment: supabase-service" in yml                   # the key's only home (#1043)
    steps = [s for s in yml.split("\n      - name: ")[1:] if "--set currents_giops\n" in s + "\n"]
    assert len(steps) == 1
    step = steps[0]
    assert "vars.FRAME_IMAGES_PUBLISH == '1' && vars.FRAME_RASTER_CURRENTS_GIOPS == '1'" in step
    assert "continue-on-error" not in step                # the advisor's condition: a failure turns the run red
    assert "timeout-minutes: 10" in step and 'FRAME_RASTER_BUDGET_S: "300"' in step
    assert "SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" in step


def test_datamart_file_names():
    assert gi.file_url(CYCLE, 24, "vozocrtx") == (
        "https://dd.weather.gc.ca/20261122/WXO-DD/model_giops/netcdf/lat_lon/2d/00/024/"
        "CMC_giops_vozocrtx_depth_0.5_latlon0.2x0.2_3h-mean_2026112200_P024.nc")
    tail = "/2d/12/240/CMC_giops_vomecrty_depth_0.5_latlon0.2x0.2_3h-mean_2026112212_P240.nc"
    assert gi.file_url(CYCLE + timedelta(hours=12), 240, "vomecrty").endswith(tail)


def test_the_reader_masks_land_and_checks_the_grid(tmp_path):
    a = np.full((gi.SRC_ROWS, gi.SRC_COLS), 0.25)
    a[10, 20] = np.nan
    got = gi.read_field(_nc_bytes(tmp_path, "vozocrtx", a), "vozocrtx")
    assert got.shape == (850, 1800) and np.isnan(got[10, 20]) and got[0, 0] == pytest.approx(0.25)
    with pytest.raises(RuntimeError, match="grid changed"):
        gi.read_field(_nc_bytes(tmp_path, "vozocrtx", a, lat0=-78.0), "vozocrtx")


def test_regrid_takes_aligned_nodes_exactly_and_interpolates_between():
    i, j = np.meshgrid(np.arange(gi.SRC_ROWS), np.arange(gi.SRC_COLS), indexing="ij")
    a = (i + 1000.0 * j).astype(float)                   # linear in both indices: bilinear reproduces it exactly
    out = gi.regrid_quarter(a)
    assert out.shape == (721, 1440)
    # lattice (lat -80, lon 0) = row 40, column 720 = source (0, 0); (lat -79, lon 1) = source (5, 5)
    assert out[40, 720] == pytest.approx(0.0) and out[44, 724] == pytest.approx(5 + 5000.0)
    # lat -79.75 (row 41) sits at source row 1.25; lon 0.25 (column 721) at source column 1.25
    assert out[41, 721] == pytest.approx(1.25 + 1250.0)
    # lon -180 (column 0) is 180E = source column 900
    assert out[40, 0] == pytest.approx(900000.0)
    assert np.isnan(out[:40]).all() and np.isfinite(out[40:720]).all()  # south of 80S: no source rows


def test_regrid_drops_land_corners_and_leaves_all_land_empty():
    a = np.full((gi.SRC_ROWS, gi.SRC_COLS), 2.0)
    a[1, 1] = 50.0
    a[1, 2] = np.nan                                      # a land corner of node (lat -79.75, lon 0.25)
    out = gi.regrid_quarter(a)
    # node (row 41, col 721): corners rows 1-2, cols 1-2 (weights 0.5625, 0.1875, 0.1875, 0.0625); land renormalised away
    w = np.array([0.5625, 0.1875, 0.0625])
    assert out[41, 721] == pytest.approx((w * np.array([50.0, 2.0, 2.0])).sum() / w.sum())
    land = np.full((gi.SRC_ROWS, gi.SRC_COLS), np.nan)
    assert np.isnan(gi.regrid_quarter(land)).all()
    with pytest.raises(ValueError):
        gi.regrid_quarter(np.zeros((10, 10)))


def test_complete_cycle_is_the_newest_run_with_its_first_and_last_frames():
    sp = fsr.SPECS["currents_giops"]
    prev = CYCLE - timedelta(days=1)
    files = {gi.file_url(prev, f, v): b"x" for f in (6, 240) for v in gi.VARS}
    files[gi.file_url(CYCLE, 6, "vozocrtx")] = b"x"              # today's run is still arriving
    src = gi.GiopsCurrentsSource(sp, session=_Datamart(files))
    assert src.complete_cycle(CYCLE + timedelta(hours=7)) == prev
    assert gi.GiopsCurrentsSource(sp, session=_Datamart({})).complete_cycle(CYCLE) is None


def test_get_retries_a_dropped_connection_but_not_a_404():
    url = gi.file_url(CYCLE, 6, "vozocrtx")
    dm = _Datamart({url: b"ok"}, drops=[url])
    waits = []
    src = gi.GiopsCurrentsSource(fsr.SPECS["currents_giops"], session=dm)
    assert src._get(url, sleep=waits.append) == b"ok" and waits == [gi.RETRY_WAITS_S[0]] and len(dm.gets) == 2
    waits.clear()
    with pytest.raises(RuntimeError, match="404"):
        src._get(gi.file_url(CYCLE, 12, "vozocrtx"), sleep=waits.append)
    assert waits == []


def test_a_published_giops_frame_is_eastward_speed_in_knots(tmp_path, monkeypatch):
    """u = 0.5 m/s east, v = 0 everywhere wet: the frame's speed is 0.97 kn and it flows TOWARD 90 deg; land stays no data."""
    monkeypatch.setenv("FRAME_RASTER_ONE_BYTE", "0")      # the two-field frame (speed + direction) is the full contract
    u = np.full((gi.SRC_ROWS, gi.SRC_COLS), 0.5)
    v = np.zeros((gi.SRC_ROWS, gi.SRC_COLS))
    u[400:410, 100:110] = np.nan
    v[400:410, 100:110] = np.nan
    ub, vb = _nc_bytes(tmp_path, "vozocrtx", u), _nc_bytes(tmp_path, "vomecrty", v)
    sp = dict(fsr.SPECS["currents_giops"], hours=(6, 12))
    files = {gi.file_url(CYCLE, f, var): (ub if var == "vozocrtx" else vb) for f in (6, 12) for var in gi.VARS}
    sink = pub.LocalSink(tmp_path / "out")
    report = fsr.publish(gi.GiopsCurrentsSource(sp, session=_Datamart(files)), sink, pub._uploader(sink), log=print,
                         spec=sp, now=CYCLE + timedelta(hours=7))
    assert report["status"] == "published" and report["built"] == 2 and report["refused"] == 0
    rec = json.loads((tmp_path / "out" / fs.LATEST).read_text())["sets"][KEY]
    index = json.loads((tmp_path / "out" / rec["index"]).read_text())
    text = json.dumps(index, ensure_ascii=False)
    assert "Contains information licensed under the Open Government Licence – Canada." in text
    assert "Environment and Climate Change Canada" in text and "open-government-licence-canada" in text
    _h, f = fb.decode_plane((tmp_path / "out" / index["frames"][0]["path"]).read_bytes())
    assert set(f) == {fb.SPEED, fb.DIRECTION}
    assert np.nanmax(f[fb.SPEED]) == pytest.approx(0.5 * 3600 / 1852, abs=0.006)
    wet = np.isfinite(f[fb.SPEED])                         # direction has no no-data code (0 there): mask by speed
    assert wet.sum() > 0.8 * wet.size and (~wet).any()     # south of 80S and the land patch are no data
    assert np.allclose(f[fb.DIRECTION][wet], 90.0, atol=0.01)


@pytest.mark.parametrize("report, code", [
    ({"status": "published", "failed": 0}, 0),
    ({"status": "unchanged"}, 0),
    ({"status": "published", "failed": 1}, 1),            # strict: one failed frame is red
    ({"status": "no_cycle"}, 1),                          # strict: no complete run in the look-back is red
    ({"status": "coverage_refused"}, 1),
])
def test_strict_status_turns_the_run_red(report, code):
    assert script._status("currents_giops", report, strict=True) == code
    if report.get("status") in ("published", "no_cycle"):
        assert script._status("currents", report) == 0     # other sets keep their old rule


def test_the_run_states_its_size_pulled_and_kept(tmp_path, monkeypatch, capsys):
    """The advisor's condition: every run says how many MB it pulled from the Datamart and kept in the bucket."""
    monkeypatch.setenv("FRAME_RASTER_CURRENTS_GIOPS", "1")
    u = np.full((gi.SRC_ROWS, gi.SRC_COLS), 0.3)
    ub = _nc_bytes(tmp_path, "vozocrtx", u)
    vb = _nc_bytes(tmp_path, "vomecrty", np.zeros_like(u))
    sp = fsr.SPECS["currents_giops"]
    files = {gi.file_url(CYCLE, f, var): (ub if var == "vozocrtx" else vb) for f in sp["hours"] for var in gi.VARS}
    dm = _Datamart(files)
    monkeypatch.setattr(fsr, "make_source", lambda spec, session=None: gi.GiopsCurrentsSource(spec, session=dm))
    done = {"status": "published", "failed": 0, "bytes": 2_500_000}
    monkeypatch.setattr(fsr, "publish", lambda source, *a, **k: (source.fetch(CYCLE, 6), done)[1])
    assert script.main(["--set", "currents_giops", "--out-dir", str(tmp_path / "o")]) == 0
    out = capsys.readouterr().out
    pulled = len(ub) + len(vb)
    assert f"pulled {pulled / 1e6:.1f} MB, kept 2.5 MB" in out and f'"bytes_pulled": {pulled}' in out

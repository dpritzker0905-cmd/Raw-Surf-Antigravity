"""Gusts raster set (2026-11-15): services/frame_set_raster.py SPECS['gust'].

Offline only (fake source, LocalSink, no network, no pygrib). Pins the contract the client reads (ownRasterFrames.js 'gusts'):
the set key GFS/weather/gust/global_0p25, field 4 `speed` in KNOTS (the wind layer's unit), pressure's hours, the selector
(GUST:surface, the instantaneous message, f000's "anl" included), m/s -> kn conversion, the physical-range guard, and the
pilots-workflow step gated on FRAME_RASTER_GUST == '1' with its own timeout and budget.
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

CYCLE = datetime(2026, 11, 15, 6, tzinfo=timezone.utc)
LAT25 = 90.0 - 0.25 * np.arange(721)
LON25 = 0.25 * np.arange(1440)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("FRAME_RASTER_GUST", "FRAME_RASTER_BUDGET_S", "FRAME_MIN_COVERAGE", "FRAME_RASTER_ONE_BYTE"):
        monkeypatch.delenv(k, raising=False)


def test_the_gust_set_has_the_agreed_key_grid_hours_field_and_source():
    sp = fsr.spec_for("gust")
    assert fs.set_key(sp["target"]) == "GFS/weather/gust/global_0p25"
    assert (sp["env"], sp["field"], fsr.grid_of(sp)["cols"], tuple(sp["hours"]), sp["source"], sp["idx"]) == \
        ("FRAME_RASTER_GUST", fb.SPEED, 1440, fsr.PRESSURE_HOURS, "gfs", ("GUST", "surface"))
    assert sp["value_unit"] == "kn" and sp["credit"] and sp["source_url"].startswith("https://")


def test_the_gust_set_is_dark_until_its_variable_is_1(monkeypatch, capsys):
    assert fsr.SPECS["gust"]["default_on"] is False and not fsr.enabled("gust")
    assert script.main(["--set", "gust", "--out-dir", "unused"]) == 0 and "skipped" in capsys.readouterr().out
    monkeypatch.setenv("FRAME_RASTER_GUST", "1")
    assert fsr.enabled("gust")


def test_the_pilots_workflow_has_one_dark_gust_step_with_its_own_timeout_and_budget():
    yml = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    steps = [s for s in yml.split("\n      - name: ")[1:] if "--set gust\n" in s + "\n"]
    assert len(steps) == 1
    step = steps[0]
    assert "vars.FRAME_IMAGES_PUBLISH == '1' && vars.FRAME_RASTER_GUST == '1'" in step
    assert "FRAME_RASTER_GUST: ${{ vars.FRAME_RASTER_GUST }}" in step and "continue-on-error: true" in step
    assert "timeout-minutes: 15" in step and 'FRAME_RASTER_BUDGET_S: "540"' in step
    assert "FRAME_RASTER_ONE_BYTE: ${{ vars.FRAME_RASTER_ONE_BYTE }}" in step   # lever A kill reaches the step


def test_ms_to_knots_is_exact():
    assert fsr.SPECS["gust"]["convert"](np.array([1.0]))[0] == pytest.approx(1.9438444924, abs=1e-9)
    assert fsr.SPECS["gust"]["convert"](np.array([25.72]))[0] == pytest.approx(49.996, abs=1e-3)


def test_the_selector_takes_the_instantaneous_surface_gust_including_the_analysis():
    for when in ("anl", "3 hour fcst", "336 hour fcst"):
        rows = fsr.idx_rows(f"13:0:d=2026111506:PRATE:surface:0-3 hour ave fcst:\n"
                            f"14:100:d=2026111506:GUST:surface:{when}:\n"
                            f"15:200:d=2026111506:UGRD:10 m above ground:{when}:\n")
        assert fsr.select_message(rows, fsr.SPECS["gust"]["idx"]) == (100, 199)


class _Grib:
    def __init__(self, fn):
        self.fn = fn

    def complete_cycle(self, now):
        return CYCLE

    def url(self, cycle, f):
        return f"https://example.invalid/f{f:03d}"

    def fetch(self, cycle, f):
        return self.fn(f)


def _gust_kn(f):
    ms = 3.0 + 25.0 * np.abs(np.sin(np.radians(LAT25)[:, None] * 2 + np.radians(LON25)[None, :] + f))
    ms[10, 10], ms[11, 11] = -1.0, 200.0                        # -1.9 kn and 389 kn: outside 0..250 kn -> no data
    return fsr.SPECS["gust"]["convert"](ms)


@pytest.mark.parametrize("one_byte,fid,name", [("1", fb.GUST_KN_BAND, "gust_kn_band"), ("0", fb.SPEED, "speed")])
def test_gust_frames_carry_knots_on_the_quarter_degree_grid(tmp_path, monkeypatch, one_byte, fid, name):
    """Lever A (log section 12): the one-byte band field by default; FRAME_RASTER_ONE_BYTE=0 (the kill) publishes field 4."""
    monkeypatch.setenv("FRAME_RASTER_ONE_BYTE", one_byte)
    sp = dict(fsr.SPECS["gust"], hours=(0, 1, 2))
    sink = pub.LocalSink(tmp_path)
    report = fsr.publish(_Grib(_gust_kn), sink, pub._uploader(sink), log=lambda *_: None, spec=sp)
    assert report["status"] == "published" and report["built"] == 3 and report["saturated_cells"] == 0
    rec = json.loads((tmp_path / fs.LATEST).read_text())["sets"]["GFS/weather/gust/global_0p25"]
    index = json.loads((tmp_path / rec["index"]).read_text())
    assert index["grid"]["cols"] == 1440 and index["grid"]["rows"] == 721
    assert index["quantisation"] == {name: {"tolerance": fb.TOLERANCE[fid]}}
    assert ("band_encoding" in index) == (one_byte == "1")
    assert index["common_meta"]["value_unit"] == "kn" and index["common_meta"]["value_kind"] == "wind_gust_surface"
    _head, fields = fb.decode_plane((tmp_path / index["frames"][1]["path"]).read_bytes())
    assert set(fields) == {fid}
    want = fsr.to_frame_plane(_gust_kn(1), sp["valid"], None, 1)
    got = fields[fid]
    assert np.isnan(want).sum() == 2 and np.array_equal(np.isnan(got), np.isnan(want))
    assert np.nanmax(np.abs(got - want)) <= fb.TOLERANCE[fid]


# ── per-model gusts (2026-11-15, the owner: each model's own gust from its own GRIB) ──────────────────────────────────────────
@pytest.mark.parametrize("name,key,env,idx,source,first,last,n", [
    ("gust_euro", "EURO/weather/gust/global_0p25", "FRAME_RASTER_GUST_EURO", ("10fg", "sfc"), "ecmwf", 3, 240, 64),
    ("gust_icon", "ICON/weather/gust/global_0p25", "FRAME_RASTER_GUST_ICON", ("vmax_10m", ("VMAX_10M",)), "icon_grid", 1, 180, 112),
])
def test_per_model_gust_sets(name, key, env, idx, source, first, last, n, monkeypatch):
    sp = fsr.spec_for(name)
    assert fs.set_key(sp["target"]) == key and sp["field"] == fb.SPEED and fsr.grid_of(sp)["cols"] == 1440
    assert (sp["env"], sp["idx"], sp["source"], sp["value_unit"]) == (env, idx, source, "kn")
    assert (sp["hours"][0], sp["hours"][-1], len(sp["hours"])) == (first, last, n)
    assert sp["default_on"] is False and not fsr.enabled(name)
    monkeypatch.setenv(env, "1")
    assert fsr.enabled(name)
    assert sp["convert"](np.array([10.0]))[0] == pytest.approx(19.438444924)
    yml = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    steps = [s for s in yml.split("\n      - name: ")[1:] if f"--set {name}\n" in s + "\n"]
    assert len(steps) == 1 and f"vars.FRAME_IMAGES_PUBLISH == '1' && vars.{env} == '1'" in steps[0]
    assert "continue-on-error: true" in steps[0] and "timeout-minutes:" in steps[0]


def test_icon_grid_source_takes_the_nearest_cell_on_the_quarter_degree_lattice():
    from services import frame_set_raster_sources as srcs
    # four native cells: two in the box of node (lat 10.0, lon 20.0), one exactly on it; one in the box of (10.0, 20.25)
    clat = np.array([10.0, 10.1, 10.0, -89.99])
    clon = np.array([20.0, 20.05, 20.26, 0.0])
    lattice = (721, 1440)
    node, _ = srcs.box_assignment(clat, clon, lattice)
    pick = srcs.nearest_pick(clat, clon, node, lattice)
    r, c = round((10.0 + 90) / 0.25), round((20.0 + 180) / 0.25)
    assert pick[r * 1440 + c] == 0 and pick[r * 1440 + c + 1] == 2
    plane = srcs.nearest_plane(np.array([5.0, 9.0, 7.0, 1.0]), pick, lattice)
    assert plane.shape == lattice and plane[r, c] == 5.0 and plane[r, c + 1] == 7.0
    assert isinstance(fsr.make_source(fsr.SPECS["gust_icon"], session=object()), srcs.IconGridSource)

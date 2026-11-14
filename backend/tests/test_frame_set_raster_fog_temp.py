"""Fog, water temperature and per-model air temperature raster sets (2026-11-14): services/frame_set_raster.py SPECS.

Offline only (fake sources, LocalSink, no network, no pygrib). Pins the contract sent to the client (move-3 lane): the set keys,
grids and hours; field 11 visibility_m (u16, 1 m, code 0 = no data, 0..65534 m) and field 7 temp_c reused for skin temperature;
each set DARK until its own repo variable is '1', with a pilots-workflow step gated on exactly that; the source selectors
(GFS VIS / TMP:surface, ECMWF 2t / skt, DWD T_2M); unit conversion and the physical-range guard (out of range = no data).
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
from services import frame_set_raster_sources as srcs  # noqa: E402

CYCLE = datetime(2026, 11, 13, 0, tzinfo=timezone.utc)
EURO_STEPS = tuple(range(0, 145, 3)) + tuple(range(150, 241, 6))
NEW = {   # set -> (key, env, field, grid cols, hours, source, idx)
    "fog": ("GFS/weather/fog/global_0p25", "FRAME_RASTER_FOG", fb.VISIBILITY_M, 1440, fsr.PRESSURE_HOURS, "gfs", ("VIS", "surface")),
    "water_temp": ("GFS/weather/water_temp/global_0p25", "FRAME_RASTER_WATER_TEMP", fb.TEMP_C, 1440, fsr.F_HOURS, "gfs",
                   ("TMP", "surface")),
    "temperature_euro": ("EURO/weather/temperature/global_0p5", "FRAME_RASTER_TEMPERATURE_EURO", fb.TEMP_C, 720, EURO_STEPS,
                         "ecmwf", ("2t", "sfc")),
    "temperature_icon": ("ICON/weather/temperature/global_0p5", "FRAME_RASTER_TEMPERATURE_ICON", fb.TEMP_C, 720,
                         tuple(range(0, 181, 3)), "icon", ("t_2m", ("T_2M",))),
    "water_temp_euro": ("EURO/weather/water_temp/global_0p25", "FRAME_RASTER_WATER_TEMP_EURO", fb.TEMP_C, 1440, EURO_STEPS,
                        "ecmwf", ("skt", "sfc")),
}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for name in NEW:
        monkeypatch.delenv(NEW[name][1], raising=False)
    for k in ("FRAME_RASTER_BUDGET_S", "FRAME_MIN_COVERAGE"):
        monkeypatch.delenv(k, raising=False)


@pytest.mark.parametrize("name", sorted(NEW))
def test_each_set_has_the_agreed_key_grid_hours_field_and_source(name):
    key, env, field, cols, hours, source, idx = NEW[name]
    sp = fsr.spec_for(name)
    assert fs.set_key(sp["target"]) == key
    assert (sp["env"], sp["field"], fsr.grid_of(sp)["cols"], tuple(sp["hours"]), sp["source"], sp["idx"]) == \
        (env, field, cols, hours, source, idx)
    assert sp["credit"] and sp["license"] and sp["source_url"].startswith("https://")


@pytest.mark.parametrize("name", sorted(NEW))
def test_each_set_is_dark_until_its_own_variable_is_1(name, monkeypatch, capsys):
    assert fsr.SPECS[name]["default_on"] is False and not fsr.enabled(name)
    assert script.main(["--set", name, "--out-dir", "unused"]) == 0 and "skipped" in capsys.readouterr().out
    monkeypatch.setenv(NEW[name][1], "0")
    assert not fsr.enabled(name)
    monkeypatch.setenv(NEW[name][1], "1")
    assert fsr.enabled(name)


@pytest.mark.parametrize("name", sorted(NEW))
def test_the_pilots_workflow_has_a_dark_step_per_set(name):
    yml = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    env = NEW[name][1]
    steps = [s for s in yml.split("\n      - name: ")[1:] if f"--set {name}\n" in s + "\n"]
    assert len(steps) == 1, name
    step = steps[0]
    assert f"vars.FRAME_IMAGES_PUBLISH == '1' && vars.{env} == '1'" in step        # unset -> the step never runs
    assert f"{env}: ${{{{ vars.{env} }}}}" in step and "continue-on-error: true" in step


def test_visibility_field_is_u16_metres_with_code_0_for_no_data():
    assert fb.FIELD_NAMES[fb.VISIBILITY_M] == "visibility_m" and fb.VISIBILITY_M == 11
    assert fb.FIELD_SPECS[fb.VISIBILITY_M] == (2, 1, 0, 1.0, -1.0)
    assert fb.TOLERANCE[fb.VISIBILITY_M] == pytest.approx(0.5)
    plane = np.array([[0.0, 0.4, 24135.0], [65534.0, np.nan, 1234.6]])
    raw = fb.encode_plane(plane, (-1.0, -1.0, 1.0, 0.0), "2026-11-13T00:00:00Z", "2026-11-13T00:00:00Z", fb.VISIBILITY_M)
    _head, fields = fb.decode_plane(raw)
    got = fields[fb.VISIBILITY_M]
    assert np.isnan(got[1, 1]) and np.nanmax(np.abs(got - plane)) <= 0.5
    assert list(got[0]) == [0.0, 0.0, 24135.0] and got[1, 2] == 1235.0
    with pytest.raises(ValueError, match="outside"):
        fb.encode_plane(np.array([[0.0, 65535.0]]), (0.0, 0.0, 1.0, 0.0), "2026-11-13T00:00:00Z", None, fb.VISIBILITY_M)


LAT25 = 90.0 - 0.25 * np.arange(721)
LON25 = 0.25 * np.arange(1440)


class _Grib:
    """A GFS-order (721, 1440) field already in the frame's unit (what a GfsGribSource.fetch returns after `convert`)."""

    def __init__(self, fn):
        self.fn = fn

    def complete_cycle(self, now):
        return CYCLE

    def url(self, cycle, f):
        return f"https://example.invalid/f{f:03d}"

    def fetch(self, cycle, f):
        return self.fn(f)


def _vis(f):
    a = np.clip(24135.0 * (0.5 + 0.5 * np.sin(np.radians(LAT25)[:, None] * 3 + np.radians(LON25)[None, :] + f)), 0.0, 24135.0)
    a[10, 10], a[11, 11] = -5.0, 70000.0                       # outside 0..65534: no data, never a code
    return a


def _skin_k(f):
    return 271.0 + 30.0 * np.cos(np.radians(LAT25))[:, None] + 0.0 * LON25[None, :] + f * 0.01


def _publish(out, name, fn, hours=(0, 3, 6)):
    sp = dict(fsr.SPECS[name], hours=hours)                    # three hours keep the 0.25-degree test fast
    sink = pub.LocalSink(out)
    report = fsr.publish(_Grib(fn), sink, pub._uploader(sink), log=lambda *_: None, spec=sp)
    rec = json.loads((out / fs.LATEST).read_text())["sets"][fs.set_key(sp["target"])]
    return report, json.loads((out / rec["index"]).read_text())


def test_fog_frames_carry_visibility_on_the_quarter_degree_grid(tmp_path):
    report, index = _publish(tmp_path / "f", "fog", _vis)
    assert report["status"] == "published" and report["built"] == 3
    assert index["set"] == "GFS/weather/fog/global_0p25" and index["grid"]["cols"] == 1440 and index["grid"]["rows"] == 721
    assert index["quantisation"] == {"visibility_m": {"tolerance": fb.TOLERANCE[fb.VISIBILITY_M]}}
    assert index["common_meta"]["value_unit"] == "m" and index["common_meta"]["value_kind"] == "visibility"
    _head, fields = fb.decode_plane((tmp_path / "f" / index["frames"][1]["path"]).read_bytes())
    want = fsr.to_frame_plane(_vis(3), fsr.SPECS["fog"]["valid"], None, 1)
    got = fields[fb.VISIBILITY_M]
    assert np.isnan(want).sum() == 2 and np.array_equal(np.isnan(got), np.isnan(want))
    assert np.nanmax(np.abs(got - want)) <= 0.5


def test_water_temp_is_kelvin_to_degc_skin_temperature_in_field_7(tmp_path):
    sp = fsr.SPECS["water_temp"]
    report, index = _publish(tmp_path / "w", "water_temp", lambda f: sp["convert"](_skin_k(f)))
    assert report["status"] == "published"
    assert index["common_meta"]["value_kind"] == "skin_temperature" and index["quantisation"] == {"temp_c": {"tolerance": fb.TOLERANCE[fb.TEMP_C]}}
    _head, fields = fb.decode_plane((tmp_path / "w" / index["frames"][0]["path"]).read_bytes())
    got = fields[fb.TEMP_C]
    assert np.nanmax(got) == pytest.approx(301.0 - 273.15, abs=0.03) and np.nanmin(got) == pytest.approx(271.0 - 273.15, abs=0.03)
    assert np.isnan(fsr.to_frame_plane(sp["convert"](np.full((721, 1440), 400.0)), sp["valid"], None, 1)).all()   # 127 degC


@pytest.mark.parametrize("name,kelvin,degc", [("temperature_euro", 300.15, 27.0), ("temperature_icon", 250.15, -23.0),
                                              ("water_temp_euro", 290.15, 17.0)])
def test_model_temperatures_convert_kelvin_to_degc(name, kelvin, degc):
    assert fsr.SPECS[name]["convert"](np.array([kelvin]))[0] == pytest.approx(degc)


def test_the_ecmwf_selector_finds_2t_and_skt_as_forecast_messages():
    lines = [{"param": "2t", "levtype": "sfc", "type": "fc", "_offset": 10, "_length": 5},
             {"param": "skt", "levtype": "sfc", "type": "ef", "_offset": 20, "_length": 5},
             {"param": "skt", "levtype": "sfc", "type": "fc", "_offset": 30, "_length": 7}]
    text = "\n".join(json.dumps(x) for x in lines)
    assert srcs.index_entry(text, *fsr.SPECS["temperature_euro"]["idx"]) == (10, 5)
    assert srcs.index_entry(text, *fsr.SPECS["water_temp_euro"]["idx"]) == (30, 7)


def test_the_icon_temperature_url_is_dwd_t_2m():
    src = srcs.IconOpenDataSource(fsr.SPECS["temperature_icon"], session=object())
    assert src.url(CYCLE, 6) == ("https://opendata.dwd.de/weather/nwp/icon/grib/00/t_2m/"
                                 "icon_global_icosahedral_single-level_2026111300_006_T_2M.grib2.bz2")


def test_the_gfs_selector_takes_the_instantaneous_vis_and_skin_tmp():
    idx = ("1:0:d=2026111300:VIS:surface:6 hour fcst:\n"
           "2:100:d=2026111300:TMP:2 m above ground:6 hour fcst:\n"
           "3:200:d=2026111300:TMP:surface:6 hour fcst:\n"
           "4:300:d=2026111300:TMP:surface:0-6 hour ave fcst:\n")
    rows = fsr.idx_rows(idx)
    assert fsr.select_message(rows, fsr.SPECS["fog"]["idx"]) == (0, 99)
    assert fsr.select_message(rows, fsr.SPECS["water_temp"]["idx"]) == (200, 299)

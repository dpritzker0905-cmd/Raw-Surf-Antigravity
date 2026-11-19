"""G4 world set (2026-11-17): Copernicus ocean-model water temp at 1/6 degree, services/frame_set_raster_sst.py.

Offline only (an in-memory ARCO store, LocalSink, no network). Pins: the set key, switch, lattice and hours; every second
source cell taken as its own value (no mean); land and the south-of-80S rows as no data; the top-level check (the store's one
elevation must be -0.494 m); a published frame within the 0.025 degC tolerance of the source; the pilots-workflow step.
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
from services import frame_set_raster_sst as sst  # noqa: E402

CYCLE = datetime(2026, 11, 17, tzinfo=timezone.utc)
FILL = 9.969209968386869e36
ROWS, COLS = 2041, 4320


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("FRAME_RASTER_WATER_TEMP_CMEMS", "FRAME_RASTER_BUDGET_S", "FRAME_MIN_COVERAGE"):
        monkeypatch.delenv(k, raising=False)


def test_the_set_contract():
    sp = fsr.spec_for("water_temp_cmems")
    assert fs.set_key(sp["target"]) == "CMEMS/marine/water_temp/global_1p6"
    g = fsr.grid_of(sp)
    assert (g["cols"], g["rows"]) == (2160, 1021) and g["bounds"] == (-180.0, -80.0, 180.0 - 1 / 6, 90.0)
    assert sp["field"] == fb.TEMP_C and sp["frame_plane"] and sp["hours"] == tuple(range(0, 238, 3))
    assert sp["env"] == "FRAME_RASTER_WATER_TEMP_CMEMS" and sp["default_on"] is True and fsr.enabled("water_temp_cmems")
    assert "Copernicus Marine Service" in sp["credit"] and sp["value_unit"] == "degC"
    assert isinstance(fsr.make_source(sp, session=object()), sst.CmemsSstSource)


def test_on_by_default_and_the_kill_is_0(monkeypatch, capsys):
    """David 2026-11-17: new things start ON with a test and a kill switch. Unset or empty (an unset repo variable reaches the
    step as '') = on; '0' = off, the publisher skips the set."""
    for v in ("", "1"):
        monkeypatch.setenv("FRAME_RASTER_WATER_TEMP_CMEMS", v)
        assert fsr.enabled("water_temp_cmems")
    monkeypatch.setenv("FRAME_RASTER_WATER_TEMP_CMEMS", "0")
    assert not fsr.enabled("water_temp_cmems")
    assert script.main(["--set", "water_temp_cmems", "--out-dir", "unused"]) == 0 and "skipped" in capsys.readouterr().out


def test_every_second_cell_is_its_own_value():
    a = np.arange(ROWS * COLS, dtype=float).reshape(ROWS, COLS)
    out = sst.sixth(a)
    assert out.shape == (1021, 2160)
    assert out[0, 0] == a[0, 0] and out[1, 1] == a[2, 2] and out[-1, -1] == a[2040, 4318]   # no mean, no interpolation
    with pytest.raises(ValueError):
        sst.sixth(a[:-1])


def test_the_pilots_workflow_has_one_step_on_by_default_with_its_own_timeout_and_budget():
    yml = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    steps = [s for s in yml.split("\n      - name: ")[1:] if "--set water_temp_cmems\n" in s + "\n"]
    assert len(steps) == 1
    step = steps[0]
    assert "vars.FRAME_IMAGES_PUBLISH == '1' && (vars.FRAME_RASTER_WATER_TEMP_CMEMS || '1') != '0'" in step   # unset = on
    assert "continue-on-error: true" in step and "timeout-minutes: 20" in step and 'FRAME_RASTER_BUDGET_S: "900"' in step


class _Resp:
    def __init__(self, status, body=b"", js=None):
        self.status_code, self.content, self._js = status, body, js

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)

    def json(self):
        return self._js


class _Store:
    """An in-memory copy of the hourly-mean store: thetao [t, 1, 2041, 4320] in [1, 1, 512, 2048] blosc chunks."""

    def __init__(self, field, times_h, elevation=-0.494025):
        from numcodecs import Blosc
        self.codec = Blosc(cname="lz4", clevel=5, shuffle=1)
        self.comp = {"blocksize": 0, "clevel": 5, "cname": "lz4", "id": "blosc", "shuffle": 1}
        self.field, self.times, self.elevation = field, np.asarray(times_h, dtype="<f4"), elevation

    def get(self, url, timeout=None):
        name, key = url[len(sst.ARCO) + 1:].split("/")
        if key == ".zarray":
            if name == "thetao":
                return _Resp(200, js={"chunks": [1, 1, 512, 2048], "dtype": "<f4", "compressor": self.comp,
                                      "shape": [len(self.times), 1, ROWS, COLS]})
            n = len(self.times) if name == "time" else 1
            return _Resp(200, js={"chunks": [n], "dtype": "<f4", "compressor": self.comp, "shape": [n]})
        if name == "time":
            return _Resp(200, self.codec.encode(self.times.tobytes()))
        if name == "elevation":
            return _Resp(200, self.codec.encode(np.array([self.elevation], dtype="<f4").tobytes()))
        t, z, y, x = (int(k) for k in key.split("."))
        assert z == sst.SURFACE
        blk = np.full((512, 2048), FILL, dtype="<f4")
        src = self.field[y * 512:(y + 1) * 512, x * 2048:(x + 1) * 2048]
        blk[:src.shape[0], :src.shape[1]] = src
        return _Resp(200, self.codec.encode(blk.tobytes()))


def _field():
    lat = -80.0 + np.arange(ROWS)[:, None] / 12.0
    lon = -180.0 + np.arange(COLS)[None, :] / 12.0
    f = (28.0 - 0.33 * np.abs(lat) + 0.001 * lon).astype("<f4")   # -1.9 degC at the pole: seawater, inside `valid`
    f[1000:1100, 2000:2100] = FILL                                     # a block of land
    return f


def _store(**kw):
    from services.frame_set_raster_currents import EPOCH
    start = (CYCLE - EPOCH).total_seconds() / 3600 - 24
    return _Store(_field(), [start + k for k in range(24 + 240)], **kw)


def test_the_reader_takes_the_top_level_and_masks_land():
    src = sst.CmemsSstSource(fsr.SPECS["water_temp_cmems"], session=_store())
    assert src.complete_cycle(CYCLE + timedelta(hours=7)) == CYCLE
    got = src.fetch(CYCLE, 3)
    f = _field()
    assert got[600, 1500] == pytest.approx(float(f[1200, 3000]))
    assert np.isnan(got[525, 1025])                                    # source (1050, 2050): land
    bad = sst.CmemsSstSource(fsr.SPECS["water_temp_cmems"], session=_store(elevation=-5.0))
    assert bad.complete_cycle(CYCLE + timedelta(hours=7)) is None      # not the top level: no cycle, nothing published


def test_a_published_frame_is_within_tolerance_of_the_source(tmp_path):
    sp = dict(fsr.SPECS["water_temp_cmems"], hours=(0, 3))
    sink = pub.LocalSink(tmp_path)
    report = fsr.publish(sst.CmemsSstSource(sp, session=_store()), sink, pub._uploader(sink), log=print, spec=sp,
                         now=CYCLE + timedelta(hours=7))
    assert report["status"] == "published" and report["built"] == 2 and report["refused"] == 0
    rec = json.loads((tmp_path / fs.LATEST).read_text())["sets"]["CMEMS/marine/water_temp/global_1p6"]
    index = json.loads((tmp_path / rec["index"]).read_text())
    assert index["grid"]["cols"] == 2160 and index["grid"]["rows"] == 1021
    _h, f = fb.decode_plane((tmp_path / index["frames"][1]["path"]).read_bytes())
    want = sst.sixth(np.where(np.abs(_field()) < 1e30, _field(), np.nan).astype(float))
    got = f[fb.TEMP_C]
    assert np.array_equal(np.isnan(got), np.isnan(want))
    assert np.nanmax(np.abs(got - want)) <= fb.TOLERANCE[fb.TEMP_C]

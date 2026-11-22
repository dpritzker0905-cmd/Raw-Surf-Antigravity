"""Ocean surface currents raster set (2026-11-15): services/frame_set_raster_currents.py + SPECS['currents'].

Offline only (fake HTTP / fake source, LocalSink, no network). Pins: the set key and switch; the two-field wind-frame layout
(field 4 speed kn + field 1 direction TOWARD, uv_convention 1) and encode_planes' byte-identity with encode_plane for one
field; the 3 x 3 vector mean onto the 0.25-degree lattice (alignment, land ignored, south of 80S no data, antimeridian wrap);
the ARCO chunk reader (land fill masked, the surface level checked); the pilots-workflow step.
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
from services import frame_set_raster_currents as cur  # noqa: E402

CYCLE = datetime(2026, 11, 15, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("FRAME_RASTER_CURRENTS", "FRAME_RASTER_BUDGET_S", "FRAME_MIN_COVERAGE", "FRAME_RASTER_ONE_BYTE", "FRAME_RASTER_DIR_BYTE"):
        monkeypatch.delenv(k, raising=False)


def test_the_currents_set_contract():
    sp = fsr.spec_for("currents")
    assert fs.set_key(sp["target"]) == "CMEMS/marine/currents/global_0p25"
    assert sp["fields"] == (fb.SPEED, fb.DIRECTION) and sp["field"] == fb.SPEED and sp["uv_convention"] == 1
    assert tuple(sp["hours"]) == tuple(range(0, 241, 6)) and fsr.grid_of(sp)["cols"] == 1440
    assert sp["env"] == "FRAME_RASTER_CURRENTS" and sp["default_on"] is False and not fsr.enabled("currents")
    assert "Copernicus Marine Service" in sp["credit"] and sp["value_unit"] == "kn"
    assert isinstance(fsr.make_source(sp, session=object()), cur.CmemsCurrentsSource)


def test_dark_until_its_variable_is_1(monkeypatch, capsys):
    assert script.main(["--set", "currents", "--out-dir", "unused"]) == 0 and "skipped" in capsys.readouterr().out
    monkeypatch.setenv("FRAME_RASTER_CURRENTS", "1")
    assert fsr.enabled("currents")


def test_the_pilots_workflow_has_one_dark_currents_step_with_its_own_timeout_and_budget():
    yml = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    steps = [s for s in yml.split("\n      - name: ")[1:] if "--set currents\n" in s + "\n"]
    assert len(steps) == 1
    step = steps[0]
    assert "vars.FRAME_IMAGES_PUBLISH == '1' && vars.FRAME_RASTER_CURRENTS == '1'" in step
    assert "continue-on-error: true" in step and "timeout-minutes: 15" in step and 'FRAME_RASTER_BUDGET_S: "600"' in step
    assert "FRAME_RASTER_ONE_BYTE: ${{ vars.FRAME_RASTER_ONE_BYTE }}" in step


def test_encode_planes_is_encode_plane_for_one_field():
    a = np.array([[0.0, 1.25, np.nan], [24.0, 0.01, 3.0]])
    args = ((-1.0, -1.0, 1.0, 0.0), "2026-11-15T00:00:00Z", "2026-11-15T00:00:00Z")
    assert fb.encode_planes({fb.SPEED: a}, *args) == fb.encode_plane(a, *args, fb.SPEED)


def test_two_field_frame_round_trips_with_direction_toward_and_convention_1():
    spd = np.array([[1.0, np.nan], [2.5, 0.0]])
    to = np.array([[90.0, np.nan], [359.99, 0.0]])
    raw = fb.encode_planes({fb.SPEED: spd, fb.DIRECTION: to}, (0.0, 0.0, 1.0, 1.0), "2026-11-15T00:00:00Z", None, uv_convention=1)
    assert raw[19] == 1 and raw[18] == 2
    _h, f = fb.decode_plane(raw)
    assert np.isnan(f[fb.SPEED][0, 1]) and f[fb.DIRECTION][0, 1] == 0.0          # direction has no no-data code: 0 there
    assert np.nanmax(np.abs(f[fb.SPEED] - spd)) <= fb.TOLERANCE[fb.SPEED]
    assert abs(f[fb.DIRECTION][1, 0] - 359.99) <= fb.TOLERANCE[fb.DIRECTION]


def test_speed_and_direction_toward():
    s, d = cur.speed_direction(np.array([1.0, 0.0, -1.0, 0.0]), np.array([0.0, 1.0, 0.0, -1.0]))
    assert np.allclose(s, cur.KN_PER_MS) and np.allclose(d, [90.0, 0.0, 270.0, 180.0])   # eastward water flows TOWARD 90


def _src(fn):
    lat = -80.0 + np.arange(cur.SRC_ROWS) / 12.0
    lon = -180.0 + np.arange(cur.SRC_COLS) / 12.0
    return fn(lat[:, None], lon[None, :])


def test_regrid_aligns_nodes_on_every_third_source_cell():
    a = _src(lambda la, lo: la + 0.0 * lo)
    out = cur.regrid_quarter(a)
    lat = -90.0 + 0.25 * np.arange(721)
    assert np.isnan(out[:40]).all()                                   # south of 80S: no source rows
    assert np.allclose(out[41:720, 5], lat[41:720])                   # a 3 x 3 mean of a linear field = the centre value
    b = _src(lambda la, lo: lo + 0.0 * la)
    assert np.allclose(cur.regrid_quarter(b)[400, 1:1439], -180.0 + 0.25 * np.arange(1, 1439))


def test_regrid_ignores_land_and_wraps_the_antimeridian():
    a = np.full((cur.SRC_ROWS, cur.SRC_COLS), np.nan)
    j = 3 * 400 - 120                                                 # the source row of lattice row 400
    a[j, cur.SRC_COLS - 1] = 2.0                                      # one ocean cell just WEST of 180 (lon 179.917)
    out = cur.regrid_quarter(a)
    assert out[400, 0] == 2.0 and np.isnan(out[400, 1])               # node 180W takes it (wrap); its neighbour has none
    a[j + 1, 0] = 4.0
    assert cur.regrid_quarter(a)[400, 0] == 3.0                       # the mean of the ocean cells only


class _Resp:
    def __init__(self, status, body=b"", js=None):
        self.status_code, self.content, self._js = status, body, js

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)

    def json(self):
        return self._js


class _Http:
    """An in-memory ARCO store: chunk [1, 1, 512, 2048] blosc float32, as the real one."""

    def __init__(self, uo, vo, times_h):
        from numcodecs import Blosc
        self.codec = Blosc(cname="lz4", clevel=5, shuffle=1)
        self.comp = {"blocksize": 0, "clevel": 5, "cname": "lz4", "id": "blosc", "shuffle": 1}
        self.fields = {"uo": uo, "vo": vo}
        self.times = np.asarray(times_h, dtype="<f4")
        self.gets = 0

    def get(self, url, timeout=None):
        self.gets += 1
        name, key = url[len(cur.ARCO) + 1:].split("/")
        if key == ".zarray":
            if name in ("uo", "vo"):
                return _Resp(200, js={"chunks": [1, 1, 512, 2048], "dtype": "<f4", "compressor": self.comp,
                                      "shape": [len(self.times), 50, cur.SRC_ROWS, cur.SRC_COLS]})
            n = len(self.times) if name == "time" else 50
            return _Resp(200, js={"chunks": [n], "dtype": "<f4", "compressor": self.comp, "shape": [n]})
        if name == "time":
            return _Resp(200, self.codec.encode(self.times.tobytes()))
        if name == "elevation":
            el = np.linspace(-5000.0, -0.494, 50).astype("<f4")
            return _Resp(200, self.codec.encode(el.tobytes()))
        t, z, y, x = (int(k) for k in key.split("."))
        assert z == cur.SURFACE
        blk = np.full((512, 2048), 9.969209968386869e36, dtype="<f4")
        src = self.fields[name][y * 512:(y + 1) * 512, x * 2048:(x + 1) * 2048]
        blk[:src.shape[0], :src.shape[1]] = src
        return _Resp(200, self.codec.encode(blk.tobytes()))


def _store(n_days=11):
    land = np.full((cur.SRC_ROWS, cur.SRC_COLS), 9.969209968386869e36, dtype="<f4")
    uo, vo = land.copy(), land.copy()
    uo[1200:1300, :] = 0.5                                            # an eastward jet (about 0.97 kn)
    vo[1200:1300, :] = 0.0
    h0 = (CYCLE - cur.EPOCH).total_seconds() / 3600 - 24
    return _Http(uo, vo, [h0 + 6 * k for k in range(4 * n_days + 5)])


def test_the_reader_masks_land_and_builds_speed_and_direction():
    http = _store()
    src = cur.CmemsCurrentsSource(fsr.SPECS["currents"], session=http)
    assert src.complete_cycle(CYCLE + timedelta(hours=7)) == CYCLE
    got = src.fetch(CYCLE, 6)
    r = round((-80.0 + 1250 / 12.0 + 90.0) / 0.25)
    assert got[fb.SPEED][r, 100] == pytest.approx(0.5 * cur.KN_PER_MS, abs=1e-4) and got[fb.DIRECTION][r, 100] == pytest.approx(90.0)
    assert np.isnan(got[fb.SPEED][100, 100])                          # land fill -> no data


def test_no_cycle_when_the_bulletin_is_short():
    src = cur.CmemsCurrentsSource(fsr.SPECS["currents"], session=_store(n_days=5))
    assert src.complete_cycle(CYCLE) is None


@pytest.mark.parametrize("one_byte,dir_byte", [("1", "1"), ("1", "0"), ("0", "1")])
def test_a_published_currents_frame(tmp_path, monkeypatch, one_byte, dir_byte):
    """Lever A: by default the band speed (0.02 kn) + the one-byte flow direction (the Currents particles, 2026-11-22); its kill
    (FRAME_RASTER_DIR_BYTE=0) the band speed alone; lever A's kill (FRAME_RASTER_ONE_BYTE=0) the old speed + direction."""
    monkeypatch.setenv("FRAME_RASTER_ONE_BYTE", one_byte)
    monkeypatch.setenv("FRAME_RASTER_DIR_BYTE", dir_byte)
    sp = dict(fsr.SPECS["currents"], hours=(0, 6))
    http = _store()
    sink = pub.LocalSink(tmp_path)
    report = fsr.publish(cur.CmemsCurrentsSource(sp, session=http), sink, pub._uploader(sink), log=print, spec=sp,
                         now=CYCLE + timedelta(hours=7))
    assert report["status"] == "published" and report["built"] == 2 and report["refused"] == 0
    rec = json.loads((tmp_path / fs.LATEST).read_text())["sets"]["CMEMS/marine/currents/global_0p25"]
    index = json.loads((tmp_path / rec["index"]).read_text())
    raw = (tmp_path / index["frames"][1]["path"]).read_bytes()
    _h, f = fb.decode_plane(raw)
    if one_byte == "1":
        assert set(f) == ({fb.CURRENT_KN_BAND, fb.FLOW_DIR_BYTE} if dir_byte == "1" else {fb.CURRENT_KN_BAND})
        assert np.nanmax(f[fb.CURRENT_KN_BAND]) == pytest.approx(0.5 * cur.KN_PER_MS, abs=0.01)
        if dir_byte == "1":   # the eastward jet flows TOWARD 90 deg, written at the anchor cells (even row, even column)
            jet = np.isfinite(f[fb.CURRENT_KN_BAND]) & (f[fb.CURRENT_KN_BAND] > 0.5)
            anchor = np.zeros(jet.shape, dtype=bool)
            anchor[::fb.FLOW_DIR_STRIDE, ::fb.FLOW_DIR_STRIDE] = True
            assert (jet & anchor).any() and np.allclose(f[fb.FLOW_DIR_BYTE][jet & anchor], 90.0)
            assert not f[fb.FLOW_DIR_BYTE][~anchor].any()
    else:
        assert set(f) == {fb.SPEED, fb.DIRECTION}
        assert np.nanmax(f[fb.SPEED]) == pytest.approx(0.5 * cur.KN_PER_MS, abs=0.006)


def test_the_one_byte_flow_direction_wraps_on_the_circle_and_round_trips():
    """FLOW_DIR_BYTE: code = round(d / 1.40625) mod 256, so 359.5 deg stores as 0 deg (0.5 deg away on the circle, never 358.6);
    every direction decodes within half a step on the circle; NaN (no data) writes code 0, its validity on the speed band."""
    d = np.array([[0.0, 90.0, 180.0, 359.5, 359.2, 0.7, 271.3, np.nan]])
    s = np.where(np.isfinite(d), 1.0, np.nan)
    raw = fb.encode_planes({fb.CURRENT_KN_BAND: s, fb.FLOW_DIR_BYTE: d}, (0.0, 0.0, 7.0, 0.0), "2026-11-22T00:00:00Z",
                           "2026-11-22T00:00:00Z", uv_convention=1)
    _h, f = fb.decode_plane(raw)
    got = f[fb.FLOW_DIR_BYTE][0]
    ok = np.isfinite(d[0])
    err = np.abs(got[ok] - d[0][ok])
    err = np.minimum(err, 360.0 - err)
    assert err.max() <= fb.TOLERANCE[fb.FLOW_DIR_BYTE]
    assert got[3] == 0.0 and got[-1] == 0.0
    assert fb.FIELD_SPECS[fb.FLOW_DIR_BYTE][0] == 1 and fb.FLOW_DIR_BYTE in fb.CIRCULAR_FIELDS


def test_the_currents_step_carries_the_direction_kill():
    wf = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    step = wf.split("--set currents")[0].rsplit("- name:", 1)[1]
    assert "FRAME_RASTER_DIR_BYTE: ${{ vars.FRAME_RASTER_DIR_BYTE }}" in step


def test_flow_dir_anchors_is_the_block_vector_mean_in_64_steps():
    """One direction per 2 x 2 block at its south-west cell: the VECTOR mean of the block's water (opposed flows cancel to the
    remainder), in 5.625-deg steps; an anchor over land keeps its block's direction; a block of land is 0; elsewhere 0."""
    nan = np.nan
    speed = np.array([[1.0, 1.0, nan, nan, 2.0],
                      [nan, 1.0, nan, nan, 2.0],
                      [1.0, 1.0, 1.0, 1.0, nan]])
    dirn = np.array([[90.0, 270.0, 0.0, 0.0, 10.0],
                     [0.0, 90.0, 0.0, 0.0, 10.0],
                     [44.0, 46.0, 180.0, 180.0, 0.0]])
    out = fb.flow_dir_anchors(speed, dirn)
    assert out.shape == speed.shape
    assert out[0, 0] == 90.0                         # (+1 - 1 + 1) east
    assert out[0, 2] == 0.0                          # an all-land block
    assert out[0, 4] == pytest.approx(11.25)         # 10 deg -> the nearest 5.625-deg step
    assert out[2, 0] == 45.0 and out[2, 2] == 180.0  # the last (half) row of blocks
    mask = np.ones(out.shape, dtype=bool)
    mask[::2, ::2] = False
    assert not out[mask].any()
    assert set(np.unique(np.round(out / (360 / fb.FLOW_DIR_LEVELS), 9) % 1)) == {0.0}

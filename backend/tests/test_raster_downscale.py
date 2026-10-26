"""The air-temperature downscale's elevation-difference asset (services/raster_downscale.py, scripts/publish_temp_downscale.py).

The owner, 2026-10-25: "Go with your recommendation if that is state of the art" (temperature at 0.5 deg plus lapse-rate
downscaling). Measured against METAR at 31 airports: mountain MAE 2.87 -> 2.07 C with -6.5 K/km
(log 2026-10-25-claude-raster-temp-downscale)."""
import gzip
import json
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
import publish_temp_downscale as script  # noqa: E402
from services import raster_downscale as rd  # noqa: E402


def _dods(values, lat, lon, kind="Float32"):
    """A minimal ERDDAP binary DAP2 response for one latitude x longitude grid."""
    ny, nx = values.shape
    head = (f"Dataset {{\n  GRID {{\n    ARRAY:\n      {kind} z[latitude = {ny}][longitude = {nx}];\n    MAPS:\n"
            f"      Float64 latitude[latitude = {ny}];\n      Float64 longitude[longitude = {nx}];\n  }} z;\n}} x;\n\nData:\n").encode()
    n = ny * nx
    body = struct.pack(">II", n, n)
    if kind == "Float32":
        body += values.astype(">f4").tobytes()
    else:                                                   # Int16 travels as Int32
        body += values.astype(">i4").tobytes()
    for m in (lat, lon):
        body += struct.pack(">II", len(m), len(m)) + np.asarray(m, dtype=">f8").tobytes()
    return head + body


def _frame_terrain():
    """A 0.5-deg terrain plane (361 x 720, south first, 180W first): a smooth ridge, plus a known node value."""
    lat = -90 + 0.5 * np.arange(361)[:, None]
    lon = -180 + 0.5 * np.arange(720)[None, :]
    z = 1000.0 * np.exp(-((lat - 46) ** 2 + (lon - 8) ** 2) / 50.0) + 0 * lon
    return z


@pytest.mark.parametrize("kind", ["Float32", "Int16"])
def test_the_dap2_grid_parses_values_and_both_maps(kind):
    vals = np.array([[1.0, -2.0, 3.0], [4.0, 5.0, -6.0]])
    v, lat, lon = rd.parse_dods_grid(_dods(vals, [-1.0, 1.0], [10.0, 11.0, 12.0], kind))
    assert np.allclose(v, vals) and np.allclose(lat, [-1, 1]) and np.allclose(lon, [10, 11, 12])
    with pytest.raises(ValueError):
        rd.parse_dods_grid(b"Dataset {} x;\n\nData:\n" + b"\0" * 16)


def test_model_terrain_is_the_shaders_bilinear_on_the_frame_lattice_and_wraps_at_180():
    zs = _frame_terrain()
    lat = np.array([46.0, 46.25, -90.0, 90.0])
    lon = np.array([8.0, 8.25, 179.75, -180.0])
    got = rd.model_terrain_on(lat, lon, zs)
    assert got[0, 0] == pytest.approx(zs[272, 376])                      # a node: 46N 8E is row 272, column 376
    want = 0.25 * (zs[272, 376] + zs[272, 377] + zs[273, 376] + zs[273, 377])
    assert got[1, 1] == pytest.approx(want)                              # the centre of a cell: the mean of its 4 nodes
    edge = rd.model_terrain_on(np.array([0.0]), np.array([179.75]), zs)[0, 0]
    assert edge == pytest.approx(0.5 * (zs[180, 719] + zs[180, 0]))      # 179.75E blends 179.5E with 180W (wrap)


def test_dz_is_dem_minus_model_terrain_and_zero_over_the_sea():
    zs = np.full((361, 720), 400.0)
    dem = np.array([[1500.0, -3000.0], [0.0, 250.0]])
    dz = rd.elevation_dz(dem, np.array([10.0, 10.1]), np.array([20.0, 20.1]), zs)
    assert dz.tolist() == [[1100.0, 0.0], [0.0, -150.0]]


def test_quantised_to_25_m_steps_and_clipped():
    q = rd.quantise(np.array([0.0, 12.4, -37.6, 5000.0, -9000.0]))
    assert q.dtype == np.uint8 and q.tolist() == [128, 128, 126, 255, 1]
    assert np.allclose(rd.dequantise(q[:3]), [0.0, 0.0, -50.0])
    x = np.linspace(-3000, 3000, 2001)
    assert np.max(np.abs(rd.dequantise(rd.quantise(x)) - x)) <= rd.STEP_M / 2 + 1e-9    # +-12.5 m = +-0.08 C


def test_tiles_respect_the_gpu_width_and_carry_one_overlap_column_wrapping_at_the_end():
    q = (np.arange(5400)[None, :] % 251 + np.arange(3)[:, None]).astype(np.uint8)
    t = rd.tiles(q, 4096)
    assert [c0 for c0, _ in t] == [0, 2700] and all(a.shape == (3, 2701) for _, a in t)
    assert np.array_equal(t[0][1][:, -1], q[:, 2700])                    # overlap = the next tile's first column
    assert np.array_equal(t[1][1][:, -1], q[:, 0])                       # the last tile wraps to column 0
    one = rd.tiles(q[:, :2700], 4096)
    assert len(one) == 1 and one[0][1].shape == (3, 2701) and np.array_equal(one[0][1][:, -1], q[:, 0])
    assert all(a.shape[1] <= 1000 for _, a in rd.tiles(q, 1000))


def test_build_drops_the_repeated_180e_column_and_describes_its_tiles():
    lat = np.linspace(-90, 90, 31)
    lon = np.linspace(-180, 180, 61)                                    # 6-deg steps, 180E repeats 180W
    dem = np.where((np.abs(lat[:, None] - 46) < 10) & (np.abs(lon[None, :] - 8) < 12), 2500.0, -100.0) + 0 * lon
    zs = np.full((361, 720), 300.0)
    d, files = rd.build(dem, lat, lon, zs, "2026-10-25T00:00:00Z", "test terrain", max_cols=40)
    la = d["lattice"]
    assert (la["rows"], la["cols"], la["south"], la["west"], la["dlat"], la["dlon"]) == (31, 60, -90.0, -180.0, 6.0, 6.0)
    assert len(files) == len(d["tiles"]) == 2 and sum(t["cols"] - 1 for t in d["tiles"]) == 60
    raw = gzip.decompress(files[0][1])
    assert len(raw) == d["tiles"][0]["rows"] * d["tiles"][0]["cols"]
    q = np.frombuffer(raw, dtype=np.uint8).reshape(d["tiles"][0]["rows"], d["tiles"][0]["cols"])
    land = q != rd.OFFSET
    assert land.any() and np.all(rd.dequantise(q[land]) == 2200.0)       # 2500 m over 300 m of model terrain
    assert d["tiles"][0]["path"].startswith(rd.TILE_PREFIX) and d["tiles"][0]["sha256"][:12] in d["tiles"][0]["path"]
    assert d["lapse_K_per_m"] == -0.0065 and d["encoding"]["step_m"] == 25.0 and d["stats"]["clipped_cells"] == 0
    assert "ETOPO 2022" in d["credit"] and "public domain" in d["license"]


def test_the_script_writes_tiles_before_the_descriptor_skips_when_current_and_is_off_by_default(tmp_path, monkeypatch, capsys):
    lat = np.linspace(-90, 90, 31)
    lon = np.linspace(-180, 180, 61)
    dem = np.full((31, 61), 800.0)
    terrain = (np.full((361, 720), 300.0), datetime(2026, 10, 25, 12, tzinfo=timezone.utc))
    sink = pub.LocalSink(tmp_path / "o")
    sink.ensure_bucket()
    rep = script.publish(sink, stride=16, dem=(dem, lat, lon), terrain=terrain, log=lambda *_: None)
    assert rep["status"] == "published"
    assert sink.order[-1] == rd.DESCRIPTOR_PATH and all(p.startswith(rd.TILE_PREFIX) for p in sink.order[:-1])
    assert sink.headers[rd.DESCRIPTOR_PATH]["cache-control"] == "no-cache"
    assert all(sink.headers[p]["cache-control"].endswith("immutable") for p in sink.order[:-1])
    d = json.loads(sink.read(rd.DESCRIPTOR_PATH))
    assert d["stride"] == 16 and "cycle 2026-10-25T12Z" in d["model_terrain"]
    assert script.publish(sink, stride=16, dem=(dem, lat, lon), terrain=terrain, log=lambda *_: None)["status"] == "current"
    assert script.publish(sink, stride=32, dem=(dem, lat, lon), terrain=terrain, log=lambda *_: None)["status"] == "published"
    monkeypatch.delenv("FRAME_RASTER_TEMP_DZ", raising=False)
    assert script.main([]) == 0 and "off" in capsys.readouterr().out

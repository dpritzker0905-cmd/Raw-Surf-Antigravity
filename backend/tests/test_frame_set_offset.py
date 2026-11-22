"""The gap fill's MODEL - GFS offset sets (services/frame_set_offset.py, DARK behind FRAME_OFFSET_PRODUCT).

Pins the pre-registered filter (a plain mean, then a 0.05 exponential filter over runs), the box-average onto 0.5 deg, and
one publish end to end through the raster publisher on a local sink, over two model runs.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from services import frame_binary as fb          # noqa: E402
from services import frame_set as fs             # noqa: E402
from services import frame_set_offset as fso     # noqa: E402

UTC = timezone.utc
B25 = (-180.0, -90.0, 179.75, 90.0)


def test_the_filter_is_a_plain_mean_then_a_005_exponential_one_and_keeps_gaps():
    assert [fso.alpha(n) for n in (1, 2, 4, 20, 21, 100)] == [1.0, 0.5, 0.25, 0.05, 0.05, 0.05]
    s = None
    for n, d in enumerate([10.0, 20.0, 30.0], start=1):
        s = fso.update(s, np.array([d, d]), n)
    assert np.allclose(s, [20.0, 20.0])                                   # the mean of the first three runs
    prev = np.array([1.0, np.nan, 3.0])
    out = fso.update(prev, np.array([np.nan, 5.0, 23.0]), 50)
    assert out[0] == 1.0 and out[1] == 5.0 and np.isclose(out[2], 3.0 + 0.05 * 20.0)   # no d keeps S; no S takes d


def test_box_average_onto_half_degree_from_quarter_and_eighth_degree():
    p25 = np.zeros((721, 1440))
    p25[0::2, 0::2] = 4.0                                                 # the 0.5-degree nodes themselves
    out = fso.to_out_grid(p25)
    assert out.shape == (361, 720)
    assert np.isclose(out[180, 360], 4.0 / 9)                             # 3 x 3 box: only its centre is a 0.5-degree node
    p125 = np.full((1441, 2880), 2.0)
    p125[:, 0] = np.nan                                                   # a no-data column is skipped, not zero
    out = fso.to_out_grid(p125)
    assert out.shape == (361, 720) and np.allclose(out, 2.0)              # column 0 averages across the antimeridian
    same = np.random.default_rng(0).normal(size=(361, 720))
    assert fso.to_out_grid(same) is not None and np.array_equal(fso.to_out_grid(same), same)


def _frame(value, valid, run):
    return fb.gzip_frame(fb.encode_plane(np.full((721, 1440), value), B25, valid.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                         run.strftime("%Y-%m-%dT%H:%M:%SZ"), fb.CLOUD_PCT))


def _publish_sources(sink, run, euro_value, gfs_value):
    """EURO and GFS cloud sets for `run`: frames at leads 24..45 h every 3 h, written as the publisher would."""
    latest = json.loads(sink.read(fs.LATEST) or b'{"sets": {}, "version": 1}')
    for key, value in (("EURO/weather/cloud_cover/global_0p25", euro_value), ("GFS/weather/cloud_cover/global_0p25", gfs_value)):
        frames = []
        for lead in range(24, 46, 3):
            v = run + timedelta(hours=lead)
            path = f"v1/{key.lower()}/{run:%Y%m%dT%H%M%SZ}/{v:%Y%m%dT%H%M%SZ}.bin"
            sink.write(path, _frame(value, v, run), fs.FRAME_TYPE, fs.IMMUTABLE)
            frames.append({"valid_time": v.strftime("%Y-%m-%dT%H:%M:%SZ"), "path": path})
        idx_path = f"v1/{key.lower()}/index/{run:%Y%m%dT%H%M%SZ}.json"
        sink.write(idx_path, json.dumps({"run": run.strftime("%Y-%m-%dT%H:%M:%SZ"), "frames": frames}).encode(), fs.JSON_TYPE, fs.IMMUTABLE)
        latest["sets"][key] = {"index": idx_path, "run": run.strftime("%Y-%m-%dT%H:%M:%SZ")}
    sink.write(fs.LATEST, json.dumps(latest).encode(), fs.JSON_TYPE, fs.REVALIDATE)


def _offset_values(sink):
    latest = json.loads(sink.read(fs.LATEST))
    idx = json.loads(sink.read(latest["sets"]["EURO/weather/cloud_cover_offset/global_0p5"]["index"]))
    vals = {}
    for f in idx["frames"]:
        _h, fields = fb.decode_plane(sink.read(f["path"]))
        plane = fields[fb.TEMP_C]
        assert plane.shape == (361, 720)
        vals[datetime.fromisoformat(f["valid_time"].replace("Z", "+00:00")).hour] = (float(np.nanmean(plane)), f["source"]["url"])
    return idx, vals


def test_publish_end_to_end_one_update_per_model_run(tmp_path):
    import publish_frame_images as pub
    sink = pub.LocalSink(tmp_path)
    run1 = datetime(2026, 11, 20, 0, tzinfo=UTC)
    _publish_sources(sink, run1, 60.0, 50.0)                              # EURO - GFS = +10 % points at every hour
    reports, pulled = fso.publish_all(sink, pub._uploader(sink), names=["cloud_euro_offset"], log=lambda *a: None)
    r = reports["cloud_euro_offset"]
    assert r["status"] == "published" and r["updates"] == 1 and pulled > 0
    idx, vals = _offset_values(sink)
    assert sorted(vals) == list(fso.PHASES)                               # one frame per UTC hour of day
    assert all(abs(v - 10.0) < 0.06 and "updates=1" in u for v, u in vals.values())
    assert idx["common_meta"]["value_kind"] == "model_minus_gfs_cloud_cover"
    again, _ = fso.publish_all(sink, pub._uploader(sink), names=["cloud_euro_offset"], log=lambda *a: None)
    assert again["cloud_euro_offset"]["status"] == "unchanged"            # the same model run is never counted twice
    run2 = run1 + timedelta(hours=12)
    _publish_sources(sink, run2, 70.0, 50.0)                              # the next run says +20
    reports, _ = fso.publish_all(sink, pub._uploader(sink), names=["cloud_euro_offset"], log=lambda *a: None)
    assert reports["cloud_euro_offset"]["updates"] == 2
    _idx, vals = _offset_values(sink)
    assert all(abs(v - 15.0) < 0.06 and "updates=2" in u for v, u in vals.values())   # the mean of the two runs


def test_the_flag_is_dark_by_default_and_registered(monkeypatch):
    monkeypatch.delenv(fso.FLAG, raising=False)
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    assert fso.enabled() is False
    src = (Path(__file__).resolve().parents[1] / "routes" / "admin" / "surf_forecast.py").read_text(encoding="utf-8")
    assert f'"{fso.FLAG}": ("0",' in src

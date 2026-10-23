"""Regional static frames as one bundle per set per run (2026-10-23): services/frame_set_bundle.py + the publish loop.

Offline only (LocalCache + LocalSink). Pins the contract the mid-zoom client reads (the lead's regional contract, 2026-10-22):
every bundle slice is byte-identical to the frame the world path builds for the same product and decodes; the index lists every
entry with offset/length/sha12 (offset null = unbuilt, /grid); the latest.json record carries `index` AND `bundle`; the bundle
is written before its index and latest.json last; an unchanged run uploads nothing; a coverage refusal uploads nothing;
retention keeps the current and previous bundle; the regional sets are every GFS marine pilot box, after the world sets, with a
kill switch.
"""
import gzip
import json
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
from services import frame_binary as fb  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_bundle as fsb  # noqa: E402

REGION = "florida_east_coast"
TARGET = next(t for t in fsb.REGIONAL_SETS if t["region_id"] == REGION)
KEY = fs.set_key(TARGET)
PREFIX = fs.set_prefix(TARGET)
VALIDS = [f"2026-10-{20 + (6 + 3 * i) // 24}T{(6 + 3 * i) % 24:02d}:00:00Z" for i in range(10)]


def _product(valid, run, bump=0.0, cols=4, rows=5):
    vecs = []
    for r in range(rows):
        for c in range(cols):
            lat, lng = 25.0 + r * 0.25, -81.0 + c * 0.25
            if c == 0 and r % 2 == 0:              # land on the west edge, as a coastal box carries it
                vecs.append({"lat": lat, "lng": lng, "speed": 0.0, "direction": 0.0, "u": 0.0, "v": 0.0, "period": 0.0,
                             "gust": None, "value": None, "is_valid": False, "dir_confidence": None})
                continue
            h, d = round(0.8 + 0.07 * r + 0.03 * c + bump, 4), round((20.0 * c + 11.0 * r) % 360.0, 2)
            rad = math.radians(d)
            vecs.append({"lat": lat, "lng": lng, "speed": h, "direction": d, "u": round(-h * math.sin(rad), 4),
                         "v": round(-h * math.cos(rad), 4), "period": round(7.0 + r, 2), "gust": None, "value": None,
                         "is_valid": True, "dir_confidence": 0.8})
    return {"model": "GFS", "provider": "noaa", "domain": "marine", "layer": "waves", "run_time": run, "model_run_time": run,
            "model_run_time_status": "known", "ingested_at": run, "valid_time": valid, "is_forecast_authoritative": True,
            "is_estimated": False, "estimate_basis": None, "value_kind": "wave_height", "value_unit": "m",
            "display_unit_hint": "ft", "source_dataset": "ncep_gfswave025", "upstream_provider": "noaa", "region_id": REGION,
            # stored bounds = the REQUEST box, wider than the outer cell centres; the index must carry the lattice
            "grid": {"cols": cols, "rows": rows, "bounds": {"west": -81.2, "south": 24.8, "east": -80.1, "north": 26.2},
                     "vectors": vecs, "diagnostics": {"gridMode": "rectangular"}}}


def _name(vt):
    return f"gfs_marine_waves_{REGION}_{vt.replace('-', '').replace(':', '')}.json"


def _write_store(store, run="2026-10-20T06:00:00Z", bump=0.0, skip=()):
    store.mkdir(parents=True, exist_ok=True)
    entries = []
    for i, vt in enumerate(VALIDS):
        if i not in skip:
            (store / _name(vt)).write_text(json.dumps(_product(vt, run, bump)))
        entries.append({"model": "GFS", "domain": "marine", "layer": "waves", "region_id": REGION, "filename": _name(vt),
                        "valid_time_start": vt, "model_run_time": run, "run_time": run, "ingested_at": run,
                        "is_estimated": False})
    (store / "manifest.json").write_text(json.dumps({"products": entries}))


@pytest.fixture(autouse=True)
def _only_this_set(monkeypatch):
    monkeypatch.setenv("FRAME_SETS", KEY)
    monkeypatch.delenv("FRAME_REGIONAL_BUNDLES", raising=False)
    monkeypatch.delenv("FRAME_MIN_COVERAGE", raising=False)


def _publish(store, out):
    sink = pub.LocalSink(out)
    return pub.publish_frame_sets(pub.LocalCache(store), sink, log=lambda *_: None), sink


def _latest(out):
    return json.loads((out / fs.LATEST).read_text())


def test_one_bundle_per_run_whose_slices_are_the_world_paths_frames(tmp_path):
    store, out = tmp_path / "store", tmp_path / "out"
    _write_store(store)
    report, sink = _publish(store, out)
    assert (report[KEY]["built"], report[KEY]["uploaded"], report[KEY]["parity_bad"]) == (10, 1, 0)
    rec = _latest(out)["sets"][KEY]
    index = json.loads((out / rec["index"]).read_text())
    bundle = index["bundle"]
    assert rec["bundle"] == bundle and rec["frames"] == 10 and rec["entries"] == 10
    assert bundle["path"] == f"{PREFIX}/20261020T060000Z/bundle-{bundle['sha12']}.bin"
    assert rec["index"].startswith(f"{PREFIX}/index/20261020T060000Z-")
    assert sink.order == [bundle["path"], rec["index"], fs.LATEST]          # bundle, its index, the pointer LAST
    assert sink.headers[bundle["path"]] == {"content-type": "application/octet-stream", "cache-control": fs.IMMUTABLE}
    assert sink.headers[rec["index"]]["cache-control"] == fs.IMMUTABLE
    blob = (out / bundle["path"]).read_bytes()
    assert len(blob) == bundle["bytes"] and fsb.sha12(blob) == bundle["sha12"]
    end = 0
    for f, vt in zip(index["frames"], VALIDS):
        assert f["valid_time"] == vt and f["offset"] == end and "path" not in f
        piece = blob[f["offset"]:f["offset"] + f["length"]]
        assert fsb.sha12(piece) == f["sha12"]
        product = _product(vt, "2026-10-20T06:00:00Z")
        raw, _check = fs.build_frame(product, None)
        assert piece == fb.gzip_frame(raw)                                   # byte-identical to the per-frame object
        assert fb.parity(product, fb.decode_frame(gzip.decompress(piece)))["bad"] == 0
        end += f["length"]
    assert end == len(blob)
    west, south, east, north = fb.cell_bounds(_product(VALIDS[0], "x")["grid"]["vectors"])
    assert index["grid"]["bounds"] == {"west": west, "south": south, "east": east, "north": north}   # the lattice, not the box
    assert index["set"] == KEY and index["region_id"] == REGION and "bundle" in index and index["layout"]


def test_an_entry_without_a_frame_is_listed_with_a_null_offset(tmp_path):
    store, out = tmp_path / "store", tmp_path / "out"
    _write_store(store, skip=(4,))                                           # 9 of 10 on disk: coverage 0.9 passes
    _publish(store, out)
    index = json.loads((out / _latest(out)["sets"][KEY]["index"]).read_text())
    gap = index["frames"][4]
    assert (gap["offset"], gap["length"], gap["sha12"], gap["unbuilt"]) == (None, None, None, "not_local")
    assert sum(1 for f in index["frames"] if f["offset"] is not None) == 9 and _latest(out)["sets"][KEY]["frames"] == 9


def test_an_unchanged_run_uploads_nothing_and_keeps_the_pointer(tmp_path):
    store, out = tmp_path / "store", tmp_path / "out"
    _write_store(store)
    _publish(store, out)
    before = (out / fs.LATEST).read_bytes()
    report, sink = _publish(store, out)
    assert report[KEY]["uploaded"] == 0 and sink.order == [] and (out / fs.LATEST).read_bytes() == before


def test_a_coverage_refusal_uploads_nothing(tmp_path):
    store, out = tmp_path / "store", tmp_path / "out"
    _write_store(store, skip=range(5))
    report, sink = _publish(store, out)
    assert report[KEY]["coverage_refused"] and report[KEY]["uploaded"] == 0 and sink.order == []


def test_retention_keeps_the_current_and_previous_bundle(tmp_path):
    store, out = tmp_path / "store", tmp_path / "out"
    recs = []
    for k, run in enumerate(("2026-10-20T06:00:00Z", "2026-10-20T12:00:00Z", "2026-10-20T18:00:00Z")):
        _write_store(store, run=run, bump=0.1 * k)
        report, _sink = _publish(store, out)
        recs.append(_latest(out)["sets"][KEY])
    on_disk = set(pub.LocalSink(out).list(PREFIX))
    assert {recs[1]["index"], recs[1]["bundle"]["path"], recs[2]["index"], recs[2]["bundle"]["path"]} == on_disk
    assert report[KEY]["deleted"] == 2 and recs[2]["previous_index"] == recs[1]["index"]


def test_the_regional_sets_are_every_gfs_marine_pilot_box_after_the_world_sets(monkeypatch):
    from services.weather_pipeline import pilot_regions as pr
    boxes = {**pr.REGIONAL_CONFIGS, **pr.WORLDWIDE_COASTAL_REGIONS, **pr.GFS_MARINE_EXTRA_REGIONS,
             **pr.GFS_MARINE_STAGE_B_REGIONS}
    assert [t["region_id"] for t in fsb.REGIONAL_SETS] == list(boxes)
    assert all((t["model"], t["domain"], t["layer"], t["bundle"]) == ("GFS", "marine", "waves", True) for t in fsb.REGIONAL_SETS)
    monkeypatch.delenv("FRAME_SETS")
    keys = [fs.set_key(t) for t in pub.selected_sets()]
    assert keys[:len(fs.SETS)] == [fs.set_key(t) for t in fs.SETS]           # world sets first, unchanged
    assert keys[len(fs.SETS):] == [fs.set_key(t) for t in fsb.REGIONAL_SETS]  # regional LAST: the stagger drops them first
    monkeypatch.setenv("FRAME_REGIONAL_BUNDLES", "0")
    assert [fs.set_key(t) for t in pub.selected_sets()] == [fs.set_key(t) for t in fs.SETS]


def test_an_upload_is_retried_on_429_and_5xx_with_backoff_then_gives_up(monkeypatch):
    """Supabase answered cold-cache bursts with 429 (2026-10-20); a bundle is one object, so one 429 must not lose the set."""
    waits, codes = [], []

    class _Resp:
        def __init__(self, code):
            self.status_code, self.text = code, "x"

    class _Requests:
        ConnectionError, Timeout = ConnectionError, TimeoutError

        def __init__(self, script):
            self.script = list(script)

        def post(self, url, headers=None, data=None, timeout=None):
            code = self.script.pop(0)
            codes.append(code)
            if code == "drop":
                raise ConnectionError("reset")
            return _Resp(code)
    monkeypatch.setattr(pub, "_sleep", waits.append)
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-not-a-key")
    sink = pub.SupabaseSink()
    sink.requests = _Requests([429, "drop", 503, 200])
    sink.write(f"{PREFIX}/r/bundle-abc.bin", b"\x1f\x8b", fs.FRAME_TYPE, fs.IMMUTABLE)
    assert sink.order == [f"{PREFIX}/r/bundle-abc.bin"] and waits == list(pub.UPLOAD_BACKOFF_S)
    sink.requests, waits[:] = _Requests([429, 429, 429, 429]), []
    with pytest.raises(RuntimeError, match="HTTP 429"):
        sink.write(f"{PREFIX}/r/bundle-def.bin", b"\x1f\x8b", fs.FRAME_TYPE, fs.IMMUTABLE)
    sink.requests, codes[:] = _Requests([403]), []
    with pytest.raises(RuntimeError, match="HTTP 403"):
        sink.write(f"{PREFIX}/r/bundle-ghi.bin", b"\x1f\x8b", fs.FRAME_TYPE, fs.IMMUTABLE)
    assert codes == [403]                                                     # a refusal is not retried


def test_a_failed_bundle_upload_does_not_stop_the_world_sets(tmp_path, monkeypatch):
    store, out = tmp_path / "store", tmp_path / "out"
    _write_store(store)
    manifest = json.loads((store / "manifest.json").read_text())
    world = [dict(p, region_id="global_mid") for p in manifest["products"]]     # the same files, listed as the world set
    (store / "manifest.json").write_text(json.dumps({"products": manifest["products"] + world}))
    world_key = fs.set_key(fs.SETS[0])
    monkeypatch.setenv("FRAME_SETS", f"{world_key},{KEY}")

    class _Sink(pub.LocalSink):
        def write(self, path, data, content_type, cache_control):
            if "/bundle-" in path:
                raise RuntimeError("upload: HTTP 429")
            super().write(path, data, content_type, cache_control)
    sink = _Sink(out)
    report = pub.publish_frame_sets(pub.LocalCache(store), sink, log=lambda *_: None)
    assert "HTTP 429" in report[KEY]["error"] and report[KEY]["index"] is None
    assert report[world_key]["built"] == 10 and sink.order[-1] == fs.LATEST
    assert set(_latest(out)["sets"]) == {world_key}                              # the world pointer moved; no regional record

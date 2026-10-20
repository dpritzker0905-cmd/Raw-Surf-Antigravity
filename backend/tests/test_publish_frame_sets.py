"""Static frame publishing (step 2b, 2026-10-20): services/frame_set.py + scripts/publish_frame_images.py.

Offline only (LocalCache + LocalSink, a fake `requests` for the Supabase sink). Pins: frames come from the runner's
own disk and nothing is downloaded; every frame passes the parity gate before upload; frames and indexes are immutable
and content-addressed; latest.json is no-cache and written LAST; an unchanged cycle uploads nothing; retention keeps
the current and previous index and deletes the rest; uploads never carry a Content-Encoding header.
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

TARGET = fs.SETS[0]
PREFIX = fs.set_prefix(TARGET)


def _product(valid, run="2026-10-20T06:00:00Z", bump=0.0, cols=6, rows=4):
    vecs = []
    for r in range(rows):
        for c in range(cols):
            lat, lng = -60.0 + r * 40.0, -180.0 + c * 72.0
            if (r + c) % 5 == 0:
                vecs.append({"lat": lat, "lng": lng, "speed": 0.0, "direction": 0.0, "u": 0.0, "v": 0.0,
                             "period": 0.0, "gust": None, "value": None, "is_valid": False, "dir_confidence": None})
                continue
            h, d = round(1.0 + 0.1 * r + 0.01 * c + bump, 4), round((30.0 * c + 7.0 * r) % 360.0, 2)
            rad = math.radians(d)
            vecs.append({"lat": lat, "lng": lng, "speed": h, "direction": d, "u": round(-h * math.sin(rad), 4),
                         "v": round(-h * math.cos(rad), 4), "period": round(8.0 + r, 2), "gust": None, "value": None,
                         "is_valid": True, "dir_confidence": 0.9})
    return {"model": "GFS", "provider": "open-meteo", "domain": "marine", "layer": "waves", "run_time": run,
            "model_run_time": run, "model_run_time_status": "known", "ingested_at": run, "valid_time": valid,
            "is_forecast_authoritative": True, "is_estimated": False, "estimate_basis": None, "value_kind": "wave_height",
            "value_unit": "m", "display_unit_hint": "ft", "source_dataset": "ncep_gfswave025", "upstream_provider": "noaa",
            "region_id": "global_mid",
            "grid": {"cols": cols, "rows": rows, "bounds": {"west": -180.0, "south": -60.0, "east": 180.0, "north": 60.0},
                     "vectors": vecs, "diagnostics": {"gridMode": "rectangular", "nonzeroCount": 17}}}


VALIDS = ["2026-10-20T06:00:00Z", "2026-10-20T09:00:00Z", "2026-10-20T12:00:00Z"]


def _write_store(store, run="2026-10-20T06:00:00Z", bump=0.0, valids=VALIDS, skip_files=(), extra=()):
    store.mkdir(parents=True, exist_ok=True)
    entries = []
    for vt in valids:
        name = f"gfs_marine_waves_global_mid_{vt.replace('-', '').replace(':', '')}.json"
        if name not in skip_files:
            (store / name).write_text(json.dumps(_product(vt, run, bump)))
        entries.append({"model": "GFS", "domain": "marine", "layer": "waves", "region_id": "global_mid",
                        "filename": name, "valid_time_start": vt, "model_run_time": run, "run_time": run,
                        "ingested_at": run, "is_estimated": False})
    (store / "manifest.json").write_text(json.dumps({"products": entries + list(extra)}))


def _publish(store, out):
    sink = pub.LocalSink(out)
    return pub.publish_frame_sets(pub.LocalCache(store), sink, log=lambda *_: None), sink


def _latest(out):
    return json.loads((out / fs.LATEST).read_text())


def test_first_publish_writes_checked_immutable_frames_then_the_pointer_last(tmp_path):
    _write_store(tmp_path / "store")
    report, sink = _publish(tmp_path / "store", tmp_path / "out")
    stats = report[fs.set_key(TARGET)]
    assert (stats["built"], stats["uploaded"], stats["refused"], stats["parity_bad"]) == (3, 3, 0, 0)
    latest = _latest(tmp_path / "out")["sets"][fs.set_key(TARGET)]
    index = json.loads((tmp_path / "out" / latest["index"]).read_text())
    assert sink.order[-1] == fs.LATEST and sink.order[-2] == latest["index"]   # frames, index, pointer LAST
    assert sink.headers[fs.LATEST] == {"content-type": "application/json", "cache-control": "no-cache"}
    assert sink.headers[latest["index"]]["cache-control"] == fs.IMMUTABLE
    for f in index["frames"]:
        assert f["path"].startswith(PREFIX + "/20261020T060000Z/") and f["path"].endswith(f"-{f['sha256'][:12]}.bin")
        assert sink.headers[f["path"]] == {"content-type": "application/octet-stream", "cache-control": fs.IMMUTABLE}
        body = (tmp_path / "out" / f["path"]).read_bytes()
        assert body[:2] == b"\x1f\x8b" and fb.sha256_hex(gzip.decompress(body)) == f["sha256"]
    assert index["run"] == "2026-10-20T06:00:00Z" and index["common_meta"]["provider"] == "open-meteo"
    assert index["frames"][0]["meta"]["product_id"].startswith("gfs_marine_waves_global_mid_")
    assert index["common_meta"]["diagnostics"] == {"gridMode": "rectangular"}   # only the keys a client reads


def test_an_unchanged_cycle_uploads_nothing_and_leaves_the_pointer(tmp_path):
    _write_store(tmp_path / "store")
    _publish(tmp_path / "store", tmp_path / "out")
    before = (tmp_path / "out" / fs.LATEST).read_bytes()
    report, sink = _publish(tmp_path / "store", tmp_path / "out")
    stats = report[fs.set_key(TARGET)]
    assert (stats["carried"], stats["uploaded"], stats["built"]) == (3, 0, 0) and sink.order == []
    assert (tmp_path / "out" / fs.LATEST).read_bytes() == before


def test_a_new_run_moves_the_pointer_and_retention_keeps_one_previous_index(tmp_path):
    store, out = tmp_path / "store", tmp_path / "out"
    _write_store(store)
    _publish(store, out)
    first = _latest(out)["sets"][fs.set_key(TARGET)]
    first_frames = [f["path"] for f in json.loads((out / first["index"]).read_text())["frames"]]
    _write_store(store, run="2026-10-20T12:00:00Z", bump=0.2)
    _publish(store, out)
    second = _latest(out)["sets"][fs.set_key(TARGET)]
    assert second["previous_index"] == first["index"]
    assert all((out / p).exists() for p in first_frames + [first["index"]])      # a client pinned to it still works
    _write_store(store, run="2026-10-20T18:00:00Z", bump=0.4)
    report, sink = _publish(store, out)
    third = _latest(out)["sets"][fs.set_key(TARGET)]
    assert third["previous_index"] == second["index"]
    assert not any((out / p).exists() for p in first_frames + [first["index"]])  # two runs back: deleted
    assert report[fs.set_key(TARGET)]["deleted"] == len(first_frames) + 1
    assert set(sink.deleted) == set(first_frames + [first["index"]])


def test_frames_come_only_from_the_runners_disk(tmp_path):
    store, out = tmp_path / "store", tmp_path / "out"
    _write_store(store)
    _publish(store, out)
    missing = "gfs_marine_waves_global_mid_20261020T090000Z.json"
    # Same identity, file gone from disk: carried over from the previous index without reading anything.
    (store / missing).unlink()
    stats = _publish(store, out)[0][fs.set_key(TARGET)]
    assert (stats["carried"], stats["not_local"]) == (3, 0)
    # A NEW run whose file is not on disk: left out (the client falls back to /grid), never downloaded.
    _write_store(store, run="2026-10-20T12:00:00Z", bump=0.2, skip_files=(missing,))
    report, _sink = _publish(store, out)
    stats = report[fs.set_key(TARGET)]
    assert (stats["built"], stats["not_local"]) == (2, 1)
    index = json.loads((out / _latest(out)["sets"][fs.set_key(TARGET)]["index"]).read_text())
    assert [f["valid_time"] for f in index["frames"]] == [VALIDS[0], VALIDS[2]]


def test_a_stale_disk_copy_is_never_mixed_into_a_newer_run(tmp_path):
    store = tmp_path / "store"
    _write_store(store)
    manifest = json.loads((store / "manifest.json").read_text())
    for e in manifest["products"]:
        e["model_run_time"] = e["run_time"] = "2026-10-20T12:00:00Z"      # the manifest names a run the files are not
    (store / "manifest.json").write_text(json.dumps(manifest))
    report, _sink = _publish(store, tmp_path / "out")
    stats = report[fs.set_key(TARGET)]
    assert stats["stale_local"] == 3 and stats["uploaded"] == 0 and not (tmp_path / "out" / fs.LATEST).exists()


def test_a_frame_failing_parity_is_refused_and_the_step_reports_it(tmp_path, monkeypatch):
    store, out = tmp_path / "store", tmp_path / "out"
    _write_store(store)
    real = fb.parity

    def one_bad(product, decoded):
        r = real(product, decoded)
        return dict(r, bad=1) if product["valid_time"] == VALIDS[1] else r
    monkeypatch.setattr(fb, "parity", one_bad)
    assert pub.main(["--store-dir", str(store), "--out-dir", str(out), "--only", "frames"]) == 1
    index = json.loads((out / _latest(out)["sets"][fs.set_key(TARGET)]["index"]).read_text())
    assert [f["valid_time"] for f in index["frames"]] == [VALIDS[0], VALIDS[2]]


def test_selection_keeps_estimated_beside_authoritative_and_first_of_duplicates():
    base = {"model": "GFS", "domain": "marine", "layer": "waves", "region_id": "global_mid"}
    products = [
        dict(base, filename="a", valid_time_start="2026-10-20T06:00:00Z"),
        dict(base, filename="dup", valid_time_start="2026-10-20T06:00:00+00:00"),
        dict(base, filename="est", valid_time_start="2026-10-20T06:00:00Z", is_estimated=True),
        dict(base, filename="coarse", valid_time_start="2026-10-20T06:00:00Z", region_id="global_coarse"),
        dict(base, filename="early", valid_time_start="2026-10-20T03:00:00Z"),
    ]
    assert [p["filename"] for p in fs.select_entries(products, TARGET)] == ["early", "a", "est"]


def test_retention_never_deletes_with_an_empty_keep_set():
    paths = [f"{PREFIX}/x/a.bin", f"{PREFIX}/index/b.json", "gfs/waves/global_mid/r/v.png"]
    assert fs.retention_deletes(paths, TARGET, set()) == []
    assert fs.retention_deletes(paths, TARGET, {f"{PREFIX}/x/a.bin"}) == [f"{PREFIX}/index/b.json"]  # proof PNG untouched


def test_supabase_uploads_never_carry_a_content_encoding_header(monkeypatch):
    sent = []

    class _Resp:
        status_code, text = 200, "ok"

    class _Requests:
        def post(self, url, headers=None, data=None, json=None, timeout=None):
            sent.append(headers)
            return _Resp()
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-not-a-key")
    sink = pub.SupabaseSink()
    sink.requests = _Requests()
    sink.write(f"{PREFIX}/r/v-abc.bin", b"\x1f\x8bxx", fs.FRAME_TYPE, fs.IMMUTABLE)
    assert sent[0]["Content-Type"] == "application/octet-stream" and sent[0]["cache-control"] == fs.IMMUTABLE
    assert not any(k.lower() == "content-encoding" for k in sent[0])


def test_the_local_cache_refuses_paths_outside_its_directory(tmp_path):
    (tmp_path / "store").mkdir()
    (tmp_path / "secret.json").write_text("{}")
    assert pub.LocalCache(tmp_path / "store").product_bytes("../secret.json") is None
    with pytest.raises(RuntimeError, match="no local manifest"):
        pub.LocalCache(tmp_path / "store").manifest()

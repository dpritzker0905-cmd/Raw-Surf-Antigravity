"""Static frame publishing (step 2b, 2026-10-20): services/frame_set.py + scripts/publish_frame_images.py.

Offline only (LocalCache + LocalSink, a fake `requests` for the Supabase sink). Pins: frames come from the runner's
own disk and nothing is downloaded; every frame passes the parity gate before upload; frames and indexes are immutable
and content-addressed; latest.json is no-cache and written LAST; an unchanged cycle uploads nothing; retention keeps
the current and previous index and deletes the rest; uploads never carry a Content-Encoding header.
"""
import gzip
import itertools
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
            # Bounds as STORED products carry them: the request box, wider than the outer cell centres (-60..60).
            "grid": {"cols": cols, "rows": rows, "bounds": {"west": -180.0, "south": -62.0, "east": 180.0, "north": 61.0},
                     "vectors": vecs, "diagnostics": {"gridMode": "rectangular", "nonzeroCount": 17}}}


VALIDS = ["2026-10-20T06:00:00Z", "2026-10-20T09:00:00Z", "2026-10-20T12:00:00Z"]
TEN = [f"2026-10-{20 + (6 + 3 * i) // 24}T{(6 + 3 * i) % 24:02d}:00:00Z" for i in range(10)]   # 06Z, 09Z ... 09Z next day


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
    assert index["run_time"] == latest["run_time"] == "2026-10-20T06:00:00Z"   # the manifest run_time the series memo keys on
    assert index["coverage"] == latest["coverage"] == 1.0 and latest["frames"] == latest["entries"] == 3
    assert index["frames"][0]["meta"]["product_id"].startswith("gfs_marine_waves_global_mid_")
    assert index["common_meta"]["diagnostics"] == {"gridMode": "rectangular"}   # only the keys a client reads
    assert index["grid"]["bounds"] == {"west": -180.0, "south": -60.0, "east": 180.0, "north": 60.0}  # cell centres, as /grid


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
    _write_store(store, valids=TEN)
    _publish(store, out)
    missing = "gfs_marine_waves_global_mid_20261020T090000Z.json"
    # Same identity, file gone from disk: carried over from the previous index without reading anything.
    (store / missing).unlink()
    stats = _publish(store, out)[0][fs.set_key(TARGET)]
    assert (stats["carried"], stats["not_local"]) == (10, 0)
    # A NEW run whose file is not on disk: never downloaded, and LISTED with path null so the client's pick lands on it
    # and falls back to /grid (review finding 2: dropping it let the pick substitute the frame 3 h away).
    _write_store(store, run="2026-10-20T12:00:00Z", bump=0.2, valids=TEN, skip_files=(missing,))
    report, _sink = _publish(store, out)
    stats = report[fs.set_key(TARGET)]
    assert (stats["built"], stats["not_local"], stats["coverage"]) == (9, 1, 0.9)
    index = json.loads((out / _latest(out)["sets"][fs.set_key(TARGET)]["index"]).read_text())
    assert [f["valid_time"] for f in index["frames"]] == TEN
    gap = index["frames"][1]
    assert gap["valid_time"] == "2026-10-20T09:00:00Z" and gap["path"] is None and gap["unbuilt"] == "not_local"
    assert gap["source"]["filename"] == missing and "meta" not in gap


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
    _write_store(store, valids=TEN)
    real = fb.parity

    def one_bad(product, decoded):
        r = real(product, decoded)
        return dict(r, bad=1) if product["valid_time"] == TEN[1] else r
    monkeypatch.setattr(fb, "parity", one_bad)
    assert pub.main(["--store-dir", str(store), "--out-dir", str(out), "--only", "frames"]) == 1
    index = json.loads((out / _latest(out)["sets"][fs.set_key(TARGET)]["index"]).read_text())
    refused = [f for f in index["frames"] if f["path"] is None]
    assert [(f["valid_time"], f["unbuilt"]) for f in refused] == [(TEN[1], "refused")]
    assert not any(TEN[1].replace("-", "").replace(":", "") in p for p in pub.LocalSink(out).list(PREFIX))


def test_a_lane_holding_most_of_the_set_off_disk_publishes_nothing(tmp_path):
    """Review finding 1: the CORE lane's disk held only 60 of 115 GFS world products (5 within 0-165 h). A set below
    FRAME_MIN_COVERAGE must not publish a hole-ridden index or upload its frames; the published index stays."""
    store, out = tmp_path / "store", tmp_path / "out"
    _write_store(store, valids=TEN)
    _publish(store, out)
    before = (out / fs.LATEST).read_bytes()
    on_disk = set(TEN[:3])
    _write_store(store, run="2026-10-20T12:00:00Z", bump=0.2, valids=TEN,
                 skip_files=tuple(f"gfs_marine_waves_global_mid_{v.replace('-', '').replace(':', '')}.json"
                                  for v in TEN if v not in on_disk))
    report, sink = _publish(store, out)
    stats = report[fs.set_key(TARGET)]
    assert stats["coverage_refused"] is True and stats["coverage"] == 0.3 and stats["uploaded"] == 0
    assert sink.order == [] and (out / fs.LATEST).read_bytes() == before
    assert pub.main(["--store-dir", str(store), "--out-dir", str(out), "--only", "frames"]) == 1


def test_the_publisher_runs_only_in_the_pilots_lane_after_its_ingest():
    """The GFS world products are pilot jobs; the step must run in forecast-ingest-pilots.yml after the ingest step, and
    nowhere else (two publishers' retention could delete each other's frames). The ONE exception (2026-10-24, PR B): the core
    lane's `--wind-lane-rebuild`, which deletes nothing and never writes latest.json (tests/test_frame_set_wind_rebuild.py),
    after the core ingest that publishes the HRRR lane."""
    wf = Path(__file__).resolve().parents[2] / ".github" / "workflows"
    pilots = (wf / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    assert pilots.index("scripts/ingest_forecast_ci.py") < pilots.index("scripts/publish_frame_images.py")
    assert "vars.FRAME_IMAGES_PUBLISH == '1'" in pilots
    others = {}
    for f in wf.glob("*.yml"):
        if f.name == "forecast-ingest-pilots.yml":
            continue
        runs = [ln.strip() for ln in f.read_text(encoding="utf-8").splitlines() if "publish_frame_images.py" in ln and "run:" in ln]
        if runs:
            others[f.name] = runs
    assert others == {"forecast-ingest.yml": ["run: python scripts/publish_frame_images.py --wind-lane-rebuild"]}
    core = (wf / "forecast-ingest.yml").read_text(encoding="utf-8")
    assert core.index("scripts/ingest_forecast_ci.py") < core.index("scripts/publish_frame_images.py --wind-lane-rebuild")


def test_retention_deletes_nothing_when_the_previous_index_cannot_be_read(tmp_path):
    store, out = tmp_path / "store", tmp_path / "out"
    _write_store(store)
    _publish(store, out)
    old = pub.LocalSink(out).list(PREFIX)
    (out / fs.LATEST).unlink()                   # an unreadable pointer reads as "no previous"
    _write_store(store, run="2026-10-20T12:00:00Z", bump=0.2)
    report, sink = _publish(store, out)
    assert report[fs.set_key(TARGET)]["deleted"] == 0 and sink.deleted == []
    assert all((out / p).exists() for p in old)


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


def _write_set(store, model, layer, valids, run="2026-10-20T06:00:00Z", estimated_from=None, skip=()):
    """Add one set's products + manifest entries to a store; valid times at or after `estimated_from` are estimated."""
    store.mkdir(parents=True, exist_ok=True)
    path = store / "manifest.json"
    manifest = json.loads(path.read_text()) if path.exists() else {"products": []}
    for vt in valids:
        est = bool(estimated_from and vt >= estimated_from)
        name = f"{model.lower()}_marine_{layer}_global_mid_{vt.replace('-', '').replace(':', '')}.json"
        if name not in skip:
            prod = _product(vt, run)
            prod.update(model=model, layer=layer, is_estimated=est, is_forecast_authoritative=not est)
            (store / name).write_text(json.dumps(prod))
        manifest["products"].append({"model": model, "domain": "marine", "layer": layer, "region_id": "global_mid",
                                     "filename": name, "valid_time_start": vt, "model_run_time": run, "run_time": run,
                                     "ingested_at": run, "is_estimated": est})
    path.write_text(json.dumps(manifest))
    return [f"{model.lower()}_marine_{layer}_global_mid_{vt.replace('-', '').replace(':', '')}.json" for vt in valids]


def test_the_world_sets_are_the_pilots_lane_ones():
    keys = [fs.set_key(t) for t in fs.SETS]
    assert keys[0] == "GFS/marine/waves/global_mid"                      # the most-used set publishes first
    assert set(keys) == {f"{m}/marine/{l}/global_mid" for m, l in (
        ("GFS", "waves"), ("GFS", "swell_1"), ("GFS", "swell_2"), ("GFS", "wind_waves"),
        ("ICON", "waves"), ("ICON", "swell_1"), ("ICON", "wind_waves"), ("EURO", "waves"))} | {"GFS/wind/wind/global_mid"} | {
        f"{m}/marine/{l}/global_mid_filled" for m, l in (("ICON", "waves"), ("EURO", "waves"), ("ICON", "swell_1"), ("ICON", "wind_waves"))}
    # wind, then the filled world sets (frame_set_fill, 2026-10-24) last: the stagger drops them first
    assert keys.index("GFS/wind/wind/global_mid") == len(keys) - 5 and all(k.endswith("_filled") for k in keys[-4:])
    assert "EURO/marine/swell_1/global_mid" not in keys and "ICON/marine/swell_2/global_mid" not in keys


def test_an_estimated_tail_from_another_lane_is_listed_unbuilt_not_a_coverage_failure(tmp_path):
    """ICON/EURO: the native hours are written by the pilots lane, the estimated 14-day tail by the core lane. The gate
    counts authoritative entries; the tail is listed with path null and /grid serves it (it is also the resolver's pick)."""
    store, out = tmp_path / "store", tmp_path / "out"
    names = _write_set(store, "ICON", "waves", TEN, estimated_from=TEN[6])
    tail = names[6:]
    for n in tail:
        (store / n).unlink()                                          # baked by the other lane: not on this disk
    report, _sink = _publish(store, out)
    stats = report["ICON/marine/waves/global_mid"]
    assert (stats["built"], stats["not_local"], stats["coverage"], stats["coverage_authoritative"]) == (6, 4, 0.6, 1.0)
    index = json.loads((out / _latest(out)["sets"]["ICON/marine/waves/global_mid"]["index"]).read_text())
    assert [(f["is_estimated"], f["path"] is None) for f in index["frames"]] == [(False, False)] * 6 + [(True, True)] * 4
    assert index["common_meta"]["model"] == "ICON" and index["path"].startswith("v1/icon/marine/waves/global_mid/index/")


def test_a_run_past_its_time_budget_stops_starting_sets_and_keeps_their_index(tmp_path):
    store, out = tmp_path / "store", tmp_path / "out"
    _write_store(store)
    _write_set(store, "GFS", "swell_1", VALIDS)
    pub.publish_frame_sets(pub.LocalCache(store), pub.LocalSink(out), log=lambda *_: None)
    first = _latest(out)["sets"]["GFS/marine/swell_1/global_mid"]["index"]
    _write_store(store, run="2026-10-20T12:00:00Z", bump=0.2)
    ticks = itertools.chain([0.0, 0.0], itertools.repeat(999.0))      # past the budget after the first set, for EVERY later set
    report = pub.publish_frame_sets(pub.LocalCache(store), pub.LocalSink(out), log=lambda *_: None, budget_s=10,
                                    clock=lambda: next(ticks))
    assert report["GFS/marine/swell_1/global_mid"] == {"skipped_budget": True, "index": first}
    assert report[fs.set_key(TARGET)]["built"] == 3                  # the first set still ran
    assert _latest(out)["sets"]["GFS/marine/swell_1/global_mid"]["index"] == first


def test_an_older_runs_past_hours_not_on_this_disk_do_not_refuse_the_set(tmp_path):
    """2026-10-27 (the lead): the manifest kept 6 older-run past hours per regional set that the pilots runner never
    downloads; 41/47 = 0.872 < 0.9 refused every regional set for 11 h. Those hours are listed unbuilt (/grid serves
    them) and left out of the gate; the newest run's own hours still decide it."""
    store, out = tmp_path / "store", tmp_path / "out"
    old_valids = TEN[:2]
    old_names = _write_set(store, "GFS", "swell_1", old_valids, run="2026-10-20T00:00:00Z")
    for n in old_names:
        (store / n).unlink()                                          # the older run: not on this runner's disk
    _write_set(store, "GFS", "swell_1", TEN[2:], run="2026-10-20T06:00:00Z")
    report, _sink = _publish(store, out)
    stats = report["GFS/marine/swell_1/global_mid"]
    assert (stats["built"], stats["not_local"], stats["not_local_older_run"]) == (8, 2, 2)
    assert stats["coverage_refused"] is False and stats["coverage_authoritative"] == 1.0 and stats["coverage"] == 0.8
    index = json.loads((out / _latest(out)["sets"]["GFS/marine/swell_1/global_mid"]["index"]).read_text())
    assert [(f["valid_time"], f["path"] is None) for f in index["frames"][:3]] == [
        (TEN[0], True), (TEN[1], True), (TEN[2], False)]
    assert index["frames"][0]["unbuilt"] == "not_local"


def test_the_newest_runs_own_missing_hours_still_refuse_the_set(tmp_path):
    """Negative control for the older-run exclusion: the same two holes in the NEWEST run keep the gate shut."""
    store, out = tmp_path / "store", tmp_path / "out"
    names = _write_set(store, "GFS", "swell_1", TEN, run="2026-10-20T06:00:00Z")
    for n in names[:2]:
        (store / n).unlink()
    report, _sink = _publish(store, out)
    stats = report["GFS/marine/swell_1/global_mid"]
    assert (stats["built"], stats["not_local"], stats["not_local_older_run"]) == (8, 2, 0)
    assert stats["coverage_refused"] is True and stats["coverage_authoritative"] == 0.8 and stats["uploaded"] == 0
    assert not (out / fs.LATEST).exists()                             # nothing published, so no pointer either


def _sink_with_get_statuses(monkeypatch, statuses):
    """A SupabaseSink whose GETs answer `statuses` in order (an exception class is raised instead of answered)."""
    calls, waits = [], []

    class _Resp:
        def __init__(self, code):
            self.status_code, self.content, self.text = code, b'{"sets": {}}', ""

    class _Requests:
        ConnectionError, Timeout = ConnectionError, TimeoutError

        def get(self, url, headers=None, timeout=None):
            calls.append(url)
            s = statuses[len(calls) - 1]
            if isinstance(s, type):
                raise s("dropped")
            return _Resp(s)
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-not-a-key")
    monkeypatch.setattr(pub, "_sleep", waits.append)
    sink = pub.SupabaseSink()
    sink.requests = _Requests()
    return sink, calls, waits


def test_a_rate_limited_read_retries_with_the_upload_backoff(monkeypatch):
    """Run 40403486736: one 429 on latest.json failed the whole publish; a read now retries like a write."""
    sink, calls, waits = _sink_with_get_statuses(monkeypatch, [429, ConnectionError, 503, 200])
    assert sink.read(fs.LATEST) == b'{"sets": {}}'
    assert len(calls) == 4 and waits == list(pub.UPLOAD_BACKOFF_S)


def test_a_read_still_fails_after_the_last_retry_and_a_missing_object_never_retries(monkeypatch):
    sink, calls, waits = _sink_with_get_statuses(monkeypatch, [429, 429, 429, 429])
    with pytest.raises(RuntimeError, match="HTTP 429"):
        sink.read(fs.LATEST)
    assert len(calls) == 4 and waits == list(pub.UPLOAD_BACKOFF_S)
    sink, calls, waits = _sink_with_get_statuses(monkeypatch, [404])
    assert sink.read(fs.LATEST) is None and len(calls) == 1 and waits == []
    sink, calls, waits = _sink_with_get_statuses(monkeypatch, [403])
    with pytest.raises(RuntimeError, match="HTTP 403"):
        sink.read(fs.LATEST)                                          # not a retry status: fails at once
    assert len(calls) == 1 and waits == []

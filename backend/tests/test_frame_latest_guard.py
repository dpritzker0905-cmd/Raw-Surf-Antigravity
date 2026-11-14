"""latest.json write guard (services/frame_latest_guard.py, 2026-11-14, the advisor's red-team of #888).

Pins: a storage 400 that is not "object not found" is UNKNOWN and nothing is written (no frame, no index, no pointer); a missing
latest.json on a FRESH bucket allows the first write, but beside published objects it is refused (FRAME_LATEST_REBUILD=1 allows
it); a latest.json is never written with a set record dropped; both writers (the world/regional frames and the raster sets) obey;
the kill switch restores the old read; the pilots job passes the guard ON. Offline only (LocalSink, a fake `requests`).
"""
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
from services import frame_entitlement as fe  # noqa: E402
from services import frame_latest_guard as flg  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_raster as fsr  # noqa: E402

NOT_FOUND = b'{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}'
BAD_JWT = b'{"statusCode":"400","error":"InvalidJWT","message":"jwt malformed"}'
NO_BUCKET = b'{"statusCode":"404","error":"Bucket not found","message":"Bucket not found","code":"NoSuchBucket"}'
VALIDS = ["2026-10-20T06:00:00Z", "2026-10-20T09:00:00Z", "2026-10-20T12:00:00Z"]


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("FRAME_LATEST_GUARD", "FRAME_LATEST_REBUILD", "FRAME_REGIONAL_BUNDLES", "FRAME_EURO_SWELL_SETS", "FRAME_SETS"):
        monkeypatch.delenv(k, raising=False)


@pytest.mark.parametrize("status,body,absent", [
    (404, b"", True), (400, NOT_FOUND, True), (400, b'{"statusCode":"404","error":"not_found"}', True),
    (400, BAD_JWT, False), (400, NO_BUCKET, False), (400, b"<html>bad gateway</html>", False), (400, b"[]", False),
    (500, NOT_FOUND, False), (200, b"{}", False)])
def test_only_a_real_not_found_counts_as_absent(status, body, absent):
    assert flg.is_not_found(status, body) is absent


class _Resp:
    def __init__(self, status, body):
        self.status_code, self.content, self.text = status, body, body.decode("utf-8", "replace")


class _Requests:
    ConnectionError = ConnectionError
    Timeout = TimeoutError

    def __init__(self, status, body):
        self.status, self.body = status, body

    def get(self, url, headers=None, timeout=None):
        return _Resp(self.status, self.body)


def _supabase(monkeypatch, status, body):
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key-not-a-secret")
    sink = pub.SupabaseSink()
    sink.requests = _Requests(status, body)
    return sink


def test_the_strict_read_raises_on_a_400_that_is_not_not_found_and_the_loose_read_is_unchanged(monkeypatch):
    sink = _supabase(monkeypatch, 400, BAD_JWT)
    with pytest.raises(flg.LatestUnknown, match="HTTP 400"):
        sink.read_strict(fs.LATEST)
    assert sink.read(fs.LATEST) is None                     # every other caller keeps today's answer
    assert _supabase(monkeypatch, 400, NOT_FOUND).read_strict(fs.LATEST) is None


# ---- the world/regional writer (publish_frame_images.publish_frame_sets) ------------------------------------------------

def _product(valid, run="2026-10-20T06:00:00Z", cols=6, rows=4):
    vecs = []
    for r in range(rows):
        for c in range(cols):
            h, d = round(1.0 + 0.1 * r + 0.01 * c, 4), round((30.0 * c + 7.0 * r) % 360.0, 2)
            rad = math.radians(d)
            vecs.append({"lat": -60.0 + r * 40.0, "lng": -180.0 + c * 72.0, "speed": h, "direction": d,
                         "u": round(-h * math.sin(rad), 4), "v": round(-h * math.cos(rad), 4), "period": 8.0 + r,
                         "gust": None, "value": None, "is_valid": True, "dir_confidence": 0.9})
    return {"model": "GFS", "provider": "t", "domain": "marine", "layer": "waves", "run_time": run, "model_run_time": run,
            "model_run_time_status": "known", "ingested_at": run, "valid_time": valid, "is_forecast_authoritative": True,
            "is_estimated": False, "value_kind": "wave_height", "value_unit": "m", "display_unit_hint": "ft",
            "region_id": "global_mid",
            "grid": {"cols": cols, "rows": rows, "bounds": {"west": -180.0, "south": -62.0, "east": 180.0, "north": 61.0},
                     "vectors": vecs, "diagnostics": {"gridMode": "rectangular"}}}


def _store(store, run=VALIDS[0]):
    store.mkdir(parents=True, exist_ok=True)
    entries = []
    for vt in VALIDS:
        name = f"gfs_marine_waves_global_mid_{vt.replace('-', '').replace(':', '')}.json"
        (store / name).write_text(json.dumps(_product(vt, run)))
        entries.append({"model": "GFS", "domain": "marine", "layer": "waves", "region_id": "global_mid", "filename": name,
                        "valid_time_start": vt, "model_run_time": run, "run_time": run, "ingested_at": run,
                        "is_estimated": False})
    (store / "manifest.json").write_text(json.dumps({"products": entries}))


OTHER = {"sets": {"GFS/weather/pressure/global_0p5": {"index": "v1/gfs/weather/pressure/global_0p5/index/x.json", "run": "r"},
                  "EURO/weather/precipitation/global_0p25": {"index": "v1/euro/weather/precipitation/global_0p25/index/y.json"}},
         "version": 1}


class _FlakySink(pub.LocalSink):
    """A LocalSink whose strict latest.json read fails the way Supabase can (a 400 that is not "object not found")."""

    def read_strict(self, path):
        raise flg.LatestUnknown(f"read weather-frames/{path}: HTTP 400: {BAD_JWT.decode()}")


def _seed(out, doc=OTHER):
    (out / "v1").mkdir(parents=True, exist_ok=True)
    (out / fs.LATEST).write_text(json.dumps(doc))


def _frames(store, sink):
    return pub.publish_frame_sets(pub.LocalCache(store), sink, sets=[fs.SETS[0]], log=lambda *_: None)


def test_a_400_on_latest_json_publishes_nothing_and_keeps_every_other_set(tmp_path):
    _store(tmp_path / "s")
    _seed(tmp_path / "o")
    before = (tmp_path / "o" / fs.LATEST).read_bytes()
    sink = _FlakySink(tmp_path / "o")
    report = _frames(tmp_path / "s", sink)
    assert report["__latest__"]["refused"] is True and "HTTP 400" in report["__latest__"]["reason"]
    assert sink.order == [] and (tmp_path / "o" / fs.LATEST).read_bytes() == before      # not one object written


def test_a_fresh_bucket_takes_its_first_latest_json(tmp_path):
    _store(tmp_path / "s")
    sink = pub.LocalSink(tmp_path / "o")
    report = _frames(tmp_path / "s", sink)
    assert "__latest__" not in report and report[fs.set_key(fs.SETS[0])]["built"] == 3
    assert sink.order[-1] == fs.LATEST and list(json.loads((tmp_path / "o" / fs.LATEST).read_text())["sets"]) == \
        [fs.set_key(fs.SETS[0])]


def test_a_missing_latest_json_beside_published_objects_is_refused_unless_rebuild_is_asked(tmp_path, monkeypatch):
    _store(tmp_path / "s")
    (tmp_path / "o" / "v1" / "gfs").mkdir(parents=True)
    (tmp_path / "o" / "v1" / "gfs" / "frame.bin").write_bytes(b"x")                    # published objects, no latest.json
    sink = pub.LocalSink(tmp_path / "o")
    report = _frames(tmp_path / "s", sink)
    assert report["__latest__"]["refused"] and "not a first run" in report["__latest__"]["reason"]
    assert not (tmp_path / "o" / fs.LATEST).exists()
    monkeypatch.setenv("FRAME_LATEST_REBUILD", "1")
    assert "__latest__" not in _frames(tmp_path / "s", pub.LocalSink(tmp_path / "o"))
    assert (tmp_path / "o" / fs.LATEST).exists()


def test_the_world_writer_keeps_every_other_set_and_checks_before_it_writes(tmp_path, monkeypatch):
    _store(tmp_path / "s")
    _seed(tmp_path / "o")
    _frames(tmp_path / "s", pub.LocalSink(tmp_path / "o"))
    assert set(json.loads((tmp_path / "o" / fs.LATEST).read_text())["sets"]) == set(OTHER["sets"]) | {fs.set_key(fs.SETS[0])}
    # the write path consults the shrink check: a refusal writes no latest.json and runs no retention
    _store(tmp_path / "s", run="2026-10-20T12:00:00Z")                                # a new run: the pointer would move
    seen = []

    def refuse(new, base):
        seen.append((len(new["sets"]), len(base["sets"])))
        raise flg.LatestRefused("would drop 1 of 3 set records")
    monkeypatch.setattr(flg, "check_write", refuse)
    before = (tmp_path / "o" / fs.LATEST).read_bytes()
    report = _frames(tmp_path / "s", pub.LocalSink(tmp_path / "o"))
    assert seen and report["__latest__"]["refused"] and (tmp_path / "o" / fs.LATEST).read_bytes() == before
    assert all(s.get("deleted", 0) == 0 for k, s in report.items() if k != "__latest__")


def test_check_write_refuses_a_dropped_record_even_when_the_count_holds():
    base = {"sets": {"a": {}, "b": {}, "c": {}}}
    flg.check_write({"sets": {"a": {}, "b": {}, "c": {}, "d": {}}}, base)               # growing is fine
    with pytest.raises(flg.LatestRefused, match="drop 1 of 3"):
        flg.check_write({"sets": {"a": {}, "b": {}}}, base)                             # fewer
    with pytest.raises(flg.LatestRefused, match="drop 1 of 3"):
        flg.check_write({"sets": {"a": {}, "b": {}, "z": {}}}, base)                    # same count, c swapped for z
    with pytest.raises(flg.LatestRefused, match="drop 3 of 3"):
        flg.check_write({"version": 1, "sets": {}}, base)                               # the empty-document rebuild


def test_a_corrupt_latest_json_is_unknown(tmp_path):
    _seed(tmp_path / "o")
    (tmp_path / "o" / fs.LATEST).write_text("{not json")
    with pytest.raises(flg.LatestUnknown, match="not JSON"):
        flg.read_latest(pub.LocalSink(tmp_path / "o"))
    (tmp_path / "o" / fs.LATEST).write_text('{"sets": []}')
    with pytest.raises(flg.LatestUnknown, match="sets"):
        flg.read_latest(pub.LocalSink(tmp_path / "o"))


# ---- the raster writer (frame_set_raster.publish) ---------------------------------------------------------------------

CYCLE = datetime(2026, 11, 14, 0, tzinfo=timezone.utc)


class _Grib:
    def complete_cycle(self, now):
        return CYCLE

    def url(self, cycle, f):
        return f"https://example.invalid/f{f:03d}"

    def fetch(self, cycle, f):
        return 1010.0 + 0.0 * np.zeros((721, 1440)) + f * 0.1


def _raster(sink, hours=(0, 3)):
    sp = dict(fsr.SPECS["pressure"], hours=hours)
    return fsr.publish(_Grib(), sink, pub._uploader(sink), log=lambda *_: None, spec=sp)


def test_the_raster_writer_refuses_on_an_unknown_read_and_keeps_every_other_set(tmp_path):
    _seed(tmp_path / "o")
    before = (tmp_path / "o" / fs.LATEST).read_bytes()
    sink = _FlakySink(tmp_path / "o")
    report = _raster(sink)
    assert report["status"] == "latest_unknown" and sink.order == []
    assert (tmp_path / "o" / fs.LATEST).read_bytes() == before
    report = _raster(pub.LocalSink(tmp_path / "o"))
    assert report["status"] == "published"
    assert set(json.loads((tmp_path / "o" / fs.LATEST).read_text())["sets"]) == set(OTHER["sets"]) | {fsr.KEY}


class _SecondReadFails(pub.LocalSink):
    """The first read of latest.json works; the re-read just before the write hits a 400 (a loose read would say "missing")."""

    def __init__(self, out):
        super().__init__(out)
        self.latest_reads = 0

    def read_strict(self, path):
        if path == fs.LATEST:
            self.latest_reads += 1
            if self.latest_reads > 1:
                raise flg.LatestUnknown("HTTP 400")
        return super().read(path)

    def read(self, path):
        return None if path == fs.LATEST and self.latest_reads else super().read(path)


def test_the_raster_writer_rereads_strictly_before_it_writes(tmp_path):
    _seed(tmp_path / "o")
    before = (tmp_path / "o" / fs.LATEST).read_bytes()
    report = _raster(_SecondReadFails(tmp_path / "o"))
    assert report["status"] == "latest_unknown" and (tmp_path / "o" / fs.LATEST).read_bytes() == before


class _VanishesOnReread(pub.LocalSink):
    """latest.json is there for the first read and gone (absent) for the re-read, beside published objects."""

    def __init__(self, out):
        super().__init__(out)
        self.n = 0

    def read_strict(self, path):
        if path == fs.LATEST:
            self.n += 1
            if self.n > 1:
                return None
        return super().read(path)


def test_a_fresh_bucket_rereads_absent_but_a_vanished_latest_json_is_refused(tmp_path):
    assert _raster(pub.LocalSink(tmp_path / "fresh"))["status"] == "published"            # its own uploads are no fault
    assert fsr.KEY in json.loads((tmp_path / "fresh" / fs.LATEST).read_text())["sets"]
    _seed(tmp_path / "o")
    before = (tmp_path / "o" / fs.LATEST).read_bytes()
    report = _raster(_VanishesOnReread(tmp_path / "o"))
    assert report["status"] == "latest_unknown" and "not a first run" in report["reason"]
    assert (tmp_path / "o" / fs.LATEST).read_bytes() == before


def test_the_raster_writer_checks_the_reread_before_it_writes(tmp_path, monkeypatch):
    _seed(tmp_path / "o")
    monkeypatch.setattr(flg, "check_write", lambda new, base: (_ for _ in ()).throw(flg.LatestRefused("drop")))
    before = (tmp_path / "o" / fs.LATEST).read_bytes()
    assert _raster(pub.LocalSink(tmp_path / "o"))["status"] == "latest_refused"
    assert (tmp_path / "o" / fs.LATEST).read_bytes() == before


# ---- the switch, the entitled sink, the workflow ----------------------------------------------------------------------

def test_the_kill_switch_restores_the_old_read(tmp_path, monkeypatch):
    monkeypatch.setenv("FRAME_LATEST_GUARD", "0")
    _store(tmp_path / "s")
    (tmp_path / "o" / "v1" / "gfs").mkdir(parents=True)
    (tmp_path / "o" / "v1" / "gfs" / "frame.bin").write_bytes(b"x")
    assert "__latest__" not in _frames(tmp_path / "s", pub.LocalSink(tmp_path / "o"))     # absent beside objects: rebuilt
    flg.check_write({"sets": {}}, {"sets": {"a": {}}})                                   # no shrink check


def test_the_entitled_sink_reads_latest_json_strictly_from_the_public_bucket(tmp_path):
    calls = []

    class _Pub(pub.LocalSink):
        def read_strict(self, path):
            calls.append(path)
            raise flg.LatestUnknown("HTTP 400")
    sink = fe.EntitledSink(_Pub(tmp_path / "pub"), pub.LocalSink(tmp_path / "priv"))
    with pytest.raises(flg.LatestUnknown):
        flg.read_latest(sink)
    assert calls == [fs.LATEST]
    (tmp_path / "priv" / "v1").mkdir(parents=True)
    (tmp_path / "priv" / "v1" / "f.bin").write_bytes(b"x")
    assert sink.has_any("v1") is True


def test_the_pilots_job_runs_with_the_guard_on():
    yml = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    job = yml.split("  ingest-pilots:", 1)[1].split("    steps:", 1)[0]
    assert "FRAME_LATEST_GUARD: ${{ vars.FRAME_LATEST_GUARD || '1' }}" in job

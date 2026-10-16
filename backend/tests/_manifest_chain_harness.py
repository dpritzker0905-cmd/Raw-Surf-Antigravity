"""Shared in-memory harness for the MANIFEST_PUBLISH_ONE_STEP tests (a helper, NOT a test module: it has no tests and no CI lane).

`Chain` is the pointer row plus the object store, speaking production's names and signatures; the executors park or run the
publisher's jobs; the fixtures wire all of it in. Import the fixtures by name into a test module (the autouse ones apply there)."""
import json
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

import services.weather_pipeline.store as store_mod
from services.weather_pipeline import manifest_pointer as mp
from services.weather_pipeline import manifest_publish_step as mps
from services.weather_pipeline import store_helpers
from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, ManifestProduct, NormalizedGrid, NormalizedProduct, PipelineManifest,
)
from services.weather_pipeline.store import ProductStore, dump_manifest_for_l2, reconcile_manifest_products_for_upload


FLAG = "MANIFEST_PUBLISH_ONE_STEP"


RUN_TIME = datetime(2026, 10, 16, 13, 53, tzinfo=timezone.utc)


VALID = datetime(2026, 10, 25, 3, tzinfo=timezone.utc)      # in the future: nothing here is past retention


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """Everything here is in memory. A request is recorded AND refused, and the test fails at teardown even if the code
    under test swallowed the refusal (the manifest code catches `Exception` everywhere, by design)."""
    import requests
    attempted = []

    def refuse(self, method, url, *args, **kwargs):
        attempted.append((method, url))
        raise AssertionError("this test must not make an HTTP request: %s %s" % (method, url))
    monkeypatch.setattr(requests.sessions.Session, "request", refuse)
    yield attempted
    assert attempted == [], "a real HTTP request was attempted: %s" % attempted


OLD_RUN, NEW_RUN = RUN_TIME, RUN_TIME + timedelta(hours=1)


BOUNDS = CoverageBounds(west=-88, south=28, east=-86, north=30)


class RecordingExecutor:
    """`_manifest_executor` with its queue in view: submit() parks the call, run() runs them FIFO."""

    def __init__(self, log=None):
        self.log = log if log is not None else []
        self.queue = []

    def submit(self, fn, *args, **kwargs):
        self.log.append(("submit", fn, args, kwargs))
        self.queue.append((fn, args, kwargs))

    def run(self):
        while self.queue:
            fn, args, kwargs = self.queue.pop(0)
            fn(*args, **kwargs)


class InlineExecutor(RecordingExecutor):
    """Runs every job on the submitting thread, at once."""

    def submit(self, fn, *args, **kwargs):
        super().submit(fn, *args, **kwargs)
        self.run()


def _entry(filename, *, newer=False, old=False, **over):
    valid = VALID - timedelta(days=30) if old else VALID
    fields = dict(
        model="GFS", domain="marine", layer="waves", provider="noaa" if newer else "legacy",
        run_time=NEW_RUN if newer else OLD_RUN, valid_time_start=valid, valid_time_end=valid,
        filename=filename, product_id=filename, region_id="gulf", coverage=BOUNDS, resolution=0.25,
        freshness_sec=0, is_forecast_authoritative=True, is_estimated=False,
    )
    fields.update(over)
    return ManifestProduct(**fields)


def _raw_entry(filename, **over):
    return json.loads(_entry(filename, **over).model_dump_json())


def _files(data):
    return sorted(p["filename"] for p in json.loads(data)["products"])


def _wind(filename, estimated=False, **over):
    fields = dict(
        model="EURO", provider="estimated" if estimated else "ecmwf", domain="wind", layer="wind",
        run_time=RUN_TIME, valid_time_start=VALID, valid_time_end=VALID, resolution=0.25, freshness_sec=3600,
        is_forecast_authoritative=not estimated, coverage=CoverageBounds(west=-180, south=-80, east=180, north=84),
        filename=filename, product_id=filename, region_id="global_mid", is_estimated=estimated,
    )
    fields.update(over)
    return ManifestProduct(**fields)


def _snapshot(files):
    """`files` items are a filename, or (filename, field overrides) for an entry this writer changed."""
    products = []
    for item in files:
        name, over = (item, {}) if isinstance(item, str) else item
        products.append(_wind(name, estimated=name.endswith("_estimated.json"), **over))
    return PipelineManifest(last_manifest_update=RUN_TIME, products=products)


def _raw_wind(filename, **over):
    return json.loads(_wind(filename, estimated=filename.endswith("_estimated.json"), **over).model_dump_json())


def adding(*names):
    return lambda products: products + [_raw_wind(n) for n in names]


def removing(*names):
    return lambda products: [p for p in products if p["filename"] not in names]


def changing(name, **over):
    return lambda products: [dict(p, **over) if p["filename"] == name else p for p in products]


BASE = ["euro_wind_wind_global_mid_20261024T000000Z.json", "euro_wind_wind_global_mid_20261024T060000Z.json"]


PILOTS_NEW = ["euro_wind_wind_global_mid_20261025T060000Z.json"]


LATTICE = [f"euro_wind_wind_global_mid_202610{d}T{h}0000Z_estimated.json"
           for d in (22, 23, 24) for h in ("03", "09", "15", "21")] + [
    "euro_wind_wind_global_mid_20261025T150000Z_estimated.json",
    "euro_wind_wind_global_mid_20261025T210000Z_estimated.json"]          # the 14 the core run's fill registered


UNIQUE_KEY = re.compile(r"manifests/manifest-g(\d{12})-[0-9a-f]{32}\.json")


class Chain:
    """The pointer row and the object store, in memory, with the failure modes the real ones have.

    - `read_pointer` / `fetch_manifest_object` never raise (None on any failure), like the real ones.
    - `upload` is `ProductStore._upload_to_supabase`: strict returns True on acknowledgment and RAISES on failure
      (HTTP 429 included); `overwrite=False` is `x-upsert: false`, so a create-only upload over an existing key is a 409;
      a successful manifest.json PUT runs the REAL publish_run_keyed, exactly as the real method does.
    - `cas_advance` is Postgres' `UPDATE ... WHERE generation = expected`.
    - `foreign_publish` is ANOTHER writer's commit on the old path: the head's products edited, one generation on, under
      the PRODUCTION name `manifests/manifest-g<N+1>.json` (deterministic, overwritten in place, x-upsert true).
    """

    def __init__(self, base_files):
        self.generation = 5
        self.objects = {}
        self.head_key = mp.run_keyed_manifest_key(5)
        self.objects[self.head_key] = dump_manifest_for_l2(_snapshot(base_files))
        self.events = []                  # ("read_pointer",) ("fetch", key) ("upload", key, strict, overwrite) ("cas", ...)
        self.cas_calls = []               # per CAS: expected, won, key, and the candidate's files AT CAS TIME
        self.uploads = []                 # (key, strict, overwrite) for every call through `upload`
        self.deleted = []
        self.nested_publishes = []        # what publish_run_keyed returned when a manifest.json PUT re-entered it
        self.pointer_faults = []          # consumed one per read_pointer: "none"
        self.fetch_faults = []            # consumed one per fetch_manifest_object: "none"
        self.upload_faults = []           # consumed one per strict manifests/ upload: "429" | "lost_ack" | "none_ack"
        self.cas_faults = []              # consumed one per cas_advance: "lost_ack" | "error"
        self.before_cas = None            # single-shot hooks
        self.during_upload = None
        self.during_legacy_put = None
        self.fail_manifest_json_put = False

    # ── what the code under test calls ──
    def read_pointer(self):
        self.events.append(("read_pointer",))
        fault = self.pointer_faults.pop(0) if self.pointer_faults else None
        return None if fault == "none" else {"generation": self.generation, "manifest_key": self.head_key}

    def fetch_manifest_object(self, key):
        self.events.append(("fetch", key))
        fault = self.fetch_faults.pop(0) if self.fetch_faults else None
        return None if fault == "none" else self.objects.get(key)

    def fetch_pointed_manifest(self):
        self.events.append(("fetch_pointed",))
        return self.objects[self.head_key]

    def cas_advance(self, expected_generation, manifest_key, run_id, written_by):
        if self.before_cas:
            hook, self.before_cas = self.before_cas, None
            hook()
        fault = self.cas_faults.pop(0) if self.cas_faults else None
        won = expected_generation == self.generation and fault != "error"
        self.cas_calls.append({"expected": expected_generation, "won": won, "key": manifest_key,
                               "files": _files(self.objects[manifest_key]) if manifest_key in self.objects else None})
        self.events.append(("cas", expected_generation, manifest_key, won))
        if won:
            self.generation += 1
            self.head_key = manifest_key
        return False if fault == "lost_ack" else won

    def upload(self, key, data, *, strict=False, overwrite=True):
        self.uploads.append((key, strict, overwrite))
        self.events.append(("upload", key, strict, overwrite))
        if key.startswith("manifests/") and self.during_upload:
            hook, self.during_upload = self.during_upload, None
            hook()
        if key == "manifest.json" and self.during_legacy_put:
            hook, self.during_legacy_put = self.during_legacy_put, None
            hook()
        fault = self.upload_faults.pop(0) if (self.upload_faults and key.startswith("manifests/") and strict) else None
        if fault == "429":
            raise RuntimeError("HTTP 429: SlowDown")
        if not overwrite and key in self.objects:
            raise RuntimeError("HTTP 409: the resource already exists")
        if key == "manifest.json" and self.fail_manifest_json_put:
            raise RuntimeError("HTTP 503: SlowDown")
        self.objects[key] = data
        if key == "manifest.json":
            self.nested_publishes.append(mp.publish_run_keyed(None, data, self.upload, self.delete))
        if fault == "lost_ack":
            raise RuntimeError("timed out waiting for the acknowledgment")          # the object landed, the answer did not
        if fault == "none_ack":
            return None                                                             # the object landed, no acknowledgment
        return True if strict else None

    def delete(self, key):
        self.deleted.append(key)
        self.objects.pop(key, None)

    # ── what the tests look at ──
    def head_files(self):
        return _files(self.objects[self.head_key])

    def head_entry(self, filename):
        return next(p for p in json.loads(self.objects[self.head_key])["products"] if p["filename"] == filename)

    def kinds(self, kind):
        return [e for e in self.events if e[0] == kind]

    def wins(self):
        return [c for c in self.cas_calls if c["won"]]

    def foreign_publish(self, *edits, key=None):
        """Another writer's commit. `key="unique"` names its object like a one-step publisher would."""
        doc = json.loads(self.objects[self.head_key])
        for edit in edits:
            doc["products"] = edit(doc["products"])
        doc["written_by"] = "designated:gh-run-other"
        self.generation += 1
        if key == "unique":
            key = "manifests/manifest-g%012d-%s.json" % (self.generation, "f0" * 16)
        self.head_key = key or mp.run_keyed_manifest_key(self.generation)
        self.objects[self.head_key] = json.dumps(doc, indent=2).encode("utf-8")


class FakeStore:
    """ProductStore as far as the publisher sees it: a place to upload to."""

    def __init__(self, chain):
        self.chain = chain

    def _upload_to_supabase(self, filename, data_bytes, *, strict=False, overwrite=True):
        return self.chain.upload(filename, data_bytes, strict=strict, overwrite=overwrite)

    def _delete_from_supabase(self, filename):
        self.chain.delete(filename)


@pytest.fixture
def chain(monkeypatch):
    for name in ("MANIFEST_IMMUTABLE_PUBLICATION", "INGEST_PRUNE_VERIFIED_CYCLES", "MANIFEST_MERGE_ON_UPLOAD",
                 "MANIFEST_MERGE_PREFER_NEWER", "MANIFEST_RETENTION_ON_UPLOAD"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv(FLAG, "1")
    monkeypatch.setenv("MANIFEST_RETENTION_DAYS", "36500")
    c = Chain(BASE)
    monkeypatch.setattr(mp, "pointer_enabled", lambda: True)
    monkeypatch.setattr(mp, "read_pointer", c.read_pointer)
    monkeypatch.setattr(mp, "cas_advance", c.cas_advance)
    monkeypatch.setattr(mp, "fetch_manifest_object", c.fetch_manifest_object)
    monkeypatch.setattr(mp, "fetch_pointed_manifest", c.fetch_pointed_manifest)
    monkeypatch.setattr(store_mod, "_l2_pipeline_writes_allowed", lambda: True)
    from services.weather_pipeline import manifest_immutable
    monkeypatch.setattr(manifest_immutable, "prune_immutable_copies",
                        lambda generation, **kwargs: c.events.append(("prune", generation)))
    return c


@pytest.fixture
def store(chain):
    return FakeStore(chain)


@pytest.fixture
def parked(monkeypatch):
    """`_manifest_executor` whose jobs wait until the test says so."""
    executor = RecordingExecutor()
    monkeypatch.setattr(store_mod, "_manifest_executor", executor)
    return executor


@pytest.fixture
def inline(monkeypatch):
    executor = InlineExecutor()
    monkeypatch.setattr(store_mod, "_manifest_executor", executor)
    return executor


def submit(store, files, exclude_keys=None):
    mps.submit_manifest_publish(store, _snapshot(files), exclude_keys)


@pytest.fixture(autouse=True)
def sleeps(monkeypatch):
    """The publisher backs off between attempts. No test sleeps for real; the waits it asked for are recorded."""
    asked = []
    monkeypatch.setattr(mps, "_sleep", asked.append)
    return asked


@pytest.fixture(autouse=True)
def _fresh_slot(monkeypatch):
    """The coalescing slot is process state (like the manifest cache); a test must not inherit another's."""
    monkeypatch.setattr(mps, "_slot", mps._Slot())


def _keep_moving(chain, times):
    """A head that moves inside every CAS (another writer commits between our upload and our swap), `times` times."""
    moves = []

    def move():
        if len(moves) < times:
            moves.append(1)
            chain.before_cas = move
            chain.foreign_publish(adding("euro_wind_wind_global_mid_20261026T%02d0000Z.json" % len(moves)))
    chain.before_cas = move
    return moves


def _iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


SAVES = ["euro_wind_wind_global_mid_202610%02dT000000Z.json" % (26 + i) for i in range(5)]


PRUNED = ["euro_wind_wind_global_mid_202610%02dT060000Z.json" % (20 + i) for i in range(5)]

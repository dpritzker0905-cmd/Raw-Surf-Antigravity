"""Shared in-memory harness for the MANIFEST_PUBLISH_ONE_STEP tests (a helper, NOT a test module: it has no tests and no CI lane).

`Chain` is the pointer row plus the object store, speaking production's names and signatures; the executors park or run the
publisher's jobs; the fixtures wire all of it in. Import the fixtures by name into a test module (the autouse ones apply there)."""
import json
import re
from datetime import datetime, timedelta, timezone

import pytest

import services.weather_pipeline.store as store_mod
from services.weather_pipeline import manifest_pointer as mp
from services.weather_pipeline import manifest_publish_step as mps
from services.weather_pipeline import store_helpers
from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, ManifestProduct, NormalizedGrid, NormalizedProduct, PipelineManifest,
)
from services.weather_pipeline.store import ProductStore, dump_manifest_for_l2


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
        # Storage's listing and bulk delete (what retention talks to), with a clock the tests move.
        self.now = datetime.now(timezone.utc)
        self.created = {}                 # key -> the clock when the object was stored
        self.list_requests = []           # (url, json body, timeout)
        self.delete_requests = []
        self.list_fault = self.delete_fault = None      # "raise" | an HTTP status
        self.unexpected = []              # requests nothing here knows how to answer
        self.extra_rows = []              # raw rows the listing also returns (to hand retention timestamps it cannot read)

    # ── what the code under test calls ──
    def read_pointer(self):
        self.events.append(("read_pointer",))
        fault = self.pointer_faults.pop(0) if self.pointer_faults else None
        return None if fault == "none" else {"generation": self.generation, "manifest_key": self.head_key}

    def fetch_manifest_object(self, key):
        self.events.append(("fetch", key))
        fault = self.fetch_faults.pop(0) if self.fetch_faults else None
        if fault == "none":
            return None                                  # a transient failure: 5xx, timeout, 429
        return self.objects[key] if key in self.objects else mp.MISSING    # a definite miss: HTTP 404 / NoSuchKey

    def fetch_pointed_manifest(self):
        self.events.append(("fetch_pointed",))
        return self.objects.get(self.head_key)

    def fetch_legacy_products(self):
        """store._fetch_remote_manifest_products(): the pointed object, else the legacy manifest.json, else None."""
        self.events.append(("fetch_legacy",))
        data = self.objects.get(self.head_key) or self.objects.get("manifest.json")
        return None if data is None else (json.loads(data).get("products") or [])

    def cas_advance(self, expected_generation, manifest_key, run_id, written_by, expected_key=None):
        """`UPDATE ... WHERE generation = expected [AND manifest_key = expected_key]`."""
        if self.before_cas:
            hook, self.before_cas = self.before_cas, None
            hook()
        fault = self.cas_faults.pop(0) if self.cas_faults else None
        won = (expected_generation == self.generation and (expected_key is None or expected_key == self.head_key)
               and fault != "error")
        self.cas_calls.append({"expected": expected_generation, "won": won, "key": manifest_key, "expected_key": expected_key,
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
        self.created[key] = self.now
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
        doc = json.loads(self.objects.get(self.head_key) or self.objects["manifest.json"])      # a missing head: what the old path left
        for edit in edits:
            doc["products"] = edit(doc["products"])
        doc["written_by"] = "designated:gh-run-other"
        self.generation += 1
        if key == "unique":
            key = "manifests/manifest-g%012d-%s.json" % (self.generation, "f0" * 16)
        self.head_key = key or mp.run_keyed_manifest_key(self.generation)
        self.objects[self.head_key] = json.dumps(doc, indent=2).encode("utf-8")
        self.created[self.head_key] = self.now

    # ── Storage, as requests.post / requests.delete reach it ──
    def storage_post(self, url, **kwargs):
        if not url.endswith("/storage/v1/object/list/weather-products"):
            self.unexpected.append(("POST", url))
            raise AssertionError("unexpected POST " + url)
        body = kwargs["json"]
        self.list_requests.append((url, body, kwargs.get("timeout")))
        self.events.append(("list",))
        if self.list_fault == "raise":
            raise RuntimeError("connection reset")
        if self.list_fault:
            return _StorageResponse(self.list_fault, {"error": "boom"})
        rows = [{"name": key[len("manifests/"):], "created_at": self.created.get(key, self.now).isoformat(),
                 "updated_at": self.created.get(key, self.now).isoformat()}
                for key in self.objects if key.startswith("manifests/") and body["search"] in key]
        rows += [dict(row) for row in self.extra_rows]
        rows.sort(key=lambda row: row["name"], reverse=body["sortBy"]["order"] == "desc")
        return _StorageResponse(200, rows[body["offset"]:body["offset"] + body["limit"]])

    def storage_delete(self, url, **kwargs):
        if not url.endswith("/storage/v1/object/weather-products"):
            self.unexpected.append(("DELETE", url))
            raise AssertionError("unexpected DELETE " + url)
        prefixes = kwargs["json"]["prefixes"]
        self.delete_requests.append((url, prefixes, kwargs.get("timeout")))
        self.events.append(("delete_batch", len(prefixes)))
        if self.delete_fault == "raise":
            raise RuntimeError("connection reset")
        if self.delete_fault:
            return _StorageResponse(self.delete_fault, {"error": "boom"})
        for key in prefixes:
            self.objects.pop(key, None)
            self.deleted.append(key)
        return _StorageResponse(200, [])

    def copies(self):
        """The unique-named run-keyed objects still in Storage, oldest first."""
        return sorted(key for key in self.objects if UNIQUE_KEY.fullmatch(key))


class _StorageResponse:
    def __init__(self, status_code, body):
        self.status_code, self._body = status_code, body
        self.text = json.dumps(body)

    def json(self):
        return self._body


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
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", c.fetch_legacy_products)
    monkeypatch.setattr(store_mod, "_l2_pipeline_writes_allowed", lambda: True)
    # Retention is NOT stubbed: it runs for real against the Chain's Storage (listing, bulk delete, a clock).
    import requests
    monkeypatch.setattr(mp, "_rest_base_and_headers", lambda: ("https://storage.invalid", {"apikey": "test-key"}))
    monkeypatch.setattr(requests, "post", c.storage_post)
    monkeypatch.setattr(requests, "delete", c.storage_delete)
    monkeypatch.setattr(mps, "_utcnow", lambda: c.now)
    yield c
    assert c.unexpected == [], "requests the harness could not answer: %s" % c.unexpected


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


# ── the six call sites, each driven against a disk store ──


def _normalized(name_run=OLD_RUN):
    return NormalizedProduct(
        model="GFS", provider="noaa", domain="marine", layer="waves", run_time=name_run, valid_time=VALID,
        coverage=BOUNDS, region_id="gulf", is_forecast_authoritative=True, is_estimated=False, freshness_sec=0,
        value_kind="height", value_unit="m", display_unit_hint="ft", source_variables=["hs"],
        grid=NormalizedGrid(bounds=BOUNDS, cols=1, rows=1, vectors=[GridVector(lat=29, lng=-87, speed=2)]))


def _verified(filename, cycle_hours, received_hours=0):
    p = _entry(filename, provider="noaa", coverage_mode="regional_tile")
    p.model_run_time = OLD_RUN + timedelta(hours=cycle_hours)
    p.model_run_time_status = "known"
    p.run_time = OLD_RUN + timedelta(hours=received_hours)
    return p


def _disk_store(tmp_path, products=()):
    store = ProductStore(cache_dir=tmp_path)
    store._save_manifest(PipelineManifest(products=list(products), last_manifest_update=RUN_TIME))
    for p in products:
        (tmp_path / p.filename).write_bytes(b"frame")
    return store


# Each driver: (store, monkeypatch) -> runs ONE call site against a store that holds its fixtures; returns the
# `exclude_keys` the site is expected to hand reconcile (None = it passes none).
def _drive_save_product(tmp_path, monkeypatch):
    store = _disk_store(tmp_path)
    store_helpers.save_product_helper(store, _normalized())
    return store, None


def _drive_save_batch(tmp_path, monkeypatch):
    store = _disk_store(tmp_path)
    assert store_helpers.save_products_batch_helper(store, [(_normalized(), 0.25)]) == 1
    return store, None


def _drive_prune_old(tmp_path, monkeypatch):
    store = _disk_store(tmp_path, [_entry("old.json", old=True), _entry("new.json", newer=True)])
    store.prune_old_products(VALID - timedelta(days=2))
    return store, {"old.json"}


def _drive_duplicate_sweep(tmp_path, monkeypatch):
    store = _disk_store(tmp_path, [_entry("old.json"), _entry("new.json", newer=True)])
    assert store.prune_duplicate_valid_times() == 1
    return store, {"old.json"}


def _drive_superseded(tmp_path, monkeypatch):
    store = _disk_store(tmp_path, [_entry("old.json"), _entry("new.json", newer=True)])
    store.prune_superseded_products("GFS", "marine", "waves", "gulf", NEW_RUN)
    return store, {"old.json"}


def _drive_verified_cycles(tmp_path, monkeypatch):
    monkeypatch.setenv("INGEST_PRUNE_VERIFIED_CYCLES", "1")
    store = _disk_store(tmp_path, [_verified("older.json", -6, received_hours=1), _verified("newest.json", 0)])
    assert store.prune_duplicate_valid_times() == 1
    return store, {"older.json"}


SITES = {
    "store_helpers.save_product_helper": _drive_save_product,
    "store_helpers.save_products_batch_helper": _drive_save_batch,
    "copernicus_validator.prune_old_products_helper": _drive_prune_old,
    "copernicus_validator.prune_duplicate_valid_times_helper": _drive_duplicate_sweep,
    "copernicus_validator.prune_superseded_products_helper": _drive_superseded,
    "prune_verified_cycles.prune_verified_cycles": _drive_verified_cycles,
}

"""MANIFEST_PUBLISH_ONE_STEP: the manifest's merge and its compare-and-swap happen in ONE step, on one thread.

WHY (2026-10-16). manifest.json is rewritten whole by several concurrent CI writers (core ingest, pilots, precompute).
Every upload used to be three separate moments: reconcile (fold the head's entries in, on the CALLER's thread), dump,
then a queued PUT whose publish_run_keyed read the pointer at PUBLISH time and CASed from that fresh generation. A
snapshot merged against generation g0 but published after another writer committed g1 therefore erased that writer's
registrations (14 EURO wind estimated frames, 2026-10-16). The previous attempt (PR #344) patched the old path with a
basis registry, a 3-way merge, tombstones and an own-publish skip, and two independent reviews found a new
"fall back to the old publish path" corner in each patch.

THE DESIGN HERE HAS NO SUCH CORNER. With the flag on, a save only serializes its snapshot (cheap, thread-safe) and hands
it to a coalescing slot; ONE job on the manifest executor then reads the pointer (generation g), GETs the object the
pointer names, merges with the existing reconcile semantics, uploads a UNIQUE create-only object and CASes from g, the
SAME generation it merged against. Nothing that fails ever publishes the snapshot unmerged: it is retried, and after
five attempts it stays pending for the next job.

This file is production-faithful where it matters: `Chain` is the pointer row plus the object store, in memory, speaking
production's names and signatures (a foreign writer on the old path commits `manifests/manifest-g<N+1>.json`, `upload`
takes strict/overwrite like `_upload_to_supabase` and answers 409 for a create-only upload over an existing key). The
merge, the serializer, publish_run_keyed and the call sites are the real code. Any real HTTP request fails the test.
"""
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


# ── the six call sites: with the flag OFF each does exactly what it did before the helper existed ──────────────────────
# (These are characterization tests: they were written and run against the code BEFORE the call sites were touched.)

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


@pytest.fixture
def site_env(monkeypatch):
    """The store's executors and L2 are recorded; the L2 'remote' manifest is empty. Returns the shared event log."""
    log = []
    monkeypatch.setenv("MANIFEST_RETENTION_DAYS", "36500")
    monkeypatch.setattr(store_mod, "_manifest_executor", RecordingExecutor(log))
    monkeypatch.setattr(store_mod, "_upload_executor", InlineExecutor())
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: [])
    monkeypatch.setattr(ProductStore, "_cached_manifest", None)
    real_reconcile, real_dump = store_mod.reconcile_manifest_products_for_upload, store_mod.dump_manifest_for_l2

    def reconcile(manifest, **kwargs):
        log.append(("reconcile", manifest, kwargs))
        return real_reconcile(manifest, **kwargs)

    def dump(manifest):
        data = real_dump(manifest)
        log.append(("dump", manifest, data))
        return data
    monkeypatch.setattr(store_mod, "reconcile_manifest_products_for_upload", reconcile)
    monkeypatch.setattr(store_mod, "dump_manifest_for_l2", dump)
    # The lane is otherwise AVAILABLE here (designated writer, pointer table present), so only the flag keeps it off.
    monkeypatch.setattr(mp, "pointer_enabled", lambda: True)
    monkeypatch.setattr(store_mod, "_l2_pipeline_writes_allowed", lambda: True)
    monkeypatch.setattr(mp, "read_pointer", lambda: pytest.fail("flag off: no pointer read on the caller's thread"))
    monkeypatch.setattr(mp, "fetch_manifest_object", lambda key: pytest.fail("flag off: no head GET by key"))
    return log


@pytest.mark.parametrize("flag", [None, "0", "true", ""], ids=["unset", "0", "true", "empty"])
@pytest.mark.parametrize("site", sorted(SITES))
def test_flag_off_each_call_site_reconciles_then_dumps_then_queues_the_manifest_json_upload(
        site, flag, site_env, monkeypatch, tmp_path):
    """The three-line pattern, unchanged: reconcile (exclude_keys only where the site passes them), dump, then
    `_manifest_executor.submit(store._upload_to_supabase, "manifest.json", <the dumped bytes>)`. The upload is QUEUED,
    not run, and nothing is read from the pointer. Any value but exactly "1" is off."""
    if flag is None:
        monkeypatch.delenv(FLAG, raising=False)
    else:
        monkeypatch.setenv(FLAG, flag)
    store, expected_exclude = SITES[site](tmp_path, monkeypatch)
    log = [event for event in site_env if event[0] in ("reconcile", "dump", "submit")]
    order = [event[0] for event in log]
    assert order == ["reconcile", "dump", "submit"], order
    reconcile, dump, submit = log
    assert reconcile[1] is dump[1], "the manifest reconcile mutated is the manifest that is dumped"
    if expected_exclude is None:
        assert reconcile[2] == {}, "this site passes no exclude_keys"
    else:
        assert set(reconcile[2]["exclude_keys"]) == expected_exclude and set(reconcile[2]) == {"exclude_keys"}
    _, fn, args, kwargs = submit
    assert fn == store._upload_to_supabase
    assert args == ("manifest.json", dump[2]) and kwargs == {}
    assert len(store_mod._manifest_executor.queue) == 1, "queued, not run"


# ── reconcile_manifest_products_for_upload(remote_products=...): merge against a head the caller already holds ───────────

def _raw_entry(filename, **over):
    return json.loads(_entry(filename, **over).model_dump_json())


def test_reconcile_with_remote_products_merges_against_them_and_never_fetches(monkeypatch):
    """The one-step job holds the head it read by generation; reconcile must use THAT list, not fetch another one."""
    monkeypatch.setenv("MANIFEST_RETENTION_DAYS", "36500")
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: pytest.fail("fetched a second head"))
    manifest = PipelineManifest(last_manifest_update=RUN_TIME, products=[_entry("ours.json")])
    folded = reconcile_manifest_products_for_upload(
        manifest, exclude_keys={"pruned.json"},
        remote_products=[_raw_entry("ours.json"), _raw_entry("theirs.json"), _raw_entry("pruned.json")])
    assert folded == 1
    assert sorted(p.filename for p in manifest.products) == ["ours.json", "theirs.json"]


def test_reconcile_with_an_empty_remote_products_list_still_does_not_fetch(monkeypatch):
    """[] is a head with no products, not 'unknown': it must not trigger the fetch that None means."""
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: pytest.fail("fetched a second head"))
    manifest = PipelineManifest(last_manifest_update=RUN_TIME, products=[_entry("ours.json")])
    assert reconcile_manifest_products_for_upload(manifest, remote_products=[]) == 0
    assert [p.filename for p in manifest.products] == ["ours.json"]


def test_reconcile_without_remote_products_fetches_exactly_as_before(monkeypatch):
    monkeypatch.setenv("MANIFEST_RETENTION_DAYS", "36500")
    fetched = []
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products",
                        lambda: fetched.append(1) or [_raw_entry("theirs.json")])
    manifest = PipelineManifest(last_manifest_update=RUN_TIME, products=[_entry("ours.json")])
    assert reconcile_manifest_products_for_upload(manifest) == 1
    assert fetched == [1]
    manifest = PipelineManifest(last_manifest_update=RUN_TIME, products=[_entry("ours.json")])
    assert reconcile_manifest_products_for_upload(manifest, remote_products=None) == 1
    assert fetched == [1, 1]


def test_reconcile_swallows_a_failure_when_it_fetches_but_raises_when_the_caller_supplied_the_head(monkeypatch):
    """Fetching: 'never raises, the local snapshot is the upload basis' is the documented pre-fix behaviour and stays.
    Supplied: the caller is about to CAS the result, and a swallowed failure would hand it an UNMERGED snapshot that looks
    merged, so the failure must reach the caller."""
    monkeypatch.setattr(store_mod, "manifest_retention_cutoff", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: [_raw_entry("theirs.json")])
    manifest = PipelineManifest(last_manifest_update=RUN_TIME, products=[_entry("ours.json")])
    assert reconcile_manifest_products_for_upload(manifest) == 0
    with pytest.raises(RuntimeError, match="boom"):
        reconcile_manifest_products_for_upload(manifest, remote_products=[_raw_entry("theirs.json")])


# ── manifest_pointer.fetch_manifest_object(key): the head, fetched by the key the pointer names ──────────────────────

class _Response:
    def __init__(self, status_code=200, content=b"{}"):
        self.status_code, self.content, self.text = status_code, content, content.decode("utf-8", "replace")


@pytest.fixture
def storage_get(monkeypatch):
    """requests.get, recorded. `answers` is consumed one per call (an Exception instance is raised)."""
    import requests
    calls, answers = [], []
    monkeypatch.setattr(mp, "_rest_base_and_headers", lambda: ("https://storage.invalid", {"apikey": "test-key"}))

    def get(url, **kwargs):
        calls.append((url, kwargs))
        answer = answers.pop(0) if answers else _Response()
        if isinstance(answer, Exception):
            raise answer
        return answer
    monkeypatch.setattr(requests, "get", get)
    return SimpleNamespace(calls=calls, answers=answers)


def test_fetch_manifest_object_returns_the_bytes_of_the_object_named_by_the_key(storage_get):
    key = "manifests/manifest-g000000000006-" + "ab" * 16 + ".json"
    storage_get.answers.append(_Response(200, b'{"products": []}'))
    assert mp.fetch_manifest_object(key) == b'{"products": []}'
    url, kwargs = storage_get.calls[0]
    assert url == "https://storage.invalid/storage/v1/object/weather-products/" + key
    assert kwargs["headers"] == {"apikey": "test-key"} and kwargs["timeout"] > 0


@pytest.mark.parametrize("answer", [_Response(404, b"not found"), _Response(500, b"boom"), _Response(429, b"SlowDown"),
                                    RuntimeError("connection reset")], ids=["404", "500", "429", "raises"])
def test_fetch_manifest_object_never_raises_and_answers_none_on_any_failure(storage_get, answer):
    storage_get.answers.append(answer)
    assert mp.fetch_manifest_object("manifests/manifest-g000000000006.json") is None


@pytest.mark.parametrize("key", [None, ""])
def test_fetch_manifest_object_without_a_key_does_not_ask_storage(storage_get, key):
    assert mp.fetch_manifest_object(key) is None
    assert storage_get.calls == []


def test_fetch_manifest_object_without_storage_configuration_is_none(monkeypatch, storage_get):
    monkeypatch.setattr(mp, "_rest_base_and_headers", lambda: (None, None))
    assert mp.fetch_manifest_object("manifests/manifest-g000000000006.json") is None
    assert storage_get.calls == []


# ── publish_run_keyed's re-entrancy guard: the one-step publisher's legacy PUT must not publish a second time ─────────

def _publish_reaches_the_pointer(monkeypatch):
    """True when publish_run_keyed got as far as reading the pointer (i.e. it was NOT suppressed)."""
    reached = []
    monkeypatch.setattr(mp, "pointer_enabled", lambda: True)
    monkeypatch.setattr(mp, "read_pointer", lambda: reached.append(1))        # no row yet: the initial-insert branch
    monkeypatch.setattr(mp, "_insert_initial", lambda *args, **kwargs: False)
    monkeypatch.setattr(store_mod, "_l2_writer_identity", lambda: "designated:test")
    mp.publish_run_keyed(None, b"{}", lambda *args, **kwargs: True, lambda key: None)
    return bool(reached)


def test_publish_run_keyed_is_a_no_op_while_it_is_suppressed_on_this_thread(monkeypatch):
    with mp.publish_run_keyed_suppressed():
        assert _publish_reaches_the_pointer(monkeypatch) is False


def test_the_suppression_ends_with_the_block_even_when_the_block_raises(monkeypatch):
    with pytest.raises(RuntimeError):
        with mp.publish_run_keyed_suppressed():
            raise RuntimeError("legacy PUT failed")
    assert _publish_reaches_the_pointer(monkeypatch) is True


def test_nested_suppression_restores_the_outer_one(monkeypatch):
    with mp.publish_run_keyed_suppressed():
        with mp.publish_run_keyed_suppressed():
            pass
        assert _publish_reaches_the_pointer(monkeypatch) is False


def test_the_suppression_is_per_thread(monkeypatch):
    seen = []
    with mp.publish_run_keyed_suppressed():
        worker = threading.Thread(target=lambda: seen.append(_publish_reaches_the_pointer(monkeypatch)))
        worker.start()
        worker.join()
    assert seen == [True], "another thread's publish was silenced"


# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# THE ONE-STEP PUBLISHER (flag on)
# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

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


# ── the defect, as reported ────────────────────────────────────────────────────────────────────────────────────────────

def test_the_original_lost_update_a_snapshot_serialized_before_another_writers_commit_does_not_erase_it(
        chain, store, parked):
    """Pilots serializes its snapshot against generation 5. Before its queued upload runs, core registers 14 estimated
    frames and commits generation 6. Pilots' job then runs: the head must keep BOTH. (Before: the PUT's
    publish_run_keyed read the pointer NOW, swapped 6 -> 7 and the head lost core's 14 frames.)"""
    submit(store, BASE + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE))
    assert chain.generation == 6
    parked.run()
    lost = sorted(set(LATTICE) - set(chain.head_files()))
    assert not lost, "the published head lost %d of core's 14 registered frames: %s" % (len(lost), lost[:3])
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)


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


# ── an UNSEEN head move: a read that fails is a failed attempt, never a licence to publish ──────────────────────────────

@pytest.mark.parametrize("failing_read", ["pointer", "head_object"])
def test_a_transient_read_failure_is_retried_and_never_published_unmerged(chain, store, parked, sleeps, failing_read):
    """Another writer committed 14 frames, and the first read of the head fails (HTTP 5xx / timeout). The job backs off
    and reads again; every candidate that ever reaches the CAS already carries core's frames."""
    submit(store, BASE + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE))
    (chain.pointer_faults if failing_read == "pointer" else chain.fetch_faults).append("none")
    parked.run()
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)
    assert chain.cas_calls, "nothing was published"
    assert all(set(LATTICE) <= set(call["files"]) for call in chain.cas_calls), "an unmerged candidate reached the CAS"
    assert len(sleeps) == 1 and 0 < sleeps[0] <= 3, sleeps


@pytest.mark.parametrize("failing_read", ["pointer", "head_object"])
def test_five_failed_reads_leave_the_head_untouched_and_the_snapshot_pending_for_the_next_job(
        chain, store, parked, sleeps, caplog, failing_read):
    """Never a fall-back to publishing: after five attempts the pointer, the unique objects and the legacy manifest.json
    are all untouched, the log says so at ERROR, and the snapshot AND its exclude_keys wait for the next job."""
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[BASE[0]])                  # this process pruned BASE[0]
    chain.foreign_publish(adding(*LATTICE))
    (chain.pointer_faults if failing_read == "pointer" else chain.fetch_faults).extend(["none"] * 5)
    with caplog.at_level(logging.WARNING):
        parked.run()
    assert chain.generation == 6 and chain.head_files() == sorted(BASE + LATTICE)
    assert chain.cas_calls == []
    assert [u for u in chain.uploads if u[0] == "manifest.json" or u[0].startswith("manifests/")] == []
    assert any(r.levelno >= logging.ERROR for r in caplog.records), "five failures must be loud"
    assert len(sleeps) == 4
    later = "euro_wind_wind_global_mid_20261026T000000Z.json"
    submit(store, BASE[1:] + PILOTS_NEW + [later])                                # the next save, with no excludes of its own
    parked.run()
    assert chain.head_files() == sorted(BASE[1:] + LATTICE + PILOTS_NEW + [later]), \
        "the failed job's snapshot or its exclude_keys were lost"


def test_five_create_only_uploads_failing_with_429_publish_nothing_unmerged_and_the_snapshot_stays_pending(
        chain, store, parked, sleeps):
    """The reviewers' second confirmed defect: five failed uploads, core lands meanwhile, and the old code then ran the
    single-read publish over a head it had never merged. Here: no CAS, no legacy PUT, and a later job publishes it."""
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[BASE[0]])
    chain.upload_faults = ["429"] * 5
    chain.during_upload = lambda: chain.foreign_publish(adding(*LATTICE))            # core lands during our first attempt
    parked.run()
    assert chain.generation == 6 and chain.head_files() == sorted(BASE + LATTICE)
    assert chain.cas_calls == []
    assert [u for u in chain.uploads if u[0] == "manifest.json"] == [], "the legacy manifest.json was touched"
    assert len([u for u in chain.uploads if u[0].startswith("manifests/")]) == 5
    later = "euro_wind_wind_global_mid_20261026T000000Z.json"
    submit(store, BASE[1:] + PILOTS_NEW + [later])
    parked.run()
    assert chain.head_files() == sorted(BASE[1:] + LATTICE + PILOTS_NEW + [later])


@pytest.mark.parametrize("head", ["garbage", "not_a_manifest"])
def test_a_head_that_cannot_be_merged_against_is_a_failed_attempt_not_a_licence_to_publish(
        chain, store, parked, sleeps, caplog, head):
    submit(store, BASE + PILOTS_NEW)
    chain.objects[chain.head_key] = b"<html>502 Bad Gateway</html>" if head == "garbage" else b'{"last_manifest_update": "x"}'
    before = chain.objects[chain.head_key]
    with caplog.at_level(logging.WARNING):
        parked.run()
    assert chain.cas_calls == [] and chain.generation == 5 and chain.objects[chain.head_key] == before
    assert any(r.levelno >= logging.ERROR for r in caplog.records)
    assert len(sleeps) == 4


@pytest.mark.parametrize("generation", [None, "5", True, 0, 999999999999], ids=repr)
def test_a_pointer_row_with_an_unusable_generation_is_a_failed_attempt(chain, store, parked, sleeps, generation):
    """The same bounds publish_immutable enforces: an int in 1 .. 999999999998, so the 12-digit object name stays valid.
    (The fake pointer row really holds this generation, so only the guard stands between it and an upload.)"""
    chain.generation = generation
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert chain.cas_calls == [] and chain.uploads == []
    assert len(sleeps) == 4


# ── names: every attempt is its own create-only object ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("foreign_key", [None, "unique"], ids=["old-path-name", "unique-name"])
def test_a_writer_that_commits_during_our_upload_is_never_overwritten_and_both_survive(chain, store, parked, foreign_key):
    """P10 (reviewer, confirmed): core commits generation 6 as `manifest-g000000000006.json`, the name EVERY old-path
    writer uses, while our upload is in flight. A deterministic name for our attempt would land on top of core's committed
    object. Ours is unique and create-only: core's object is untouched and the retry merges against it."""
    submit(store, BASE + PILOTS_NEW)
    chain.during_upload = lambda: chain.foreign_publish(adding(*LATTICE), key=foreign_key)
    core_key = mp.run_keyed_manifest_key(6) if foreign_key is None else "manifests/manifest-g000000000006-" + "f0" * 16 + ".json"
    parked.run()
    assert core_key not in [key for key, _, _ in chain.uploads], "our attempt wrote to the name core committed under"
    core_files = _files(chain.objects[core_key])
    assert set(LATTICE) <= set(core_files) and not set(PILOTS_NEW) & set(core_files), "core's committed object changed"
    assert [(c["expected"], c["won"]) for c in chain.cas_calls] == [(5, False), (6, True)]
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)


def test_every_attempt_uploads_a_unique_create_only_acknowledged_object(chain, store, parked):
    """manifest_immutable.publish_immutable's contract: `manifests/manifest-g<N+1:012d>-<uuid4 hex>.json`, strict, not
    overwriting, and a NEW name for every attempt (an object whose acknowledgment we lost may be sitting on the old one)."""
    submit(store, BASE + PILOTS_NEW)
    chain.upload_faults = ["lost_ack"]                  # the first object LANDS, the answer does not come back
    parked.run()
    lane = [u for u in chain.uploads if u[0].startswith("manifests/")]
    assert len(lane) == 2, lane
    assert all(strict and not overwrite for _, strict, overwrite in lane), lane
    for key, _, _ in lane:
        assert UNIQUE_KEY.fullmatch(key), "not a unique manifest name: %s" % key
    assert [int(UNIQUE_KEY.fullmatch(k)[1]) for k, _, _ in lane] == [6, 6]
    assert lane[0][0] != lane[1][0]
    assert [c["key"] for c in chain.cas_calls] == [lane[1][0]], "the unacknowledged object was swapped in"
    assert chain.head_key == lane[1][0] and chain.head_files() == sorted(BASE + PILOTS_NEW)


def test_an_upload_that_is_not_acknowledged_with_true_is_never_swapped_in(chain, store, parked):
    submit(store, BASE + PILOTS_NEW)
    chain.upload_faults = ["none_ack"]                  # the object landed and the call returned None, not True
    parked.run()
    lane = [u for u in chain.uploads if u[0].startswith("manifests/")]
    assert len(lane) == 2 and [c["key"] for c in chain.cas_calls] == [lane[1][0]]


# ── the head moves between our read and our CAS ──────────────────────────────────────────────────────────────────────

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


def test_a_head_that_moves_inside_three_casts_is_remerged_each_time_and_the_final_head_has_every_writer(
        chain, store, parked, sleeps):
    submit(store, BASE + PILOTS_NEW)
    _keep_moving(chain, 3)
    parked.run()
    assert [(c["expected"], c["won"]) for c in chain.cas_calls] == [(5, False), (6, False), (7, False), (8, True)]
    foreign = ["euro_wind_wind_global_mid_20261026T%02d0000Z.json" % k for k in (1, 2, 3)]
    assert chain.head_files() == sorted(BASE + PILOTS_NEW + foreign)
    for attempt, call in enumerate(chain.cas_calls):
        assert len([f for f in call["files"] if "20261026" in f]) == attempt, \
            "attempt %d was not merged against the head it read" % (attempt + 1)
        assert set(BASE + PILOTS_NEW) <= set(call["files"])
    assert len(sleeps) == 3 and all(0 < wait <= 3 for wait in sleeps)


def test_each_retry_remerges_the_ORIGINAL_snapshot_not_the_previous_attempts_result(chain, store, parked):
    """Another writer registered X (generation 6) and then prunes it (generation 7) while we publish. Our first attempt
    merged X in; the second must NOT carry it over: it starts again from the snapshot we were handed."""
    x = "euro_wind_wind_global_mid_20261027T000000Z.json"
    chain.foreign_publish(adding(x))
    submit(store, BASE + PILOTS_NEW)                                           # our snapshot has never heard of X
    chain.before_cas = lambda: chain.foreign_publish(removing(x))
    parked.run()
    assert [(c["expected"], c["won"]) for c in chain.cas_calls] == [(6, False), (7, True)]
    assert x in chain.cas_calls[0]["files"] and x not in chain.cas_calls[1]["files"]
    assert chain.head_files() == sorted(BASE + PILOTS_NEW)


def test_a_head_that_never_settles_is_never_overwritten_unmerged_and_the_snapshot_stays_pending(
        chain, store, parked, sleeps, caplog):
    submit(store, BASE + PILOTS_NEW)
    _keep_moving(chain, 9)
    with caplog.at_level(logging.WARNING):
        parked.run()
    assert mps.MAX_ATTEMPTS == 5
    assert [c["won"] for c in chain.cas_calls] == [False] * 5
    assert chain.generation == 5 + 5, "nothing of ours advanced the pointer"
    assert not set(PILOTS_NEW) & set(chain.head_files())
    assert any(r.levelno >= logging.ERROR for r in caplog.records)
    assert [u for u in chain.uploads if u[0] == "manifest.json"] == []
    submit(store, BASE + PILOTS_NEW)                                           # a later save: the head has settled
    parked.run()
    assert set(PILOTS_NEW) <= set(chain.head_files()) and len(chain.wins()) == 1


def test_the_lost_ack_of_a_cas_that_landed_is_harmless(chain, store, parked):
    """cas_advance answered False although the row advanced to OUR object. The next attempt reads that head, merges our
    snapshot into our own object (nothing to add) and publishes one more, identical, generation."""
    submit(store, BASE + PILOTS_NEW)
    chain.cas_faults = ["lost_ack"]
    parked.run()
    assert [(c["expected"], c["won"]) for c in chain.cas_calls] == [(5, True), (6, True)]
    assert chain.generation == 7
    assert chain.head_files() == sorted(BASE + PILOTS_NEW)
    assert chain.objects[chain.head_key] != b"" and _files(chain.objects[chain.cas_calls[0]["key"]]) == chain.head_files()


# ── exclude_keys ─────────────────────────────────────────────────────────────────────────────────────────────────────

def test_an_entry_this_process_pruned_does_not_come_back_from_a_head_that_still_holds_it(chain, store, parked):
    """BASE[0] was pruned here (its object deleted). Another writer publishes in between and the head still names it:
    folding it back would mint a dangling manifest entry (audit #28)."""
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys={BASE[0]})
    chain.foreign_publish(adding(*LATTICE))
    parked.run()
    assert chain.head_files() == sorted(BASE[1:] + LATTICE + PILOTS_NEW)


def test_without_exclude_keys_the_same_entry_is_folded_back_so_the_test_above_is_not_vacuous(chain, store, parked):
    submit(store, BASE[1:] + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE))
    parked.run()
    assert BASE[0] in chain.head_files()


@pytest.mark.parametrize("excludes", [[BASE[0]], (BASE[0],), {BASE[0]}, frozenset({BASE[0]}), iter([BASE[0]])],
                         ids=["list", "tuple", "set", "frozenset", "iterator"])
def test_exclude_keys_may_be_any_iterable(chain, store, parked, excludes):
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=excludes)
    parked.run()
    assert chain.head_files() == sorted(BASE[1:] + PILOTS_NEW)


def test_coalescing_carries_the_union_of_every_submits_exclude_keys(chain, store, parked):
    """Two prunes, each followed by a save, all before the job runs. Only the newest snapshot is published, and it lacks
    BOTH pruned entries, so BOTH exclusions must apply to it or the older prune comes back from the head."""
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[BASE[0]])
    submit(store, PILOTS_NEW, exclude_keys=[BASE[1]])
    assert len(parked.queue) == 1, "one job, not one per submit"
    parked.run()
    assert chain.head_files() == sorted(PILOTS_NEW)


def test_a_prune_that_follows_a_queued_save_does_not_resurrect_the_entry(chain, store, inline):
    """Save S (queued), then prune S (its object deleted). The first job publishes S; the second snapshot lacks it and
    its exclusion must win over a head that now holds it."""
    s = "euro_wind_wind_global_mid_20261026T030000Z.json"
    chain.during_upload = lambda: submit(store, BASE + PILOTS_NEW, exclude_keys=[s])      # the prune, during job 1
    submit(store, BASE + PILOTS_NEW + [s])
    assert len(chain.wins()) == 2
    assert s in chain.cas_calls[0]["files"], "the first publish should have carried S"
    assert chain.head_files() == sorted(BASE + PILOTS_NEW), "a pruned entry (object deleted) came back"


def test_exclude_keys_do_not_outlive_the_publish_they_belong_to(chain, store, parked):
    """After a successful publish the exclusions are spent: a writer that registers the same key again later keeps it."""
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[BASE[0]])
    parked.run()
    assert BASE[0] not in chain.head_files()
    chain.foreign_publish(adding(BASE[0]))                                   # core re-registers it (a new object)
    submit(store, BASE[1:] + PILOTS_NEW)
    parked.run()
    assert BASE[0] in chain.head_files()


# ── an entry both sides changed: the newer run, exactly as reconcile decides it ────────────────────────────────────────

def _iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _both_changed(chain, store, parked, ours_fields, theirs_fields):
    """We change BASE[1] (freshness 111 marks ours) and core changes it too (222), then the job merges."""
    submit(store, [BASE[0], (BASE[1], dict(ours_fields, freshness_sec=111))] + PILOTS_NEW)
    chain.foreign_publish(changing(BASE[1], freshness_sec=222, **theirs_fields), adding(*LATTICE))
    parked.run()
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)
    return {111: "ours", 222: "theirs"}[chain.head_entry(BASE[1])["freshness_sec"]]


@pytest.mark.parametrize("ours_hours,theirs_hours,winner", [(1, 6, "theirs"), (6, 1, "ours"), (3, 3, "ours")],
                         ids=["head-newer", "ours-newer", "same-run"])
def test_an_entry_both_sides_changed_keeps_the_newer_run(chain, store, parked, ours_hours, theirs_hours, winner):
    got = _both_changed(chain, store, parked, {"run_time": RUN_TIME + timedelta(hours=ours_hours)},
                        {"run_time": _iso(RUN_TIME + timedelta(hours=theirs_hours))})
    assert got == winner


@pytest.mark.parametrize("theirs_cycle,ours_cycle,theirs_receipt,winner", [
    (-6, 0, 1, "ours"), (0, -6, -1, "theirs"), (0, 0, 1, "theirs"), (0, 0, -1, "ours")],
    ids=["older-cycle-received-later", "newer-cycle-received-earlier", "same-cycle-received-later",
         "same-cycle-received-earlier"])
def test_with_verified_cycles_the_merge_ranks_by_cycle_like_reconcile(
        chain, store, parked, monkeypatch, theirs_cycle, ours_cycle, theirs_receipt, winner):
    """INGEST_PRUNE_VERIFIED_CYCLES=1: a later receipt of an OLDER verified cycle must not undo the prune."""
    monkeypatch.setenv("INGEST_PRUNE_VERIFIED_CYCLES", "1")
    got = _both_changed(
        chain, store, parked,
        {"model_run_time": RUN_TIME + timedelta(hours=ours_cycle), "model_run_time_status": "known"},
        {"model_run_time": _iso(RUN_TIME + timedelta(hours=theirs_cycle)), "model_run_time_status": "known",
         "run_time": _iso(RUN_TIME + timedelta(hours=theirs_receipt))})
    assert got == winner


# ── coalescing ───────────────────────────────────────────────────────────────────────────────────────────────────────

SAVES = ["euro_wind_wind_global_mid_202610%02dT000000Z.json" % (26 + i) for i in range(5)]
PRUNED = ["euro_wind_wind_global_mid_202610%02dT060000Z.json" % (20 + i) for i in range(5)]


def test_five_submits_while_a_job_runs_publish_at_most_twice_and_apply_every_exclusion(chain, store, inline):
    """The running job publishes snapshot 1; submits 2-5 arrive during its upload; ONE more publish carries the newest
    snapshot and the UNION of all five exclusions. The head is read once per job, not once per submit."""
    chain.foreign_publish(adding(*PRUNED))                                      # the head holds what each save prunes

    def the_rest():
        for i in range(1, 5):
            submit(store, BASE + SAVES[:i + 1], exclude_keys=[PRUNED[i]])
    chain.during_upload = the_rest
    submit(store, BASE + SAVES[:1], exclude_keys=[PRUNED[0]])
    assert len(inline.log) == 1, "one job on the executor, however many submits arrive while it runs"
    assert len(chain.wins()) == 2
    assert chain.head_files() == sorted(BASE + SAVES), "the LAST snapshot must be what the head ends up holding"
    assert len(chain.kinds("fetch")) == 2 and len(chain.kinds("read_pointer")) == 2


def test_submits_before_the_job_runs_are_one_job_one_publish(chain, store, parked):
    for i in range(5):
        submit(store, BASE + SAVES[:i + 1])
    assert len(parked.queue) == 1
    parked.run()
    assert len(chain.wins()) == 1 and chain.head_files() == sorted(BASE + SAVES)
    assert len(chain.kinds("fetch")) == 1


def test_a_save_that_arrives_during_the_legacy_put_is_published_by_the_same_job(chain, store, inline):
    """After the pointer win the job PUTs the legacy manifest.json; a save that lands right then is neither lost nor
    treated as published."""
    chain.during_legacy_put = lambda: submit(store, BASE + PILOTS_NEW + SAVES[:1])
    submit(store, BASE + PILOTS_NEW)
    assert len(inline.log) == 1
    assert len(chain.wins()) == 2
    assert chain.head_files() == sorted(BASE + PILOTS_NEW + SAVES[:1])


def test_coalescing_with_a_real_executor_thread(chain, store, monkeypatch):
    chain.foreign_publish(adding(*PRUNED))
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="test_manifest")
    monkeypatch.setattr(store_mod, "_manifest_executor", executor)
    entered, release = threading.Event(), threading.Event()

    def block():
        entered.set()
        assert release.wait(20)
    chain.during_upload = block
    submit(store, BASE + SAVES[:1], exclude_keys=[PRUNED[0]])
    assert entered.wait(20), "the first job never reached its upload"
    for i in range(1, 5):
        submit(store, BASE + SAVES[:i + 1], exclude_keys=[PRUNED[i]])
    release.set()
    executor.shutdown(wait=True)
    assert len(chain.wins()) == 2
    assert chain.head_files() == sorted(BASE + SAVES)
    assert len(chain.kinds("fetch")) == 2


def test_a_stream_of_submits_racing_the_running_job_never_loses_the_last_one_and_never_overlaps_jobs(
        chain, store, monkeypatch):
    """The caller keeps saving while the job reads, merges and publishes (the pointer read is slowed so the interleavings
    are real). Whatever the interleaving: never two jobs at once, never more publishes than submits, and the head ends up
    holding the LAST snapshot."""
    import time
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="test_manifest")
    monkeypatch.setattr(store_mod, "_manifest_executor", executor)
    active, overlaps = [], []
    real_read = chain.read_pointer

    def slow_read():
        active.append(1)
        if len(active) > 1:
            overlaps.append(1)
        time.sleep(0.002)
        try:
            return real_read()
        finally:
            active.pop()
    monkeypatch.setattr(mp, "read_pointer", slow_read)
    names = ["euro_wind_wind_global_mid_2027%04dT000000Z.json" % i for i in range(200)]
    for i in range(200):
        submit(store, BASE + names[:i + 1])
        if i % 7 == 0:
            time.sleep(0.003)
    executor.shutdown(wait=True)
    assert overlaps == []
    assert 1 <= len(chain.wins()) <= 200
    assert chain.head_files() == sorted(BASE + names), "the last submit was not published"


def test_executor_shutdown_at_exit_runs_the_job_that_has_not_started(chain, store, monkeypatch):
    """The interpreter's exit joins the executor. A snapshot whose job is still queued behind earlier uploads must be
    published by that join, not dropped."""
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="test_manifest")
    monkeypatch.setattr(store_mod, "_manifest_executor", executor)
    busy = threading.Event()
    executor.submit(busy.wait, 20)                                              # an earlier upload holds the one worker
    submit(store, BASE + PILOTS_NEW)
    assert chain.events == [], "the caller's thread must do no I/O"
    busy.set()
    executor.shutdown(wait=True)
    assert chain.head_files() == sorted(BASE + PILOTS_NEW)


def test_a_failed_executor_submit_does_not_wedge_the_slot(chain, store, monkeypatch):
    dead = ThreadPoolExecutor(max_workers=1)
    dead.shutdown()
    monkeypatch.setattr(store_mod, "_manifest_executor", dead)
    with pytest.raises(RuntimeError):
        submit(store, BASE + PILOTS_NEW)
    live = InlineExecutor()
    monkeypatch.setattr(store_mod, "_manifest_executor", live)
    submit(store, BASE[1:] + PILOTS_NEW + SAVES[:1], exclude_keys=[BASE[0]])
    assert chain.head_files() == sorted(BASE[1:] + PILOTS_NEW + SAVES[:1])


# ── a won CAS ────────────────────────────────────────────────────────────────────────────────────────────────────────

def _order(chain):
    return [e[0] if e[0] != "upload" else e[1] for e in chain.events]


def test_a_won_cas_prunes_retention_then_puts_the_merged_bytes_to_the_legacy_manifest_without_republishing(
        chain, store, parked):
    submit(store, BASE + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE))
    parked.run()
    won = chain.wins()
    assert len(won) == 1 and chain.generation == 7
    order = _order(chain)
    assert order.index("cas") < order.index("prune") < order.index("manifest.json"), order
    assert chain.kinds("prune") == [("prune", 7)], "prune_immutable_copies(g+1) where g is the generation merged against"
    assert chain.objects["manifest.json"] == chain.objects[chain.head_key], "the legacy copy holds the MERGED bytes"
    assert chain.nested_publishes == [None], "the legacy PUT must not publish a second generation"
    assert chain.deleted == []


def test_a_lost_cas_neither_prunes_nor_touches_the_legacy_manifest(chain, store, parked):
    submit(store, BASE + PILOTS_NEW)
    chain.before_cas = lambda: chain.foreign_publish(adding(*LATTICE))
    parked.run()
    assert chain.kinds("prune") == [("prune", 7)]
    order = _order(chain)
    assert order.count("manifest.json") == 1 and order.index("manifest.json") > max(
        i for i, kind in enumerate(order) if kind == "cas")


def test_a_failing_legacy_put_does_not_undo_the_pointer_win_and_raises_nothing(chain, store, parked):
    chain.fail_manifest_json_put = True
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert chain.generation == 6 and chain.head_files() == sorted(BASE + PILOTS_NEW)
    assert "manifest.json" not in chain.objects
    assert len(chain.wins()) == 1


def test_a_failing_retention_prune_does_not_undo_the_pointer_win_or_skip_the_legacy_put(chain, store, parked, monkeypatch):
    from services.weather_pipeline import manifest_immutable
    monkeypatch.setattr(manifest_immutable, "prune_immutable_copies",
                        lambda generation, **kwargs: (_ for _ in ()).throw(RuntimeError("listing failed")))
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert chain.generation == 6 and chain.objects["manifest.json"] == chain.objects[chain.head_key]


# ── when the one-step lane is not the lane ───────────────────────────────────────────────────────────────────────────

def test_a_pointer_lane_that_is_disabled_for_good_runs_the_old_path_once(chain, store, parked, monkeypatch):
    """The pointer table is missing (read_pointer disables the lane and answers None). That is permanent, so the job runs
    today's path ONCE: reconcile (it fetches the head itself), dump, PUT manifest.json. No retry, no CAS."""
    state = {"enabled": True}
    monkeypatch.setattr(mp, "pointer_enabled", lambda: state["enabled"])
    monkeypatch.setattr(mp, "read_pointer", lambda: chain.events.append(("read_pointer",)) or state.update(enabled=False))
    remote = [_raw_wind(name) for name in LATTICE]
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: chain.events.append(("fetch_remote",)) or remote)
    submit(store, BASE + PILOTS_NEW)
    assert chain.events == [], "the caller's thread must do no I/O"
    parked.run()
    assert [e for e in chain.events if e[0] != "fetch_remote"] == [("read_pointer",), ("upload", "manifest.json", False, True)]
    assert chain.kinds("fetch_remote") == [("fetch_remote",)]
    assert _files(chain.objects["manifest.json"]) == sorted(BASE + PILOTS_NEW + LATTICE)
    assert chain.cas_calls == []


INERT = {
    "pointer_disabled": lambda monkeypatch: monkeypatch.setattr(mp, "pointer_enabled", lambda: False),
    "immutable_publication": lambda monkeypatch: monkeypatch.setenv("MANIFEST_IMMUTABLE_PUBLICATION", "1"),
    "merge_on_upload_off": lambda monkeypatch: monkeypatch.setenv("MANIFEST_MERGE_ON_UPLOAD", "0"),
    "not_the_designated_writer": lambda monkeypatch: monkeypatch.setattr(store_mod, "_l2_pipeline_writes_allowed", lambda: False),
}


@pytest.mark.parametrize("reason", sorted(INERT))
@pytest.mark.parametrize("site", sorted(SITES))
def test_with_the_flag_on_but_the_lane_unavailable_every_call_site_is_the_old_path(
        site, reason, site_env, monkeypatch, tmp_path):
    """The flag is on and something makes the one-step lane the wrong lane: it is inert, byte for byte today's calls
    (reconcile, dump, queue the manifest.json PUT), with no pointer read and no new write."""
    monkeypatch.setenv(FLAG, "1")
    INERT[reason](monkeypatch)
    store, expected_exclude = SITES[site](tmp_path, monkeypatch)
    log = [event for event in site_env if event[0] in ("reconcile", "dump", "submit")]
    assert [event[0] for event in log] == ["reconcile", "dump", "submit"]
    _, fn, args, kwargs = log[2]
    assert fn == store._upload_to_supabase and args == ("manifest.json", log[1][2]) and kwargs == {}
    assert (set(log[0][2].get("exclude_keys", ())) or None) == expected_exclude


# ── the six call sites, flag on ──────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("site", sorted(SITES))
def test_flag_on_each_call_site_hands_its_snapshot_to_the_publisher_and_does_no_io_on_the_callers_thread(
        site, chain, parked, monkeypatch, tmp_path):
    monkeypatch.setattr(ProductStore, "_upload_to_supabase", lambda self, filename, data, **kw: chain.upload(filename, data, **kw))
    monkeypatch.setattr(ProductStore, "_delete_from_supabase", lambda self, filename: chain.delete(filename))
    monkeypatch.setattr(store_mod, "_upload_executor", InlineExecutor())
    monkeypatch.setattr(ProductStore, "_cached_manifest", None)
    monkeypatch.setenv("MANIFEST_RETENTION_DAYS", "36500")
    chain.foreign_publish(lambda products: products + [_raw_entry("old.json"), _raw_entry("older.json")])
    store, expected_exclude = SITES[site](tmp_path, monkeypatch)
    io = [e for e in chain.events if e[0] in ("read_pointer", "fetch", "fetch_pointed", "cas")
          or (e[0] == "upload" and (e[1] == "manifest.json" or e[1].startswith("manifests/")))]
    assert io == [], "the save did pointer or manifest I/O on the caller's thread: %s" % io
    assert len(parked.queue) == 1
    parked.run()
    assert len(chain.wins()) == 1
    survivors = {p.filename for p in store.get_manifest().products}
    head = set(chain.head_files())
    assert survivors and survivors <= head and set(BASE) <= head
    assert not (expected_exclude or set()) & head, "a pruned entry came back from the head"


# ── the backoff, and what it costs ───────────────────────────────────────────────────────────────────────────────────

def test_the_backoff_is_jittered_exponential_and_bounded():
    waits = {n: [mps.backoff_seconds(n) for _ in range(300)] for n in (1, 2, 3, 4)}
    assert len(set(waits[1])) > 1, "no jitter"
    assert all(0 < w <= 3 for ws in waits.values() for w in ws)
    assert max(waits[4]) > max(waits[1]) * 2, "no growth"


def test_cost_of_publishing_a_16k_entry_manifest_in_one_step(chain, store, inline, capsys):
    """A production-sized head (about 16 MB of JSON). Counted exactly: one pointer read, one head GET, one unique upload,
    one CAS, one legacy PUT. CPU and peak memory are printed (machine dependent), with a ceiling that only a pathology
    (quadratic merge, a copy per entry) would cross."""
    import time
    import tracemalloc
    names = ["euro_wind_wind_global_mid_2026%04dT%06dZ.json" % (i // 100, i % 100) for i in range(16000)]
    chain.objects[chain.head_key] = dump_manifest_for_l2(_snapshot(names))
    snapshot = _snapshot(names[:15990] + ["pilots_new_%d.json" % k for k in range(10)])
    chain.foreign_publish(adding(*["core_new_%d.json" % k for k in range(14)]))           # a real merge, not a no-op
    head_bytes = len(chain.objects[chain.head_key])
    tracemalloc.start()
    started = time.process_time()
    mps.submit_manifest_publish(store, snapshot)
    cpu = time.process_time() - started
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    with capsys.disabled():
        print("\nCOST one-step publish: head %.1f MB, CPU %.2f s, peak traced memory %.0f MiB"
              % (head_bytes / 1e6, cpu, peak / 2 ** 20))
    assert len(chain.kinds("read_pointer")) == 1 and len(chain.kinds("fetch")) == 1 and len(chain.wins()) == 1
    assert len([u for u in chain.uploads if u[0].startswith("manifests/")]) == 1
    assert len([u for u in chain.uploads if u[0] == "manifest.json"]) == 1
    files = set(chain.head_files())
    assert {"core_new_13.json", "pilots_new_9.json", names[15999]} <= files and len(files) == 16000 + 14 + 10
    assert cpu < 120 and peak < 3 * 2 ** 30


# ── the flag is registered, dark ─────────────────────────────────────────────────────────────────────────────────────

def test_the_flag_is_registered_dark_and_points_at_the_l2_writers_not_render():
    import ast
    from pathlib import Path
    path = Path(__file__).resolve().parent.parent / "routes" / "admin" / "surf_forecast.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    table = next(node.value for node in tree.body if isinstance(node, ast.Assign)
                 and any(getattr(t, "id", None) == "_RATING_FLAGS" for t in node.targets))
    registry = {key.value: ast.literal_eval(value) for key, value in zip(table.keys, table.values)}
    default, description, where = registry[FLAG]
    assert default == "0", "a change to what the manifest publishes ships dark"
    assert "workflow" in where.lower() and "render" in where.lower() and where.lower().count("not render") == 1
    assert "pilots" in where.lower() and "precompute" in where.lower() and "forecast-ingest" in where.lower()

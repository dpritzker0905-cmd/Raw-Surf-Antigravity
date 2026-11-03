"""PRODUCT_RUN_KEYED_NAMES (dark, 2026-11-01): immutable run-keyed product object names.

The live failure (side-session notes FLORIDA-GFS-PILOT-STALE-2026-11-01.md): product names carry the VALID time only, every run
rewrites the same key, and store_helpers.fetch_l2_to_disk downloads only when the file is absent, so a box that booted on the
10-30T18Z run served it for 51 h while storage held 11-01T18Z. These tests drive the REAL save, load, merge and prune paths with
only storage faked: flag off is byte-identical to before (and reproduces the stale read), flag on gives every run its own key.
"""
import json
import re
from concurrent.futures import Future
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from services.weather_pipeline import product_object_gc as gc
from services.weather_pipeline import product_run_keys as rk
from services.weather_pipeline import store as module
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct
from services.weather_pipeline.store_helpers import _build_product_filename

REPO = Path(__file__).resolve().parents[2]
VALID = datetime(2026, 11, 2, 3, tzinfo=timezone.utc)
RUN1 = datetime(2026, 10, 30, 18, tzinfo=timezone.utc)
RUN2 = datetime(2026, 11, 1, 18, tzinfo=timezone.utc)
FLORIDA = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)
LEGACY = "gfs_marine_waves_florida_east_coast_20261102T030000Z.json"


class ImmediateExecutor:
    def submit(self, fn, *args, **kwargs):
        result = Future()
        try:
            result.set_result(fn(*args, **kwargs))
        except Exception as exc:
            result.set_exception(exc)
        return result


class FakeBucket:
    def __init__(self, objects):
        self.objects = objects

    def download(self, name):
        if name not in self.objects:
            raise RuntimeError("404 not_found")
        return self.objects[name]


class FakeStorage:
    def __init__(self, objects):
        self.bucket = FakeBucket(objects)
        self.storage = self

    def from_(self, _bucket):
        return self.bucket


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    for flag in (rk.FLAG, "MANIFEST_ONE_ENTRY_PER_OBJECT", "INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS",
                 "INGEST_PRUNE_VERIFIED_CYCLES", "PRODUCT_REVISION_REFRESH", "MANIFEST_PUBLISH_ONE_STEP"):
        monkeypatch.delenv(flag, raising=False)
    monkeypatch.setenv("MANIFEST_MERGE_ON_UPLOAD", "1")
    monkeypatch.setattr(module, "_fetch_remote_manifest_products", lambda: [])
    monkeypatch.setattr(module, "_upload_executor", ImmediateExecutor())
    monkeypatch.setattr(module, "_manifest_executor", ImmediateExecutor())
    storage, deleted = {}, []
    store = module.ProductStore(cache_dir=tmp_path)
    monkeypatch.setattr(module, "_get_supabase_storage", lambda: FakeStorage(storage))
    module.ProductStore._product_cache.clear()
    module.ProductStore._product_cache_vectors.clear()
    module.ProductStore._l2_negative_cache.clear()

    def upload(filename, data, **kwargs):
        storage[filename] = data
        return True

    def delete(filename):
        deleted.append(filename)
        storage.pop(filename, None)

    monkeypatch.setattr(store, "_upload_to_supabase", upload)
    monkeypatch.setattr(store, "_delete_from_supabase", delete)
    yield store, storage, deleted
    module.ProductStore._product_cache.clear()
    module.ProductStore._product_cache_vectors.clear()


def tile(run=RUN1, height=1.0, valid=VALID):
    vecs = [GridVector(lat=lat, lng=lng, speed=height, direction=90.0, u=-height, v=0.0, period=9.0)
            for lat in (24.0, 27.5, 31.0) for lng in (-85.0, -82.0, -79.0)]
    return NormalizedProduct(
        model="GFS", provider="noaa", domain="marine", layer="waves", run_time=run, valid_time=valid,
        is_forecast_authoritative=True, is_estimated=False, coverage=FLORIDA, freshness_sec=1800, value_kind="wave_height",
        value_unit="m", display_unit_hint="ft", source_variables=["hs"],
        grid=NormalizedGrid(bounds=FLORIDA, cols=3, rows=3, vectors=vecs),
    )


def save(store, product, batch):
    if batch:
        assert store.save_products_batch([(product, 0.25)]) == 1
        return product.product_id
    return store.save_product(product, resolution=0.25)


def slice_entries(store):
    return [p for p in store.get_manifest().products if p.valid_time_start == VALID and p.layer == "waves"]


# ---- flag off: today's names and bytes, and the stale read it causes ----

@pytest.mark.parametrize("batch", [True, False])
def test_flag_off_names_and_bytes_are_unchanged(runtime, batch):
    store, storage, _ = runtime
    p = tile()
    name = save(store, p, batch)
    assert name == LEGACY == _build_product_filename(p)
    expected = tile()
    expected.region_id, expected.tile_id, expected.coverage_mode = "florida_east_coast", "florida_east_coast", "regional_tile"
    expected.product_id = LEGACY
    assert storage[LEGACY] == expected.model_dump_json().encode("utf-8")      # byte-identical body
    assert [e.filename for e in slice_entries(store)] == [LEGACY]


def test_control_flag_off_a_disk_copy_hides_the_newer_run(runtime, tmp_path):
    store, storage, _ = runtime
    save(store, tile(RUN1), batch=True)                         # the box's disk holds run 1 under the legacy key
    writer = module.ProductStore(cache_dir=tmp_path / "writer")  # another process writes run 2 under the SAME key
    writer._upload_to_supabase = store._upload_to_supabase
    writer._delete_from_supabase = store._delete_from_supabase
    save(writer, tile(RUN2, height=2.0), batch=True)
    assert json.loads(storage[LEGACY])["run_time"].startswith("2026-11-01T18")
    module.ProductStore._product_cache.clear()
    assert store.load_product(LEGACY).run_time == RUN1          # the bug: storage moved, the reader did not


# ---- flag on: a new key per run and per content ----

@pytest.mark.parametrize("batch", [True, False])
def test_flag_on_a_new_run_makes_a_new_key_and_moves_the_manifest(runtime, monkeypatch, batch):
    monkeypatch.setenv(rk.FLAG, "1")
    store, storage, deleted = runtime
    a = save(store, tile(RUN1), batch)
    assert rk.is_run_keyed(a) and rk.logical_name(a) == LEGACY
    assert re.fullmatch(r"gfs_marine_waves_florida_east_coast_20261102T030000Z\.r20261030T1800-[0-9a-f]{8}\.json", a)
    assert json.loads(storage[a])["product_id"] == a             # the body names itself
    assert save(store, tile(RUN1), batch) == a                   # same run, same bytes: same key (idempotent)
    b = save(store, tile(RUN2, height=2.0), batch)
    assert b != a and rk.logical_name(b) == LEGACY and ".r20261101T1800-" in b
    assert [e.filename for e in slice_entries(store)] == [b]     # one registration, the new object
    assert a in storage and deleted == []                       # the old object waits for the GC
    c = save(store, tile(RUN2, height=2.5), batch)               # same run, rewritten in place (lattice fill, extensions)
    assert c not in (a, b) and [e.filename for e in slice_entries(store)] == [c]


def test_flag_on_a_reader_with_a_stale_disk_copy_gets_the_new_run(runtime, monkeypatch, tmp_path):
    monkeypatch.setenv(rk.FLAG, "1")
    store, storage, _ = runtime
    a = save(store, tile(RUN1), batch=True)
    assert store.load_product(a).run_time == RUN1                # warm: on disk and in L1
    writer = module.ProductStore(cache_dir=tmp_path / "writer")
    writer._upload_to_supabase = store._upload_to_supabase
    writer._delete_from_supabase = store._delete_from_supabase
    b = save(writer, tile(RUN2, height=2.0), batch=True)
    assert (tmp_path / a).exists() and not (tmp_path / b).exists()
    got = store.load_product(b)                                 # the name the moved manifest gives
    assert got.run_time == RUN2 and got.product_id == b and (tmp_path / b).exists()


def test_flag_on_hash_ignores_nothing_but_the_name(monkeypatch):
    monkeypatch.setenv(rk.FLAG, "1")
    n1, body1 = rk.name_and_bytes(tile(RUN1), LEGACY)
    n2, body2 = rk.name_and_bytes(tile(RUN1), LEGACY)
    n3, _ = rk.name_and_bytes(tile(RUN1, height=1.01), LEGACY)
    assert (n1, body1) == (n2, body2) and n3 != n1
    assert json.loads(body1)["product_id"] == n1
    # the run token never looks like a valid time, so a reader's \d{8}T\d{6}Z finds the valid time and only it
    assert re.findall(r"\d{8}T\d{6}Z", n1) == ["20261102T030000Z"]


@pytest.mark.parametrize("value", [None, "0", "true", "yes"])
def test_only_the_canonical_on_value_enables_it(runtime, monkeypatch, value):
    if value is not None:
        monkeypatch.setenv(rk.FLAG, value)
    store, _, _ = runtime
    assert save(store, tile(), batch=True) == LEGACY


# ---- prunes: the manifest moves first, storage deletes wait ----

def test_flag_on_prunes_defer_storage_deletes(runtime, monkeypatch):
    store, storage, deleted = runtime
    save(store, tile(RUN1), batch=True)                          # a legacy entry from before the flip
    monkeypatch.setenv(rk.FLAG, "1")
    other = tile(RUN1, valid=VALID + timedelta(hours=3))
    old = save(store, other, batch=True)
    save(store, tile(RUN2, height=2.0, valid=VALID + timedelta(hours=3)), batch=True)
    store.prune_superseded_products("GFS", "marine", "waves", "florida_east_coast", RUN2)
    assert store.prune_duplicate_valid_times() == 0
    assert deleted == [] and LEGACY in storage and old in storage


def test_control_flag_off_prunes_delete_at_once(runtime):
    store, storage, deleted = runtime
    save(store, tile(RUN1, valid=VALID + timedelta(hours=3)), batch=True)
    save(store, tile(RUN1), batch=True)
    from services.weather_pipeline.schemas import ManifestProduct
    m = store.get_manifest()
    twin = ManifestProduct.model_validate({**m.products[-1].model_dump(), "provider": "other", "run_time": RUN1 - timedelta(hours=6)})
    m.products.append(twin)
    store._save_manifest(m)
    assert store.prune_duplicate_valid_times() == 1 and deleted == [LEGACY]


# ---- the manifest merge: one slice = one logical name ----

def _entries(store, *files):
    return [p.model_dump(mode="json") for p in store.get_manifest().products if p.filename in files]


def test_merge_never_folds_back_the_superseded_object(runtime, monkeypatch):
    monkeypatch.setenv(rk.FLAG, "1")
    store, _, _ = runtime
    a = save(store, tile(RUN1), batch=True)
    remote = _entries(store, a)                                  # the published head still names run 1
    b = save(store, tile(RUN2, height=2.0), batch=True)
    m = store.get_manifest()
    assert module.reconcile_manifest_products_for_upload(m, remote_products=remote) == 0
    assert [p.filename for p in m.products if p.valid_time_start == VALID] == [b]


def test_merge_keeps_a_newer_remote_run_of_the_same_slice(runtime, monkeypatch, tmp_path):
    monkeypatch.setenv(rk.FLAG, "1")
    store, _, _ = runtime
    save(store, tile(RUN1), batch=True)
    writer = module.ProductStore(cache_dir=tmp_path / "writer")
    writer._upload_to_supabase = store._upload_to_supabase
    c = save(writer, tile(RUN2, height=2.0), batch=True)
    m = store.get_manifest()
    module.reconcile_manifest_products_for_upload(m, remote_products=_entries(writer, c))
    assert [p.filename for p in m.products if p.valid_time_start == VALID] == [c]


def test_migration_a_remote_legacy_entry_does_not_twin_a_run_keyed_one(runtime, monkeypatch):
    store, _, _ = runtime
    save(store, tile(RUN1), batch=True)
    remote = _entries(store, LEGACY)
    monkeypatch.setenv(rk.FLAG, "1")
    b = save(store, tile(RUN2, height=2.0), batch=True)
    m = store.get_manifest()
    module.reconcile_manifest_products_for_upload(m, remote_products=remote)
    assert [p.filename for p in m.products if p.valid_time_start == VALID] == [b]


def test_rollback_a_legacy_writer_meets_a_newer_run_keyed_remote(runtime, monkeypatch, tmp_path):
    store, _, _ = runtime
    save(store, tile(RUN1), batch=True)                          # flag off: legacy name, run 1
    monkeypatch.setenv(rk.FLAG, "1")
    writer = module.ProductStore(cache_dir=tmp_path / "writer")
    writer._upload_to_supabase = store._upload_to_supabase
    b = save(writer, tile(RUN2, height=2.0), batch=True)
    remote = _entries(writer, b)
    monkeypatch.delenv(rk.FLAG)                                  # rolled back on this writer
    m = store.get_manifest()
    module.reconcile_manifest_products_for_upload(m, remote_products=remote)
    assert [p.filename for p in m.products if p.valid_time_start == VALID] == [b]   # newer run kept, no twin


# ---- the object GC: two sweeps a grace apart, after the manifest moved ----

A = "gfs_marine_waves_florida_east_coast_20261102T030000Z.r20261030T1800-0123abcd.json"
B = "gfs_marine_waves_florida_east_coast_20261102T030000Z.r20261101T1800-89abcdef.json"
LIVE = {f"gfs_marine_waves_x_2026110{d}T000000Z.json" for d in range(1, 9)}


def test_gc_marks_first_and_deletes_only_after_the_grace():
    listed = sorted(LIVE | {A, B, "manifest.json", "manifests", "product_gc", "calibration", "health.json"})
    ref = LIVE | {B}
    d1, m1, r1 = gc.plan_sweep(listed, ref, {}, now=1000.0, grace_s=7200, min_manifest=1)
    assert (d1, m1, r1) == ([], {A: 1000.0}, None)               # marked, not deleted; namespaced keys never touched
    d2, m2, _ = gc.plan_sweep(listed, ref, m1, now=1000.0 + 7199, grace_s=7200, min_manifest=1)
    assert d2 == [] and m2 == m1
    d3, m3, _ = gc.plan_sweep(listed, ref, m2, now=1000.0 + 7200, grace_s=7200, min_manifest=1)
    assert d3 == [A] and m3 == {}
    d4, m4, _ = gc.plan_sweep(listed, ref | {A}, m1, now=99999.0, grace_s=7200, min_manifest=1)
    assert d4 == [] and m4 == {}                                 # referenced again: the mark is dropped


def test_gc_guards_refuse_a_thin_or_missing_head():
    listed = sorted(LIVE | {A})
    assert gc.plan_sweep(listed, {B}, {A: 0.0}, now=1e9, grace_s=1, min_manifest=500)[2]
    assert gc.plan_sweep(listed, {"x.json"}, {A: 0.0}, now=1e9, grace_s=1, min_manifest=1)[2]   # > 95 % unreferenced
    d, _, _ = gc.plan_sweep(sorted(LIVE | {A, B}), LIVE, {A: 0.0, B: 0.0}, now=1e9, grace_s=1, min_manifest=1, max_delete=1)
    assert d == [A]


def test_gc_is_a_no_op_with_the_flag_off(runtime):
    store, _, deleted = runtime
    assert gc.run_object_gc(store) == {"skipped": "flag off"} and deleted == []


# ---- the serve box: its disk sheds superseded copies; the scrub swap asks the manifest ----

def test_disk_sweep_drops_only_old_unreferenced_run_keyed_files(tmp_path):
    for name in (A, B, LEGACY, "manifest.json"):
        (tmp_path / name).write_text("{}")
    assert rk.sweep_local_disk(tmp_path, {B}, now=1e12, grace_s=60) == 1
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted([B, LEGACY, "manifest.json"])
    (tmp_path / A).write_text("{}")
    assert rk.sweep_local_disk(tmp_path, {B}, grace_s=3600) == 0  # young: a reader on the previous manifest may still want it


def test_scrub_swap_finds_the_current_object_of_the_other_hour():
    other = "gfs_marine_waves_florida_east_coast_20261102T060000Z.r20261101T1800-fedcba98.json"
    rows = [type("P", (), {"filename": n})() for n in (B, other)]
    holder = type("M", (), {"products": rows})()
    assert rk.swap_valid_time(holder, B, "20261102T030000Z", "20261102T060000Z") == other
    assert rk.swap_valid_time(holder, B, "20261102T030000Z", "20261102T090000Z") is None


# ---- the flag is wired where the writers read it ----

@pytest.mark.parametrize("workflow", ["forecast-ingest.yml", "forecast-ingest-pilots.yml", "precompute.yml"])
def test_every_manifest_writer_reads_the_one_repo_variable(workflow):
    text = (REPO / ".github" / "workflows" / workflow).read_text(encoding="utf-8")
    assert re.search(r"^\s+PRODUCT_RUN_KEYED_NAMES: \$\{\{ vars\.PRODUCT_RUN_KEYED_NAMES \|\| '0' \}\}\s*$", text, re.M)


def test_the_registry_lists_it_dark():
    text = (REPO / "backend" / "routes" / "admin" / "surf_forecast.py").read_text(encoding="utf-8")
    assert re.search(r'"PRODUCT_RUN_KEYED_NAMES": \("0",', text)

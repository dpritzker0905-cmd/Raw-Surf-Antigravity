"""Listed-but-absent products (2026-10-26): MANIFEST_ONE_ENTRY_PER_OBJECT and RESOLVER_SKIP_MISSING_OBJECT, both dark.

The live chain (Supabase storage logs + forecast-ingest run 40224293278, 2026-10-25):
  19:45:06 POST   euro_marine_waves_global_coarse_20261108T180000Z_estimated.json   (EURO native job, GFS-ext fallback)
  19:51:14 PUT    same object                                                       (EURO extended-estimate job)
  19:54:02 DELETE same object  <- cycle-end duplicate sweep, "Pruned unreferenced product file"
  20:55:39 GET 400 not_found -> "Stored product path not found" -> /grid 404 no_copernicus_coverage
The two writers carry different providers, so the batch save registered TWO entries for ONE object; the sweep (keyed without
the provider) kept one and deleted the other's object, the one the survivor names. These tests drive the REAL save, prune and
resolve paths with only storage faked: the off-flag controls reproduce the live failure, the on-flag arms show it gone.
"""
import asyncio
import json
from concurrent.futures import Future
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import store as module
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

T = datetime(2026, 11, 8, 18, tzinfo=timezone.utc)
WORLD = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
FILE = "euro_marine_waves_global_coarse_20261108T180000Z_estimated.json"


class ImmediateExecutor:
    def submit(self, fn, *args, **kwargs):
        result = Future()
        try:
            result.set_result(fn(*args, **kwargs))
        except Exception as exc:
            result.set_exception(exc)
        return result


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    for flag in ("MANIFEST_ONE_ENTRY_PER_OBJECT", "INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS", "INGEST_PRUNE_VERIFIED_CYCLES",
                 "RESOLVER_SKIP_MISSING_OBJECT"):
        monkeypatch.delenv(flag, raising=False)
    monkeypatch.setenv("MANIFEST_MERGE_ON_UPLOAD", "1")
    monkeypatch.setattr(module, "_fetch_remote_manifest_products", lambda: [])
    monkeypatch.setattr(module, "_upload_executor", ImmediateExecutor())
    monkeypatch.setattr(module, "_manifest_executor", ImmediateExecutor())
    storage, deleted = {}, []
    store = module.ProductStore(cache_dir=tmp_path)

    def upload(filename, data, **kwargs):
        storage[filename] = data
        return True

    def delete(filename):
        deleted.append(filename)
        storage.pop(filename, None)

    monkeypatch.setattr(store, "_upload_to_supabase", upload)
    monkeypatch.setattr(store, "_delete_from_supabase", delete)
    return store, storage, deleted


def estimate(provider, basis, height, valid=T, run=T - timedelta(days=13)):
    vecs = [GridVector(lat=lat, lng=lng, speed=height, direction=90.0, u=-height, v=0.0, period=9.0)
            for lat in (-80.0, 0.0, 85.0) for lng in (-180.0, 0.0, 180.0)]
    return NormalizedProduct(
        model="EURO", provider=provider, domain="marine", layer="waves", run_time=run, valid_time=valid,
        is_forecast_authoritative=False, is_estimated=True, estimate_basis={"type": basis}, coverage=WORLD,
        region_id="global_coarse", coverage_mode="global_tile", freshness_sec=1800, value_kind="wave_height",
        value_unit="m", display_unit_hint="ft", source_variables=["hs"],
        grid=NormalizedGrid(bounds=WORLD, cols=3, rows=3, vectors=vecs),
    )


# the live order: the native job's GFS-ext fallback first, the extended-estimate blend six minutes later (an older run_time)
FALLBACK = ("noaa", "gfs_estimated_fallback", 1.0, T - timedelta(hours=1))
BLEND = ("estimator", "euro_persistence_gfs_blend", 2.0, T - timedelta(hours=13))


def save_both(store, batch):
    for provider, basis, height, run in (FALLBACK, BLEND):
        p = estimate(provider, basis, height, run=run)
        if batch:
            assert store.save_products_batch([(p, 10.0)]) == 1
        else:
            assert store.save_product(p, resolution=10.0) == FILE


def listed(store):
    return [p for p in store.get_manifest().products if p.filename == FILE]


@pytest.mark.parametrize("batch", [True, False])
def test_control_two_writers_two_entries_and_the_sweep_deletes_the_listed_object(runtime, batch):
    store, storage, deleted = runtime
    save_both(store, batch)
    assert len(listed(store)) == 2                                    # one object, two registrations
    assert store.prune_duplicate_valid_times() == 1
    assert deleted == [FILE] and FILE not in storage                  # the object is gone ...
    assert len(listed(store)) == 1                                    # ... while the manifest still lists it


@pytest.mark.parametrize("batch", [True, False])
def test_one_entry_per_object_keeps_one_registration_that_matches_the_bytes(runtime, monkeypatch, batch):
    monkeypatch.setenv("MANIFEST_ONE_ENTRY_PER_OBJECT", "1")
    store, storage, deleted = runtime
    save_both(store, batch)
    [entry] = listed(store)
    assert entry.provider == "estimator" and entry.estimate_basis == {"type": "euro_persistence_gfs_blend"}
    assert json.loads(storage[FILE])["estimate_basis"] == {"type": "euro_persistence_gfs_blend"}   # label == bytes
    assert store.prune_duplicate_valid_times() == 0
    store.prune_superseded_products("EURO", "marine", "waves", "global_coarse", T)   # returns nothing; judge by effect
    assert deleted == [] and FILE in storage and len(listed(store)) == 1


def test_one_entry_per_object_leaves_other_slices_alone_and_collapses_an_existing_twin(runtime, monkeypatch):
    store, storage, deleted = runtime
    save_both(store, batch=True)                                      # a twin already in the manifest (flag was off)
    other = estimate("noaa", "gfs_estimated_fallback", 1.5, valid=T + timedelta(hours=3))
    store.save_products_batch([(other, 10.0)])
    before = len(store.get_manifest().products)
    monkeypatch.setenv("MANIFEST_ONE_ENTRY_PER_OBJECT", "1")
    store.save_products_batch([(estimate(*FALLBACK[:3], run=T), 10.0)])           # the next cycle rewrites the object
    assert len(listed(store)) == 1 and listed(store)[0].provider == "noaa"
    assert len(store.get_manifest().products) == before - 1           # only the twin went
    assert any(p.valid_time_start == T + timedelta(hours=3) for p in store.get_manifest().products)
    assert deleted == []


@pytest.mark.parametrize("flag", [None, "0", "true"])
def test_only_the_canonical_on_value_enables_it(runtime, monkeypatch, flag):
    if flag is not None:
        monkeypatch.setenv("MANIFEST_ONE_ENTRY_PER_OBJECT", flag)
    store, _, _ = runtime
    save_both(store, batch=True)
    assert len(listed(store)) == 2


# ---- the resolver: a listed slot whose object is absent ----

class StorageError(Exception):
    pass


class _Absent:
    """Supabase storage client whose download of FILE is a 404 (the live GET 400 not_found)."""
    def __init__(self, storage):
        self.storage = self
        self._storage = storage

    def from_(self, bucket):
        return self

    def download(self, name):
        if name not in self._storage:
            raise StorageError({"statusCode": 404, "error": "not_found", "message": "Object not found"})
        return self._storage[name]


class _NoViewport:
    ACTIVE_REVALIDATIONS = set()

    def is_viewport_enabled(self, *a, **k):
        return False

    async def get_cached_dynamic_product(self, **k):
        return None

    async def _find_any_cached_product(self, *a, **k):
        return None

    async def fetch_viewport_grid_upstream(self, **k):
        return None


def _resolver_case(runtime, monkeypatch):
    store, storage, _ = runtime
    for hours, height in ((-3, 1.2), (0, 9.9), (3, 1.4)):
        store.save_products_batch([(estimate("estimator", "euro_persistence_gfs_blend", height, valid=T + timedelta(hours=hours)), 10.0)])
    (store.cache_dir / FILE).unlink()                                 # listed, absent on L1 ...
    storage.pop(FILE)                                                 # ... and on L2 (the 19:54 delete)
    monkeypatch.setattr(module, "_get_supabase_storage", lambda: _Absent(storage))
    with module.ProductStore._l2_negative_cache_lock:
        module.ProductStore._l2_negative_cache.clear()
    with module.ProductStore._product_cache_lock:
        module.ProductStore._product_cache.clear()
    from services.weather_pipeline.grid_resolver import resolve_grid
    return asyncio.run(resolve_grid(store, _NoViewport(), model="EURO", domain="marine", layer="waves",
                                    valid_time="2026-11-08T18:00:00Z", bbox="-180,-80,180,85"))


def test_control_listed_but_absent_slot_answers_without_data(runtime, monkeypatch):
    out = _resolver_case(runtime, monkeypatch)
    assert getattr(out, "status_code", None) == 404


def test_skip_serves_the_neighbour_with_its_own_valid_time(runtime, monkeypatch):
    monkeypatch.setenv("RESOLVER_SKIP_MISSING_OBJECT", "1")
    out = _resolver_case(runtime, monkeypatch)
    assert getattr(out, "status_code", 200) == 200 and out.grid is not None
    assert out.product_id != FILE
    assert abs(out.frame_offset_hours) == 3.0 and out.frame_substituted is True      # the label names the frame served
    assert out.served_valid_time in ("2026-11-08T15:00:00Z", "2026-11-08T21:00:00Z")
    assert {round(v.speed, 1) for v in out.grid.vectors} <= {1.2, 1.4}              # never the absent slot's values

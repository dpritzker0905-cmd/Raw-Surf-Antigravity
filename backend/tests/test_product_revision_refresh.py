"""WI01: exercise actual disk/RAM/stride loader against a replaceable fake L2 object."""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from types import SimpleNamespace as S

import pytest

from tests.test_prune_shared_objects import runtime, NOW
from tests.test_ingestion_frame_validity import product
from services.weather_pipeline import store as module


@pytest.fixture
def replacement(runtime, monkeypatch):
    store, storage, _ = runtime
    monkeypatch.setenv('PRODUCT_REVISION_REFRESH', '1')
    monkeypatch.setattr(module.ProductStore, '_product_cache', {})
    monkeypatch.setattr(module.ProductStore, '_product_cache_vectors', {})
    monkeypatch.setattr(module.ProductStore, '_cached_manifest', None)
    old = product()
    old.model_run_time = NOW - timedelta(hours=6)
    old.model_run_time_status = 'known'
    filename = store.save_product(old)
    new = old.model_copy(deep=True)
    new.run_time += timedelta(hours=1)
    new.model_run_time = NOW
    new.grid.vectors[0].speed = 6
    reads = []

    def download(name):
        reads.append(name)
        return storage[name]

    monkeypatch.setattr(module, '_get_supabase_storage', lambda: S(storage=S(from_=lambda _: S(download=download))))
    return store, storage, filename, old, new, reads


def publish(case):
    store, storage, filename, _, new, _ = case
    storage[filename] = new.model_dump_json().encode()
    manifest = store.get_manifest()
    manifest.products[0].run_time = new.run_time
    manifest.products[0].model_run_time = new.model_run_time
    store._save_manifest(manifest)


@pytest.mark.parametrize('stride', [None, 2])
@pytest.mark.parametrize('warm', [False, True])
def test_changed_registration_refreshes_full_and_stride(replacement, stride, warm):
    store, _, filename, _, new, reads = replacement
    assert store.load_product(filename, stride).grid.vectors[0].speed == 4
    if not warm:
        module.ProductStore._product_cache.clear()
    publish(replacement)
    served = store.load_product(filename, stride)
    assert served.grid.vectors[0].speed == 6 and served.model_run_time == new.model_run_time
    assert reads == [filename]
    assert json.loads((store.cache_dir / filename).read_bytes())['grid']['vectors'][0]['speed'] == 6
    assert not served.stale


@pytest.mark.parametrize('fault', ['corrupt', 'empty', 'provider', 'clock', 'cycle', 'masked', 'nan', 'shape', 'bounds', 'unit', 'direction'])
def test_bad_replacement_preserves_bytes_and_actual_provenance(replacement, fault):
    store, storage, filename, old, new, reads = replacement
    before = (store.cache_dir / filename).read_bytes()
    assert store.load_product(filename).grid.vectors[0].speed == 4
    publish(replacement)
    data = new.model_dump(mode='json')
    if fault == 'provider':
        data['provider'] = 'unrelated'
    elif fault == 'clock':
        data['run_time'] = old.run_time.isoformat()
    elif fault == 'cycle':
        data['model_run_time'] = old.model_run_time.isoformat()
    elif fault == 'masked':
        data['grid']['vectors'][0]['is_valid'] = False
    elif fault == 'nan':
        data['grid']['vectors'][0]['speed'] = float('nan')
    elif fault == 'shape':
        data['grid']['cols'] = 2
    elif fault == 'bounds':
        data['grid']['bounds']['west'] = -100
    elif fault == 'unit':
        data['value_unit'] = 'ft'
    elif fault == 'direction':
        data['grid']['vectors'][0]['direction'] = float('nan')
    storage[filename] = b'{' if fault == 'corrupt' else b'' if fault == 'empty' else json.dumps(data).encode()
    served = store.load_product(filename)
    assert (store.cache_dir / filename).read_bytes() == before
    assert served.grid.vectors[0].speed == 4 and served.model_run_time == old.model_run_time
    assert served.stale and served.staleReason == 'product_revision_refresh_refused'
    assert reads == [filename]
    assert not list(store.cache_dir.glob('revision-*.tmp'))


@pytest.mark.parametrize('flag', [None, '0', 'true'])
def test_default_and_rollback_do_not_read_remote(replacement, monkeypatch, flag):
    store, _, filename, _, _, reads = replacement
    publish(replacement)
    if flag is None:
        monkeypatch.delenv('PRODUCT_REVISION_REFRESH')
    else:
        monkeypatch.setenv('PRODUCT_REVISION_REFRESH', flag)
    assert store.load_product(filename).grid.vectors[0].speed == 4
    assert reads == []


def test_unchanged_revision_has_no_remote_reads(replacement):
    store, _, filename, _, _, reads = replacement
    for stride in [None, 2, None, 3, 2]:
        assert store.load_product(filename, stride).grid.vectors[0].speed == 4
    assert reads == []


def test_all_ram_variants_refresh_and_accounting_survives(replacement):
    store, _, filename, _, _, reads = replacement
    for stride in [None, 2, 3]:
        store.load_product(filename, stride)
    publish(replacement)
    for stride in [None, 2, 3]:
        assert store.load_product(filename, stride).grid.vectors[0].speed == 6
    assert reads == [filename]
    assert set(module.ProductStore._product_cache) == set(module.ProductStore._product_cache_vectors)


def test_concurrent_full_and_stride_readers_share_one_refresh(replacement):
    store, _, filename, _, _, reads = replacement
    publish(replacement)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda stride: store.load_product(filename, stride), [None, 2] * 12))
    assert all(p.grid.vectors[0].speed == 6 for p in results)
    assert reads == [filename]


def test_measured_zero_and_partial_mask_survive(replacement):
    store, _, filename, _, new, reads = replacement
    new.grid.cols = 2
    new.grid.vectors[0].speed = 0
    masked = new.grid.vectors[0].model_copy(update={'is_valid': False, 'speed': 8})
    new.grid.vectors.append(masked)
    publish(replacement)
    served = store.load_product(filename)
    assert served.grid.vectors[0].speed == 0 and not served.grid.vectors[1].is_valid
    assert reads == [filename]


def test_manifest_changed_during_download_refuses_old_response(replacement, monkeypatch):
    store, storage, filename, old, new, reads = replacement
    publish(replacement)
    response = storage[filename]

    def download(name):
        reads.append(name)
        manifest = store.get_manifest()
        manifest.products[0].run_time = new.run_time + timedelta(hours=1)
        store._save_manifest(manifest)
        return response

    monkeypatch.setattr(module, '_get_supabase_storage', lambda: S(storage=S(from_=lambda _: S(download=download))))
    served = store.load_product(filename)
    assert served.grid.vectors[0].speed == 4 and served.run_time == old.run_time
    assert served.stale


@pytest.mark.parametrize('reason', ['missing', 'ambiguous'])
def test_unverifiable_registration_does_not_replace_local(replacement, reason):
    store, _, filename, _, _, reads = replacement
    publish(replacement)
    manifest = store.get_manifest()
    if reason == 'missing':
        manifest.products.clear()
    else:
        manifest.products.append(manifest.products[0].model_copy(update={'provider': 'other'}))
    store._save_manifest(manifest)
    served = store.load_product(filename)
    assert served.grid.vectors[0].speed == 4 and served.stale
    assert served.staleReason == 'product_revision_unverified'
    assert reads == []


@pytest.mark.parametrize('failure', ['timeout', '404', '429', 'atomic'])
def test_failure_is_bounded_and_recovers_later(replacement, monkeypatch, failure):
    from services.weather_pipeline import product_revision_refresh as repair
    store, storage, filename, old, _, reads = replacement
    publish(replacement)
    before = (store.cache_dir / filename).read_bytes()
    good_replace = repair.os.replace
    clock = [100.0]
    monkeypatch.setattr(repair.time, 'monotonic', lambda: clock[0])
    # Transport retry has its own tested budget; isolate revision refusal/recovery here.
    monkeypatch.setattr('services.weather_pipeline.l2_retry.read_with_retry', lambda fn, _: fn())

    def download(name):
        reads.append(name)
        if failure != 'atomic':
            raise TimeoutError() if failure == 'timeout' else RuntimeError('HTTP ' + failure)
        return storage[name]

    monkeypatch.setattr(module, '_get_supabase_storage', lambda: S(storage=S(from_=lambda _: S(download=download))))
    if failure == 'atomic':
        monkeypatch.setattr(repair.os, 'replace', lambda *_: (_ for _ in ()).throw(PermissionError()))
    for _ in range(3):
        served = store.load_product(filename)
        assert served.stale and served.run_time == old.run_time
    assert reads == [filename] and (store.cache_dir / filename).read_bytes() == before
    assert not list(store.cache_dir.glob('revision-*.tmp'))
    monkeypatch.setattr(repair.os, 'replace', good_replace)
    monkeypatch.setattr(module, '_get_supabase_storage', lambda: S(storage=S(from_=lambda _: S(download=lambda _: storage[filename]))))
    clock[0] += 6
    served = store.load_product(filename)
    assert not served.stale and served.grid.vectors[0].speed == 6


@pytest.mark.parametrize('fault', ['older_cycle', 'lost_cycle', 'provider', 'older_receipt'])
def test_manifest_regression_does_not_overwrite_newer_local(replacement, fault):
    store, storage, filename, old, new, reads = replacement
    if fault == 'older_cycle':
        new.model_run_time = old.model_run_time - timedelta(hours=6)
    elif fault == 'lost_cycle':
        new.model_run_time = None
        new.model_run_time_status = 'missing'
    elif fault == 'older_receipt':
        new.model_run_time = old.model_run_time
        new.run_time = old.run_time - timedelta(hours=1)
    else:
        new.provider = 'other'
    publish(replacement)
    if fault in ['lost_cycle', 'provider']:
        manifest = store.get_manifest()
        manifest.products[0].provider = new.provider
        manifest.products[0].model_run_time_status = new.model_run_time_status
        store._save_manifest(manifest)
    served = store.load_product(filename)
    assert served.grid.vectors[0].speed == 4 and served.stale
    assert reads == []


def test_same_metadata_rewrite_is_explicit_legacy_limit(replacement):
    store, storage, filename, old, _, reads = replacement
    changed = old.model_copy(deep=True)
    changed.grid.vectors[0].speed = 9
    storage[filename] = changed.model_dump_json().encode()
    assert store.load_product(filename).grid.vectors[0].speed == 4
    assert reads == []  # No digest/revision exists in the legacy manifest; do not claim detection.


def test_stable_manifest_index_and_bounded_memos(replacement, monkeypatch):
    from services.weather_pipeline import product_revision_refresh as repair
    store, _, filename, _, _, _ = replacement
    store.load_product(filename)
    index = store._revision_index
    for _ in range(10):
        store.load_product(filename)
    assert store._revision_index is index
    for number in range(1000):
        repair._remember(store._revision_disk, str(number), number)
        repair._remember(store._revision_refusals, str(number), number)
    assert len(store._revision_disk) == len(store._revision_refusals) == 256
    assert len(repair._LOCKS) == 64


def test_unknown_cycle_is_storage_revision_not_inferred_physics(replacement):
    store, _, filename, old, new, _ = replacement
    old.model_run_time = new.model_run_time = None
    old.model_run_time_status = new.model_run_time_status = 'missing'
    (store.cache_dir / filename).write_text(old.model_dump_json(), encoding='utf-8')
    manifest = store.get_manifest()
    manifest.products[0].model_run_time = None
    manifest.products[0].model_run_time_status = 'missing'
    store._save_manifest(manifest)
    publish(replacement)
    served = store.load_product(filename)
    assert served.grid.vectors[0].speed == 6
    assert served.model_run_time is None and served.model_run_time_status == 'missing'


def test_index_overflow_refuses_certification(replacement, monkeypatch):
    from services.weather_pipeline import product_revision_refresh as repair
    store, _, filename, _, _, reads = replacement
    monkeypatch.setattr(repair, '_INDEX_LIMIT', 0)
    publish(replacement)
    served = store.load_product(filename)
    assert served.stale and served.staleReason == 'product_revision_unverified'
    assert reads == [] and store._revision_index[1] == {}


def test_stale_inflight_ram_entry_cannot_undo_disk_refresh(replacement):
    store, _, filename, old, _, reads = replacement
    publish(replacement)
    assert store.load_product(filename).grid.vectors[0].speed == 6
    # Simulate a concurrent old disk reader inserting after the successful invalidation.
    import time
    module.ProductStore._product_cache[filename] = (old, time.time())
    module.ProductStore._product_cache_vectors[filename] = 1
    assert store.load_product(filename).grid.vectors[0].speed == 6
    assert reads == [filename]


@pytest.mark.parametrize('where', ['inside', 'outside', 'invalid'])
def test_point_sampler_preserves_refresh_refusal(replacement, where):
    from services.weather_pipeline.sampler import PointSampler
    store, storage, filename, old, _, _ = replacement
    publish(replacement)
    storage[filename] = b'bad replacement'
    served = store.load_product(filename)
    if where == 'invalid':
        served = served.model_copy(deep=True)
        served.grid.vectors[0].is_valid = False
    response = PointSampler().sample_point(served, 0 if where == 'outside' else 29, 0 if where == 'outside' else -87)
    assert response.stale and response.staleReason == 'product_revision_refresh_refused'
    assert response.model_run_time == old.model_run_time

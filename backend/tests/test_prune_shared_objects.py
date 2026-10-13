"""WI-04: removing a manifest registration must not delete a retained object's storage key."""
import json
from concurrent.futures import Future
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import store as module
from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, ManifestProduct, NormalizedGrid, NormalizedProduct, PipelineManifest,
)

NOW = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
BOUNDS = CoverageBounds(west=-88, south=28, east=-86, north=30)


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
    monkeypatch.setenv('INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS', '1')
    monkeypatch.setenv('MANIFEST_MERGE_ON_UPLOAD', '1')
    monkeypatch.setattr(module, '_fetch_remote_manifest_products', lambda: [])
    monkeypatch.setattr(module, '_upload_executor', ImmediateExecutor())
    monkeypatch.setattr(module, '_manifest_executor', ImmediateExecutor())
    storage, deleted = {}, []
    store = module.ProductStore(cache_dir=tmp_path)

    def upload(filename, data, **kwargs):
        storage[filename] = data
        return True

    def delete(filename):
        deleted.append(filename)
        storage.pop(filename, None)

    monkeypatch.setattr(store, '_upload_to_supabase', upload)
    monkeypatch.setattr(store, '_delete_from_supabase', delete)
    return store, storage, deleted


def product(filename, *, newer=False, different_id=False, old=False):
    valid = NOW - timedelta(days=3) if old else NOW + timedelta(days=4)
    return ManifestProduct(
        model='GFS', domain='marine', layer='waves', provider='noaa' if newer else 'legacy',
        run_time=NOW + timedelta(hours=1) if newer else NOW, valid_time_start=valid, valid_time_end=valid,
        filename=filename, product_id=('survivor' if newer else 'removed') if different_id else filename,
        region_id='gulf', coverage=BOUNDS, resolution=0.25, freshness_sec=0,
        is_forecast_authoritative=True, is_estimated=False,
    )


def arrange(runtime, mode, different_id=False, same_file=True):
    store, storage, _ = runtime
    old = product('shared.json', different_id=different_id, old=mode == 'old')
    new = product('shared.json' if same_file else 'new.json', newer=True, different_id=different_id)
    store._save_manifest(PipelineManifest(products=[old, new], last_manifest_update=NOW))
    for p in [old, new]:
        content = b'new frame' if p is new else b'old frame'
        (store.cache_dir / p.filename).write_bytes(content)
        storage[p.filename] = content
    return old, new


def prune(store, mode):
    if mode == 'duplicate':
        return store.prune_duplicate_valid_times()
    if mode == 'superseded':
        return store.prune_superseded_products('GFS', 'marine', 'waves', 'gulf', NOW + timedelta(hours=1))
    return store.prune_old_products(NOW - timedelta(days=2))


@pytest.mark.parametrize('mode', ['duplicate', 'superseded', 'old'])
@pytest.mark.parametrize('different_id', [False, True])
def test_enabled_prune_keeps_shared_file_and_l2_object(runtime, mode, different_id):
    _, new = arrange(runtime, mode, different_id)
    store, storage, deleted = runtime
    prune(store, mode)
    assert (store.cache_dir / 'shared.json').read_bytes() == b'new frame'
    assert storage['shared.json'] == b'new frame' and deleted == []
    assert [p.run_time for p in store.get_manifest().products] == [new.run_time]
    assert [p['run_time'] for p in json.loads(storage['manifest.json'])['products']] == [new.run_time.isoformat().replace('+00:00', 'Z')]
    prune(store, mode)
    assert storage['shared.json'] == b'new frame' and deleted == []


@pytest.mark.parametrize('mode', ['duplicate', 'superseded', 'old'])
def test_enabled_prune_still_deletes_an_unreferenced_file(runtime, mode):
    arrange(runtime, mode, same_file=False)
    store, storage, deleted = runtime
    prune(store, mode)
    assert not (store.cache_dir / 'shared.json').exists()
    assert 'shared.json' not in storage and deleted == ['shared.json']
    assert storage['new.json'] == b'new frame'


@pytest.mark.parametrize('mode', ['duplicate', 'superseded', 'old'])
@pytest.mark.parametrize('flag', [None, '0', 'true'])
def test_unset_off_and_noncanonical_flag_retain_legacy_behavior(runtime, monkeypatch, mode, flag):
    if flag is None:
        monkeypatch.delenv('INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS')
    else:
        monkeypatch.setenv('INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS', flag)
    arrange(runtime, mode)
    store, storage, deleted = runtime
    prune(store, mode)
    assert not (store.cache_dir / 'shared.json').exists()
    assert 'shared.json' not in storage and deleted == ['shared.json']


def test_real_save_provider_collision_dedup_keeps_latest_bytes(runtime):
    store, storage, deleted = runtime
    filenames = []
    for provider, run, height in [('legacy', NOW, 2), ('noaa', NOW + timedelta(hours=1), 4)]:
        item = NormalizedProduct(
            model='GFS', provider=provider, domain='marine', layer='waves', run_time=run,
            valid_time=NOW + timedelta(days=4), coverage=BOUNDS, region_id='gulf',
            is_forecast_authoritative=True, is_estimated=False, freshness_sec=0,
            value_kind='height', value_unit='m', display_unit_hint='ft', source_variables=['hs'],
            grid=NormalizedGrid(bounds=BOUNDS, cols=1, rows=1,
                                vectors=[GridVector(lat=29, lng=-87, speed=height)]),
        )
        filenames.append(store.save_product(item, resolution=0.25))
    assert filenames[0] == filenames[1]
    assert len(store.get_manifest().products) == 2
    assert store.prune_duplicate_valid_times() == 1
    assert json.loads((store.cache_dir / filenames[1]).read_bytes())['grid']['vectors'][0]['speed'] == 4
    assert json.loads(storage[filenames[1]])['grid']['vectors'][0]['speed'] == 4
    assert deleted == [] and len(store.get_manifest().products) == 1


@pytest.mark.parametrize('mode', ['duplicate', 'superseded', 'old'])
def test_protection_accounts_for_retained_references_in_other_layers(runtime, mode):
    arrange(runtime, mode, same_file=False)
    store, storage, deleted = runtime
    manifest = store.get_manifest()
    other = product('shared.json').model_copy(update={'layer': 'swell_1', 'product_id': 'other-layer'})
    manifest.products.append(other)
    store._save_manifest(manifest)
    prune(store, mode)
    assert (store.cache_dir / 'shared.json').exists() and 'shared.json' in storage
    assert deleted == []
    assert {p.product_id for p in store.get_manifest().products} == {'new.json', 'other-layer'}


def test_shared_survivor_key_is_not_excluded_from_real_remote_reconciliation(runtime, monkeypatch):
    _, winner = arrange(runtime, 'duplicate')
    store, storage, deleted = runtime
    newer_remote = winner.model_copy(update={'run_time': NOW + timedelta(hours=2)})
    unrelated = product('concurrent.json', newer=True)
    monkeypatch.setattr(module, '_fetch_remote_manifest_products', lambda: [
        json.loads(newer_remote.model_dump_json()), json.loads(unrelated.model_dump_json()),
    ])
    prune(store, 'duplicate')
    uploaded = json.loads(storage['manifest.json'])['products']
    assert {p['filename'] for p in uploaded} == {'shared.json', 'concurrent.json'}
    shared = next(p for p in uploaded if p['filename'] == 'shared.json')
    assert datetime.fromisoformat(shared['run_time'].replace('Z', '+00:00')) == newer_remote.run_time
    assert storage['shared.json'] == b'new frame' and deleted == []


@pytest.mark.parametrize('mode', ['duplicate', 'superseded', 'old'])
def test_opt_in_has_null_jacobian_on_manifest_selection(runtime, monkeypatch, mode):
    store, _, _ = runtime
    snapshots = []
    for flag in ['0', '1']:
        monkeypatch.setenv('INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS', flag)
        arrange(runtime, mode)
        prune(store, mode)
        snapshots.append([p.model_dump(mode='json') for p in store.get_manifest().products])
    assert snapshots[0] == snapshots[1]


def test_flag_is_read_at_call_time_and_can_be_rolled_back(runtime, monkeypatch):
    store, storage, deleted = runtime
    arrange(runtime, 'duplicate')
    prune(store, 'duplicate')
    assert 'shared.json' in storage
    monkeypatch.setenv('INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS', '0')
    arrange(runtime, 'duplicate')
    prune(store, 'duplicate')
    assert 'shared.json' not in storage and deleted == ['shared.json']

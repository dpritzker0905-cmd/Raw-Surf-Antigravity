"""WI06: late receipt clocks cannot delete newer known cycles or sole forecast hours."""
from datetime import timedelta

import pytest

from tests.test_prune_shared_objects import runtime, NOW, product
from services.weather_pipeline.schemas import PipelineManifest


def arrange(case, products):
    store, storage, _ = case
    store._save_manifest(PipelineManifest(products=products, last_manifest_update=NOW))
    for p in products:
        (store.cache_dir / p.filename).write_bytes(b'complete object')
        storage[p.filename] = b'complete object'


def frame(filename, cycle, *, received=0):
    p = product(filename)
    p.provider = 'noaa'
    p.coverage_mode = 'regional_tile'
    p.model_run_time = NOW + timedelta(hours=cycle)
    p.model_run_time_status = 'known'
    p.run_time = NOW + timedelta(hours=received)
    return p


def sweep(store, mode):
    if mode == 'duplicate':
        return store.prune_duplicate_valid_times()
    return store.prune_superseded_products('GFS', 'marine', 'waves', 'gulf', NOW + timedelta(hours=10))


@pytest.fixture
def guarded(runtime, monkeypatch):
    monkeypatch.setenv('INGEST_PRUNE_VERIFIED_CYCLES', '1')
    return runtime


@pytest.mark.parametrize('mode', ['duplicate', 'superseded'])
@pytest.mark.parametrize('reverse', [False, True])
def test_late_old_cycle_never_deletes_newer_cycle(guarded, mode, reverse):
    older = frame('older.json', -6, received=1)
    newest = frame('newest.json', 0)
    arrange(guarded, [newest, older] if reverse else [older, newest])
    store, storage, deleted = guarded
    sweep(store, mode)
    assert [p.filename for p in store.get_manifest().products] == ['newest.json']
    assert deleted == ['older.json'] and storage['newest.json'] == b'complete object'
    sweep(store, mode)
    assert deleted == ['older.json']


@pytest.mark.parametrize('mode', ['duplicate', 'superseded'])
@pytest.mark.parametrize('difference', ['provider', 'resolution', 'bounds', 'region', 'layer', 'model', 'estimated', 'hour', 'end'])
def test_distinct_coverage_or_source_is_not_superseded(guarded, mode, difference):
    older, newest = frame('older.json', -6), frame('newest.json', 0, received=1)
    if difference == 'provider':
        older.provider = 'other'
    elif difference == 'resolution':
        older.resolution = 2
    elif difference == 'bounds':
        older.coverage = older.coverage.model_copy(update={'west': -90})
    elif difference == 'region':
        older.region_id = 'other'
    elif difference == 'layer':
        older.layer = 'swell_1'
    elif difference == 'model':
        older.model = 'EURO'
    elif difference == 'estimated':
        older.is_estimated = True
        older.is_forecast_authoritative = False
    elif difference == 'hour':
        older.valid_time_start += timedelta(hours=3)
        older.valid_time_end += timedelta(hours=3)
    else:
        older.valid_time_end += timedelta(hours=3)
    arrange(guarded, [older, newest])
    store, storage, deleted = guarded
    sweep(store, mode)
    assert {p.filename for p in store.get_manifest().products} == {'older.json', 'newest.json'}
    assert deleted == [] and len(storage) == 2


@pytest.mark.parametrize('status', ['missing', 'incomplete', 'conflicting', 'invalid', 'known_naive'])
@pytest.mark.parametrize('mode', ['duplicate', 'superseded'])
def test_unverified_cycle_is_retained_without_ingest_clock_ranking(guarded, status, mode):
    older, newest = frame('older.json', -6), frame('newest.json', 0, received=1)
    older.model_run_time_status = 'known' if status == 'known_naive' else status
    older.model_run_time = older.model_run_time.replace(tzinfo=None) if status == 'known_naive' else None
    arrange(guarded, [older, newest])
    store, _, deleted = guarded
    sweep(store, mode)
    assert {p.filename for p in store.get_manifest().products} == {'older.json', 'newest.json'}
    assert deleted == []


@pytest.mark.parametrize('mode', ['duplicate', 'superseded'])
def test_shared_storage_is_protected_with_cycle_flag_alone(guarded, monkeypatch, mode):
    monkeypatch.setenv('INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS', '0')
    arrange(guarded, [frame('shared.json', -6), frame('shared.json', 0, received=1)])
    store, storage, deleted = guarded
    sweep(store, mode)
    assert len(store.get_manifest().products) == 1
    assert storage['shared.json'] == b'complete object' and deleted == []
    assert (store.cache_dir / 'shared.json').read_bytes() == b'complete object'


@pytest.mark.parametrize('mode', ['duplicate', 'superseded'])
@pytest.mark.parametrize('flag', [None, '0', 'true'])
def test_default_off_keeps_legacy_clock_ranking(guarded, monkeypatch, mode, flag):
    if flag is None:
        monkeypatch.delenv('INGEST_PRUNE_VERIFIED_CYCLES')
    else:
        monkeypatch.setenv('INGEST_PRUNE_VERIFIED_CYCLES', flag)
    arrange(guarded, [frame('older.json', -6, received=1), frame('newest.json', 0)])
    store, _, _ = guarded
    sweep(store, mode)
    assert [p.filename for p in store.get_manifest().products] == ['older.json']


@pytest.mark.parametrize('reverse', [False, True])
def test_same_cycle_tie_is_stable_without_receipt_clock(guarded, reverse):
    a, z = frame('a.json', 0), frame('z.json', 0, received=1)
    arrange(guarded, [z, a] if reverse else [a, z])
    store, _, deleted = guarded
    sweep(store, 'duplicate')
    assert [p.filename for p in store.get_manifest().products] == ['a.json'] and deleted == ['z.json']


@pytest.mark.parametrize('incoming_cycle,current_cycle,incoming_receipt,accept', [
    (-6, 0, 1, False), (0, -6, -1, True), (0, 0, 1, True), (0, 0, -1, False),
])
def test_reconciliation_cannot_undo_verified_cycle_ranking(guarded, monkeypatch, incoming_cycle, current_cycle, incoming_receipt, accept):
    from services.weather_pipeline import store as module
    current = frame('shared.json', current_cycle)
    incoming = frame('shared.json', incoming_cycle, received=incoming_receipt)
    arrange(guarded, [current])
    store, _, _ = guarded
    monkeypatch.setattr(module, '_fetch_remote_manifest_products', lambda: [incoming.model_dump(mode='json')])
    manifest = store.get_manifest()
    module.reconcile_manifest_products_for_upload(manifest)
    expected = incoming if accept else current
    assert manifest.products[0].model_run_time == expected.model_run_time
    assert manifest.products[0].run_time == expected.run_time


@pytest.mark.parametrize('status', ['missing', 'invalid'])
def test_unknown_remote_collision_does_not_certify_newer_cycle(guarded, monkeypatch, status):
    from services.weather_pipeline import store as module
    current, incoming = frame('shared.json', 0), frame('shared.json', -6, received=1)
    incoming.model_run_time = None
    incoming.model_run_time_status = status
    arrange(guarded, [current])
    store, _, _ = guarded
    monkeypatch.setattr(module, '_fetch_remote_manifest_products', lambda: [incoming.model_dump(mode='json')])
    manifest = store.get_manifest()
    module.reconcile_manifest_products_for_upload(manifest)
    assert manifest.products[0].model_run_time == current.model_run_time


def test_prune_manifest_publication_retains_newest_shared_registration(guarded, monkeypatch):
    import json
    from services.weather_pipeline import store as module
    newest = frame('shared.json', 0)
    late = frame('shared.json', -6, received=1)
    duplicate = frame('other.json', -6, received=1)
    arrange(guarded, [newest, duplicate])
    store, storage, _ = guarded
    monkeypatch.setattr(module, '_fetch_remote_manifest_products', lambda: [late.model_dump(mode='json')])
    sweep(store, 'duplicate')
    remote = json.loads(storage['manifest.json'])['products']
    assert len(remote) == 1 and remote[0]['model_run_time'] == newest.model_run_time.isoformat().replace('+00:00', 'Z')

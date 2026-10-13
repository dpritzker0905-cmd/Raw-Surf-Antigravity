"""Actual persistence diagnostics bound remote reads and disclose freshness/failures."""
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace as S
from unittest.mock import Mock
import threading
import time

import pytest

from services.weather_pipeline import store as module


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    ticks = [100.]
    probe = getattr(module, '_persistence_listing_probe', None)
    if probe is not None:
        monkeypatch.setattr(module, '_persistence_listing_probe', type(probe)(clock=lambda: ticks[0]))
    listing = Mock(return_value=[{'name': 'frame.json'}, {'name': 'manifest.json'}, {'name': 'folder'}])
    sb = S(storage=S(from_=Mock(return_value=S(list=listing))))
    getter = Mock(return_value=sb)
    monkeypatch.setattr(module, '_get_supabase_storage', getter)
    store = module.ProductStore(tmp_path)
    return S(store=store, listing=listing, getter=getter, ticks=ticks, path=tmp_path)


@pytest.mark.parametrize('calls', [1, 2, 5, 10])
@pytest.mark.parametrize('failed', [False, True])
def test_success_and_failure_have_bounded_reads_and_explicit_page_scope(runtime, calls, failed):
    if failed:
        runtime.listing.side_effect = RuntimeError('offline storage unavailable')
    snapshots = [runtime.store.get_persistence_diagnostics() for _ in range(calls)]
    assert runtime.listing.call_count == 1
    assert runtime.getter.call_count == 1
    for result in snapshots:
        assert result['supabase_connected']
        assert result['supabase_product_count'] == (-1 if failed else 1)
        assert result['supabase_listing']['status'] == ('error' if failed else 'ok')
        assert result['supabase_listing']['scope'] == 'first_page'
        assert result['supabase_listing']['age_sec'] == 0.
        assert result['supabase_listing']['ttl_sec'] == 30.
        assert result['supabase_listing']['checked_at']
    assert snapshots[-1]['supabase_listing']['cached'] is (calls > 1)


@pytest.mark.parametrize('first_failed', [False, True])
def test_expiry_refreshes_at_boundary_and_preserves_current_failure(runtime, first_failed):
    runtime.listing.side_effect = RuntimeError('offline') if first_failed else None
    runtime.store.get_persistence_diagnostics()
    runtime.ticks[0] += 29.9
    cached = runtime.store.get_persistence_diagnostics()
    assert runtime.listing.call_count == 1
    assert cached['supabase_listing']['age_sec'] == 29.9
    runtime.listing.side_effect = None if first_failed else RuntimeError('offline')
    runtime.ticks[0] += .1
    refreshed = runtime.store.get_persistence_diagnostics()
    assert runtime.listing.call_count == 2
    assert refreshed['supabase_product_count'] == (1 if first_failed else -1)
    assert refreshed['supabase_listing']['status'] == ('ok' if first_failed else 'error')
    assert not refreshed['supabase_listing']['cached']


def test_cache_is_shared_across_instances_but_local_disk_and_restore_are_current(runtime, monkeypatch):
    runtime.store.get_persistence_diagnostics()
    (runtime.path / 'later.json').write_text('{}')
    monkeypatch.setattr(module.ProductStore, '_restored_count', 17)
    monkeypatch.setattr(module.ProductStore, '_restore_errors', ['offline restore failure'])
    later = module.ProductStore(runtime.path).get_persistence_diagnostics()
    assert runtime.listing.call_count == 1
    assert later['disk_product_count'] == 1
    assert later['restored_count'] == 17 and later['restore_errors'] == ['offline restore failure']


@pytest.mark.parametrize('failed', [False, True])
def test_concurrent_cold_diagnostics_share_one_listing(runtime, failed):
    lock = threading.Lock()
    barrier = threading.Barrier(8)
    attempts = []

    def listing():
        with lock:
            attempts.append(1)
        time.sleep(.025)
        if failed:
            raise RuntimeError('offline unavailable')
        return [{'name': 'frame.json'}]

    runtime.listing.side_effect = listing

    def check(_):
        barrier.wait(timeout=5)
        return runtime.store.get_persistence_diagnostics()

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(check, range(8)))
    assert len(attempts) == 1
    assert all(r['supabase_product_count'] == (-1 if failed else 1) for r in results)
    assert sum(not r['supabase_listing']['cached'] for r in results) == 1


def test_absent_client_is_unknown_not_zero_or_healthy_and_rechecks_after_expiry(runtime):
    runtime.getter.return_value = None
    first = runtime.store.get_persistence_diagnostics()
    assert not first['supabase_connected'] and first['supabase_product_count'] is None
    assert first['supabase_listing']['status'] == 'unavailable'
    runtime.store.get_persistence_diagnostics()
    assert runtime.getter.call_count == 1 and runtime.listing.call_count == 0
    runtime.ticks[0] += 30
    runtime.getter.return_value = S(storage=S(from_=lambda _: S(list=runtime.listing)))
    assert runtime.store.get_persistence_diagnostics()['supabase_listing']['status'] == 'ok'


@pytest.mark.parametrize('malformed', [None, {}, 'not a listing'])
def test_malformed_listing_is_not_reported_as_successful_empty_storage(runtime, malformed):
    runtime.listing.return_value = malformed
    result = runtime.store.get_persistence_diagnostics()
    assert result['supabase_product_count'] == -1
    assert result['supabase_listing']['status'] == 'error'


def test_empty_list_is_a_known_zero_for_this_page_only(runtime):
    runtime.listing.return_value = []
    result = runtime.store.get_persistence_diagnostics()
    assert result['supabase_product_count'] == 0
    assert result['supabase_listing']['status'] == 'ok'
    assert result['supabase_listing']['scope'] == 'first_page'


def test_caller_mutation_does_not_poison_cached_diagnostics(runtime):
    first = runtime.store.get_persistence_diagnostics()
    first['supabase_listing']['status'] = 'tampered'
    first['supabase_product_count'] = 9999
    next_result = runtime.store.get_persistence_diagnostics()
    assert next_result['supabase_product_count'] == 1
    assert next_result['supabase_listing']['status'] == 'ok'


def test_client_initialization_failure_is_explicit_and_cooled_down(runtime):
    runtime.getter.side_effect = RuntimeError('offline configuration failure')
    result = runtime.store.get_persistence_diagnostics()
    assert not result['supabase_connected']
    assert result['supabase_product_count'] == -1
    assert result['supabase_listing']['status'] == 'error'
    runtime.store.get_persistence_diagnostics()
    assert runtime.getter.call_count == 1

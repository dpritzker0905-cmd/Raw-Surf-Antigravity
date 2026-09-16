"""Storage failures must not turn every rating read into another Storage request."""
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock

import pytest

from services.weather_pipeline import spot_ratings_precompute as pc


@pytest.fixture
def clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr('time.time', lambda: now[0])
    monkeypatch.setattr('time.monotonic', lambda: now[0])
    monkeypatch.setattr(pc, '_l2_cache', {'obj': None, 'ts': None})
    return now


def test_missing_object_is_cached_briefly_then_recovery_is_visible(clock, monkeypatch):
    recovered = {'frames': [{'model': 'GFS'}]}
    load = Mock(side_effect=[None, recovered])
    monkeypatch.setattr(pc, 'load_spot_ratings_l2', load)
    assert pc.load_spot_ratings_l2_cached() is None
    clock[0] += 59
    assert pc.load_spot_ratings_l2_cached() is None
    assert load.call_count == 1
    clock[0] += 1
    assert pc.load_spot_ratings_l2_cached() is recovered
    assert load.call_count == 2


def test_positive_cache_keeps_existing_ttl(clock, monkeypatch):
    first, second = {'frames': []}, {'frames': [{'model': 'ICON'}]}
    load = Mock(side_effect=[first, second])
    monkeypatch.setattr(pc, 'load_spot_ratings_l2', load)
    assert pc.load_spot_ratings_l2_cached() is first
    clock[0] += 299
    assert pc.load_spot_ratings_l2_cached() is first
    clock[0] += 1
    assert pc.load_spot_ratings_l2_cached() is second
    assert load.call_count == 2


def test_short_caller_ttl_also_bounds_failed_read(clock, monkeypatch):
    load = Mock(return_value=None)
    monkeypatch.setattr(pc, 'load_spot_ratings_l2', load)
    pc.load_spot_ratings_l2_cached(ttl=5)
    clock[0] += 4
    pc.load_spot_ratings_l2_cached(ttl=5)
    assert load.call_count == 1
    clock[0] += 1
    pc.load_spot_ratings_l2_cached(ttl=5)
    assert load.call_count == 2


def test_zero_ttl_bypasses_cached_failure(clock, monkeypatch):
    load = Mock(return_value=None)
    monkeypatch.setattr(pc, 'load_spot_ratings_l2', load)
    pc.load_spot_ratings_l2_cached(ttl=0)
    pc.load_spot_ratings_l2_cached(ttl=0)
    assert load.call_count == 2


def test_ttl_starts_after_slow_read_completes(clock, monkeypatch):
    def slow_read():
        clock[0] += 10
        return None
    load = Mock(side_effect=slow_read)
    monkeypatch.setattr(pc, 'load_spot_ratings_l2', load)
    pc.load_spot_ratings_l2_cached()
    clock[0] += 59
    pc.load_spot_ratings_l2_cached()
    assert load.call_count == 1


def test_concurrent_failed_reads_share_one_storage_attempt(clock, monkeypatch):
    entered, release, second_started = threading.Event(), threading.Event(), threading.Event()
    def read():
        entered.set()
        assert release.wait(5)
        return None
    load = Mock(side_effect=read)
    monkeypatch.setattr(pc, 'load_spot_ratings_l2', load)
    def second():
        second_started.set()
        return pc.load_spot_ratings_l2_cached()
    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(pc.load_spot_ratings_l2_cached)
        try:
            assert entered.wait(5)
            b = pool.submit(second)
            assert second_started.wait(5)
        finally:
            release.set()
        assert a.result(timeout=5) is None
        assert b.result(timeout=5) is None
    assert load.call_count == 1

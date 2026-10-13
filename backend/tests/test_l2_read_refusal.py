"""W-23 (LESSONS L-F7): a REFUSED L2 read on the serve box is retried, is not cached as an ABSENT file, and the answer
served around it says so.

Measured 2026-09-30 02:23Z: 9 of 57 /grid calls came back as the 2-degree global_mid product while labelled `regional`,
with no fallbackReason; each had its own Render line (a 429 on the tile's L2 GET -> `Dynamic L2 download failed` ->
the mid tier). The download had no retry, and every failure, a transient 429 included, went into the 60 s negative
cache that means "this file does not exist". These tests drive the REAL load path (load_product_helper) with only the
storage client faked, the lesson of 2026-09-30's wind residual (L-P11): never mock the function under test.
"""
import asyncio
import logging
import time
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import l2_retry as R
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

FILE = "gfs_marine_waves_uk_ireland_20261002T030000Z.json"


class StorageError(Exception):
    """The shape supabase-py raises: one dict argument carrying statusCode / error / message."""


def _429():
    return StorageError({"statusCode": 429, "error": "too_many_connections",
                         "message": "Too many connections issued to the database"})


def _404():
    return StorageError({"statusCode": 404, "error": "not_found", "message": "Object not found"})


def _product_bytes():
    now = datetime(2026, 10, 2, 3, tzinfo=timezone.utc)
    cov = CoverageBounds(west=-11.0, south=49.0, east=1.0, north=59.0)
    p = NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves", run_time=now, valid_time=now,
        is_forecast_authoritative=True, is_estimated=False, coverage=cov,
        grid=NormalizedGrid(bounds=cov, cols=1, rows=1, vectors=[GridVector(lat=55.0, lng=-5.0, speed=1.2,
                                                                             direction=270.0, u=1.2, v=0.0)]),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft", product_id=FILE,
        source_variables=["wave_height"], freshness_sec=1800, region_id="uk_ireland", coverage_mode="regional_tile")
    return p.model_dump_json().encode("utf-8")


class _Bucket:
    def __init__(self, script):
        self.script, self.calls = list(script), 0

    def download(self, filename):
        self.calls += 1
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


class _Storage:
    def __init__(self, bucket):
        self.bucket = bucket

    def from_(self, name):
        return self.bucket


class _SB:
    def __init__(self, bucket):
        self.storage = _Storage(bucket)


@pytest.fixture
def store(monkeypatch, tmp_path):
    import services.weather_pipeline.store as store_mod
    from services.weather_pipeline.store import ProductStore
    monkeypatch.setattr(ProductStore, "_l2_negative_cache", {})
    monkeypatch.setattr(ProductStore, "_product_cache", {})
    monkeypatch.setattr(R.time, "sleep", lambda s: None)          # the backoff, not the test, waits
    s = object.__new__(ProductStore)
    s.cache_dir = tmp_path
    return s, store_mod, ProductStore


def _load(s, store_mod, monkeypatch, script):
    from services.weather_pipeline.store_helpers import load_product_helper
    bucket = _Bucket(script)
    monkeypatch.setattr(store_mod, "_get_supabase_storage", lambda: _SB(bucket))
    return load_product_helper(s, FILE), bucket


# ── classification and the retry ──────────────────────────────────────────────────────────────────────────────────

def test_a_429_or_a_timeout_is_transient_and_a_404_is_not():
    assert R.transient_storage_error(_429())
    assert R.transient_storage_error(TimeoutError("read timed out"))
    assert R.transient_storage_error(Exception("HTTP/2 429 Too Many Requests"))
    assert not R.transient_storage_error(_404())
    assert not R.transient_storage_error(Exception("Object not found"))


def test_read_with_retry_retries_only_transient_failures_and_has_a_kill_switch(monkeypatch):
    sleeps = []
    script = [_429(), _429(), b"ok"]

    def flaky():
        step = script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step
    assert R.read_with_retry(flaky, "f", sleep=sleeps.append) == b"ok"
    assert len(sleeps) == 2 and all(0 < d <= 1.5 for d in sleeps)                # short budget: a user is waiting
    calls = []

    def not_found():
        calls.append(1)
        raise _404()
    with pytest.raises(StorageError):
        R.read_with_retry(not_found, "f", sleep=lambda s: None)
    assert len(calls) == 1                                                         # "no" is not retried
    monkeypatch.setenv("L2_READ_MAX_ATTEMPTS", "1")
    calls.clear()

    def refused():
        calls.append(1)
        raise _429()
    with pytest.raises(StorageError):
        R.read_with_retry(refused, "f", sleep=lambda s: None)
    assert len(calls) == 1


# ── the real load path ────────────────────────────────────────────────────────────────────────────────────────────

def test_a_transient_429_is_retried_and_the_regional_tile_loads(store, monkeypatch):
    s, store_mod, PS = store
    product, bucket = _load(s, store_mod, monkeypatch, [_429(), _product_bytes()])
    assert product is not None and product.region_id == "uk_ireland"
    assert bucket.calls == 2 and FILE not in PS._l2_negative_cache


def test_a_refused_read_is_held_for_seconds_not_cached_as_absent(store, monkeypatch):
    s, store_mod, PS = store
    product, bucket = _load(s, store_mod, monkeypatch, [_429(), _429(), _429()])
    assert product is None and bucket.calls == 3
    age_equiv = time.time() - PS._l2_negative_cache[FILE]            # how "old" the entry looks to the TTL check
    assert PS._L2_NEGATIVE_CACHE_TTL - age_equiv <= 5.5               # expires within ~5 s, not 60 s


def test_an_absent_file_keeps_the_full_negative_cache(store, monkeypatch):
    s, store_mod, PS = store
    product, bucket = _load(s, store_mod, monkeypatch, [_404()])
    assert product is None and bucket.calls == 1
    assert time.time() - PS._l2_negative_cache[FILE] < 2.0            # a fresh entry: the full 60 s


# ── the answer says so ────────────────────────────────────────────────────────────────────────────────────────────

class _Answer:
    def __init__(self, product_id, attr="fallbackReason"):
        self.product_id, self.warnings = product_id, []
        setattr(self, attr, None)


def test_an_answer_served_around_a_refused_read_is_labelled(store, monkeypatch):
    s, store_mod, PS = store

    @R.label_l2_read_failures
    async def resolve():
        _load(s, store_mod, monkeypatch, [_429(), _429(), _429()])                 # the regional tile is refused
        return _Answer("gfs_marine_waves_global_mid_20261002T030000Z.json")        # the resolver falls back
    out = asyncio.run(resolve())
    assert out.fallbackReason == "l2_read_refused"
    assert len(out.warnings) == 1 and FILE in out.warnings[0] and "HTTP 429" in out.warnings[0]


def test_no_refusal_no_label_and_a_point_answer_uses_its_own_field(store, monkeypatch):
    s, store_mod, PS = store

    @R.label_l2_read_failures
    async def clean():
        _load(s, store_mod, monkeypatch, [_product_bytes()])
        return _Answer(FILE)
    out = asyncio.run(clean())
    assert out.fallbackReason is None and out.warnings == []

    @R.label_l2_read_failures
    async def point():
        R.note_read_failure(FILE, _429())
        return _Answer("gfs_marine_waves_global_mid_20261002T030000Z.json", attr="fallback_reason")
    assert asyncio.run(point()).fallback_reason == "l2_read_refused"


def test_a_refusal_recorded_in_a_worker_thread_is_seen_and_calls_do_not_leak():
    @R.label_l2_read_failures
    async def threaded():
        await asyncio.to_thread(R.note_read_failure, FILE, _429())
        return _Answer("other.json")

    @R.label_l2_read_failures
    async def after():
        return _Answer("other.json")
    assert asyncio.run(threaded()).fallbackReason == "l2_read_refused"
    assert asyncio.run(after()).fallbackReason is None
    R.note_read_failure(FILE, _429())                                   # outside any labelled call: a no-op


def test_a_nested_labelled_call_does_not_swallow_the_outer_calls_refusal():
    """resolve_point can reach resolve_grid-shaped work: the inner call gets its own registry and, on exit, the outer
    call's registry is restored, so a refusal the outer call saw BEFORE the inner one still labels its answer."""
    @R.label_l2_read_failures
    async def inner():
        return _Answer("inner.json")

    @R.label_l2_read_failures
    async def outer():
        R.note_read_failure(FILE, _429())
        await inner()
        return _Answer("gfs_marine_waves_global_mid_20261002T030000Z.json")
    assert asyncio.run(outer()).fallbackReason == "l2_read_refused"


def test_the_served_product_is_never_labelled_with_its_own_refusal():
    @R.label_l2_read_failures
    async def same():
        R.note_read_failure(FILE, _429())
        return _Answer(FILE)                                            # a later retry served it after all
    assert asyncio.run(same()).fallbackReason is None


def test_both_production_resolvers_carry_the_label():
    from services.weather_pipeline.grid_resolver import resolve_grid
    from services.weather_pipeline.point_resolution import PointResolutionService
    assert getattr(resolve_grid, "__wrapped__", None) is not None
    assert getattr(PointResolutionService.resolve_point, "__wrapped__", None) is not None


# ── the label stays on the answer: never in the cached product (2026-10-02) ──────────────────────────────────────

MID = "gfs_marine_waves_global_mid_20261002T030000Z.json"


def test_the_label_never_writes_into_the_cached_products_warnings(store):
    """`load_product` copies a cached product ONE level, so the answer's `warnings` list is the L1 entry's own list.
    Until 2026-10-02 `_stamp` appended the refusal warning to it, and every later reader of that entry, with no
    refusal at all, was told "L2 read refused" (measured with the real ProductStore while reading commitment 182)."""
    from services.weather_pipeline.store_helpers import load_product_helper
    s, store_mod, PS = store
    (s.cache_dir / FILE).write_bytes(_product_bytes())
    served = load_product_helper(s, FILE)
    cached = PS._product_cache[FILE][0]
    assert served.warnings is cached.warnings, "fixture no longer shares the list; this test would prove nothing"

    @R.label_l2_read_failures
    async def resolve():
        R.note_read_failure("gfs_marine_waves_uk_ireland_20261002T060000Z.json", _429())   # another tile refused
        return served
    out = asyncio.run(resolve())

    assert out.fallbackReason == "l2_read_refused" and len(out.warnings) == 1 and "HTTP 429" in out.warnings[0]
    assert cached.warnings == [], f"the label landed in the cached product: {cached.warnings}"
    later = load_product_helper(s, FILE)
    assert later.warnings == [] and later.fallbackReason is None, "a later reader with no refusal was labelled"


def test_the_label_is_logged_so_the_logs_can_count_it(caplog):
    """Commitment 182 asked for a log count of labelled answers; W-23 wrote the label only into the response, so the
    logs could not confirm a single one. One INFO line per labelled answer, carrying the label's own name."""
    caplog.set_level(logging.INFO, logger=R.logger.name)

    @R.label_l2_read_failures
    async def resolve():
        R.note_read_failure(FILE, _429())
        return _Answer(MID)
    asyncio.run(resolve())

    @R.label_l2_read_failures
    async def clean():
        return _Answer(MID)
    asyncio.run(clean())

    lines = [r.getMessage() for r in caplog.records if "l2_read_refused" in r.getMessage()]
    assert len(lines) == 1, lines
    assert MID in lines[0] and FILE in lines[0] and "HTTP 429" in lines[0]

"""A8-04: validate public product hints and bound real L2 read coordination."""
import ast
import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import threading
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, Query
import httpx
import pytest

from services.weather_pipeline.product_read_bounds import PRODUCT_ID_PATTERN, download_slot, negative_hit
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.store_helpers import load_product_helper
from services.weather_pipeline.route_helpers import build_dynamic_cache_key
from tests.test_l2_read_refusal import FILE, _404, _product_bytes, _SB


def _point_boundary():
    # Execute the real route's argument declarations without importing app startup
    # or replacing their Query validation with a copied test schema.
    path = Path(__file__).parents[1] / "routes/weather.py"
    node = next(n for n in ast.parse(path.read_text(encoding="utf-8")).body
                if isinstance(n, ast.AsyncFunctionDef) and n.name == "get_point")
    node.decorator_list = []
    node.body = ast.parse("return {'product_id': grid_product_id}").body
    module = ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[]))
    scope = {"Query": Query, "Optional": Optional, "PRODUCT_ID_PATTERN": PRODUCT_ID_PATTERN}
    exec(compile(module, str(path), "exec"), scope)
    app = FastAPI()
    app.get("/point")(scope["get_point"])
    return app


_DYNAMIC_IDS = [build_dynamic_cache_key('GFS', 'marine', 'waves', datetime(2026, 10, 2, 3, tzinfo=timezone.utc), *bounds) + '.json'
                for bounds in [(-81, 27, -80, 29), (-180, -80, 180, 85), (170, -10, -170, 10)]]


@pytest.mark.parametrize("product_id", [FILE, "euro_marine_waves_global_coarse_20261015T090000Z_estimated.json", None, *_DYNAMIC_IDS])
def test_valid_public_product_hints_keep_their_identity(product_id):
    async def request():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_point_boundary()), base_url="http://local") as client:
            params = dict(model="GFS", domain="marine", layer="waves", lat=28, lng=-80, valid_time="2026-10-02T03:00:00Z")
            if product_id is not None:
                params["grid_product_id"] = product_id
            response = await client.get("/point", params=params)
            assert response.status_code == 200
            assert response.json()["product_id"] == product_id
    asyncio.run(request())


@pytest.mark.parametrize("product_id", ["../manifest.json", "folder/product.json", r"folder\product.json",
                                       "manifest.json", FILE + "\n", "a" * 1000 + ".json", FILE + ".tmp",
                                       FILE.replace('.json', '_1.00_2.00.json')])
def test_invalid_public_product_hints_are_rejected_before_the_handler(product_id):
    async def request():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_point_boundary()), base_url="http://local") as client:
            response = await client.get("/point", params=dict(model="GFS", domain="marine", layer="waves", lat=28,
                                       lng=-80, valid_time="2026-10-02T03:00:00Z", grid_product_id=product_id))
            assert response.status_code == 422
    asyncio.run(request())


@pytest.fixture
def bounded_store(monkeypatch, tmp_path):
    import services.weather_pipeline.store as store_mod
    monkeypatch.setattr(ProductStore, "_download_locks", {})
    monkeypatch.setattr(ProductStore, "_l2_negative_cache", {})
    monkeypatch.setattr(ProductStore, "_product_cache", {})
    monkeypatch.setattr(ProductStore, "_product_cache_vectors", {})
    monkeypatch.setattr(ProductStore, "_DOWNLOAD_LOCK_LIMIT", 32)
    monkeypatch.setattr(ProductStore, "_L2_NEGATIVE_CACHE_LIMIT", 64)
    store = object.__new__(ProductStore)
    store.cache_dir = tmp_path
    return store, store_mod


def test_real_load_path_bounds_a_thousand_distinct_misses(bounded_store, monkeypatch):
    store, module = bounded_store

    class Bucket:
        calls = 0

        def download(self, filename):
            self.calls += 1
            raise _404()
    bucket = Bucket()
    monkeypatch.setattr(module, "_get_supabase_storage", lambda: _SB(bucket))
    names = [f"gfs_marine_waves_region_{i}_20261002T030000Z.json" for i in range(1000)]
    for name in names:
        assert load_product_helper(store, name) is None
        assert len(ProductStore._download_locks) <= 32
        assert len(ProductStore._l2_negative_cache) <= 64
    assert bucket.calls == 1000
    assert load_product_helper(store, names[-1]) is None
    assert bucket.calls == 1000  # newest absence is cached
    assert load_product_helper(store, names[0]) is None
    assert bucket.calls == 1001  # oldest absence was evicted


def test_negative_cache_hits_are_lru_and_expired_entries_are_removed(bounded_store):
    now = time.time()
    ProductStore._l2_negative_cache.update(a=now, b=now - 61)
    assert negative_hit(ProductStore, "a", now)
    assert list(ProductStore._l2_negative_cache) == ["b", "a"]
    assert not negative_hit(ProductStore, "b", now)
    assert "b" not in ProductStore._l2_negative_cache


def test_pinned_read_owner_and_waiter_survive_lru_pressure(bounded_store, monkeypatch):
    store, module = bounded_store
    monkeypatch.setattr(ProductStore, "_DOWNLOAD_LOCK_LIMIT", 2)
    started, release = threading.Event(), threading.Event()

    class Bucket:
        calls = 0

        def download(self, filename):
            self.calls += 1
            started.set()
            assert release.wait(5)
            return _product_bytes()
    bucket = Bucket()
    monkeypatch.setattr(module, "_get_supabase_storage", lambda: _SB(bucket))
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(load_product_helper, store, FILE)
        try:
            assert started.wait(5)
            second = executor.submit(load_product_helper, store, FILE)
            deadline = time.monotonic() + 5
            while ProductStore._download_locks[FILE].users < 2 and time.monotonic() < deadline:
                time.sleep(.001)
            assert ProductStore._download_locks[FILE].users == 2
            with download_slot(ProductStore, "idle"):
                pass
            with download_slot(ProductStore, "new") as lock:
                assert lock is not None and FILE in ProductStore._download_locks
                with download_slot(ProductStore, "overflow") as refused:
                    assert refused is None
                assert len(ProductStore._download_locks) == 2
            assert bucket.calls == 1
        finally:
            release.set()
        assert first.result(timeout=5).product_id == FILE
        assert second.result(timeout=5).product_id == FILE
    assert bucket.calls == 1
    assert ProductStore._download_locks[FILE].users == 0


def test_capacity_refusal_keeps_the_read_failure_label(bounded_store, monkeypatch):
    from services.weather_pipeline import l2_retry
    store, module = bounded_store
    monkeypatch.setattr(ProductStore, "_DOWNLOAD_LOCK_LIMIT", 1)
    monkeypatch.setattr(module, "_get_supabase_storage", lambda: pytest.fail("no download at capacity"))

    @l2_retry.label_l2_read_failures
    async def resolve():
        assert load_product_helper(store, FILE) is None
        return type("Answer", (), {"product_id": "fallback", "fallbackReason": None, "warnings": []})()
    with download_slot(ProductStore, "busy"):
        answer = asyncio.run(resolve())
    assert answer.fallbackReason == "l2_read_refused"
    assert FILE not in ProductStore._l2_negative_cache

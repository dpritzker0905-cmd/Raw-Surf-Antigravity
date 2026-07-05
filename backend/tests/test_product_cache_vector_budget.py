"""
Vector-weighted product-cache budget (2026-07-05, Render OOM root).

The ProductStore in-memory cache capped COUNT at 128, sized when parsed products were <1MB
(regional ~117 vec, global-coarse ~629 vec). A global_mid product is ~15,000 vectors (~12MB
parsed): 128 of those ≈ 1.5-1.9GB — the exact resident plateau Render metrics showed (60s
resolution) before every one of the 29 `oomKilled {memoryLimit: 2Gi}` events on 2026-07-05
(zero OOMs 06-28→07-04; the storm began the day mid-tier serving went live). The cache must
also bound TOTAL VECTORS (PRODUCT_CACHE_VECTOR_BUDGET, default 120k ≈ the old-world budget)
so mid-era products displace instead of accumulate.
"""
import json
from datetime import datetime, timezone

import pytest

from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)
from services.weather_pipeline.store import ProductStore

_VT_DT = datetime(2026, 7, 5, 12, 0, 0, tzinfo=timezone.utc)


def _product(filename: str, nvec: int) -> NormalizedProduct:
    vecs = [GridVector(lat=0.0, lng=float(i % 360) - 180.0, speed=1.0, u=0.5, v=0.5) for i in range(nvec)]
    bounds = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
    grid = NormalizedGrid(bounds=bounds, cols=max(2, nvec), rows=1, vectors=vecs)
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=_VT_DT, valid_time=_VT_DT,
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800,
        product_id=filename,
    )


@pytest.fixture
def store(tmp_path):
    s = ProductStore(cache_dir=tmp_path)
    # Isolate the class-level cache and shrink the budget so the test is fast and deterministic.
    old_cache = dict(ProductStore._product_cache)
    old_vecs = dict(ProductStore._product_cache_vectors)
    old_budget = ProductStore._PRODUCT_CACHE_VECTOR_BUDGET
    old_limit = ProductStore._PRODUCT_CACHE_LIMIT
    ProductStore._product_cache.clear()
    ProductStore._product_cache_vectors.clear()
    ProductStore._PRODUCT_CACHE_VECTOR_BUDGET = 100
    ProductStore._PRODUCT_CACHE_LIMIT = 128
    yield s
    ProductStore._product_cache.clear()
    ProductStore._product_cache.update(old_cache)
    ProductStore._product_cache_vectors.clear()
    ProductStore._product_cache_vectors.update(old_vecs)
    ProductStore._PRODUCT_CACHE_VECTOR_BUDGET = old_budget
    ProductStore._PRODUCT_CACHE_LIMIT = old_limit


def _write_and_load(store, filename, nvec, tmp_path):
    p = _product(filename, nvec)
    (tmp_path / filename).write_text(p.model_dump_json())
    loaded = store.load_product(filename)
    assert loaded is not None and loaded.grid is not None
    return loaded


def test_vector_budget_evicts_lru_instead_of_accumulating(store, tmp_path):
    """Three 40-vector products fit a 100-vector budget only two at a time: the third load must
    evict the FIRST (LRU), keeping total resident vectors <= budget — the mid-era OOM guard."""
    for i in range(3):
        _write_and_load(store, f"p{i}.json", 40, tmp_path)
    total = sum(ProductStore._product_cache_vectors.values())
    assert total <= 100, f"resident vectors {total} exceed the budget"
    assert "p0.json" not in ProductStore._product_cache, "LRU entry must be evicted first"
    assert "p2.json" in ProductStore._product_cache, "newest entry must be resident"


def test_small_products_still_cache_up_to_count_limit(store, tmp_path):
    """Tiny products (the pre-mid world) behave as before: all resident, bounded by count."""
    for i in range(5):
        _write_and_load(store, f"s{i}.json", 10, tmp_path)
    assert len(ProductStore._product_cache) == 5
    assert sum(ProductStore._product_cache_vectors.values()) == 50


def test_oversized_single_product_still_serves_and_caches_alone(store, tmp_path):
    """A product bigger than the whole budget must still LOAD (serving beats caching) and may
    reside alone — the eviction loop stops at an empty cache rather than refusing the load."""
    _write_and_load(store, "small.json", 30, tmp_path)
    big = _write_and_load(store, "big.json", 150, tmp_path)
    assert len(big.grid.vectors) == 150
    assert "small.json" not in ProductStore._product_cache
    assert "big.json" in ProductStore._product_cache

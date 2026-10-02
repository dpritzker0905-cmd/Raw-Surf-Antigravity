"""One guard on the invariant itself: a product the ProductStore L1 cache holds is never changed by whoever
receives it.

WHY (2026-10-02). `store_helpers.load_product_helper` hands out ONE-LEVEL copies (`product.model_copy()` plus
`grid.model_copy()`), so `vectors`, `diagnostics`, `warnings` and every other nested object are the cache's own.
Four serve paths shipped writes into them anyway: the coarse gulf fill (#211, fix ea3aa78d), the mid-res tier's
diagnostics (#212, a0f88ef0), the resolver's step-4 stamps (#213, 7da3367b) and the W-23 label (#219, 67c7a588). The
hazard was known since 2026-08-08, when the surf overlay dropped a wasted deepcopy and pinned its own no-mutation
contract (tests/test_grid_surf_overlay_copies.py), and is still guarded only in prose in two more places
(grid_series_helper.py, series_vector_budget.py). Each fix added a guard keyed to ONE attribute
(`tests/test_grid_vector_shared_writes.py` for `.vectors`, `tests/test_grid_resolver_shared_diagnostics.py` for
diagnostics), and the next bug used another attribute.

This guard is keyed to no attribute: `tests/l1_product_guard.py` snapshots every cached product the moment a serve
path first receives it, and the autouse fixture in `conftest.py` fails any test after which one of them changed.
The tests below pin the guard itself: a positive control for each historical mutation shape, a null control for
read-only use and for each fix's rebind shape, and the cases a dict-keyed guard would miss (an entry a test inserted
directly, a test that swaps the cache dict, a strided key, a mutation after eviction).
"""
import time
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import store_helpers
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct
from services.weather_pipeline.store import ProductStore
from tests.l1_product_guard import L1ProductGuard

# Every test here mutates a cached product ON PURPOSE and asserts with its own guard, so the autouse guard stands down.
pytestmark = pytest.mark.l1_mutation_expected

_T = datetime(2026, 10, 2, 0, 0, tzinfo=timezone.utc)


def _product(name: str, nvec: int = 4) -> NormalizedProduct:
    bounds = CoverageBounds(west=-80.0, south=25.0, east=-79.0, north=26.0)
    vecs = [GridVector(lat=25.0 + i * 0.25, lng=-80.0, speed=1.0 + i, u=0.5, v=0.5) for i in range(nvec)]
    grid = NormalizedGrid(bounds=bounds, cols=nvec, rows=1, vectors=vecs, diagnostics={"tier": "regional"})
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves", run_time=_T, valid_time=_T,
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft", source_variables=[],
        freshness_sec=1800, product_id=name, warnings=["original"],
    )


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ProductStore, "_product_cache", {})
    monkeypatch.setattr(ProductStore, "_product_cache_vectors", {})
    return ProductStore(cache_dir=tmp_path)


@pytest.fixture
def guard(monkeypatch):
    g = L1ProductGuard()
    g.install(monkeypatch)
    return g


def _load(store, tmp_path, name="p.json", **kwargs):
    (tmp_path / name).write_text(_product(name).model_dump_json())
    out = store.load_product(name, **kwargs)
    assert out is not None and out.grid is not None
    return out


# ── null controls ──────────────────────────────────────────────────────────────────────────────────────────────


def test_read_only_use_and_a_cache_hit_report_nothing(store, guard, tmp_path):
    first = _load(store, tmp_path)
    assert [v.speed for v in first.grid.vectors] == [1.0, 2.0, 3.0, 4.0]
    second = store.load_product("p.json")          # an L1 hit hands out another one-level copy
    assert second is not first and second.grid.vectors[0] is first.grid.vectors[0]   # the sharing this guards
    assert guard.changes() == []


def test_each_fix_shape_rebinds_and_is_clean(store, guard, tmp_path):
    p = _load(store, tmp_path)
    p.warnings = [*p.warnings, "l2_read_refused"]                 # #219's fix: a new list, never an append
    p.grid.diagnostics = {**p.grid.diagnostics, "served": "x"}    # #212/#213's fix: copy the dict before stamping
    p.grid.vectors = [v.model_copy() for v in p.grid.vectors]     # #211's fix: own the vectors before writing
    p.grid.vectors[0].speed = 9.0
    p.region_id = "elsewhere"                                     # a top-level field of the copy is the copy's own
    assert guard.changes() == []


# ── positive controls: each historical mutation shape ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("mutate, path", [
    (lambda p: setattr(p.grid.vectors[0], "speed", 9.0), "grid.vectors[0].speed"),            # #211 gulf fill
    (lambda p: p.grid.diagnostics.__setitem__("served_valid_time", "x"), "grid.diagnostics"),   # #212, #213, overlay
    (lambda p: p.warnings.append("l2_read_refused"), "warnings"),                             # #219 W-23 label
    (lambda p: p.grid.vectors.append(GridVector(lat=0.0, lng=0.0, speed=0.0, u=0.0, v=0.0)), "grid.vectors"),
    (lambda p: p.grid.vectors.__delitem__(0), "grid.vectors"),
], ids=["vector-attribute", "diagnostics-key", "warnings-append", "vectors-grow", "vectors-shrink"])
def test_each_historical_mutation_shape_is_caught(store, guard, tmp_path, mutate, path):
    p = _load(store, tmp_path)
    mutate(p)
    changes = guard.changes()
    assert len(changes) == 1, changes
    assert changes[0].startswith("p.json: ") and path in changes[0], changes


def test_the_report_names_the_path_and_both_values(store, guard, tmp_path):
    p = _load(store, tmp_path)
    p.grid.vectors[2].speed = 9.5
    assert guard.changes() == ["p.json: grid.vectors[2].speed 3.0 -> 9.5"]


def test_assert_unchanged_raises_with_the_report(store, guard, tmp_path):
    p = _load(store, tmp_path)
    p.warnings.append("stale label")
    with pytest.raises(AssertionError, match=r"p\.json: warnings"):
        guard.assert_unchanged()


# ── the cases a guard keyed to the cache dict would miss ──────────────────────────────────────────────────────


def test_an_entry_a_test_inserted_directly_is_snapshotted_at_its_first_hit(store, guard):
    ProductStore._product_cache["direct.json"] = (_product("direct.json"), time.time())
    p = store.load_product("direct.json")
    p.grid.diagnostics["stamped"] = True
    assert len(guard.changes()) == 1 and guard.changes()[0].startswith("direct.json: grid.diagnostics")


def test_a_test_that_swaps_the_cache_dict_is_still_seen(store, guard, tmp_path, monkeypatch):
    monkeypatch.setattr(ProductStore, "_product_cache", {})       # what tests/test_l2_read_refusal.py does
    p = _load(store, tmp_path)
    p.warnings.append("l2_read_refused")
    assert len(guard.changes()) == 1


def test_a_strided_entry_is_reported_under_its_own_key(store, guard, tmp_path, monkeypatch):
    monkeypatch.setenv("SERIES_LOAD_STRIDE", "1")
    p = _load(store, tmp_path, stride=2)
    p.grid.vectors[0].speed = 7.0
    changes = guard.changes()
    assert len(changes) == 1 and changes[0].startswith("p.json#s2: "), changes


def test_a_mutation_after_eviction_is_still_caught(store, guard, tmp_path):
    p = _load(store, tmp_path)
    ProductStore._product_cache.clear()        # evicted, but every copy handed out while cached shares its vectors
    p.grid.vectors[0].speed = 8.0
    assert len(guard.changes()) == 1


def test_the_autouse_guard_is_installed_for_every_test():
    assert getattr(store_helpers.load_product_helper, "__l1_guard__", False) is True

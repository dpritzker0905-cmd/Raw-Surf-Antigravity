"""
Root A (2026-07-15): the Step-1&2 dynamic-cache resolution-adequacy guard.

Curl-proven live: fresh coastal requests serve 0.235°/cell for all models, but a STALE COARSE
dynamic-viewport product (e.g. an ICON 0.44°/cell tile cached mid-pan) was served OVER the available
0.25° precomputed regional tile — the dynamic-cache lane (Step 1&2) short-circuits the regional
(Step 3). That coarse tile is the "ICON wave-direction wrong / faint when the rating band is on".

The guard drops the dynamic hit ONLY when a covering, meaningfully-finer regional manifest item is
present, so Step 3 serves THAT fine regional — the fallthrough is guaranteed finer (unlike the
reverted §0n gate, which fell to global_mid). Kill: MARINE_DYNCACHE_PREFER_FINE_REGIONAL=0.
"""
import asyncio
import types
from datetime import datetime, timezone

from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)
from services.weather_pipeline import grid_resolver

_VT = "2026-07-15T12:00:00Z"
_VT_DT = datetime(2026, 7, 15, 12, 0, 0, tzinfo=timezone.utc)

# Florida flagship tile extent (matches REGIONAL_CONFIGS["florida_east_coast"]).
_FL = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)


def _coarse_dynamic_product():
    """A STALE 0.44°/cell dynamic-viewport tile (9×9 over a 4° box) — the thing cached mid-pan."""
    vecs = [GridVector(lat=27.0, lng=-82.0, speed=1.0, u=0.5, v=0.5)]
    bounds = CoverageBounds(west=-84.0, south=26.0, east=-80.0, north=30.0)  # 4° span
    grid = NormalizedGrid(bounds=bounds, cols=9, rows=9, vectors=vecs)       # 4/9 = 0.44°/cell
    return NormalizedProduct(
        model="ICON", provider="dwd", domain="marine", layer="waves",
        run_time=_VT_DT, valid_time=_VT_DT,
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800,
        product_id="viewport_icon_marine_waves_-84_26_-80_30.json",
    )


def _fine_regional_product():
    """The 0.25° precomputed ICON florida tile the resolver SHOULD prefer."""
    vecs = [GridVector(lat=27.0, lng=-82.0, speed=1.0, u=0.5, v=0.5)]
    grid = NormalizedGrid(bounds=_FL, cols=24, rows=28, vectors=vecs)        # 6/24 = 0.25°/cell
    return NormalizedProduct(
        model="ICON", provider="dwd", domain="marine", layer="waves",
        run_time=_VT_DT, valid_time=_VT_DT,
        is_forecast_authoritative=True, is_estimated=False, coverage=_FL, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800,
        product_id="icon_marine_waves_florida_east_coast.json",
    )


def _florida_manifest_item():
    return types.SimpleNamespace(
        model="ICON", domain="marine", layer="waves",
        valid_time_start=_VT_DT, is_estimated=False,
        coverage=_FL, resolution=0.25,
        filename="icon_marine_waves_florida_east_coast.json",
        region_id="florida_east_coast", coverage_mode="regional_tile",
    )


class _FakeStore:
    def __init__(self, items, product, load_returns=None):
        self._items = items
        self._product = product
        self._load_returns = load_returns  # override load_product result (None = missing file)
        self.loaded = []

    def get_manifest(self):
        return types.SimpleNamespace(products=self._items)

    def load_product(self, filename):
        self.loaded.append(filename)
        return self._load_returns if self._load_returns is not None else self._product


class _FakeViewport:
    def __init__(self, dynamic):
        self.ACTIVE_REVALIDATIONS = set()
        self._dynamic = dynamic

    def is_viewport_enabled(self, *a, **k):
        return True

    async def get_cached_dynamic_product(self, **k):
        return self._dynamic

    async def _find_any_cached_product(self, *a, **k):
        return None

    async def _revalidate_fetch(self, *a, **k):
        pass

    async def fetch_viewport_grid_upstream(self, **k):
        return None


def _resolve(store, vp, monkeypatch, bbox):
    import services.weather_pipeline.store as store_mod
    monkeypatch.setattr(store_mod, "is_test_environment", lambda: False)
    return asyncio.run(grid_resolver.resolve_grid(
        store, vp, model="ICON", domain="marine", layer="waves",
        valid_time=_VT, bbox=bbox,
    ))


# A 2° viewport fully inside the florida tile — the case the stale coarse tile overlapped.
_BBOX_INSIDE = "-83,27,-81,29"


def test_coarse_dynamic_yields_to_finer_covering_regional(monkeypatch):
    store = _FakeStore([_florida_manifest_item()], _fine_regional_product())
    vp = _FakeViewport(_coarse_dynamic_product())
    out = _resolve(store, vp, monkeypatch, bbox=_BBOX_INSIDE)

    assert out is not None
    # The FINE regional was served, not the coarse dynamic viewport tile.
    assert "florida_east_coast" in (out.product_id or ""), \
        f"expected the fine regional, got {out.product_id}"
    assert "viewport_icon" not in (out.product_id or "")


def test_kill_switch_keeps_the_dynamic_cache(monkeypatch):
    monkeypatch.setenv("MARINE_DYNCACHE_PREFER_FINE_REGIONAL", "0")
    store = _FakeStore([_florida_manifest_item()], _fine_regional_product())
    vp = _FakeViewport(_coarse_dynamic_product())
    out = _resolve(store, vp, monkeypatch, bbox=_BBOX_INSIDE)

    assert out is not None
    assert out.product_id == "viewport_icon_marine_waves_-84_26_-80_30.json", \
        "kill switch must preserve the legacy dynamic-cache-first behavior"


def test_fine_dynamic_cache_is_not_dropped(monkeypatch):
    """A dynamic tile that is ALREADY as fine as the regional must be kept — no needless churn."""
    fine_dyn = _coarse_dynamic_product()
    fine_dyn.grid.cols = 17            # 4/17 = 0.235° ≈ the regional's 0.25° (not meaningfully coarser)
    fine_dyn.product_id = "viewport_icon_marine_waves_fine.json"
    store = _FakeStore([_florida_manifest_item()], _fine_regional_product())
    vp = _FakeViewport(fine_dyn)
    out = _resolve(store, vp, monkeypatch, bbox=_BBOX_INSIDE)

    assert out is not None
    assert out.product_id == "viewport_icon_marine_waves_fine.json", \
        "a fine dynamic tile must not be swapped for the regional"


def test_dropped_dynamic_is_restored_when_regional_unavailable(monkeypatch):
    """Safety net: if the deferred fine regional can't load, restore the dynamic — never serve blank."""
    store = _FakeStore([_florida_manifest_item()], None, load_returns=False)  # regional file 'missing'
    vp = _FakeViewport(_coarse_dynamic_product())
    out = _resolve(store, vp, monkeypatch, bbox=_BBOX_INSIDE)

    assert out is not None, "must not serve blank when the regional is unavailable"
    assert out.product_id == "viewport_icon_marine_waves_-84_26_-80_30.json", \
        "the set-aside dynamic tile must be restored"

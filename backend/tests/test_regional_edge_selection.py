"""WP-2: real resolver selection and native cells across a regional tile edge."""
import asyncio
import copy
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from services.weather_pipeline import grid_resolver, mid_res_tier
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

VT = datetime(2026, 9, 20, 18, tzinfo=timezone.utc)
FL = CoverageBounds(west=-85, south=24, east=-79, north=31)
WORLD = CoverageBounds(west=-180, south=-80, east=180, north=85)


def item(region, coverage, resolution, **kwargs):
    return SimpleNamespace(model="GFS", domain="marine", layer="waves", valid_time_start=VT,
                           is_estimated=False, coverage=coverage, resolution=resolution,
                           filename=region + ".json", region_id=region,
                           coverage_mode="regional_tile" if region == "florida" else "global_tile",
                           **kwargs)


def product(region, coverage, resolution):
    # A real rectangular lattice, unlike one-vector mocks which cannot expose clipping errors.
    west, east, south, north = (-85, -75, 23, 33) if coverage is WORLD else (-85, -79, 24, 31)
    lons = [west + i * resolution for i in range(round((east - west) / resolution) + 1)]
    lats = [south + i * resolution for i in range(round((north - south) / resolution) + 1)]
    vectors = [GridVector(lat=lat, lng=lon, speed=1.5, u=0.9, v=1.2, is_valid=True)
               for lat in lats for lon in lons]
    return NormalizedProduct(model="GFS", domain="marine", layer="waves", provider="fixture",
                             upstream_model="ncep_gfswave025", run_time=VT, valid_time=VT,
                             coverage=coverage, resolution=resolution, product_id=region + ".json",
                             grid=NormalizedGrid(bounds=coverage, cols=len(lons), rows=len(lats), vectors=vectors),
                             value_kind="wave_height", value_unit="m", display_unit_hint="ft",
                             source_variables=[], freshness_sec=1800,
                             is_forecast_authoritative=True, is_estimated=False)


class Store:
    def __init__(self):
        self.items = [item("global_coarse", WORLD, 10), item("florida", FL, 0.25),
                      item("global_mid", WORLD, 2)]
        self.products = {p.region_id + ".json": product(p.region_id, p.coverage, p.resolution)
                         for p in self.items}
        self.loaded = []

    def get_manifest(self):
        return SimpleNamespace(products=self.items)

    def load_product(self, filename, **kwargs):
        self.loaded.append(filename)
        return copy.deepcopy(self.products.get(filename))


class Viewport:
    def __init__(self, enabled=True, cached=None):
        self.ACTIVE_REVALIDATIONS = set()
        self.enabled, self.cached = enabled, cached

    def is_viewport_enabled(self, *args, **kwargs):
        return self.enabled

    async def get_cached_dynamic_product(self, **kwargs):
        return self.cached

    async def _find_any_cached_product(self, *args, **kwargs):
        return None

    async def _revalidate_fetch(self, *args, **kwargs):
        raise AssertionError("Background work must be queued, not run by a request")


class Tasks:
    def __init__(self):
        self.tasks = []

    def add_task(self, function, *args):
        self.tasks.append((function, args))


def resolve(monkeypatch, bbox, store=None, viewport=None, tasks=None, **kwargs):
    from services.weather_pipeline import store as store_module
    monkeypatch.setattr(store_module, "is_test_environment", lambda: False)
    if hasattr(mid_res_tier, "_CLIP_CACHE"):
        mid_res_tier._CLIP_CACHE.clear()
    return asyncio.run(grid_resolver.resolve_grid(
        store or Store(), viewport or Viewport(), model="GFS", domain="marine", layer="waves",
        valid_time="2026-09-20T18:00:00Z", bbox=bbox, background_tasks=tasks or Tasks(), **kwargs))


@pytest.mark.parametrize("east", [-79.01, -79.0001, -79, -78.9999, -78.97, -78.8, -78.5, -78.11201])
def test_fixed_span_crosses_edge_without_resolution_collapse(monkeypatch, east):
    bbox = f"{east - 2.96},26.5,{east},29.2"
    result = resolve(monkeypatch, bbox)
    assert result.product_id == "florida.json"
    lons = sorted({v.lng for v in result.grid.vectors})
    assert all(b - a == pytest.approx(0.25) for a, b in zip(lons, lons[1:]))
    assert result.resolution == 0.25
    assert result.partial_coverage is (east > -79)
    assert result.coverage_scope == ("regional_partial" if east > -79 else "regional")
    assert result.grid.diagnostics["partial_coverage"] is result.partial_coverage
    assert result.requested_bbox_original == bbox
    assert result.grid.bounds.east <= -79
    assert float(result.served_bbox.split(",")[2]) == result.grid.bounds.east
    assert all(v.is_valid and v.speed == 1.5 for v in result.grid.vectors)


def test_sebastian_audit_longitudes_queue_full_viewport_revalidation(monkeypatch):
    # Audit gives longitudes only; controlled latitude is deliberately stated, not invented UI evidence.
    bbox = "-81.93,26.5,-78.97,29.2"
    tasks, viewport = Tasks(), Viewport()
    result = resolve(monkeypatch, bbox, viewport=viewport, tasks=tasks)
    assert result.product_id == "florida.json"
    assert result.partial_coverage is True
    assert result.stale is True
    assert len(tasks.tasks) == 1
    assert bbox in tasks.tasks[0][1], "Revalidation must fetch original viewport, not clamped tile"
    again = resolve(monkeypatch, bbox, viewport=viewport, tasks=tasks)
    assert again.product_id == "florida.json"
    assert len(tasks.tasks) == 1, "Repeated requests cannot enqueue duplicate upstream fetches"


@pytest.mark.parametrize("bbox", [
    "-81.93315429687473,26.761836762966084,-78.96684570312489,28.947149606276398",
    "-82.4332,26.2618,-78.4668,29.4471",
], ids=["actual-z8-viewport", "actual-padded-grid-series-request"])
def test_browser_captured_sebastian_bbox_keeps_native_partial_grid(monkeypatch, bbox):
    # Root browser capture 2026-09-20 20:31:49Z, 1280x900 viewport; request padding is 0.5deg.
    tasks = Tasks()
    result = resolve(monkeypatch, bbox, tasks=tasks)
    assert result.product_id == "florida.json"
    assert result.resolution == 0.25
    assert result.partial_coverage is True
    assert result.coverage_scope == "regional_partial"
    assert result.grid.bounds.east <= -79
    assert result.requested_bbox_original == bbox
    assert len(tasks.tasks) == 1
    assert bbox in tasks.tasks[0][1]


@pytest.mark.parametrize("east", [-78.11199, -78.1119, -77, -70])
def test_less_than_seventy_percent_keeps_covering_mid(monkeypatch, east):
    result = resolve(monkeypatch, f"{east - 2.96},26.5,{east},29.2")
    assert result.product_id == "global_mid.json"
    assert result.partial_coverage is False


def test_missing_fine_product_retains_coarse_fallback(monkeypatch):
    store = Store()
    store.products["florida.json"] = None
    result = resolve(monkeypatch, "-81.93,26.5,-78.97,29.2", store=store)
    assert result.product_id == "global_mid.json"


def test_covering_dynamic_cache_still_wins(monkeypatch):
    cached = product("viewport", WORLD, 0.25)
    cached.grid.bounds = CoverageBounds(west=-85, south=23, east=-75, north=33)
    result = resolve(monkeypatch, "-81.93,26.5,-78.97,29.2", viewport=Viewport(cached=cached))
    assert result.product_id == "viewport.json"


def test_disabled_dynamic_does_not_claim_pending_revalidation(monkeypatch):
    tasks = Tasks()
    result = resolve(monkeypatch, "-81.93,26.5,-78.97,29.2", viewport=Viewport(enabled=False), tasks=tasks)
    assert result.product_id == "florida.json"
    assert result.partial_coverage is True
    assert not result.stale
    assert tasks.tasks == []


def test_revalidation_queue_cap_preserved(monkeypatch):
    viewport, tasks = Viewport(), Tasks()
    viewport.ACTIVE_REVALIDATIONS.update({"existing-1", "existing-2"})
    result = resolve(monkeypatch, "-81.93,26.5,-78.97,29.2", viewport=viewport, tasks=tasks)
    assert result.product_id == "florida.json"
    assert result.partial_coverage is True
    assert tasks.tasks == []


def test_existing_overlap_kill_switch_preserved(monkeypatch):
    monkeypatch.setenv("MARINE_REGIONAL_OVERLAP_REUSE", "0")
    assert resolve(monkeypatch, "-81.93,26.5,-78.97,29.2").product_id == "global_mid.json"


@pytest.mark.parametrize("change", ["older", "coarser", "coarser_than_mid", "nan_resolution", "missing_resolution"])
def test_regional_must_be_finer_same_frame_and_known_resolution(monkeypatch, change):
    from datetime import timedelta
    store = Store()
    regional = store.items[1]
    if change == "older":
        regional.valid_time_start -= timedelta(hours=3)
    else:
        regional.resolution = {"coarser": 20, "coarser_than_mid": 4, "nan_resolution": float("nan"), "missing_resolution": None}[change]
    result = resolve(monkeypatch, "-81.93,26.5,-78.97,29.2", store=store)
    assert result.product_id == "global_mid.json"


def test_manifest_order_does_not_change_partial_selection(monkeypatch):
    store = Store()
    store.items.reverse()
    assert resolve(monkeypatch, "-81.93,26.5,-78.97,29.2", store=store).product_id == "florida.json"


def test_revalidation_span_cap_preserved(monkeypatch):
    monkeypatch.setenv("MARINE_MID_REVAL_MAX_SPAN", "2")
    tasks = Tasks()
    result = resolve(monkeypatch, "-81.93,26.5,-78.97,29.2", tasks=tasks)
    assert result.partial_coverage is True
    assert not result.stale
    assert not tasks.tasks


def test_northern_edge_shortfall_is_not_hidden_by_longitude_coverage(monkeypatch):
    result = resolve(monkeypatch, "-82,29.1,-80,31.1")
    assert result.product_id == "florida.json"
    assert result.partial_coverage is True
    assert result.grid.bounds.north == 31


@pytest.mark.parametrize("domain,bbox", [("wind", (-81.93, 26.5, -78.97, 29.2)),
                                         ("marine", (None, None, None, None)),
                                         ("marine", (-80, 26, -80, 27))])
def test_preference_leaves_other_requests_unchanged(domain, bbox):
    from services.weather_pipeline.grid_resolver_selection import prefer_overlapping_marine_region
    store = Store()
    selected = store.items[0]
    assert prefer_overlapping_marine_region(selected, [(p, 0) for p in store.items], [], domain, *bbox) is selected


def test_partial_revalidation_can_schedule_without_background_tasks(monkeypatch):
    from services.weather_pipeline import store as store_module
    monkeypatch.setattr(store_module, "is_test_environment", lambda: False)
    calls = []
    viewport = Viewport()

    async def revalidate(*args):
        calls.append(args)

    viewport._revalidate_fetch = revalidate

    async def run():
        result = await grid_resolver.resolve_grid(
            Store(), viewport, model="GFS", domain="marine", layer="waves",
            valid_time="2026-09-20T18:00:00Z", bbox="-81.93,26.5,-78.97,29.2")
        await asyncio.sleep(0)
        return result

    assert asyncio.run(run()).partial_coverage is True
    assert len(calls) == 1
    assert "-81.93,26.5,-78.97,29.2" in calls[0]

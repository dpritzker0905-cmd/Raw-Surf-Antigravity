"""The 30-minute stale-cache refresh takes its slot through the sharpen queue (2026-10-09).

viewport_helper.get_cached_dynamic_product_helper serves a dynamic-viewport product older than 30 minutes
as `stale_cache_hit` and refreshes it in the background (viewport_service._revalidate_fetch). That refresh
started with a bare `asyncio.create_task`: one per stale hour, counted against nothing.

Render log, srv-d7fhiu7lk1mc73debje0, 2026-10-09 01:10:06-01:10:12Z: 46 "SWR background revalidation
triggered" lines, one per stale hour of a GFS wind grid_series page at box -95,19,-84,29.
MARINE_REVAL_CONCURRENCY=1 serialized them (all done by 01:11:27Z), but each was an upstream fetch on the
shared 1-CPU prod+dev box, and MARINE_REVAL_QUEUE_MAX never saw them.

Pinned here, end to end through build_grid_series -> resolve_grid -> the real get_cached_dynamic_product:
1. A stale 48-frame series page starts at most one refresh: its warm frame's, never the viewed hour's slot.
2. The viewed hour (/grid) still gets its refresh, and /grid callers are capped by MARINE_REVAL_QUEUE_MAX.
3. A stale hit that starts no refresh does not claim one is pending.
"""
import asyncio
import functools
import types
from datetime import datetime, timedelta, timezone

from starlette.background import BackgroundTasks

from services.weather_pipeline import grid_resolver
from services.weather_pipeline.grid_series_helper import build_grid_series
from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct,
)
from services.weather_pipeline.viewport_service import ViewportService

SERIES_BBOX = "-95,19,-84,29"                          # the live page's box
PAGE = ",".join(str(h) for h in range(0, 142, 3))      # a 48-frame windGridSeries page
QUEUE_MAX = 2                                          # MARINE_REVAL_QUEUE_MAX default
PENDING = "swr_revalidation_pending"


def _wind_product(valid_dt, product_id):
    bounds = CoverageBounds(west=-95.0, south=19.0, east=-84.0, north=29.0)
    vectors = [GridVector(lat=19.0 + 0.5 * r, lng=-95.0 + 0.5 * c, speed=8.0, direction=90.0, u=-8.0, v=0.0)
               for r in range(21) for c in range(23)]
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="wind", layer="wind",
        run_time=valid_dt, valid_time=valid_dt, is_forecast_authoritative=True,
        is_estimated=False, coverage=bounds,
        grid=NormalizedGrid(bounds=bounds, cols=23, rows=21, vectors=vectors),
        value_kind="wind", value_unit="kn", display_unit_hint="kn",
        product_id=product_id, source_variables=["wind_speed_10m"], freshness_sec=3600,
        is_dynamic_viewport_product=True,
    )


class _DynamicIndex:
    """Every hour has a cached viewport product, created `age_min` minutes ago."""

    def __init__(self, age_min):
        self.age_min = age_min

    def find_product(self, *, model, domain, layer, valid_time, cache_key):
        created = datetime.now(timezone.utc) - timedelta(minutes=self.age_min)
        return {"product_id": f"dyn_{valid_time:%Y%m%dT%H%M%SZ}.json", "created_at": created.isoformat(),
                "resolution": 0.5, "coverage_scope": "viewport"}


class _DynamicStore:
    def load_product(self, product_id):
        vt = datetime.strptime(product_id[4:-5], "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        return _wind_product(vt, product_id)


class _ViewportService:
    """The real cache lookup (ViewportService.get_cached_dynamic_product -> viewport_helper) over a fake
    index and store, with the real queue contract: a key leaves ACTIVE_REVALIDATIONS only when its
    _revalidate_fetch finishes. Refreshes stay in flight until release, so every start is counted."""
    get_cached_dynamic_product = ViewportService.get_cached_dynamic_product

    def __init__(self, age_min=40):
        self.ACTIVE_REVALIDATIONS = set()
        self.dynamic_index = _DynamicIndex(age_min)
        self.store = _DynamicStore()
        self.started = []
        self.finished = []
        self._release = asyncio.Event()

    def is_viewport_enabled(self, *a, **k):
        return True

    async def _find_any_cached_product(self, *a, **k):
        return None

    async def fetch_viewport_grid_upstream(self, **k):
        raise AssertionError("a cached viewport product must answer without an upstream fetch")

    async def _revalidate_fetch(self, model, domain, layer, valid_time_str, target_dt, bbox_str, reval_key):
        self.started.append(reval_key)
        try:
            await self._release.wait()
        finally:
            self.ACTIVE_REVALIDATIONS.discard(reval_key)
            self.finished.append(reval_key)


class _Harness:
    def __init__(self, age_min=40):
        self.base = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        self.vs = _ViewportService(age_min)
        store = types.SimpleNamespace(get_manifest=lambda: types.SimpleNamespace(products=[]))
        self.resolver = functools.partial(grid_resolver.resolve_grid, store, self.vs)

    def hour_key_part(self, hours):
        return (self.base + timedelta(hours=hours)).strftime("%Y%m%dT%H%M%SZ")

    async def series(self, hours):
        page = await build_grid_series(
            self.resolver, self.vs, "GFS", "wind", "wind", SERIES_BBOX, hours,
            base_time=self.base.strftime("%Y-%m-%dT%H:%M:%S.000Z"))
        await self.settle()
        return page

    async def grid(self, hours, background_tasks):
        vt = (self.base + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        product = await self.resolver(model="GFS", domain="wind", layer="wind", valid_time=vt,
                                      bbox=SERIES_BBOX, background_tasks=background_tasks)
        await self.settle()
        return product

    async def lookup(self, hours):
        """The cache lookup alone, as a caller without a request (no background_tasks) makes it."""
        product = await self.vs.get_cached_dynamic_product(
            model="GFS", domain="wind", layer="wind",
            target_dt=self.base + timedelta(hours=hours), bbox_str=SERIES_BBOX)
        await self.settle()
        return product

    @staticmethod
    async def settle():
        for _ in range(5):                    # let every created task reach its first await
            await asyncio.sleep(0)

    async def release_and_drain(self):
        self.vs._release.set()
        for _ in range(200):
            if len(self.vs.finished) == len(self.vs.started):
                return
            await asyncio.sleep(0.01)
        raise AssertionError(f"refreshes never finished: {self.vs.started} vs {self.vs.finished}")


async def test_a_stale_series_page_starts_only_its_warm_frames_refresh(monkeypatch):
    """The 01:10Z replay: 48 stale frames used to start 48 upstream refreshes. Only the page's warm frame
    (its first hour) may refresh, inside the slots above the viewed hour's reserve."""
    monkeypatch.delenv("MARINE_REVAL_QUEUE_MAX", raising=False)
    h = _Harness()
    page = await h.series(PAGE)
    assert page["frame_count"] == 48
    try:
        assert len(h.vs.started) <= QUEUE_MAX, f"{len(h.vs.started)} refreshes started by one series page"
        assert len(h.vs.started) == 1 and h.hour_key_part(0) in h.vs.started[0], h.vs.started
        assert h.vs.ACTIVE_REVALIDATIONS == set(h.vs.started)
    finally:
        await h.release_and_drain()
    assert h.vs.ACTIVE_REVALIDATIONS == set(), "every key belongs to a refresh that ran"


async def test_the_viewed_hour_still_gets_its_stale_refresh(monkeypatch):
    """After the page, the user views +3 h (a frame the page did not refresh). /grid takes the slot the
    reserve kept, and the refresh runs once the response is sent."""
    monkeypatch.delenv("MARINE_REVAL_QUEUE_MAX", raising=False)
    h = _Harness()
    await h.series(PAGE)
    bg = BackgroundTasks()
    viewed = await h.grid(3, bg)
    assert viewed.cache_hit == "stale_cache_hit"
    assert viewed.staleReason == PENDING, f"turned away; the queue held {sorted(h.vs.ACTIVE_REVALIDATIONS)}"
    run = asyncio.ensure_future(bg())                 # FastAPI runs it after the response
    await h.settle()
    assert any(h.hour_key_part(3) in k for k in h.vs.started), h.vs.started
    await h.release_and_drain()
    await run


async def test_requestless_stale_hits_are_capped_by_the_queue(monkeypatch):
    """A stale hit with no request to defer to starts its refresh now, but only while the queue has
    room: 48 such lookups start MARINE_REVAL_QUEUE_MAX refreshes, not 48."""
    monkeypatch.delenv("MARINE_REVAL_QUEUE_MAX", raising=False)
    h = _Harness()
    for hours in range(0, 142, 3):
        await h.lookup(hours)
    try:
        assert len(h.vs.started) == QUEUE_MAX, f"{len(h.vs.started)} uncapped refreshes"
    finally:
        await h.release_and_drain()


async def test_a_stale_hit_that_starts_no_refresh_does_not_claim_one(monkeypatch):
    """`swr_revalidation_pending` tells the client a fresher grid is coming (the wind cache refetches in
    15 s instead of 2 min). A /grid the full queue turned away is still stale but must not say so.
    (Series frames carry no stale label; only /grid answers do.)"""
    monkeypatch.delenv("MARINE_REVAL_QUEUE_MAX", raising=False)
    h = _Harness()
    for hours in (6, 9):                                           # two viewed hours fill the queue
        assert (await h.grid(hours, None)).staleReason == PENDING
    assert len(h.vs.ACTIVE_REVALIDATIONS) == QUEUE_MAX
    bg = BackgroundTasks()
    turned_away = await h.grid(12, bg)
    assert bg.tasks == [] and len(h.vs.ACTIVE_REVALIDATIONS) == QUEUE_MAX
    assert turned_away.stale is True and turned_away.cache_hit == "stale_cache_hit"
    assert turned_away.staleReason != PENDING
    assert turned_away.grid.diagnostics["staleReason"] == turned_away.staleReason

    again = await h.grid(9, BackgroundTasks())                     # in flight: still pending, full queue
    assert again.staleReason == PENDING
    await h.release_and_drain()


async def test_positive_control_with_the_cap_lifted_every_stale_hour_refreshes(monkeypatch):
    """The harness sees every refresh the stale branch starts: lift the cap and 48 requestless stale
    lookups start 48. So the bounds above are the queue's doing, not a branch that never fired."""
    monkeypatch.setenv("MARINE_REVAL_QUEUE_MAX", "1000")
    h = _Harness()
    for hours in range(0, 142, 3):
        await h.lookup(hours)
    try:
        assert len(h.vs.started) == 48
    finally:
        await h.release_and_drain()


async def test_negative_control_a_fresh_page_refreshes_nothing(monkeypatch):
    """Under 30 minutes old the cache is served as is: no refresh, no stale label."""
    monkeypatch.delenv("MARINE_REVAL_QUEUE_MAX", raising=False)
    h = _Harness(age_min=10)
    page = await h.series(PAGE)
    assert page["frame_count"] == 48
    viewed = await h.grid(3, BackgroundTasks())
    assert h.vs.started == [] and h.vs.ACTIVE_REVALIDATIONS == set()
    assert viewed.cache_hit == "cache_hit" and viewed.stale is False and viewed.staleReason is None

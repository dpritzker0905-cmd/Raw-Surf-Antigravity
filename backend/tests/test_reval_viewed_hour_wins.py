"""The hour the user is viewing wins the sharpen queue over timeline-prefetch frames (2026-10-09).

The sharpen: the mid tier (mid_res_tier.try_serve_mid_res_tier) serves the instant 2-degree global_mid
clip and schedules a background fine-viewport revalidation (viewport_service._revalidate_fetch). Its key
sits in ACTIVE_REVALIDATIONS until that coroutine's `finally` discards it, and MARINE_REVAL_QUEUE_MAX
(default 2) caps the outstanding keys so the 1-CPU box cannot OOM.

Render log, srv-d7fhiu7lk1mc73debje0, 2026-10-09 (after #271):
  00:38:42Z  two hour-0/1 sharpens scheduled for Gulf boxes; both log "revalidation succeeded" by 00:38:47Z.
  00:38:45Z, 00:38:48Z  two more scheduled, for global_mid 20261016T15 and 20261017T00 at a 1.2-degree box:
             frames of GET /grid_series?bbox=-81.2306,27.7789,-79.9988,28.8837&hours=144,...,285, the
             second page of the timeline prefetch.
  Afterwards: no outcome line for those two keys through 01:30Z, and no "fine reval scheduled" line.

Mechanism. grid_series gave every frame but a page's first a throwaway starlette BackgroundTasks() "so we
don't fan out N background fetches". It is truthy and nothing ever runs it, so the mid tier registered
the key and queued the fetch on an object nobody executes. The key was never discarded: two such keys
filled the queue for good, and the viewed hour got the 2-degree clip with no sharpen.

Pinned here, end to end through build_grid_series -> resolve_grid -> the mid tier:
1. A frame that will not revalidate leaves no key behind.
2. A prefetch frame never takes the last free slot; that slot is the viewed hour's (/grid).
3. A clip cached by one request does not decide another request's sharpen.
"""
import asyncio
import copy
import functools
import types
from datetime import datetime, timedelta, timezone

import pytest
from starlette.background import BackgroundTasks

from services.weather_pipeline import grid_resolver, mid_res_tier
from services.weather_pipeline.grid_series_helper import build_grid_series
from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct,
)

SERIES_BBOX = "-81.2306,27.7789,-79.9988,28.8837"     # the live prefetch's 1.2-degree box
H0_MINI = "0"                                          # windGridSeries.loadWindSeriesHour0
PAGE_0 = ",".join(str(h) for h in range(0, 142, 3))
PAGE_1 = ",".join(str(h) for h in range(144, 286, 3))  # the page that held both slots
WORLD = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)


def _wind_product(valid_dt, bounds, cell, *, dynamic=False, product_id="p.json"):
    vectors = []
    lat = bounds.south
    while lat <= bounds.north + 1e-9:
        lng = bounds.west
        while lng <= bounds.east + 1e-9:
            vectors.append(GridVector(lat=lat, lng=lng, speed=8.0, direction=90.0, u=-8.0, v=0.0))
            lng += cell
        lat += cell
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="wind", layer="wind",
        run_time=valid_dt, valid_time=valid_dt, is_forecast_authoritative=True,
        is_estimated=False, coverage=bounds,
        grid=NormalizedGrid(bounds=bounds, cols=int((bounds.east - bounds.west) / cell) + 1,
                            rows=int((bounds.north - bounds.south) / cell) + 1, vectors=vectors),
        value_kind="wind", value_unit="kn", display_unit_hint="kn",
        product_id=product_id, source_variables=["wind_speed_10m"], freshness_sec=3600,
        is_dynamic_viewport_product=dynamic,
    )


def _global_mid(valid_dt):
    """A 2-degree wind field around Florida, stored with the global extent like a real global_mid."""
    p = _wind_product(valid_dt, CoverageBounds(west=-100.0, south=10.0, east=-60.0, north=40.0), 2.0)
    p.grid.bounds = WORLD
    p.coverage = WORLD
    return p


class _Store:
    def __init__(self, items):
        self._items = items

    def get_manifest(self):
        return types.SimpleNamespace(products=self._items)

    def load_product(self, filename):
        stamp = filename.rsplit("_", 1)[1].removesuffix(".json")
        return _global_mid(datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc))


class _ViewportService:
    """The parts of ViewportService the resolver and the mid tier touch, with the real queue contract:
    a key leaves ACTIVE_REVALIDATIONS only when its _revalidate_fetch finishes."""

    def __init__(self):
        self.ACTIVE_REVALIDATIONS = set()
        self.started = []
        self.finished = []
        self.dynamic = {}
        self.holding = True                  # sharpens started while True stay in flight until release
        self.failing = False                 # sharpens started while True fail (no fine product)
        self._release = asyncio.Event()

    def is_viewport_enabled(self, *a, **k):
        return True

    async def get_cached_dynamic_product(self, *, model, domain, layer, target_dt, bbox_str, background_tasks=None):
        return copy.deepcopy(self.dynamic.get((target_dt, bbox_str)))

    async def _find_any_cached_product(self, *a, **k):
        return None

    async def fetch_viewport_grid_upstream(self, **k):
        raise AssertionError("the mid tier must answer without an upstream fetch")

    async def _revalidate_fetch(self, model, domain, layer, valid_time_str, target_dt, bbox_str, reval_key):
        self.started.append(reval_key)
        held, fails = self.holding, self.failing
        try:
            if held:
                await self._release.wait()
            if fails:
                raise RuntimeError("upstream refused")
            w, s, e, n = (float(x) for x in bbox_str.split(","))
            self.dynamic[(target_dt, bbox_str)] = _wind_product(
                target_dt, CoverageBounds(west=w, south=s, east=e, north=n), 0.25,
                dynamic=True, product_id=f"dynamic_{reval_key}.json")
        except RuntimeError:
            pass                             # the real one logs "revalidation failed" and returns
        finally:
            self.ACTIVE_REVALIDATIONS.discard(reval_key)
            self.finished.append(reval_key)


class _Harness:
    def __init__(self, monkeypatch):
        import services.weather_pipeline.store as store_mod
        monkeypatch.setattr(store_mod, "is_test_environment", lambda: False)   # Step 3.6 runs
        self.base = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        items = [self._mid_item(self.base + timedelta(hours=h)) for h in range(0, 400, 3)]
        self.store = _Store(items)
        self.vs = _ViewportService()
        self.resolver = functools.partial(grid_resolver.resolve_grid, self.store, self.vs)

    @staticmethod
    def _mid_item(vt):
        return types.SimpleNamespace(
            model="GFS", domain="wind", layer="wind", valid_time_start=vt, is_estimated=False,
            coverage=WORLD, filename=f"gfs_wind_wind_global_mid_{vt:%Y%m%dT%H%M%SZ}.json",
            region_id="global_mid", coverage_mode="global_tile", resolution=2.0,
        )

    def client_vt(self, hours):
        """valid_time as the client's /grid sends it (millisecond ISO, as in the live log)."""
        return (self.base + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    async def series(self, hours):
        return await build_grid_series(
            self.resolver, self.vs, "GFS", "wind", "wind", SERIES_BBOX, hours,
            base_time=self.base.strftime("%Y-%m-%dT%H:%M:%S.000Z"))

    async def grid(self, hours, background_tasks):
        return await self.resolver(model="GFS", domain="wind", layer="wind",
                                   valid_time=self.client_vt(hours), bbox=SERIES_BBOX,
                                   background_tasks=background_tasks)

    async def release_and_drain(self):
        self.vs._release.set()
        for _ in range(200):
            if len(self.vs.finished) == len(self.vs.started):
                return
            await asyncio.sleep(0.01)
        raise AssertionError(f"revalidations never finished: {self.vs.started} vs {self.vs.finished}")


@pytest.fixture(autouse=True)
def _fresh_mid_tier_state(monkeypatch):
    """The clip cache and the load semaphore are module globals created on first use; a semaphore
    created under this test's event loop must not outlive it."""
    for name in ("_CLIP_CACHE", "_LOAD_SEM"):
        if hasattr(mid_res_tier, name):
            monkeypatch.delattr(mid_res_tier, name)
    monkeypatch.delenv("MARINE_REVAL_QUEUE_MAX", raising=False)
    yield
    for name in ("_CLIP_CACHE", "_LOAD_SEM"):
        if hasattr(mid_res_tier, name):
            delattr(mid_res_tier, name)


async def _client_timeline(h):
    """What the wind client fires for a cold view (windGridSeries.ensureWindSeries): the hour-0 mini,
    the page holding the hour, then the adjacent page as an idle prefetch."""
    for hours in (H0_MINI, PAGE_0, PAGE_1):
        page = await h.series(hours)
        assert page["frame_count"] == len(hours.split(","))


async def test_viewed_hour_gets_its_sharpen_while_the_timeline_prefetch_is_in_flight(monkeypatch):
    h = _Harness(monkeypatch)
    await _client_timeline(h)

    h.vs.holding = False
    bg = BackgroundTasks()
    # +3 h, not hour 0: hour 0 at this box is the h0 mini's own warm-up, which the viewed request now
    # joins in flight (one key per hour and box, test_one_hour_and_box_is_one_key_whatever_the_client_spelling).
    viewed = await h.grid(3, bg)
    assert viewed.grid.diagnostics.get("mid_res_tier") is True
    assert viewed.staleReason == "swr_revalidation_pending", (
        f"the viewed hour was turned away; the queue held {sorted(h.vs.ACTIVE_REVALIDATIONS)}")
    assert len(bg.tasks) == 1, "the viewed hour's sharpen must actually be queued"

    await bg()                                     # FastAPI runs it once the response is sent
    again = await h.grid(3, BackgroundTasks())
    assert again.is_dynamic_viewport_product is True
    assert again.staleReason is None
    await h.release_and_drain()


async def test_a_timeline_leaves_no_queue_key_behind(monkeypatch):
    """Every key the series registered belongs to a revalidation that ran: once they finish the
    queue is empty. The page warms one viewport, not one per frame."""
    h = _Harness(monkeypatch)
    await _client_timeline(h)
    await h.release_and_drain()
    assert h.vs.ACTIVE_REVALIDATIONS == set(), "orphaned keys hold queue slots forever"
    assert len(h.vs.started) == 1, f"one warm-up for the timeline, got {h.vs.started}"


async def test_a_clip_cached_by_a_prefetch_frame_does_not_stop_the_viewed_hour_sharpening(monkeypatch):
    """The user scrubs to +147 h. The timeline page already built (and cached) that hour's clip at
    this box without sharpening it; the /grid request for the hour must still get its sharpen."""
    h = _Harness(monkeypatch)
    await h.series("144,147")
    await h.release_and_drain()
    assert h.vs.ACTIVE_REVALIDATIONS == set()

    bg = BackgroundTasks()
    viewed = await h.grid(147, bg)
    assert viewed.staleReason == "swr_revalidation_pending"
    assert len(bg.tasks) == 1, "a cache hit must not skip the sharpen"
    await bg()
    assert (await h.grid(147, BackgroundTasks())).is_dynamic_viewport_product is True


async def test_positive_control_a_tasks_object_nobody_runs_orphans_its_key(monkeypatch):
    """The mechanism, replicated: hand the mid tier a BackgroundTasks that is never executed (what
    grid_series did for every non-first frame). The key goes in and nothing ever takes it out."""
    h = _Harness(monkeypatch)
    throwaway = BackgroundTasks()
    product = await h.grid(6, throwaway)
    assert product.staleReason == "swr_revalidation_pending"
    await asyncio.sleep(0.05)
    assert len(h.vs.ACTIVE_REVALIDATIONS) == 1 and h.vs.started == []


async def test_positive_control_without_the_reserve_the_prefetch_takes_the_viewed_hours_slot(monkeypatch):
    """MARINE_REVAL_INTERACTIVE_RESERVE=0 lets a page's warm frame compete for every slot, as before
    2026-10-09: the h0 mini and page 1's warm-up fill the queue and the viewed hour is turned away.
    The reserve, not the orphan fix alone, is what lets the viewed hour win."""
    monkeypatch.setenv("MARINE_REVAL_INTERACTIVE_RESERVE", "0")
    h = _Harness(monkeypatch)
    await _client_timeline(h)
    h.vs.holding = False
    bg = BackgroundTasks()
    viewed = await h.grid(3, bg)                   # +3 h: hour 0 would join the h0 mini's warm-up in flight
    assert viewed.staleReason is None and bg.tasks == []
    assert len(h.vs.ACTIVE_REVALIDATIONS) == 2
    await h.release_and_drain()


async def test_a_turned_away_cache_hit_does_not_claim_a_pending_sharpen(monkeypatch):
    """A clip cached by a request that DID sharpen must not carry that request's label to one the
    full queue turned away: `swr_revalidation_pending` would promise a fine grid that never comes."""
    h = _Harness(monkeypatch)
    h.vs.holding, h.vs.failing = False, True
    first = BackgroundTasks()
    assert (await h.grid(6, first)).staleReason == "swr_revalidation_pending"
    await first()                                  # ran and failed: key released, no fine product
    assert h.vs.ACTIVE_REVALIDATIONS == set()

    h.vs.holding, h.vs.failing = True, False
    for hours in (9, 12):                          # two other viewed hours fill the queue
        assert (await h.grid(hours, None)).staleReason == "swr_revalidation_pending"
    assert len(h.vs.ACTIVE_REVALIDATIONS) == 2

    bg = BackgroundTasks()
    again = await h.grid(6, bg)                    # the cached clip, queue full
    assert bg.tasks == []
    assert again.staleReason is None and again.stale is False
    await h.release_and_drain()


def test_every_resolver_site_takes_its_slot_through_reval_queue():
    """The orphan came from four copies of `add key; add_task-or-create_task`. One way in now: a site
    that registers a key or starts a fetch by itself can orphan a key again. Code only (AST), so the
    comments that tell the story do not trip it."""
    import ast
    import inspect
    from services.weather_pipeline import grid_series_helper

    def _code(mod):
        return list(ast.walk(ast.parse(inspect.getsource(mod))))

    for mod in (grid_resolver, mid_res_tier):
        nodes = _code(mod)
        assert not [n for n in nodes if isinstance(n, ast.Attribute) and n.attr == "_revalidate_fetch"], \
            f"{mod.__name__} starts a revalidation outside reval_queue"
        assert not [n for n in nodes if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                    and n.func.attr == "add" and isinstance(n.func.value, ast.Attribute)
                    and n.func.value.attr == "ACTIVE_REVALIDATIONS"], \
            f"{mod.__name__} registers a queue key outside reval_queue"
    assert not [n for n in _code(grid_series_helper) if isinstance(n, ast.Call)
                and getattr(n.func, "id", getattr(n.func, "attr", None)) == "BackgroundTasks"], \
        "grid_series must not hand frames a tasks object nobody runs"


async def test_a_page_warms_one_viewport_even_when_the_warm_up_finishes_first(monkeypatch):
    """The other frames must not take turns at a slot the warm-up has freed: that is the N-fetch
    fan-out on the 1-CPU box the series exists to avoid."""
    h = _Harness(monkeypatch)
    h.vs.holding = False                           # every sharpen completes as soon as it runs
    await h.series(PAGE_1)
    await h.release_and_drain()
    assert len(h.vs.started) == 1, f"one warm-up per page, got {len(h.vs.started)}"


async def test_one_hour_and_box_is_one_key_whatever_the_client_spelling(monkeypatch):
    """grid_series asks for `...T00:00:00Z`, /grid for `...T00:00:00.000Z`. One hour and box is one fetch,
    so the viewed hour finds the warm frame's sharpen in flight instead of queueing a second copy."""
    h = _Harness(monkeypatch)
    await h.series("144")                          # the page's warm frame: sharpen scheduled, held
    assert len(h.vs.ACTIVE_REVALIDATIONS) == 1
    bg = BackgroundTasks()
    viewed = await h.grid(144, bg)
    assert viewed.staleReason == "swr_revalidation_pending"
    assert bg.tasks == [], f"a second key for one fetch: {sorted(h.vs.ACTIVE_REVALIDATIONS)}"
    assert len(h.vs.ACTIVE_REVALIDATIONS) == 1
    await h.release_and_drain()


async def test_a_repeat_while_its_sharpen_is_in_flight_still_reads_pending(monkeypatch):
    """The client refetches a frame only while it reads `swr_revalidation_pending`. A repeat of the
    viewed hour during its own sharpen must say so even when the queue is full; the mid tier used to
    answer from the queue length alone, so a full queue read as final."""
    h = _Harness(monkeypatch)
    for hours in (0, 3):
        assert (await h.grid(hours, None)).staleReason == "swr_revalidation_pending"
    assert len(h.vs.ACTIVE_REVALIDATIONS) == 2
    again = await h.grid(0, BackgroundTasks())
    assert again.staleReason == "swr_revalidation_pending"
    await h.release_and_drain()

"""A fresh wind box costs the hours that are asked for, not the forecast (2026-10-10, WIND_BG_BUILD_BOUNDED).

⛔ WHAT HAPPENED. Owner panning the live dev wind map over the Gulf, 2026-10-10 00:04-00:13Z: /api/health 10-13 s,
"Canceling stale background task for gfs_wind" 5 times in 6 minutes, `hour +NNh timed out after 10.0s` on the tail of
every 48-frame page. The client trigger is PR #300. This is the server amplifier: for wind every fresh snapped box
fetches 16 days (~385 hourly steps), normalizes the one hour asked for, and `bg_process_remaining_hours_helper` then
normalizes, serialises and indexes EVERY other hour serially, with a FULL `gc.collect()` after each.

MEASURED HERE, offline: the real ViewportService + normalizer + bg helper behind a mock 16-day upstream (nothing
touches the live backend, CLAUDE.md). `HARNESS_GC=real` runs the collections for real (the default only counts them) and
`HARNESS_HEAP=app` imports the route stack first, because a full collection walks the whole heap: 0.047 s each in a
bare test process, 0.42 s in one that has imported the app.
Flag off, before this change (python 3.12, this machine, the test process with the app imported):
- cProfile of one fresh box: `gc.collect()` was 163 of 201 s (391 calls, 0.42 s each, on the event-loop thread), the
  dynamic index's json.dump 10.7 s, the normalizer 3.9 s. The cost per hour is the collection, not the physics.
- one fresh box (mini + cold 48-frame page, then rest): 385 hours normalized, 386 full collections, 211 CPU-seconds,
  and the page got 27 of its 48 frames (the tail timed out against GRID_SERIES_DEADLINE_S = 20).
- two boxes one degree apart, the second landing while the first page is in flight: 19 "Canceling stale background
  task", 20 fetch_grid calls for 2 boxes (18 of them provider-cache re-entries by cancelled waiters), 431 hours
  normalized (18 of them twice), 230 CPU-seconds, and 30 and 33 of the 48 frames of the two pages.
The table for the flag on is in docs/weather-program/log/2026-10-10-wind-bg-build-bounded.md.

`make_rig` builds a ViewportService over a temp store, a mock upstream that honours the provider's 5-minute grid
cache, and a meter on `WeatherNormalizer.normalize` (every hour built) and on `gc.collect`.
"""
import asyncio
import itertools
import logging
import os
import threading
import time
import weakref
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import viewport_helper, viewport_service, wind_bg_build
from services.weather_pipeline.dynamic_index import DynamicProductIndex
from services.weather_pipeline.grid_series_helper import build_grid_series
from services.weather_pipeline.normalizer import WeatherNormalizer
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.viewport_service import FetchContext, ViewportService

FLAG = wind_bg_build.FLAG
BASE = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
DAY0 = BASE.replace(hour=0)
N_TIMES = 385                                          # 16 days of hourly steps: the live fetch's length
TIMES = [(DAY0 + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(N_TIMES)]
IDX0 = BASE.hour                                       # the index of "now" in TIMES
PAGE0 = list(range(0, 142, 3))                         # a 48-frame windGridSeries page
BOX_A, BOX_B = "-93,26,-82,32", "-92,26,-81,32"        # snapped whole-degree boxes, one degree apart
REGION_A = "viewport_-93.00_26.00_-82.00_32.00"
REGION_B = "viewport_-92.00_26.00_-81.00_32.00"
BOX_BBOX = {"west": -93.0, "south": 26.0, "east": -82.0, "north": 32.0}


def _csv(hours):
    return ",".join(str(h) for h in hours)


def _key(box):
    return tuple(float(x) for x in box.split(","))


class Meter:
    """What a fresh box costs: hours normalized, upstream fetches, collections."""

    def __init__(self):
        self.normalized = []     # (region_id, target_time, thread_cpu_s)
        self.fetches = []        # (box key, was a provider-cache hit)
        self.gc = []             # (generation, seconds)
        self.gate = threading.Event()
        self.gate.set()
        self.hold_region = self.hold_at = None
        self.cache = {}          # the provider's 5-minute grid cache, keyed as its fetch_grid keys it

    def hold(self, region, at):
        """Block `region`'s normalize calls (in their worker threads) once `at` hours of it are built, until release()."""
        self.hold_region, self.hold_at = region, at
        self.gate.clear()

    def release(self):
        self.gate.set()

    def built(self, region=None):
        return sorted(t for r, t, _ in self.normalized if region is None or r == region)

    def full_collections(self):
        return sum(1 for g, _ in self.gc if g == 2)

    def misses(self, box=None):
        return sum(1 for k, hit in self.fetches if not hit and (box is None or k == _key(box)))

    def calls(self, box):
        return sum(1 for k, _ in self.fetches if k == _key(box))


class Rig:
    def __init__(self, service, meter, caplog):
        self.service, self.meter, self._caplog = service, meter, caplog
        self._log_from = len(caplog.records)
        self._cpu0 = time.process_time()

    async def page(self, box, hours):
        async def resolve_grid(model, domain, layer, valid_time, bbox, surf=False, background_tasks=None, **kw):
            t = datetime.fromisoformat(valid_time.replace("Z", "+00:00"))
            return await self.service.fetch_viewport_grid(model, domain, layer, valid_time, t, bbox)
        # base_time pins the series to BASE (fixed at import): a run that crosses a UTC hour boundary cannot shift it.
        return await build_grid_series(resolve_grid, self.service, "GFS", "wind", "wind", box, _csv(hours),
                                       base_time=BASE.strftime("%Y-%m-%dT%H:%M:%SZ"))

    async def hour(self, box, h):
        t = BASE + timedelta(hours=h)
        return await self.service.fetch_viewport_grid("GFS", "wind", "wind", t.strftime("%Y-%m-%dT%H:%M:%SZ"), t, box)

    async def settle(self, timeout=60.0):
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            tasks = [t for t in [*ViewportService.ACTIVE_BG_TASKS.values(), *ViewportService.KEPT_BG_TASKS]
                     if not t.done()]
            if not tasks:
                return
            await asyncio.gather(*tasks, return_exceptions=True)
        raise AssertionError("background build did not finish")

    async def stop(self):
        """End whatever is still building (the flag-off build would run the whole forecast)."""
        self.meter.release()
        tasks = [t for t in [*ViewportService.ACTIVE_BG_TASKS.values(), *ViewportService.KEPT_BG_TASKS]
                 if not t.done()]
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def logged(self, text):
        return sum(text in r.getMessage() for r in self._caplog.records[self._log_from:])

    def cpu_s(self):
        return time.process_time() - self._cpu0

    async def pending_waiters(self):
        """Wait until some request is waiting on an hour of a live context (a page is in flight)."""
        for _ in range(400):
            if any(wind_bg_build.has_pending_waiter(c) for c in list(ViewportService.IN_FLIGHT_REQUESTS.values())):
                return
            await asyncio.sleep(0.01)
        raise AssertionError("no request ever waited on the background build")

    def row(self, label, frames=None):
        m = self.meter
        print(f"\n{label}: hours normalized={len(m.built())} (distinct box-hours {len({(r, t) for r, t, _ in m.normalized})}) "
              f"full gc.collect={m.full_collections()} fetch_grid calls={len(m.fetches)} "
              f"(upstream {m.misses()}) cancels={self.logged('Canceling stale background task')} "
              f"cpu={self.cpu_s():.1f}s frames per page={frames}")


@pytest.fixture
def make_rig(tmp_path, monkeypatch, caplog):
    """`make_rig(flag)` -> a clean Rig; callable more than once per test (store, class state and meter reset)."""
    caplog.set_level(logging.INFO)
    current = {}
    n = itertools.count()
    real_gc = __import__("gc")

    async def fetch_grid(self, model, domain, layer, bbox, resolution=0.25, forecast_days=2,
                         precomputed_coords=None, inter_batch_delay=None, **kw):
        m = current["meter"]
        lats, lons = precomputed_coords
        key = (bbox["west"], bbox["south"], bbox["east"], bbox["north"])
        ck = (key, resolution, forecast_days)
        hit = ck in m.cache
        m.fetches.append((key, hit))
        if not hit:
            await asyncio.sleep(0.01)
            m.cache[ck] = True
        speeds = [8.0 + (h % 24) * 0.25 for h in range(N_TIMES)]
        return [{"latitude": la, "longitude": lo,
                 "hourly_units": {"time": "iso8601", "wind_speed_10m": "kn", "wind_direction_10m": "°"},
                 "hourly": {"time": TIMES,
                            "wind_speed_10m": [s + abs(la) * 0.01 for s in speeds],
                            "wind_direction_10m": [(h * 7 + lo) % 360.0 for h in range(N_TIMES)]}}
                for la, lo in zip(lats, lons)]

    orig_normalize = WeatherNormalizer.normalize

    def counted(self, *a, **kw):
        m = current["meter"]
        region = kw.get("region_id")
        if m.hold_region == region and len([x for x in m.normalized if x[0] == region]) >= m.hold_at:
            m.gate.wait(timeout=30)
        t0 = time.thread_time()
        try:
            return orig_normalize(self, *a, **kw)
        finally:
            m.normalized.append((region, kw.get("target_time"), time.thread_time() - t0))

    class GcShim:
        def collect(self, generation=2):
            t0 = time.perf_counter()
            if os.environ.get("HARNESS_GC") == "real":
                real_gc.collect(generation)
            current["meter"].gc.append((generation, time.perf_counter() - t0))
            return 0

    monkeypatch.setattr(OpenMeteoProvider, "fetch_grid", fetch_grid)
    monkeypatch.setattr(WeatherNormalizer, "normalize", counted)
    monkeypatch.setattr(viewport_helper, "gc", GcShim())
    monkeypatch.setattr(viewport_service, "gc", GcShim())

    def reset_class_state():
        for t in list(ViewportService.ACTIVE_BG_TASKS.values()):
            try:
                t.cancel()
            except RuntimeError:          # its loop is already closed
                pass
        ViewportService.IN_FLIGHT_REQUESTS.clear()
        ViewportService.ACTIVE_BG_TASKS.clear()
        ViewportService.ACTIVE_BG_CONTEXTS.clear()
        ViewportService.KEPT_BG_TASKS.clear()
        ViewportService.NEGATIVE_CACHE.clear()

    def make(flag):
        if flag:
            monkeypatch.setenv(FLAG, "1")
        else:
            monkeypatch.delenv(FLAG, raising=False)
        monkeypatch.setenv("WIND_BG_LINGER_S", os.environ.get("WIND_BG_LINGER_S", "1.0"))
        if os.environ.get("HARNESS_HEAP") == "app":
            import routes.weather  # noqa: F401  the serve process's heap: a full collection walks all of it
        reset_class_state()
        ViewportService.IN_FLIGHT_LOCK = asyncio.Lock()
        with ProductStore._product_cache_lock:
            ProductStore._product_cache.clear()
            ProductStore._product_cache_vectors.clear()
        d = tmp_path / f"rig{next(n)}"
        d.mkdir()
        current["meter"] = Meter()
        service = ViewportService(store=ProductStore(cache_dir=d), dynamic_index=DynamicProductIndex(cache_dir=d))
        return Rig(service, current["meter"], caplog)

    yield make
    if "meter" in current:
        current["meter"].release()
    reset_class_state()


def _times(idx):
    return {(DAY0 + timedelta(hours=i)) for i in idx}


def _window(center=IDX0):
    return wind_bg_build.window_indices(center, N_TIMES)


def _built(rig):
    return {t.astimezone(timezone.utc) for t in rig.meter.built()}


def _vectors(grid):
    return [(v.lat, v.lng, v.speed, v.direction) for v in grid.vectors]


# ── today, pinned: the flag off must stay the build it always was ──

async def test_flag_off_builds_every_hour_with_a_full_collection_each(make_rig):
    rig = make_rig(flag=False)
    await rig.page(BOX_A, [0])
    await rig.settle()
    assert len(rig.meter.built()) == N_TIMES, "the bg build normalizes the whole 16-day forecast"
    # One per background hour, one after the spawn, one when the task ends.
    assert rig.meter.full_collections() == (N_TIMES - 1) + 2
    assert rig.meter.misses() == 1


async def test_off_the_new_box_cancels_the_task_and_the_waiting_hours_refetch(make_rig):
    """Today's behaviour, pinned so the test below cannot pass for the wrong reason."""
    rig = make_rig(flag=False)
    await rig.page(BOX_A, [0])
    rig.meter.hold(REGION_A, at=17)                      # the page's builds stall mid-page
    page_a = asyncio.create_task(rig.page(BOX_A, PAGE0))
    await rig.pending_waiters()
    await rig.page(BOX_B, [0])                           # another box lands while A's page is waiting
    assert rig.logged("Canceling stale background task") >= 1
    rig.meter.release()
    await page_a
    assert rig.meter.calls(BOX_A) >= 2, "the cancelled waiters went down the self-heal path and fetched A again"
    await rig.stop()


# ── the fix ──

async def test_on_a_fresh_box_builds_the_window_not_the_forecast(make_rig):
    rig = make_rig(flag=True)
    await rig.page(BOX_A, [0])
    await rig.settle()
    assert _built(rig) == _times(_window())
    assert len(rig.meter.built()) == len(_window()) <= 2 * wind_bg_build.DEFAULT_WINDOW_H + 1
    assert rig.meter.misses() == 1, "still one upstream fetch of the whole forecast"


async def test_on_a_cold_page_builds_the_page_hours_and_the_window_and_nothing_else(make_rig):
    rig = make_rig(flag=True)
    await rig.page(BOX_A, [0])                           # the 1-frame mini the client sends first
    frames = (await rig.page(BOX_A, PAGE0))["frames"]
    await rig.settle()
    assert [f["hour_offset"] for f in frames] == PAGE0, "all 48 frames arrive: no tail is lost"
    want = _times(_window()) | _times(IDX0 + h for h in PAGE0)
    assert _built(rig) == want
    assert len(rig.meter.built()) == len(want), "no hour is built twice"
    assert len(want) < N_TIMES // 5
    assert rig.meter.misses() == 1 and rig.meter.calls(BOX_A) == 1, "the page rode the mini's fetch"


async def test_on_a_young_generation_collection_replaces_the_full_one_per_hour(make_rig):
    rig = make_rig(flag=True)
    await rig.page(BOX_A, [0])
    await rig.settle()
    assert rig.meter.full_collections() == 1, "only the task's final one: not one per hour, not the spawn's"
    assert sum(1 for g, _ in rig.meter.gc if g == 1) == len(rig.meter.built()),         "a young-generation pass after the spawn and after each background hour"


async def test_on_changes_no_served_number(make_rig):
    off = make_rig(flag=False)
    await off.page(BOX_A, [0])
    page_off = (await off.page(BOX_A, PAGE0))["frames"]
    odd_off = await off.hour(BOX_A, 100)                 # an hour no page asks for
    await off.stop()
    on = make_rig(flag=True)
    await on.page(BOX_A, [0])
    page_on = (await on.page(BOX_A, PAGE0))["frames"]
    odd_on = await on.hour(BOX_A, 100)
    await on.settle()
    assert [f["hour_offset"] for f in page_on] == [f["hour_offset"] for f in page_off] == PAGE0
    for a, b in zip(page_off, page_on):
        assert a["valid_time"] == b["valid_time"], a["hour_offset"]
        assert [(v.lat, v.lng, v.speed, v.direction) for v in a["vectors"]] == \
               [(v.lat, v.lng, v.speed, v.direction) for v in b["vectors"]], a["hour_offset"]
    assert odd_on.valid_time == odd_off.valid_time == BASE + timedelta(hours=100)
    assert _vectors(odd_on.grid) == _vectors(odd_off.grid) and len(odd_on.grid.vectors) > 0


async def test_an_unbuilt_hour_still_resolves_on_demand_from_the_provider_cache_then_upstream(make_rig):
    rig = make_rig(flag=True)
    await rig.page(BOX_A, [0])
    await rig.settle()
    assert BASE + timedelta(hours=100) not in _built(rig)
    p = await rig.hour(BOX_A, 100)
    assert p is not None and p.grid.vectors and p.valid_time == BASE + timedelta(hours=100)
    assert rig.meter.misses() == 1 and rig.meter.calls(BOX_A) == 2, "a provider-cache hit: no second 16-day fetch"
    await rig.settle()
    rig.meter.cache.clear()                              # the provider's 5 minutes have passed
    p = await rig.hour(BOX_A, 200)
    assert p is not None and p.grid.vectors and p.valid_time == BASE + timedelta(hours=200)
    assert rig.meter.misses() == 2, "after the cache expires the hour is served by one fresh fetch"
    await rig.settle()


# ── the slot ──

async def test_a_new_box_does_not_cancel_a_task_a_request_is_waiting_on(make_rig):
    rig = make_rig(flag=True)
    await rig.page(BOX_A, [0])
    rig.meter.hold(REGION_A, at=17)                      # the fetcher + 12 window hours + 4 of the page's
    page_a = asyncio.create_task(rig.page(BOX_A, PAGE0))
    await rig.pending_waiters()
    await rig.page(BOX_B, [0])                           # another box lands while A's page is waiting
    assert rig.logged("Canceling stale background task") == 0
    assert rig.logged("Keeping background task") == 1
    assert len(ViewportService.KEPT_BG_TASKS) == 1, "the replaced task is held until it finishes (asyncio keeps tasks weakly)"
    rig.meter.release()
    frames = (await page_a)["frames"]
    await rig.settle()
    assert not ViewportService.KEPT_BG_TASKS
    assert [f["hour_offset"] for f in frames] == PAGE0
    assert rig.meter.calls(BOX_A) == 1 and rig.meter.misses() == 2, \
        "box A is fetched once (its mini's); only box B's mini is a second upstream fetch"


async def test_an_idle_task_is_still_cancelled_by_the_next_box(make_rig):
    rig = make_rig(flag=True)
    await rig.page(BOX_A, [0])                           # A's bg is now building its window, then lingering
    assert not rig.service.ACTIVE_BG_TASKS["gfs_wind"].done()
    await rig.page(BOX_B, [0])
    assert rig.logged("Canceling stale background task") == 1
    assert rig.logged("Keeping background task") == 0
    await rig.settle()
    assert len(rig.meter.built(REGION_B)) == len(_window()), "the box the user is on still gets its window"
    assert len(rig.meter.built(REGION_A)) < len(_window()), "the superseded box's speculative build was cut short"
    assert not rig.service.IN_FLIGHT_REQUESTS


# ── the linger ──

async def test_a_context_nobody_can_wait_on_does_not_linger(make_rig, monkeypatch):
    """The native-recovery build runs the helper on a context that is never registered in IN_FLIGHT_REQUESTS."""
    monkeypatch.setenv("WIND_BG_LINGER_S", "30")
    rig = make_rig(flag=True)
    raw = await OpenMeteoProvider().fetch_grid(
        model="GFS", domain="wind", layer="wind", bbox=BOX_BBOX, resolution=1.0, forecast_days=16,
        precomputed_coords=([26.0, 27.0], [-93.0, -92.0]))
    ctx = FetchContext()
    ctx.raw_list = raw
    ctx.raw_fetch_future.set_result(True)
    t0 = time.monotonic()
    await viewport_helper.bg_process_remaining_hours_helper(
        service=rig.service, context=ctx, request_dedup_key="native_recovery_gfs_wind_x",
        model="GFS", domain="wind", layer="wind", bbox_dict=BOX_BBOX, resolution=1.0,
        west=-93.0, south=26.0, east=-82.0, north=32.0, times=TIMES, target_idx=IDX0,
        bbox_str=BOX_A, coverage_scope="viewport", coord_count=2, bbox_key_str="x")
    assert time.monotonic() - t0 < 5, "a 30 s linger on an unregistered context holds the recovery lane"
    assert len(rig.meter.built()) == len(_window()) - 1  # the window minus the hour the fetcher would have built


async def test_a_registered_context_lingers_for_late_waiters_then_retires(make_rig, monkeypatch):
    monkeypatch.setenv("WIND_BG_LINGER_S", "0.6")
    rig = make_rig(flag=True)
    await rig.page(BOX_A, [0])
    task = rig.service.ACTIVE_BG_TASKS["gfs_wind"]
    window_done = None
    while not task.done():
        if window_done is None and len(rig.meter.built()) == len(_window()):
            window_done = time.monotonic()
        await asyncio.sleep(0.01)
    ended = time.monotonic()
    assert window_done is not None and ended - window_done >= 0.3, "it waited out the 0.6 s linger after the window"
    assert not ViewportService.IN_FLIGHT_REQUESTS, "it retired its context, as the unbounded build does"


async def test_a_late_waiter_inside_the_linger_is_served_without_a_refetch(make_rig):
    rig = make_rig(flag=True)
    await rig.page(BOX_A, [0])
    # The window is built once the task has nothing left to pick; the context is still the live one.
    for _ in range(300):
        if len(rig.meter.built()) == len(_window()):
            break
        await asyncio.sleep(0.01)
    assert ViewportService.IN_FLIGHT_REQUESTS, "the task is lingering"
    p = await rig.hour(BOX_A, 60)
    assert p.valid_time == BASE + timedelta(hours=60) and p.grid.vectors
    assert rig.meter.calls(BOX_A) == 1, "served through the live context: no second fetch_grid call"
    await rig.settle()


# ── the knobs and the guards ──

def test_window_indices_clamp_at_both_ends_and_honour_the_knob(monkeypatch):
    monkeypatch.delenv("WIND_BG_WINDOW_H", raising=False)
    assert wind_bg_build.window_indices(100, 385) == set(range(94, 107))
    assert wind_bg_build.window_indices(2, 385) == set(range(0, 9))
    assert wind_bg_build.window_indices(383, 385) == set(range(377, 385))
    monkeypatch.setenv("WIND_BG_WINDOW_H", "0")
    assert wind_bg_build.window_indices(100, 385) == {100}
    monkeypatch.setenv("WIND_BG_WINDOW_H", "not-a-number")
    assert wind_bg_build.window_indices(100, 385) == set(range(94, 107))
    monkeypatch.setenv("WIND_BG_WINDOW_H", "-3")
    assert wind_bg_build.window_indices(100, 385) == {100}


def test_the_flag_is_wind_only_and_off_by_default(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    assert not wind_bg_build.wind_bg_bounded("wind")
    monkeypatch.setenv(FLAG, "1")
    assert wind_bg_build.wind_bg_bounded("wind") and wind_bg_build.wind_bg_bounded("Wind")
    assert not wind_bg_build.wind_bg_bounded("marine"), "marine builds are not touched by this flag"
    monkeypatch.setenv(FLAG, "true")
    assert not wind_bg_build.wind_bg_bounded("wind"), "only '1' turns it on, like every other flag here"


async def test_keeps_task_needs_a_running_task_with_a_waiter_and_a_live_context():
    class Task:
        def __init__(self, done):
            self._d = done

        def done(self):
            return self._d

    ctx = FetchContext()
    slots, ctxs = {"k": Task(False)}, {"k": weakref.ref(ctx)}
    assert not wind_bg_build.keeps_task(slots, ctxs, "k"), "no waiter"
    fut = asyncio.get_running_loop().create_future()
    ctx.hour_futures[datetime.now(timezone.utc)] = fut
    assert wind_bg_build.keeps_task(slots, ctxs, "k")
    assert not wind_bg_build.keeps_task({"k": Task(True)}, ctxs, "k"), "a finished task is never kept"
    fut.set_result(True)
    assert not wind_bg_build.keeps_task(slots, ctxs, "k"), "the waiter was served"
    assert not wind_bg_build.keeps_task({}, ctxs, "k") and not wind_bg_build.keeps_task(slots, {}, "k")
    fut2 = asyncio.get_running_loop().create_future()
    ctx.hour_futures[datetime.now(timezone.utc) + timedelta(hours=1)] = fut2
    del ctx
    assert not wind_bg_build.keeps_task(slots, ctxs, "k"), "the weak reference died with its context"
    fut2.cancel()


def test_the_flag_is_declared_in_the_registry_off_by_default():
    import ast
    src = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "routes", "admin", "surf_forecast.py")
    with open(src, encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    table = next(ast.literal_eval(n.value) for n in ast.walk(tree)
                 if isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "_RATING_FLAGS" for t in n.targets))
    default, what, where = table[FLAG]
    assert default == "0" and "Render env" in where and what


# ── a pan session, before and after (prints the numbers the session log carries; run with -s) ──

PAN_BOXES = ["-93,26,-82,32", "-92,26,-81,32", "-94,25,-83,31", "-91,27,-80,33", "-95,26,-84,32", "-92,25,-81,31"]


async def _pan_session(rig, boxes, hours_between):
    """Each view: its mini, then its page 0 left running; the next view lands `hours_between` builds later."""
    pages = []
    for box in boxes:
        await rig.page(box, [0])
        pages.append(asyncio.create_task(rig.page(box, PAGE0)))
        start = len(rig.meter.normalized)
        for _ in range(4000):
            if len(rig.meter.normalized) - start >= hours_between:
                break
            await asyncio.sleep(0.005)
    frames = [len((await p)["frames"]) for p in pages]
    return frames


async def test_a_pan_session_costs_the_hours_asked_for(make_rig):
    off = make_rig(flag=False)
    frames_off = await _pan_session(off, PAN_BOXES[:4], hours_between=40)
    await off.stop()
    off.row("PAN 4 views, flag off", frames_off)
    on = make_rig(flag=True)
    frames_on = await _pan_session(on, PAN_BOXES[:4], hours_between=40)
    await on.settle()
    on.row("PAN 4 views, flag on ", frames_on)
    assert frames_on == [48] * 4
    # Flag on: each box costs exactly the hours its views asked for (page + window, the mini's hour shared).
    assert len(on.meter.built()) == len({(r, t) for r, t, _ in on.meter.normalized}) <= 4 * (len(_window()) + len(PAGE0))
    assert on.meter.calls(PAN_BOXES[0]) == 1 and len(on.meter.fetches) == 4, "one fetch per box, no self-heal re-entries"
    assert on.logged("Canceling stale background task") == 0 and on.logged("Keeping background task") >= 1
    # Flag off, same session: the cancel/self-heal cascade (31 cancels and 28 re-entries for 4 boxes when this was
    # measured) and a full collection per hour built.
    assert off.logged("Canceling stale background task") > 4 and len(off.meter.fetches) > 2 * len(on.meter.fetches)
    assert on.meter.full_collections() * 5 < off.meter.full_collections()


# ── the table: HARNESS_TABLE=1 HARNESS_GC=real python -m pytest tests/test_wind_bg_build_bounded.py -k table -s ──
# With the collections run for real the flag-off rows take minutes (that is the finding), so the measurement is
# only DEFINED when HARNESS_TABLE is set: CI collects no skipped placeholders and its counts stay exact.

def _define_table():
    @pytest.mark.parametrize("scenario", ["mini_only", "mini_page0_rest", "two_boxes_overlap", "pan_6_views"])
    @pytest.mark.parametrize("flag", [False, True], ids=["off", "on"])
    async def test_table(make_rig, scenario, flag):
        await _table_row(make_rig, scenario, flag)
    return test_table


async def _table_row(make_rig, scenario, flag):
    rig = make_rig(flag=flag)
    frames = None
    if scenario == "mini_only":
        await rig.page(BOX_A, [0])
    elif scenario == "mini_page0_rest":
        await rig.page(BOX_A, [0])
        frames = [len((await rig.page(BOX_A, PAGE0))["frames"])]
    elif scenario == "two_boxes_overlap":
        frames = await _pan_session(rig, PAN_BOXES[:2], hours_between=8)
    else:
        frames = await _pan_session(rig, PAN_BOXES, hours_between=40)
    t_end = time.process_time()
    await rig.settle(timeout=900)
    rig.row(f"TABLE {scenario:<18} flag {'on ' if flag else 'off'} (gc {os.environ.get('HARNESS_GC', 'counted')})", frames)
    print(f"   cpu until the last page returned={t_end - rig._cpu0:.1f}s, until the build ended={rig.cpu_s():.1f}s, "
          f"normalize cpu={sum(c for _, _, c in rig.meter.normalized):.1f}s, "
          f"gc seconds={sum(t for _, t in rig.meter.gc):.1f}s, gc-tracked objects={len(__import__('gc').get_objects()):,}")


if os.environ.get("HARNESS_TABLE"):
    test_table = _define_table()

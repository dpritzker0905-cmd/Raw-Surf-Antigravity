"""Orphaned hour-waiter regression (2026-10-08 wind zoom audit): fine wind never arrived.

Mechanism. A dynamic-viewport request that SHARES an in-flight fetch (same model/domain/layer/bbox,
any hour) awaits the raw fetch, then — when its own hour is not on disk yet — registers a NEW
`context.hour_futures[target_dt]` and awaits it with `asyncio.shield`, no timeout. The background
task that processes the remaining hours resolves those futures, and its `finally` fails whichever
are pending and pops the context. A waiter that registers AFTER that cleanup (the task finished,
or was cancelled by a newer fetch for the same model+domain — "Canceling stale background task")
creates a future nobody will ever resolve and waits forever.

When that waiter is an SWR revalidation it also holds the revalidation semaphore
(MARINE_REVAL_CONCURRENCY=1) and a slot of the outstanding queue (MARINE_REVAL_QUEUE_MAX=2), so
`try_serve_mid_res_tier` stops scheduling sharpens on that instance: every wind (and marine) view
stays on the 2-degree mid tier until a restart. Render log 2026-10-08: revals succeed until
23:24:08Z, two are scheduled at 23:24:11, the background task is cancelled at 23:24:48, and no
revalidation outcome is logged afterwards.

Fixes pinned here: (1) a waiter registers an hour future only while its context is still the live
`IN_FLIGHT_REQUESTS` entry, otherwise it takes the existing self-heal path; (2) a revalidation is
bounded by VIEWPORT_REVAL_TIMEOUT_S so it can never hold the semaphore or its queue slot forever.
"""
import asyncio
import inspect
from datetime import datetime, timezone

import pytest

from services.weather_pipeline.viewport_service import ViewportService, FetchContext

# request_dedup_key shape: model_domain_layer_<snapped bbox>_<forecast days>
DEDUP = "_".join(["gfs", "wind", "wind", "-91.19", "23.64", "-84.74", "26.62", "16"])
DT = datetime(2026, 10, 16, 21, tzinfo=timezone.utc)


@pytest.fixture
def svc():
    s = ViewportService.__new__(ViewportService)   # the methods under test touch class-level state only
    yield s
    ViewportService.IN_FLIGHT_REQUESTS.pop(DEDUP, None)


async def test_positive_control_old_registration_hangs_on_a_retired_context():
    """The pre-fix pattern, replicated: register into a context whose cleanup already ran, then
    wait. Nothing resolves the future — the production hang."""
    ctx = FetchContext()
    lock = asyncio.Lock()
    # the background task's finally already ran: pending futures failed, context popped
    async with lock:
        hour_fut = ctx.hour_futures.get(DT) or asyncio.Future()
        ctx.hour_futures[DT] = hour_fut
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(asyncio.shield(hour_fut), timeout=0.1)


async def test_register_hour_waiter_refuses_a_retired_context(svc):
    ctx = FetchContext()                       # not (or no longer) the live entry for DEDUP
    assert ViewportService.IN_FLIGHT_REQUESTS.get(DEDUP) is not ctx
    fut = await svc._register_hour_waiter(DEDUP, ctx, DT)
    assert fut is None
    assert DT not in ctx.hour_futures          # no orphan left behind


async def test_register_hour_waiter_refuses_a_superseded_context(svc):
    """A NEWER context under the same key must not adopt an old waiter either."""
    old, new = FetchContext(), FetchContext()
    ViewportService.IN_FLIGHT_REQUESTS[DEDUP] = new
    assert await svc._register_hour_waiter(DEDUP, old, DT) is None


async def test_register_hour_waiter_joins_a_live_context(svc):
    ctx = FetchContext()
    ViewportService.IN_FLIGHT_REQUESTS[DEDUP] = ctx
    fut = await svc._register_hour_waiter(DEDUP, ctx, DT)
    assert fut is not None and ctx.hour_futures[DT] is fut
    assert await svc._register_hour_waiter(DEDUP, ctx, DT) is fut   # a second waiter shares it
    fut.set_result(True)


async def test_waiter_whose_context_retires_mid_wait_self_heals_instead_of_hanging(monkeypatch):
    """Drives the REAL sharing-waiter path: the request finds an in-flight fetch (raw data already
    fetched), its hour is not on disk, and the background task retires the context before the
    waiter registers. Fixed: the waiter self-heals into its own (here failing) fetch and returns a
    clean 5xx. Pre-fix: it awaits a future nobody resolves — this test times out."""
    from datetime import timedelta
    from fastapi import HTTPException
    from services.weather_pipeline import viewport_service as vs

    shared = FetchContext()
    shared.raw_fetch_future.set_result(True)          # the raw fetch already completed

    class RetiresAfterFirstJoin(dict):
        """IN_FLIGHT_REQUESTS stand-in: the first lookup finds the in-flight fetch; after that the
        background task's cleanup has popped it (every later lookup misses)."""
        joined = False
        def __contains__(self, k):
            if not self.joined:
                return True
            return dict.__contains__(self, k)
        def __getitem__(self, k):
            if not self.joined:
                self.joined = True
                return shared
            return dict.__getitem__(self, k)

    class NoDiskProduct:
        cache_dir = None
        def load_product(self, _name):
            return None

    async def upstream_down(**_kw):
        raise RuntimeError("upstream unavailable (test)")

    async def no_cached_fallback(*_a, **_kw):
        return None

    monkeypatch.setattr(ViewportService, "IN_FLIGHT_REQUESTS", RetiresAfterFirstJoin())
    monkeypatch.setattr(vs, "fetch_upstream_raw", upstream_down)
    monkeypatch.setattr(vs, "maybe_spawn_native_wind_recovery", lambda *a, **k: False)
    svc = ViewportService.__new__(ViewportService)
    svc._store = NoDiskProduct()
    monkeypatch.setattr(svc, "_find_any_cached_product", no_cached_fallback, raising=False)
    target = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) + timedelta(hours=6)
    neg_before = dict(ViewportService.NEGATIVE_CACHE)
    try:
        with pytest.raises(HTTPException):
            await asyncio.wait_for(
                svc.fetch_viewport_grid_upstream("GFS", "wind", "wind", target.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                                 target, "-91,23,-87,26"),
                timeout=3.0,
            )
        assert DT not in shared.hour_futures and target not in shared.hour_futures   # no orphan registered
    finally:
        ViewportService.NEGATIVE_CACHE.clear()
        ViewportService.NEGATIVE_CACHE.update(neg_before)


async def test_both_waiter_blocks_use_the_guarded_registration():
    src = inspect.getsource(ViewportService.fetch_viewport_grid_upstream)   # the sharing-waiter blocks live here
    assert src.count("_register_hour_waiter(") == 2
    assert "context.hour_futures[target_dt] = hour_fut" not in src


async def test_revalidation_cannot_hold_the_semaphore_or_queue_forever(svc, monkeypatch):
    monkeypatch.setenv("VIEWPORT_REVAL_TIMEOUT_S", "0.05")
    saved_sem = ViewportService.__dict__.get("_REVAL_SEMAPHORE")
    if saved_sem is not None:
        monkeypatch.delattr(ViewportService, "_REVAL_SEMAPHORE")

    async def hangs_forever(**_kw):
        await asyncio.Future()                 # an orphaned shared wait

    monkeypatch.setattr(svc, "fetch_viewport_grid", hangs_forever, raising=False)
    reval_key = "gfs_wind_wind_2026-10-16T21:00:00Z_-91,23,-84,26"
    ViewportService.ACTIVE_REVALIDATIONS.add(reval_key)
    try:
        await asyncio.wait_for(
            svc._revalidate_fetch("GFS", "wind", "wind", "2026-10-16T21:00:00Z", DT, "-91,23,-84,26", reval_key),
            timeout=2.0,
        )
        assert reval_key not in ViewportService.ACTIVE_REVALIDATIONS   # queue slot released
        assert not ViewportService._REVAL_SEMAPHORE.locked()           # worker released
    finally:
        ViewportService.ACTIVE_REVALIDATIONS.discard(reval_key)
        if saved_sem is not None:
            ViewportService._REVAL_SEMAPHORE = saved_sem
        elif "_REVAL_SEMAPHORE" in ViewportService.__dict__:
            del ViewportService._REVAL_SEMAPHORE

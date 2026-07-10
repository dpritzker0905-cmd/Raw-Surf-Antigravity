"""Poisoned shared-context regression (2026-07-10 production naked-500 storm on far-hour dynamic
wind). Mechanism: waiters `await context.raw_fetch_future` (a BARE future) — cancelling a task
blocked on a bare future CANCELS THE FUTURE ITSELF, and CancelledError is a BaseException the
`except Exception` ladders never catch, so one cancelled request poisoned IN_FLIGHT_REQUESTS for
every later request until restart. Fixes pinned here: (1) asyncio.shield on shared awaits keeps a
waiter cancellation from killing the shared future; (2) _reap_shared_context drops a dead context
(identity-guarded) so the system self-heals."""
import asyncio

import pytest

from services.weather_pipeline.viewport_service import ViewportService, FetchContext


@pytest.mark.asyncio
async def test_bare_future_await_cancellation_poisons_but_shield_protects():
    """Pins the asyncio semantics the fix relies on: un-shielded waiter cancellation cancels the
    SHARED future (the poison vector); shield() keeps it alive for other waiters."""
    # Un-shielded: cancelling the waiter cancels the shared future.
    bare = asyncio.Future()

    async def wait_bare():
        await bare

    t = asyncio.create_task(wait_bare())
    await asyncio.sleep(0)
    t.cancel()
    with pytest.raises(asyncio.CancelledError):
        await t
    assert bare.cancelled()  # the shared state died with the one waiter — the production bug

    # Shielded: the waiter dies, the shared future survives for everyone else.
    shielded = asyncio.Future()

    async def wait_shielded():
        await asyncio.shield(shielded)

    t2 = asyncio.create_task(wait_shielded())
    await asyncio.sleep(0)
    t2.cancel()
    with pytest.raises(asyncio.CancelledError):
        await t2
    assert not shielded.cancelled()
    shielded.set_result(True)  # still usable by other waiters


@pytest.mark.asyncio
async def test_reap_shared_context_pops_only_matching_identity():
    svc = ViewportService.__new__(ViewportService)  # method touches class-level state only
    key = "icon_wind_wind_-180.00_-80.00_180.00_85.00_5"
    poisoned = FetchContext()
    poisoned.raw_fetch_future.cancel()
    ViewportService.IN_FLIGHT_REQUESTS[key] = poisoned
    try:
        await svc._reap_shared_context(key, poisoned)
        assert key not in ViewportService.IN_FLIGHT_REQUESTS  # dead context reaped

        # A DIFFERENT (fresh) context under the same key must never be reaped by a stale waiter.
        fresh = FetchContext()
        ViewportService.IN_FLIGHT_REQUESTS[key] = fresh
        await svc._reap_shared_context(key, poisoned)
        assert ViewportService.IN_FLIGHT_REQUESTS.get(key) is fresh
    finally:
        ViewportService.IN_FLIGHT_REQUESTS.pop(key, None)


@pytest.mark.asyncio
async def test_fetcher_cancel_cleanup_leaves_waiters_a_normal_exception():
    """The fetcher's CancelledError branch resolves shared futures with a NORMAL exception so
    waiters take their handled self-heal path instead of seeing a cancelled future."""
    from fastapi import HTTPException

    ctx = FetchContext()
    hour_fut = asyncio.Future()
    ctx.hour_futures["h"] = hour_fut
    # Mirror the cleanup the except-CancelledError branch performs:
    cancel_exc = HTTPException(status_code=504, detail="upstream_fetch_cancelled")
    for fut in [ctx.raw_fetch_future, *ctx.hour_futures.values()]:
        if not fut.done():
            fut.set_exception(cancel_exc)
            fut.exception()
    with pytest.raises(HTTPException):
        await ctx.raw_fetch_future  # waiters get a catchable Exception, not CancelledError
    assert not ctx.raw_fetch_future.cancelled()

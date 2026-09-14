"""Own shielded series fetches until their provider cache has finished warming."""
import asyncio
import logging

logger = logging.getLogger(__name__)
_background_fetches = set()


async def await_provider_fetch(fetch, *, provider):
    """Preserve caller cancellation without abandoning the provider's eventual outcome.

    A series timeout cancels the shield, not the underlying fetch. Keep that historical
    warming behavior, retain the task while active, and retrieve late exceptions. This
    does not add a retry, change provider timeouts, or cap concurrent provider work.
    """
    task = asyncio.create_task(fetch, name=f"grid-series:{provider}")
    _background_fetches.add(task)

    def completed(done):
        _background_fetches.discard(done)
        if not done.cancelled():
            error = done.exception()
            if error is not None:
                # Labels are call-site constants; raw provider errors can contain request data.
                logger.warning("[grid_series] provider fetch failed (%s): %s",
                               provider, type(error).__name__)

    task.add_done_callback(completed)
    return await asyncio.shield(task)

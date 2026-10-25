"""Periodic re-drive of due queued mail (low-priority notices wait on purpose; a restart can strand others).

One cheap indexed query every few minutes, and only when a provider is configured: with email disabled (the
default) the loop wakes, sees `configured` is False and goes back to sleep without touching the database.
"""
import asyncio
import logging
from typing import Awaitable, Callable, Optional

from .outbox import sweep_queued
from .senders import build_sender

logger = logging.getLogger(__name__)

SWEEP_INTERVAL_SECONDS = 300.0


async def sweep_forever(
    interval_seconds: float = SWEEP_INTERVAL_SECONDS,
    *,
    sweep: Callable[[], Awaitable[int]] = sweep_queued,
    sender_factory=build_sender,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    while True:
        await sleep(interval_seconds)
        try:
            if sender_factory().configured:
                await sweep()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # the loop must outlive one bad pass; log the class only, never a message
            logger.error("[email] sweep pass failed: %s", type(exc).__name__)


def start_sweeper() -> Optional["asyncio.Task"]:
    return asyncio.create_task(sweep_forever(), name="email-sweeper")

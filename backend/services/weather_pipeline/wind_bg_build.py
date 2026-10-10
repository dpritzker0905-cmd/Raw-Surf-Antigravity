"""Bounded wind background build (WIND_BG_BUILD_BOUNDED, default OFF; 2026-10-10).

⛔ WHAT THE FLAG REPLACES. For wind, `viewport_service.fetch_viewport_grid_upstream` fetches the whole forecast
(16 days, ~385 hourly steps) for every fresh snapped box, normalizes the one hour that was asked for, and hands the
rest to `viewport_helper.bg_process_remaining_hours_helper`. That task then normalizes, serialises and indexes EVERY
remaining hour, one at a time, with a full `gc.collect()` after each, in ONE slot per model/domain that the next
box cancels ("Canceling stale background task for gfs_wind", 5 times in 6 minutes on 2026-10-10 00:04Z).

Measured offline (tests/test_wind_bg_build_bounded.py, the real normalizer and bg helper behind a mock 16-day
upstream): one fresh box costs 385 hours, 391 full collections, 163 of the build's 173 CPU-seconds in
`gc.collect()` (0.42 s each, on the event-loop thread) and 3.4 s in the normalizer. So the cost per hour is the
collection, not the physics, and ~337 of the 385 hours were never asked for. A cold 48-frame page then needs
48 x ~0.45 s = ~22 s against GRID_SERIES_DEADLINE_S = 20 s, which is why its tail timed out by construction.

WITH THE FLAG ON (wind only; marine and the stored products never pass through here):
1. The hours that are WAITED FOR are built first, exactly as before.
2. Then a window of WIND_BG_WINDOW_H hours (default 6) either side of the fetch's own hour, so a scrub next to the
   viewed hour stays warm. Nothing else is built.
3. The task then lingers WIND_BG_LINGER_S seconds (default 3) for late waiters of the same page (a 48-frame page
   registers its hours a few at a time) and retires. Its context leaves IN_FLIGHT_REQUESTS exactly as it does today.
4. Between hours it runs a young-generation `gc.collect(1)`, not a full one; the final full collection stays.
5. A new box no longer cancels a task that still has a waiter, because cancelling it failed that waiter's hour and
   sent it down the self-heal path (a second 16-day fetch for the old box that cancelled the new box's task).
Hours that were not built still resolve on demand: the next request for one finds no file, becomes the fetcher
(a cache hit in the provider's 5-minute grid cache, else one upstream fetch) and builds it.

THE SERVED NUMBERS DO NOT MOVE: every hour that is built goes through the same normalizer call with the same
arguments (tests pin the vectors equal, flag on vs off). What changes is WHICH hours are built, WHEN, and what the
event loop pays for them. It ships off because it changes build behaviour and memory behaviour for every wind user;
only the owner flips it (D-001).
"""
import asyncio
import logging
import os
import time
from typing import Dict, Optional, Set

logger = logging.getLogger(__name__)

FLAG = "WIND_BG_BUILD_BOUNDED"
DEFAULT_WINDOW_H = 6
DEFAULT_LINGER_S = 3.0
POLL_S = 0.05


def wind_bg_bounded(domain: str) -> bool:
    """True when the bounded build applies: the flag is '1' (read at call time) and the domain is wind."""
    return domain.lower() == "wind" and os.environ.get(FLAG, "0") == "1"


def _env_number(name: str, default: float, cast=float, lo: float = 0.0) -> float:
    try:
        return max(lo, cast(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def window_hours() -> int:
    return int(_env_number("WIND_BG_WINDOW_H", DEFAULT_WINDOW_H, int))


def linger_seconds() -> float:
    return _env_number("WIND_BG_LINGER_S", DEFAULT_LINGER_S, float)


def window_indices(target_idx: int, n_times: int) -> Set[int]:
    """Indices into the upstream time array that are built without anyone waiting for them."""
    w = window_hours()
    return set(range(max(0, target_idx - w), min(n_times, target_idx + w + 1)))


def has_pending_waiter(context) -> bool:
    """True while some request is awaiting an hour of this context (a future nobody has resolved)."""
    return context is not None and any(not f.done() for f in list(context.hour_futures.values()))


class Linger:
    """Keeps a drained bg task alive for late waiters of the same page, then lets it retire.

    Only a context that is still the live IN_FLIGHT_REQUESTS entry can ever gain a waiter
    (`ViewportService._register_hour_waiter` refuses any other), so a context that was never registered —
    the native-recovery build — returns at once instead of holding its lane for nothing.
    """

    def __init__(self, service, request_dedup_key: str, context):
        self._service, self._key, self._context = service, request_dedup_key, context
        self._idle_since: Optional[float] = None

    def worked(self) -> None:
        self._idle_since = None

    async def wait(self) -> bool:
        """Sleep one poll and say whether to look for work again; False once the linger has run out."""
        if self._service.IN_FLIGHT_REQUESTS.get(self._key) is not self._context:
            return False
        now = time.monotonic()
        if self._idle_since is None:
            self._idle_since = now
        if now - self._idle_since >= linger_seconds():
            return False
        await asyncio.sleep(POLL_S)
        return True


def keeps_task(slots: Dict[str, object], contexts: Dict[str, object], bg_key: str) -> bool:
    """True when the task in `slots[bg_key]` is still running and has a waiter, so the next box must not cancel it.
    `contexts` holds weak references (the raw 16-day list must not outlive its task)."""
    task = slots.get(bg_key)
    ref = contexts.get(bg_key)
    return bool(task is not None and not task.done() and ref is not None and has_pending_waiter(ref()))

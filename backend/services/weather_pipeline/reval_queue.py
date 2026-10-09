"""The sharpen queue: who may start an SWR revalidation, and the one way to start it.

A revalidation is a background fine-viewport fetch (`viewport_service._revalidate_fetch`). Its key sits
in `ACTIVE_REVALIDATIONS` until that coroutine's `finally` discards it, and the capped sites count those
keys against MARINE_REVAL_QUEUE_MAX (default 2) so the 1-CPU box cannot OOM.

⛔ THE 2026-10-09 WEDGE (Render, after #271). grid_series handed every frame but a page's first a
throwaway starlette `BackgroundTasks()` "so we don't fan out N background fetches". It is truthy and
nothing ever runs it, so every site registered the key and queued the fetch on an object nobody
executes. The key was never discarded: two timeline-prefetch frames (+183 h and +192 h at a 1.2-degree
box) held both slots from 00:38:48Z, and the instance scheduled no sharpen afterwards. The hour the user
was viewing got the 2-degree clip and stayed on it. Pinned by tests/test_reval_viewed_hour_wins.py.

Two rules, both enforced here so no site can drift:
1. A key goes in only together with a task that will run. A series frame that must not revalidate
   says so (`SeriesFrame(warm=False)`) and registers nothing.
2. A timeline-prefetch frame never takes the last MARINE_REVAL_INTERACTIVE_RESERVE slots (default 1).
   Those stay for the hour being viewed, which arrives as a /grid request.
"""
import asyncio
import logging
import os

logger = logging.getLogger(__name__)


class SeriesFrame:
    """The `background_tasks` a grid_series frame passes to resolve_grid.

    `warm=True` marks the one frame per page that may warm its viewport (the first hour, see
    grid_series_helper._build_one). Every other frame must not revalidate at all. Deliberately has no
    `add_task`: a site that bypasses `schedule_revalidation` fails loudly instead of orphaning a key.
    """
    __slots__ = ("warm",)

    def __init__(self, warm: bool = False):
        self.warm = bool(warm)

    def __repr__(self):
        return f"SeriesFrame(warm={self.warm})"


def _interactive_reserve() -> int:
    try:
        return max(0, int(os.environ.get("MARINE_REVAL_INTERACTIVE_RESERVE", "1")))
    except ValueError:
        return 1


def schedule_revalidation(viewport_service, background_tasks, model, domain, layer, valid_time,
                          target_dt, bbox, reval_key, *, queue_max=None) -> bool:
    """Start `_revalidate_fetch` for `reval_key`, or leave the queue untouched.

    Returns True when a revalidation for this key is pending afterwards (started now, or already in
    flight), which is when a caller may label its product `swr_revalidation_pending`.

    `queue_max` bounds the OUTSTANDING keys at the capped sites (None: the uncapped Step 3.5/3.7
    previews). A series frame may only use the slots above the interactive reserve.
    `background_tasks`: a request's BackgroundTasks (/grid; it runs once the response is sent), a
    `SeriesFrame`, or None (start the task on the loop now).
    """
    active = viewport_service.ACTIVE_REVALIDATIONS
    if reval_key in active:
        return True
    prefetch = isinstance(background_tasks, SeriesFrame)
    if prefetch and not background_tasks.warm:
        return False
    if queue_max is not None:
        limit = queue_max - _interactive_reserve() if prefetch else queue_max
        if len(active) >= limit:
            if prefetch:
                logger.info(f"[Reval Queue] prefetch sharpen skipped, slot kept for the viewed hour: {reval_key}")
            return False
    active.add(reval_key)
    args = (model, domain, layer, valid_time, target_dt, bbox, reval_key)
    if background_tasks and not prefetch:
        background_tasks.add_task(viewport_service._revalidate_fetch, *args)
    else:
        asyncio.create_task(viewport_service._revalidate_fetch(*args))
    return True

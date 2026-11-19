"""Surf-truth export retention (owner's rule, 2026-11-18): daily, see services/surf_truth_retention.py."""
import logging

logger = logging.getLogger(__name__)


async def surf_truth_retention_task():
    """Keep the 3 newest exports; after an account deletion write a fresh export and delete the older ones."""
    from database import async_session_maker
    from services.surf_truth_retention import enforce
    try:
        async with async_session_maker() as db:
            summary = await enforce(db)
        logger.info("[Scheduler] surf-truth retention: kept %d, deleted %d run(s), fresh export %s",
                    len(summary["kept"]), summary["deleted_runs"], summary["fresh_export"] or "none")
    except Exception as e:  # never break the scheduler; the next daily run retries
        logger.warning("[Scheduler] surf-truth retention deferred: %s", e)

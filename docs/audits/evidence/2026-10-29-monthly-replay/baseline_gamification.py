"""Monthly leaderboard reset — runs 1st of each month at 00:05 UTC."""
import logging

logger = logging.getLogger(__name__)
async def monthly_leaderboard_reset_task():
    """
    Archive leaderboard data and reset for new month.
    Runs on the 1st of each month at 00:05 UTC.
    """
    from database import async_session_maker
    from routes.career_hub.leaderboard import monthly_leaderboard_reset
    
    logger.info("[Scheduler] Running monthly leaderboard reset...")
    
    try:
        async with async_session_maker() as db:
            result = await monthly_leaderboard_reset(db)
            logger.info(f"[Scheduler] Leaderboard reset complete: {result}")
    except Exception as e:
        logger.error(f"[Scheduler] Error in leaderboard reset: {str(e)}")


async def weekly_challenge_finalize_task():
    """Finalize the previous ISO week's challenge; failures reach tracked status."""
    from database import async_session_maker
    from routes.career_hub.challenges import finalize_weekly_challenge

    logger.info("[Scheduler] Finalizing the previous weekly challenge...")
    async with async_session_maker() as db:
        await finalize_weekly_challenge(db)
    logger.info("[Scheduler] Weekly challenge finalization complete")

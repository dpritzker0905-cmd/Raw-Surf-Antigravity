"""Story expiration cleanup — runs every hour."""
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
async def cleanup_expired_stories_task():
    """
    Mark expired stories as expired
    Triggered every hour
    """
    from database import async_session_maker
    from sqlalchemy import select
    from models import Story
    
    logger.info("[Scheduler] Running story cleanup...")
    
    try:
        async with async_session_maker() as db:
            now = datetime.now(timezone.utc)
            
            result = await db.execute(
                select(Story).where(
                    Story.expires_at <= now,
                    Story.is_expired == False
                )
            )
            expired_stories = result.scalars().all()
            
            for story in expired_stories:
                story.is_expired = True
            
            await db.commit()
            logger.info(f"[Scheduler] Cleaned up {len(expired_stories)} expired stories")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in story cleanup: {str(e)}")

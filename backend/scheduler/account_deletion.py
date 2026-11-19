"""Daily: erase the accounts whose 30-day restore window has ended (services/account_deletion)."""
import logging

logger = logging.getLogger(__name__)


async def purge_due_account_deletions_task():
    from database import async_session_maker
    from routes.compliance_pkg.gdpr import erase_account
    from services.account_deletion import purge_due
    async with async_session_maker() as db:
        done = await purge_due(db, erase_account)
    logger.info("[Scheduler] account deletions erased after their restore window: %d", done)
    from services.violation_retention import purge_expired_violations
    async with async_session_maker() as db:
        expired = await purge_expired_violations(db)
    logger.info("[Scheduler] violation rows past their retention deleted: %d", expired)

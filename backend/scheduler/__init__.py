"""
Scheduler package — centralized registry for all background tasks.
Re-exports scheduler instance and lifecycle functions for backward compatibility.
"""
import logging
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

from .base import scheduler, send_push_notification  # noqa: F401

# Import all task functions from domain modules
from .surf_alerts import check_surf_alerts_task
from .stories import cleanup_expired_stories_task
from .gamification import monthly_leaderboard_reset_task
from .grom import weekly_grom_report_task
from .bookings import (
    check_payment_window_expiry_task,
    send_payment_expiry_reminders_task,
    send_session_reminders_task,
    expire_booking_invites_task,
)
from .financial import (
    auto_release_escrow_task,
    send_weekly_sales_reports_task,
    cleanup_abandoned_stripe_sessions_task,
    check_credit_transaction_integrity_task,
)
from .metrics import aggregate_platform_metrics_task
from .gallery import process_selection_deadline_expiry_task
from .forecast import ingest_marine_forecast_task

logger = logging.getLogger(__name__)


def start_scheduler():
    """Start the background scheduler with all registered jobs."""

    # Surf alerts — every 15 minutes
    scheduler.add_job(
        check_surf_alerts_task, IntervalTrigger(minutes=15),
        id='check_surf_alerts', name='Check surf alerts against conditions',
        replace_existing=True
    )

    # Story cleanup — every hour
    scheduler.add_job(
        cleanup_expired_stories_task, IntervalTrigger(hours=1),
        id='cleanup_stories', name='Clean up expired stories',
        replace_existing=True
    )

    # Monthly leaderboard reset — 1st of each month at 00:05 UTC
    scheduler.add_job(
        monthly_leaderboard_reset_task, CronTrigger(day=1, hour=0, minute=5),
        id='monthly_leaderboard_reset', name='Monthly leaderboard reset and archive',
        replace_existing=True
    )

    # Weekly Grom report — Sunday 9am EST (14:00 UTC)
    scheduler.add_job(
        weekly_grom_report_task, CronTrigger(day_of_week='sun', hour=14, minute=0),
        id='weekly_grom_report', name='Weekly Grom activity report to parents',
        replace_existing=True
    )

    # Payment window expiry — every 5 minutes
    scheduler.add_job(
        check_payment_window_expiry_task, IntervalTrigger(minutes=5),
        id='check_payment_expiry', name='Check crew payment window expiry',
        replace_existing=True
    )

    # Payment expiry reminders — every 5 minutes
    scheduler.add_job(
        send_payment_expiry_reminders_task, IntervalTrigger(minutes=5),
        id='payment_expiry_reminders', name='Send payment expiry reminders',
        replace_existing=True
    )

    # Platform metrics — every 6 hours
    scheduler.add_job(
        aggregate_platform_metrics_task, IntervalTrigger(hours=6),
        id='platform_metrics_aggregation', name='Aggregate platform metrics for admin dashboard',
        replace_existing=True
    )

    # Session reminders — every 5 minutes
    scheduler.add_job(
        send_session_reminders_task, IntervalTrigger(minutes=5),
        id='session_reminders', name='Send session reminder notifications',
        replace_existing=True
    )

    # Auto-release escrow — daily 3am UTC
    scheduler.add_job(
        auto_release_escrow_task, CronTrigger(hour=3, minute=0),
        id='auto_escrow_release', name='Auto-release escrow 7 days after session',
        replace_existing=True
    )

    # Selection deadline expiry — daily 4am UTC
    scheduler.add_job(
        process_selection_deadline_expiry_task, CronTrigger(hour=4, minute=0),
        id='selection_deadline_expiry', name='Process expired surfer selection deadlines',
        replace_existing=True
    )

    # Weekly sales reports — Monday 9am UTC
    scheduler.add_job(
        send_weekly_sales_reports_task, CronTrigger(day_of_week='mon', hour=9, minute=0),
        id='weekly_sales_reports', name='Send weekly sales reports to photographers',
        replace_existing=True
    )

    # Expire booking invites — every 5 minutes
    scheduler.add_job(
        expire_booking_invites_task, IntervalTrigger(minutes=5),
        id='expire_booking_invites', name='Expire pending booking invites after 24 hours',
        replace_existing=True
    )

    # Cleanup abandoned Stripe sessions — every 30 minutes
    scheduler.add_job(
        cleanup_abandoned_stripe_sessions_task, IntervalTrigger(minutes=30),
        id='cleanup_stripe_sessions', name='Cleanup abandoned Stripe checkout sessions older than 30 min',
        replace_existing=True
    )

    # Credit transaction integrity — daily 5am UTC
    scheduler.add_job(
        check_credit_transaction_integrity_task, CronTrigger(hour=5, minute=0),
        id='credit_integrity_check', name='Check credit transactions for orphaned references',
        replace_existing=True
    )

    # Global Forecast Ingestion Pipeline — Every 3 hours
    scheduler.add_job(
        ingest_marine_forecast_task, IntervalTrigger(hours=3),
        id='ingest_marine_forecast', name='Ingest global marine and wind forecast data',
        replace_existing=True
    )

    # Rate limiter memory cleanup — every hour
    def _cleanup_rate_limiter():
        try:
            from core.rate_limiter import cleanup_old_entries
            removed = cleanup_old_entries()
            if removed > 0:
                logger.debug(f"[Scheduler] Rate limiter cleanup: removed {removed} stale entries")
        except Exception as e:
            logger.warning(f"[Scheduler] Rate limiter cleanup failed: {e}")

    scheduler.add_job(
        _cleanup_rate_limiter, IntervalTrigger(hours=1),
        id='rate_limiter_cleanup', name='Cleanup stale rate limiter entries',
        replace_existing=True
    )

    scheduler.start()
    logger.info("[Scheduler] Background scheduler started")
    logger.info("[Scheduler] Jobs: surf_alerts (15min), story_cleanup (1hr), leaderboard_reset (monthly), "
                "grom_report (weekly), payment_expiry (5min), platform_metrics (6hr), session_reminders (5min), "
                "auto_escrow_release (daily 3am), selection_deadline_expiry (daily 4am), weekly_sales_reports "
                "(Monday 9am), expire_booking_invites (5min), cleanup_stripe_sessions (30min), "
                "credit_integrity_check (daily 5am), rate_limiter_cleanup (1hr)")


def stop_scheduler():
    """Stop the background scheduler."""
    if scheduler.running:
        scheduler.shutdown()
        logger.info("[Scheduler] Background scheduler stopped")

"""
Scheduler package — centralized registry for all background tasks.
Re-exports scheduler instance and lifecycle functions for backward compatibility.
"""
import logging
import os
from datetime import datetime, timezone, timedelta
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

from .base import scheduler, send_push_notification, tracked  # noqa: F401

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
    cleanup_expired_booking_payments_task,
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
        tracked('check_surf_alerts', 'Check surf alerts against conditions', 'Every 15 minutes', check_surf_alerts_task),
        IntervalTrigger(minutes=15),
        id='check_surf_alerts', name='Check surf alerts against conditions',
        replace_existing=True
    )

    # Story cleanup — every hour
    scheduler.add_job(
        tracked('cleanup_stories', 'Clean up expired stories', 'Every 1 hour', cleanup_expired_stories_task),
        IntervalTrigger(hours=1),
        id='cleanup_stories', name='Clean up expired stories',
        replace_existing=True
    )

    # Monthly leaderboard reset — 1st of each month at 00:05 UTC
    scheduler.add_job(
        tracked('monthly_leaderboard_reset', 'Monthly leaderboard reset and archive', 'Monthly (1st, 00:05 UTC)', monthly_leaderboard_reset_task),
        CronTrigger(day=1, hour=0, minute=5),
        id='monthly_leaderboard_reset', name='Monthly leaderboard reset and archive',
        replace_existing=True
    )

    # Weekly Grom report — Sunday 9am EST (14:00 UTC)
    scheduler.add_job(
        tracked('weekly_grom_report', 'Weekly Grom activity report to parents', 'Weekly (Sun 14:00 UTC)', weekly_grom_report_task),
        CronTrigger(day_of_week='sun', hour=14, minute=0),
        id='weekly_grom_report', name='Weekly Grom activity report to parents',
        replace_existing=True
    )

    # Payment window expiry — every 5 minutes
    scheduler.add_job(
        tracked('check_payment_expiry', 'Check crew payment window expiry', 'Every 5 minutes', check_payment_window_expiry_task),
        IntervalTrigger(minutes=5),
        id='check_payment_expiry', name='Check crew payment window expiry',
        replace_existing=True
    )

    # Payment expiry reminders — every 5 minutes
    scheduler.add_job(
        tracked('payment_expiry_reminders', 'Send payment expiry reminders', 'Every 5 minutes', send_payment_expiry_reminders_task),
        IntervalTrigger(minutes=5),
        id='payment_expiry_reminders', name='Send payment expiry reminders',
        replace_existing=True
    )

    # Platform metrics — every 6 hours
    scheduler.add_job(
        tracked('platform_metrics_aggregation', 'Aggregate platform metrics for admin dashboard', 'Every 6 hours', aggregate_platform_metrics_task),
        IntervalTrigger(hours=6),
        id='platform_metrics_aggregation', name='Aggregate platform metrics for admin dashboard',
        replace_existing=True
    )

    # Session reminders — every 5 minutes
    scheduler.add_job(
        tracked('session_reminders', 'Send session reminder notifications', 'Every 5 minutes', send_session_reminders_task),
        IntervalTrigger(minutes=5),
        id='session_reminders', name='Send session reminder notifications',
        replace_existing=True
    )

    # Auto-release escrow — daily 3am UTC
    scheduler.add_job(
        tracked('auto_escrow_release', 'Auto-release escrow 7 days after session', 'Daily 3am UTC', auto_release_escrow_task),
        CronTrigger(hour=3, minute=0),
        id='auto_escrow_release', name='Auto-release escrow 7 days after session',
        replace_existing=True
    )

    # Selection deadline expiry — daily 4am UTC
    scheduler.add_job(
        tracked('selection_deadline_expiry', 'Process expired surfer selection deadlines', 'Daily 4am UTC', process_selection_deadline_expiry_task),
        CronTrigger(hour=4, minute=0),
        id='selection_deadline_expiry', name='Process expired surfer selection deadlines',
        replace_existing=True
    )

    # Weekly sales reports — Monday 9am UTC
    scheduler.add_job(
        tracked('weekly_sales_reports', 'Send weekly sales reports to photographers', 'Weekly (Mon 9am UTC)', send_weekly_sales_reports_task),
        CronTrigger(day_of_week='mon', hour=9, minute=0),
        id='weekly_sales_reports', name='Send weekly sales reports to photographers',
        replace_existing=True
    )

    # Expire booking invites — every 5 minutes
    scheduler.add_job(
        tracked('expire_booking_invites', 'Expire pending booking invites after 24 hours', 'Every 5 minutes', expire_booking_invites_task),
        IntervalTrigger(minutes=5),
        id='expire_booking_invites', name='Expire pending booking invites after 24 hours',
        replace_existing=True
    )

    # Cleanup abandoned Stripe sessions — every 30 minutes
    scheduler.add_job(
        tracked('cleanup_stripe_sessions', 'Cleanup abandoned Stripe checkout sessions older than 30 min', 'Every 30 minutes', cleanup_abandoned_stripe_sessions_task),
        IntervalTrigger(minutes=30),
        id='cleanup_stripe_sessions', name='Cleanup abandoned Stripe checkout sessions older than 30 min',
        replace_existing=True
    )

    # Cleanup expired booking payments — every 10 minutes
    scheduler.add_job(
        tracked('cleanup_expired_booking_payments', 'Decline bookings with expired payment session and refund credits', 'Every 10 minutes', cleanup_expired_booking_payments_task),
        IntervalTrigger(minutes=10),
        id='cleanup_expired_booking_payments', name='Decline bookings with expired payment session and refund credits',
        replace_existing=True
    )

    # Credit transaction integrity — daily 5am UTC
    scheduler.add_job(
        tracked('credit_integrity_check', 'Check credit transactions for orphaned references', 'Daily 5am UTC', check_credit_transaction_integrity_task),
        CronTrigger(hour=5, minute=0),
        id='credit_integrity_check', name='Check credit transactions for orphaned references',
        replace_existing=True
    )

    # Global Forecast Ingestion Pipeline — every 4 hours, AND ~2 min after startup. IntervalTrigger's
    # first fire is now+interval, so on a box that restarts more often than the interval (frequent
    # deploys) the ingestion would NEVER run and forecast data goes stale (observed: wind global 14h+
    # stale). The startup run guarantees fresh data after each deploy. Tunable via
    # FORECAST_STARTUP_DELAY_SEC (default 120; set <=0 to keep interval-only).
    # DECOUPLING CUTOVER SWITCH: set DISABLE_FORECAST_SCHEDULER=1 on the Render web box to make it
    # SERVE-ONLY — the heavy GRIB-decode ingestion then runs in the GitHub Action
    # (.github/workflows/forecast-ingest.yml) and lands in Supabase L2; Render restores from L2. This
    # is the "strengthen the spine" move (ingestion compute no longer contends with request serving on
    # the 1-CPU box). Default OFF = unchanged in-process ingestion. See
    # docs/runbooks/decouple-ingestion-github-action.md for the verify->cutover sequence.
    if os.environ.get("DISABLE_FORECAST_SCHEDULER", "").lower() in ("1", "true", "yes"):
        logger.info("[Scheduler] DISABLE_FORECAST_SCHEDULER set — skipping in-process forecast ingestion "
                    "(decoupled to the GitHub Action; this box is serve-only).")
        # Serve-only must see the Action's fresh ingestions WITHOUT a restart. The box otherwise restores
        # from L2 only on startup (server.py lifespan) + on a local manifest parse-failure fallback, so a
        # periodic re-pull of the L2 manifest is required for continuous decoupled operation. Gated to
        # serve-only ONLY — it never runs while this box ingests locally (which would clobber fresh local
        # data with L2). restore_from_supabase is manifest-only (product grids stay lazy via load_product),
        # so the pull is manifest-only -- but NOT light: the live manifest measured 12.2 MB compact /
        # 16.1 MB uploaded (2026-08-09; the '~2.5MB' this comment used to claim was 6.5x stale) and it
        # is downloaded through a per-socket-read timeout, so a drip-fed body can stall for many
        # minutes. SAFE ONLY BECAUSE the tracked() dispatcher runs sync jobs via asyncio.to_thread
        # (scheduler/base.py -- the line that caused both 08-09 outages when it was inline).
        # Interval tunable via L2_RESTORE_INTERVAL_MIN (default 30, floor 5).
        def _periodic_l2_restore():
            try:
                from services.weather_pipeline.store import ProductStore
                restored, errors = ProductStore().restore_from_supabase()
                logger.info(f"[Scheduler] Periodic L2 restore: {restored} products available"
                            + (f"; errors={errors[:2]}" if errors else ""))
            except Exception as e:
                logger.error(f"[Scheduler] Periodic L2 restore failed: {e}", exc_info=True)
        _restore_min = max(5, int(os.environ.get("L2_RESTORE_INTERVAL_MIN", "30")))
        scheduler.add_job(
            tracked('periodic_l2_restore', 'Periodic L2 manifest restore (serve-only)', f'Every {_restore_min} minutes', _periodic_l2_restore),
            IntervalTrigger(minutes=_restore_min),
            id='periodic_l2_restore', name='Periodic L2 manifest restore (serve-only)',
            replace_existing=True,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=90),
        )
        logger.info(f"[Scheduler] Serve-only: periodic L2 restore every {_restore_min} min enabled.")
    else:
        # DESIGNATED-WRITER visibility (audit #28): in-process ingestion on a box without L2_WRITER=1
        # persists LOCALLY ONLY — the store gate silently skips every manifest/product upload+delete.
        # That is the correct behavior for local dev (a 14h rogue local backend clobbered prod L2 on
        # pre-gate code), but say it LOUDLY so nobody debugs "ingestion ran, prod didn't update".
        if os.environ.get("L2_WRITER", "") != "1":
            logger.warning("[Scheduler] In-process forecast ingestion is scheduled but this box is NOT "
                           "the designated L2 writer (L2_WRITER!=1) — ingested products/manifest will "
                           "persist to the LOCAL store only. Set L2_WRITER=1 only if this box is "
                           "intentionally the production ingester (audit #28 gate).")
        _forecast_kwargs = {}
        _startup_delay = int(os.environ.get("FORECAST_STARTUP_DELAY_SEC", "120"))
        if _startup_delay > 0:
            _forecast_kwargs["next_run_time"] = datetime.now(timezone.utc) + timedelta(seconds=_startup_delay)
        scheduler.add_job(
            tracked('ingest_marine_forecast', 'Ingest global marine and wind forecast data', 'Every 4 hours', ingest_marine_forecast_task),
            IntervalTrigger(hours=4),
            id='ingest_marine_forecast', name='Ingest global marine and wind forecast data',
            replace_existing=True, **_forecast_kwargs
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
        tracked('rate_limiter_cleanup', 'Cleanup stale rate limiter entries', 'Every 1 hour', _cleanup_rate_limiter),
        IntervalTrigger(hours=1),
        id='rate_limiter_cleanup', name='Cleanup stale rate limiter entries',
        replace_existing=True
    )

    scheduler.start()
    logger.info("[Scheduler] Background scheduler started")
    logger.info("[Scheduler] Jobs: surf_alerts (15min), story_cleanup (1hr), leaderboard_reset (monthly), "
                "grom_report (weekly), payment_expiry (5min), platform_metrics (6hr), session_reminders (5min), "
                "auto_escrow_release (daily 3am), selection_deadline_expiry (daily 4am), weekly_sales_reports "
                "(Monday 9am), expire_booking_invites (5min), cleanup_stripe_sessions (30min), "
                "cleanup_expired_booking_payments (10min), credit_integrity_check (daily 5am), rate_limiter_cleanup (1hr)")


def stop_scheduler():
    """Stop the background scheduler."""
    if scheduler.running:
        scheduler.shutdown()
        logger.info("[Scheduler] Background scheduler stopped")

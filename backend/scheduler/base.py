"""
Base scheduler module — shared scheduler instance and push notification helper.
"""
import asyncio
import logging
import json
import os
import time as _time
from datetime import datetime, timezone
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)

# VAPID keys for push notifications
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', 'your-private-key')
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U')
VAPID_CLAIMS = {"sub": "mailto:alerts@rawsurfos.com"}

# Initialize scheduler — singleton used by all task modules
scheduler = AsyncIOScheduler()


async def _run_tracked_job(job_id: str, description: str, schedule_label: str, coro_func):
    """
    Runs a scheduled job with REAL execution tracking against ScheduledJobStatus (admin
    Jobs tab) instead of leaving it permanently blank, and REAL respect for the admin's
    enable/disable toggle (previously persisted to the DB but never checked by anything).
    """
    from database import async_session_maker
    from sqlalchemy import select
    from models import ScheduledJobStatus

    async with async_session_maker() as db:
        result = await db.execute(select(ScheduledJobStatus).where(ScheduledJobStatus.job_name == job_id))
        job_status = result.scalar_one_or_none()
        if not job_status:
            job_status = ScheduledJobStatus(
                job_name=job_id, job_description=description, schedule=schedule_label,
                last_run_status="unknown"
            )
            db.add(job_status)
            await db.commit()
            await db.refresh(job_status)
        is_enabled = job_status.is_enabled

    if not is_enabled:
        logger.info(f"[Scheduler] Job '{job_id}' is disabled via the admin Jobs tab — skipping this run.")
        return

    start = _time.monotonic()
    status = "success"
    error_message = None
    try:
        if asyncio.iscoroutinefunction(coro_func):
            await coro_func()
        else:
            # ⛔⛔ NEVER INLINE — THIS LINE CAUSED BOTH 2026-08-09 PRODUCTION OUTAGES. `tracked()`
            # wraps every job as a coroutine, so APScheduler's own sync-job thread-pool dispatch
            # never fires and a sync job's blocking work ran ON the serve box's event loop. The
            # 30-min L2 manifest restore (a sync def; a 12-16 MB Supabase read whose requests
            # timeout is per-socket-READ, so a drip-fed body can hold it for ~20 min) blocked the
            # loop at 05:25+90s-schedule and 13:48+schedule — the box went connection-level dark
            # (HTTP 000 on every endpoint) for ~20 min each time and self-recovered when the read
            # ended. Deploy-ledger + boot-time arithmetic pinned it (MASTER-AUDIT-11.0 §3.2 had
            # priced this exact line P0 and it shipped only after the outages proved it).
            # A worker thread also has no running loop, so a sync job that internally calls
            # `run_until_complete` (the in-process ingest fallback) becomes legal again.
            await asyncio.to_thread(coro_func)
    except Exception as e:
        status = "failed"
        error_message = str(e)
        logger.error(f"[Scheduler] Job '{job_id}' failed: {e}", exc_info=True)
    duration_ms = int((_time.monotonic() - start) * 1000)

    async with async_session_maker() as db:
        result = await db.execute(select(ScheduledJobStatus).where(ScheduledJobStatus.job_name == job_id))
        job_status = result.scalar_one_or_none()
        if job_status:
            job_status.last_run_at = datetime.now(timezone.utc)
            job_status.last_run_duration_ms = duration_ms
            job_status.last_run_status = status
            job_status.last_run_error = error_message
            job_status.total_runs = (job_status.total_runs or 0) + 1
            if status == "success":
                job_status.success_count = (job_status.success_count or 0) + 1
            else:
                job_status.failure_count = (job_status.failure_count or 0) + 1
            job_status.updated_at = datetime.now(timezone.utc)
            try:
                scheduled_job = scheduler.get_job(job_id)
                if scheduled_job and scheduled_job.next_run_time:
                    job_status.next_run_at = scheduled_job.next_run_time
            except Exception:
                pass
            await db.commit()


def tracked(job_id: str, description: str, schedule_label: str, coro_func):
    """
    Wrap a scheduler task coroutine function for real execution tracking + the enable/
    disable gate. Use as the callable passed to scheduler.add_job(...).
    """
    async def _wrapped():
        await _run_tracked_job(job_id, description, schedule_label, coro_func)
    _wrapped.__name__ = f"tracked_{job_id}"
    return _wrapped


async def send_push_notification(db, user_id: str, title: str, body: str, data: dict = None):
    """Send push notification to a user's subscribed devices"""
    from sqlalchemy import select
    from models import PushSubscription

    try:
        from pywebpush import webpush, WebPushException

        result = await db.execute(
            select(PushSubscription)
            .where(PushSubscription.user_id == user_id)
            .where(PushSubscription.is_active == True)
        )
        subscriptions = result.scalars().all()

        payload = json.dumps({
            "title": title,
            "body": body,
            "icon": "/logo.svg",
            "badge": "/logo.svg",
            "data": data or {},
            "tag": "surf-alert",
            "requireInteraction": True
        })

        for sub in subscriptions:
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {
                            "p256dh": sub.p256dh_key,
                            "auth": sub.auth_key
                        }
                    },
                    data=payload,
                    vapid_private_key=VAPID_PRIVATE_KEY,
                    vapid_claims=VAPID_CLAIMS
                )
                logger.info(f"[Push] Sent notification to user {user_id}")
            except WebPushException as e:
                if e.response and e.response.status_code == 410:
                    # Subscription expired, mark as inactive
                    sub.is_active = False
                    logger.info(f"[Push] Subscription expired for user {user_id}")
                else:
                    logger.error(f"[Push] Error sending to user {user_id}: {str(e)}")

    except ImportError:
        logger.warning("[Push] pywebpush not installed, skipping push notification")
    except Exception as e:
        logger.error(f"[Push] Error: {str(e)}")

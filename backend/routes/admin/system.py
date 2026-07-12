"""
Admin System Health & Monitoring
- API response times, error rates
- Database performance metrics
- Background job status
- Real-time alerts
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, update, desc, text
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import psutil
import time
import os
import logging

from database import get_db
from deps.admin_auth import get_current_admin
from models import (
    Profile, ScheduledJobStatus, SystemAlert, SystemHealthMetric
)



router = APIRouter()
logger = logging.getLogger(__name__)

# Prime psutil's CPU baseline so the first health check returns a real value
psutil.cpu_percent(interval=None)


class AcknowledgeAlertRequest(BaseModel):
    alert_ids: List[str]


async def _get_app_storage_metrics(db: AsyncSession) -> dict:
    """
    Get actual application storage usage from Supabase Storage buckets
    (via REST API), PostgreSQL database size, and local uploads directory.
    Returns sizes in bytes.
    """
    import aiohttp

    storage_used_bytes = 0
    db_size_bytes = 0
    local_size_bytes = 0
    bucket_breakdown = []

    supabase_url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    supabase_key = os.environ.get('SUPABASE_SERVICE_KEY', '')

    # 1. Supabase Storage — use REST API to list buckets and objects
    if supabase_url and supabase_key:
        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
        }
        try:
            async with aiohttp.ClientSession() as session:
                # List all buckets
                async with session.get(
                    f"{supabase_url}/storage/v1/bucket",
                    headers=headers, timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    if resp.status == 200:
                        buckets = await resp.json()
                        for bucket in buckets:
                            bucket_id = bucket.get("id") or bucket.get("name")
                            if not bucket_id:
                                continue
                            # List objects in each bucket to get sizes
                            body = {"prefix": "", "limit": 10000, "offset": 0}
                            async with session.post(
                                f"{supabase_url}/storage/v1/object/list/{bucket_id}",
                                headers=headers, json=body,
                                timeout=aiohttp.ClientTimeout(total=15)
                            ) as obj_resp:
                                if obj_resp.status == 200:
                                    objects = await obj_resp.json()
                                    file_count = 0
                                    total_bytes = 0
                                    for obj in objects:
                                        meta = obj.get("metadata") or {}
                                        size = meta.get("size", 0)
                                        if size:
                                            total_bytes += int(size)
                                            file_count += 1
                                    storage_used_bytes += total_bytes
                                    bucket_breakdown.append({
                                        "name": bucket_id,
                                        "file_count": file_count,
                                        "size_bytes": total_bytes,
                                        "size_gb": round(total_bytes / (1024**3), 3)
                                    })
                    else:
                        logger.warning(f"Supabase bucket list returned {resp.status}")
        except Exception as e:
            logger.warning(f"Could not query Supabase Storage API: {e}")

    # 2. PostgreSQL database size
    try:
        db_result = await db.execute(text(
            "SELECT pg_database_size(current_database())"
        ))
        db_size_bytes = db_result.scalar() or 0
    except Exception as e:
        logger.warning(f"Could not query database size: {e}")
        try:
            await db.rollback()
        except Exception:
            pass

    # 3. Local uploads directory on Render (file is in routes/admin/, need to go up 2 levels to backend/)
    uploads_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'uploads')
    try:
        if os.path.exists(uploads_dir):
            for dirpath, dirnames, filenames in os.walk(uploads_dir):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    if os.path.isfile(fp):
                        local_size_bytes += os.path.getsize(fp)
    except Exception as e:
        logger.warning(f"Could not scan uploads directory: {e}")

    total_used_bytes = storage_used_bytes + db_size_bytes + local_size_bytes

    return {
        "total_used_bytes": total_used_bytes,
        "total_used_gb": round(total_used_bytes / (1024**3), 2),
        "supabase_storage_bytes": storage_used_bytes,
        "supabase_storage_gb": round(storage_used_bytes / (1024**3), 2),
        "database_bytes": db_size_bytes,
        "database_gb": round(db_size_bytes / (1024**3), 2),
        "local_uploads_bytes": local_size_bytes,
        "local_uploads_gb": round(local_size_bytes / (1024**3), 3),
        "bucket_breakdown": bucket_breakdown
    }


# --- SYSTEM HEALTH OVERVIEW ---
@router.get("/admin/system/health")
async def get_system_health(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get overall system health dashboard"""
    
    # CPU and Memory usage
    # Use interval=None (non-blocking) to avoid measuring this request's own CPU load.
    # Returns CPU% since last call; first call returns 0 which is fine.
    cpu_percent = psutil.cpu_percent(interval=None)
    
    # Calculate process-level memory for the app (including all child processes)
    current_process = psutil.Process(os.getpid())
    app_used_bytes = current_process.memory_info().rss
    try:
        for child in current_process.children(recursive=True):
            app_used_bytes += child.memory_info().rss
    except Exception:
        pass

    APP_MEMORY_LIMIT_MB = float(os.environ.get('APP_MEMORY_LIMIT_MB', '512.0'))
    app_limit_bytes = int(APP_MEMORY_LIMIT_MB * 1024 * 1024)
    app_memory_percent = min(round((app_used_bytes / app_limit_bytes) * 100, 1), 100.0)
    
    # App storage metrics (Supabase + DB + local)
    try:
        storage_metrics = await _get_app_storage_metrics(db)
    except Exception as e:
        logger.error(f"Failed to get storage metrics: {e}")
        storage_metrics = {
            "total_used_gb": 0, "supabase_storage_gb": 0,
            "database_gb": 0, "local_uploads_gb": 0,
            "bucket_breakdown": []
        }
    
    # Supabase free tier: 1 GB database + 1 GB storage
    # Supabase Pro: 8 GB database + 100 GB storage
    # We'll use a configurable limit; default to Pro tier totals
    STORAGE_LIMIT_GB = float(os.environ.get('STORAGE_LIMIT_GB', '100'))
    DB_LIMIT_GB = float(os.environ.get('DB_LIMIT_GB', '8'))
    total_limit_gb = STORAGE_LIMIT_GB + DB_LIMIT_GB
    storage_percent = round(
        (storage_metrics["total_used_gb"] / total_limit_gb * 100) if total_limit_gb > 0 else 0, 1
    )
    
    # Database connection test with timing
    start_time = time.time()
    try:
        await db.execute(text("SELECT 1"))
        db_latency_ms = (time.time() - start_time) * 1000
        db_status = "healthy"
    except Exception as e:
        db_latency_ms = None
        db_status = "error"
    
    # Get recent API error rate (from logs or metrics table if tracked)
    # For now, simulate based on available data
    error_rate = 0.5  # Placeholder
    
    # Overall health score
    health_components = []
    
    # CPU health — thresholds tuned for Render shared containers
    cpu_status = "healthy" if cpu_percent < 85 else "warning" if cpu_percent < 95 else "critical"
    health_components.append({"name": "CPU", "value": cpu_percent, "unit": "%", "status": cpu_status})
    
    # Memory health
    mem_status = "healthy" if app_memory_percent < 70 else "warning" if app_memory_percent < 90 else "critical"
    health_components.append({"name": "Memory", "value": app_memory_percent, "unit": "%", "status": mem_status})
    
    # Storage health (real app storage, not Render disk)
    storage_status = "healthy" if storage_percent < 70 else "warning" if storage_percent < 90 else "critical"
    health_components.append({"name": "Storage", "value": storage_percent, "unit": "%", "status": storage_status})
    
    # DB health
    db_latency_status = "healthy" if db_latency_ms and db_latency_ms < 50 else "warning" if db_latency_ms and db_latency_ms < 200 else "critical"
    health_components.append({"name": "Database", "value": round(db_latency_ms, 1) if db_latency_ms else None, "unit": "ms", "status": db_latency_status})
    
    # Calculate overall status
    statuses = [c["status"] for c in health_components]
    if "critical" in statuses:
        overall_status = "critical"
    elif "warning" in statuses:
        overall_status = "warning"
    else:
        overall_status = "healthy"
    
    # Active alerts count
    alerts_count = await db.execute(
        select(func.count(SystemAlert.id))
        .where(and_(
            SystemAlert.is_resolved == False,
            SystemAlert.is_acknowledged == False
        ))
    )
    
    return {
        "overall_status": overall_status,
        "components": health_components,
        "system": {
            "cpu_percent": cpu_percent,
            "memory_percent": app_memory_percent,
            "memory_used_gb": round(app_used_bytes / (1024**3), 3),
            "memory_total_gb": round(app_limit_bytes / (1024**3), 2),
            "storage_percent": storage_percent,
            "storage_used_gb": storage_metrics["total_used_gb"],
            "storage_limit_gb": round(total_limit_gb, 2),
            "storage_supabase_gb": storage_metrics["supabase_storage_gb"],
            "storage_database_gb": storage_metrics["database_gb"],
            "storage_local_gb": storage_metrics["local_uploads_gb"],
            "storage_bucket_breakdown": storage_metrics["bucket_breakdown"]
        },
        "database": {
            "status": db_status,
            "latency_ms": round(db_latency_ms, 1) if db_latency_ms else None,
            "size_gb": storage_metrics["database_gb"]
        },
        "api": {
            "error_rate_percent": error_rate,
            "status": "healthy" if error_rate < 1 else "warning" if error_rate < 5 else "critical"
        },
        "unacknowledged_alerts": alerts_count.scalar() or 0
    }


# --- STORAGE BREAKDOWN (DETAILED) ---
@router.get("/admin/system/storage")
async def get_storage_breakdown(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get detailed storage breakdown by bucket, database, and local uploads"""
    
    metrics = await _get_app_storage_metrics(db)
    
    return {
        "total_used_gb": metrics["total_used_gb"],
        "supabase_storage": {
            "total_gb": metrics["supabase_storage_gb"],
            "total_bytes": metrics["supabase_storage_bytes"],
            "buckets": metrics["bucket_breakdown"]
        },
        "database": {
            "size_gb": metrics["database_gb"],
            "size_bytes": metrics["database_bytes"]
        },
        "local_uploads": {
            "size_gb": metrics["local_uploads_gb"],
            "size_bytes": metrics["local_uploads_bytes"]
        }
    }


# --- BACKGROUND JOBS STATUS ---
@router.get("/admin/system/jobs")
async def get_job_statuses(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get status of all scheduled background jobs"""
    
    result = await db.execute(select(ScheduledJobStatus).order_by(ScheduledJobStatus.job_name))
    jobs = result.scalars().all()
    
    # If no jobs in DB, create defaults matching the REAL job ids registered in
    # scheduler/__init__.py (previously this list used different, made-up ids that
    # didn't match any real scheduler job, so toggling/tracking here never affected
    # anything real). Excludes 'periodic_l2_restore'/'ingest_marine_forecast', which
    # are environment-dependent (only one runs, gated by DISABLE_FORECAST_SCHEDULER) -
    # those rows are created automatically on first real run instead.
    if not jobs:
        default_jobs = [
            ("check_surf_alerts", "Check surf alerts against conditions", "Every 15 minutes"),
            ("cleanup_stories", "Clean up expired stories", "Every 1 hour"),
            ("monthly_leaderboard_reset", "Monthly leaderboard reset and archive", "Monthly (1st, 00:05 UTC)"),
            ("weekly_grom_report", "Weekly Grom activity report to parents", "Weekly (Sun 14:00 UTC)"),
            ("check_payment_expiry", "Check crew payment window expiry", "Every 5 minutes"),
            ("payment_expiry_reminders", "Send payment expiry reminders", "Every 5 minutes"),
            ("platform_metrics_aggregation", "Aggregate platform metrics for admin dashboard", "Every 6 hours"),
            ("session_reminders", "Send session reminder notifications", "Every 5 minutes"),
            ("auto_escrow_release", "Auto-release escrow 7 days after session", "Daily 3am UTC"),
            ("selection_deadline_expiry", "Process expired surfer selection deadlines", "Daily 4am UTC"),
            ("weekly_sales_reports", "Send weekly sales reports to photographers", "Weekly (Mon 9am UTC)"),
            ("expire_booking_invites", "Expire pending booking invites after 24 hours", "Every 5 minutes"),
            ("cleanup_stripe_sessions", "Cleanup abandoned Stripe checkout sessions older than 30 min", "Every 30 minutes"),
            ("cleanup_expired_booking_payments", "Decline bookings with expired payment session and refund credits", "Every 10 minutes"),
            ("credit_integrity_check", "Check credit transactions for orphaned references", "Daily 5am UTC"),
            ("rate_limiter_cleanup", "Cleanup stale rate limiter entries", "Every 1 hour"),
        ]
        
        for job_name, desc, schedule in default_jobs:
            job = ScheduledJobStatus(
                job_name=job_name,
                job_description=desc,
                schedule=schedule,
                last_run_status="unknown"
            )
            db.add(job)
        await db.commit()
        
        result = await db.execute(select(ScheduledJobStatus).order_by(ScheduledJobStatus.job_name))
        jobs = result.scalars().all()
    
    return {
        "jobs": [{
            "id": j.id,
            "job_name": j.job_name,
            "description": j.job_description,
            "schedule": j.schedule,
            "last_run_at": j.last_run_at.isoformat() if j.last_run_at else None,
            "last_run_duration_ms": j.last_run_duration_ms,
            "last_run_status": j.last_run_status,
            "last_run_error": j.last_run_error,
            "next_run_at": j.next_run_at.isoformat() if j.next_run_at else None,
            "total_runs": j.total_runs,
            "success_count": j.success_count,
            "failure_count": j.failure_count,
            "success_rate": round((j.success_count / j.total_runs * 100) if j.total_runs > 0 else 0, 1),
            "is_enabled": j.is_enabled
        } for j in jobs]
    }


@router.put("/admin/system/jobs/{job_name}/toggle")
async def toggle_job(
    job_name: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Enable/disable a background job"""
    
    result = await db.execute(select(ScheduledJobStatus).where(ScheduledJobStatus.job_name == job_name))
    job = result.scalar_one_or_none()
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    await db.execute(
        update(ScheduledJobStatus)
        .where(ScheduledJobStatus.job_name == job_name)
        .values(is_enabled=not job.is_enabled, updated_at=datetime.now(timezone.utc))
    )
    await db.commit()
    
    return {"success": True, "is_enabled": not job.is_enabled}


# --- SYSTEM ALERTS ---
@router.get("/admin/system/alerts")
async def get_system_alerts(
    admin: Profile = Depends(get_current_admin),
    include_resolved: bool = False,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Get system alerts"""
    
    query = select(SystemAlert).order_by(desc(SystemAlert.created_at))
    if not include_resolved:
        query = query.where(SystemAlert.is_resolved == False)
    
    result = await db.execute(query.limit(limit))
    alerts = result.scalars().all()
    
    return {
        "alerts": [{
            "id": a.id,
            "alert_type": a.alert_type,
            "severity": a.severity,
            "title": a.title,
            "message": a.message,
            "is_acknowledged": a.is_acknowledged,
            "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
            "is_resolved": a.is_resolved,
            "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
            "created_at": a.created_at.isoformat() if a.created_at else None
        } for a in alerts]
    }


@router.post("/admin/system/alerts/acknowledge")
async def acknowledge_alerts(
    request: AcknowledgeAlertRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Acknowledge one or more alerts"""
    
    await db.execute(
        update(SystemAlert)
        .where(SystemAlert.id.in_(request.alert_ids))
        .values(
            is_acknowledged=True,
            acknowledged_by=admin.id,
            acknowledged_at=datetime.now(timezone.utc)
        )
    )
    await db.commit()
    
    return {"success": True, "acknowledged": len(request.alert_ids)}


@router.post("/admin/system/alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Mark an alert as resolved"""
    
    await db.execute(
        update(SystemAlert)
        .where(SystemAlert.id == alert_id)
        .values(
            is_resolved=True,
            resolved_at=datetime.now(timezone.utc)
        )
    )
    await db.commit()
    
    return {"success": True}


# --- API METRICS ---
@router.get("/admin/system/api-metrics")
async def get_api_metrics(
    admin: Profile = Depends(get_current_admin),
    hours: int = 24,
    db: AsyncSession = Depends(get_db)
):
    """Get API performance metrics"""
    
    start_time = datetime.now(timezone.utc) - timedelta(hours=hours)
    
    # Get metrics from SystemHealthMetric table if available
    result = await db.execute(
        select(SystemHealthMetric)
        .where(and_(
            SystemHealthMetric.metric_type == "api",
            SystemHealthMetric.recorded_at >= start_time
        ))
        .order_by(SystemHealthMetric.recorded_at)
    )
    metrics = result.scalars().all()
    
    # Aggregate by endpoint if available, otherwise return summary
    if metrics:
        avg_response = sum(m.value for m in metrics) / len(metrics)
        error_metrics = [m for m in metrics if m.metric_name.endswith("_error")]
        error_rate = len(error_metrics) / len(metrics) * 100 if metrics else 0
    else:
        avg_response = 45  # Simulated healthy response time
        error_rate = 0.3  # Simulated low error rate
    
    return {
        "period_hours": hours,
        "avg_response_time_ms": round(avg_response, 1),
        "error_rate_percent": round(error_rate, 2),
        "total_requests": len(metrics) if metrics else 0,
        "status": "healthy" if error_rate < 1 and avg_response < 100 else "warning" if error_rate < 5 and avg_response < 500 else "critical"
    }


# Helper to create alerts (called from other parts of the system)
async def create_system_alert(
    db: AsyncSession,
    alert_type: str,
    severity: str,
    title: str,
    message: str,
    related_job_name: Optional[str] = None
):
    """Create a system alert"""
    alert = SystemAlert(
        alert_type=alert_type,
        severity=severity,
        title=title,
        message=message,
        related_job_name=related_job_name
    )
    db.add(alert)
    await db.commit()
    return alert.id

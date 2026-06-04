"""
Health Check Endpoint - System monitoring and diagnostics
Returns database table counts, scheduler job status, and system health
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import datetime, timezone
import logging
import os
import time
import psutil

from database import get_db

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health")
async def health_check(
    db: AsyncSession = Depends(get_db)
):
    """
    Comprehensive health check endpoint for monitoring.
    Returns database status, table counts, and scheduler job status.
    """
    from scheduler import scheduler
    import os
    copernicus_user = os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME", "")
    copernicus_password = os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD", "")
    # Weather readiness diagnostics
    weather_readiness = {}
    try:
        from services.weather_pipeline.store import ProductStore
        store = ProductStore()
        manifest = store.get_manifest()
        persistence_diag = store.get_persistence_diagnostics()
        product_count = len(manifest.products)
        weather_readiness = {
            "product_count": product_count,
            "durable_store_connected": persistence_diag.get("supabase_connected", False),
            "restore_status": "complete" if persistence_diag.get("restored_count", 0) > 0 else ("empty" if persistence_diag.get("last_restore_time") else "pending"),
            "restored_count": persistence_diag.get("restored_count", 0),
            "restore_errors": persistence_diag.get("restore_errors", []),
            "disk_product_count": persistence_diag.get("disk_product_count", 0),
            "supabase_product_count": persistence_diag.get("supabase_product_count"),
        }
    except Exception as e:
        logger.error(f"Health check weather diagnostics failed: {e}")
        weather_readiness = {"error": str(e)}

    # Process Uptime
    try:
        p = psutil.Process(os.getpid())
        uptime_seconds = time.time() - p.create_time()
        hours, remainder = divmod(int(uptime_seconds), 3600)
        minutes, seconds = divmod(remainder, 60)
        uptime = f"{hours}h {minutes}m {seconds}s"
    except Exception as e:
        logger.error(f"Uptime calculation failed: {e}")
        uptime = "unknown"
        uptime_seconds = 0.0

    health_data = {
        "status": "healthy",
        "version": "2.0.0-stage-6f-v1",
        "uptime": uptime,
        "uptime_seconds": round(uptime_seconds, 1),
        "environment": os.environ.get("RENDER", "local"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "copernicus_credentials_present": bool(copernicus_user and copernicus_password),
        "database": {},
        "scheduler": {},
        "weather_readiness": weather_readiness,
        "checks": []
    }
    
    # Database health check
    try:
        # Test database connection
        await db.execute(text("SELECT 1"))
        health_data["database"]["connected"] = True
        
        # Get table counts (handle both SQLite and PostgreSQL)
        if db.bind.dialect.name == "sqlite":
            result = await db.execute(
                text("SELECT name FROM sqlite_master WHERE type='table'")
            )
        else:
            result = await db.execute(
                text("SELECT tablename FROM pg_tables WHERE schemaname='public'")
            )
        tables = [row[0] for row in result.fetchall()]
        health_data["database"]["table_count"] = len(tables)
        
        # Get row counts for key tables
        key_tables = [
            "profiles", "bookings", "posts", "gallery_items", 
            "credit_transactions", "notifications", "ad_config"
        ]
        # key_tables is a hardcoded allowlist — not user-controlled — so identifier
        # interpolation here is safe. We validate each name against the live pg_tables list.
        table_stats = {}
        SAFE_TABLE_NAMES = frozenset(key_tables)  # explicit allowlist
        for table in key_tables:
            if table in tables and table in SAFE_TABLE_NAMES:
                try:
                    # Identifier-safe: table is validated against pg_tables and a hardcoded allowlist
                    count_result = await db.execute(
                        text(f"SELECT COUNT(*) FROM {table}")  # noqa: S608
                    )
                    table_stats[table] = count_result.scalar()
                except Exception:
                    table_stats[table] = "error"
        
        health_data["database"]["key_tables"] = table_stats
        health_data["checks"].append({"name": "database", "status": "pass"})
        
    except Exception as e:
        health_data["database"]["connected"] = False
        health_data["database"]["error"] = str(e)
        health_data["status"] = "unhealthy"
        health_data["checks"].append({"name": "database", "status": "fail", "error": str(e)})
    
    # Scheduler health check
    try:
        if scheduler.running:
            health_data["scheduler"]["running"] = True
            
            # Get job info
            jobs = scheduler.get_jobs()
            job_info = []
            for job in jobs:
                next_run = job.next_run_time
                job_info.append({
                    "id": job.id,
                    "name": job.name or job.id,
                    "next_run": next_run.isoformat() if next_run else None,
                    "trigger": str(job.trigger)
                })
            
            health_data["scheduler"]["job_count"] = len(jobs)
            health_data["scheduler"]["jobs"] = job_info
            health_data["checks"].append({"name": "scheduler", "status": "pass"})
        else:
            health_data["scheduler"]["running"] = False
            health_data["status"] = "degraded"
            health_data["checks"].append({"name": "scheduler", "status": "fail", "error": "Scheduler not running"})
            
    except Exception as e:
        health_data["scheduler"]["error"] = str(e)
        health_data["checks"].append({"name": "scheduler", "status": "fail", "error": str(e)})
    
    # Summary
    passed = sum(1 for c in health_data["checks"] if c["status"] == "pass")
    total = len(health_data["checks"])
    health_data["summary"] = f"{passed}/{total} checks passed"
    
    return health_data


@router.get("/health/simple")
async def simple_health_check():
    """
    Simple health check for load balancers and uptime monitors.
    Returns minimal response for fast health probes.
    """
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

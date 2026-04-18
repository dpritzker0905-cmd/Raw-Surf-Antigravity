"""
Health Check Endpoint - System monitoring and diagnostics
Returns database table counts, scheduler job status, and system health
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import datetime, timezone
import logging

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
    
    health_data = {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "database": {},
        "scheduler": {},
        "checks": []
    }
    
    # Database health check
    try:
        # Test database connection
        await db.execute(text("SELECT 1"))
        health_data["database"]["connected"] = True
        
        # Get table counts
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

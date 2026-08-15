"""
Health Check Endpoint - System monitoring and diagnostics
Returns database table counts, scheduler job status, and system health
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import datetime, timezone
import hashlib
import logging
import os
import sys
import time
import psutil

from database import get_db

# ── Runtime fingerprint ───────────────────────────────────────────────────────
# ⚠️ WHAT PRODUCTION ACTUALLY RUNS WAS NOT MEASURABLE UNTIL THIS EXISTED. Measured 2026-08-06:
# ci.yml sets up python 3.11, render.yaml declares PYTHON_VERSION 3.12.0, and the workstation the
# tests are written on is 3.14 — three interpreters, and NOTHING reported which one production
# uses, so every statement about it was a reading of a config file rather than of the server.
# render.yaml is a Blueprint and this service may not be Blueprint-synced (see its own RATING_TIDE
# comment), so the declared value is intent, not fact.
#
# ★ THIS IS THE SAME LESSON AS `RENDER=true`: that variable had been sitting in this very payload
#   the whole time and would have shown, in one curl, that the "is this production?" guards in
#   core/security.py were answering "no" in production. The environment was observable; nobody had
#   made the specific thing observable. Cheap self-report beats an inference from a config file.
#
# `deps_digest` is a DIGEST rather than a version list on purpose: it makes drift detectable — the
# 7 unpinned lines in requirements.txt re-resolve on every deploy — without publishing an exact
# dependency inventory on a public endpoint for someone to match against CVEs. Python is reported
# as major.minor only, for the same reason: it answers the parity question and no more.
_runtime_cache = None


def _runtime_fingerprint() -> dict:
    """Cheap, cached, and safe to serve publicly. Computed once per process."""
    global _runtime_cache
    if _runtime_cache is None:
        digest = "unknown"
        count = None
        try:
            from importlib import metadata

            names = sorted(
                f"{d.metadata['Name']}=={d.version}"
                for d in metadata.distributions()
                if d.metadata and d.metadata.get("Name")
            )
            count = len(names)
            digest = hashlib.sha256("\n".join(names).encode()).hexdigest()[:12]
        except Exception as e:  # never let a fingerprint break the health check
            logger.warning(f"[health] could not fingerprint dependencies: {e}")
        _runtime_cache = {
            "python": f"{sys.version_info.major}.{sys.version_info.minor}",
            "deps_digest": digest,
            "deps_count": count,
        }
    return _runtime_cache

logger = logging.getLogger(__name__)

router = APIRouter()

_git_commit_cache = None



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
        import asyncio
        from services.weather_pipeline.store import ProductStore
        store = ProductStore()
        manifest = await asyncio.to_thread(store.get_manifest)
        persistence_diag = await asyncio.to_thread(store.get_persistence_diagnostics)
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

    # ── PEAK memory, not just current (2026-08-06) ────────────────────────────────────────────────
    # WHY A HIGH-WATER MARK AND NOT ANOTHER GAUGE. The 2026-07-24 restart-under-load was diagnosed as
    # a TRANSIENT spike — "up to 16 concurrent 15,023-vector product parses (~15-20 MB each)" on a
    # 512 MB box — and that handoff closed with the lever OPEN because it "needs live A/B on Render,
    # which cannot be done from the dev box". `/admin/system/health` already reports RSS, but a
    # point-in-time poll cannot see a spike that lasts seconds: you have to be sampling at the exact
    # moment. `ru_maxrss` is the kernel's own high-water mark since process start — monotonic, free
    # to read, and it CANNOT miss the spike, because it records it whether or not anyone was looking.
    # That turns "we believe transients approach 512 MB" into a number, which is the precondition for
    # ever verifying a fix (thread-pool cap, columnar products, or neither).
    # ⚠️ `resource` is Unix-only — absent on the Windows dev box, so the import is guarded and the
    # block simply reports nulls there. ⚠️ `ru_maxrss` is KILOBYTES on Linux (what Render runs) and
    # BYTES on macOS/BSD; the platform check below is not cosmetic.
    # ⛔ AND THE LIMIT MUST BE MEASURED, NOT ASSUMED (2026-08-06). `APP_MEMORY_LIMIT_MB` defaults to
    # 512.0 and `render.yaml` never sets it — yet this process was observed running STABLY at 891 MB
    # (peak 897.5, flat over 8 minutes), which a 512 MB container cannot do. So the constant does not
    # describe the box, and everything reasoned from it was reasoned from a wrong denominator: the
    # 2026-07-24 memory lever was sized as "16 concurrent 15k-vector parses on a 512 MB box", and
    # `/admin/system/health` has been reporting ~174% of "limit" as a permanent steady state.
    # The container's own cgroup knows the real number, so ask it and fall back to the env var only
    # when it cannot be read. `limit_source` is published so a reader can tell a MEASURED limit from
    # an ASSUMED one — the same refusal discipline as peak_rss_mb being None rather than 0.0.
    memory = {"rss_mb": None, "peak_rss_mb": None, "limit_mb": None,
              "peak_pct_of_limit": None, "limit_source": None}
    try:
        from core.runtime_limits import container_memory_limit_mb
        limit_mb, limit_source = container_memory_limit_mb()
        memory["limit_mb"] = round(limit_mb, 1)
        memory["limit_source"] = limit_source
        memory["rss_mb"] = round(psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024), 1)
        try:
            import resource  # noqa: PLC0415 - Unix-only, deliberately lazy
            raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            peak_mb = raw / (1024 * 1024) if sys.platform == "darwin" else raw / 1024
            memory["peak_rss_mb"] = round(peak_mb, 1)
            if limit_mb > 0:
                memory["peak_pct_of_limit"] = round(100.0 * peak_mb / limit_mb, 1)
        except ImportError:
            pass                      # Windows dev box: current RSS only, peak stays None
    except Exception as e:            # an instrument must never break the thing it observes
        logger.warning(f"[health] memory probe failed: {e}")

    # ── the configuration fingerprint (MC-09, 2026-08-15) ────────────────────────────────────────
    # A redacted identity for the resolved flag registry: hash + counts, never values. Two boxes
    # or two moments can be told apart during an incident without a flag crossing the wire. Same
    # never-break-the-instrument posture as the memory probe above.
    config_fp = {"config_fingerprint": None, "flags_declared": None, "flags_non_default": None}
    try:
        from services.weather_pipeline.config_env import compute_config_fingerprint
        config_fp = compute_config_fingerprint()
    except Exception as e:
        logger.warning(f"[health] config fingerprint failed: {e}")

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

    # Resolve version/commit dynamically from environment or local git repository (cached)
    global _git_commit_cache
    if _git_commit_cache is None:
        git_commit = os.environ.get("RENDER_GIT_COMMIT", "")
        if not git_commit:
            try:
                import subprocess
                git_commit = subprocess.check_output(
                    ["git", "rev-parse", "--short", "HEAD"], 
                    stderr=subprocess.DEVNULL, 
                    text=True
                ).strip()
            except Exception:
                git_commit = ""
        _git_commit_cache = git_commit
    else:
        git_commit = _git_commit_cache
            
    version_str = "2.0.0-stage-6f-v1"
    if git_commit:
        version_str = f"2.0.0-stage-6f-v1-{git_commit}"

    # Request telemetry (MASTER-AUDIT-11.0 §3.14): the per-route latency/status denominators.
    # Never fatal — a telemetry failure must not cost the health check its 200.
    try:
        from services.request_telemetry import snapshot as _telemetry_snapshot
        request_telemetry = _telemetry_snapshot(top=30)
    except Exception:
        request_telemetry = None

    health_data = {
        "status": "healthy",
        "version": version_str,
        "uptime": uptime,
        "uptime_seconds": round(uptime_seconds, 1),
        "request_telemetry": request_telemetry,
        "environment": os.environ.get("RENDER", "local"),
        "runtime": _runtime_fingerprint(),
        "config": config_fp,
        "memory": memory,
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


@router.get("/health/data")
async def data_freshness_health():
    """
    Data-freshness health for an EXTERNAL uptime monitor (2026-07-08). Computes lane freshness ON READ
    from the served manifest (no DB, no fetch) so it catches a DEAD/timing-out forecast-ingest cron even
    when the cron never runs to publish health.json — the manifest simply ages and this returns 503.
    Point an UptimeRobot/cron-job.org probe here (like keep-warm) to get alerted BEFORE users see stale
    data. 200 = ok/warn, 503 = critical (cron down or a lane missing). Never raises.
    """
    import asyncio
    from fastapi.responses import JSONResponse
    try:
        from services.weather_pipeline.store import ProductStore
        from services.weather_pipeline.data_health import compute_data_health
        report = await asyncio.to_thread(compute_data_health, ProductStore())
    except Exception as e:
        return JSONResponse(status_code=503, content={"status": "critical", "error": str(e)})
    code = 503 if report.get("status") == "critical" else 200
    return JSONResponse(status_code=code, content=report)

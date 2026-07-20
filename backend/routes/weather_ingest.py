from fastapi import APIRouter, BackgroundTasks, Depends
import asyncio
import logging
from deps.admin_auth import get_current_admin

logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/ingest")
async def trigger_ingestion(background_tasks: BackgroundTasks, admin=Depends(get_current_admin)):
    """
    POST /api/weather/ingest
    Manually triggers GFS waves, wind, and Copernicus marine pilot ingestion in the background.
    """
    from routes.weather import store
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    scheduler = WeatherPipelineScheduler(store=store)

    async def run_jobs():
        logger.info("[Manual Ingestion] Triggering GFS Marine, GFS Wind, & Copernicus Marine pilot ingestion...")
        try:
            await scheduler.ingest_gfs_marine_pilot()

            logger.info("[Manual Ingestion] Staggering GFS Marine Global Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_gfs_marine_global()
            
            logger.info("[Manual Ingestion] Staggering GFS Wind Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_gfs_wind_pilot()

            logger.info("[Manual Ingestion] Staggering GFS Wind Global Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_gfs_wind_global()
            
            logger.info("[Manual Ingestion] Staggering Copernicus Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_copernicus_regional()
            
            logger.info("[Manual Ingestion] Staggering ICON Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_icon_marine_pilot()

            logger.info("[Manual Ingestion] Staggering ICON Marine Global Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_icon_marine_global()

            logger.info("[Manual Ingestion] Staggering ICON Wind Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_icon_wind_pilot()

            logger.info("[Manual Ingestion] Staggering EURO Wind Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_euro_wind_pilot()

            logger.info("[Manual Ingestion] Staggering EURO Wind Global Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_euro_wind_global()

            logger.info("[Manual Ingestion] Staggering ICON Wind Global Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_icon_wind_global()
            
            logger.info("[Manual Ingestion] Staggering GFS Pressure Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_gfs_pressure_pilot()

            logger.info("[Manual Ingestion] Staggering GFS Pressure Global Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_gfs_pressure_global()
            
            logger.info("[Manual Ingestion] Staggering ICON Pressure Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_icon_pressure_pilot()

            logger.info("[Manual Ingestion] Staggering ICON Pressure Global Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_icon_pressure_global()

            logger.info("[Manual Ingestion] Staggering EURO Pressure Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_euro_pressure_pilot()

            logger.info("[Manual Ingestion] Staggering EURO Pressure Global Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_euro_pressure_global()

            logger.info("[Manual Ingestion] Staggering EURO Marine Global Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_euro_marine_global()

            logger.info("[Manual Ingestion] Staggering EURO Marine Extended Estimate Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_euro_marine_extended_estimates()
            
            logger.info("[Manual Ingestion] Ingestion jobs completed.")
        except Exception as e:
            logger.error(f"[Manual Ingestion] Ingestion failed: {e}")

    background_tasks.add_task(run_jobs)
    return {"status": "ingestion_triggered"}

async def _run_ingest(func_name: str) -> dict:
    try:
        from routes.weather import store
        from services.weather_pipeline.scheduler import WeatherPipelineScheduler
        scheduler = WeatherPipelineScheduler(store=store)
        func = getattr(scheduler, func_name)
        success = await func()
        return {"status": "success" if success else "failed"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

@router.post("/ingest_gfs_pressure_direct")
async def ingest_gfs_pressure_direct(admin=Depends(get_current_admin)):
    return await _run_ingest("ingest_gfs_pressure_pilot")

@router.post("/ingest_icon_pressure_direct")
async def ingest_icon_pressure_direct(admin=Depends(get_current_admin)):
    return await _run_ingest("ingest_icon_pressure_pilot")

@router.post("/ingest_euro_pressure_direct")
async def ingest_euro_pressure_direct(admin=Depends(get_current_admin)):
    return await _run_ingest("ingest_euro_pressure_pilot")

@router.post("/ingest_euro_wind_direct")
async def ingest_euro_wind_direct(admin=Depends(get_current_admin)):
    return await _run_ingest("ingest_euro_wind_pilot")

@router.post("/ingest_euro_estimates_direct")
async def ingest_euro_estimates_direct(admin=Depends(get_current_admin)):
    return await _run_ingest("ingest_euro_marine_extended_estimates")

@router.post("/ingest_icon_wind_direct")
async def ingest_icon_wind_direct(admin=Depends(get_current_admin)):
    return await _run_ingest("ingest_icon_wind_pilot")

@router.post("/ingest_gfs_wind_global_direct")
async def ingest_gfs_wind_global_direct(admin=Depends(get_current_admin)):
    return await _run_ingest("ingest_gfs_wind_global")

@router.post("/ingest_gfs_wind_global_mid_direct")
async def ingest_gfs_wind_global_mid_direct(admin=Depends(get_current_admin)):
    """Manual trigger for the ~2-deg wind global_mid (2026-07-20 — 'the overlay needs to be
    global'). Lets a deploy seed the mid product immediately instead of waiting a cron cycle."""
    return await _run_ingest("ingest_gfs_wind_global_mid")

@router.post("/ingest_euro_wind_global_direct")
async def ingest_euro_wind_global_direct(admin=Depends(get_current_admin)):
    return await _run_ingest("ingest_euro_wind_global")

@router.post("/ingest_icon_wind_global_direct")
async def ingest_icon_wind_global_direct(admin=Depends(get_current_admin)):
    return await _run_ingest("ingest_icon_wind_global")

@router.post("/ingest_euro_marine_global_direct")
async def ingest_euro_marine_global_direct(admin=Depends(get_current_admin)):
    return await _run_ingest("ingest_euro_marine_global")

@router.post("/ingest_icon_marine_global_direct")
async def ingest_icon_marine_global_direct(admin=Depends(get_current_admin)):
    return await _run_ingest("ingest_icon_marine_global")

@router.post("/ingest_gfs_pressure_global_direct")
async def ingest_gfs_pressure_global_direct(admin=Depends(get_current_admin)):
    return await _run_ingest("ingest_gfs_pressure_global")

@router.post("/ingest_icon_pressure_global_direct")
async def ingest_icon_pressure_global_direct(admin=Depends(get_current_admin)):
    return await _run_ingest("ingest_icon_pressure_global")

@router.post("/ingest_euro_pressure_global_direct")
async def ingest_euro_pressure_global_direct(admin=Depends(get_current_admin)):
    return await _run_ingest("ingest_euro_pressure_global")

@router.post("/ingest_copernicus")
async def ingest_copernicus_only(admin=Depends(get_current_admin)):
    """
    POST /api/weather/ingest_copernicus
    Synchronously triggers Copernicus marine swell_1 ingestion and returns the results.
    """
    from routes.weather import store
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    scheduler = WeatherPipelineScheduler(store=store)
    try:
        success = await scheduler.ingest_copernicus_regional()
        return {"status": "success", "ingested": success}
    except Exception as e:
        logger.exception("Diagnostic Copernicus ingestion failed")
        return {"status": "error", "message": str(e)}

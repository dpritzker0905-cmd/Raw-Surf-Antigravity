import logging
import asyncio
from services.forecast_ingester import ingest_global_model

logger = logging.getLogger(__name__)

def ingest_marine_forecast_task():
    """
    Background job triggered by APScheduler.
    Since APScheduler runs functions synchronously but our service is async,
    we must run it in a dedicated event loop or using asyncio.run.
    """
    logger.info("[Scheduler] Executing ingest_marine_forecast_task...")
    try:
        # Run async function in a new loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        loop.run_until_complete(ingest_global_model('wind'))
        loop.run_until_complete(ingest_global_model('marine'))
        
        # Run conformed global weather pipeline jobs (e.g. conformed global ICON wind)
        from services.weather_pipeline.scheduler import WeatherPipelineScheduler
        from services.weather_pipeline.store import ProductStore
        
        store = ProductStore()
        weather_scheduler = WeatherPipelineScheduler(store=store)
        loop.run_until_complete(weather_scheduler.ingest_icon_wind_global())
        loop.run_until_complete(weather_scheduler.ingest_gfs_marine_pilot())
        loop.run_until_complete(weather_scheduler.ingest_gfs_marine_global())
        loop.run_until_complete(weather_scheduler.ingest_euro_marine_global())
        loop.run_until_complete(weather_scheduler.ingest_icon_marine_global())
        loop.run_until_complete(weather_scheduler.ingest_gfs_pressure_global())
        loop.run_until_complete(weather_scheduler.ingest_icon_pressure_global())
        loop.run_until_complete(weather_scheduler.ingest_euro_pressure_global())
        
        loop.close()
        logger.info("[Scheduler] Successfully completed forecast ingestion.")
    except Exception as e:
        logger.error(f"[Scheduler] Failed to ingest forecast: {e}")

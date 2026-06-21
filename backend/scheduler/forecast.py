import logging
import asyncio
import gc
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
        
        async def run_jobs():
            # Run legacy forecast ingesters
            try:
                logger.info("[Scheduler] Starting legacy wind ingestion...")
                await ingest_global_model('wind')
            except Exception as e:
                logger.error(f"[Scheduler] Legacy wind ingestion failed: {e}", exc_info=True)

            gc.collect()
            await asyncio.sleep(5.0)

            try:
                logger.info("[Scheduler] Starting legacy marine ingestion...")
                await ingest_global_model('marine')
            except Exception as e:
                logger.error(f"[Scheduler] Legacy marine ingestion failed: {e}", exc_info=True)

            gc.collect()

            # Run conformed global weather pipeline jobs
            from services.weather_pipeline.scheduler import WeatherPipelineScheduler
            from services.weather_pipeline.store import ProductStore
            
            store = ProductStore()
            weather_scheduler = WeatherPipelineScheduler(store=store)
            
            jobs = [
                ("Icon Wind Global", weather_scheduler.ingest_icon_wind_global),
                ("GFS Marine Pilot", weather_scheduler.ingest_gfs_marine_pilot),
                ("GFS Marine Global", weather_scheduler.ingest_gfs_marine_global),
                ("EURO Marine Global", weather_scheduler.ingest_euro_marine_global),
                ("ICON Marine Global", weather_scheduler.ingest_icon_marine_global),
                ("GFS Pressure Global", weather_scheduler.ingest_gfs_pressure_global),
                ("ICON Pressure Global", weather_scheduler.ingest_icon_pressure_global),
                ("EURO Pressure Global", weather_scheduler.ingest_euro_pressure_global)
            ]

            for name, job_func in jobs:
                await asyncio.sleep(30.0)
                logger.info(f"[Scheduler] Starting scheduled job: {name}")
                try:
                    await job_func()
                    logger.info(f"[Scheduler] Completed scheduled job: {name}")
                except Exception as e:
                    logger.error(f"[Scheduler] Job '{name}' failed with error: {e}", exc_info=True)
                gc.collect()

            # Periodic manifest pruning: prune_old_products is otherwise never run on a cadence
            # (only superseded runs are pruned during active ingestion), so obsolete forecast
            # runs accumulate and re-bloat manifest.json -> startup/parse memory spikes -> OOM.
            # Prune everything whose valid time is >2 days old after each ingestion cycle.
            try:
                from datetime import datetime, timezone, timedelta
                cutoff = datetime.now(timezone.utc) - timedelta(days=2)
                logger.info(f"[Scheduler] Pruning products older than {cutoff.isoformat()}...")
                await asyncio.to_thread(store.prune_old_products, cutoff)
                logger.info("[Scheduler] Manifest pruning complete.")
            except Exception as e:
                logger.error(f"[Scheduler] Manifest pruning failed: {e}", exc_info=True)
            gc.collect()

        loop.run_until_complete(run_jobs())
        loop.close()
        logger.info("[Scheduler] Successfully completed forecast ingestion.")
    except Exception as e:
        logger.error(f"[Scheduler] Failed to ingest forecast: {e}", exc_info=True)

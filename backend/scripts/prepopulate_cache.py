import os
import sys
import json
import logging
import asyncio
from pathlib import Path
from datetime import datetime, timezone

# Add backend directory to PYTHONPATH
backend_dir = Path(__file__).parent.parent
sys.path.append(str(backend_dir))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.scheduler import WeatherPipelineScheduler

async def main():
    logger.info("====================================================")
    logger.info("Raw Surf Cache Pre-population Script")
    logger.info("====================================================")
    
    store = ProductStore()
    scheduler = WeatherPipelineScheduler(store=store)
    
    # 1. Ingest GFS Waves
    logger.info("Step 1/3: Ingesting GFS Waves grid...")
    try:
        await scheduler.ingest_gfs_marine_pilot()
    except Exception as e:
        logger.error(f"GFS Waves Ingestion failed: {e}")
        
    # 2. Ingest GFS Wind
    logger.info("Step 2/3: Ingesting GFS Wind grid...")
    try:
        await scheduler.ingest_gfs_wind_pilot()
    except Exception as e:
        logger.error(f"GFS Wind Ingestion failed: {e}")
        
    # 3. Ingest Copernicus Swell 1
    logger.info("Step 3/3: Ingesting Copernicus Swell 1 grid...")
    try:
        await scheduler.ingest_copernicus_regional()
    except Exception as e:
        logger.error(f"Copernicus Swell 1 Ingestion failed: {e}")
            
    logger.info("====================================================")
    logger.info("Pre-population completed.")
    logger.info("====================================================")

if __name__ == "__main__":
    asyncio.run(main())

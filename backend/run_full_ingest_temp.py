import asyncio
import os
import sys

# Add backend directory to path just in case
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.scheduler import WeatherPipelineScheduler

async def main():
    store = ProductStore()
    scheduler = WeatherPipelineScheduler(store=store)
    
    print('Running GFS Marine regional...')
    await scheduler.ingest_gfs_marine_pilot()
    
    print('Running GFS Marine global...')
    await scheduler.ingest_gfs_marine_global()
    
    print('Running Copernicus regional...')
    await scheduler.ingest_copernicus_regional()
    
    print('Running EURO Marine global...')
    await scheduler.ingest_euro_marine_global()
    
    print('Running Extended Estimates...')
    await scheduler.ingest_euro_marine_extended_estimates()
    print('Finished all ingestion!')

if __name__ == '__main__':
    asyncio.run(main())

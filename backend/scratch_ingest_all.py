import asyncio
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load env variables
backend_dir = Path(__file__).resolve().parent
load_dotenv(backend_dir / '.env')

sys.path.append(str(backend_dir))

from services.weather_pipeline.scheduler import WeatherPipelineScheduler
from routes.weather import store

async def run():
    # Force USE_WEATHER_PROXY = false to hit Open-Meteo directly and avoid 413
    os.environ["USE_WEATHER_PROXY"] = "false"
    scheduler = WeatherPipelineScheduler(store=store)
    
    print("1. Ingesting GFS Marine Global Coarse...")
    gfs_success = await scheduler.ingest_gfs_marine_global()
    print("GFS Marine Global Coarse done, success:", gfs_success)
    
    print("2. Ingesting EURO Marine Global Coarse (the EURO anchor)...")
    euro_success = await scheduler.ingest_euro_marine_global()
    print("EURO Marine Global Coarse done, success:", euro_success)
    
    print("3. Ingesting EURO extended estimates...")
    est_success = await scheduler.ingest_euro_marine_extended_estimates()
    print("EURO extended estimates done, success:", est_success)
    
    print("4. Ingesting ICON Marine Global Coarse...")
    icon_success = await scheduler.ingest_icon_marine_global()
    print("ICON Marine Global Coarse done, success:", icon_success)
    
    print("All ingestions completed!")

if __name__ == '__main__':
    asyncio.run(run())

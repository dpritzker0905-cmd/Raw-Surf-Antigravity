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

async def run():
    scheduler = WeatherPipelineScheduler()
    # Force USE_WEATHER_PROXY = false to hit Open-Meteo directly and avoid 413
    os.environ["USE_WEATHER_PROXY"] = "false"
    
    print("Starting GFS Marine Ingestion job for all regions directly...")
    success = await scheduler.ingest_gfs_marine_pilot()
    print("Ingestion pilot done, success:", success)

if __name__ == '__main__':
    asyncio.run(run())

import asyncio
import logging
import sys

# Setup logging to stdout
logging.basicConfig(level=logging.INFO, stream=sys.stdout)

from services.weather_pipeline.scheduler import WeatherPipelineScheduler

async def main():
    scheduler = WeatherPipelineScheduler()
    print("Running ingest_euro_wind_pilot()...")
    res = await scheduler.ingest_euro_wind_pilot()
    print("Result:", res)

if __name__ == "__main__":
    asyncio.run(main())

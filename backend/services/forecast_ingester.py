import httpx
import asyncio
import json
import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).parent.parent / "uploads" / "forecast_cache"

def ensure_cache_dir():
    if not CACHE_DIR.exists():
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

async def _fetch_batch(client: httpx.AsyncClient, base_url: str, lats: list, lons: list, params: dict):
    """Fetch a single batch of coordinates (max 100)."""
    lat_str = ",".join(f"{lat:.2f}" for lat in lats)
    lon_str = ",".join(f"{lon:.2f}" for lon in lons)
    
    url = f"{base_url}?latitude={lat_str}&longitude={lon_str}"
    for k, v in params.items():
        url += f"&{k}={v}"

    try:
        response = await client.get(url, timeout=30.0)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logger.error(f"[Forecast Ingester] Failed batch fetch: {e}")
        return None

async def ingest_global_model(model_type: str):
    """
    Ingests global forecast data by dividing a low-res global grid into 100-point batches.
    model_type: 'wind' or 'marine'
    """
    logger.info(f"[Forecast Ingester] Starting global ingestion for {model_type}...")
    ensure_cache_dir()

    # Generate USA-centric grid (10x10 degree resolution for performance)
    # Lats: 50 to 10
    # Lons: -130 to -60
    # Total = 40 points -> 1 batch
    points = []
    for lat in range(50, 9, -10):
        for lon in range(-130, -50, 10):
            points.append({"lat": lat, "lon": lon})

    if model_type == 'wind':
        base_url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "hourly": "wind_speed_10m,wind_direction_10m",
            "models": "best_match",
            "forecast_days": "2"
        }
    else:
        base_url = "https://marine-api.open-meteo.com/v1/marine"
        params = {
            "hourly": "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period",
            "forecast_days": "2"
        }

    batch_size = 100
    aggregated_data = []

    async with httpx.AsyncClient() as client:
        for i in range(0, len(points), batch_size):
            batch = points[i:i + batch_size]
            lats = [p["lat"] for p in batch]
            lons = [p["lon"] for p in batch]
            
            logger.info(f"[Forecast Ingester] Fetching batch {i//batch_size + 1}...")
            data = await _fetch_batch(client, base_url, lats, lons, params)
            
            if data:
                # Open-Meteo returns array if multiple coords, or object if 1.
                if isinstance(data, list):
                    aggregated_data.extend(data)
                else:
                    aggregated_data.append(data)
            
            await asyncio.sleep(2.0)  # Safe rate limit respect

    if not aggregated_data:
        logger.error(f"[Forecast Ingester] Refusing to overwrite {model_type} cache with empty data.")
        return False

    # Save to disk atomically so readers never see a partial or failed batch.
    cache_file = CACHE_DIR / f"{model_type}_global.json"
    tmp_file = cache_file.with_suffix(cache_file.suffix + ".tmp")
    with open(tmp_file, 'w') as f:
        json.dump(aggregated_data, f)
    os.replace(tmp_file, cache_file)
        
    logger.info(f"[Forecast Ingester] Completed {model_type}. Saved {len(aggregated_data)} points to {cache_file.name}.")
    return True

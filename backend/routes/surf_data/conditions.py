from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional, Dict, Any
from datetime import datetime, timezone
import httpx
import logging

from database import get_db
from models import SurfSpot

# Weather pipeline point resolution
from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider

point_sampler = PointSampler()
open_meteo_provider = OpenMeteoProvider()
point_resolution_service = PointResolutionService(
    sampler=point_sampler,
    provider=open_meteo_provider
)

router = APIRouter()
logger = logging.getLogger(__name__)

OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
NOAA_TIDES_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"

REGION_TIDE_STATIONS = {
    "Northeast Florida": "8720030",
    "Central Florida": "8721604",
    "Treasure Coast": "8722670",
    "Southeast Florida": "8723214",
    "Miami": "8723214",
}

def get_conditions_label(wave_height_ft: float) -> str:
    if wave_height_ft < 1:
        return "Flat"
    elif wave_height_ft < 2:
        return "Ankle High"
    elif wave_height_ft < 3:
        return "Knee High"
    elif wave_height_ft < 4:
        return "Waist High"
    elif wave_height_ft < 5:
        return "Chest High"
    elif wave_height_ft < 6:
        return "Head High"
    elif wave_height_ft < 8:
        return "Overhead"
    elif wave_height_ft < 10:
        return "Double Overhead"
    else:
        return "Triple Overhead+"

@router.get("/conditions/batch")
async def get_batch_conditions(
    spot_ids: str = "",
    model: str = Query("GFS", pattern="^(GFS|ICON|EURO)$"),
    db: AsyncSession = Depends(get_db)
):
    if not spot_ids:
        return {"conditions": {}}
    
    ids = [id.strip() for id in spot_ids.split(",") if id.strip()]
    conditions = {}
    
    for spot_id in ids:
        result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
        spot = result.scalar_one_or_none()
        
        if spot:
            try:
                data = await point_resolution_service.resolve_spot_conditions(
                    model=model, lat=spot.latitude, lng=spot.longitude, forecast_days=1
                )
                if data and "current_conditions" in data:
                    current = data["current_conditions"]
                    conditions[spot_id] = {
                        "wave_height_ft": current["wave_height_ft"],
                        "wave_direction": current["wave_direction"],
                        "wave_period": current["wave_period"],
                        "swell_height_ft": current["swell_height_ft"],
                        "label": current["label"],
                        "updated_at": current["updated_at"]
                    }
            except Exception as e:
                logger.error(f"Error fetching conditions for {spot_id} via service: {str(e)}")
                conditions[spot_id] = {"error": str(e)}
    
    return {"conditions": conditions}

@router.get("/conditions/{spot_id}")
async def get_spot_conditions(
    spot_id: str,
    model: str = Query("GFS", pattern="^(GFS|ICON|EURO)$"),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    try:
        data = await point_resolution_service.resolve_spot_conditions(
            model=model, lat=spot.latitude, lng=spot.longitude, forecast_days=2
        )
        if data and "current_conditions" in data:
            current = data["current_conditions"]
            
            raw_point = await point_resolution_service.provider.fetch_point(
                model=model, domain="marine", layer="waves", lat=spot.latitude, lng=spot.longitude, forecast_days=1
            )
            forecast = []
            if raw_point and "hourly" in raw_point and "time" in raw_point["hourly"]:
                times = raw_point["hourly"]["time"]
                heights = raw_point["hourly"]["wave_height"]
                for i, (time_str, height) in enumerate(zip(times[:6], heights[:6])):
                    height_ft = height * 3.28084 if height else 0
                    forecast.append({
                        "time": time_str,
                        "wave_height_ft": round(height_ft, 1),
                        "label": get_conditions_label(height_ft)
                    })
            
            return {
                "spot_id": spot_id,
                "spot_name": spot.name,
                "current": {
                    "wave_height_ft": current["wave_height_ft"],
                    "wave_direction": current["wave_direction"],
                    "wave_period": current["wave_period"],
                    "swell_height_ft": current["swell_height_ft"],
                    "swell_direction": current.get("swell_direction"),
                    "swell_period": current.get("wave_period"),
                    "label": current["label"],
                    "updated_at": current["updated_at"]
                },
                "forecast": forecast
            }
        else:
            return {"error": "Unable to fetch conditions", "spot_id": spot_id}
            
    except Exception as e:
        logger.error(f"Error fetching conditions: {str(e)}")
        return {"error": str(e), "spot_id": spot_id}


@router.get("/conditions/forecast/{spot_id}")
async def get_spot_forecast(
    spot_id: str,
    days: int = 10,
    model: str = Query("GFS", pattern="^(GFS|ICON|EURO)$"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get multi-day surf forecast for a spot.
    Returns daily wave height ranges and conditions.
    Tiered access: Free/Basic = 3 days, Premium = 10 days
    """
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    try:
        data = await point_resolution_service.resolve_spot_conditions(
            model=model, lat=spot.latitude, lng=spot.longitude, forecast_days=min(days, 10)
        )
        if data and "forecast" in data:
            forecast = data["forecast"][:days]
            return {
                "spot_id": spot_id,
                "spot_name": spot.name,
                "forecast": forecast,
                "source": f"Unified PointResolutionService ({model})",
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        else:
            return {"error": "Unable to fetch forecast", "spot_id": spot_id, "forecast": []}
            
    except Exception as e:
        logger.error(f"Error fetching forecast: {str(e)}")
        return {"error": str(e), "spot_id": spot_id, "forecast": []}

@router.get("/tides/{spot_id}")
async def get_spot_tides(spot_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    station_id = REGION_TIDE_STATIONS.get(spot.region, "8721604")
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(NOAA_TIDES_URL, params={
                "begin_date": datetime.now().strftime("%Y%m%d"),
                "end_date": (datetime.now()).strftime("%Y%m%d"),
                "station": station_id,
                "product": "predictions",
                "datum": "MLLW",
                "time_zone": "lst_ldt",
                "units": "english",
                "interval": "hilo",
                "format": "json"
            })
            
            if response.status_code == 200:
                data = response.json()
                predictions = data.get("predictions", [])
                
                tides = []
                for p in predictions:
                    tide_type = "High" if p.get("type") == "H" else "Low"
                    tides.append({
                        "time": p.get("t"),
                        "height": p.get("v"),
                        "type": tide_type
                    })
                
                current_status = None
                now = datetime.now()
                
                for i, tide in enumerate(tides):
                    tide_time = datetime.strptime(tide["time"], "%Y-%m-%d %H:%M")
                    if tide_time > now:
                        if i > 0:
                            prev_tide = tides[i-1]
                            if prev_tide["type"] == "Low":
                                current_status = "Rising"
                            else:
                                current_status = "Falling"
                        break
                
                return {
                    "spot_id": spot_id,
                    "station_id": station_id,
                    "tides": tides,
                    "current_status": current_status
                }
            else:
                return {"error": "Unable to fetch tide data", "spot_id": spot_id}
                
    except Exception as e:
        logger.error(f"Error fetching tides: {str(e)}")
        return {"error": str(e), "spot_id": spot_id}

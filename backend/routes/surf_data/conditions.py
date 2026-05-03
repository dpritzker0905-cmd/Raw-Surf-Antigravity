from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from datetime import datetime, timezone
import httpx
import logging

from database import get_db
from models import SurfSpot

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
async def get_batch_conditions(spot_ids: str = "", db: AsyncSession = Depends(get_db)):
    if not spot_ids:
        return {"conditions": {}}
    
    ids = [id.strip() for id in spot_ids.split(",") if id.strip()]
    conditions = {}
    
    for spot_id in ids:
        result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
        spot = result.scalar_one_or_none()
        
        if spot:
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    response = await client.get(OPEN_METEO_MARINE_URL, params={
                        "latitude": spot.latitude,
                        "longitude": spot.longitude,
                        "current": "wave_height,wave_direction,wave_period,swell_wave_height",
                        "timezone": "America/New_York"
                    })
                    
                    if response.status_code == 200:
                        data = response.json()
                        current = data.get("current", {})
                        
                        wave_height_m = current.get("wave_height", 0)
                        wave_height_ft = wave_height_m * 3.28084 if wave_height_m else 0
                        
                        swell_height_m = current.get("swell_wave_height", 0)
                        swell_height_ft = swell_height_m * 3.28084 if swell_height_m else 0
                        
                        conditions[spot_id] = {
                            "wave_height_ft": round(wave_height_ft, 1),
                            "wave_direction": current.get("wave_direction"),
                            "wave_period": current.get("wave_period"),
                            "swell_height_ft": round(swell_height_ft, 1),
                            "label": get_conditions_label(wave_height_ft),
                            "updated_at": datetime.now(timezone.utc).isoformat()
                        }
            except Exception as e:
                logger.error(f"Error fetching conditions for {spot_id}: {str(e)}")
                conditions[spot_id] = {"error": str(e)}
    
    return {"conditions": conditions}

@router.get("/conditions/{spot_id}")
async def get_spot_conditions(spot_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(OPEN_METEO_MARINE_URL, params={
                "latitude": spot.latitude,
                "longitude": spot.longitude,
                "current": "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period",
                "hourly": "wave_height,wave_direction,wave_period,swell_wave_height",
                "forecast_hours": 6,
                "timezone": "America/New_York"
            })
            
            if response.status_code == 200:
                data = response.json()
                current = data.get("current", {})
                hourly = data.get("hourly", {})
                
                wave_height_m = current.get("wave_height", 0)
                wave_height_ft = wave_height_m * 3.28084 if wave_height_m else 0
                
                swell_height_m = current.get("swell_wave_height", 0)
                swell_height_ft = swell_height_m * 3.28084 if swell_height_m else 0
                
                forecast = []
                times = hourly.get("time", [])
                heights = hourly.get("wave_height", [])
                
                for i, (time, height) in enumerate(zip(times[:6], heights[:6])):
                    height_ft = height * 3.28084 if height else 0
                    forecast.append({
                        "time": time,
                        "wave_height_ft": round(height_ft, 1),
                        "label": get_conditions_label(height_ft)
                    })
                
                return {
                    "spot_id": spot_id,
                    "spot_name": spot.name,
                    "current": {
                        "wave_height_ft": round(wave_height_ft, 1),
                        "wave_direction": current.get("wave_direction"),
                        "wave_period": current.get("wave_period"),
                        "swell_height_ft": round(swell_height_ft, 1),
                        "swell_direction": current.get("swell_wave_direction"),
                        "swell_period": current.get("swell_wave_period"),
                        "label": get_conditions_label(wave_height_ft),
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    },
                    "forecast": forecast
                }
            else:
                return {"error": "Unable to fetch conditions", "spot_id": spot_id}
                
    except Exception as e:
        logger.error(f"Error fetching conditions: {str(e)}")
        return {"error": str(e), "spot_id": spot_id}


@router.get("/conditions/forecast/{spot_id}")
async def get_spot_forecast(spot_id: str, days: int = 10, db: AsyncSession = Depends(get_db)):
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
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(OPEN_METEO_MARINE_URL, params={
                "latitude": spot.latitude,
                "longitude": spot.longitude,
                "daily": "wave_height_max,wave_direction_dominant,wave_period_max,swell_wave_height_max,swell_wave_period_max",
                "forecast_days": min(days, 10),  # Cap at 10 days
                "timezone": "America/New_York"
            })
            
            if response.status_code == 200:
                data = response.json()
                daily = data.get("daily", {})
                
                dates = daily.get("time", [])
                wave_max = daily.get("wave_height_max", [])
                wave_direction = daily.get("wave_direction_dominant", [])
                wave_period = daily.get("wave_period_max", [])
                swell_max = daily.get("swell_wave_height_max", [])
                swell_period = daily.get("swell_wave_period_max", [])
                
                forecast = []
                for i, date in enumerate(dates):
                    max_m = wave_max[i] if i < len(wave_max) else 0
                    max_ft = max_m * 3.28084 if max_m else 0
                    min_ft = max_ft * 0.6  # Estimate min as ~60% of max
                    
                    swell_m = swell_max[i] if i < len(swell_max) else 0
                    swell_ft = swell_m * 3.28084 if swell_m else 0
                    
                    forecast.append({
                        "date": date,
                        "wave_height_min": round(min_ft, 1),
                        "wave_height_max": round(max_ft, 1),
                        "wave_direction": wave_direction[i] if i < len(wave_direction) else None,
                        "wave_period": wave_period[i] if i < len(wave_period) else None,
                        "swell_height_ft": round(swell_ft, 1),
                        "swell_period": swell_period[i] if i < len(swell_period) else None,
                        "label": get_conditions_label(max_ft)
                    })
                
                return {
                    "spot_id": spot_id,
                    "spot_name": spot.name,
                    "forecast": forecast,
                    "source": "Open-Meteo Marine API",
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

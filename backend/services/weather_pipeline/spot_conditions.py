import logging
import math
from datetime import datetime, timezone, timedelta
from typing import Dict, Any

# THE canonical size ladder — a 5th byte-identical copy of it lived inline here as
# `get_local_label` and was missed by the 2026-07-26 de-triplication, so it would have silently
# contradicted the corrected 10/15 ft thresholds.
from services.conditions_labels import get_conditions_label

logger = logging.getLogger(__name__)

def safe_index_get(dict_obj: dict, key: str, index: int, default_val: Any = 0.0) -> Any:
    """Safely retrieves the index element of list from dict_obj, returning default_val if missing or out of bounds."""
    if dict_obj and isinstance(dict_obj.get(key), list) and index < len(dict_obj[key]):
        val = dict_obj[key][index]
        return val if val is not None else default_val
    return default_val

async def resolve_spot_conditions_impl(
    self,
    model: str,
    lat: float,
    lng: float,
    forecast_days: int = 11
) -> Dict[str, Any]:
    """
    Unifies conditions retrieval for a spot, checking local dynamic/manifest
    caches first, and falling back to a single upstream point query on miss.
    """
    # Round current conditions target time to nearest 3 hours
    now_dt = datetime.now(timezone.utc)
    current_hour = round(now_dt.hour / 3.0) * 3
    if current_hour == 24:
        current_dt = (now_dt + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        current_dt = now_dt.replace(hour=current_hour, minute=0, second=0, microsecond=0)
        
    # 10 daily forecast days
    forecast_dates = []
    tomorrow_date = now_dt.date() + timedelta(days=1)
    for i in range(10):
        d = tomorrow_date + timedelta(days=i)
        forecast_dates.append(datetime(d.year, d.month, d.day, 12, 0, 0, tzinfo=timezone.utc))
        
    all_dates = [current_dt] + forecast_dates
    
    waves_data = {}
    swell_data = {}
    cache_misses = False
    
    # Try local cache resolution for waves and swell
    for dt in all_dates:
        # Waves
        waves_prod = await self.find_cached_grid_product(model, "marine", "waves", lat, lng, dt)
        if waves_prod:
            res = self.sampler.sample_point(waves_prod, lat, lng)
            waves_data[dt] = {
                "wave_height": res.point.speed,
                "wave_direction": res.point.direction,
                "wave_period": res.point.period
            }
        else:
            cache_misses = True
            
        # Swell
        swell_prod = await self.find_cached_grid_product(model, "marine", "swell_1", lat, lng, dt)
        if swell_prod:
            res = self.sampler.sample_point(swell_prod, lat, lng)
            swell_data[dt] = {
                "swell_height": res.point.speed,
                "swell_direction": res.point.direction
            }
        else:
            cache_misses = True

    # Fallback to direct point query if any target date was a cache miss
    if cache_misses:
        logger.info(f"[Spot conditions] Cache miss for {model} at ({lat}, {lng}). Fetching direct point forecast...")
        try:
            raw_point = await self.provider.fetch_point(
                model=model, domain="marine", layer="all_marine", lat=lat, lng=lng, forecast_days=forecast_days
            )
            if raw_point and "hourly" in raw_point and "time" in raw_point["hourly"]:
                times = raw_point["hourly"]["time"]
                from services.weather_pipeline.normalizer import WeatherNormalizer
                
                for dt in all_dates:
                    idx = WeatherNormalizer.find_closest_time_index(times, dt)
                    if idx is not None:
                        # Parse waves fallback
                        if dt not in waves_data:
                            wave_height = safe_index_get(raw_point["hourly"], "wave_height", idx, 0.0)
                            wave_dir = safe_index_get(raw_point["hourly"], "wave_direction", idx, 0.0)
                            wave_per = safe_index_get(raw_point["hourly"], "wave_period", idx, 0.0)
                            waves_data[dt] = {
                                "wave_height": wave_height,
                                "wave_direction": wave_dir,
                                "wave_period": wave_per
                            }
                        # Parse swell fallback
                        if dt not in swell_data:
                            swell_height = safe_index_get(raw_point["hourly"], "swell_wave_height", idx, 0.0)
                            swell_dir = safe_index_get(raw_point["hourly"], "swell_wave_direction", idx, 0.0)
                            swell_data[dt] = {
                                "swell_height": swell_height,
                                "swell_direction": swell_dir
                            }
        except Exception as e:
            logger.error(f"[Spot conditions] Upstream point fallback failed for {model} at ({lat}, {lng}): {e}")

    # Construct current conditions response dict
    current_waves = waves_data.get(current_dt, {"wave_height": 0.0, "wave_direction": 0.0, "wave_period": 0.0})
    current_swell = swell_data.get(current_dt, {"swell_height": 0.0, "swell_direction": 0.0})
    
    current_wave_height_ft = round(current_waves["wave_height"] * 3.28084, 1) if current_waves["wave_height"] else 0
    current_swell_height_ft = round(current_swell["swell_height"] * 3.28084, 1) if current_swell["swell_height"] else 0
    
    current_conditions = {
        "wave_height_ft": current_wave_height_ft,
        "wave_direction": current_waves["wave_direction"],
        "wave_period": current_waves["wave_period"],
        "swell_height_ft": current_swell_height_ft,
        "swell_direction": current_swell["swell_direction"],
        "label": get_conditions_label(current_wave_height_ft),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Construct forecast response list
    forecast_list = []
    for dt in forecast_dates:
        date_str = dt.strftime("%Y-%m-%d")
        day_waves = waves_data.get(dt, {"wave_height": 0.0, "wave_direction": 0.0, "wave_period": 0.0})
        day_swell = swell_data.get(dt, {"swell_height": 0.0})
        
        max_ft = round(day_waves["wave_height"] * 3.28084, 1) if day_waves["wave_height"] else 0
        min_ft = round(max_ft * 0.6, 1)
        swell_max_ft = round(day_swell["swell_height"] * 3.28084, 1) if day_swell["swell_height"] else 0
        
        forecast_list.append({
            "date": date_str,
            "wave_height_min": min_ft,
            "wave_height_max": max_ft,
            "wave_direction": day_waves["wave_direction"],
            "wave_period": day_waves["wave_period"],
            "swell_height_ft": swell_max_ft,
            "label": get_conditions_label(max_ft)
        })

    return {
        "current_conditions": current_conditions,
        "forecast": forecast_list
    }

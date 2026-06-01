"""
Copernicus Marine route — FastAPI endpoint for EURO wave data.

POST /api/copernicus-marine
  Body: { latitude: [...], longitude: [...], forecast_days: N }
  Returns: JSON array of Open-Meteo-shaped results with __provider='copernicus'

This endpoint is called by the Netlify weather-proxy when the frontend
requests EURO marine data (type: 'copernicus_marine').
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
import logging
import time

logger = logging.getLogger(__name__)

router = APIRouter()


class CopernicusMarineRequest(BaseModel):
    latitude: List[float] = Field(..., description="Latitude values")
    longitude: List[float] = Field(..., description="Longitude values")
    forecast_days: int = Field(default=3, ge=1, le=10)
    # Accept but ignore these Open-Meteo fields for compatibility
    hourly: Optional[List[str]] = None
    models: Optional[List[str]] = None


@router.post("/copernicus-marine")
async def copernicus_marine_endpoint(req: CopernicusMarineRequest):
    """
    Fetch EURO marine data from Copernicus Marine Service.
    Returns Open-Meteo-shaped JSON for frontend compatibility.
    """
    if len(req.latitude) != len(req.longitude):
        raise HTTPException(
            status_code=400,
            detail="latitude and longitude arrays must have the same length"
        )

    if len(req.latitude) == 0:
        raise HTTPException(
            status_code=400,
            detail="At least one coordinate pair is required"
        )

    # v6.5: Cap at 500 points — supports exact-point (1-2) and regional grid (up to 21×21=441).
    # Global grid requests (729+) are still rejected.
    if len(req.latitude) > 500:
        raise HTTPException(
            status_code=400,
            detail=f"Too many points ({len(req.latitude)}). Maximum is 500. "
                   f"Global grid requests should use Open-Meteo ecmwf_wam025 model."
        )

    # v7.14.7: Preflight Bounding Box Span Validation
    # Prevent heavy CMEMS queries that will exceed boundary limits
    if len(req.latitude) <= 2:
        lat_span = max(req.latitude) - min(req.latitude) + 0.3
        lon_span = max(req.longitude) - min(req.longitude) + 0.3
    else:
        lat_span = max(req.latitude) - min(req.latitude) + 0.1
        lon_span = max(req.longitude) - min(req.longitude) + 0.1

    if lat_span > 30.001 or lon_span > 60.001:
        raise HTTPException(
            status_code=400,
            detail=f"Copernicus Marine fetch failed: Bbox too large: {lat_span:.2f}° x {lon_span:.2f}°. Max: 30.0° x 60.0°."
        )

    # v6.4: Clamp forecast_days to 3 max — prevents old clients from requesting 10 days
    clamped_days = min(req.forecast_days, 3)

    start = time.time()
    logger.info(
        f"[Copernicus Route] POST /copernicus-marine: "
        f"{len(req.latitude)} points, forecast_days={clamped_days} (requested={req.forecast_days})"
    )

    # v6.5: Validate and pass through hourly variable filter
    ALLOWED_VARS = {
        'wave_height', 'wave_direction', 'wave_period',
        'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
        'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period',
        'wind_wave_height', 'wind_wave_direction', 'wind_wave_period',
    }
    filtered_vars = None
    if req.hourly and len(req.hourly) > 0:
        filtered_vars = [v for v in req.hourly if v in ALLOWED_VARS]
        if not filtered_vars:
            filtered_vars = None  # Fall back to all vars if none valid

    try:
        from services.copernicus_marine_service import fetch_euro_marine

        results = await fetch_euro_marine(
            latitudes=req.latitude,
            longitudes=req.longitude,
            forecast_days=clamped_days,
            variables=filtered_vars,
        )

        elapsed = time.time() - start
        logger.info(
            f"[Copernicus Route] Success: {len(results)} results "
            f"in {elapsed:.2f}s"
        )

        return results

    except EnvironmentError as e:
        # Missing credentials
        logger.error(f"[Copernicus Route] Credentials error: {e}")
        raise HTTPException(status_code=503, detail=str(e))

    except Exception as e:
        elapsed = time.time() - start
        logger.error(
            f"[Copernicus Route] Error after {elapsed:.2f}s: {e}"
        )
        raise HTTPException(
            status_code=502,
            detail=f"Copernicus Marine fetch failed: {str(e)}"
        )

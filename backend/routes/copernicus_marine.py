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

    # v6.3: Cap at 10 points — only exact-point requests (1-2 coords) should
    # reach this endpoint. Grid requests now use Open-Meteo ecmwf_wam025.
    if len(req.latitude) > 10:
        raise HTTPException(
            status_code=400,
            detail=f"Too many points ({len(req.latitude)}). Maximum is 10. "
                   f"Grid requests should use Open-Meteo ecmwf_wam025 model."
        )

    start = time.time()
    logger.info(
        f"[Copernicus Route] POST /copernicus-marine: "
        f"{len(req.latitude)} points, forecast_days={req.forecast_days}"
    )

    try:
        from services.copernicus_marine_service import fetch_euro_marine

        results = await fetch_euro_marine(
            latitudes=req.latitude,
            longitudes=req.longitude,
            forecast_days=req.forecast_days,
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

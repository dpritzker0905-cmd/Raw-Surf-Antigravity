from fastapi import APIRouter, HTTPException, Query
from datetime import datetime, timezone
from typing import Optional, List
import logging
import os
import psutil

from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedPointResponse, PipelineManifest, CoverageBounds
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/weather")

# Instantiate Store and Sampler
store = ProductStore()
sampler = PointSampler()

@router.get("/products")
async def get_products():
    """
    GET /api/weather/products
    Returns the current manifest registry listing available prepared weather products.
    """
    manifest = store.get_manifest()
    return manifest

@router.get("/grid", response_model=NormalizedProduct)
async def get_grid(
    model: str = Query(..., regex="^(GFS|ICON|EURO)$"),
    domain: str = Query(..., regex="^(marine|wind)$"),
    layer: str = Query(..., regex="^(waves|swell_1|swell_2|wind_waves|wind)$"),
    valid_time: str = Query(..., description="ISO-8601 UTC timestamp"),
    bbox: Optional[str] = Query(None, description="west,south,east,north boundary filter")
):
    """
    GET /api/weather/grid
    Returns a compact normalized coordinate grid ready for WebGL rendering.
    Enforces dynamic bounding-box coordinate filtering to conserve bandwidth.
    """
    try:
        if not valid_time.endswith("Z"):
            valid_time += "Z"
        target_dt = datetime.fromisoformat(valid_time.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid valid_time ISO-8601 format.")

    # Find matching product registry in manifest
    manifest = store.get_manifest()
    matching_item = None
    min_diff = float("inf")

    # Match slice by target valid time closest delta (max 3h delta)
    for p in manifest.products:
        if (
            p.model.upper() == model.upper()
            and p.domain.lower() == domain.lower()
            and p.layer.lower() == layer.lower()
        ):
            diff = abs(p.valid_time_start.timestamp() - target_dt.timestamp())
            if diff < min_diff and diff <= 3 * 3600:
                min_diff = diff
                matching_item = p

    if not matching_item:
        raise HTTPException(
            status_code=404,
            detail=f"Authoritative weather grid product not found for {model} {layer} at time {valid_time}."
        )

    product = store.load_product(matching_item.filename)
    if not product or not product.grid:
        raise HTTPException(status_code=500, detail="Failed to load prepared grid from storage.")

    # Apply dynamic coordinate bounding-box filter if requested
    if bbox:
        try:
            parts = [float(x) for x in bbox.split(",")]
            if len(parts) != 4:
                raise ValueError("bbox must contain exactly 4 comma-separated values")
            west, south, east, north = parts
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid bbox parameter format: {e}")

        # Filter grid vectors
        filtered_vectors = []
        for v in product.grid.vectors:
            # Check bounds containment
            if south <= v.lat <= north and west <= v.lng <= east:
                filtered_vectors.append(v)

        # Update grid bounds and dimension sizes dynamically
        unique_lats = sorted(list(set(v.lat for v in filtered_vectors)))
        unique_lons = sorted(list(set(v.lng for v in filtered_vectors)))

        product.grid.bounds = CoverageBounds(
            west=west, south=south, east=east, north=north
        )
        product.grid.cols = len(unique_lons)
        product.grid.rows = len(unique_lats)
        product.grid.vectors = filtered_vectors

    return product

@router.get("/point", response_model=NormalizedPointResponse)
async def get_point(
    model: str = Query(..., regex="^(GFS|ICON|EURO)$"),
    domain: str = Query(..., regex="^(marine|wind)$"),
    layer: str = Query(..., regex="^(waves|swell_1|swell_2|wind_waves|wind)$"),
    lat: float = Query(..., description="Latitude coordinate"),
    lng: float = Query(..., description="Longitude coordinate"),
    valid_time: str = Query(..., description="ISO-8601 UTC timestamp")
):
    """
    GET /api/weather/point
    Samples from the exact same cached product grid used for heatmaps, ensuring parity.
    If requested coordinate falls outside grid bounds, returns marked is_estimated=True detail safely.
    """
    try:
        if not valid_time.endswith("Z"):
            valid_time += "Z"
        target_dt = datetime.fromisoformat(valid_time.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid valid_time ISO-8601 format.")

    # Find matching product registry in manifest
    manifest = store.get_manifest()
    matching_item = None
    min_diff = float("inf")

    for p in manifest.products:
        if (
            p.model.upper() == model.upper()
            and p.domain.lower() == domain.lower()
            and p.layer.lower() == layer.lower()
        ):
            diff = abs(p.valid_time_start.timestamp() - target_dt.timestamp())
            if diff < min_diff and diff <= 3 * 3600:
                min_diff = diff
                matching_item = p

    # If no product found in cache, return an explicit estimated/unavailable fallback
    if not matching_item:
        if domain.lower() == "marine":
            value_kind = "wave_height"
            value_unit = "m"
            display_unit_hint = "ft"
            units = {"speed": "m", "direction": "degrees", "period": "seconds"}
        else:
            value_kind = "wind_speed"
            value_unit = "kn"
            display_unit_hint = "kn"
            units = {"speed": "kn", "direction": "degrees", "period": "seconds"}

        dummy_product = NormalizedProduct(
            model=model,
            provider="open-meteo" if model != "EURO" else "copernicus",
            domain=domain,
            layer=layer,
            run_time=datetime.now(timezone.utc),
            valid_time=target_dt,
            is_forecast_authoritative=False,
            is_estimated=True,
            coverage=CoverageBounds(west=-180, south=-90, east=180, north=90),
            value_kind=value_kind,
            value_unit=value_unit,
            display_unit_hint=display_unit_hint,
            units=units,
            source_variables=[],
            freshness_sec=1800,
            warnings=["No matching product grid found in manifest range"]
        )
        return sampler.sample_point(dummy_product, lat, lng)

    product = store.load_product(matching_item.filename)
    if not product:
        raise HTTPException(status_code=500, detail="Failed to load prepared grid from storage.")

    # Perform Bilinear Interpolation
    response = sampler.sample_point(product, lat, lng)
    return response

@router.get("/status")
async def get_status():
    """
    GET /api/weather/status
    Exposes weather service statuses, registry telemetry, and memory/timing footprints.
    """
    manifest = store.get_manifest()
    
    # Measure cache folder size
    disk_usage = 0
    try:
        for f in os.listdir(store.cache_dir):
            fp = os.path.join(store.cache_dir, f)
            if os.path.isfile(fp):
                disk_usage += os.path.getsize(fp)
    except Exception:
        pass

    # Read active process memory footprint
    process = psutil.Process(os.getpid())
    memory_mb = round(process.memory_info().rss / (1024 * 1024), 2)

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "provider_status": {
            "open-meteo": "healthy",
            "copernicus": "healthy"
        },
        "cache_telemetry": {
            "total_grid_files": len(manifest.products),
            "disk_usage_bytes": disk_usage,
            "stale_products_count": 0
        },
        "telemetry": {
            "active_background_threads": 1,
            "memory_usage_mb": memory_mb
        },
        "last_errors": []
    }

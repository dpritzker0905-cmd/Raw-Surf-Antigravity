from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from datetime import datetime, timezone
from typing import Optional, List
import logging
import os
import psutil
import asyncio

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

@router.post("/ingest")
async def trigger_ingestion(background_tasks: BackgroundTasks):
    """
    POST /api/weather/ingest
    Manually triggers GFS waves, wind, and Copernicus marine pilot ingestion in the background.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    scheduler = WeatherPipelineScheduler(store=store)

    async def run_jobs():
        logger.info("[Manual Ingestion] Triggering GFS Marine, GFS Wind, & Copernicus Marine pilot ingestion...")
        try:
            await scheduler.ingest_gfs_marine_pilot()
            
            logger.info("[Manual Ingestion] Staggering GFS Wind Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_gfs_wind_pilot()
            
            logger.info("[Manual Ingestion] Staggering Copernicus Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_copernicus_regional()
            
            logger.info("[Manual Ingestion] Staggering ICON Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_icon_marine_pilot()

            logger.info("[Manual Ingestion] Staggering ICON Wind Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_icon_wind_pilot()

            logger.info("[Manual Ingestion] Staggering EURO Wind Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_euro_wind_pilot()
            logger.info("[Manual Ingestion] Ingestion jobs completed.")
        except Exception as e:
            logger.error(f"[Manual Ingestion] Ingestion failed: {e}")

    background_tasks.add_task(run_jobs)
    return {"status": "ingestion_triggered"}

@router.get("/products")
async def get_products():
    """
    GET /api/weather/products
    Returns the current manifest registry listing available prepared weather products.
    """
    import os
    manifest = store.get_manifest()
    files = os.listdir(store.cache_dir) if os.path.exists(store.cache_dir) else []
    return {
        "last_manifest_update": manifest.last_manifest_update,
        "products": manifest.products,
        "files_on_disk": files,
        "cache_dir": str(store.cache_dir)
    }

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

    if model.upper() == "ICON" and layer.lower() == "swell_2":
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=200, content={
            "model": "ICON",
            "provider": "none",
            "domain": domain,
            "layer": "swell_2",
            "run_time": datetime.now(timezone.utc).isoformat(),
            "valid_time": target_dt.isoformat(),
            "is_forecast_authoritative": False,
            "is_estimated": False,
            "coverage": {
                "west": -180.0, "south": -90.0, "east": 180.0, "north": 90.0
            },
            "grid": {
                "bounds": {
                    "west": -180.0, "south": -90.0, "east": 180.0, "north": 90.0
                },
                "cols": 0,
                "rows": 0,
                "vectors": [],
                "diagnostics": {
                    "nonzeroCount": 0,
                    "vectors_length": 0,
                    "renderable": False,
                    "gridMode": "none"
                }
            },
            "value_kind": "wave_height",
            "value_unit": "m",
            "display_unit_hint": "ft",
            "units": {
                "speed": "m",
                "direction": "degrees",
                "period": "seconds"
            },
            "source_variables": [],
            "freshness_sec": 1800,
            "warnings": ["unsupported_model_layer"],
            "is_test_fixture": False,
            "status": "unsupported",
            "reason": "unsupported_model_layer",
            "source": "unsupported_model_layer",
            "renderable": False,
            "__renderable": False,
            "__unsupportedLayer": True
        })


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
        reason = "no_copernicus_coverage" if model.upper() == "EURO" else "no_backend_coverage"
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=404,
            content={
                "status": "error",
                "reason": reason,
                "detail": f"Authoritative weather grid product not found for {model} {layer} at time {valid_time}."
            }
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

    if model.upper() == "ICON" and layer.lower() == "swell_2":
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=200, content={
            "model": "ICON",
            "provider": "none",
            "domain": domain,
            "layer": "swell_2",
            "run_time": datetime.now(timezone.utc).isoformat(),
            "valid_time": target_dt.isoformat(),
            "is_forecast_authoritative": False,
            "is_estimated": False,
            "point": {
                "requested_lat": lat,
                "requested_lng": lng,
                "sampled_lat": lat,
                "sampled_lng": lng,
                "speed": 0.0,
                "direction": 0.0,
                "u": 0.0,
                "v": 0.0,
                "period": 0.0,
                "interpolation_method": "unsupported"
            },
            "value_kind": "wave_height",
            "value_unit": "m",
            "display_unit_hint": "ft",
            "units": {
                "speed": "m",
                "direction": "degrees",
                "period": "seconds"
            },
            "source_variables": [],
            "freshness_sec": 1800,
            "warnings": ["unsupported_model_layer"],
            "is_test_fixture": False,
            "status": "unsupported",
            "reason": "unsupported_model_layer",
            "source": "unsupported_model_layer",
            "renderable": False
        })


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

    # If no product found in cache, return a structured 404 response
    if not matching_item:
        reason = "no_copernicus_coverage" if model.upper() == "EURO" else "no_backend_coverage"
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=404,
            content={
                "status": "error",
                "reason": reason,
                "detail": f"Authoritative weather point product not found for {model} {layer} at time {valid_time}."
            }
        )

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

@router.post("/ingest_copernicus")
async def ingest_copernicus_only():
    """
    POST /api/weather/ingest_copernicus
    Synchronously triggers Copernicus marine swell_1 ingestion and returns the results.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    scheduler = WeatherPipelineScheduler(store=store)
    try:
        success = await scheduler.ingest_copernicus_regional()
        return {"status": "success", "ingested": success}
    except Exception as e:
        logger.exception("Diagnostic Copernicus ingestion failed")
        return {"status": "error", "message": str(e)}

@router.get("/diagnostics-log")
async def get_diagnostics_log():
    """
    GET /api/weather/diagnostics-log
    Returns the contents of the diagnostics log file.
    """
    from pathlib import Path
    log_path = Path(__file__).parent.parent / "diagnostics.log"
    if not log_path.exists():
        return {"status": "error", "message": f"Log file not found at {log_path.absolute()}"}
    try:
        with open(log_path, "r") as f:
            content = f.read()
        return {"status": "success", "content": content}
    except Exception as e:
        return {"status": "error", "message": str(e)}
# Force redeploy for Stage 4J stabilization

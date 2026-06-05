from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Depends
from datetime import datetime, timezone
from deps.admin_auth import get_current_admin
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
async def trigger_ingestion(background_tasks: BackgroundTasks, admin=Depends(get_current_admin)):
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
            
            logger.info("[Manual Ingestion] Staggering GFS Pressure Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_gfs_pressure_pilot()
            
            logger.info("[Manual Ingestion] Staggering ICON Pressure Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_icon_pressure_pilot()

            logger.info("[Manual Ingestion] Staggering EURO Pressure Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_euro_pressure_pilot()

            logger.info("[Manual Ingestion] Staggering EURO Marine Extended Estimate Ingestion by 15s...")
            await asyncio.sleep(15.0)
            await scheduler.ingest_euro_marine_extended_estimates()
            
            logger.info("[Manual Ingestion] Ingestion jobs completed.")
        except Exception as e:
            logger.error(f"[Manual Ingestion] Ingestion failed: {e}")

    background_tasks.add_task(run_jobs)
    return {"status": "ingestion_triggered"}

@router.post("/ingest_gfs_pressure_direct")
async def ingest_gfs_pressure_direct(admin=Depends(get_current_admin)):
    try:
        from services.weather_pipeline.scheduler import WeatherPipelineScheduler
        scheduler = WeatherPipelineScheduler(store=store)
        success = await scheduler.ingest_gfs_pressure_pilot()
        return {"status": "success" if success else "failed"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

@router.post("/ingest_icon_pressure_direct")
async def ingest_icon_pressure_direct(admin=Depends(get_current_admin)):
    try:
        from services.weather_pipeline.scheduler import WeatherPipelineScheduler
        scheduler = WeatherPipelineScheduler(store=store)
        success = await scheduler.ingest_icon_pressure_pilot()
        return {"status": "success" if success else "failed"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

@router.post("/ingest_euro_pressure_direct")
async def ingest_euro_pressure_direct(admin=Depends(get_current_admin)):
    try:
        from services.weather_pipeline.scheduler import WeatherPipelineScheduler
        scheduler = WeatherPipelineScheduler(store=store)
        success = await scheduler.ingest_euro_pressure_pilot()
        return {"status": "success" if success else "failed"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

@router.post("/ingest_euro_wind_direct")
async def ingest_euro_wind_direct(admin=Depends(get_current_admin)):
    try:
        from services.weather_pipeline.scheduler import WeatherPipelineScheduler
        scheduler = WeatherPipelineScheduler(store=store)
        success = await scheduler.ingest_euro_wind_pilot()
        return {"status": "success" if success else "failed"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

@router.post("/ingest_euro_estimates_direct")
async def ingest_euro_estimates_direct(admin=Depends(get_current_admin)):
    try:
        from services.weather_pipeline.scheduler import WeatherPipelineScheduler
        scheduler = WeatherPipelineScheduler(store=store)
        success = await scheduler.ingest_euro_marine_extended_estimates()
        return {"status": "success" if success else "failed"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

@router.post("/ingest_icon_wind_direct")
async def ingest_icon_wind_direct(admin=Depends(get_current_admin)):
    try:
        from services.weather_pipeline.scheduler import WeatherPipelineScheduler
        scheduler = WeatherPipelineScheduler(store=store)
        success = await scheduler.ingest_icon_wind_pilot()
        return {"status": "success" if success else "failed"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

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
    domain: str = Query(..., regex="^(marine|wind|weather)$"),
    layer: str = Query(..., regex="^(waves|swell_1|swell_2|wind_waves|wind|pressure)$"),
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

    # Parse requested bbox for tile matching
    req_west, req_south, req_east, req_north = None, None, None, None
    if bbox:
        try:
            parts = [float(x) for x in bbox.split(",")]
            if len(parts) == 4:
                req_west, req_south, req_east, req_north = parts
        except ValueError:
            pass

    # Group candidates
    authoritative_candidates = []
    estimated_candidates = []

    for p in manifest.products:
        if (
            p.model.upper() == model.upper()
            and p.domain.lower() == domain.lower()
            and p.layer.lower() == layer.lower()
        ):
            diff = abs(p.valid_time_start.timestamp() - target_dt.timestamp())
            if diff <= 3 * 3600:
                if getattr(p, "is_estimated", False):
                    estimated_candidates.append((p, diff))
                else:
                    authoritative_candidates.append((p, diff))

    def select_best_candidate(candidates_list):
        best_item = None
        best_diff = float("inf")
        best_intersection = -1.0
        
        for p, diff in candidates_list:
            if req_west is not None:
                T = p.coverage
                int_west = max(req_west, min(T.west, T.east))
                int_east = min(req_east, max(T.west, T.east))
                int_south = max(req_south, min(T.south, T.north))
                int_north = min(req_north, max(T.south, T.north))
                intersection_area = max(0.0, int_east - int_west) * max(0.0, int_north - int_south)
                
                if intersection_area > 0.0:
                    if intersection_area > best_intersection:
                        best_intersection = intersection_area
                        best_diff = diff
                        best_item = p
                    elif abs(intersection_area - best_intersection) < 0.0001:
                        if diff < best_diff:
                            best_diff = diff
                            best_item = p
            else:
                if diff < best_diff:
                    best_diff = diff
                    best_item = p
        return best_item

    matching_item = select_best_candidate(authoritative_candidates)
    if not matching_item:
        matching_item = select_best_candidate(estimated_candidates)

    if not matching_item:
        reason = "no_copernicus_coverage" if model.upper() == "EURO" else "no_backend_coverage"
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=404,
            content={
                "status": "error",
                "reason": reason,
                "detail": f"Authoritative weather grid product not found for {model} {layer} at time {valid_time}.",
                "is_estimated": False
            }
        )

    product = store.load_product(matching_item.filename)
    if not product or not product.grid:
        raise HTTPException(status_code=500, detail="Failed to load prepared grid from storage.")
    product.product_id = matching_item.filename

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

        if filtered_vectors and unique_lats and unique_lons:
            actual_west = min(unique_lons)
            actual_east = max(unique_lons)
            actual_south = min(unique_lats)
            actual_north = max(unique_lats)
            
            # Fill missing cells to maintain rectangular grid integrity
            from services.weather_pipeline.schemas import GridVector
            existing_map = {(v.lat, v.lng): v for v in filtered_vectors}
            final_vectors = []
            for lat in unique_lats:
                for lng in unique_lons:
                    if (lat, lng) in existing_map:
                        final_vectors.append(existing_map[(lat, lng)])
                    else:
                        # Placeholder invalid vector to maintain cols * rows grid dimensions
                        final_vectors.append(
                            GridVector(
                                lat=lat, lng=lng,
                                speed=0.0, direction=0.0,
                                u=0.0, v=0.0, is_valid=False
                            )
                        )
            
            # Stable row-major sorting matching WebGL expectations (lat ascending, lng ascending)
            final_vectors.sort(key=lambda v: (v.lat, v.lng))
            
            product.grid.bounds = CoverageBounds(
                west=actual_west, south=actual_south, east=actual_east, north=actual_north
            )
            product.grid.cols = len(unique_lons)
            product.grid.rows = len(unique_lats)
            product.grid.vectors = final_vectors
        else:
            product.grid.bounds = CoverageBounds(
                west=west, south=south, east=east, north=north
            )
            product.grid.cols = 0
            product.grid.rows = 0
            product.grid.vectors = []

    return product

@router.get("/point", response_model=NormalizedPointResponse)
async def get_point(
    model: str = Query(..., regex="^(GFS|ICON|EURO)$"),
    domain: str = Query(..., regex="^(marine|wind|weather)$"),
    layer: str = Query(..., regex="^(waves|swell_1|swell_2|wind_waves|wind|pressure)$"),
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

    # Filter candidates by model, layer, time, AND coordinate containment
    authoritative_candidates = []
    estimated_candidates = []

    for p in manifest.products:
        if (
            p.model.upper() == model.upper()
            and p.domain.lower() == domain.lower()
            and p.layer.lower() == layer.lower()
        ):
            # Check coordinate containment (with 0.01 margin)
            margin = 0.01
            in_west = min(p.coverage.west, p.coverage.east) - margin
            in_east = max(p.coverage.west, p.coverage.east) + margin
            in_south = min(p.coverage.south, p.coverage.north) - margin
            in_north = max(p.coverage.south, p.coverage.north) + margin
            
            if in_south <= lat <= in_north and in_west <= lng <= in_east:
                diff = abs(p.valid_time_start.timestamp() - target_dt.timestamp())
                if diff <= 3 * 3600:
                    if getattr(p, "is_estimated", False):
                        estimated_candidates.append((p, diff))
                    else:
                        authoritative_candidates.append((p, diff))

    matching_item = None
    if authoritative_candidates:
        matching_item = min(authoritative_candidates, key=lambda pair: pair[1])[0]
    elif estimated_candidates:
        matching_item = min(estimated_candidates, key=lambda pair: pair[1])[0]

    # If no product found in cache, run point fallback contract for wind/Open-Meteo
    if not matching_item:
        if domain.lower() == "wind" and layer.lower() == "wind":
            from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
            om_provider = OpenMeteoProvider()
            try:
                raw_point = await om_provider.fetch_point(model=model, domain=domain, layer=layer, lat=lat, lng=lng)
                if raw_point and "hourly" in raw_point and "time" in raw_point["hourly"]:
                    from services.weather_pipeline.normalizer import WeatherNormalizer
                    times = raw_point["hourly"]["time"]
                    idx = WeatherNormalizer.find_closest_time_index(times, target_dt)
                    if idx is not None:
                        speed = raw_point["hourly"]["wind_speed_10m"][idx]
                        direction = raw_point["hourly"]["wind_direction_10m"][idx]
                        gust = raw_point["hourly"].get("wind_gusts_10m", [None])[idx]
                        
                        import math
                        rad = direction * (math.pi / 180.0)
                        u = -speed * math.sin(rad)
                        v = -speed * math.cos(rad)
                        
                        from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse
                        detail = NormalizedPointDetail(
                            requested_lat=lat,
                            requested_lng=lng,
                            sampled_lat=lat,
                            sampled_lng=lng,
                            speed=round(speed, 4),
                            direction=round(direction, 2),
                            u=round(u, 4),
                            v=round(v, 4),
                            gust=round(gust, 4) if gust is not None else None,
                            interpolation_method="direct_point_api"
                        )
                        
                        upstream_model = om_provider.FORECAST_MODELS.get(model.upper(), "gfs_seamless")
                        
                        return NormalizedPointResponse(
                            model=model.upper(),
                            provider="open-meteo",
                            domain="wind",
                            layer="wind",
                            run_time=datetime.now(timezone.utc),
                            valid_time=target_dt,
                            is_forecast_authoritative=True,
                            is_estimated=False,
                            point=detail,
                            value_kind="wind_speed",
                            value_unit="kn",
                            display_unit_hint="kn",
                            source_variables=["wind_speed_10m", "wind_direction_10m"],
                            freshness_sec=1800,
                            source="provider_point_api",
                            coverage_status="outside_grid_tile",
                            fallback_attempted=True,
                            fallback_reason="Coordinate falls outside regional grid tile coverage, fell back to direct point query.",
                            upstream_provider="open-meteo",
                            upstream_model=upstream_model
                        )
            except Exception as ex:
                logger.error(f"[Point Fallback] Failed fetching point for {model} wind at ({lat}, {lng}): {ex}")
        elif domain.lower() == "marine" and layer.lower() in ("waves", "swell_1", "wind_waves") and model.upper() in ("GFS", "ICON"):
            from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
            om_provider = OpenMeteoProvider()
            try:
                raw_point = await om_provider.fetch_point(model=model, domain=domain, layer=layer, lat=lat, lng=lng)
                if raw_point and "hourly" in raw_point and "time" in raw_point["hourly"]:
                    from services.weather_pipeline.normalizer import WeatherNormalizer
                    times = raw_point["hourly"]["time"]
                    idx = WeatherNormalizer.find_closest_time_index(times, target_dt)
                    if idx is not None:
                        layer_vars = {
                            "waves": ("wave_height", "wave_direction", "wave_period"),
                            "swell_1": ("swell_wave_height", "swell_wave_direction", "swell_wave_period"),
                            "wind_waves": ("wind_wave_height", "wind_wave_direction", "wind_wave_period"),
                        }[layer.lower()]
                        
                        speed_key, dir_key, period_key = layer_vars
                        
                        speed = raw_point["hourly"][speed_key][idx]
                        direction = raw_point["hourly"][dir_key][idx]
                        period = raw_point["hourly"][period_key][idx]
                        
                        # Guard against None values
                        speed = speed if speed is not None else 0.0
                        direction = direction if direction is not None else 0.0
                        period = period if period is not None else 0.0
                        
                        import math
                        rad = direction * (math.pi / 180.0)
                        u = -speed * math.sin(rad)
                        v = -speed * math.cos(rad)
                        
                        from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse
                        detail = NormalizedPointDetail(
                            requested_lat=lat,
                            requested_lng=lng,
                            sampled_lat=lat,
                            sampled_lng=lng,
                            speed=round(speed, 4),
                            direction=round(direction, 2),
                            u=round(u, 4),
                            v=round(v, 4),
                            period=round(period, 2),
                            gust=None,
                            interpolation_method="direct_point_api"
                        )
                        
                        if model.upper() == "GFS":
                            upstream_model = "ncep_gfswave025"
                        elif model.upper() == "ICON":
                            upstream_model = "gwam"
                        else:
                            upstream_model = "gfs_seamless"
                            
                        value_kind = "wave_height"
                        value_unit = "m"
                        display_unit_hint = "ft"
                        units = {
                            "speed": "m",
                            "direction": "degrees",
                            "period": "seconds"
                        }
                        
                        return NormalizedPointResponse(
                            model=model.upper(),
                            provider="open-meteo",
                            domain="marine",
                            layer=layer.lower(),
                            run_time=datetime.now(timezone.utc),
                            valid_time=target_dt,
                            is_forecast_authoritative=True,
                            is_estimated=False,
                            point=detail,
                            value_kind=value_kind,
                            value_unit=value_unit,
                            display_unit_hint=display_unit_hint,
                            source_variables=list(layer_vars),
                            freshness_sec=1800,
                            source="provider_point_api",
                            coverage_status="outside_grid_tile",
                            fallback_attempted=True,
                            fallback_reason="Coordinate falls outside regional grid tile coverage, fell back to direct point query.",
                            upstream_provider="open-meteo",
                            upstream_model=upstream_model,
                            units=units
                        )
            except Exception as ex:
                logger.error(f"[Point Fallback] Failed fetching point for {model} marine at ({lat}, {lng}): {ex}")
        
        # If fallback not applicable or failed, return structured 404 response
        reason = "no_copernicus_coverage" if model.upper() == "EURO" else "no_backend_coverage"
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=404,
            content={
                "status": "error",
                "reason": reason,
                "detail": f"Authoritative weather point product not found for {model} {layer} at time {valid_time}.",
                "source": "provider_point_api",
                "coverage_status": "outside_grid_tile",
                "fallback_attempted": True,
                "fallback_reason": f"Coordinate falls outside regional grid tile bounds and point fallback failed or not allowed: {reason}",
                "is_forecast_authoritative": False,
                "is_estimated": False
            }
        )

    product = store.load_product(matching_item.filename)
    if not product:
        raise HTTPException(status_code=500, detail="Failed to load prepared grid from storage.")
    product.product_id = matching_item.filename

    # Perform Bilinear Interpolation
    response = sampler.sample_point(product, lat, lng)
    response.source = "grid_file"
    response.coverage_status = "inside_regional_tile"
    response.fallback_attempted = False
    response.fallback_reason = None
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
async def ingest_copernicus_only(admin=Depends(get_current_admin)):
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

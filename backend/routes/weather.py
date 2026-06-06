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
    NormalizedProduct, NormalizedPointResponse, PipelineManifest, CoverageBounds,
    NormalizedPointDetail
)
from services.weather_pipeline.dynamic_index import DynamicProductIndex

logger = logging.getLogger(__name__)

# Dynamic Viewport request deduplication registry
IN_FLIGHT_REQUESTS = {}
IN_FLIGHT_LOCK = asyncio.Lock()
dynamic_index = DynamicProductIndex()

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/weather")

# Instantiate Store and Sampler
store = ProductStore()
sampler = PointSampler()

@router.post("/ingest_public_trigger")
async def trigger_public_ingestion(background_tasks: BackgroundTasks):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    scheduler = WeatherPipelineScheduler(store=store)

    async def run_jobs():
        logger.info("[Public Ingestion] Triggering GFS Marine...")
        await scheduler.ingest_gfs_marine_pilot()
        logger.info("[Public Ingestion] Triggering ICON Marine...")
        await scheduler.ingest_icon_marine_pilot()
        logger.info("[Public Ingestion] Triggering EURO Estimates...")
        await scheduler.ingest_euro_marine_extended_estimates()
        logger.info("[Public Ingestion] Public ingestion complete.")

    background_tasks.add_task(run_jobs)
    return {"status": "public_ingestion_triggered"}

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

    # ── Stage 6J: Dynamic Viewport Coverage ──────────────────────────────
    # Check if we can satisfy this request using an existing manifest product
    use_manifest_product = False
    req_west, req_south, req_east, req_north = None, None, None, None
    if bbox:
        try:
            parts = [float(x) for x in bbox.split(",")]
            if len(parts) == 4:
                req_west, req_south, req_east, req_north = parts
        except ValueError:
            pass

    # Check manifest for matching products
    manifest = store.get_manifest()
    
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

    matching_manifest_item = select_best_candidate(authoritative_candidates)
    if not matching_manifest_item:
        matching_manifest_item = select_best_candidate(estimated_candidates)

    if matching_manifest_item and req_west is not None:
        cov = matching_manifest_item.coverage
        margin = 0.05
        
        lat_covers = (cov.south - margin) <= req_south and req_north <= (cov.north + margin)
        
        if cov.west <= cov.east:
            lon_covers = (cov.west - margin) <= req_west and req_east <= (cov.east + margin)
        else:
            lon_covers = (req_west >= cov.west - margin or req_west <= cov.east + margin) and \
                         (req_east >= cov.west - margin or req_east <= cov.east + margin)
                         
        if lat_covers and lon_covers:
            use_manifest_product = True

    is_viewport_enabled = (
        model.upper() == "GFS" and
        (
            (domain.lower() == "marine" and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")) or
            (domain.lower() == "wind" and layer.lower() == "wind")
        )
        and not use_manifest_product
    )
    if is_viewport_enabled and bbox:
        # 1. Parse bbox
        try:
            parts = [float(x) for x in bbox.split(",")]
            if len(parts) == 4:
                req_west, req_south, req_east, req_north = parts
            else:
                raise ValueError("bbox must contain exactly 4 floats")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid bbox parameter format: {e}")

        # Clamp polar boundaries
        south = max(-80.0, min(85.0, req_south))
        north = max(-80.0, min(85.0, req_north))
        
        # Clamp/wrap longitude boundaries
        # Normalize west/east to [-180, 180]
        west = req_west
        east = req_east
        while west < -180.0: west += 360.0
        while west > 180.0: west -= 360.0
        while east < -180.0: east += 360.0
        while east > 180.0: east -= 360.0

        # Calculate spans (taking into account antimeridian wrap)
        if west <= east:
            span_lng = east - west
        else:
            span_lng = (180.0 - west) + (east + 180.0)
        span_lat = abs(north - south)

        is_global_view = (span_lng > 180.0 or span_lat > 90.0)
        coverage_scope = "global_coarse" if is_global_view else "viewport"

        # Determine adaptive resolution
        import math
        est_res = math.sqrt((span_lng * span_lat) / 400.0)
        if est_res <= 0.25:
            resolution = 0.25
        elif est_res <= 0.5:
            resolution = 0.5
        elif est_res <= 1.0:
            resolution = 1.0
        elif est_res <= 2.0:
            resolution = 2.0
        elif est_res <= 2.5:
            resolution = 2.5
        elif est_res <= 5.0:
            resolution = 5.0
        else:
            resolution = 10.0

        # Generate a stable cache key
        time_str = target_dt.strftime("%Y%m%dT%H%M%SZ")
        bbox_key_str = f"{west:.2f}_{south:.2f}_{east:.2f}_{north:.2f}"
        cache_key = f"viewport_{model.lower()}_{domain.lower()}_{layer.lower()}_{time_str}_{bbox_key_str}"
        viewport_filename = f"{cache_key}.json"

        # 2. Check Dynamic Product Index
        cached_entry = dynamic_index.find_product(
            model=model, domain=domain, layer=layer, valid_time=target_dt, cache_key=cache_key
        )

        loaded_product = None
        if cached_entry:
            # Try to load the file
            loaded_product = store.load_product(cached_entry["product_id"])
            if loaded_product:
                logger.info(f"[Dynamic Viewport] Cache HIT for {viewport_filename}")
                loaded_product.cache_hit = "cache_hit"
                loaded_product.resolution = cached_entry.get("resolution")
                # Update diagnostics in the response
                if loaded_product.grid:
                    loaded_product.grid.diagnostics = {
                        "requested_bbox": bbox,
                        "served_bbox": cached_entry["served_bbox"],
                        "coverage_scope": cached_entry["coverage_scope"],
                        "source_product_ids": [cached_entry["product_id"]],
                        "cache_hit": "cache_hit",
                        "provider": cached_entry["source"],
                        "model": model,
                        "domain": domain,
                        "layer": layer,
                        "valid_time": valid_time,
                        "nonzeroCount": loaded_product.grid.diagnostics.get("nonzeroCount", 0) if loaded_product.grid.diagnostics else 0,
                        "vectors_length": len(loaded_product.grid.vectors) if loaded_product.grid.vectors else 0,
                        "gridMode": "rectangular",
                        "renderable": loaded_product.grid.diagnostics.get("renderable", True) if loaded_product.grid.diagnostics else True
                    }
                return loaded_product

        # Cache MISS or load failed — Fetch dynamically
        logger.info(f"[Dynamic Viewport] Cache MISS for {viewport_filename}. Fetching dynamically.")

        # Deduplicate requests in-flight
        request_dedup_key = f"{model.lower()}_{domain.lower()}_{layer.lower()}_{time_str}_{bbox_key_str}"
        my_future = None
        is_fetcher = False

        async with IN_FLIGHT_LOCK:
            if request_dedup_key in IN_FLIGHT_REQUESTS:
                my_future = IN_FLIGHT_REQUESTS[request_dedup_key]
            else:
                my_future = asyncio.Future()
                IN_FLIGHT_REQUESTS[request_dedup_key] = my_future
                is_fetcher = True

        if not is_fetcher:
            logger.info(f"[Dynamic Viewport] Sharing in-flight request for {request_dedup_key}")
            try:
                result_filename = await my_future
                loaded_product = store.load_product(result_filename)
                if loaded_product:
                    loaded_product.cache_hit = "cache_hit"  # Shared from fetcher
                    return loaded_product
            except Exception as e:
                logger.error(f"[Dynamic Viewport] Shared in-flight fetch failed: {e}")
                raise HTTPException(status_code=504, detail="Upstream weather request failed (shared).")

        try:
            # We are the fetcher! Let's generate coordinates
            # Handle antimeridian wraps safely in generate_grid_coords
            from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
            
            # Helper to generate lats/lons crossing antimeridian
            def get_bbox_coords(w, s, e, n, res):
                lats_list = []
                lons_list = []
                crosses = w > e
                lat_val = s
                while lat_val <= n + 0.0001:
                    if crosses:
                        lon_val = w
                        while lon_val <= 180.0 + 0.0001:
                            lats_list.append(round(lat_val, 4))
                            lons_list.append(round(lon_val - 360.0 if lon_val > 180.0 else lon_val, 4))
                            lon_val += res
                        lon_val = -180.0
                        while lon_val <= e + 0.0001:
                            lats_list.append(round(lat_val, 4))
                            lons_list.append(round(lon_val, 4))
                            lon_val += res
                    else:
                        lon_val = w
                        while lon_val <= e + 0.0001:
                            lats_list.append(round(lat_val, 4))
                            lons_list.append(round(lon_val, 4))
                            lon_val += res
                    lat_val += res
                return lats_list, lons_list

            lats_coords, lons_coords = get_bbox_coords(west, south, east, north, resolution)
            coord_count = len(lats_coords)

            # Safety step-up for coordinate count
            resolution_steps = [0.25, 0.5, 1.0, 2.0, 2.5, 5.0, 10.0]
            while coord_count > 800 and resolution != 10.0:
                idx = resolution_steps.index(resolution)
                resolution = resolution_steps[min(len(resolution_steps) - 1, idx + 1)]
                lats_coords, lons_coords = get_bbox_coords(west, south, east, north, resolution)
                coord_count = len(lats_coords)

            logger.info(f"[Dynamic Viewport] Fetching coordinates count: {coord_count} at resolution {resolution}°")

            # Monkeypatch coordinates generation and delay during dynamic user fetch
            original_generate = OpenMeteoProvider.generate_grid_coords
            OpenMeteoProvider.generate_grid_coords = staticmethod(lambda b, r: (lats_coords, lons_coords))
            
            bbox_dict = {"west": west, "south": south, "east": east, "north": north}
            days_diff = (target_dt - datetime.now(timezone.utc)).days + 2
            forecast_days = max(2, min(16, days_diff))

            from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
            om_provider = OpenMeteoProvider()

            import services.weather_pipeline.providers.open_meteo_provider as omp_module
            original_sleep = omp_module.asyncio.sleep
            
            try:
                # Sleep only 0.1s during dynamic user fetches
                omp_module.asyncio.sleep = lambda d: original_sleep(0.1)
                
                raw_data = await om_provider.fetch_grid(
                    model=model,
                    domain=domain,
                    layer=layer,
                    bbox=bbox_dict,
                    resolution=resolution,
                    forecast_days=forecast_days
                )
            finally:
                omp_module.asyncio.sleep = original_sleep
                OpenMeteoProvider.generate_grid_coords = original_generate

            if not raw_data:
                logger.error(f"[Dynamic Viewport] Upstream fetch returned empty data.")
                raise HTTPException(status_code=504, detail="Weather data fetch from Open-Meteo failed.")

            # Normalize raw data
            from services.weather_pipeline.normalizer import WeatherNormalizer
            normalizer = WeatherNormalizer()
            raw_list = raw_data if isinstance(raw_data, list) else [raw_data]

            normalized_product = normalizer.normalize(
                model=model,
                provider="open-meteo",
                domain=domain,
                layer=layer,
                raw_results=raw_list,
                bbox=bbox_dict,
                resolution=resolution,
                target_time=target_dt,
                coverage_mode="viewport",
                region_id=f"viewport_{bbox_key_str}"
            )

            if not normalized_product:
                logger.error(f"[Dynamic Viewport] Normalization failed.")
                raise HTTPException(status_code=500, detail="Grid normalization failed.")

            # Update conformed metadata
            served_bbox = f"{normalized_product.grid.bounds.west},{normalized_product.grid.bounds.south},{normalized_product.grid.bounds.east},{normalized_product.grid.bounds.north}"
            
            normalized_product.product_id = viewport_filename
            normalized_product.is_dynamic_viewport_product = True
            normalized_product.cache_key = cache_key
            normalized_product.cache_hit = "cache_miss"
            normalized_product.requested_bbox = bbox
            normalized_product.served_bbox = served_bbox
            normalized_product.coverage_scope = coverage_scope
            normalized_product.coordinate_count = coord_count
            normalized_product.resolution = resolution

            # Populate diagnostics in the response
            if normalized_product.grid:
                normalized_product.grid.diagnostics = {
                    "requested_bbox": bbox,
                    "served_bbox": served_bbox,
                    "coverage_scope": coverage_scope,
                    "source_product_ids": ["open-meteo"],
                    "cache_hit": "cache_miss",
                    "provider": "open-meteo",
                    "model": model,
                    "domain": domain,
                    "layer": layer,
                    "valid_time": valid_time,
                    "nonzeroCount": normalized_product.grid.diagnostics.get("nonzeroCount", 0) if normalized_product.grid.diagnostics else 0,
                    "vectors_length": len(normalized_product.grid.vectors) if normalized_product.grid.vectors else 0,
                    "gridMode": "rectangular",
                    "renderable": normalized_product.grid.diagnostics.get("renderable", True) if normalized_product.grid.diagnostics else True
                }

            # Save to disk L1 cache and upload L2 (excluding manifest.json)
            filepath = store.cache_dir / viewport_filename
            tmp_filepath = filepath.with_suffix(".tmp")
            try:
                product_json_bytes = normalized_product.model_dump_json().encode("utf-8")
                with open(tmp_filepath, "wb") as f:
                    f.write(product_json_bytes)
                os.replace(tmp_filepath, filepath)
                
                # Upload to L2 if connected
                store._upload_to_supabase(viewport_filename, product_json_bytes)
            except Exception as se:
                logger.error(f"[Dynamic Viewport] Failed to save dynamic conformed product file: {se}")

            # Register in Dynamic Product Index
            dynamic_index.add_product(
                product_id=viewport_filename,
                model=model,
                domain=domain,
                layer=layer,
                valid_time=target_dt,
                requested_bbox=bbox,
                served_bbox=served_bbox,
                coverage_scope=coverage_scope,
                resolution=resolution,
                cache_key=cache_key,
                source="open-meteo"
            )

            # Acknowledge completion to shared listeners
            async with IN_FLIGHT_LOCK:
                my_future.set_result(viewport_filename)
                IN_FLIGHT_REQUESTS.pop(request_dedup_key, None)

            return normalized_product

        except Exception as e:
            # Reject shared listeners
            async with IN_FLIGHT_LOCK:
                if request_dedup_key in IN_FLIGHT_REQUESTS:
                    IN_FLIGHT_REQUESTS[request_dedup_key].set_exception(e)
                    IN_FLIGHT_REQUESTS.pop(request_dedup_key, None)
            raise e



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
    valid_time: str = Query(..., description="ISO-8601 UTC timestamp"),
    grid_product_id: Optional[str] = Query(None, description="The exact grid product to sample from")
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

    # 1. If grid_product_id is passed, load that exact product strictly.
    if grid_product_id:
        product = store.load_product(grid_product_id)
        if not product or not product.grid or not product.grid.vectors:
            detail = NormalizedPointDetail(
                requested_lat=lat,
                requested_lng=lng,
                sampled_lat=lat,
                sampled_lng=lng,
                speed=0.0,
                direction=0.0,
                u=0.0,
                v=0.0,
                period=0.0,
                gust=None,
                value=None,
                interpolation_method="no_coverage"
            )
            return NormalizedPointResponse(
                model=model.upper(),
                provider="none",
                domain=domain,
                layer=layer,
                run_time=datetime.now(timezone.utc),
                valid_time=target_dt,
                is_forecast_authoritative=False,
                is_estimated=False,
                point=detail,
                value_kind="wave_height" if domain.lower() == "marine" else "wind_speed",
                value_unit="m" if domain.lower() == "marine" else "kn",
                display_unit_hint="ft" if domain.lower() == "marine" else "kn",
                product_id=grid_product_id,
                source="grid_file",
                coverage_status="out_of_bounds",
                fallback_attempted=False,
                fallback_reason="Grid product not found or empty grid.",
                grid_parity=True,
                gridParity=True,
                source_variables=[],
                freshness_sec=1800
            )

        # Enforce served_bbox containment checks strictly
        bounds = product.grid.bounds
        margin = 0.01
        in_lat = (bounds.south - margin) <= lat <= (bounds.north + margin)
        if bounds.west <= bounds.east:
            in_lng = (bounds.west - margin) <= lng <= (bounds.east + margin)
        else:
            in_lng = lng >= (bounds.west - margin) or lng <= (bounds.east + margin)

        if not (in_lat and in_lng):
            detail = NormalizedPointDetail(
                requested_lat=lat,
                requested_lng=lng,
                sampled_lat=lat,
                sampled_lng=lng,
                speed=0.0,
                direction=0.0,
                u=0.0,
                v=0.0,
                period=0.0,
                gust=None,
                value=None,
                interpolation_method="out_of_bounds"
            )
            return NormalizedPointResponse(
                model=product.model,
                provider=product.provider,
                domain=product.domain,
                layer=product.layer,
                run_time=product.run_time,
                valid_time=product.valid_time,
                is_forecast_authoritative=False,
                is_estimated=product.is_estimated,
                point=detail,
                value_kind=product.value_kind,
                value_unit=product.value_unit,
                display_unit_hint=product.display_unit_hint,
                product_id=grid_product_id,
                source="grid_file",
                coverage_status="out_of_bounds",
                fallback_attempted=False,
                fallback_reason="Requested point is outside the bounding box of the specified grid product.",
                is_dynamic_viewport_product=getattr(product, "is_dynamic_viewport_product", False),
                cache_key=getattr(product, "cache_key", None),
                cache_hit=getattr(product, "cache_hit", None),
                requested_bbox=getattr(product, "requested_bbox", None),
                served_bbox=getattr(product, "served_bbox", None),
                coverage_scope=getattr(product, "coverage_scope", None),
                coordinate_count=getattr(product, "coordinate_count", None),
                grid_parity=True,
                gridParity=True,
                source_variables=product.source_variables or [],
                freshness_sec=product.freshness_sec or 1800
            )

        response = sampler.sample_point(product, lat, lng)
        response.product_id = grid_product_id
        response.source = "grid_file"
        response.coverage_status = "inside_served_bbox"
        response.fallback_attempted = False
        response.fallback_reason = None
        response.is_dynamic_viewport_product = getattr(product, "is_dynamic_viewport_product", False)
        response.cache_key = getattr(product, "cache_key", None)
        response.cache_hit = getattr(product, "cache_hit", None)
        response.requested_bbox = getattr(product, "requested_bbox", None)
        response.served_bbox = getattr(product, "served_bbox", None)
        response.coverage_scope = getattr(product, "coverage_scope", None)
        response.coordinate_count = getattr(product, "coordinate_count", None)
        response.grid_parity = True
        response.gridParity = True
        return response

    # 2. If grid_product_id is missing, check DynamicProductIndex first.
    dynamic_match = dynamic_index.find_product_containing(
        model=model, domain=domain, layer=layer, valid_time=target_dt, lat=lat, lng=lng
    )
    if dynamic_match:
        product = store.load_product(dynamic_match["product_id"])
        if product:
            response = sampler.sample_point(product, lat, lng)
            response.product_id = dynamic_match["product_id"]
            response.source = "grid_file"
            response.coverage_status = "inside_served_bbox"
            response.fallback_attempted = False
            response.fallback_reason = None
            response.is_dynamic_viewport_product = True
            response.cache_key = dynamic_match.get("cache_key")
            response.cache_hit = "cache_hit"
            response.requested_bbox = dynamic_match.get("requested_bbox")
            response.served_bbox = dynamic_match.get("served_bbox")
            response.coverage_scope = dynamic_match.get("coverage_scope")
            response.coordinate_count = dynamic_match.get("coordinate_count")
            response.grid_parity = True
            response.gridParity = True
            return response

    # 3. Check scheduled products in the manifest
    manifest = store.get_manifest()
    authoritative_candidates = []
    estimated_candidates = []

    for p in manifest.products:
        if (
            p.model.upper() == model.upper()
            and p.domain.lower() == domain.lower()
            and p.layer.lower() == layer.lower()
        ):
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

    if matching_item:
        product = store.load_product(matching_item.filename)
        if product:
            response = sampler.sample_point(product, lat, lng)
            response.product_id = matching_item.filename
            response.source = "grid_file"
            response.coverage_status = "inside_regional_tile"
            response.fallback_attempted = False
            response.fallback_reason = None
            response.grid_parity = True
            response.gridParity = True
            return response

    # 4. Fallback to direct point query
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
                        source="backend_direct_point",
                        coverage_status="outside_grid_tile",
                        fallback_attempted=True,
                        fallback_reason="no_matching_grid_product",
                        upstream_provider="open-meteo",
                        upstream_model=upstream_model,
                        grid_parity=False,
                        gridParity=False
                    )
        except Exception as ex:
            logger.error(f"[Point Fallback] Failed fetching point for {model} wind at ({lat}, {lng}): {ex}")

    elif domain.lower() == "marine" and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves") and model.upper() in ("GFS", "ICON"):
        from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
        om_provider = OpenMeteoProvider()
        try:
            raw_point = await om_provider.fetch_point(model=model, domain=domain, layer=layer, lat=lat, lng=lng)
            if raw_point and "hourly" in raw_point and "time" in raw_point["hourly"]:
                from services.weather_pipeline.normalizer import WeatherNormalizer
                times = raw_point["hourly"]["time"]
                idx = WeatherNormalizer.find_closest_time_index(times, target_dt)
                if idx is not None:
                    if layer.lower() == "waves":
                        layer_vars = ("wave_height", "wave_direction", "wave_period")
                    elif layer.lower() == "swell_1":
                        layer_vars = ("swell_wave_height", "swell_wave_direction", "swell_wave_period")
                    elif layer.lower() == "swell_2":
                        if model.upper() == "ICON":
                            layer_vars = ("swell_wave_height", "swell_wave_direction", "swell_wave_period")
                        else:
                            layer_vars = ("secondary_swell_wave_height", "secondary_swell_wave_direction", "secondary_swell_wave_period")
                    elif layer.lower() == "wind_waves":
                        layer_vars = ("wind_wave_height", "wind_wave_direction", "wind_wave_period")
                    else:
                        layer_vars = ("wave_height", "wave_direction", "wave_period")
                    
                    speed_key, dir_key, period_key = layer_vars
                    
                    speed = raw_point["hourly"][speed_key][idx]
                    direction = raw_point["hourly"][dir_key][idx]
                    period = raw_point["hourly"][period_key][idx]
                    
                    speed = speed if speed is not None else 0.0
                    direction = direction if direction is not None else 0.0
                    period = period if period is not None else 0.0
                    
                    import math
                    rad = direction * (math.pi / 180.0)
                    u = -speed * math.sin(rad)
                    v = -speed * math.cos(rad)
                    
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
                        source="backend_direct_point",
                        coverage_status="outside_grid_tile",
                        fallback_attempted=True,
                        fallback_reason="no_matching_grid_product",
                        upstream_provider="open-meteo",
                        upstream_model=upstream_model,
                        units=units,
                        grid_parity=False,
                        gridParity=False
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
            "source": "backend_direct_point",
            "coverage_status": "outside_grid_tile",
            "fallback_attempted": True,
            "fallback_reason": "no_matching_grid_product",
            "is_forecast_authoritative": False,
            "is_estimated": False,
            "grid_parity": False,
            "gridParity": False
        }
    )

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

from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Depends
from fastapi.responses import JSONResponse
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
    NormalizedProduct, NormalizedPointResponse
)
from services.weather_pipeline.dynamic_index import DynamicProductIndex
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider

# Import extracted helpers/services
from services.weather_pipeline.route_helpers import (
    parse_valid_time, parse_bbox, is_bbox_covered_by, filter_grid_to_bbox,
    make_unsupported_icon_swell2_grid_response, make_no_coverage_grid_response,
    compute_truth_tag
)
from services.weather_pipeline.product_selection import select_best_candidate
from services.weather_pipeline.viewport_service import ViewportService
from services.weather_pipeline.point_resolution import PointResolutionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/weather")

# Instantiate Store and Sampler
store = ProductStore()
dynamic_index = DynamicProductIndex()
sampler = PointSampler()
provider = OpenMeteoProvider()

# Service Instances with dependency injection
viewport_service = ViewportService(
    provider=provider
)
point_resolution_service = PointResolutionService(
    sampler=sampler,
    provider=provider
)

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
    model: str = Query(..., pattern="^(GFS|ICON|EURO)$"),
    domain: str = Query(..., pattern="^(marine|wind|weather)$"),
    layer: str = Query(..., pattern="^(waves|swell_1|swell_2|wind_waves|wind|pressure|precipitation)$"),
    valid_time: str = Query(..., description="ISO-8601 UTC timestamp"),
    bbox: Optional[str] = Query(None, description="west,south,east,north boundary filter")
):
    """
    GET /api/weather/grid
    Returns a compact normalized coordinate grid ready for WebGL rendering.
    Enforces dynamic bounding-box coordinate filtering to conserve bandwidth.
    """
    # Parse target timestamp
    target_dt = parse_valid_time(valid_time)

    # Immediate rejection for unsupported layer
    if model.upper() == "ICON" and layer.lower() == "swell_2":
        return make_unsupported_icon_swell2_grid_response(domain, target_dt)

    # Parse bounding box values if provided
    req_w, req_s, req_e, req_n = None, None, None, None
    if bbox:
        req_w, req_s, req_e, req_n = parse_bbox(bbox)

    # 1. Search the manifest for candidate products covering the target time
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

    # Match best candidate from registry
    matching_manifest_item = select_best_candidate(
        authoritative_candidates, estimated_candidates, req_w, req_s, req_e, req_n
    )

    use_manifest_product = False
    if matching_manifest_item:
        cov = matching_manifest_item.coverage
        if cov.west <= cov.east:
            regional_span_lng = cov.east - cov.west
        else:
            regional_span_lng = (180.0 - cov.west) + (cov.east + 180.0)
        regional_span_lat = abs(cov.north - cov.south)

        is_regional = regional_span_lng < 350.0

        if req_w is not None:
            # Check requested bbox span
            if req_w <= req_e:
                req_span_lng = req_e - req_w
            else:
                req_span_lng = (180.0 - req_w) + (req_e + 180.0)
            req_span_lat = abs(req_n - req_s)

            # If requested viewport is wider than the regional tile, dynamic viewport must win.
            is_wider_lng = req_span_lng > (regional_span_lng + 0.05)
            is_wider_lat = req_span_lat > (regional_span_lat + 0.05)
            is_wider = is_wider_lng or is_wider_lat
            is_covered = is_bbox_covered_by(req_w, req_s, req_e, req_n, cov, margin=0.05)

            if is_covered and not is_wider:
                use_manifest_product = True
        else:
            # If no bbox coordinates provided, serve manifest product by default
            use_manifest_product = True

        if is_regional and not use_manifest_product:
            matching_manifest_item = None

    # 2. Check if we should fetch a dynamic viewport grid instead of manifest product
    if viewport_service.is_viewport_enabled(model, domain, layer, use_manifest_product, bbox):
        product = await viewport_service.fetch_viewport_grid(model, domain, layer, valid_time, target_dt, bbox)
    else:
        # 3. Serve the manifest product grid if found
        if not matching_manifest_item:
            return make_no_coverage_grid_response(model, layer, valid_time)

        product = store.load_product(matching_manifest_item.filename)
        if not product or not product.grid:
            raise HTTPException(status_code=500, detail="Failed to load prepared grid from storage.")
        product.product_id = matching_manifest_item.filename

        # Set coverage metadata
        cov = matching_manifest_item.coverage
        if cov.west <= cov.east:
            span_lng = cov.east - cov.west
        else:
            span_lng = (180.0 - cov.west) + (cov.east + 180.0)

        if span_lng >= 350.0:
            product.coverage_scope = "global"
        else:
            product.coverage_scope = "regional"

        # Crop the conformed product's grid vectors to match requested bbox boundaries
        if bbox:
            product = filter_grid_to_bbox(product, bbox)

    # Attach truthTag for GFS marine waves
    if model.upper() == "GFS" and domain.lower() == "marine" and layer.lower() == "waves":
        if isinstance(product, NormalizedProduct):
            product.truthTag = compute_truth_tag(
                model=product.model,
                domain=product.domain,
                layer=product.layer,
                valid_time=product.valid_time,
                run_time=product.run_time,
                product_id=product.product_id,
                provider=product.provider,
                upstream_model=product.upstream_model,
                is_dynamic_viewport_product=product.is_dynamic_viewport_product,
                coverage_scope=product.coverage_scope,
                requested_bbox=product.requested_bbox,
                served_bbox=product.served_bbox,
                cols=product.grid.cols if product.grid else 0,
                rows=product.grid.rows if product.grid else 0,
                vectors=product.grid.vectors if product.grid else []
            )

    return product

@router.get("/point", response_model=NormalizedPointResponse)
async def get_point(
    model: str = Query(..., pattern="^(GFS|ICON|EURO)$"),
    domain: str = Query(..., pattern="^(marine|wind|weather)$"),
    layer: str = Query(..., pattern="^(waves|swell_1|swell_2|wind_waves|wind|pressure|precipitation)$"),
    lat: float = Query(..., description="Latitude coordinate"),
    lng: float = Query(..., description="Longitude coordinate"),
    valid_time: str = Query(..., description="ISO-8601 UTC timestamp"),
    grid_product_id: Optional[str] = Query(None, description="The exact grid product to sample from"),
    grid_bbox: Optional[str] = Query(None, description="The client's viewport grid bbox")
):
    """
    GET /api/weather/point
    Samples from the exact same cached product grid used for heatmaps, ensuring parity.
    """
    response = await point_resolution_service.resolve_point(
        model=model,
        domain=domain,
        layer=layer,
        lat=lat,
        lng=lng,
        valid_time_str=valid_time,
        grid_product_id=grid_product_id,
        grid_bbox=grid_bbox
    )

    if model.upper() == "GFS" and domain.lower() == "marine" and layer.lower() == "waves":
        sampled_product_id = None
        source = None
        
        if isinstance(response, NormalizedPointResponse):
            sampled_product_id = response.product_id
            source = response.source
        elif isinstance(response, JSONResponse):
            import json
            try:
                body_dict = json.loads(response.body.decode("utf-8"))
                sampled_product_id = body_dict.get("product_id")
                source = body_dict.get("source")
            except Exception:
                body_dict = {}
        else:
            return response

        truth_tag = None
        if sampled_product_id:
            product = store.load_product(sampled_product_id)
            if product and product.grid:
                # 1. Compute sourceTruthTag of the original uncropped product
                source_truth_tag = compute_truth_tag(
                    model=product.model,
                    domain=product.domain,
                    layer=product.layer,
                    valid_time=product.valid_time,
                    run_time=product.run_time,
                    product_id=product.product_id,
                    provider=product.provider,
                    upstream_model=product.upstream_model,
                    is_dynamic_viewport_product=product.is_dynamic_viewport_product,
                    coverage_scope=product.coverage_scope,
                    requested_bbox=product.requested_bbox,
                    served_bbox=product.served_bbox,
                    cols=product.grid.cols,
                    rows=product.grid.rows,
                    vectors=product.grid.vectors,
                    source_stage="sourceResponse"
                )

                # 2. Crop the product if grid_bbox is provided
                cropped_product = product
                if grid_bbox:
                    cropped_product = filter_grid_to_bbox(product, grid_bbox)

                # 3. Compute cropped truth tag
                crop_truth_tag = compute_truth_tag(
                    model=cropped_product.model,
                    domain=cropped_product.domain,
                    layer=cropped_product.layer,
                    valid_time=cropped_product.valid_time,
                    run_time=cropped_product.run_time,
                    product_id=cropped_product.product_id,
                    provider=cropped_product.provider,
                    upstream_model=cropped_product.upstream_model,
                    is_dynamic_viewport_product=cropped_product.is_dynamic_viewport_product,
                    coverage_scope=cropped_product.coverage_scope,
                    requested_bbox=cropped_product.requested_bbox,
                    served_bbox=cropped_product.served_bbox,
                    cols=cropped_product.grid.cols if cropped_product.grid else 0,
                    rows=cropped_product.grid.rows if cropped_product.grid else 0,
                    vectors=cropped_product.grid.vectors if cropped_product.grid else [],
                    source_stage="pointResponse"
                )

                # 4. Check if hashes and bounds match
                hashes_match = (
                    source_truth_tag["dataHash"] == crop_truth_tag["dataHash"]
                    and source_truth_tag["boundsHash"] == crop_truth_tag["boundsHash"]
                )

                if hashes_match:
                    truth_tag = crop_truth_tag
                else:
                    truth_tag = crop_truth_tag.copy()
                    truth_tag["sourceTruthTag"] = source_truth_tag
                    truth_tag["sampledTruthTag"] = crop_truth_tag
                    truth_tag["cropTruthTag"] = crop_truth_tag
                    truth_tag["parentProductId"] = product.product_id

        is_match = False
        mismatch_reason = None
        if grid_product_id:
            if source == "grid_file" and sampled_product_id == grid_product_id:
                is_match = True
            else:
                is_match = False
                mismatch_reason = f"Sampled from source={source}, product={sampled_product_id} but expected grid_product_id={grid_product_id}"
        else:
            if source == "grid_file":
                is_match = True
            else:
                is_match = False
                mismatch_reason = f"Sampled from source={source} (no grid_product_id requested)"

        grid_parity_dict = {
            "status": "MATCH" if is_match else "MISMATCH",
            "mismatchReason": mismatch_reason
        }

        if isinstance(response, NormalizedPointResponse):
            response.truthTag = truth_tag
            response.gridPointParity = grid_parity_dict
            response.mismatchReason = mismatch_reason
            return response
        else:
            body_dict["truthTag"] = truth_tag
            body_dict["gridPointParity"] = grid_parity_dict
            body_dict["mismatchReason"] = mismatch_reason
            return JSONResponse(status_code=response.status_code, content=body_dict)

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

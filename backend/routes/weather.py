from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Depends
from fastapi.responses import JSONResponse
from datetime import datetime, timezone, timedelta
from deps.admin_auth import get_current_admin
from typing import Optional, List
import logging
import os
import psutil
import asyncio

from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedPointResponse, ClientDiagnosticReport
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


@router.get("/products")
async def get_products():
    """
    GET /api/weather/products
    Returns the current manifest registry listing available prepared weather products.
    """
    import os
    manifest = await asyncio.to_thread(store.get_manifest)
    def get_disk_files():
        return os.listdir(store.cache_dir) if os.path.exists(store.cache_dir) else []
    files = await asyncio.to_thread(get_disk_files)
    return {
        "last_manifest_update": manifest.last_manifest_update,
        "products": manifest.products,
        "files_on_disk": files,
        "cache_dir": str(store.cache_dir)
    }


def calculate_bbox_intersection_area(w1: float, s1: float, e1: float, n1: float, w2: float, s2: float, e2: float, n2: float) -> float:
    """Calculates the intersection area of two bounding boxes."""
    from services.weather_pipeline.product_selection import bbox_intersection_area
    from collections import namedtuple
    SimpleCov = namedtuple("SimpleCov", ["west", "south", "east", "north"])
    return bbox_intersection_area(w1, s1, e1, n1, SimpleCov(w2, s2, e2, n2))


@router.get("/grid", response_model=NormalizedProduct)
async def get_grid(
    model: str = Query(..., pattern="^(GFS|ICON|EURO)$"),
    domain: str = Query(..., pattern="^(marine|wind|weather)$"),
    layer: str = Query(..., pattern="^(waves|swell_1|swell_2|wind_waves|wind|pressure|precipitation)$"),
    valid_time: str = Query(..., description="ISO-8601 UTC timestamp"),
    bbox: Optional[str] = Query(None, description="west,south,east,north boundary filter"),
    background_tasks: BackgroundTasks = None
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
    manifest = await asyncio.to_thread(store.get_manifest)
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

    manifest_preview_item = None
    use_manifest_product = False
    regional_span_lng = 0.0
    if matching_manifest_item:
        cov = matching_manifest_item.coverage
        if cov.west <= cov.east:
            regional_span_lng = cov.east - cov.west
        else:
            regional_span_lng = (180.0 - cov.west) + (cov.east + 180.0)
        regional_span_lat = abs(cov.north - cov.south)

        is_regional = regional_span_lng < 350.0

        if is_regional:
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
        else:
            # It's a global conformed manifest product (regional_span_lng >= 350.0).
            # If the user is requesting a global view (large span), directly serve this global manifest product.
            if req_w is not None:
                if req_w <= req_e:
                    req_span_lng = req_e - req_w
                else:
                    req_span_lng = (180.0 - req_w) + (req_e + 180.0)
                req_span_lat = abs(req_n - req_s)
                if req_span_lng > 180.0 or req_span_lat > 90.0:
                    use_manifest_product = True
                elif model.upper() == "ICON" and domain.lower() == "wind":
                    # Compute dynamic boundary for the maximum 5-day calendar forecast range of ICON
                    today_utc = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
                    max_icon_wind_dynamic_dt = today_utc + timedelta(days=5)
                    if target_dt >= max_icon_wind_dynamic_dt:
                        use_manifest_product = True
                else:
                    # Zooms closer in: do NOT use the coarse global manifest product.
                    use_manifest_product = False
            else:
                use_manifest_product = True

        if not use_manifest_product:
            if not is_regional or is_covered:
                manifest_preview_item = matching_manifest_item
            matching_manifest_item = None


    # Step-wise product resolution
    product = None
    
    # Step 1 & 2: Exact/fresh or stale dynamic cache hit for snapped viewport
    if bbox and viewport_service.is_viewport_enabled(model, domain, layer, False, bbox):
        product = await viewport_service.get_cached_dynamic_product(
            model=model, domain=domain, layer=layer, target_dt=target_dt, bbox_str=bbox
        )

    # Step 3: Durable manifest full coverage
    if not product:
        if use_manifest_product and matching_manifest_item:
            product = await asyncio.to_thread(store.load_product, matching_manifest_item.filename)
            if product and product.grid:
                product.product_id = matching_manifest_item.filename
                product.coverage_scope = "global" if regional_span_lng >= 350.0 else "regional"
                product.partial_coverage = False
                product.requested_bbox_original = bbox
                product.query_bbox = bbox
                product.requested_bbox = bbox
                product.coverage_mode = getattr(matching_manifest_item, "coverage_mode", None)
                if not product.coverage_mode:
                    product.coverage_mode = "global_tile" if regional_span_lng >= 350.0 else "regional_tile"
                if bbox and product.coverage_mode != "global_tile" and domain.lower() != "wind":
                    product = filter_grid_to_bbox(product, bbox)
                if product.grid and product.grid.bounds:
                    product.served_bbox = f"{product.grid.bounds.west:.4f},{product.grid.bounds.south:.4f},{product.grid.bounds.east:.4f},{product.grid.bounds.north:.4f}"

    # Step 3.5: Fast manifest preview (SWR)
    from services.weather_pipeline.store import is_test_environment
    if not product and manifest_preview_item and not is_test_environment():
        file_path = store.cache_dir / manifest_preview_item.filename
        file_exists = await asyncio.to_thread(file_path.exists)
        if file_exists:
            logger.info(f"[Grid Route] Serving conformed manifest item {manifest_preview_item.filename} as instant SWR preview")
            product = await asyncio.to_thread(store.load_product, manifest_preview_item.filename)
            if product and product.grid:
                product.product_id = manifest_preview_item.filename
                product.coverage_mode = getattr(manifest_preview_item, "coverage_mode", None)
                if not product.coverage_mode:
                    product.coverage_mode = "global_tile" if regional_span_lng >= 350.0 else "regional_tile"
                if regional_span_lng >= 350.0:
                    product.coverage_scope = "global_coarse"
                    product.partial_coverage = False
                else:
                    if use_manifest_product:
                        product.coverage_scope = "regional"
                        product.partial_coverage = False
                    else:
                        product.coverage_scope = "regional_partial"
                        product.partial_coverage = True
                product.requested_bbox_original = bbox
                product.query_bbox = bbox
                product.requested_bbox = bbox
                product.stale = True
                product.staleReason = "swr_revalidation_pending"
                if bbox and product.coverage_mode != "global_tile" and domain.lower() != "wind":
                    product = filter_grid_to_bbox(product, bbox)
                if product.grid and product.grid.bounds:
                    product.served_bbox = f"{product.grid.bounds.west:.4f},{product.grid.bounds.south:.4f},{product.grid.bounds.east:.4f},{product.grid.bounds.north:.4f}"
                if bbox and viewport_service.is_viewport_enabled(model, domain, layer, False, bbox):
                    reval_key = f"{model.lower()}_{domain.lower()}_{layer.lower()}_{valid_time}_{bbox}"
                    if reval_key not in viewport_service.ACTIVE_REVALIDATIONS:
                        viewport_service.ACTIVE_REVALIDATIONS.add(reval_key)
                        if background_tasks:
                            background_tasks.add_task(
                                viewport_service._revalidate_fetch,
                                model, domain, layer, valid_time, target_dt, bbox, reval_key
                            )
                        else:
                            asyncio.create_task(
                                viewport_service._revalidate_fetch(
                                    model, domain, layer, valid_time, target_dt, bbox, reval_key
                                )
                            )

    # Step 4 & 5: Upstream dynamic fetch & stale fallback
    if not product:
        if bbox and viewport_service.is_viewport_enabled(model, domain, layer, False, bbox):
            try:
                # For ICON wind, dynamic viewport fetch is supported beyond 5-day limit by loop-extrapolation inside fetch_viewport_grid_upstream.

                product = await viewport_service.fetch_viewport_grid_upstream(
                    model=model, domain=domain, layer=layer, valid_time_str=valid_time, target_dt=target_dt, bbox_str=bbox
                )
            except Exception as dynamic_err:
                logger.warning(f"[Grid Route] Dynamic viewport upstream fetch failed: {dynamic_err}. Checking Step 6 regional_partial fallback...")
                
                # Step 6: Durable manifest overlap as regional_partial only if no better dynamic/stale viewport product exists
                overlap_candidates = []
                for p in manifest.products:
                    if (
                        p.model.upper() == model.upper()
                        and p.domain.lower() == domain.lower()
                        and p.layer.lower() == layer.lower()
                    ):
                        diff = abs(p.valid_time_start.timestamp() - target_dt.timestamp())
                        if diff <= 3 * 3600:
                            # Avoid matching a tiny regional product for a wide global/wide query
                            cov = p.coverage
                            if cov.west <= cov.east:
                                p_span_lng = cov.east - cov.west
                            else:
                                p_span_lng = (180.0 - cov.west) + (cov.east + 180.0)
                            p_is_regional = p_span_lng < 350.0

                            is_wide_req = False
                            if req_w is not None:
                                if req_w <= req_e:
                                    req_span_lng = req_e - req_w
                                else:
                                    req_span_lng = (180.0 - req_w) + (req_e + 180.0)
                                req_span_lat = abs(req_n - req_s)
                                if req_span_lng > 180.0 or req_span_lat > 90.0:
                                    is_wide_req = True

                            if is_wide_req and p_is_regional:
                                continue

                            if req_w is not None:
                                area = calculate_bbox_intersection_area(
                                    req_w, req_s, req_e, req_n,
                                    p.coverage.west, p.coverage.south, p.coverage.east, p.coverage.north
                                )
                                if area > 0.0:
                                    overlap_candidates.append((p, area, diff))
                            else:
                                overlap_candidates.append((p, 1.0, diff))
                
                overlap_manifest_item = None
                if overlap_candidates:
                    # Rank by: area (descending), time difference (ascending), authoritative first (is_estimated = False first)
                    overlap_candidates.sort(
                        key=lambda x: (
                            -x[1],  # area descending
                            x[2],   # time difference ascending
                            getattr(x[0], "is_estimated", False)  # authoritative (False) before estimated (True)
                        )
                    )
                    overlap_manifest_item = overlap_candidates[0][0]
                
                if overlap_manifest_item:
                    logger.info(f"[Grid Route] Fallback: Serving overlapping regional manifest product '{overlap_manifest_item.filename}' as regional_partial")
                    product = await asyncio.to_thread(store.load_product, overlap_manifest_item.filename)
                    if not product or not product.grid:
                        raise HTTPException(status_code=500, detail="Failed to load prepared grid from storage.")
                    product.product_id = overlap_manifest_item.filename
                    product.coverage_scope = "regional_partial"
                    product.partial_coverage = True
                    product.requested_bbox_original = bbox
                    product.query_bbox = bbox
                    product.requested_bbox = bbox
                    if bbox and getattr(overlap_manifest_item, "coverage_mode", None) != "global_tile" and domain.lower() != "wind":
                        product = filter_grid_to_bbox(product, bbox)
                    if product.grid and product.grid.bounds:
                        product.served_bbox = f"{product.grid.bounds.west:.4f},{product.grid.bounds.south:.4f},{product.grid.bounds.east:.4f},{product.grid.bounds.north:.4f}"
                else:
                    # Step 7: Honest no_coverage/temporary_unavailable (raise the error or return empty grid if wide request)
                    is_wide_req = False
                    if req_w is not None:
                        if req_w <= req_e:
                            req_span_lng = req_e - req_w
                        else:
                            req_span_lng = (180.0 - req_w) + (req_e + 180.0)
                        req_span_lat = abs(req_n - req_s)
                        if req_span_lng > 180.0 or req_span_lat > 90.0:
                            is_wide_req = True

                    if is_wide_req and domain.lower() != "wind":
                        return JSONResponse(status_code=200, content={
                            "model": model,
                            "provider": "none",
                            "domain": domain,
                            "layer": layer,
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
                            "value_kind": "wind_speed" if domain.lower() == "wind" else "wave_height",
                            "value_unit": "kn" if domain.lower() == "wind" else "m",
                            "display_unit_hint": "kn" if domain.lower() == "wind" else "ft",
                            "units": {
                                "speed": "kn" if domain.lower() == "wind" else "m",
                                "direction": "degrees",
                                "period": "seconds"
                            },
                            "source_variables": [],
                            "freshness_sec": 1800,
                            "warnings": ["no_global_coverage"],
                            "is_test_fixture": False,
                            "status": "empty_fallback",
                            "reason": "no_global_coverage",
                            "source": "empty_fallback",
                            "renderable": False
                        })

                    if isinstance(dynamic_err, HTTPException):
                        raise dynamic_err
                    raise HTTPException(status_code=503, detail=f"Grid service temporarily unavailable: {dynamic_err}")
        else:
            # Dynamic viewport not enabled for this layer/model, return honest no-coverage
            return make_no_coverage_grid_response(model, layer, valid_time)

    if product:
        product.valid_time = target_dt

    # 4. Set diagnostics renderable property explicitly
    if product and product.grid:
        if product.grid.diagnostics is None:
            product.grid.diagnostics = {}
        product.grid.diagnostics["renderable"] = len(product.grid.vectors) > 0 and any(v.speed > 0 for v in product.grid.vectors)
        product.grid.diagnostics["partial_coverage"] = getattr(product, "partial_coverage", False)
        product.grid.diagnostics["valid_time"] = product.valid_time.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Attach truthTag for GFS marine waves and all wind forecast models
    is_gfs_marine_waves = (model.upper() == "GFS" and domain.lower() == "marine" and layer.lower() == "waves")
    is_wind = (domain.lower() == "wind" and layer.lower() == "wind")
    if is_gfs_marine_waves or is_wind:
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

    is_gfs_marine_waves = (model.upper() == "GFS" and domain.lower() == "marine" and layer.lower() == "waves")
    is_wind = (domain.lower() == "wind" and layer.lower() == "wind")
    if is_gfs_marine_waves or is_wind:
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
            product = await asyncio.to_thread(store.load_product, sampled_product_id)
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

                # 2. Crop the product if grid_bbox is provided and not wind
                cropped_product = product
                if grid_bbox and domain.lower() != "wind" and getattr(product, "coverage_mode", None) != "global_tile":
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
    manifest = await asyncio.to_thread(store.get_manifest)
    
    # Measure cache folder size
    def get_disk_usage():
        usage = 0
        try:
            for f in os.listdir(store.cache_dir):
                fp = os.path.join(store.cache_dir, f)
                if os.path.isfile(fp):
                    usage += os.path.getsize(fp)
        except Exception:
            pass
        return usage

    disk_usage = await asyncio.to_thread(get_disk_usage)

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



@router.get("/capabilities")
async def get_capabilities():
    """
    GET /api/weather/capabilities
    Returns the backend-owned capabilities matrix for weather, marine, and wind models.
    """
    from services.weather_pipeline.capabilities import get_weather_capabilities
    return get_weather_capabilities()

@router.post("/client-diagnostics")
async def post_client_diagnostics(report: ClientDiagnosticReport):
    """
    POST /api/weather/client-diagnostics
    Receives and logs real-time client-side warnings, errors, and truth violations.
    """
    try:
        details_str = f" | Details: {report.details}" if report.details else ""
        log_msg = (
            f"[CLIENT-DIAGNOSTIC] Type: {report.event_type} | "
            f"Model: {report.model or 'N/A'} | Layer: {report.layer or 'N/A'} | "
            f"TimeOffset: {report.timeOffset or 0}h | FPS: {report.fps or 60} | "
            f"Memory: {report.memory or 0}MB | Correlation: {report.correlationId or 'none'}{details_str}"
        )
        
        # Log via python logger
        if "error" in report.event_type.lower() or "violation" in report.event_type.lower() or "fail" in report.event_type.lower():
            logger.error(log_msg)
        else:
            logger.warning(log_msg)
            
        # Also append to diagnostics.log
        from pathlib import Path
        log_path = Path(__file__).parent.parent / "diagnostics.log"
        formatted_time = report.timestamp.strftime("%Y-%m-%dT%H:%M:%SZ") if report.timestamp else datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        
        # Ensure directory exists
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{formatted_time}] {log_msg}\n")
            
        return {"status": "success", "message": "Diagnostic report logged successfully"}
    except Exception as e:
        logger.error(f"Failed to log client diagnostic: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save diagnostic: {str(e)}")


@router.get("/diagnostics-log")
async def get_diagnostics_log(admin=Depends(get_current_admin)):
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

# Include the ingestion sub-router dynamically to break circular imports
from .weather_ingest import router as ingest_router
router.include_router(ingest_router)


from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse
from datetime import datetime, timezone
from deps.admin_auth import get_current_admin
from typing import Optional
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
    filter_grid_to_bbox, compute_truth_tag, get_snapped_bbox
)
from services.weather_pipeline.viewport_service import ViewportService
from services.weather_pipeline.point_resolution import PointResolutionService

# P1 per-spot ratings (/spot-ratings): query surf spots + compute the rating at each precise location.
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from database import get_db
from models.spots import SurfSpot
from services.weather_pipeline.spot_ratings import (
    rate_one_spot, load_spot_ratings_l2_cached, select_precomputed,
)

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


@router.get("/grid_series")
async def get_grid_series(
    model: str = Query(..., pattern="^(GFS|ICON|EURO)$"),
    domain: str = Query("marine", pattern="^(marine|wind|weather)$"),
    layer: str = Query(..., pattern="^(waves|swell_1|swell_2|wind_waves|wind|pressure|precipitation)$"),
    bbox: str = Query(..., description="west,south,east,north viewport bbox"),
    hours: str = Query(..., description="comma-separated integer hour offsets from now, e.g. 0,3,6,9"),
    surf: bool = Query(False, description="Option-2: surf-transform each frame (Swell<->Surf toggle)"),
    request: Request = None,
):
    """
    GET /api/weather/grid_series

    Returns a TIME-SERIES of viewport grids in ONE response so the client can scrub
    hours instantly (client-side frame selection) instead of one fetch per hour.

    SURGICAL + ADDITIVE: reuses the exact per-hour dynamic-product builder that /grid
    already uses (get_cached_dynamic_product). The first requested hour triggers the
    multi-hour upstream fetch (Open-Meteo/Copernicus already return it and the provider
    caches it 5 min); every subsequent hour re-slices that SAME cached fetch. It does not
    touch /grid — if it fails, the client falls back to the per-hour /grid flow.
    """
    from services.weather_pipeline.grid_series_helper import build_grid_series
    # Reuse the SAME resolver /grid uses (get_grid, defined below) so each frame matches the
    # live heatmap exactly, at any zoom/region (manifest regional/global + dynamic viewport).
    # viewport_service enables the EURO/Copernicus fast path (one full-range fetch + slice).
    # request is threaded through so a scrub-aborted connection cancels the remaining per-hour
    # builds instead of running the whole multi-hour series to completion (zombie OOM load).
    return await build_grid_series(get_grid, viewport_service, model, domain, layer, bbox, hours, request=request, surf=surf)


@router.get("/grid", response_model=NormalizedProduct)
async def get_grid(
    model: str = Query(..., pattern="^(GFS|ICON|EURO)$"),
    domain: str = Query(..., pattern="^(marine|wind|weather)$"),
    layer: str = Query(..., pattern="^(waves|swell_1|swell_2|wind_waves|wind|pressure|precipitation)$"),
    valid_time: str = Query(..., description="ISO-8601 UTC timestamp"),
    bbox: Optional[str] = Query(None, description="west,south,east,north boundary filter"),
    surf: bool = Query(False, description="Option-2: return the bathymetry SURF-transformed grid (nearshore breaking height)"),
    background_tasks: BackgroundTasks = None,
    request: Request = None
):
    """
    GET /api/weather/grid
    Returns a compact normalized coordinate grid ready for WebGL rendering.
    Enforces dynamic bounding-box coordinate filtering to conserve bandwidth.

    The resolution logic lives in services.weather_pipeline.grid_resolver.resolve_grid
    (dependency-injected with store + viewport_service) so this route stays thin and
    grid_series can reuse the exact same resolver.
    """
    from services.weather_pipeline.grid_resolver import resolve_grid
    try:
        return await resolve_grid(
            store, viewport_service,
            model=model, domain=domain, layer=layer, valid_time=valid_time,
            bbox=bbox, surf=surf, background_tasks=background_tasks, request=request
        )
    except HTTPException:
        # Intentional, CORS-safe statuses (499 client-closed, 503 temporarily-unavailable, 4xx) — keep.
        raise
    except Exception as e:
        # An UNHANDLED exception becomes a bare FastAPI 500 ("Internal Server Error") that carries NO
        # Access-Control-Allow-Origin header, so the browser misreports it as a CORS error — and for
        # wind the client's safe-zero fallback then clears the heatmap. This was the EURO-wind 500
        # (no forecast products beyond the latest stale run → dynamic fetch throws for far valid_times).
        # Convert any unexpected failure into a graceful no-coverage grid (404 JSONResponse → CORS-safe)
        # so the client retains the previous frame + retries. The real cause is logged for Render.
        logger.error(
            f"[Grid Route] Unhandled error resolving {model}/{domain}/{layer}@{valid_time} "
            f"(bbox={bbox}): {type(e).__name__}: {e}", exc_info=True
        )
        from services.weather_pipeline.route_helpers import make_no_coverage_grid_response
        return make_no_coverage_grid_response(model, layer, valid_time)

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
                    cropped_product = filter_grid_to_bbox(product, get_snapped_bbox(grid_bbox, product.model))

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


# ─────────────────────────────────────────────────────────────────────────────────────────────────────
# P1 — PER-SPOT SURF-QUALITY RATINGS (the map-glyph accuracy path)
# Resolve each surf spot in the viewport at its PRECISE location (best-resolution tile, not the coarse
# rating grid) and compute the multivariable rating (size + period + wind off/onshore + swell-angle
# exposure) via the SAME compute_surf_rating model the infobox badge uses. The frontend glyphs read THIS
# instead of sampling the coarse grid cell (which is wrong at remote spots). Reuses resolve_point (warm-grid
# sampling — the first call per domain warms the viewport tile, the rest hit cache), so it is NOT N network
# fetches. Concurrency is bounded for the 1-CPU serve box. The cron precompute → L2 path (increment 3) will
# later serve these with zero serve-box compute; this live path is the fallback. Kill switch SPOT_RATINGS_V2=0.
_SPOT_RATINGS_CONCURRENCY = int(os.environ.get("SPOT_RATINGS_CONCURRENCY", "6"))


class SpotRatingItem(BaseModel):
    spot_id: str                          # SurfSpot.id is a UUID string
    name: Optional[str] = None
    latitude: float
    longitude: float
    score: Optional[float] = None        # 0-100 surf-quality (None = no rideable surf / no data at this hour)
    level: str = "unknown"               # very_poor..epic | unknown
    confidence: str = "low"              # low|medium|high (bathymetry/verification-aware)
    surf_height_m: Optional[float] = None
    period_s: Optional[float] = None
    tide: Optional[dict] = None          # {height_m, norm 0..1, trend} when RATING_TIDE is on (else None)
    why: Optional[str] = None            # short human explanation


class SpotRatingsResponse(BaseModel):
    model: str
    valid_time: str
    count: int                            # number of spots with a non-null score
    source: str                           # "precomputed" | "live" | "disabled"
    spots: list[SpotRatingItem]


@router.get("/spot-ratings", response_model=SpotRatingsResponse)
async def get_spot_ratings(
    bbox: str = Query(..., description="west,south,east,north viewport bbox"),
    valid_time: str = Query(..., description="ISO-8601 UTC timestamp"),
    model: str = Query("GFS", pattern="^(GFS|ICON|EURO)$"),
    limit: int = Query(40, ge=1, le=200, description="max spots rated per request (serve-box bound)"),
    db: AsyncSession = Depends(get_db),
):
    """GET /api/weather/spot-ratings — per-surf-spot surf-quality ratings for the viewport's map glyphs."""
    if os.environ.get("SPOT_RATINGS_V2", "1") == "0":
        return SpotRatingsResponse(model=model, valid_time=valid_time, count=0, source="disabled", spots=[])
    try:
        w, s, e, n = [float(x) for x in bbox.split(",")]
    except Exception:
        raise HTTPException(status_code=400, detail="bbox must be 'west,south,east,north'")

    # PRECOMPUTED path (rating plan §4): if the cron wrote a frame covering this model+time, serve it straight
    # from L2 (zero serve-box compute). select_precomputed returns None when no matching frame exists → live.
    try:
        pre = select_precomputed(load_spot_ratings_l2_cached(), (w, s, e, n), model, valid_time)
    except Exception as _pe:
        logger.debug(f"[spot-ratings] precomputed read failed: {_pe}")
        pre = None
    if pre is not None:
        items = [SpotRatingItem(**sp) for sp in pre[:limit]]
        count = sum(1 for it in items if it.score is not None)
        return SpotRatingsResponse(model=model, valid_time=valid_time, count=count, source="precomputed", spots=items)

    # LIVE fallback: query the spots in the bbox + rate each at its precise location (bounded concurrency).
    stmt = (
        select(SurfSpot)
        .where(
            SurfSpot.is_active.is_(True),
            SurfSpot.latitude.isnot(None), SurfSpot.longitude.isnot(None),
            SurfSpot.latitude >= s, SurfSpot.latitude <= n,
        )
    )
    if w <= e:
        stmt = stmt.where(SurfSpot.longitude >= w, SurfSpot.longitude <= e)
    else:  # antimeridian-crossing viewport
        stmt = stmt.where(or_(SurfSpot.longitude >= w, SurfSpot.longitude <= e))
    # Deterministic order so the rated subset is STABLE across refetches (no glyph flicker when a dense viewport
    # has more spots than `limit`) — verified peaks first (best spots get glyphs), then a stable id tiebreak.
    stmt = stmt.order_by(SurfSpot.is_verified_peak.desc().nullslast(), SurfSpot.id)
    rows = (await db.execute(stmt.limit(limit))).scalars().all()

    sem = asyncio.Semaphore(max(1, _SPOT_RATINGS_CONCURRENCY))

    async def _rate(spot) -> SpotRatingItem:
        spot_dict = {
            "id": spot.id, "name": getattr(spot, "name", None),
            "latitude": spot.latitude, "longitude": spot.longitude,
            "accuracy_flag": getattr(spot, "accuracy_flag", None),
            "is_verified_peak": getattr(spot, "is_verified_peak", False),
            "best_tide": getattr(spot, "best_tide", None),
        }
        async with sem:
            d = await rate_one_spot(point_resolution_service, spot_dict, model, valid_time)
        return SpotRatingItem(**d)

    items = list(await asyncio.gather(*[_rate(sp) for sp in rows])) if rows else []
    count = sum(1 for it in items if it.score is not None)
    return SpotRatingsResponse(model=model, valid_time=valid_time, count=count, source="live", spots=items)


@router.get("/buoy-calibration")
async def get_buoy_calibration():
    """GET /api/weather/buoy-calibration — the latest model-vs-NOAA-buoy residual report (height/period MAE +
    bias per buoy, measure-first ground truth). Read-only from the L2 object the cron writes when
    BUOY_CALIBRATION=1; returns {available:false} when no report has been generated yet."""
    from services.weather_pipeline.buoy_calibration import load_calibration_l2_cached
    report = await asyncio.to_thread(load_calibration_l2_cached)
    if not report:
        return {"available": False, "summary": None, "spots": []}
    return {"available": True, **report}


@router.get("/report-calibration")
async def get_report_calibration():
    """GET /api/weather/report-calibration — the latest model-RATING-vs-surfer-report residual report (star +
    height MAE/bias from matching archived predictions to logged sessions; bias>0 = model over-rates). Read-only
    from the L2 object the cron writes when REPORT_CALIBRATION=1; {available:false} until generated."""
    from services.weather_pipeline.report_calibration import load_report_calibration_cached
    report = await asyncio.to_thread(load_report_calibration_cached)
    if not report:
        return {"available": False, "summary": None, "residuals": []}
    return {"available": True, **report}


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
        
        def write_diagnostic_log():
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(f"[{formatted_time}] {log_msg}\n")
                
        await asyncio.to_thread(write_diagnostic_log)
            
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
        def read_diagnostic_log():
            with open(log_path, "r", encoding="utf-8") as f:
                return f.read()
        content = await asyncio.to_thread(read_diagnostic_log)
        return {"status": "success", "content": content}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# Include the ingestion sub-router dynamically to break circular imports
from .weather_ingest import router as ingest_router
router.include_router(ingest_router)


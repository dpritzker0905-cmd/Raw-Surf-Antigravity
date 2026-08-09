from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta, timezone
from deps.admin_auth import get_current_admin
from typing import Dict, Optional
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
        product = await resolve_grid(
            store, viewport_service,
            model=model, domain=domain, layer=layer, valid_time=valid_time,
            bbox=bbox, surf=surf, background_tasks=background_tasks, request=request
        )
        # ROOT FIX (2026-07-23): the 10° coarse EURO/ICON `waves` tier masks enclosed seas (Gulf) →
        # wrong colors on zoom-out. Fill those holes from the SERVED GFS coarse (valid Gulf) at serve
        # time — the ingest fill can't (it reads a raw grid whose Gulf doesn't reconstruct). grid_series
        # reuses this route per frame, so both endpoints get it. Kill: MARINE_COARSE_GULF_FILL=0.
        from services.weather_pipeline.coarse_gulf_fill import fill_coarse_enclosed_sea_from_gfs_served
        return await fill_coarse_enclosed_sea_from_gfs_served(product, store, model, domain, layer)
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
    # Observation gate (RATING_OBS_GATE): good/epic verdicts require confirmation — >=2-model agreement
    # or a fresh user report (Surfline hybrid; the backend plays the forecaster). None fields when off.
    confirmed: Optional[str] = None      # None | 'good' | 'epic' — what unlocked this score's ceiling
    raw_score: Optional[float] = None    # the ungated model score (audit; score may be capped/nudged)
    # full | degraded | blind — what the forecast RAN ON, which `confidence` above does not say.
    # `confidence` grades the PIN (accuracy_flag / is_verified_peak); a perfectly-placed verified pin
    # can still be scored against a coarse 0.25° bearing that is median 22.3° off, changing the
    # LEVEL on 45.8% of evaluations. Optional so an older precomputed frame simply omits it.
    geometry_readiness: Optional[str] = None
    # CROSS-MODEL SPREAD for this spot-hour: {n_models, spread, median, min, max, agreement}.
    # The precompute already scored GFS/ICON/EURO to decide `confirmed` and then discarded the
    # disagreement; this publishes it, which is what operational practice does with an ensemble
    # (spread quantifies uncertainty; you do not clip the mean and stay silent about it).
    # ⛔ NOT the same quantity as `confidence` above — that grades the PIN. This grades the FORECAST,
    # and its vocabulary is deliberately different (tight|moderate|wide) so the two cannot be read
    # as one. None when fewer than two models covered the hour: a lone lane has no spread, and
    # publishing 0.0 there would read as unanimity.
    # Optional so an older precomputed frame simply omits it (same contract as geometry_readiness).
    model_agreement: Optional[dict] = None
    # WHICH MODEL RUN produced this score. `valid_time` says which HOUR the score describes and
    # nothing about which FORECAST of that hour — and the gap is routinely large, because the point
    # resolver serves REGIONAL products on independent ingest cadences. Measured live 2026-07-31 at
    # ONE valid_time: Pipeline's marine run was 14:08Z, Sebastian Inlet's was 21:40Z the previous
    # day — 17 h older. Without this, a disagreement between this rating and any other surface could
    # only be attributed by forcing a live re-compute (7.5-8.6 s on the 1-CPU box).
    # ⚠️ TWO fields because marine and wind are ingested by different jobs and shared a run at 0 of
    # 4 spots measured — one would describe only half the inputs to the score.
    # Optional so an older precomputed frame simply omits them (same contract as
    # `geometry_readiness` above, and as `served_valid_time` on the response).
    run_time: Optional[str] = None            # the marine run — it produced `surf_height_m`
    wind_run_time: Optional[str] = None
    # WHICH OF THE NINE FACTORS REMOVED THE MOST. The score is a product of nine terms in [0,1] and
    # this payload published only the score plus `why` (height/period/wind — three INPUTS, not
    # factors), so the live ceiling of 68.8 with zero 'good' could not be ATTRIBUTED.
    # ⛔ DECLARED HERE BECAUSE PYDANTIC DROPS UNDECLARED KEYS. `rate_one_spot` returned `limiter` from
    # 6da4c16e, the code deployed correctly (health reported the SHA), and the field was absent from
    # every response for hours — silently stripped at this boundary. That is the SAME defect as
    # `e8b38e42` ("the geometry provenance envelope was served and dropped at the render boundary"),
    # and the guards that shipped with it tested `rating_factors` while nothing tested THE WIRE.
    # ⇒ A FIELD IS NOT SHIPPED UNTIL A TEST ASSERTS IT SURVIVES SERIALISATION.
    # Optional so an older precomputed frame simply omits them, same contract as the fields above.
    limiter: Optional[str] = None             # e.g. 'size_gate' | 'swell_exposure' | 'wind_period_blend'
    limiter_f: Optional[float] = None         # that factor's value in [0,1] — how much it removed
    # WHICH REFERENCE graded this row (32bd579c, the Pedras Negras reference-generation skew):
    # the size climatology MOVES between precompute folds, so a frame's rating config has a
    # generation just like its sea does (run_time). ABSENT = the global 1.2 m curve graded.
    # Declared here or Pydantic silently drops it at this boundary — the wire-contract guard
    # caught exactly that within one CI run of the producer change (the 6da4c16e class, again).
    reference_size_m: Optional[float] = None
    # THE RATING'S OWN INPUTS (2026-08-09): five numbers recorded at use time that make every
    # spot-hour replayable offline (science_shadow_ab). Declared here for the same reason as
    # reference_size_m above — Pydantic silently drops undeclared producer keys at this boundary.
    inputs: Optional[Dict[str, float]] = None
    # THE SIZE AND THE QUALITY DISAGREE ABOUT THE SAME SWELL. `swell_exposure` (quality) floors at
    # 0.100 while `_height_exposure_factor` (height) floors at 0.595 — 0.354 in energy, a 3.54x
    # contradiction from ONE bearing, saturating for every Δθ >= 90°. Measured 2026-08-04 on n=1005
    # served spots: >= 15.4% bind, and 0 of 1005 carried this caveat while its sibling
    # `model_agreement` carried on 1005/1005 — one disclosure from this arc landed, this one did not.
    # ⚠️ DISCLOSES, DOES NOT CORRECT: the height is the likelier overestimate but is right by
    # cancellation until the ERA5 reconciliation lands. ABSENT unless it binds (Δθ >= 75.73°).
    # ⛔ DECLARED HERE BECAUSE PYDANTIC DROPS UNDECLARED KEYS — the same boundary that silently
    # stripped `limiter` for hours while health reported the correct SHA. See that note above:
    # A FIELD IS NOT SHIPPED UNTIL A TEST ASSERTS IT SURVIVES SERIALISATION
    # (`test_directional_conflict_reaches_the_wire.py` asserts exactly that, through this model).
    directional_conflict: Optional[dict] = None
    # A THIRD, ORTHOGONAL CONFIDENCE: {level, spread_m, relative_spread, calibrated, means} — how much
    # the ECMWF-WAEF members disagree about the SEA. `confidence` above grades the PIN,
    # `geometry_readiness` grades the INPUTS, this grades the FORECAST. ABSENT (not null) on every
    # deterministic product, mirroring `directional_conflict`.
    # ⛔ NOT A TERM IN `score`, by design and by test — uncertainty is not quality; a high-spread 6 ft
    # is the same wave as a low-spread 6 ft, forecast less confidently.
    # ⚠️ DECLARED HERE FOR THE FOURTH RECORDED TIME IN THIS CLASS. `rate_one_spot` has emitted this
    # since `0bc64f9b` and it was dropped at this boundary from then until MASTER-AUDIT-10.0 §1.2
    # measured it — the same defect as `limiter` (6da4c16e) and the geometry envelope (e8b38e42).
    # ★ WHY THE CHOKEPOINT GUARD DID NOT CATCH IT THIS TIME: the producer adds it via
    # `**({"forecast_confidence": _fc} if _fc else {})`, and a `**` entry in an `ast.Dict` has
    # `key = None`, so `_producer_return_keys` could not see it at all. Fixed in the same commit as
    # this line — the guard now recurses into `**` values, and it FAILED at HEAD naming this field
    # before this declaration was added. That failure is the evidence this line is load-bearing.
    forecast_confidence: Optional[dict] = None


class SpotRatingsResponse(BaseModel):
    model: str
    valid_time: str                       # the hour ASKED FOR
    count: int                            # number of spots with a non-null score
    source: str                           # "precomputed" | "precomputed_stale" | "live" | "disabled"
    # The hour the served frame ACTUALLY describes, and the signed gap. The stale ladder serves the
    # nearest frame within 6 h and this response used to echo the requested hour regardless, so a
    # rating from 09:00 was labelled 15:00 with only `source` hinting. The grid response has carried
    # `served_valid_time` + `frame_offset_hours` since it had the same problem; this is the outlier.
    # ★ A check whose two sides do not share a `valid_time` measures the clock, not the physics —
    # the same artifact that had the obs gate capping 59.9% of good/epic on a cross-model mismatch.
    # None on the live path (computed at the requested hour) and when disabled.
    served_valid_time: Optional[str] = None
    frame_offset_hours: Optional[float] = None
    spots: list[SpotRatingItem]


def _offset_hours(requested: str, served: Optional[str]) -> Optional[float]:
    """Signed hours from the requested hour to the one actually served. None when unknowable."""
    if not served or not requested:
        return None
    from datetime import datetime as _dt
    try:
        r = _dt.strptime(requested, "%Y-%m-%dT%H:%M:%SZ")
        s = _dt.strptime(served, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None
    return round((s - r).total_seconds() / 3600.0, 2)


# Live-path TTL cache: rating a viewport on the 1-CPU serve box is 7-22s, so a re-view (or another user) would
# pay it again and most fetches abort on pan before finishing. Cache the computed response per
# (bbox|time|model|limit) for a few minutes so a completed compute is reused instantly. Keyed by valid_time, so
# it self-freshens each hour. The PRECOMPUTE path (cron → L2) is the real fix; this just bridges the gap.
_LIVE_RATINGS_CACHE: dict = {}
_LIVE_RATINGS_TTL_S = 600.0
_LIVE_RATINGS_CACHE_MAX = 400
# Live computes currently in flight (single event loop → check-then-increment is race-safe). The
# load-shed cap (SPOT_RATINGS_LIVE_MAX_CONCURRENT) 503s beyond it — see the live path below.
_LIVE_RATINGS_INFLIGHT = 0


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
    # STALE LADDER (2026-07-13, melt hardening round 3): fresh (±2h) → stale (±SPOT_RATINGS_STALE_TOLERANCE_S,
    # default 6h, labeled source="precomputed_stale") → live. The 1-CPU box CANNOT survive live-at-scale
    # (7.5-8.6 s/req melts every DB lane — the 07-13 melt, three recurrences with three different triggers:
    # evicted run / GH cron drift / coverage hole). Bounded-stale glyphs beat a melted box; beyond the stale
    # bound live remains the truth path. Kill: SPOT_RATINGS_STALE_TOLERANCE_S=0.
    pre, pre_source, pre_served = None, "precomputed", None
    try:
        from services.weather_pipeline.spot_ratings import select_precomputed_laddered
        # ⛔ OFF THE EVENT LOOP (2026-08-06, MASTER-AUDIT-9.0 §5.1). This loader is a synchronous
        # `requests.get(timeout=10)` to Supabase Storage behind a 300 s TTL, so calling it bare here
        # ran a blocking socket read on the loop: measured against this handler, **0 of ~50 possible
        # co-tenant ticks** fired while it ran — every other request on the worker stalled for the
        # whole round trip, up to the full 10 s on a bad one, once per TTL per process.
        # ★ Its two siblings in this file were ALREADY offloaded (/buoy-calibration:581,
        # /report-calibration:593). Those are diagnostic endpoints; this one is the map-glyph path
        # hit on every viewport pan — the highest-traffic of the three was the one missed.
        # Only the READ crosses the thread boundary: `select_precomputed_laddered` is PURE in-memory
        # frame selection. Guard: tests/test_event_loop_offload_guard.py bans the SHAPE, because
        # `14c9caf6` already fixed event-loop blocking in this file and the class came back anyway.
        _l2_obj = await asyncio.to_thread(load_spot_ratings_l2_cached)
        pre, pre_source, pre_served = select_precomputed_laddered(
            _l2_obj, (w, s, e, n), model, valid_time)
    except Exception as _pe:
        logger.debug(f"[spot-ratings] precomputed read failed: {_pe}")
        pre = None
    if pre is not None:
        items = [SpotRatingItem(**sp) for sp in pre[:limit]]
        count = sum(1 for it in items if it.score is not None)
        # `valid_time` echoes what was ASKED FOR; `served_valid_time` is what the frame describes.
        # The stale ladder can serve a frame up to 6 h away and only the label said so — so a client
        # (or a parity check) had no way to tell a real disagreement from a time offset.
        return SpotRatingsResponse(model=model, valid_time=valid_time, count=count,
                                   source=pre_source, served_valid_time=pre_served,
                                   frame_offset_hours=_offset_hours(valid_time, pre_served),
                                   spots=items)

    # Live-path cache hit (a recent identical viewport already paid the 7-22s compute)?
    import time as _time
    ckey = f"{bbox}|{valid_time}|{model}|{limit}"
    _hit = _LIVE_RATINGS_CACHE.get(ckey)
    if _hit is not None and (_time.time() - _hit[0]) < _LIVE_RATINGS_TTL_S:
        return _hit[1]

    # LIVE-PATH LOAD SHED (2026-07-13, melt round 4 — the box must be UNMELTABLE by ratings): each
    # live compute is 7.5-8.6 s on the 1-CPU box; concurrent pileups starve the DB pool and 500 every
    # other lane (the recurring "melt"). Beyond the cap, fail FAST with 503 — the frontend keeps the
    # last glyphs + the instant grid-sample fallback and retries on a bounded timer (useSpotRatings),
    # which is strictly better than an 8-s pileup that takes the whole box down.
    # Kill/tune: SPOT_RATINGS_LIVE_MAX_CONCURRENT (default 2; 0 disables the live path entirely).
    global _LIVE_RATINGS_INFLIGHT
    _live_cap = int(os.environ.get("SPOT_RATINGS_LIVE_MAX_CONCURRENT", "2"))
    if _LIVE_RATINGS_INFLIGHT >= _live_cap:
        raise HTTPException(status_code=503, detail="ratings live path at capacity; precomputed lane refreshing — retry shortly")
    _LIVE_RATINGS_INFLIGHT += 1
    try:
        return await _compute_live_ratings(db, w, s, e, n, bbox, model, valid_time, limit, ckey, _time)
    finally:
        _LIVE_RATINGS_INFLIGHT -= 1


async def _compute_live_ratings(db, w, s, e, n, bbox, model, valid_time, limit, ckey, _time):
    """The 7-22 s live compute, extracted so the load-shed counter wraps it exactly (see caller)."""
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

    # LOCAL SIZE CALIBRATION on the live fallback too (parity with the precompute path), so an enabled
    # RATING_LOCAL_SIZE is consistent whether ratings are served precomputed or live. Empty map when the
    # feature is off or a spot lacks climatology → reference None → global default. Kept OUT of the loop.
    _ref_map = {}
    if os.environ.get("RATING_LOCAL_SIZE", "0") == "1":
        try:
            from services.weather_pipeline.spot_size_climatology import (
                load_size_climatology_l2_cached, reference_map as _size_reference_map)
            _ref_map = _size_reference_map(load_size_climatology_l2_cached())
        except Exception as _re:
            logger.debug(f"[spot-ratings] live size-reference load failed: {_re}")

    async def _rate(spot) -> SpotRatingItem:
        spot_dict = {
            "id": spot.id, "name": getattr(spot, "name", None),
            "latitude": spot.latitude, "longitude": spot.longitude,
            "accuracy_flag": getattr(spot, "accuracy_flag", None),
            "is_verified_peak": getattr(spot, "is_verified_peak", False),
            "best_tide": getattr(spot, "best_tide", None),
        }
        async with sem:
            d = await rate_one_spot(point_resolution_service, spot_dict, model, valid_time,
                                    reference_size_m=_ref_map.get(str(spot.id)))
        return SpotRatingItem(**d)

    items = list(await asyncio.gather(*[_rate(sp) for sp in rows])) if rows else []
    # OBSERVATION GATE on the live fallback (parity with the precompute path — one truth whichever lane
    # serves): report-confirmation + light nudge from this viewport's fresh reports (one DB query), then
    # cap. No cross-model corroboration here (live rates ONE model; a single-model spike staying capped
    # is exactly the gate's job). Kill: RATING_OBS_GATE=0 (default OFF).
    if os.environ.get("RATING_OBS_GATE", "0") == "1" and items:
        try:
            from services.weather_pipeline.rating_confirmation import (
                observation_gate, report_confirmation, report_nudge, REPORT_FRESH_H)
            from services.weather_pipeline.surf_rating import score_to_level
            from models import SurfReport
            _cut = datetime.now(timezone.utc) - timedelta(hours=REPORT_FRESH_H)
            _rres = await db.execute(
                select(SurfReport.spot_id, SurfReport.rating, SurfReport.created_at)
                .where(SurfReport.spot_id.in_([it.spot_id for it in items]),
                       SurfReport.created_at >= _cut, SurfReport.rating.isnot(None)))
            _by_spot = {}
            for _sid, _r, _c in _rres.all():
                _by_spot.setdefault(str(_sid), []).append({"rating": _r, "created_at": _c})
            for it in items:
                if it.score is None:
                    continue
                _reps = _by_spot.get(it.spot_id)
                _conf = report_confirmation(_reps)
                it.raw_score = it.score
                it.confirmed = _conf
                it.score = observation_gate(it.score + report_nudge(it.score, _reps), _conf)
                it.level = score_to_level(it.score)
        except Exception as _ge:
            logger.debug(f"[spot-ratings] live observation gate skipped: {_ge}")
    count = sum(1 for it in items if it.score is not None)
    resp = SpotRatingsResponse(model=model, valid_time=valid_time, count=count, source="live", spots=items)
    if count > 0:                                    # cache only a real result (not an empty cold-start)
        if len(_LIVE_RATINGS_CACHE) >= _LIVE_RATINGS_CACHE_MAX:
            _LIVE_RATINGS_CACHE.clear()
        _LIVE_RATINGS_CACHE[ckey] = (_time.time(), resp)
    return resp


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

    # R11-08 (2026-08-09, Report 11.0): this endpoint used to ASSERT health it never measured —
    # provider_status hardcoded "healthy", stale_products_count hardcoded 0, last_errors
    # hardcoded [] — so it read "healthy" during any outage. House rule: a check that cannot
    # tell not-sampled from broken must REFUSE ("not_instrumented"), never fabricate. The
    # measured fields (file count, disk, memory, thread count) stay measured; per-route latency
    # and error truth live on /api/health.request_telemetry.
    import threading
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "provider_status": {
            "open-meteo": "not_instrumented",
            "copernicus": "not_instrumented",
        },
        "cache_telemetry": {
            "total_grid_files": len(manifest.products),
            "disk_usage_bytes": disk_usage,
            "stale_products_count": None,   # not computed here; lane staleness = /api/health/data
        },
        "telemetry": {
            "active_background_threads": threading.active_count(),
            "memory_usage_mb": memory_mb
        },
        "last_errors": None,                # not collected here; 5xx counts = /api/health.request_telemetry
        "note": ("provider_status/last_errors are NOT instrumented on this route and now say so; "
                 "use /api/health (request_telemetry, 5xx per route) and /api/health/data (lane "
                 "freshness) for measured health."),
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


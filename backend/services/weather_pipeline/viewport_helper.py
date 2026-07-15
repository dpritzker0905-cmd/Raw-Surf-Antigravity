import logging
import asyncio
import os
import math
import gc
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from typing import Optional, Dict, Any, List

from services.weather_pipeline.route_helpers import (
    parse_bbox, is_bbox_covered_by, clamp_and_normalize_bbox,
    choose_adaptive_resolution, build_dynamic_cache_key, filter_grid_to_bbox,
    get_snapped_bbox
)
from services.weather_pipeline.schemas import NormalizedProduct
from services.weather_pipeline.normalizer import WeatherNormalizer

logger = logging.getLogger(__name__)

# A legitimate dynamic-viewport / coarse / regional product is at most a few thousand cells
# (coarse global = 37×17 or 19×9; dynamic viewports are coord-capped). A grid far larger than
# that is a STALE pre-cap artifact — e.g. a 0.25° global field (1441×661 ≈ 952k cells) cached
# in Supabase L2 before resolution caps existed. Serving it forces the client to reject it
# ("Oversized grid rejected") and wait for an SWR retry — a recurring load delay observed for
# ICON/EURO marine. Treat any such product as a cache miss so resolution falls through to the
# proper coarse product instead.
_MAX_SERVEABLE_GRID_VECTORS = 250000


def _is_oversized_grid(product) -> bool:
    """True if a loaded product's grid is anomalously large (stale native-resolution artifact)."""
    try:
        return bool(
            product and product.grid and product.grid.vectors
            and len(product.grid.vectors) > _MAX_SERVEABLE_GRID_VECTORS
        )
    except Exception:
        return False

async def find_any_cached_product_helper(
    model: str,
    domain: str,
    layer: str,
    target_dt: datetime,
    dynamic_index,
    store,
    bbox_str: Optional[str] = None,
    require_coverage: bool = False
) -> Optional[NormalizedProduct]:
    """Searches dynamic index and manifest for any product matching model/layer and target time, choosing the closest.

    ``require_coverage``: when True (the instant-preview path in grid_resolver Step 3.7), a NON-wide
    requested viewport must be FULLY covered by the chosen cached tile — a merely-overlapping tile is
    rejected. This kills the zoom-out clamp: without it the dynamic-index branch picks the smallest
    time-diff OVERLAPPING viewport tile (e.g. a 5°×3° tile) and the tie-break below prefers it over the
    covering global-coarse manifest product, so a tiny tile is served as a floating sub-viewport
    rectangle for the ~1-3s SWR window. With coverage required, no cached tile covers → best_item stays
    None → the covering global-coarse manifest wins → an honest covering coarse wash that the background
    revalidation then sharpens to the exact viewport tile. Default False so the rate-limit / self-heal
    stale-fallback callers are byte-for-byte unchanged (they intentionally serve any overlapping tile)."""
    req_w, req_s, req_e, req_n = None, None, None, None
    if bbox_str:
        try:
            req_w, req_s, req_e, req_n = parse_bbox(bbox_str)
        except Exception:
            pass

    # 1. Search Dynamic Index
    items = dynamic_index._load_index()
    target_ts = target_dt.timestamp()
    
    best_item = None
    min_diff = float("inf")
    
    for item in items:
        if (
            item.get("model", "").upper() == model.upper()
            and item.get("domain", "").lower() == domain.lower()
            and item.get("layer", "").lower() == layer.lower()
        ):
            try:
                item_dt = datetime.fromisoformat(item["valid_time"].replace("Z", "+00:00"))
                diff = abs(item_dt.timestamp() - target_ts)
                # Allow up to 24 hours stale product fallback for rate limit
                if diff < min_diff and diff <= 24 * 3600:
                    # If bbox is specified, verify that item overlaps/covers it
                    if req_w is not None:
                        cand_bbox = item.get("served_bbox") or item.get("requested_bbox")
                        if cand_bbox:
                            cw, cs, ce, cn = parse_bbox(cand_bbox)
                            
                            # Check if the requested viewport is wide
                            if req_w <= req_e:
                                req_span_lng = req_e - req_w
                            else:
                                req_span_lng = (180.0 - req_w) + (req_e + 180.0)
                            req_span_lat = abs(req_n - req_s)
                            is_wide_req = req_span_lng > 15.0 or req_span_lat > 15.0
                            
                            # Check if candidate is regional
                            if cw <= ce:
                                cand_span_lng = ce - cw
                            else:
                                cand_span_lng = (180.0 - cw) + (ce + 180.0)
                            cand_is_regional = cand_span_lng < 350.0
                            
                            if is_wide_req and cand_is_regional:
                                continue

                            # Clamp fix: for the instant-preview path a NON-wide viewport must be
                            # FULLY covered by the cached tile, not merely overlapped — otherwise a
                            # smaller viewport tile is served as a floating sub-viewport rectangle
                            # (the zoom-out clamp). When nothing covers, best_item stays None and the
                            # covering global-coarse manifest product wins below. Rate-limit/self-heal
                            # fallbacks pass require_coverage=False so their overlap behavior is intact.
                            if require_coverage and not is_wide_req:
                                if not is_bbox_covered_by(
                                    req_w, req_s, req_e, req_n,
                                    SimpleNamespace(west=cw, south=cs, east=ce, north=cn),
                                    margin=0.05,
                                ):
                                    continue

                            # Simple overlap check
                            lat_overlap = not (req_n < cs or req_s > cn)
                            if cw <= ce:
                                if req_w <= req_e:
                                    lon_overlap = not (req_e < cw or req_w > ce)
                                else:
                                    lon_overlap = not (ce < req_w and cw > req_e)
                            else:
                                if req_w <= req_e:
                                    lon_overlap = not (req_e < cw and req_w > ce)
                                else:
                                    lon_overlap = True
                            if not (lat_overlap and lon_overlap):
                                continue
                    min_diff = diff
                    best_item = item
            except Exception:
                continue

    # 2. Search Manifest (pruning for anomalous future-dated entries runs inside get_manifest())
    manifest = await asyncio.to_thread(store.get_manifest)
    best_manifest_item = None
    min_manifest_diff = float("inf")
    
    for p in manifest.products:
        if (
            p.model.upper() == model.upper()
            and p.domain.lower() == domain.lower()
            and p.layer.lower() == layer.lower()
        ):
            # global_mid (~15k vectors) is served ONLY by grid_resolver's Step 3.6 tier, CLIPPED. In this
            # preview/stale-fallback scan it ties with global_coarse on time-diff (same valid_times, both
            # cover) and would win or lose by MANIFEST ORDER — serving a ~24x payload where the 629-vector
            # coarse was intended. Skip it here; the coarse remains the honest instant preview.
            if getattr(p, "region_id", None) == "global_mid":
                continue
            diff = abs(p.valid_time_start.timestamp() - target_ts)
            # Allow up to 24 hours stale product fallback for rate limit
            if diff < min_manifest_diff and diff <= 24 * 3600:
                # If bbox is specified, manifest fallback MUST fully cover the bbox.
                # Partial coverage falls back to Step 6 instead!
                if req_w is not None:
                    # Check if the requested viewport is wide
                    if req_w <= req_e:
                        req_span_lng = req_e - req_w
                    else:
                        req_span_lng = (180.0 - req_w) + (req_e + 180.0)
                    req_span_lat = abs(req_n - req_s)
                    is_wide_req = req_span_lng > 15.0 or req_span_lat > 15.0
                    
                    cov = p.coverage
                    if cov.west <= cov.east:
                        cand_span_lng = cov.east - cov.west
                    else:
                        cand_span_lng = (180.0 - cov.west) + (cov.east + 180.0)
                    cand_is_regional = cand_span_lng < 350.0
                    
                    if is_wide_req and cand_is_regional:
                        continue

                    if not is_bbox_covered_by(req_w, req_s, req_e, req_n, p.coverage, margin=0.05):
                        continue
                min_manifest_diff = diff
                best_manifest_item = p

    # Compare best dynamic vs best manifest, serving the one with the smallest time difference
    if best_item and (best_manifest_item is None or min_diff <= min_manifest_diff):
        loaded = await asyncio.to_thread(store.load_product, best_item["product_id"])
        if loaded and not _is_oversized_grid(loaded):
            return loaded

    if best_manifest_item:
        loaded = await asyncio.to_thread(store.load_product, best_manifest_item.filename)
        if loaded and not _is_oversized_grid(loaded):
            loaded.product_id = best_manifest_item.filename
            return loaded

    # Fallback to loading dynamic index item if manifest loading failed
    if best_item:
        loaded = await asyncio.to_thread(store.load_product, best_item["product_id"])
        if loaded and not _is_oversized_grid(loaded):
            return loaded

    return None


async def get_cached_dynamic_product_helper(
    service,
    model: str,
    domain: str,
    layer: str,
    target_dt: datetime,
    bbox_str: str
) -> Optional[NormalizedProduct]:
    """
    Checks dynamic product index for a fresh or stale cache hit.
    """
    req_w, req_s, req_e, req_n = parse_bbox(bbox_str)
    t_sz = 1.0 if model.upper() == "GFS" else 2.0
    west, south, east, north = clamp_and_normalize_bbox(
        math.floor(req_w / t_sz) * t_sz,
        math.floor(req_s / t_sz) * t_sz,
        math.ceil(req_e / t_sz) * t_sz,
        math.ceil(req_n / t_sz) * t_sz
    )
    span_lng = (east - west) if west <= east else ((180.0 - west) + (east + 180.0))
    span_lat = abs(north - south)

    is_global_view = (span_lng > 180.0 or span_lat > 90.0)
    if is_global_view:
        west, south, east, north = -180.0, -80.0, 180.0, 85.0
        span_lng = 360.0
        span_lat = 165.0
    coverage_scope = "global_coarse" if is_global_view else "viewport"

    resolution = choose_adaptive_resolution(span_lng, span_lat)

    time_str = target_dt.strftime("%Y%m%dT%H%M%SZ")
    cache_key = build_dynamic_cache_key(model, domain, layer, target_dt, west, south, east, north)
    viewport_filename = f"{cache_key}.json"

    cached_entry = service.dynamic_index.find_product(
        model=model, domain=domain, layer=layer, valid_time=target_dt, cache_key=cache_key
    )

    # RESOLUTION-ADEQUACY GATE (2026-07-15, user z7.82 "clamping + swirly directions returned,
    # both flavors"): the index can hold a COARSER build than this ask's own adaptive resolution
    # (wide-page-era builds re-seeding the index — the §0c class; live probe: a 5°×4° ask whose
    # adaptive resolution is 0.25° served a pinned 0.5° 11×9 page on BOTH asks). Serving it pins
    # the viewport at giant cells whose sparse direction lattice animates as the vortex face. A
    # coarser-than-adaptive entry is a MISS — the fresh build below rebuilds at the right
    # resolution; equal-or-finer entries serve normally. Kill: DYNAMIC_CACHE_RES_GATE=0.
    if cached_entry and coverage_scope == "viewport" and os.environ.get("DYNAMIC_CACHE_RES_GATE", "1") != "0":
        try:
            _cached_res = float(cached_entry.get("resolution") or 0.0)
        except (TypeError, ValueError):
            _cached_res = 0.0
        if _cached_res > resolution * 1.01:
            logger.info(
                f"[Dynamic Viewport] Cached {cached_entry['product_id']} res {_cached_res} is coarser "
                f"than adaptive {resolution} for this ask — treating as MISS (rebuild at full res)."
            )
            cached_entry = None

    if cached_entry:
        loaded_product = await asyncio.to_thread(service.store.load_product, cached_entry["product_id"])
        if loaded_product and _is_oversized_grid(loaded_product):
            logger.warning(
                f"[Dynamic Viewport] Skipping oversized stale cached product {cached_entry['product_id']} "
                f"({len(loaded_product.grid.vectors)} vectors) — treating as cache miss so a coarse product serves."
            )
            loaded_product = None
        if loaded_product:
            logger.info(f"[Dynamic Viewport] Cache HIT for {viewport_filename}")
            loaded_product.resolution = cached_entry.get("resolution")
            loaded_product.requested_bbox_original = bbox_str
            loaded_product.query_bbox = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
            loaded_product.partial_coverage = False
            
            is_stale_swr = False
            created_at_str = cached_entry.get("created_at")
            if created_at_str:
                try:
                    created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                    age_sec = (datetime.now(timezone.utc) - created_at).total_seconds()
                    if age_sec > 1800:  # 30 minutes
                        is_stale_swr = True
                        reval_key = f"{model.lower()}_{domain.lower()}_{layer.lower()}_{time_str}_{cache_key}"
                        if reval_key not in service.ACTIVE_REVALIDATIONS:
                            service.ACTIVE_REVALIDATIONS.add(reval_key)
                            logger.info(f"[Dynamic Viewport] SWR background revalidation triggered for {reval_key} (age: {age_sec:.1f}s)")
                            asyncio.create_task(service._revalidate_fetch(
                                model, domain, layer, time_str, target_dt, bbox_str, reval_key
                            ))
                except Exception as swr_err:
                    logger.error(f"[Dynamic Viewport] SWR setup error: {swr_err}")
            
            loaded_product.cache_hit = "stale_cache_hit" if is_stale_swr else "cache_hit"
            loaded_product.stale = is_stale_swr
            if is_stale_swr:
                loaded_product.staleReason = "swr_revalidation_pending"
            else:
                loaded_product.staleReason = None
            
            if loaded_product.grid:
                if cached_entry.get("coverage_scope") != "global_coarse" and domain.lower() != "wind":
                    loaded_product = filter_grid_to_bbox(loaded_product, get_snapped_bbox(bbox_str, model))
                served_bbox = f"{loaded_product.grid.bounds.west:.4f},{loaded_product.grid.bounds.south:.4f},{loaded_product.grid.bounds.east:.4f},{loaded_product.grid.bounds.north:.4f}"
                
                loaded_product.grid.diagnostics = {
                    "requested_bbox": bbox_str,
                    "served_bbox": served_bbox,
                    "coverage_scope": cached_entry.get("coverage_scope", coverage_scope),
                    "source_product_ids": ["open-meteo"],
                    "cache_hit": loaded_product.cache_hit,
                    "provider": loaded_product.provider,
                    "model": model,
                    "domain": domain,
                    "layer": layer,
                    "valid_time": target_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "nonzeroCount": loaded_product.grid.diagnostics.get("nonzeroCount", 0) if loaded_product.grid.diagnostics else 0,
                    "vectorCount": len(loaded_product.grid.vectors) if loaded_product.grid.vectors else 0,
                    "vectors_length": len(loaded_product.grid.vectors) if loaded_product.grid.vectors else 0,
                    "gridMode": "rectangular",
                    "renderable": len(loaded_product.grid.vectors) > 0 and any(v.speed > 0 for v in loaded_product.grid.vectors),
                    "stale": is_stale_swr,
                    "staleReason": loaded_product.staleReason,
                    "partial_coverage": False
                }
                loaded_product.served_bbox = served_bbox
            return loaded_product
    return None


async def bg_process_remaining_hours_helper(
    service,
    context,
    request_dedup_key: str,
    model: str,
    domain: str,
    layer: str,
    bbox_dict: dict,
    resolution: float,
    west: float,
    south: float,
    east: float,
    north: float,
    times: list,
    target_idx: int,
    bbox_str: str,
    coverage_scope: str,
    coord_count: int,
    bbox_key_str: str
):
    """Processes remaining forecast hours in the background with conjoined caching support."""
    try:


        remaining_indices = [i for i in range(len(times)) if i != target_idx]

        processed_indices = {target_idx}

        is_conjoined = model.upper() in ("GFS", "ICON") and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")
        if is_conjoined:
            conjoined_layers = ("waves", "swell_1", "wind_waves") if model.upper() == "ICON" else ("waves", "swell_1", "swell_2", "wind_waves")
        else:
            conjoined_layers = (layer.lower(),)

        while len(processed_indices) < len(times):
            next_idx = None
            
            async with service.IN_FLIGHT_LOCK:
                for dt, fut in list(context.hour_futures.items()):
                    if not fut.done():
                        idx = WeatherNormalizer.find_closest_time_index(times, dt)
                        if idx is not None and idx not in processed_indices:
                            next_idx = idx
                            break

            if next_idx is None:
                for idx in remaining_indices:
                    if idx not in processed_indices:
                        next_idx = idx
                        break

            if next_idx is None:
                break

            processed_indices.add(next_idx)
            t_str = times[next_idx]
            
            t_str_with_z = t_str if t_str.endswith("Z") else t_str + "Z"
            try:
                dt = datetime.fromisoformat(t_str_with_z.replace("Z", "+00:00"))
            except Exception as parse_err:
                logger.warning(f"[Dynamic Viewport BG] Failed to parse time string {t_str}: {parse_err}")
                continue

            for target_layer in conjoined_layers:
                this_cache_key = build_dynamic_cache_key(model, domain, target_layer, dt, west, south, east, north)
                this_viewport_filename = f"{this_cache_key}.json"

                this_normalized_product = None
                product_json_bytes = None
                try:
                    this_normalized_product = await service.normalizer.normalize_async(
                        model=model,
                        provider="copernicus" if (model.upper() == "EURO" and domain.lower() == "marine") else "open-meteo",
                        domain=domain,
                        layer=target_layer,
                        raw_results=context.raw_list,
                        bbox=bbox_dict,
                        resolution=resolution,
                        target_time=dt,
                        coverage_mode="viewport",
                        region_id=f"viewport_{bbox_key_str}"
                    )

                    if this_normalized_product and model.upper() == "ICON" and domain.lower() == "wind" and next_idx >= 120:
                        this_normalized_product.is_estimated = True
                        this_normalized_product.is_forecast_authoritative = False
                        this_normalized_product.estimate_basis = {
                            "type": "icon_loop_extrapolation",
                            "native_horizon_hours": 120,
                            "method": "diurnal_cycle_loop",
                            "source_model": "dwd_icon"
                        }

                    if not this_normalized_product:
                        continue

                    is_empty_grid = False
                    if this_normalized_product.grid and this_normalized_product.grid.vectors:
                        if not any(v.speed > 0 for v in this_normalized_product.grid.vectors):
                            is_empty_grid = True

                    if is_empty_grid:
                        logger.warning(f"[Dynamic Viewport BG] Normalization produced empty grid: model={model}, domain={domain}, layer={target_layer}. Saving zero grid.")

                    served_bbox_full = f"{this_normalized_product.grid.bounds.west},{this_normalized_product.grid.bounds.south},{this_normalized_product.grid.bounds.east},{this_normalized_product.grid.bounds.north}"

                    this_normalized_product.product_id = this_viewport_filename
                    this_normalized_product.is_dynamic_viewport_product = True
                    this_normalized_product.cache_key = this_cache_key
                    this_normalized_product.cache_hit = "cache_miss"
                    this_normalized_product.requested_bbox = bbox_str
                    this_normalized_product.served_bbox = served_bbox_full
                    this_normalized_product.coverage_scope = coverage_scope
                    this_normalized_product.coordinate_count = coord_count
                    this_normalized_product.resolution = resolution
                    this_normalized_product.requested_bbox_original = bbox_str
                    this_normalized_product.query_bbox = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
                    this_normalized_product.partial_coverage = False
                    this_normalized_product.stale = False

                    if this_normalized_product.grid:
                        this_normalized_product.grid.diagnostics = {
                            "requested_bbox": bbox_str,
                            "served_bbox": served_bbox_full,
                            "coverage_scope": coverage_scope,
                            "source_product_ids": ["open-meteo"],
                            "cache_hit": "cache_miss",
                            "provider": this_normalized_product.provider,
                            "model": model,
                            "domain": domain,
                            "layer": target_layer,
                            "valid_time": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "nonzeroCount": this_normalized_product.grid.diagnostics.get("nonzeroCount", 0) if this_normalized_product.grid.diagnostics else 0,
                            "vectorCount": len(this_normalized_product.grid.vectors) if this_normalized_product.grid.vectors else 0,
                            "vectors_length": len(this_normalized_product.grid.vectors) if this_normalized_product.grid.vectors else 0,
                            "gridMode": "rectangular",
                            "renderable": len(this_normalized_product.grid.vectors) > 0 and any(v.speed > 0 for v in this_normalized_product.grid.vectors),
                            "stale": False,
                            "partial_coverage": False
                        }

                    filepath = service.store.cache_dir / this_viewport_filename
                    tmp_filepath = filepath.with_suffix(".tmp")
                    
                    product_json_bytes = this_normalized_product.model_dump_json().encode("utf-8")
                    
                    def save_to_disk_bg(filepath, tmp_filepath, product_json_bytes):
                        with open(tmp_filepath, "wb") as f:
                            f.write(product_json_bytes)
                        os.replace(tmp_filepath, filepath)
                        
                    await asyncio.to_thread(save_to_disk_bg, filepath, tmp_filepath, product_json_bytes)

                    service.dynamic_index.add_product(
                        product_id=this_viewport_filename,
                        model=model,
                        domain=domain,
                        layer=target_layer,
                        valid_time=dt,
                        requested_bbox=bbox_str,
                        served_bbox=served_bbox_full,
                        coverage_scope=coverage_scope,
                        resolution=resolution,
                        cache_key=this_cache_key,
                        source=this_normalized_product.provider
                    )

                except Exception as step_err:
                    logger.error(f"[Dynamic Viewport BG] Failed to process time step {t_str} layer {target_layer}: {step_err}")
                finally:
                    this_normalized_product = None
                    product_json_bytes = None

            # Resolve any future for this hour after processing conjoined layers
            async with service.IN_FLIGHT_LOCK:
                fut = context.hour_futures.get(dt)
                if fut and not fut.done():
                    fut.set_result(True)

            # Yield to the event loop
            await asyncio.sleep(0.001)

            # Force garbage collection to reclaim memory from Pydantic models after every hour
            gc.collect()

    except asyncio.CancelledError:
        logger.info(f"[Dynamic Viewport BG] Background task for {model} {domain} {layer} was cancelled.")
        raise
    except Exception as bg_err:
        logger.error(f"[Dynamic Viewport BG] Unexpected error in background process: {bg_err}")
    finally:
        # Perform cleanup synchronously without lock to avoid CancelledError suppression
        service.IN_FLIGHT_REQUESTS.pop(request_dedup_key, None)
        for dt, fut in list(context.hour_futures.items()):
            if not fut.done():
                fut.set_exception(Exception("Background task finished without processing this hour"))
                try:
                    fut.exception()
                except Exception:
                    pass
        # Force garbage collection when task finishes or is cancelled
        gc.collect()


def extend_icon_wind_to_14d(raw_list):
    """ICON wind upstream returns only a short native horizon. Extrapolate each point's hourly arrays
    to 14 days (336 hours) by looping the valid (whole-day) portion, so far-hour scrubbing has data.
    Mutates raw_list in place. Extracted from ViewportService.fetch_viewport_grid_upstream (LOC cap)."""
    orig_times = []
    for item in raw_list:
        if "hourly" in item and "time" in item["hourly"] and item["hourly"]["time"]:
            orig_times = item["hourly"]["time"]
            break
    base_date = None
    if orig_times:
        try:
            first_time_str = orig_times[0]
            if not first_time_str.endswith("Z"):
                first_time_str += "Z"
            base_date = datetime.fromisoformat(first_time_str.replace("Z", "+00:00")).replace(minute=0, second=0, microsecond=0)
        except Exception as parse_err:
            logger.warning(f"[Dynamic Viewport] Failed to parse first time {orig_times[0]} for base_date: {parse_err}")
    if not base_date:
        base_date = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    for item in raw_list:
        if "hourly" in item and "time" in item["hourly"]:
            orig_speed = item["hourly"].get("wind_speed_10m", [])
            orig_direction = item["hourly"].get("wind_direction_10m", [])
            orig_gusts = item["hourly"].get("wind_gusts_10m", [])

            valid_len = len(orig_speed)
            for i in range(len(orig_speed) - 1, -1, -1):
                speed_val = orig_speed[i] if i < len(orig_speed) else None
                dir_val = orig_direction[i] if i < len(orig_direction) else None
                gust_val = orig_gusts[i] if (orig_gusts and i < len(orig_gusts)) else 0.0

                if speed_val is None or dir_val is None or (orig_gusts and gust_val is None):
                    valid_len = i
                else:
                    break

            if valid_len > 0:
                valid_len = (valid_len // 24) * 24

            if valid_len > 0:
                orig_speed = orig_speed[:valid_len]
                orig_direction = orig_direction[:valid_len]
                if orig_gusts:
                    orig_gusts = orig_gusts[:valid_len]

            new_times = []
            new_speed = []
            new_direction = []
            new_gusts = []

            for hour_idx in range(14 * 24):
                new_time = (base_date + timedelta(hours=hour_idx)).strftime("%Y-%m-%dT%H:%M")
                new_times.append(new_time)

                if orig_speed:
                    new_speed.append(orig_speed[hour_idx % len(orig_speed)])
                if orig_direction:
                    new_direction.append(orig_direction[hour_idx % len(orig_direction)])
                if orig_gusts:
                    new_gusts.append(orig_gusts[hour_idx % len(orig_gusts)])

            item["hourly"]["time"] = new_times
            item["hourly"]["wind_speed_10m"] = new_speed
            item["hourly"]["wind_direction_10m"] = new_direction
            if orig_gusts:
                item["hourly"]["wind_gusts_10m"] = new_gusts


def is_viewport_enabled_helper(
    model: str,
    domain: str,
    layer: str,
    use_manifest_product: bool,
    bbox: Optional[str] = None,
    target_dt: Optional[datetime] = None
) -> bool:
    """
    Determines if dynamic viewport bounds fetching is enabled for the model/layer combination.
    """
    if target_dt and domain.lower() == "marine":
        now_utc = datetime.now(timezone.utc)
        # Snap now_utc to the nearest hour to match frontend rounding
        now_ts = now_utc.timestamp()
        rounded_ts = round(now_ts / 3600.0) * 3600.0
        now_utc_snapped = datetime.fromtimestamp(rounded_ts, tz=timezone.utc)

        offset_hours = (target_dt - now_utc_snapped).total_seconds() / 3600.0

        limit = None
        if model.upper() == "EURO":
            limit = 240.0
        elif model.upper() == "ICON":
            limit = 168.0

        if limit is not None and offset_hours > limit + 0.01:
            return False

    return (
        bool(bbox) and
        model.upper() in ("GFS", "ICON", "EURO") and
        (
            (domain.lower() == "marine" and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")) or
            (domain.lower() == "wind" and layer.lower() == "wind")
        )
        and not use_manifest_product
    )


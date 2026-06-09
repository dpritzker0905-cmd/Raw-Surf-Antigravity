import math
import copy
import logging
from datetime import datetime, timezone
from typing import Optional, List, Tuple
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from services.weather_pipeline.schemas import (
    NormalizedProduct, CoverageBounds, GridVector
)

logger = logging.getLogger(__name__)

def parse_valid_time(valid_time_str: str) -> datetime:
    """
    Parses ISO-8601 UTC timestamp ensuring a Z suffix or correct offset.
    Raises HTTPException(400) on parse errors.
    """
    try:
        # Check if timezone is specified in the time part (after 'T' or space)
        time_part = valid_time_str.split("T")[-1] if "T" in valid_time_str else valid_time_str
        has_tz = "Z" in valid_time_str or "+" in time_part or "-" in time_part
        if not has_tz:
            valid_time_str += "+00:00"
        
        # fromisoformat requires replacing Z with +00:00 in older python versions,
        # but Python 3.11+ natively handles Z. To be safe:
        clean_str = valid_time_str.replace("Z", "+00:00")
        return datetime.fromisoformat(clean_str)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid valid_time ISO-8601 format: {e}")

def parse_bbox(bbox_str: str) -> Tuple[float, float, float, float]:
    """
    Parses a comma-separated bbox string into four floats: west, south, east, north.
    Raises HTTPException(400) if malformed, invalid comma count, non-float, or NaN/Infinity.
    """
    if not bbox_str:
        raise HTTPException(status_code=400, detail="Bounding box string is empty.")
    try:
        parts = [float(x) for x in bbox_str.split(",")]
        if len(parts) != 4:
            raise ValueError("bbox must contain exactly 4 comma-separated values")
        
        for val in parts:
            if math.isnan(val) or math.isinf(val):
                raise ValueError("NaN/Infinity bounding box values are not allowed")
                
        return parts[0], parts[1], parts[2], parts[3]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid bbox parameter format: {e}")

def wrap_longitude(lng: float) -> float:
    """
    Wraps longitude to [-180, 180] using modulo arithmetic to prevent infinite loops.
    Exact boundary behavior matches original while loop implementation.
    """
    if lng < -180.0 or lng > 180.0:
        wrapped = lng % 360.0
        if wrapped > 180.0:
            wrapped -= 360.0
        if wrapped == 180.0 and lng < 0:
            wrapped = -180.0
        return wrapped
    return lng

def clamp_and_normalize_bbox(w: float, s: float, e: float, n: float) -> Tuple[float, float, float, float]:
    """
    Clamps latitude to [-80, 85] and wraps longitude to [-180, 180].
    Swaps south/north if they are inverted.
    """
    if s > n:
        s, n = n, s
        
    south = max(-80.0, min(85.0, s))
    north = max(-80.0, min(85.0, n))
    
    west = wrap_longitude(w)
    east = wrap_longitude(e)
    
    return west, south, east, north

def generate_bbox_coords(w: float, s: float, e: float, n: float, res: float) -> Tuple[List[float], List[float]]:
    """
    Generates lists of latitudes and longitudes crossing the antimeridian at a given resolution.
    """
    if res <= 0.0:
        raise ValueError("Resolution must be greater than zero.")
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

def choose_adaptive_resolution(span_lng: float, span_lat: float) -> float:
    """
    Selects adaptive resolution based on bounding box dimensions.
    """
    est_res = math.sqrt((span_lng * span_lat) / 400.0)
    if est_res <= 0.25:
        return 0.25
    elif est_res <= 0.5:
        return 0.5
    elif est_res <= 1.0:
        return 1.0
    elif est_res <= 2.0:
        return 2.0
    elif est_res <= 2.5:
        return 2.5
    elif est_res <= 5.0:
        return 5.0
    elif est_res <= 10.0:
        return 10.0
    elif est_res <= 15.0:
        return 15.0
    elif est_res <= 20.0:
        return 20.0
    elif est_res <= 30.0:
        return 30.0
    else:
        return 40.0

def build_dynamic_cache_key(
    model: str, domain: str, layer: str, valid_time: datetime,
    w: float, s: float, e: float, n: float
) -> str:
    """Generates stable dynamic cache key."""
    time_str = valid_time.strftime("%Y%m%dT%H%M%SZ")
    bbox_key_str = f"{w:.2f}_{s:.2f}_{e:.2f}_{n:.2f}"
    return f"viewport_{model.lower()}_{domain.lower()}_{layer.lower()}_{time_str}_{bbox_key_str}"

def is_inside_bounds(lat: float, lng: float, bounds, margin: float = 0.01) -> bool:
    """
    Checks if a coordinate point is inside bounding box bounds (supports antimeridian crossing).
    Query coordinates are rounded to 4 decimal places to align with grid snapping tolerances.
    """
    lat_r = round(lat, 4)
    lng_r = round(lng, 4)
    in_lat = (bounds.south - margin) <= lat_r <= (bounds.north + margin)
    if bounds.west <= bounds.east:
        in_lng = (bounds.west - margin) <= lng_r <= (bounds.east + margin)
    else:
        in_lng = lng_r >= (bounds.west - margin) or lng_r <= (bounds.east + margin)
    return in_lat and in_lng

def get_actual_grid_bounds(bounds: CoverageBounds, resolution: float) -> CoverageBounds:
    """
    Computes the actual grid vector boundary bounds based on starting south/west coordinates
    and resolution step increments.
    """
    if not resolution or resolution <= 0.0:
        return bounds

    west = bounds.west
    east = bounds.east
    south = min(bounds.south, bounds.north)
    north = max(bounds.south, bounds.north)

    # Handle antimeridian crossing in monotonic space
    if west > east:
        east_monotonic = east + 360.0
    else:
        east_monotonic = east

    # Latitude steps (using 0.0001 padding matching normalizer.py)
    num_steps_lat = int((north - south + 0.0001) // resolution)
    actual_north = south + num_steps_lat * resolution

    # Longitude steps
    num_steps_lon = int((east_monotonic - west + 0.0001) // resolution)
    actual_east_monotonic = west + num_steps_lon * resolution

    # Wrap back actual_east if needed
    if west > east:
        actual_east = actual_east_monotonic - 360.0 if actual_east_monotonic > 180.0 else actual_east_monotonic
    else:
        actual_east = actual_east_monotonic

    return CoverageBounds(
        west=round(west, 4),
        south=round(south, 4),
        east=round(actual_east, 4),
        north=round(actual_north, 4)
    )


def is_bbox_covered_by(req_w: float, req_s: float, req_e: float, req_n: float, cov, margin: float = 0.05) -> bool:
    """
    Checks if requested bbox is fully covered by product coverage bounds (with margin).
    """
    lat_covers = (cov.south - margin) <= req_s and req_n <= (cov.north + margin)
    if not lat_covers:
        return False

    # Check if coverage is global or very wide
    if cov.west <= cov.east:
        cov_width = cov.east - cov.west
    else:
        cov_width = 360.0 + cov.east - cov.west

    if cov_width + 2 * margin >= 360.0:
        return True

    # Normalize longitudes to [-180, 180]
    cov_w = wrap_longitude(cov.west - margin)
    cov_e = wrap_longitude(cov.east + margin)
    
    cov_crosses = cov_w > cov_e
    req_crosses = req_w > req_e

    if not req_crosses:
        if not cov_crosses:
            lon_covers = (cov_w <= req_w) and (req_e <= cov_e)
        else:
            lon_covers = (req_w >= cov_w) or (req_e <= cov_e)
    else:
        if not cov_crosses:
            lon_covers = False
        else:
            lon_covers = (req_w >= cov_w) and (req_e <= cov_e)

    return lon_covers

def filter_grid_to_bbox(product: NormalizedProduct, bbox_str: str) -> NormalizedProduct:
    """
    Crops grid vectors to requested bbox and updates dimensions, returning a deep copy to prevent mutations.
    """
    try:
        west, south, east, north = clamp_and_normalize_bbox(*parse_bbox(bbox_str))
    except HTTPException as e:
        raise HTTPException(status_code=e.status_code, detail=f"Invalid bbox parameter format in filter: {e.detail}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid bbox parameter format in filter: {e}")

    # Create a deep copy to ensure we do not mutate cached memory objects
    cloned_product = copy.deepcopy(product)
    
    if not cloned_product.grid:
        return cloned_product

    # Filter grid vectors
    filtered_vectors = []
    crosses_antimeridian = west > east
    for v in cloned_product.grid.vectors:
        # Check bounds containment
        in_lat = south <= v.lat <= north
        if crosses_antimeridian:
            in_lng = (v.lng >= west or v.lng <= east)
        else:
            in_lng = west <= v.lng <= east
        if in_lat and in_lng:
            filtered_vectors.append(v)

    # Update grid bounds and dimension sizes dynamically
    unique_lats = sorted(list(set(v.lat for v in filtered_vectors)))
    
    if crosses_antimeridian:
        unique_lons = sorted(
            list(set(v.lng for v in filtered_vectors)),
            key=lambda lng: (0, lng) if lng >= west else (1, lng)
        )
    else:
        unique_lons = sorted(list(set(v.lng for v in filtered_vectors)))

    if filtered_vectors and unique_lats and unique_lons:
        if crosses_antimeridian:
            actual_west = min([lng for lng in unique_lons if lng >= west], default=west)
            actual_east = max([lng for lng in unique_lons if lng <= east], default=east)
        else:
            actual_west = min(unique_lons)
            actual_east = max(unique_lons)
        actual_south = min(unique_lats)
        actual_north = max(unique_lats)
        
        # Fill missing cells to maintain rectangular grid integrity
        existing_map = {(v.lat, v.lng): v for v in filtered_vectors}
        final_vectors = []
        for lat in unique_lats:
            for lng in unique_lons:
                if (lat, lng) in existing_map:
                    final_vectors.append(existing_map[(lat, lng)])
                else:
                    final_vectors.append(
                        GridVector(
                            lat=lat, lng=lng,
                            speed=0.0, direction=0.0,
                            u=0.0, v=0.0, period=0.0,
                            gust=None, value=None, is_valid=False
                        )
                    )
        
        # Stable row-major sorting matching WebGL expectations (lat ascending, lng in sorted column order)
        lon_to_index = {lng: i for i, lng in enumerate(unique_lons)}
        final_vectors.sort(key=lambda v: (v.lat, lon_to_index.get(v.lng, 0)))
        
        cloned_product.grid.bounds = CoverageBounds(
            west=actual_west, south=actual_south, east=actual_east, north=actual_north
        )
        cloned_product.grid.cols = len(unique_lons)
        cloned_product.grid.rows = len(unique_lats)
        cloned_product.grid.vectors = final_vectors
        cloned_product.requested_bbox = bbox_str
        cloned_product.served_bbox = f"{actual_west:.4f},{actual_south:.4f},{actual_east:.4f},{actual_north:.4f}"
        cloned_product.coverage = cloned_product.grid.bounds
    else:
        cloned_product.grid.bounds = CoverageBounds(
            west=west, south=south, east=east, north=north
        )
        cloned_product.grid.cols = 0
        cloned_product.grid.rows = 0
        cloned_product.grid.vectors = []
        cloned_product.requested_bbox = bbox_str
        cloned_product.served_bbox = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
        cloned_product.coverage = cloned_product.grid.bounds

    return cloned_product

def make_unsupported_icon_swell2_grid_response(domain: str, target_dt: datetime) -> JSONResponse:
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

def make_unsupported_icon_swell2_point_response(domain: str, lat: float, lng: float, target_dt: datetime) -> JSONResponse:
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

def make_no_coverage_grid_response(model: str, layer: str, valid_time: str) -> JSONResponse:
    reason = "no_copernicus_coverage" if model.upper() == "EURO" else "no_backend_coverage"
    return JSONResponse(
        status_code=404,
        content={
            "status": "error",
            "reason": reason,
            "detail": f"Authoritative weather grid product not found for {model} {layer} at time {valid_time}.",
            "is_estimated": False
        }
    )

def make_no_coverage_point_response(model: str, layer: str, lat: float, lng: float, valid_time: str, grid_product_id: Optional[str]) -> JSONResponse:
    reason = "no_copernicus_coverage" if model.upper() == "EURO" else "no_backend_coverage"
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


def make_grid_miss_point_response(model: str, layer: str, lat: float, lng: float, valid_time: str, grid_product_id: Optional[str], reason_code: str) -> JSONResponse:
    cov_status = "out_of_bounds/no_coverage" if reason_code == "point_outside_grid_product" else "no_coverage"
    return JSONResponse(
        status_code=200,
        content={
            "model": model.upper(),
            "provider": "none",
            "domain": "marine" if layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves") else "wind",
            "layer": layer.lower(),
            "run_time": datetime.now(timezone.utc).isoformat(),
            "valid_time": valid_time,
            "is_forecast_authoritative": False,
            "is_estimated": False,
            "point": {
                "requested_lat": lat,
                "requested_lng": lng,
                "sampled_lat": lat,
                "sampled_lng": lng,
                "speed": None,
                "direction": None,
                "u": None,
                "v": None,
                "period": None,
                "value": None,
                "interpolation_method": "none"
            },
            "value_kind": "wave_height" if layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves") else "wind_speed",
            "value_unit": "m" if layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves") else "kn",
            "display_unit_hint": "ft" if layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves") else "kn",
            "product_id": grid_product_id,
            "source": "grid_file",
            "status": cov_status,
            "coverage_status": cov_status,
            "fallback_attempted": False,
            "fallbackAttempted": False,
            "fallback_reason": reason_code,
            "fallbackReason": reason_code,
            "grid_parity": False,
            "gridParity": False,
            "source_variables": [],
            "freshness_sec": 1800
        }
    )

def compute_truth_tag(
    model: str,
    domain: str,
    layer: str,
    valid_time: datetime,
    run_time: datetime,
    product_id: Optional[str],
    provider: str,
    upstream_model: Optional[str],
    is_dynamic_viewport_product: bool,
    coverage_scope: Optional[str],
    requested_bbox: Optional[str],
    served_bbox: Optional[str],
    cols: int,
    rows: int,
    vectors: list,
    source_stage: str = "backendResponse"
) -> dict:
    # 1. Compute dataHash
    serialized_parts = []
    nonzero_count = 0
    min_speed = float('inf')
    max_speed = float('-inf')
    
    for v in vectors:
        lat_f = f"{v.lat:.4f}"
        lng_f = f"{v.lng:.4f}"
        speed_f = f"{v.speed:.4f}"
        u_f = f"{v.u:.4f}"
        v_f = f"{v.v:.4f}"
        period_val = v.period if (hasattr(v, 'period') and v.period is not None) else 0.0
        period_f = f"{period_val:.4f}"
        is_val = 1 if (hasattr(v, 'is_valid') and v.is_valid) else 0
        serialized_parts.append(f"{lat_f},{lng_f},{speed_f},{u_f},{v_f},{period_f},{is_val}")
        
        if v.speed > 0.0:
            nonzero_count += 1
        if v.speed < min_speed:
            min_speed = v.speed
        if v.speed > max_speed:
            max_speed = v.speed
            
    if min_speed == float('inf'):
        min_speed = 0.0
    if max_speed == float('-inf'):
        max_speed = 0.0
        
    serialized_str = "\n".join(serialized_parts)
    
    # FNV-1a 32-bit hash function
    h = 2166136261
    for b in serialized_str.encode("utf-8"):
        h = h ^ b
        h = (h * 16777619) & 0xFFFFFFFF
    data_hash = f"{h:08x}"
    
    # 2. Compute boundsHash
    bbox_str = served_bbox or ""
    bh = 2166136261
    for b in bbox_str.encode("utf-8"):
        bh = bh ^ b
        bh = (bh * 16777619) & 0xFFFFFFFF
    bounds_hash = f"{bh:08x}"
    
    # 3. Compute traceId
    valid_time_str = valid_time.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    trace_key = f"{model.upper()}:{domain.lower()}:{layer.lower()}:{valid_time_str}:{bbox_str}:{data_hash}"
    
    th = 2166136261
    for b in trace_key.encode("utf-8"):
        th = th ^ b
        th = (th * 16777619) & 0xFFFFFFFF
    trace_id = f"{th:08x}"
    
    # 4. Compute timeOffsetHours
    time_offset = int((valid_time - run_time).total_seconds() / 3600)
    
    created_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    
    return {
        "traceId": trace_id,
        "model": model,
        "domain": domain,
        "layer": layer,
        "valid_time": valid_time_str,
        "timeOffsetHours": time_offset,
        "product_id": product_id,
        "grid_product_id": product_id,
        "provider": provider,
        "upstream_model": upstream_model,
        "is_dynamic_viewport_product": is_dynamic_viewport_product,
        "coverage_scope": coverage_scope,
        "requested_bbox": requested_bbox,
        "served_bbox": bbox_str,
        "cols": cols,
        "rows": rows,
        "vectorCount": len(vectors),
        "nonzeroCount": nonzero_count,
        "minSpeed": round(min_speed, 4),
        "maxSpeed": round(max_speed, 4),
        "dataHash": data_hash,
        "boundsHash": bounds_hash,
        "createdAt": created_at,
        "sourceStage": source_stage
    }


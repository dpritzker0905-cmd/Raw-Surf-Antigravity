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
        if not valid_time_str.endswith("Z"):
            # Enforce UTC timezone suffix if missing
            valid_time_str += "Z"
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

def clamp_and_normalize_bbox(w: float, s: float, e: float, n: float) -> Tuple[float, float, float, float]:
    """
    Clamps latitude to [-80, 85] and wraps longitude to [-180, 180].
    Swaps south/north if they are inverted.
    """
    if s > n:
        s, n = n, s
        
    south = max(-80.0, min(85.0, s))
    north = max(-80.0, min(85.0, n))
    
    west = w
    east = e
    while west < -180.0: west += 360.0
    while west > 180.0: west -= 360.0
    while east < -180.0: east += 360.0
    while east > 180.0: east -= 360.0
    
    return west, south, east, north

def generate_bbox_coords(w: float, s: float, e: float, n: float, res: float) -> Tuple[List[float], List[float]]:
    """
    Generates lists of latitudes and longitudes crossing the antimeridian at a given resolution.
    """
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
    else:
        return 10.0

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
    """
    in_lat = (bounds.south - margin) <= lat <= (bounds.north + margin)
    if bounds.west <= bounds.east:
        in_lng = (bounds.west - margin) <= lng <= (bounds.east + margin)
    else:
        in_lng = lng >= (bounds.west - margin) or lng <= (bounds.east + margin)
    return in_lat and in_lng

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
    def normalize_longitude(lng: float) -> float:
        while lng < -180.0: lng += 360.0
        while lng > 180.0: lng -= 360.0
        return lng

    cov_w = normalize_longitude(cov.west - margin)
    cov_e = normalize_longitude(cov.east + margin)
    
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
        parts = [float(x) for x in bbox_str.split(",")]
        west, south, east, north = parts
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
                            u=0.0, v=0.0, is_valid=False
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


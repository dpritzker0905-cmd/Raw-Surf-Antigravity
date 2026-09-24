import math
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
    NormalizedPointResponse, NormalizedPointDetail
)

logger = logging.getLogger(__name__)

class EstimateContractError(Exception):
    """Exception raised when an estimated grid violates size or shape contracts."""
    pass


# Constants
EURO_LIMIT_WAVES = 240       # hours
EURO_LIMIT_COMPONENTS = 240   # hours
ICON_LIMIT = 168             # hours

def get_estimate_weights(target_hour: float, native_limit: float, is_icon_valid: bool = False) -> dict:
    """Calculates weights and confidence for a target hour past the native limit."""
    days_past = max(0.0, (target_hour - native_limit) / 24.0)
    confidence = max(0.10, 1.0 - 0.15 * days_past)

    w_persistence = 0.0
    w_gfs = 0.0
    w_icon = 0.0

    if is_icon_valid and target_hour <= ICON_LIMIT:
        if days_past <= 1.0:
            w_persistence = 0.60 - 0.20 * days_past
            w_gfs = 0.30 + 0.20 * days_past
            w_icon = 0.10
        elif days_past <= 5.0:
            pct = (days_past - 1.0) / 4.0
            w_persistence = 0.40 * (1.0 - pct)
            w_gfs = 0.50 + 0.40 * pct
            w_icon = 0.10 * (1.0 - pct)
        else:
            w_persistence = 0.0
            w_gfs = 1.0
            w_icon = 0.0
    else:
        if days_past <= 1.0:
            w_persistence = 0.70 - 0.30 * days_past
            w_gfs = 0.30 + 0.30 * days_past
            w_icon = 0.0
        elif days_past <= 5.0:
            pct = (days_past - 1.0) / 4.0
            w_persistence = 0.40 * (1.0 - pct)
            w_gfs = 0.60 + 0.40 * pct
            w_icon = 0.0
        else:
            w_persistence = 0.0
            w_gfs = 1.0
            w_icon = 0.0

    sum_weights = w_persistence + w_gfs + w_icon
    return {
        "persistence": w_persistence / sum_weights if sum_weights > 0.0 else 0.0,
        "gfs": w_gfs / sum_weights if sum_weights > 0.0 else 0.0,
        "icon": w_icon / sum_weights if sum_weights > 0.0 else 0.0,
        "confidence": confidence
    }

def _finite_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _direction_from_components(u, v, amplitude) -> Optional[float]:
    """Resolve a bearing only above dimensionless floating-point cancellation noise.

    Angular roundoff grows as O(epsilon / resultant). sqrt(epsilon) is a numerical
    conditioning guard, NOT calibrated directional confidence or a physical threshold.
    Components and amplitude must use the same units; calm has no vector bearing.
    """
    if not all(_finite_number(x) for x in (u, v, amplitude)) or amplitude <= 0.0:
        return None
    if math.hypot(u / amplitude, v / amplitude) <= math.sqrt(math.ulp(1.0)):
        return None
    return (math.degrees(math.atan2(-u, -v)) + 360.0) % 360.0


def blend_direction(heights: list, directions: list, weights: list) -> Optional[float]:
    """Height-weighted circular blend; missing active support or cancellation refuses.

    Zero weight/height contributes no directional energy. For an entirely calm blend,
    retain an existing finite bearing when present; callers keep their zero-vector
    calm representation when absent, without interpreting it as measured direction.
    """
    us, vs, amplitudes = [], [], []
    calm_direction = None

    for i in range(len(heights)):
        h = heights[i]
        d = directions[i]
        w = weights[i]

        if not _finite_number(w):
            return None
        if w <= 0.0:
            continue
        if not _finite_number(h) or h < 0.0:
            return None
        if h == 0.0:
            if calm_direction is None and _finite_number(d):
                calm_direction = d % 360.0
            continue
        if not _finite_number(d) or not math.isfinite(h * w):
            return None
        rad = math.radians(d % 360.0)
        amplitudes.append(h * w)
        us.append(-h * w * math.sin(rad))
        vs.append(-h * w * math.cos(rad))

    if not amplitudes:
        return calm_direction
    return _direction_from_components(math.fsum(us), math.fsum(vs), math.fsum(amplitudes))

def blend_period(periods: list, weights: list) -> Optional[float]:
    """Linear blend for wave period, rejecting zero/null values."""
    period_sum = 0.0
    weight_sum = 0.0

    for i in range(len(periods)):
        p = periods[i]
        w = weights[i]
        if p is not None and p > 0.0 and not math.isnan(p) and w > 0.0:
            period_sum += p * w
            weight_sum += w

    return period_sum / weight_sum if weight_sum > 0.0 else None

def _usable_marine_vector(vector) -> bool:
    """A wet, finite source cell; zero-height calm water remains valid.

    Height and direction components share one support mask so a sample cannot describe
    different source populations. Period has separate optional support.
    """
    return bool(
        vector is not None and vector.is_valid and vector.speed >= 0.0
        and all(math.isfinite(value) for value in (vector.speed, vector.u, vector.v))
    )


def resample_from_grid(lat: float, lng: float, grid: Any) -> Optional[dict]:
    """Bilinear marine sampling over wet support, with missing periods kept separate.

    Invalid cells contain numeric zero placeholders, not calm-water observations. Exclude
    them and renormalize the remaining positive weights; no wet support means no sample.
    """
    if (not grid or not grid.vectors or not grid.bounds
            or grid.cols <= 0 or grid.rows <= 0):
        return None

    west = grid.bounds.west
    south = grid.bounds.south
    east = grid.bounds.east
    north = grid.bounds.north

    if not all(math.isfinite(value) for value in (lat, lng, west, south, east, north)):
        return None
    
    if west <= east:
        lng_span = east - west
    else:
        lng_span = (east + 360.0) - west
    lat_span = north - south

    if lng_span <= 0.0 or lat_span <= 0.0:
        return None

    # Normalize longitude into grid bounds
    norm_lng = west + (lng - west) % 360.0

    if norm_lng < west or norm_lng > west + lng_span or lat < south or lat > north:
        return None

    # Compute fractional coordinates
    fx = ((norm_lng - west) / lng_span) * (grid.cols - 1)
    fy = ((lat - south) / lat_span) * (grid.rows - 1)

    x0 = int(fx)
    x1 = min(grid.cols - 1, x0 + 1)
    y0 = int(fy)
    y1 = min(grid.rows - 1, y0 + 1)

    dx = fx - x0
    dy = fy - y0

    idx00 = y0 * grid.cols + x0
    idx10 = y0 * grid.cols + x1
    idx01 = y1 * grid.cols + x0
    idx11 = y1 * grid.cols + x1

    if (
        idx00 >= len(grid.vectors) or 
        idx10 >= len(grid.vectors) or 
        idx01 >= len(grid.vectors) or 
        idx11 >= len(grid.vectors)
    ):
        return None

    corners = (
        (grid.vectors[idx00], (1.0 - dx) * (1.0 - dy)),
        (grid.vectors[idx10], dx * (1.0 - dy)),
        (grid.vectors[idx01], (1.0 - dx) * dy),
        (grid.vectors[idx11], dx * dy),
    )
    support = [(cell, weight) for cell, weight in corners
               if weight > 0.0 and _usable_marine_vector(cell)]
    weight_sum = sum(weight for _, weight in support)
    if weight_sum <= 0.0:
        return None

    values = {name: sum(getattr(cell, name) * weight for cell, weight in support) / weight_sum
              for name in ("u", "v", "speed")}
    period_support = [(cell.period, weight) for cell, weight in support
                      if cell.period is not None and math.isfinite(cell.period) and cell.period > 0.0]
    period_weight = sum(weight for _, weight in period_support)
    values["period"] = (sum(period * weight for period, weight in period_support) / period_weight
                        if period_weight > 0.0 else None)
    return values

def estimate_euro_grid(
    target_hour: float,
    native_limit: float,
    active_layer: str,
    euro_anchor_product: NormalizedProduct,
    gfs_target_product: NormalizedProduct,
    gfs_anchor_product: NormalizedProduct,
    icon_target_product: Optional[NormalizedProduct] = None,
    icon_anchor_product: Optional[NormalizedProduct] = None,
    euro_anchor_valid_time: Optional[datetime] = None,
    gfs_anchor_valid_time: Optional[datetime] = None,
    icon_anchor_valid_time: Optional[datetime] = None,
    gfs_target_valid_time: Optional[datetime] = None,
    icon_target_valid_time: Optional[datetime] = None
) -> Optional[NormalizedProduct]:
    """Calculates Grid Extended Estimate cell-by-cell past native EURO coverage."""
    euro_anchor_grid = euro_anchor_product.grid
    gfs_target_grid = gfs_target_product.grid
    gfs_anchor_grid = gfs_anchor_product.grid

    if not euro_anchor_grid or not euro_anchor_grid.vectors or not gfs_target_grid or not gfs_anchor_grid:
        return None

    icon_target_grid = icon_target_product.grid if icon_target_product else None
    icon_anchor_grid = icon_anchor_product.grid if icon_anchor_product else None

    is_icon_valid = bool(
        icon_target_grid and icon_target_grid.vectors and
        icon_anchor_grid and icon_anchor_grid.vectors
    )

    weights_dict = get_estimate_weights(target_hour, native_limit, is_icon_valid)
    w_persist = weights_dict["persistence"]
    w_gfs = weights_dict["gfs"]
    w_icon = weights_dict["icon"]
    confidence = weights_dict["confidence"]

    # Nominal (whole-grid) weight split, bound BEFORE the loop. The per-cell w_*_real below may
    # redistribute the ICON share to GFS where an individual cell lacks ICON coverage — but if
    # EVERY cell short-circuits (`continue`) the loop never binds them, and the post-loop
    # diagnostics raised UnboundLocalError, killing the whole extended-estimates job (2026-07-20
    # cron run 29724899253: all 629 global_coarse cells skipped while the stored L2 copies of all
    # inputs were healthy — the degenerate state lived in the shared in-process product cache).
    w_icon_real = w_icon if is_icon_valid else 0.0
    w_gfs_real = w_gfs + (0.0 if is_icon_valid else w_icon)

    vectors = []
    vector_count = 0
    nonzero_count = 0
    blended_cells = 0
    skipped_invalid_anchor = 0
    skipped_gfs_resample = 0
    skipped_unresolved_direction = 0

    for v_euro_anchor in euro_anchor_grid.vectors:
        vector_count += 1
        lat = v_euro_anchor.lat
        lng = v_euro_anchor.lng
        is_valid = _usable_marine_vector(v_euro_anchor)

        if not is_valid:
            skipped_invalid_anchor += 1
            vectors.append(
                GridVector(
                    lat=lat, lng=lng,
                    speed=0.0, direction=0.0,
                    u=0.0, v=0.0, period=None,
                    is_valid=False
                )
            )
            continue

        h_euro_anchor = v_euro_anchor.speed or 0.0
        p_euro_anchor = v_euro_anchor.period
        if p_euro_anchor is None or not math.isfinite(p_euro_anchor) or p_euro_anchor <= 0.0:
            p_euro_anchor = 0.0

        # Extract direction of EURO anchor
        d_euro_anchor = _direction_from_components(v_euro_anchor.u, v_euro_anchor.v, h_euro_anchor)

        # Resample GFS
        c_gfs_anchor = resample_from_grid(lat, lng, gfs_anchor_grid)
        c_gfs_target = resample_from_grid(lat, lng, gfs_target_grid)

        if not c_gfs_anchor or not c_gfs_target:
            skipped_gfs_resample += 1
            vectors.append(
                GridVector(
                    lat=lat, lng=lng,
                    speed=0.0, direction=0.0,
                    u=0.0, v=0.0, period=None,
                    is_valid=False
                )
            )
            continue

        # Extract GFS direction from target
        d_gfs_target = _direction_from_components(c_gfs_target["u"], c_gfs_target["v"], c_gfs_target["speed"])

        h_gfs_trend = max(0.0, h_euro_anchor + (c_gfs_target["speed"] - c_gfs_anchor["speed"]))
        
        # A period trend needs both endpoints. Missing target periods cannot mean zero
        # seconds: retain the EURO anchor period when the trend is unavailable.
        if (p_euro_anchor > 0.0 and c_gfs_anchor["period"] is not None
                and c_gfs_target["period"] is not None):
            p_gfs_trend = max(2.0, p_euro_anchor + (c_gfs_target["period"] - c_gfs_anchor["period"]))
        else:
            p_gfs_trend = p_euro_anchor
            
        d_gfs_trend = d_gfs_target

        # ICON inputs
        h_icon_trend = 0.0
        p_icon_trend = 0.0
        d_icon_trend = None
        valid_icon = False

        if is_icon_valid:
            c_icon_anchor = resample_from_grid(lat, lng, icon_anchor_grid)
            c_icon_target = resample_from_grid(lat, lng, icon_target_grid)
            if c_icon_anchor and c_icon_target and c_icon_target["speed"] is not None:
                d_icon_target = _direction_from_components(c_icon_target["u"], c_icon_target["v"], c_icon_target["speed"])

                h_icon_trend = max(0.0, h_euro_anchor + (c_icon_target["speed"] - c_icon_anchor["speed"]))
                valid_icon = not (w_icon * h_icon_trend > 0.0 and d_icon_target is None)
                
                if (p_euro_anchor > 0.0 and c_icon_anchor["period"] is not None
                        and c_icon_target["period"] is not None):
                    p_icon_trend = max(2.0, p_euro_anchor + (c_icon_target["period"] - c_icon_anchor["period"]))
                else:
                    p_icon_trend = p_euro_anchor
                    
                d_icon_trend = d_icon_target

        w_icon_real = w_icon if (is_icon_valid and valid_icon) else 0.0
        w_gfs_real = w_gfs + (w_icon if (is_icon_valid and not valid_icon) else 0.0)

        # Blended Height
        blended_height = max(0.0, w_persist * h_euro_anchor + w_gfs_real * h_gfs_trend + w_icon_real * h_icon_trend)

        # Blended Period
        periods = [p_euro_anchor, p_gfs_trend]
        p_weights = [w_persist, w_gfs_real]
        if is_icon_valid and valid_icon:
            periods.append(p_icon_trend)
            p_weights.append(w_icon_real)
        
        blended_period = blend_period(periods, p_weights)

        # Blended Direction
        directions = [d_euro_anchor, d_gfs_trend]
        d_weights = [w_persist, w_gfs_real]
        heights = [h_euro_anchor, h_gfs_trend]
        if is_icon_valid and valid_icon:
            directions.append(d_icon_trend)
            d_weights.append(w_icon_real)
            heights.append(h_icon_trend)

        blended_direction = blend_direction(heights, directions, d_weights)
        if blended_height > 0.0 and blended_direction is None:
            skipped_unresolved_direction += 1
            vectors.append(GridVector(lat=lat, lng=lng, speed=0.0, direction=0.0,
                                      u=0.0, v=0.0, period=None, is_valid=False))
            continue
        if blended_height > 0.05:
            nonzero_count += 1

        u = 0.0
        v = 0.0
        if blended_height > 0.0 and blended_direction is not None:
            rad = blended_direction * math.pi / 180.0
            u = -blended_height * math.sin(rad)
            v = -blended_height * math.cos(rad)

        vectors.append(
            GridVector(
                lat=lat, lng=lng,
                speed=round(blended_height, 4),
                direction=round(blended_direction, 2) if blended_direction is not None else 0.0,
                u=round(u, 4),
                v=round(v, 4),
                period=round(blended_period, 2) if blended_period is not None else None,
                is_valid=True
            )
        )
        blended_cells += 1

    if blended_cells == 0:
        # Every cell short-circuited: a blend product here would be all-invalid garbage. Log the
        # geometry of every input so the NEXT occurrence identifies WHICH grid was degenerate
        # (2026-07-20: the stored L2 copies were all healthy, so the corruption was in-process),
        # then skip this target instead of saving or raising.
        def _geo(tag, p):
            g = getattr(p, "grid", None) if p else None
            b = getattr(g, "bounds", None) if g else None
            return (
                f"{tag}={getattr(p, 'product_id', None) if p else None} "
                f"cols={getattr(g, 'cols', None)} rows={getattr(g, 'rows', None)} "
                f"nvec={len(g.vectors) if (g and g.vectors) else 0} "
                f"bounds={(b.west, b.south, b.east, b.north) if b else None}"
            )
        logger.error(
            "[Estimator] ZERO blendable cells for %s@%.0fh — skipped_invalid_anchor=%d "
            "skipped_gfs_resample=%d skipped_unresolved_direction=%d of %d anchor cells. %s | %s | %s",
            active_layer, target_hour, skipped_invalid_anchor, skipped_gfs_resample,
            skipped_unresolved_direction, vector_count,
            _geo("euro_anchor", euro_anchor_product),
            _geo("gfs_anchor", gfs_anchor_product),
            _geo("gfs_target", gfs_target_product),
        )
        return None

    new_grid = NormalizedGrid(
        bounds=euro_anchor_grid.bounds,
        cols=euro_anchor_grid.cols,
        rows=euro_anchor_grid.rows,
        vectors=vectors,
        diagnostics={
            "vectorCount": vector_count,
            "nonzeroCount": nonzero_count,
            "unresolvedDirectionCount": skipped_unresolved_direction,
            "estimateConfidence": confidence,
            "weights": {"persistence": w_persist, "gfs": w_gfs_real, "icon": w_icon_real}
        }
    )

    # Hardening contract validation
    expected_len = new_grid.cols * new_grid.rows
    actual_len = len(vectors)
    if actual_len != expected_len:
        logger.error(
            f"[Estimator] Grid contract violation: expected {expected_len} vectors (cols={new_grid.cols}, rows={new_grid.rows}), "
            f"got {actual_len} vectors.",
            extra={
                "expected_len": expected_len,
                "actual_len": actual_len,
                "cols": new_grid.cols,
                "rows": new_grid.rows,
                "layer": active_layer,
                "region_id": euro_anchor_product.region_id
            }
        )
        raise EstimateContractError(f"Grid contract violation: expected {expected_len}, got {actual_len}")

    if new_grid.diagnostics.get("vectorCount") != actual_len:
        logger.error(
            f"[Estimator] Grid contract violation: vectorCount diagnostic {new_grid.diagnostics.get('vectorCount')} "
            f"does not match actual length {actual_len}."
        )
        raise EstimateContractError("Grid contract violation: vectorCount diagnostic mismatch")

    valid_time = gfs_target_product.valid_time

    # Calculate deltas if valid times are provided
    anchor_delta_hours = None
    if gfs_anchor_valid_time and euro_anchor_valid_time:
        anchor_delta_hours = abs((gfs_anchor_valid_time - euro_anchor_valid_time).total_seconds()) / 3600.0

    target_delta_hours = None
    if gfs_target_valid_time:
        target_delta_hours = abs((gfs_target_valid_time - valid_time).total_seconds()) / 3600.0

    estimate_basis = {
        "type": "euro_persistence_gfs_icon_blend" if is_icon_valid else "euro_persistence_gfs_blend",
        "target_valid_time": valid_time.isoformat(),
        "layer": active_layer,
        "region_id": euro_anchor_product.region_id,
        "tile_id": euro_anchor_product.tile_id,
        "native_limit_hours": int(native_limit),
        "euro_anchor_product_id": euro_anchor_product.product_id or "",
        "gfs_anchor_product_id": gfs_anchor_product.product_id or "",
        "gfs_target_product_id": gfs_target_product.product_id or "",
        "icon_anchor_product_id": icon_anchor_product.product_id if is_icon_valid else None,
        "icon_target_product_id": icon_target_product.product_id if is_icon_valid else None,
        "weights": {"persistence": round(w_persist, 4), "gfs": round(w_gfs_real, 4), "icon": round(w_icon_real, 4)},
        "confidence": round(confidence, 4),
        "euro_anchor_valid_time": euro_anchor_valid_time.isoformat() if euro_anchor_valid_time else None,
        "gfs_anchor_valid_time": gfs_anchor_valid_time.isoformat() if gfs_anchor_valid_time else None,
        "icon_anchor_valid_time": icon_anchor_valid_time.isoformat() if icon_anchor_valid_time else None,
        "gfs_target_valid_time": gfs_target_valid_time.isoformat() if gfs_target_valid_time else None,
        "icon_target_valid_time": icon_target_valid_time.isoformat() if icon_target_valid_time else None,
        "anchor_delta_hours": anchor_delta_hours,
        "target_delta_hours": target_delta_hours
    }

    est_product = NormalizedProduct(
        model="EURO",
        provider="estimated",
        domain=euro_anchor_product.domain,
        layer=euro_anchor_product.layer,
        run_time=euro_anchor_product.run_time,
        valid_time=valid_time,
        is_forecast_authoritative=False,
        is_estimated=True,
        estimate_basis=estimate_basis,
        coverage=euro_anchor_product.coverage,
        grid=new_grid,
        value_kind=euro_anchor_product.value_kind,
        value_unit=euro_anchor_product.value_unit,
        display_unit_hint=euro_anchor_product.display_unit_hint,
        region_id=euro_anchor_product.region_id,
        coverage_mode=euro_anchor_product.coverage_mode,
        tile_id=euro_anchor_product.tile_id,
        source_variables=euro_anchor_product.source_variables,
        freshness_sec=euro_anchor_product.freshness_sec,
        source_dataset="estimated_blend"
    )

    return est_product

def _extract_point_vals(raw_point: dict, layer: str, idx: int) -> dict:
    if not raw_point or "hourly" not in raw_point:
        return {"speed": None, "direction": None, "period": 0.0}
    h = raw_point["hourly"]
    l_map = {
        "waves": ("wave_height", "wave_direction", "wave_period"),
        "swell_1": ("swell_wave_height", "swell_wave_direction", "swell_wave_period"),
        "swell_2": ("secondary_swell_wave_height", "secondary_swell_wave_direction", "secondary_swell_wave_period"),
        "wind_waves": ("wind_wave_height", "wind_wave_direction", "wind_wave_period")
    }
    speed_key, dir_key, per_key = l_map.get(layer.lower(), ("wave_height", "wave_direction", "wave_period"))
    if layer.lower() == "swell_2" and speed_key not in h and "swell_wave_height" in h:
        speed_key, dir_key, per_key = "swell_wave_height", "swell_wave_direction", "swell_wave_period"
        
    def get_val(key, default=0.0):
        lst = h.get(key)
        if isinstance(lst, list) and 0 <= idx < len(lst):
            val = lst[idx]
            return val if val is not None else default
        return default

    return {
        "speed": get_val(speed_key, None),
        "direction": get_val(dir_key, None),
        "period": get_val(per_key)
    }


def _usable_point_height(values: dict) -> bool:
    height = values.get("speed")
    return (isinstance(height, (int, float)) and not isinstance(height, bool)
            and math.isfinite(height) and height >= 0.0)


async def resolve_euro_estimate_point(
    provider_inst: Any,
    domain: str,
    layer: str,
    lat: float,
    lng: float,
    target_dt: datetime,
    raw_euro: dict
) -> Optional[NormalizedPointResponse]:
    from services.weather_pipeline.normalizer import WeatherNormalizer
    euro_times = raw_euro["hourly"]["time"]
    anchor_idx = len(euro_times) - 1
    anchor_dt = datetime.fromisoformat(euro_times[anchor_idx].replace("Z", "+00:00"))
    
    gfs_raw = await provider_inst.fetch_point(model="GFS", domain=domain, layer=layer, lat=lat, lng=lng, forecast_days=16)
    if not gfs_raw or "hourly" not in gfs_raw or "time" not in gfs_raw["hourly"]:
        return None
    gfs_times = gfs_raw["hourly"]["time"]
    gfs_anc_idx = WeatherNormalizer.find_closest_time_index(gfs_times, anchor_dt)
    gfs_tgt_idx = WeatherNormalizer.find_closest_time_index(gfs_times, target_dt)
    if gfs_anc_idx is None or gfs_tgt_idx is None:
        return None
        
    euro_anc = _extract_point_vals(raw_euro, layer, anchor_idx)
    gfs_anc = _extract_point_vals(gfs_raw, layer, gfs_anc_idx)
    gfs_tgt = _extract_point_vals(gfs_raw, layer, gfs_tgt_idx)
    # The required trend cannot be formed from absent heights. Refuse this estimate so
    # the existing resolver can return its labeled coarse fallback or no-coverage response.
    # An explicit numeric zero is still a valid calm-water height.
    if not all(_usable_point_height(values) for values in (euro_anc, gfs_anc, gfs_tgt)):
        return None
    
    now_dt = datetime.now(timezone.utc)
    target_hour = (target_dt - now_dt).total_seconds() / 3600.0
    is_icon_valid = False
    icon_anc, icon_tgt = None, None
    
    if layer.lower() != "swell_2" and target_hour <= 168.0:
        try:
            icon_raw = await provider_inst.fetch_point(model="ICON", domain=domain, layer=layer, lat=lat, lng=lng, forecast_days=7)
            if icon_raw and "hourly" in icon_raw and "time" in icon_raw["hourly"]:
                icon_times = icon_raw["hourly"]["time"]
                icon_anc_idx = WeatherNormalizer.find_closest_time_index(icon_times, anchor_dt)
                icon_tgt_idx = WeatherNormalizer.find_closest_time_index(icon_times, target_dt)
                if icon_anc_idx is not None and icon_tgt_idx is not None:
                    icon_anc = _extract_point_vals(icon_raw, layer, icon_anc_idx)
                    icon_tgt = _extract_point_vals(icon_raw, layer, icon_tgt_idx)
                    is_icon_valid = all(_usable_point_height(values) for values in (icon_anc, icon_tgt))
        except Exception:
            pass
            
    native_limit = EURO_LIMIT_WAVES if layer.lower() == "waves" else EURO_LIMIT_COMPONENTS
    w = get_estimate_weights(target_hour, native_limit, is_icon_valid)
    if (is_icon_valid and w["icon"] > 0.0
            and max(0.0, euro_anc["speed"] + icon_tgt["speed"] - icon_anc["speed"]) > 0.0
            and not _finite_number(icon_tgt["direction"])):
        # Apply the same unavailable-source policy as a missing ICON height. Anchor
        # bearings are not consumed by a height trend and do not govern eligibility.
        is_icon_valid = False
        w = get_estimate_weights(target_hour, native_limit, False)
    w_persist, w_gfs, w_icon, confidence = w["persistence"], w["gfs"], w["icon"], w["confidence"]
    w_icon_real = w_icon if is_icon_valid else 0.0
    w_gfs_real = w_gfs + (w_icon if not is_icon_valid else 0.0)
    
    # Match the grid estimator's period contract. Upstream nulls were historically
    # decoded as zero here; zero/nonfinite periods cannot anchor a physical trend.
    for values in (euro_anc, gfs_anc, gfs_tgt, icon_anc, icon_tgt):
        if values is not None:
            period = values["period"]
            if (not isinstance(period, (int, float)) or isinstance(period, bool)
                    or not math.isfinite(period) or period <= 0.0):
                values["period"] = None

    h_gfs_trend = max(0.0, euro_anc["speed"] + (gfs_tgt["speed"] - gfs_anc["speed"]))
    p_gfs_trend = euro_anc["period"]
    if all(values["period"] is not None for values in (euro_anc, gfs_anc, gfs_tgt)):
        p_gfs_trend = max(2.0, euro_anc["period"] + (gfs_tgt["period"] - gfs_anc["period"]))
    
    h_icon_trend, p_icon_trend = 0.0, euro_anc["period"]
    if is_icon_valid and icon_anc and icon_tgt:
        h_icon_trend = max(0.0, euro_anc["speed"] + (icon_tgt["speed"] - icon_anc["speed"]))
        if all(values["period"] is not None for values in (euro_anc, icon_anc, icon_tgt)):
            p_icon_trend = max(2.0, euro_anc["period"] + (icon_tgt["period"] - icon_anc["period"]))
        
    blended_height = max(0.0, w_persist * euro_anc["speed"] + w_gfs_real * h_gfs_trend + w_icon_real * h_icon_trend)
    
    periods = [euro_anc["period"], p_gfs_trend]
    p_weights = [w_persist, w_gfs_real]
    if is_icon_valid:
        periods.append(p_icon_trend)
        p_weights.append(w_icon_real)
    blended_period = blend_period(periods, p_weights)
    
    directions = [euro_anc["direction"], gfs_tgt["direction"]]
    d_weights = [w_persist, w_gfs_real]
    heights = [euro_anc["speed"], h_gfs_trend]
    if is_icon_valid and icon_tgt:
        directions.append(icon_tgt["direction"])
        d_weights.append(w_icon_real)
        heights.append(h_icon_trend)
    blended_direction = blend_direction(heights, directions, d_weights)
    if blended_height > 0.0 and blended_direction is None:
        return None
    
    u, v = 0.0, 0.0
    if blended_height > 0.0 and blended_direction is not None:
        rad = blended_direction * math.pi / 180.0
        u = -blended_height * math.sin(rad)
        v = -blended_height * math.cos(rad)
        
    detail = NormalizedPointDetail(
        requested_lat=lat, requested_lng=lng, sampled_lat=lat, sampled_lng=lng,
        speed=round(blended_height, 4), direction=round(blended_direction, 2) if blended_direction is not None else 0.0,
        u=round(u, 4), v=round(v, 4),
        period=round(blended_period, 2) if blended_period is not None else None, gust=None,
        interpolation_method="point_estimate_blend"
    )
    
    estimate_basis = {
        "type": "euro_persistence_gfs_icon_blend" if is_icon_valid else "euro_persistence_gfs_blend",
        "target_valid_time": target_dt.isoformat(),
        "layer": layer.lower(),
        "native_limit_hours": int(native_limit),
        "weights": {"persistence": round(w_persist, 4), "gfs": round(w_gfs_real, 4), "icon": round(w_icon_real, 4)},
        "confidence": round(confidence, 4),
        "euro_anchor_valid_time": anchor_dt.isoformat()
    }
    
    return NormalizedPointResponse(
        model="EURO", provider="estimated", domain="marine", layer=layer.lower(),
        run_time=datetime.now(timezone.utc), valid_time=target_dt,
        is_forecast_authoritative=False, is_estimated=True, point=detail,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[layer.lower()], freshness_sec=1800, source="backend_direct_point",
        coverage_status="outside_grid_tile", fallback_attempted=True, fallback_reason="copernicus_missing_fallback",
        upstream_provider="estimated", upstream_model="cmems_mod_glo_wav_anfc_0.083deg_PT3H-i",
        estimate_basis=estimate_basis, units={"speed": "m", "direction": "degrees", "period": "seconds"},
        grid_parity=False, gridParity=False
    )

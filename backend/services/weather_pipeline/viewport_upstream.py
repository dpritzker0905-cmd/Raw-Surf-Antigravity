"""Upstream fetch + normalize/persist blocks of the dynamic-viewport fetch path.

Pure code motion from viewport_service.py::fetch_viewport_grid_upstream (2026-07-10, 800-LOC gate —
same split pattern as wind_gates.py / the 7f1e24c7 extension extract). Both functions are awaited
inside the fetcher's try: block, so exceptions AND CancelledError propagate to the caller's ladders
unchanged. The shared in-flight context (IN_FLIGHT_LOCK / shields / future resolution — the db94a7c3
surgery) stays entirely in viewport_service.py; nothing here touches it.
"""
import os
import asyncio
import logging

from services.weather_pipeline.route_helpers import (
    generate_bbox_coords, build_dynamic_cache_key
)

logger = logging.getLogger(__name__)


async def fetch_upstream_raw(
    service,
    model: str,
    domain: str,
    layer: str,
    valid_time_str: str,
    west: float,
    south: float,
    east: float,
    north: float,
    resolution: float,
    is_global_view: bool,
    forecast_days: int,
):
    """Coordinate generation, timeout selection, and the provider dispatch (Copernicus for EURO
    marine, Open-Meteo otherwise). Returns (raw_data, resolution, coord_count, bbox_dict);
    raw_data is None on upstream timeout — the caller decides how to fail."""
    lats_coords, lons_coords = generate_bbox_coords(west, south, east, north, resolution)
    coord_count = len(lats_coords)

    coord_cap = 3000 if domain.lower() == "wind" else 800
    resolution_steps = [0.25, 0.5, 1.0, 2.0, 2.5, 5.0, 10.0, 15.0, 20.0, 30.0, 40.0]
    while coord_count > coord_cap and resolution != 40.0:
        idx = resolution_steps.index(resolution)
        resolution = resolution_steps[min(len(resolution_steps) - 1, idx + 1)]
        lats_coords, lons_coords = generate_bbox_coords(west, south, east, north, resolution)
        coord_count = len(lats_coords)

    bbox_dict = {"west": west, "south": south, "east": east, "north": north}
    env_viewport_marine_delay = float(os.environ.get("OPEN_METEO_VIEWPORT_MARINE_BATCH_DELAY_SEC", "0.8"))
    env_wind_delay = float(os.environ.get("OPEN_METEO_WIND_BATCH_DELAY_SEC", "0.5"))
    inter_delay = env_wind_delay if (model.upper() == "GFS" and domain == "wind") else env_viewport_marine_delay
    is_conjoined = model.upper() in ("GFS", "ICON") and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")
    fetch_model = model
    fetch_layer = "all_marine" if is_conjoined else layer
    # Upstream timeout caps ANY provider hang (EURO wind once hung ~90s, blocking the worker).
    is_render_env = os.environ.get("RENDER") == "true"
    upstream_timeout = float(os.environ.get("VIEWPORT_UPSTREAM_TIMEOUT_SEC", "20.0" if is_render_env else "30.0"))
    if is_global_view and domain.lower() == "wind" and resolution <= 10.0:
        # 10°-parity global wind (629 pts) >20s on Render → fitted ceiling; cached after first
        # success; EURO override below still wins; explicit VIEWPORT_UPSTREAM_TIMEOUT_SEC still bounds.
        upstream_timeout = float(os.environ.get("WIND_GLOBAL_PARITY_TIMEOUT_SEC", os.environ.get("VIEWPORT_UPSTREAM_TIMEOUT_SEC", "40.0")))
    # EURO (ecmwf_ifs) wind upstream is reliably ~20s for a global viewport — too slow for the
    # marine→wind toggle. Use a SHORT timeout so it fails over FAST to the GFS-wind fallback
    # (grid_resolver) instead of blocking activation ~20s. Once the scheduled EURO wind
    # global_coarse product exists, /grid serves it from disk and never reaches this fetch.
    if model.upper() == "EURO" and domain.lower() == "wind":
        upstream_timeout = float(os.environ.get("EURO_WIND_UPSTREAM_TIMEOUT_SEC", "6.0"))
    if model.upper() == "EURO" and domain.lower() == "marine":
        from services.weather_pipeline.providers.copernicus_provider import CopernicusProvider
        cop_provider = CopernicusProvider()
        cop_forecast_days = min(forecast_days, 3) if is_global_view else forecast_days
        try:
            raw_data = await asyncio.wait_for(
                cop_provider.fetch_grid(
                    layer=fetch_layer,
                    bbox=bbox_dict,
                    resolution=resolution,
                    forecast_days=cop_forecast_days,
                    precomputed_coords=(lats_coords, lons_coords),
                    valid_time=valid_time_str
                ),
                timeout=upstream_timeout
            )
        except asyncio.TimeoutError:
            logger.error(f"[Dynamic Viewport] Copernicus fetch timed out after {upstream_timeout}s. Returning empty grid.")
            raw_data = None
    else:
        try:
            raw_data = await asyncio.wait_for(
                service.provider.fetch_grid(
                    model=fetch_model,
                    domain=domain,
                    layer=fetch_layer,
                    bbox=bbox_dict,
                    resolution=resolution,
                    forecast_days=forecast_days,
                    precomputed_coords=(lats_coords, lons_coords),
                    inter_batch_delay=inter_delay
                ),
                timeout=upstream_timeout
            )
        except asyncio.TimeoutError:
            logger.error(f"[Dynamic Viewport] Open-Meteo {model} {domain}/{layer} fetch timed out after {upstream_timeout}s. Returning empty grid.")
            raw_data = None

    return raw_data, resolution, coord_count, bbox_dict


async def normalize_and_persist_layers(
    service,
    model: str,
    domain: str,
    layer: str,
    raw_list,
    bbox_dict,
    resolution: float,
    target_dt_actual,
    target_idx: int,
    west: float,
    south: float,
    east: float,
    north: float,
    bbox_str: str,
    bbox_key_str: str,
    coverage_scope: str,
    coord_count: int,
):
    """Per-layer normalize → decorate → atomic save → dynamic-index add for the target hour
    (conjoined marine layers share the one upstream fetch). Returns the requested layer's
    product, or None; raises when the target layer's normalization returns None."""
    is_conjoined = model.upper() in ("GFS", "ICON") and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")
    if is_conjoined:
        conjoined_layers = ("waves", "swell_1", "wind_waves") if model.upper() == "ICON" else ("waves", "swell_1", "swell_2", "wind_waves")
    else:
        conjoined_layers = (layer.lower(),)
    target_normalized_product = None

    for target_layer in conjoined_layers:
        target_cache_key = build_dynamic_cache_key(model, domain, target_layer, target_dt_actual, west, south, east, north)
        target_viewport_filename = f"{target_cache_key}.json"

        normalized = await service.normalizer.normalize_async(
            model=model,
            provider="copernicus" if (model.upper() == "EURO" and domain.lower() == "marine") else "open-meteo",
            domain=domain,
            layer=target_layer,
            raw_results=raw_list,
            bbox=bbox_dict,
            resolution=resolution,
            target_time=target_dt_actual,
            coverage_mode="viewport",
            region_id=f"viewport_{bbox_key_str}"
        )

        if normalized and model.upper() == "ICON" and domain.lower() == "wind" and target_idx >= 120:
            normalized.is_estimated = True
            normalized.is_forecast_authoritative = False
            normalized.estimate_basis = {
                "type": "icon_loop_extrapolation",
                "native_horizon_hours": 120,
                "method": "diurnal_cycle_loop",
                "source_model": "dwd_icon"
            }

        if not normalized:
            if target_layer == layer.lower():
                raise Exception("Target product normalization returned None.")
            continue

        is_empty_grid = False
        if normalized.grid and normalized.grid.vectors:
            if not any(v.speed > 0 for v in normalized.grid.vectors):
                is_empty_grid = True

        if is_empty_grid:
            logger.warning(f"[Dynamic Viewport] Normalization produced empty grid for target hour: model={model}, domain={domain}, layer={target_layer}. Allowing zero grid.")

        served_bbox_full = f"{normalized.grid.bounds.west},{normalized.grid.bounds.south},{normalized.grid.bounds.east},{normalized.grid.bounds.north}"

        normalized.product_id = target_viewport_filename
        normalized.is_dynamic_viewport_product = True
        normalized.cache_key = target_cache_key
        normalized.cache_hit = "cache_miss"
        normalized.requested_bbox = bbox_str
        normalized.served_bbox = served_bbox_full
        normalized.coverage_scope = coverage_scope
        normalized.coordinate_count = coord_count
        normalized.resolution = resolution
        normalized.requested_bbox_original = bbox_str
        normalized.query_bbox = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
        normalized.partial_coverage = False
        normalized.stale = False

        if normalized.grid:
            normalized.grid.diagnostics = {
                "requested_bbox": bbox_str,
                "served_bbox": served_bbox_full,
                "coverage_scope": coverage_scope,
                "source_product_ids": ["open-meteo"],
                "cache_hit": "cache_miss",
                "provider": normalized.provider,
                "model": model,
                "domain": domain,
                "layer": target_layer,
                "valid_time": target_dt_actual.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "nonzeroCount": normalized.grid.diagnostics.get("nonzeroCount", 0) if normalized.grid.diagnostics else 0,
                "vectorCount": len(normalized.grid.vectors) if normalized.grid.vectors else 0,
                "vectors_length": len(normalized.grid.vectors) if normalized.grid.vectors else 0,
                "gridMode": "rectangular",
                "renderable": len(normalized.grid.vectors) > 0 and any(v.speed > 0 for v in normalized.grid.vectors),
                "stale": False,
                "partial_coverage": False
            }

        filepath = service.store.cache_dir / target_viewport_filename
        tmp_filepath = filepath.with_suffix(".tmp")

        product_json_bytes = normalized.model_dump_json().encode("utf-8")
        def save_to_disk(filepath, tmp_filepath, product_json_bytes):
            with open(tmp_filepath, "wb") as f:
                f.write(product_json_bytes)
            os.replace(tmp_filepath, filepath)
        await asyncio.to_thread(save_to_disk, filepath, tmp_filepath, product_json_bytes)

        service.dynamic_index.add_product(
            product_id=target_viewport_filename,
            model=model,
            domain=domain,
            layer=target_layer,
            valid_time=target_dt_actual,
            requested_bbox=bbox_str,
            served_bbox=served_bbox_full,
            coverage_scope=coverage_scope,
            resolution=resolution,
            cache_key=target_cache_key,
            source=normalized.provider
        )

        if target_layer == layer.lower():
            target_normalized_product = normalized

    return target_normalized_product

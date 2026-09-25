"""Narrow supersession rule; viewport geometry and source differences retain precedence."""
import asyncio
from datetime import timezone

from services.weather_pipeline.manifest_view import products_for
from services.weather_pipeline.sampler import resolution_or_none
from services.weather_pipeline.selection_identity import selection_identity


async def superseded_dynamic(store, product):
    """Return (filename, validated product), or None. Keep the loaded snapshot for sampling."""
    identity = selection_identity(product)
    if identity[0] != 0 or not getattr(product, 'source_dataset', None):
        return None
    resolution = resolution_or_none(product.grid)
    if resolution is None:
        return None
    manifest = await asyncio.to_thread(store.get_manifest)
    for candidate in sorted(products_for(manifest, product.model, product.domain, product.layer), key=selection_identity):
        # Global sampling has a separate degraded-ocean fallback in the scheduled route.
        if 'global_coarse' in candidate.filename or getattr(candidate, 'coverage_mode', None) == 'global_tile':
            continue
        cycle = selection_identity(candidate)
        if cycle[0] != 0 or cycle[1] >= identity[1]:
            continue
        if candidate.valid_time_start != product.valid_time or candidate.resolution != resolution:
            continue
        if candidate.coverage != product.coverage:
            continue
        if any(getattr(candidate, key, None) != getattr(product, key, None) for key in
               ('provider', 'upstream_provider', 'source_dataset', 'is_estimated', 'is_forecast_authoritative')):
            continue
        # An unavailable scheduled file cannot invalidate a usable dynamic product.
        replacement = await asyncio.to_thread(store.load_product, candidate.filename)
        if (replacement is not None and selection_identity(replacement)[:2] == cycle[:2]
                and replacement.valid_time == product.valid_time
                and replacement.coverage == product.coverage
                and resolution_or_none(replacement.grid) == resolution
                and all(getattr(replacement, key, None) == getattr(product, key, None) for key in
                        ('provider', 'upstream_provider', 'source_dataset', 'is_estimated', 'is_forecast_authoritative'))):
            return candidate.filename, replacement
    return None


def prefers_scheduled_native(manifest, product, lat, lng, target_dt) -> bool:
    """True when a scheduled NATIVE product should answer a point instead of this dynamic one.

    ⛔ A15-04 (audit 15.0, measured live 2026-09-25 18Z). `/point` took ANY cached dynamic
    viewport product that contained the point, before the manifest. At Sebastian Inlet and Cocoa
    Beach that was an Open-Meteo `viewport_gfs_marine_*` box another request had built — cycle
    unknown — while the heatmap (series lane) drew the NOAA-direct 12Z `florida_east_coast` tile:
    the infobox and the map disagreed by ~8% offshore, and the answer depended on which viewports
    other users had happened to open. `/grid` does not have this problem: it only reuses a
    dynamic product for the EXACT viewport box.

    The narrow rule: a dynamic product whose cycle is UNKNOWN yields to a covering scheduled
    product that is authoritative, not global, not island-gated, has a KNOWN cycle, is at least
    as fine, and is valid within 30 min of the requested hour. Anything else keeps the dynamic
    product (outside the regional tiles it is the only 0.25-degree answer). Marine only.
    Kill: POINT_PREFER_SCHEDULED_NATIVE=0.
    """
    import os
    from services.weather_pipeline.island_gate import is_island_gated
    from services.weather_pipeline.route_helpers import get_actual_grid_bounds, is_inside_bounds

    if os.environ.get("POINT_PREFER_SCHEDULED_NATIVE", "1") == "0":
        return False
    if product is None or str(getattr(product, "domain", "")).lower() != "marine":
        return False
    if selection_identity(product)[0] == 0:
        return False                      # a known-cycle dynamic product keeps its place
    dyn_res = resolution_or_none(getattr(product, "grid", None))
    if dyn_res is None or manifest is None:
        return False
    for p in products_for(manifest, product.model, product.domain, product.layer):
        if is_island_gated(p) or getattr(p, "is_estimated", False):
            continue
        name = str(getattr(p, "filename", "") or "")
        if getattr(p, "coverage_mode", None) == "global_tile" or "_global_" in name:
            continue
        res = getattr(p, "resolution", None)
        if not res or float(res) > dyn_res * 1.001 or selection_identity(p)[0] != 0:
            continue
        start = getattr(p, "valid_time_start", None)
        if start is None:
            continue
        t1 = start if start.tzinfo else start.replace(tzinfo=timezone.utc)
        t2 = target_dt if target_dt.tzinfo else target_dt.replace(tzinfo=timezone.utc)
        if abs((t1 - t2).total_seconds()) > 1800:
            continue
        if is_inside_bounds(lat, lng, get_actual_grid_bounds(p.coverage, p.resolution), margin=0.0001):
            return True
    return False

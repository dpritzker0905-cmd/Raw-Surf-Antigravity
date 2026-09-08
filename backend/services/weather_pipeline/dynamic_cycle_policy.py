"""Narrow supersession rule; viewport geometry and source differences retain precedence."""
import asyncio

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

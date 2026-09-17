"""Avoid a live Open-Meteo series fetch when direct regional products cover it.

This is only a routing hint. The existing grid resolver still loads, validates,
and falls back if a listed file is missing. No GRIB download runs on the UI path.
"""
import asyncio
import logging
from datetime import timedelta

from services.weather_pipeline.route_helpers import parse_bbox, is_bbox_covered_by

logger = logging.getLogger(__name__)


async def has_direct_series_coverage(viewport_service, model, domain, layer, bbox, hours, base):
    try:
        store = getattr(viewport_service, "store", None)
        if store is None or not hours:
            return False
        manifest = await asyncio.wait_for(asyncio.to_thread(store.get_manifest), timeout=0.5)
        bounds = parse_bbox(bbox)
        covered = set()
        targets = {h: (base + timedelta(hours=h)).timestamp() for h in hours}
        for product in manifest.products:
            if (product.model.upper() != model.upper()
                    or product.domain.lower() != domain.lower()
                    or product.layer.lower() != layer.lower()
                    or getattr(product, "upstream_provider", None) not in ("noaa", "dwd", "ecmwf", "copernicus")
                    or getattr(product, "is_test_fixture", False)
                    or getattr(product, "is_estimated", False)
                    or not product.is_forecast_authoritative
                    or not (0 < product.resolution <= 0.25)
                    or not is_bbox_covered_by(*bounds, product.coverage, margin=0)):
                continue
            # Exact valid time: do not replace an exact live frame with a nearby one.
            covered.update(h for h, target in targets.items()
                           if product.valid_time_start.timestamp() == target)
        complete = len(covered) == len(targets)
        if complete:
            logger.info("[grid_series] %s %s/%s has direct-source coverage for %d exact hours; "
                        "using stored resolver without Open-Meteo live-series fetch",
                        model, domain, layer, len(targets))
        return complete
    except Exception:
        logger.exception("[grid_series] direct coverage lookup failed; retaining normal fallback")
        return False

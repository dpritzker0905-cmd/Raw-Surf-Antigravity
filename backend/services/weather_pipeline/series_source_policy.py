"""Serve the STORED direct-pipeline products (NOAA GRIB / DWD / ECMWF / CMEMS) to a marine scrub instead of
a live Open-Meteo request-time fetch whenever they cover it.

OWNER POLICY: marine data comes from the NOAA GRIB and ECMWF pipelines; Open-Meteo is a fallback only.
Verified 2026-09-23 from the ingestion logs of runs 35792283418 / 35795126132: GFS regional 0.25 deg tiles
"GFS-Wave multi-region OK" (NOAA byte-range GRIB), ICON "DWD-direct OK" (GWAM), EURO mid "ECMWF-direct OK",
EURO regional CMEMS. ⚠️ Their manifest rows still say `provider: "open-meteo"` -- that is the deliberate
render-whitelist KEY (HANDOFF-off-openmeteo-campaign-2026-06-27 §5), NOT the transport. True origin is
`upstream_provider`, which is what this test keys on. Never infer supplier from `provider` or from the
dataset name (`ncep_gfswave025` is also Open-Meteo's model id).

WHY (audit 14.1 T-01, measured live 2026-09-23 on dev b75ed960): with GFS_ICON_SERIES_FASTPATH=1 every
GFS/ICON marine scrub made a LIVE Open-Meteo fetch even where the stored NOAA-direct 0.25 deg tiles fully
cover the viewport (Florida) -- the request path bypassing the direct pipeline. The two lanes also
disagreed: the live series carried no model cycle (`model_run_time: None`; `run_census.min_run_time` was
the fetch time) at hourly instants, while the single-grid lane served the stored 3-hourly frames stamped
with their NOAA cycle. Stored per-hour reads measured 0.23-0.34 s.

Carried over from unmerged PR #43 (codex/weather-direct-provider). It only takes effect once the
client's hour offsets land on product times (frontend T-01, PR #67): with anchor+3k offsets the exact-time
match below can never succeed, which is why #43 on its own would have been inert.

This is a routing hint only. The existing resolver still loads and validates each file; hours it fails
to load are recovered from the live lane (`recover_missing_hours`) without replacing any stored frame.
"""
import asyncio
import logging
from datetime import timedelta

from services.weather_pipeline.route_helpers import parse_bbox, is_bbox_covered_by

logger = logging.getLogger(__name__)

# Model upstreams whose stored products are authoritative forecasts (never estimates or fixtures).
_STORED_UPSTREAMS = ("noaa", "dwd", "ecmwf", "copernicus")


async def has_stored_series_coverage(viewport_service, model, domain, layer, bbox, hours, base) -> bool:
    """True only when EVERY requested hour has a stored authoritative <=0.25 deg product at EXACTLY that
    valid time whose coverage contains the whole bbox. Any doubt returns False (the live lane runs)."""
    try:
        store = getattr(viewport_service, "store", None)
        if store is None or not hours:
            return False
        manifest = await asyncio.wait_for(asyncio.to_thread(store.get_manifest), timeout=0.5)
        bounds = parse_bbox(bbox)
        targets = {h: (base + timedelta(hours=h)).timestamp() for h in hours}
        covered = set()
        for product in manifest.products:
            if (product.model.upper() != model.upper()
                    or product.domain.lower() != domain.lower()
                    or product.layer.lower() != layer.lower()
                    or getattr(product, "upstream_provider", None) not in _STORED_UPSTREAMS
                    or getattr(product, "is_test_fixture", False)
                    or getattr(product, "is_estimated", False)
                    or not product.is_forecast_authoritative
                    or not (0 < (product.resolution or 0) <= 0.25)
                    or not is_bbox_covered_by(*bounds, product.coverage, margin=0)):
                continue
            # Exact valid time: a nearby product is a substitution, not coverage.
            vt = product.valid_time_start.timestamp()
            covered.update(h for h, target in targets.items() if vt == target)
        complete = len(covered) == len(targets)
        if complete:
            logger.info("[grid_series] %s %s/%s: stored products cover all %d hours exactly; "
                        "serving stored frames instead of the live series", model, domain, layer, len(targets))
        return complete
    except Exception:
        logger.exception("[grid_series] stored-coverage lookup failed; keeping the live series lane")
        return False


async def recover_missing_hours(build_live, frames, hour_list, wait_s) -> int:
    """A manifest advertises a file; it does not prove the file loaded. Fill ONLY the hours the stored
    resolver failed to produce from the live lane, never replacing a stored frame. Returns frames added."""
    missing = sorted(set(hour_list) - {f.get("hour_offset") for f in frames})
    if not missing:
        return 0
    try:
        live = await asyncio.wait_for(build_live(missing), timeout=wait_s)
    except Exception as e:
        logger.warning("[grid_series] live recovery of %d missing stored hours failed (%s); "
                       "keeping the stored frames", len(missing), type(e).__name__)
        return 0
    added = 0
    for frame in (live or {}).get("frames", []) or []:
        if frame.get("hour_offset") in missing and frame.get("vectors"):
            frames.append(frame)
            missing.remove(frame["hour_offset"])
            added += 1
    return added

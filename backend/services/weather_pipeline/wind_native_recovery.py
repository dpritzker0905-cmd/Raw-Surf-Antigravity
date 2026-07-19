"""Background NATIVE-upstream recovery for the WIND dynamic viewport lane (2026-07-19, queue #5).

The dynamic wind lane shares open-meteo's forecast-API quota; when that upstream rate-limits or
times out, the lane degrades a FINE viewport request to the stale 10° global fallback and stays
there until the negative cache expires and open-meteo recovers. The serve path must never wait
(coverage outranks freshness), so this module adds a parallel lane instead of a retry: on a wind
dynamic-lane failure the request still returns its instant stale/coarse fallback, and ONE
background task fetches the SAME snapped bbox from the model's NATIVE upstream — the proven,
bbox+resolution-parameterized cron fetchers (GFS→NOAA AWS Open Data byte-range GRIB2, ICON→DWD
opendata icosahedral GRIB, EURO→ECMWF Open Data IFS) — then normalizes and persists through the
STANDARD dynamic-viewport pipeline (normalize_and_persist_layers + bg_process_remaining_hours_helper,
so provider labeling, ICON 14d loop-extension stamping, dynamic-index registration and per-hour
persistence are byte-identical to the open-meteo path). The client's next refetch (moveend / SWR)
upgrades from cache.

Scope guards (each enumerated in tests/test_wind_native_viewport_fallback.py):
  - kill switch WIND_NATIVE_VIEWPORT_FALLBACK=0
  - wind domain only
  - viewport scope only — NEVER global. A recovery-built world-span dynamic product could shadow
    the manifest / impersonate a fine product in containment lookups (the 07-20 handoff §1.3
    span-containment trap); the global manifest already has a cron.
  - mapped models only (GFS/ICON/EURO)
  - one recovery in flight per {model,bbox}; per-key cooldown against respawn storms
  - a GLOBAL semaphore (default 1): the fetcher subprocess decodes full-globe GRIB messages
    regardless of bbox — the 512MB serve box gets at most one at a time (the
    MARINE_REVAL_CONCURRENCY lesson, 2026-07-05 OOM).

Env knobs: WIND_NATIVE_VIEWPORT_FALLBACK (default on) · WIND_NATIVE_RECOVERY_CONCURRENCY (1) ·
WIND_NATIVE_RECOVERY_COOLDOWN_SEC (600) · WIND_NATIVE_RECOVERY_TIMEOUT_SEC (900, forwarded to the
fetcher subprocess) · WIND_NATIVE_RECOVERY_FORECAST_DAYS (per-model defaults below).
"""
import os
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# model -> (service module, fetch fn, recovery forecast_days default).
# Days mirror the open-meteo lane where affordable: GFS 16 (native cost scales per 3h step but one
# 16d fetch heals the whole scrub range), ICON 5 (native horizon, then extend_icon_wind_to_14d —
# same as the lane), EURO 5 (lane uses 10, but the ECMWF open-data client downloads every step's
# global GRIB before decoding — trimmed for the serve box; raise via env once proven).
_NATIVE_WIND_FETCHERS = {
    "GFS": ("services.noaa_wind_service", "fetch_gfs_wind_global_coarse", 16),
    "ICON": ("services.dwd_wind_service", "fetch_icon_wind_global_coarse", 5),
    "EURO": ("services.ecmwf_wind_service", "fetch_euro_wind_global_coarse", 5),
}

RECOVERY_TASKS: Dict[str, asyncio.Task] = {}
RECOVERY_COOLDOWN: Dict[str, float] = {}
_RECOVERY_SEMAPHORE: Optional[asyncio.Semaphore] = None


def _semaphore() -> asyncio.Semaphore:
    global _RECOVERY_SEMAPHORE
    if _RECOVERY_SEMAPHORE is None:
        _RECOVERY_SEMAPHORE = asyncio.Semaphore(
            max(1, int(os.environ.get("WIND_NATIVE_RECOVERY_CONCURRENCY", "1")))
        )
    return _RECOVERY_SEMAPHORE


def is_enabled() -> bool:
    return os.environ.get("WIND_NATIVE_VIEWPORT_FALLBACK", "1") != "0"


def native_forecast_days(model: str) -> int:
    override = os.environ.get("WIND_NATIVE_RECOVERY_FORECAST_DAYS")
    if override:
        return max(2, int(override))
    return _NATIVE_WIND_FETCHERS[model.upper()][2]


def maybe_spawn_native_wind_recovery(
    service,
    *,
    model: str,
    domain: str,
    layer: str,
    target_dt: datetime,
    west: float,
    south: float,
    east: float,
    north: float,
    resolution: float,
    bbox_str: str,
    bbox_key_str: str,
    coverage_scope: str,
) -> bool:
    """Spawn a background native-upstream recovery for a failed wind dynamic-lane fetch.
    Returns True when a task was actually spawned. Must be called from a running event loop."""
    if not is_enabled():
        return False
    if domain.lower() != "wind":
        return False
    if coverage_scope != "viewport":
        return False
    key_model = model.upper()
    if key_model not in _NATIVE_WIND_FETCHERS:
        return False

    key = f"{key_model}_{bbox_key_str}"
    existing = RECOVERY_TASKS.get(key)
    if existing is not None and not existing.done():
        return False
    now_ts = datetime.now(timezone.utc).timestamp()
    if now_ts < RECOVERY_COOLDOWN.get(key, 0.0):
        return False

    cooldown = float(os.environ.get("WIND_NATIVE_RECOVERY_COOLDOWN_SEC", "600"))
    RECOVERY_COOLDOWN[key] = now_ts + cooldown
    task = asyncio.create_task(_run_native_recovery(
        service, model=key_model, layer=layer, target_dt=target_dt,
        west=west, south=south, east=east, north=north,
        resolution=resolution, bbox_str=bbox_str, bbox_key_str=bbox_key_str,
    ))
    RECOVERY_TASKS[key] = task
    logger.info(
        f"[Wind Native Recovery] Spawned {key_model} native recovery for bbox {bbox_key_str} "
        f"(target {target_dt.strftime('%Y-%m-%dT%H:%M:%SZ')}, res {resolution})."
    )
    return True


async def _run_native_recovery(
    service,
    *,
    model: str,
    layer: str,
    target_dt: datetime,
    west: float,
    south: float,
    east: float,
    north: float,
    resolution: float,
    bbox_str: str,
    bbox_key_str: str,
) -> None:
    try:
        async with _semaphore():
            import importlib
            mod_path, fn_name, _default_days = _NATIVE_WIND_FETCHERS[model]
            # Resolved at call time so monkeypatched service fns are honored.
            fetch_fn = getattr(importlib.import_module(mod_path), fn_name)
            days = native_forecast_days(model)
            timeout_sec = int(float(os.environ.get("WIND_NATIVE_RECOVERY_TIMEOUT_SEC", "900")))
            bbox_dict = {"west": west, "south": south, "east": east, "north": north}

            raw = await fetch_fn(bbox_dict, resolution, days, timeout_sec=timeout_sec)
            if not raw:
                logger.warning(f"[Wind Native Recovery] {model} native fetch returned nothing for {bbox_key_str}.")
                return
            raw_list = raw if isinstance(raw, list) else [raw]

            if model == "ICON":
                from services.weather_pipeline.viewport_helper import extend_icon_wind_to_14d
                extend_icon_wind_to_14d(raw_list)

            hourly = raw_list[0].get("hourly", {})
            times = hourly.get("time", [])
            if not times:
                logger.warning(f"[Wind Native Recovery] {model} native fetch had no time array for {bbox_key_str}.")
                return

            from services.weather_pipeline.normalizer import WeatherNormalizer
            target_idx = WeatherNormalizer.find_closest_time_index(times, target_dt)
            if target_idx is None:
                logger.warning(
                    f"[Wind Native Recovery] {model} native times do not cover target "
                    f"{target_dt.strftime('%Y-%m-%dT%H:%M:%SZ')} for {bbox_key_str}."
                )
                return
            t_str = times[target_idx]
            t_z = t_str if t_str.endswith("Z") else t_str + "Z"
            target_dt_actual = datetime.fromisoformat(t_z.replace("Z", "+00:00"))
            coord_count = len(raw_list)

            from services.weather_pipeline.viewport_upstream import normalize_and_persist_layers
            product = await normalize_and_persist_layers(
                service=service, model=model, domain="wind", layer=layer,
                raw_list=raw_list, bbox_dict=bbox_dict, resolution=resolution,
                target_dt_actual=target_dt_actual, target_idx=target_idx,
                west=west, south=south, east=east, north=north,
                bbox_str=bbox_str, bbox_key_str=bbox_key_str,
                coverage_scope="viewport", coord_count=coord_count,
            )
            if product is None:
                logger.warning(f"[Wind Native Recovery] {model} normalization produced no product for {bbox_key_str}.")
                return

            # Remaining hours via the standard bg persistence. Fresh context, no waiters; the
            # helper's finally-pop of this synthetic (never-registered) key is a safe no-op.
            from services.weather_pipeline.viewport_service import FetchContext
            from services.weather_pipeline.viewport_helper import bg_process_remaining_hours_helper
            ctx = FetchContext()
            ctx.raw_list = raw_list
            if not ctx.raw_fetch_future.done():
                ctx.raw_fetch_future.set_result(True)
            await bg_process_remaining_hours_helper(
                service=service, context=ctx,
                request_dedup_key=f"native_recovery_{model.lower()}_wind_{bbox_key_str}",
                model=model, domain="wind", layer=layer,
                bbox_dict=bbox_dict, resolution=resolution,
                west=west, south=south, east=east, north=north,
                times=times, target_idx=target_idx, bbox_str=bbox_str,
                coverage_scope="viewport", coord_count=coord_count,
                bbox_key_str=bbox_key_str,
            )
            logger.info(
                f"[Wind Native Recovery] {model} recovery COMPLETE for {bbox_key_str}: "
                f"{len(times)} timesteps persisted (fine product now cached)."
            )
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.error(f"[Wind Native Recovery] {model} recovery failed for {bbox_key_str}: {e}")

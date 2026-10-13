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
so provider labeling, dynamic-index registration and per-hour persistence are byte-identical to the
open-meteo path). The client's next refetch (moveend / SWR) upgrades from cache.

⛔ BOUNDED (2026-10-09). A recovery used to fetch and persist the WHOLE run (GFS: 129 global GRIB steps,
then 128 more hours normalized in the serve process, ~3.5 min each), deduped only by its exact snapped
bbox. With the Open-Meteo breaker open ("recent 429s"), every new pan box near the Gulf hurricane failed
over to one: instance 4gt6w spawned 10 between 03:07:50Z and 03:09:21Z, the semaphore queued them all, and
they ran back to back until 03:32:28Z while /api/health took 8.8 s or timed out. Now:
  - WINDOW: only the requested hour ± WIND_NATIVE_RECOVERY_WINDOW_HOURS (default 3, at most 24) is
    fetched and persisted (two or three GFS steps). GFS and ICON fetch only those steps
    (services/_fetch_window.py). EURO's client resolves its own cycle, so EURO still downloads its
    5-day run but persists only the window.
  - REUSE: a request that a running, waiting or recently finished recovery covers (box contains it,
    resolution as fine or finer, window holds the hour) starts nothing.
  - ONE WAITING PER MODEL: a newer viewed request replaces the recovery still waiting for the lane, so
    a burst of pans costs the one running plus the view the user stopped on.
  - THE VIEWED HOUR WINS (#277's contract): a grid_series frame other than its page's warm frame starts
    nothing; the warm frame takes only an idle lane, and a viewed request replaces it while it waits.
Pinned by tests/test_wind_native_recovery_bounded.py (the 03:07Z pan burst, replayed offline).

Scope guards (each enumerated in tests/test_wind_native_viewport_fallback.py):
  - kill switch WIND_NATIVE_VIEWPORT_FALLBACK=0
  - wind domain only
  - viewport scope only — NEVER global. A recovery-built world-span dynamic product could shadow
    the manifest / impersonate a fine product in containment lookups (the 07-20 handoff §1.3
    span-containment trap); the global manifest already has a cron.
  - mapped models only (GFS/ICON/EURO)
  - one recovery in flight per {model, bbox, hour}; per-key cooldown against respawn storms
  - a GLOBAL semaphore (default 1): the fetcher subprocess decodes full-globe GRIB messages
    regardless of bbox — the 512MB serve box gets at most one at a time (the
    MARINE_REVAL_CONCURRENCY lesson, 2026-07-05 OOM).

Env knobs: WIND_NATIVE_VIEWPORT_FALLBACK (default on) · WIND_NATIVE_RECOVERY_CONCURRENCY (1) ·
WIND_NATIVE_RECOVERY_COOLDOWN_SEC (600, also how long a finished recovery is reused) ·
WIND_NATIVE_RECOVERY_TIMEOUT_SEC (900, forwarded to the fetcher subprocess) ·
WIND_NATIVE_RECOVERY_WINDOW_HOURS (3) · WIND_NATIVE_RECOVERY_FORECAST_DAYS (per-model defaults below).
"""
import os
import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from services.weather_pipeline.reval_queue import current_series_frame
from services.weather_pipeline.route_helpers import is_bbox_covered_by

logger = logging.getLogger(__name__)

# model -> (service module, fetch fn, forecast_days, fetches only the window).
# forecast_days is the run the fetcher picks its cycle against (GFS 16: a cycle complete to f384; ICON 5:
# its native horizon; EURO 5: the ECMWF client downloads every step of it before decoding). EURO cannot
# window its download: date/time are omitted so the client resolves the latest cycle itself.
_NATIVE_WIND_FETCHERS = {
    "GFS": ("services.noaa_wind_service", "fetch_gfs_wind_global_coarse", 16, True),
    "ICON": ("services.dwd_wind_service", "fetch_icon_wind_global_coarse", 5, True),
    "EURO": ("services.ecmwf_wind_service", "fetch_euro_wind_global_coarse", 5, False),
}


@dataclass
class _Job:
    """One recovery: what it will make servable (box, resolution, hours) and whether it holds the lane."""
    key: str
    model: str
    west: float
    south: float
    east: float
    north: float
    resolution: float
    start: datetime
    end: datetime
    viewed: bool
    task: Optional[asyncio.Task] = None
    running: bool = False
    expires: float = 0.0

    def covers(self, model, west, south, east, north, resolution, target_dt) -> bool:
        return (self.model == model and self.resolution <= resolution + 1e-9
                and self.start <= target_dt <= self.end
                and is_bbox_covered_by(west, south, east, north, self, margin=0.0))


RECOVERY_JOBS: Dict[str, _Job] = {}      # in flight: running, or waiting for the lane
RECOVERY_COOLDOWN: Dict[str, float] = {}
RECOVERED: List[_Job] = []               # finished, reused until `expires`
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


def recovery_window(target_dt: datetime):
    """The hours a recovery for `target_dt` fetches and persists: target ± the window, inclusive."""
    try:
        hours = float(os.environ.get("WIND_NATIVE_RECOVERY_WINDOW_HOURS", "3"))
    except ValueError:
        hours = 3.0
    hours = min(24.0, max(0.0, hours))
    return target_dt - timedelta(hours=hours), target_dt + timedelta(hours=hours)


def recovery_key(model: str, bbox_key_str: str, target_dt: datetime) -> str:
    return f"{model.upper()}_{bbox_key_str}_{target_dt.astimezone(timezone.utc):%Y%m%dT%H}"


def _covering_job(model, west, south, east, north, resolution, target_dt, now_ts) -> Optional[_Job]:
    RECOVERED[:] = [j for j in RECOVERED if j.expires > now_ts]
    in_flight = [j for j in RECOVERY_JOBS.values() if not j.task.done()]   # a failed one covers nothing
    for job in in_flight + RECOVERED:
        if job.covers(model, west, south, east, north, resolution, target_dt):
            return job
    return None


def _forget(key: str, task: asyncio.Task) -> None:
    job = RECOVERY_JOBS.get(key)
    if job is not None and job.task is task:
        del RECOVERY_JOBS[key]


def _supersede_waiting(model: str, by_key: str) -> None:
    """A newer viewed request replaces this model's recovery that has not reached the lane yet."""
    for key, job in list(RECOVERY_JOBS.items()):
        if job.model == model and not job.running and not job.task.done():
            job.task.cancel()
            del RECOVERY_JOBS[key]
            RECOVERY_COOLDOWN.pop(key, None)   # never ran: the view may come back and ask again
            logger.info(f"[Wind Native Recovery] {key} superseded by {by_key} before it started.")


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
    frame = current_series_frame()
    if frame is not None and not frame.warm:
        return False   # a timeline frame; its page's warm frame speaks for the page

    start, end = recovery_window(target_dt)
    now = datetime.now(timezone.utc)
    if _NATIVE_WIND_FETCHERS[key_model][3] and start > now + timedelta(days=native_forecast_days(key_model)):
        return False   # no native step can fall inside the window (ICON past its 5-day run)

    key = recovery_key(key_model, bbox_key_str, target_dt)
    existing = RECOVERY_JOBS.get(key)
    if existing is not None and not existing.task.done():
        return False
    now_ts = now.timestamp()
    covering = _covering_job(key_model, west, south, east, north, resolution, target_dt, now_ts)
    if covering is not None:
        logger.info(f"[Wind Native Recovery] {key} already covered by {covering.key}; nothing spawned.")
        return False
    if now_ts < RECOVERY_COOLDOWN.get(key, 0.0):
        return False
    if frame is not None and any(not j.task.done() for j in RECOVERY_JOBS.values()):
        logger.info(f"[Wind Native Recovery] timeline warm frame skipped, lane kept for the viewed hour: {key}")
        return False
    if frame is None:
        _supersede_waiting(key_model, key)

    cooldown = float(os.environ.get("WIND_NATIVE_RECOVERY_COOLDOWN_SEC", "600"))
    RECOVERY_COOLDOWN[key] = now_ts + cooldown
    job = _Job(key=key, model=key_model, west=west, south=south, east=east, north=north,
               resolution=float(resolution), start=start, end=end, viewed=frame is None)
    job.task = asyncio.create_task(_run_native_recovery(
        service, model=key_model, layer=layer, target_dt=target_dt,
        west=west, south=south, east=east, north=north,
        resolution=resolution, bbox_str=bbox_str, bbox_key_str=bbox_key_str,
    ))
    RECOVERY_JOBS[key] = job
    job.task.add_done_callback(lambda t, k=key: _forget(k, t))
    logger.info(
        f"[Wind Native Recovery] Spawned {key_model} native recovery for bbox {bbox_key_str} "
        f"(target {target_dt.strftime('%Y-%m-%dT%H:%M:%SZ')}, res {resolution}, "
        f"window {start:%Y-%m-%dT%H:%M}Z..{end:%Y-%m-%dT%H:%M}Z, {'viewed hour' if job.viewed else 'timeline warm frame'})."
    )
    return True


def _parse_utc(t: str) -> datetime:
    return datetime.fromisoformat((t if t.endswith("Z") else t + "Z").replace("Z", "+00:00"))


def _trim_to_window(raw_list: list, start: datetime, end: datetime) -> list:
    """Keep only the hours inside [start, end] in every point's hourly arrays; returns the kept times.
    A no-op for a fetcher that already windowed (GFS, ICON); bounds EURO's persistence."""
    times = raw_list[0].get("hourly", {}).get("time", []) or []
    keep = [i for i, t in enumerate(times) if start <= _parse_utc(t) <= end]
    if len(keep) == len(times):
        return times
    n = len(times)   # every point may share one `time` list object: measure it before any rebinding
    for point in raw_list:
        hourly = point.get("hourly") or {}
        for name, series in list(hourly.items()):
            if isinstance(series, list) and len(series) == n:
                hourly[name] = [series[i] for i in keep]
    return [times[i] for i in keep]


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
    key = recovery_key(model, bbox_key_str, target_dt)
    try:
        async with _semaphore():
            job = RECOVERY_JOBS.get(key)
            if job is not None:
                job.running = True   # holds the lane: a newer view waits behind it, never cancels it
            import importlib
            mod_path, fn_name, _default_days, windowed = _NATIVE_WIND_FETCHERS[model]
            # Resolved at call time so monkeypatched service fns are honored.
            fetch_fn = getattr(importlib.import_module(mod_path), fn_name)
            days = native_forecast_days(model)
            timeout_sec = int(float(os.environ.get("WIND_NATIVE_RECOVERY_TIMEOUT_SEC", "900")))
            bbox_dict = {"west": west, "south": south, "east": east, "north": north}
            start, end = recovery_window(target_dt)
            fetch_kwargs = {"timeout_sec": timeout_sec}
            if windowed:
                fetch_kwargs["valid_window"] = {"start": f"{start:%Y-%m-%dT%H:%M:%SZ}",
                                                "end": f"{end:%Y-%m-%dT%H:%M:%SZ}"}

            raw = await fetch_fn(bbox_dict, resolution, days, **fetch_kwargs)
            if not raw:
                logger.warning(f"[Wind Native Recovery] {model} native fetch returned nothing for {bbox_key_str}.")
                return
            raw_list = raw if isinstance(raw, list) else [raw]

            times = _trim_to_window(raw_list, start, end)
            if not times:
                logger.warning(
                    f"[Wind Native Recovery] {model} native fetch had no step inside "
                    f"{start:%Y-%m-%dT%H:%M}Z..{end:%Y-%m-%dT%H:%M}Z for {bbox_key_str}."
                )
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

            # Remaining window hours via the standard bg persistence. Fresh context, no waiters; the
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
            if job is not None:
                job.expires = (datetime.now(timezone.utc).timestamp()
                               + float(os.environ.get("WIND_NATIVE_RECOVERY_COOLDOWN_SEC", "600")))
                RECOVERED.append(job)
            logger.info(
                f"[Wind Native Recovery] {model} recovery COMPLETE for {bbox_key_str}: "
                f"{len(times)} timesteps persisted (fine product now cached)."
            )
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.error(f"[Wind Native Recovery] {model} recovery failed for {bbox_key_str}: {e}")

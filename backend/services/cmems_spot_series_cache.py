"""CMEMS spot series, fetched once per bulletin (roadmap stage 1, 2026-09-26).

THE WASTE. CMEMS publishes a new global-wave bulletin twice a day (00H and 12H; read from the native
file names, see cmems_run_identity). The spot pre-warm (copernicus_point_batching) runs in both the
core ingest and the precompute lane, about 12 times a day, and each run spent its whole 1200 s budget
on ~179 box subsets of data that had changed at most twice. It aborted every run on a healthy
upstream ("STRUCTURAL, NOT DEGRADED"), leaving 8-17% of rating points on non-native fallback.

THE FIX. One gzipped L2 blob holds every spot's full series, tagged with the bulletin each series
was PROVEN to carry (`__model_run_time`, stamped by `stamp_run` from the served horizon). A lane
loads it when its bulletin equals the newest one in the native store, fetches only the spots it
lacks, and writes back the union. A budget-aborted run therefore completes the blob on the next
run instead of starting over, and a new bulletin empties it by construction.

SAFE BY CONSTRUCTION
  * Only series stamped with the CURRENT native bulletin are cached; an unstamped or older series
    is never written, so an ARCO rebuild lagging its native files cannot poison the cache.
  * Every failure (listing, read, write, parse) degrades to today's path: fetch everything.
  * Gzip, because ~1,700 spots x 12 variables x ~80 steps is ~13 MB of JSON and ~12 reads a day would
    spend Supabase egress; the repeated timestamps compress very well.
Kill: CMEMS_POINT_CACHE_L2=0.
"""
import gzip
import json
import logging
import os
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

CACHE_KEY = "point_cache/cmems_spot_series.json.gz"
SCHEMA_VERSION = 1


def enabled() -> bool:
    """On by default; OFF under the test suite (TESTING=1, set by conftest) unless a test sets
    CMEMS_POINT_CACHE_L2=1 and stubs the network, so no test ever reaches the CMEMS catalogue."""
    default = "0" if os.environ.get("TESTING") == "1" else "1"
    return os.environ.get("CMEMS_POINT_CACHE_L2", default) != "0"


def point_key(lat, lng):
    """The same rounding the batched point cache uses (2 decimals), as a JSON-safe string."""
    return f"{round(float(lat), 2):.2f},{round(float(lng), 2):.2f}"


def usable_entries(blob, bulletin_iso, forecast_days, dataset_id) -> dict:
    """PURE: {point_key: series} from `blob` when it describes THIS bulletin, horizon and dataset, else {}.
    Each series must itself carry the bulletin stamp; anything else is dropped."""
    if not isinstance(blob, dict) or not bulletin_iso:
        return {}
    if (blob.get("version") != SCHEMA_VERSION or blob.get("bulletin") != bulletin_iso
            or blob.get("forecast_days") != forecast_days or blob.get("dataset") != dataset_id):
        return {}
    points = blob.get("points")
    if not isinstance(points, dict):
        return {}
    return {k: v for k, v in points.items()
            if isinstance(v, dict) and v.get("__model_run_time") == bulletin_iso and v.get("hourly", {}).get("time")}


def merged_blob(existing_entries, new_series_by_key, bulletin_iso, forecast_days, dataset_id):
    """PURE: the blob to write, or None when nothing new and proven arrived.
    `new_series_by_key` may hold unstamped or other-bulletin series; only proven ones are kept."""
    fresh = {k: v for k, v in (new_series_by_key or {}).items()
             if isinstance(v, dict) and v.get("__model_run_time") == bulletin_iso and v.get("hourly", {}).get("time")}
    added = {k: v for k, v in fresh.items() if k not in (existing_entries or {})}
    if not added:
        return None
    points = dict(existing_entries or {})
    points.update(added)
    return {"version": SCHEMA_VERSION, "dataset": dataset_id, "bulletin": bulletin_iso,
            "forecast_days": forecast_days, "generated_at": datetime.now(timezone.utc).isoformat(),
            "points": points}


def load_blob():
    """NEVER RAISES: the cached blob from L2, or None. Cache-busted like the spot-ratings read."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return None
    try:
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{CACHE_KEY}?cb={int(time.time() * 1000)}"
        resp = requests.get(url, headers={"Authorization": f"Bearer {key}", "apikey": key,
                                          "Cache-Control": "no-cache"}, timeout=60)
        if resp.status_code != 200:
            return None
        return json.loads(gzip.decompress(resp.content).decode("utf-8"))
    except Exception as e:
        logger.info(f"[CMEMS spot cache] read failed, fetching instead: {type(e).__name__}")
        return None


def save_blob(blob) -> bool:
    """NEVER RAISES: upload the gzipped blob; True on success."""
    try:
        from services.weather_pipeline.store import ProductStore
        data = gzip.compress(json.dumps(blob, separators=(",", ":")).encode("utf-8"), compresslevel=6)
        ProductStore()._upload_to_supabase(CACHE_KEY, data, strict=True)
        logger.info(f"[CMEMS spot cache] wrote {len(blob.get('points', {}))} series for bulletin "
                    f"{blob.get('bulletin')} ({len(data)} bytes gzipped)")
        return True
    except Exception as e:
        logger.warning(f"[CMEMS spot cache] write failed (next run fetches again): {type(e).__name__}: {e}")
        return False

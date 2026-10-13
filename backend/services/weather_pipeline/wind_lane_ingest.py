"""wind_lane_ingest.py — build and publish the HRRR wind lane on the ingest runner (2026-10-09, D-017).

The core ingest (forecast-ingest.yml, every 4 h) runs `ingest_hrrr_wind_lane` after "GFS Wind Global". It spawns
services/noaa_hrrr_wind_fetcher.py (by path, off the event loop), checks the object decodes into a `wind_lane.Lane`,
and publishes it to L2:

  wind_lane/hrrr-<cycle YYYYMMDDHH>.json    the cycle (~3-5 MB: 49 hourly fields, 0.25 deg, int16 knots)
  wind_lane/index.json                       written LAST: {"key", "cycle", "horizon", ...} -- the serve box loads
                                             whatever the index names, so a half-uploaded cycle is never served

It keeps the previous cycle (the index's `previous_key`) and deletes the one before it.

⛔ GITHUB ACTIONS ONLY. The Render box can run these jobs in-process (DISABLE_FORECAST_SCHEDULER unset), and 49
HRRR steps are ~233 MB of GRIB and a minute of decode: that must never land on the 1-CPU box that serves the site.
Kill: WIND_HRRR_LANE_INGEST=0. A manual run elsewhere: WIND_HRRR_LANE_INGEST=force.
"""
import json
import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def should_run() -> bool:
    mode = os.environ.get("WIND_HRRR_LANE_INGEST", "1")
    if mode == "0":
        return False
    return mode == "force" or os.environ.get("GITHUB_ACTIONS", "") == "true"


def cycle_key(cycle_iso: str) -> str:
    from services import _hrrr_grid as hg
    return f"wind_lane/hrrr-{hg.utc(cycle_iso):%Y%m%d%H}.json"


def build_index(lane_obj: dict, key: str, size: int, previous_key=None) -> dict:
    return {
        "format": lane_obj["format"], "key": key, "cycle": lane_obj["cycle"], "horizon": lane_obj["horizon"],
        "hours": len(lane_obj["hours"]), "steps_failed": lane_obj.get("steps_failed", 0), "bytes": size,
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "previous_key": previous_key,
        "builder": f"gh-run-{os.environ['GITHUB_RUN_ID']}" if os.environ.get("GITHUB_RUN_ID") else "local",
    }


async def ingest_hrrr_wind_lane(store, fetch=None, read_index=None) -> dict:
    """Fetch, validate and publish one HRRR cycle. Returns a small status dict (also logged). `fetch` and
    `read_index` are injectable for tests; production uses the fetcher subprocess and L2."""
    if not should_run():
        logger.info("[HRRR Wind Lane] skipped: runs on GitHub Actions only (WIND_HRRR_LANE_INGEST=force to override)")
        return {"status": "skipped"}
    from services.weather_pipeline.wind_lane import INDEX_KEY, Lane, _l2_get
    if fetch is None:
        from services._fetch_common import run_fetcher_subprocess

        async def fetch():
            return await run_fetcher_subprocess(
                "noaa_hrrr_wind_fetcher.py", {}, 0.25, 2, log_tag="NOAA HRRR wind lane", out_prefix="hrrr_lane",
                timeout=int(os.environ.get("WIND_HRRR_LANE_TIMEOUT_S", "1500")), extra_payload={"max_f": 48})
    lane_obj = await fetch()
    if not lane_obj:
        logger.warning("[HRRR Wind Lane] no cycle fetched; the serve box keeps the previous lane")
        return {"status": "no_cycle"}
    Lane(lane_obj)                               # refuses a malformed or empty object before anything is published
    key = cycle_key(lane_obj["cycle"])
    prev = (read_index or (lambda: _l2_get(INDEX_KEY)))() or {}
    if prev.get("key") == key and int(prev.get("hours", 0)) >= len(lane_obj["hours"]):
        logger.info(f"[HRRR Wind Lane] cycle {lane_obj['cycle']} already published ({prev.get('hours')} hours)")
        return {"status": "unchanged", "key": key}
    data = json.dumps(lane_obj, separators=(",", ":")).encode("utf-8")
    store._upload_to_supabase(key, data, strict=True)
    previous_key = prev.get("key") if prev.get("key") != key else prev.get("previous_key")
    index = build_index(lane_obj, key, len(data), previous_key)
    store._upload_to_supabase(INDEX_KEY, json.dumps(index).encode("utf-8"), strict=True)
    stale = prev.get("previous_key")
    if stale and stale not in (key, previous_key):
        try:
            store._delete_from_supabase(stale)
        except Exception as e:  # pragma: no cover - a leftover object costs storage, never correctness
            logger.warning(f"[HRRR Wind Lane] could not delete {stale}: {e}")
    logger.info(f"[HRRR Wind Lane] published {key}: {len(lane_obj['hours'])} hours to {lane_obj['horizon']}, "
                f"{len(data)} bytes, {lane_obj.get('steps_failed', 0)} failed steps")
    return {"status": "published", "key": key, "index": index}

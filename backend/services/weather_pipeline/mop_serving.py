"""mop_serving.py — CDIP MOP's nearshore sea for a served point (roadmap stage 4), behind SURF_NEARSHORE_MOP.

With the flag on (default OFF), a point that sits on a covered California catalogue spot (within
SPOT_MATCH_KM of it in data/mop_spot_cells.json) takes MOP's forecast at that spot's cell, from the blob the
ingest writes every 6 h (point_cache/mop_spot_series.json.gz), as the input to the breaking step
(`surf_point.estimate_surf_at(nearshore=...)` -> `mop_nearshore.estimate_surf_from_nearshore`). Everything
else, and every failure here, keeps the parametric chain: this module never raises and never guesses.

⚠️ FLIP ONLY ON EVIDENCE: the served grids are ECMWF-driven sea+swell runs whose skill the nearshore judge's
archived-grid arm is still accruing (#124 graded MOP's WW3-driven buoy series, a different product). And flip
it in Render AND both ingest lanes together, like every science flag (tests/test_flag_lane_parity.py).
"""
import asyncio
import gzip
import json
import logging
import math
import os
import time
from datetime import datetime

logger = logging.getLogger(__name__)

TABLE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                     "data", "mop_spot_cells.json")
LATEST_KEY = "point_cache/mop_spot_series.json.gz"
SPOT_MATCH_KM = 0.3          # a served point this close to a catalogue spot IS that spot
BLOB_TTL_S = 1800.0          # the ingest runs every 6 h; half an hour keeps a restart cheap

_spots = None                # [(lat, lng, spot_id)] from the committed table, loaded once
_blob = (0.0, None)          # (loaded_at, blob)


def enabled() -> bool:
    return os.environ.get("SURF_NEARSHORE_MOP", "0") == "1"


def _km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2)
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def _spot_index():
    global _spots
    if _spots is None:
        try:
            with open(TABLE, encoding="utf-8") as f:
                _spots = [(float(c["lat"]), float(c["lng"]), c["spot_id"]) for c in json.load(f).get("cells", [])]
        except (OSError, ValueError, KeyError, TypeError):
            _spots = []
    return _spots


def spot_for_point(lat, lng):
    """The covered catalogue spot this point stands on, or None."""
    best = None
    for slat, slng, sid in _spot_index():
        if abs(slat - lat) > 0.01 or abs(slng - lng) > 0.012:
            continue
        km = _km(lat, lng, slat, slng)
        if km <= SPOT_MATCH_KM and (best is None or km < best[0]):
            best = (km, sid)
    return best[1] if best else None


def _load_blob():
    """NEVER RAISES: the latest ingest blob from L2 (memoised for BLOB_TTL_S), or None."""
    global _blob
    loaded_at, blob = _blob
    if blob is not None and time.time() - loaded_at < BLOB_TTL_S:
        return blob
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return None
    try:
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        resp = requests.get(f"{base}/storage/v1/object/{WEATHER_BUCKET}/{LATEST_KEY}",
                            headers={"Authorization": f"Bearer {key}", "apikey": key}, timeout=30)
        if resp.status_code != 200:
            return blob
        fresh = json.loads(gzip.decompress(resp.content).decode("utf-8"))
        _blob = (time.time(), fresh)
        return fresh
    except Exception as e:                                             # noqa: BLE001 — never costs the point
        logger.info(f"[MOP serving] blob read failed, parametric chain kept: {type(e).__name__}")
        return blob


async def nearshore_for_point(lat, lng, valid_time_str):
    """MOP's sea for this point and hour ({hs, tp, dp, depth_m, spot_id, run}), or None. Flag-gated; the
    blob read runs off the event loop."""
    if not enabled():
        return None
    sid = spot_for_point(float(lat), float(lng))
    if not sid:
        return None
    blob = await asyncio.to_thread(_load_blob)
    entry = ((blob or {}).get("spots") or {}).get(sid)
    try:
        when = datetime.fromisoformat(str(valid_time_str).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if not entry:
        return None
    from services.weather_pipeline.mop_nearshore import nearshore_at
    sea = nearshore_at(entry, when)
    if not sea:
        return None
    run = ((blob.get("grids") or {}).get(entry.get("grid")) or {}).get("run")
    return {**sea, "spot_id": sid, "run": run}


def _reset_for_test():
    global _spots, _blob
    _spots, _blob = None, (0.0, None)

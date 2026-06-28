"""
spot_ratings.py — shared per-spot surf-quality rating compute + precompute persistence (P1).

ONE implementation of "rate a surf spot" used by BOTH the live `/api/weather/spot-ratings` endpoint AND the
cron precompute, so they can never diverge (the parity rule). The precompute is designed to run on the GitHub
Action ingest runner (off the 1-CPU serve box): it reads the spot list via Supabase REST (the runner has no
DATABASE_URL — only the Storage service key), rates each spot, and writes a small JSON object to Supabase
Storage L2. The serve box reads that object back; the endpoint falls through to live compute whenever no
precomputed frame covers the request, so this is purely additive — it never removes the working live path.
"""
import json
import logging
import math
import os
from datetime import datetime, timezone
from typing import Optional

from services.weather_pipeline.schemas import NormalizedPointResponse
from services.weather_pipeline.surf_rating import compute_surf_rating

logger = logging.getLogger(__name__)

KT_TO_MS = 0.514444
SPOT_RATINGS_L2_KEY = "spot_ratings/latest.json"
SPOT_RATINGS_SCHEMA_VERSION = 1


def spot_confidence(accuracy_flag, is_verified_peak) -> str:
    """Rating confidence from the spot's location-accuracy metadata (bathymetry factors are only as good as
    the pin). verified/verified-peak -> high; low_accuracy/crowdsourced -> low; else medium."""
    flag = (accuracy_flag or "").lower()
    if is_verified_peak or flag == "verified":
        return "high"
    if flag in ("low_accuracy", "crowdsourced"):
        return "low"
    return "medium"


def rating_why(level, surf_h_m, period_s, wind_ms, wind_from, shore_normal) -> Optional[str]:
    """Compact explainability string. None when there's nothing to rate."""
    if level == "unknown" or surf_h_m is None:
        return None
    parts = [f"~{surf_h_m * 3.281:.1f} ft surf"]
    if period_s:
        parts.append(f"{period_s:.0f}s period")
    if wind_ms is not None:
        kt = wind_ms * 1.943844
        if wind_from is not None and shore_normal is not None:
            off = -math.cos(math.radians(wind_from - shore_normal))  # +1 offshore .. -1 onshore
            wd = "offshore" if off > 0.34 else ("onshore" if off < -0.34 else "cross-shore")
            parts.append(f"{kt:.0f}kt {wd} wind")
        else:
            parts.append(f"{kt:.0f}kt wind")
    return ", ".join(parts)


async def rate_one_spot(resolver, spot, model, valid_time) -> dict:
    """Resolve a single spot's marine + wind point and compute its rating. `spot` is a dict with
    id/name/latitude/longitude/accuracy_flag/is_verified_peak (from the DB or Supabase REST). `resolver`
    exposes `async resolve_point(model, domain, layer, lat, lng, valid_time_str)` (the live point sampler).
    Returns the rating dict — the SAME shape the endpoint serves and the precompute persists."""
    lat, lng = spot["latitude"], spot["longitude"]
    surf_h = period = swell_from = shore_normal = wind_ms = wind_from = None
    try:
        marine = await resolver.resolve_point(
            model=model, domain="marine", layer="waves", lat=lat, lng=lng, valid_time_str=valid_time)
        if isinstance(marine, NormalizedPointResponse) and marine.point is not None:
            surf_h = marine.surf_height_m
            period = marine.point.period
            swell_from = marine.point.direction
            shore_normal = marine.shore_normal_deg
    except Exception as e:
        logger.debug(f"[spot-ratings] marine resolve failed for {spot.get('id')}: {e}")
    try:
        wind = await resolver.resolve_point(
            model=model, domain="wind", layer="wind", lat=lat, lng=lng, valid_time_str=valid_time)
        if isinstance(wind, NormalizedPointResponse) and wind.point is not None:
            wind_ms = (wind.point.speed or 0.0) * KT_TO_MS    # wind point speed is knots
            wind_from = wind.point.direction
    except Exception as e:
        logger.debug(f"[spot-ratings] wind resolve failed for {spot.get('id')}: {e}")
    score, level = compute_surf_rating(surf_h, period, wind_ms, wind_from, shore_normal, swell_from)
    return {
        "spot_id": str(spot["id"]),
        "name": spot.get("name"),
        "latitude": lat,
        "longitude": lng,
        "score": score,
        "level": level,
        "confidence": spot_confidence(spot.get("accuracy_flag"), spot.get("is_verified_peak")),
        "surf_height_m": round(surf_h, 3) if surf_h is not None else None,
        "period_s": round(period, 1) if period is not None else None,
        "why": rating_why(level, surf_h, period, wind_ms, wind_from, shore_normal),
    }


def _lng_in(lng, w, e) -> bool:
    """Longitude-in-bbox, antimeridian-aware (w>e means the bbox wraps the dateline)."""
    return (w <= lng <= e) if w <= e else (lng >= w or lng <= e)


def select_precomputed(obj, bbox, model, valid_time) -> Optional[list]:
    """PURE: pick the frame matching (model, valid_time) from a loaded L2 object and filter its spots to the
    bbox. Returns the list of rating dicts (possibly empty), or None when no matching frame exists — the
    signal for the caller to fall back to LIVE compute. Tolerant of malformed input."""
    if not obj or not isinstance(obj.get("frames"), list):
        return None
    try:
        w, s, e, n = bbox
    except Exception:
        return None
    frame = next((f for f in obj["frames"]
                  if f.get("model") == model and f.get("valid_time") == valid_time), None)
    if frame is None:
        return None
    out = []
    for sp in frame.get("spots", []):
        lat, lng = sp.get("latitude"), sp.get("longitude")
        if lat is None or lng is None:
            continue
        if s <= lat <= n and _lng_in(lng, w, e):
            out.append(sp)
    return out


def build_l2_object(frames) -> dict:
    """Wrap precomputed frames (each {model, valid_time, spots:[...]}) in the versioned L2 object."""
    return {
        "version": SPOT_RATINGS_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "frames": frames,
    }


def upload_spot_ratings_l2(store, obj) -> None:
    """Write the precomputed object to Supabase Storage L2 (reuses the store's REST upload — same path/creds
    as the grid products, so it works on the ingest runner with only the Storage service key)."""
    data = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    store._upload_to_supabase(SPOT_RATINGS_L2_KEY, data)


_l2_cache = {"obj": None, "ts": 0.0}


def load_spot_ratings_l2_cached(ttl: float = 300.0) -> Optional[dict]:
    """TTL-cached wrapper around load_spot_ratings_l2 so the serve box reads L2 at most once per `ttl`
    seconds (the precompute refreshes ~hourly on the cron). Used by the endpoint's precomputed-read path."""
    import time
    now = time.time()
    if _l2_cache["obj"] is not None and (now - _l2_cache["ts"]) < ttl:
        return _l2_cache["obj"]
    obj = load_spot_ratings_l2()
    # Cache even a None result briefly so a missing object doesn't 404 on every request.
    _l2_cache["obj"] = obj
    _l2_cache["ts"] = now
    return obj


def load_spot_ratings_l2() -> Optional[dict]:
    """Read the precomputed object back from L2 via a self-contained Storage REST GET (mirrors the upload).
    Returns the parsed object or None (missing / not configured / error) → caller falls back to live."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return None
    try:
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{SPOT_RATINGS_L2_KEY}"
        resp = requests.get(url, headers={"Authorization": f"Bearer {key}", "apikey": key}, timeout=10)
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception as e:
        logger.debug(f"[spot-ratings] L2 load failed: {e}")
        return None


def fetch_active_spots_via_rest(limit: int = 5000) -> list:
    """Read active surf spots via Supabase REST/PostgREST (the ingest runner has no DATABASE_URL, only the
    Storage service key — which also authorizes PostgREST and bypasses RLS). Returns a list of spot dicts."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return []
    import requests
    url = (f"{base}/rest/v1/surf_spots?select=id,name,latitude,longitude,accuracy_flag,is_verified_peak"
           f"&is_active=eq.true&latitude=not.is.null&longitude=not.is.null&limit={limit}")
    resp = requests.get(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=30)
    resp.raise_for_status()
    return resp.json()
